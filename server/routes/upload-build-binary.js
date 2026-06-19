const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { runDetachedCommand } = require('./run-detached-command');

const PROJECT_ROOT = '/home/ec2-user/zuma-teledoc';
const DEPLOY_LOG = '/tmp/doctarx-deploy.log';
const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
const DEPLOY_LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const PM2_APP_NAME = process.env.PM2_APP_NAME || 'zuma-teledoc';
const CRONOPS_ROOT = `${PROJECT_ROOT}/cronops`;
const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
const GITHUB_OIDC_AUDIENCE = process.env.DEPLOY_GITHUB_OIDC_AUDIENCE || 'doctarx-deploy';
const GITHUB_DEPLOY_REPOSITORY = process.env.DEPLOY_GITHUB_REPOSITORY || 'Jonahbaka/zuma-teledoc';
const GITHUB_DEPLOY_REF = process.env.DEPLOY_GITHUB_REF || 'refs/heads/main';
let githubJwksCache = { fetchedAt: 0, keys: [] };

const INJECTABLE_ENV_KEYS = new Set([
  'NG_LIVEKIT_URL',
  'NG_LIVEKIT_API_KEY',
  'NG_LIVEKIT_API_SECRET',
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'CLAUDE_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_PUBLIC_KEY',
  'FLUTTERWAVE_SECRET_KEY',
  'FLUTTERWAVE_PUBLIC_KEY',
  'TERMII_API_KEY',
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_FROM',
  'RTC_TURN_URLS',
  'TURN_STATIC_AUTH_SECRET',
  'DEPLOY_SECRET',
]);

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 500 * 1024 * 1024 },
});

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function safeBranch(value) {
  const branch = String(value || 'main').trim();
  return /^[A-Za-z0-9._/-]{1,120}$/.test(branch) ? branch : 'main';
}

function safeSha(value) {
  const sha = String(value || '').trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : '';
}

function newDeployId() {
  const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function firstMatch(raw, re) {
  const match = raw.match(re);
  return match ? match[1] : null;
}

function parseDeployLog(raw = '') {
  const pid = firstMatch(raw, /\[deploy:pid\]\s+(\d+)/);
  const startedAt = firstMatch(raw, /\[deploy\] start\s+(\S+)/);
  const failedExit = firstMatch(raw, /\[deploy\] failed \(exit (\d+)\)/);

  return {
    deployId: firstMatch(raw, /\[deploy:id\]\s+(\S+)/),
    pid: pid ? parseInt(pid, 10) : null,
    startedAt,
    startedAtMs: startedAt ? Date.parse(startedAt) : null,
    complete: raw.includes('[deploy] complete'),
    failed: raw.includes('[deploy] failed') || raw.includes('[verify:result] FAIL'),
    exitCode: failedExit ? parseInt(failedExit, 10) : null,
  };
}

function readDeployLog(logPath = DEPLOY_LOG) {
  try {
    return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  } catch {
    return '';
  }
}

function getActiveDeploy(options = {}) {
  const logPath = options.logPath || DEPLOY_LOG;
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  const pidAlive = options.isPidAlive || isPidAlive;
  const parsed = parseDeployLog(readDeployLog(logPath));
  const ageMs = parsed.startedAtMs ? Math.max(0, now - parsed.startedAtMs) : null;
  const timedOut = ageMs !== null && ageMs > DEPLOY_LOCK_TIMEOUT_MS;
  const terminal = parsed.complete || parsed.failed;
  const alive = parsed.pid ? pidAlive(parsed.pid) : false;

  if (terminal || timedOut) return null;
  if (!parsed.deployId && !parsed.pid && !parsed.startedAt) return null;
  if (parsed.pid && !alive) return null;
  if (!parsed.pid && !parsed.startedAtMs) return null;

  return {
    deployId: parsed.deployId,
    pid: parsed.pid,
    startedAt: parsed.startedAt,
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    logPath,
    status: 'running',
  };
}

function mergeEnvFile(envPath, updates) {
  const safe = Object.entries(updates || {}).filter(([key]) => INJECTABLE_ENV_KEYS.has(key));
  if (!safe.length) return [];

  let content = '';
  try {
    content = fs.readFileSync(envPath, 'utf8');
  } catch {
    content = '';
  }

  for (const [key, rawValue] of safe) {
    const value = String(rawValue).replace(/\r?\n/g, '');
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      if (content && !content.endsWith('\n')) content += '\n';
      content += `${line}\n`;
    }
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 });
  return safe.map(([key]) => key);
}

async function getGithubJwks() {
  const cacheTtlMs = 60 * 60 * 1000;
  if (githubJwksCache.keys.length && Date.now() - githubJwksCache.fetchedAt < cacheTtlMs) {
    return githubJwksCache.keys;
  }

  const response = await fetch(GITHUB_OIDC_JWKS_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Unable to fetch GitHub OIDC keys: HTTP ${response.status}`);
  }
  const jwks = await response.json();
  githubJwksCache = {
    fetchedAt: Date.now(),
    keys: Array.isArray(jwks.keys) ? jwks.keys : [],
  };
  return githubJwksCache.keys;
}

async function getGithubSigningKey(kid) {
  const keys = await getGithubJwks();
  const jwk = keys.find((key) => key.kid === kid);
  if (jwk) return crypto.createPublicKey({ key: jwk, format: 'jwk' });

  githubJwksCache = { fetchedAt: 0, keys: [] };
  const freshKeys = await getGithubJwks();
  const freshJwk = freshKeys.find((key) => key.kid === kid);
  if (!freshJwk) throw new Error('GitHub OIDC signing key not found');
  return crypto.createPublicKey({ key: freshJwk, format: 'jwk' });
}

async function verifyGithubOidcToken(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.header?.kid) throw new Error('Invalid GitHub OIDC token header');

  const signingKey = await getGithubSigningKey(decoded.header.kid);
  const payload = jwt.verify(token, signingKey, {
    algorithms: ['RS256'],
    audience: GITHUB_OIDC_AUDIENCE,
    issuer: GITHUB_OIDC_ISSUER,
  });

  if (payload.repository !== GITHUB_DEPLOY_REPOSITORY) {
    throw new Error('GitHub OIDC repository is not allowed');
  }
  if (GITHUB_DEPLOY_REF && payload.ref !== GITHUB_DEPLOY_REF) {
    throw new Error('GitHub OIDC ref is not allowed');
  }
  return payload;
}

async function authorizeDeployRequest(req) {
  const token = req.headers['x-deploy-token'] || req.body?.token;
  if (DEPLOY_SECRET && token === DEPLOY_SECRET) return { method: 'deploy_secret' };

  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const payload = await verifyGithubOidcToken(match[1]);
    return { method: 'github_oidc', repository: payload.repository, ref: payload.ref };
  }
  return null;
}

function parseEnvJson(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeScript(filePath, content) {
  fs.writeFileSync(filePath, content, { mode: 0o700 });
}

function artifactDeployScript({ deployId, tmpFile, gitSha, branch, scriptPath }) {
  const target = gitSha || `origin/${branch}`;
  const quotedTmp = shQuote(tmpFile);
  const quotedProject = shQuote(PROJECT_ROOT);
  const quotedTarget = shQuote(target);
  const quotedBranch = shQuote(branch);
  const quotedPrevious = shQuote('.next.artifact-prev');
  const quotedScript = shQuote(scriptPath);

return `#!/usr/bin/env bash
set -euo pipefail
cd ${quotedProject}
echo "[deploy:id] ${deployId}"
echo "[deploy:pid] $$"
echo "[deploy] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
restore_next_on_failure() {
  rc=$?
  rm -f ${quotedTmp} ${quotedScript} || true
  if [ "$rc" != "0" ] && [ -d ${quotedPrevious} ]; then
    echo "[deploy:rollback] restoring previous .next"
    rm -rf .next.failed
    if [ -d .next ]; then mv .next .next.failed; fi
    mv ${quotedPrevious} .next
    ln -sfn .next _next || true
    pm2 reload ecosystem.config.js --only ${PM2_APP_NAME} --update-env 2>/dev/null || true
  fi
  if [ "$rc" != "0" ]; then echo "[deploy] failed (exit $rc) $(date -u +%Y-%m-%dT%H:%M:%SZ)"; fi
  exit "$rc"
}
trap restore_next_on_failure EXIT
echo "[deploy:artifact] source=upload-build-binary branch=${branch} target=${target}"
rm -f .git/index.lock
git fetch --prune origin ${quotedBranch}
git reset --hard ${quotedTarget}
echo "[deploy] checkout $(git rev-parse --short=12 HEAD)"
git clean -fd -e .env -e .env.* -e global-bundle.pem -e '*.pem'
npm install --include=dev --prefer-offline --no-audit --no-fund
npm run migrate
node -e "const ensure=require('./server/db/ensureAgentTables'); const db=require('./server/db'); ensure().then(async ok=>{ await db.close(); process.exit(ok?0:1); }).catch(async err=>{ console.error(err); try{ await db.close(); }catch{} process.exit(1); })"
node ng/migrations/migrate.js
node ng/scripts/ingest-doctarx-nigeria-pack.js
rm -rf .next.artifact-staging ${quotedPrevious}
mkdir -p .next.artifact-staging
tar -xzf ${quotedTmp} -C .next.artifact-staging
rm -f ${quotedTmp}
test -s .next.artifact-staging/.next/BUILD_ID
echo "[deploy:artifact] buildId=$(cat .next.artifact-staging/.next/BUILD_ID)"
mkdir -p public
[ -f .next.artifact-staging/public/robots.txt ] && cp .next.artifact-staging/public/robots.txt public/robots.txt || true
[ -f .next.artifact-staging/public/sitemap.xml ] && cp .next.artifact-staging/public/sitemap.xml public/sitemap.xml || true
bash scripts/doctarx-blue-green-switch.sh .next.artifact-staging/.next
rm -rf .next.artifact-staging
pm2 reload ecosystem.config.js --only cronops --update-env || pm2 start ecosystem.config.js --only cronops --env production || true
APP_OK=no
for i in $(seq 1 90); do
  H=$(curl -s --max-time 10 --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/api/health || true)
  if echo "$H" | grep -q '"status":"healthy"' && echo "$H" | grep -q '"nextReady":true'; then APP_OK=yes; break; fi
  sleep 2
done
[ "$APP_OK" = "yes" ]
NG_HEALTH=$(curl -s --max-time 10 --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/api/ng/health || true)
echo "[verify:ng-health] $NG_HEALTH"
echo "$NG_HEALTH" | grep -q '"status":"ok"'
echo "[deploy:check] build=success"
echo "[deploy:check] pm2=success"
echo "[deploy:check] health=success"
echo "[deploy:check] ngHealth=success"
echo "[verify:result] PASS"
echo "[deploy] complete $(date -u +%Y-%m-%dT%H:%M:%SZ)"
`;
}

router.post('/', upload.single('tarball'), async (req, res) => {
  let auth;
  try {
    auth = await authorizeDeployRequest(req);
  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!auth) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const activeDeploy = getActiveDeploy();
  if (activeDeploy) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(409).json({
      success: false,
      error: 'Deploy already in progress',
      inProgress: true,
      message: 'Deploy already in progress - attach via /api/deploy/log',
      ...activeDeploy,
    });
  }

  const gitSha = safeSha(req.body?.gitSha || req.headers['x-git-sha']);
  const branch = safeBranch(req.body?.branch || req.headers['x-git-branch']);
  const envKeys = mergeEnvFile(path.join(PROJECT_ROOT, '.env'), parseEnvJson(req.body?.envJson));
  const deployId = newDeployId();
  const scriptPath = `/tmp/doctarx-artifact-deploy-${deployId}.sh`;

  try {
    fs.writeFileSync(DEPLOY_LOG, '');
    writeScript(scriptPath, artifactDeployScript({
      deployId,
      tmpFile: req.file.path,
      gitSha,
      branch,
      scriptPath,
    }));
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(500).json({ success: false, error: error.message });
  }

  let job;
  try {
    job = runDetachedCommand(`bash ${shQuote(scriptPath)}`, { logFile: DEPLOY_LOG });
    fs.appendFileSync(
      DEPLOY_LOG,
      [
        `[deploy:id] ${deployId}`,
        `[deploy:pid] ${job.pid}`,
        `[deploy] start ${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
        '[deploy:launcher] artifact upload accepted',
      ].join('\n') + '\n'
    );
  } catch (error) {
    try { fs.unlinkSync(req.file.path); } catch {}
    try { fs.unlinkSync(scriptPath); } catch {}
    return res.status(500).json({ success: false, error: error.message });
  }

  res.json({
    success: true,
    message: 'Artifact upload received; deploy running',
    deployId,
    pid: job.pid,
    fileSize: req.file.size,
    auth: auth.method,
    gitSha: gitSha || null,
    branch,
    envKeys,
  });
});

router._test = {
  DEPLOY_LOCK_TIMEOUT_MS,
  parseDeployLog,
  getActiveDeploy,
  isPidAlive,
  authorizeDeployRequest,
};

module.exports = router;
