const PROJECT_ROOT = '/home/ec2-user/zuma-teledoc';
const CRONOPS_ROOT = `${PROJECT_ROOT}/cronops`;
const DEPLOY_BUILD_MEMORY_MB = process.env.DEPLOY_BUILD_MEMORY_MB || '4096';
const PM2_APP_NAME = process.env.PM2_APP_NAME || 'zuma-teledoc';

// Build + reload steps. Any non-zero exit here aborts the chain and the
// terminal wrapper emits `[deploy] failed`. Steps that are intentionally
// best-effort are individually guarded with `|| true`.
function buildSteps() {
  return [
    `cd ${PROJECT_ROOT}`,
    'echo "[deploy] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"',
    // Production checkout should match origin/main exactly before building.
    'rm -f .git/index.lock',
    'git fetch --prune origin main',
    'git reset --hard origin/main',
    'echo "[deploy] checkout $(git rev-parse --short HEAD)"',
    // Preserve production-only secrets and certificates that are intentionally untracked.
    'git clean -fd -e .env -e .env.* -e global-bundle.pem -e *.pem',
    'npm install --include=dev --prefer-offline --no-audit --no-fund',
    'rm -rf .turbo .next _next public/_next',
    'npm run migrate',
    'node ng/migrations/migrate.js',
    'node ng/scripts/ingest-doctarx-nigeria-pack.js',
    'npm run test:deploy-gate',
    `NODE_OPTIONS="--max-old-space-size=${DEPLOY_BUILD_MEMORY_MB}" npm run build`,
    'test -n "$(find .next/static/chunks/app -path \'*/admin/testing-links/page-*.js\' -print -quit)"',
    '(ln -sfn .next _next || true)',
    '(rm -rf public/_next || true)',
    '(rm -rf .next/_next .next/static/_next .next/static/chunks/_next || true)',
    "(sudo mkdir -p /home/ubuntu 2>/dev/null && sudo ln -sfn /home/ec2-user/zuma-teledoc /home/ubuntu/zuma-teledoc 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l '_next' {} \\; 2>/dev/null | xargs -r sudo sed -i 's|/home/ubuntu/zuma-teledoc|/home/ec2-user/zuma-teledoc|g' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l 'location[[:space:]]*/_next/static' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+/_next/static/?\\s*\\{[^}]*\\}#location /_next/static/ {\\n    alias /home/ec2-user/zuma-teledoc/.next/static/;\\n    expires 1y;\\n    access_log off;\\n    add_header Cache-Control \"public, immutable\";\\n}#sg' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l '_next/static' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+(?:\\^~\\s+)?/_next/static/?\\s*\\{[^}]*\\}#location ^~ /_next/static/ {\\n    alias /home/ec2-user/zuma-teledoc/.next/static/;\\n    expires 1y;\\n    access_log off;\\n    add_header Cache-Control \"public, immutable\";\\n}#sg' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l 'location.*_next' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+(?:\\^~\\s+)?/_next/\\s*\\{[^}]*\\}#location ^~ /_next/ {\\n    alias /home/ec2-user/zuma-teledoc/.next/;\\n    expires 1y;\\n    access_log off;\\n    add_header Cache-Control \"public, immutable\";\\n}#sg' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l 'server_name.*doctarx' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+(?:=\\s+|~\\*?\\s+|\\^~\\s+)?[^\\{]*_next[^\\{]*\\{[^}]*\\}\\s*##sg; s#(server_name[^;]*doctarx[^;]*;)#$1\\n    location ^~ /_next/static/ {\\n        alias /home/ec2-user/zuma-teledoc/.next/static/;\\n        expires 1y;\\n        access_log off;\\n        add_header Cache-Control \"public, immutable\";\\n    }\\n    location ^~ /_next/ {\\n        alias /home/ec2-user/zuma-teledoc/.next/;\\n        expires 1y;\\n        access_log off;\\n        add_header Cache-Control \"public, immutable\";\\n    }\\n#sg' 2>/dev/null || true)",
    '(sudo nginx -t 2>&1 && sudo nginx -s reload 2>&1 || true)',
    // Zero-downtime reload: reload respawns workers one-by-one without dropping connections.
    // Falls back to start via ecosystem config if the app is not yet registered in PM2.
    `(pm2 reload ecosystem.config.js --only ${PM2_APP_NAME} --update-env 2>/dev/null || pm2 start ecosystem.config.js --only ${PM2_APP_NAME} --env production)`,
    `(pm2 reload ecosystem.config.js --only cronops --update-env 2>/dev/null || pm2 start ecosystem.config.js --only cronops --env production)`,
  ];
}

// Verification steps run on EC2 (localhost:8080) so they bypass any sandbox /
// public-IP allowlist. The chain ends with a hard gate: if NG platform health
// is not "ok", the step exits non-zero and the deploy is marked failed.
// Shell variables persist across these `&&`-joined steps (one bash process).
function verifySteps() {
  return [
    'echo "[verify] waiting for app to be ready..."',
    'APP_UP=no; for i in $(seq 1 90); do HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/health 2>/dev/null); if [ "$HTTP" = "200" ] || [ "$HTTP" = "503" ]; then echo "[verify] app responded HTTP $HTTP after ${i}s"; APP_UP=yes; break; fi; sleep 2; done; echo "[verify:app-up] $APP_UP"',
    // /api/health (US/base health) for completeness
    'BASE_HEALTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/health 2>/dev/null); echo "[verify:api-health] HTTP=$BASE_HEALTH_HTTP"',
    // PM2 process status
    'echo "[verify:pm2]" && (pm2 jlist 2>/dev/null | python3 -c "import json,sys; [print(\'[verify:pm2]\', {\'name\':p[\'name\'],\'status\':p[\'pm2_env\'][\'status\'],\'pid\':p[\'pid\'],\'restarts\':p[\'pm2_env\'].get(\'restart_time\')}) for p in json.load(sys.stdin)]" 2>/dev/null || echo "[verify:pm2] pm2 jlist failed")',
    // NG platform health — retried; this is the hard gate for deploy success.
    'NG_HEALTH=""; for i in $(seq 1 15); do NG_HEALTH=$(curl -s --max-time 10 http://localhost:8080/api/ng/health 2>/dev/null || true); echo "$NG_HEALTH" | grep -q \'"status":"ok"\' && break; sleep 2; done; echo "[verify:ng-health] $NG_HEALTH"',
    'echo "$NG_HEALTH" | grep -q \'"multiPartyConferencing":true\' && echo "[verify:ng-multiparty] true" || echo "[verify:ng-multiparty] false"',
    // NG conference media-readiness — LiveKit / SFU check (informational).
    'NG_MEDIA=$(curl -s --max-time 10 http://localhost:8080/api/ng/conference/media-readiness 2>/dev/null || true); echo "[verify:ng-media-readiness] $NG_MEDIA"',
    'if echo "$NG_MEDIA" | grep -q \'"configured":true\'; then echo "[verify:livekit] configured=true — SFU ready (5-10 participant conferencing enabled)"; echo "[verify:sfu-5] READY"; echo "[verify:sfu-10] READY"; else echo "[verify:livekit] configured=false — SFU NOT ready (check NG_LIVEKIT_URL/API_KEY/API_SECRET in .env)"; echo "[verify:sfu-5] NOT_READY"; echo "[verify:sfu-10] NOT_READY"; fi',
    // NG routes
    'HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ng/conference 2>/dev/null); echo "[verify:ng-conference-route] HTTP=$HTTP"',
    'HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/ng 2>/dev/null); echo "[verify:ng-root] HTTP=$HTTP"',
    // ── Hard gate ──: NG platform must report healthy or the deploy is a failure.
    'if echo "$NG_HEALTH" | grep -q \'"status":"ok"\'; then echo "[verify:result] PASS"; else echo "[verify:result] FAIL — /api/ng/health did not report status=ok"; exit 1; fi',
  ];
}

// Returns a single shell command whose log is guaranteed to end in exactly one
// terminal marker:
//   [deploy] complete   → build succeeded AND verification gate passed
//   [deploy] failed      → any build step or the verification gate failed
// The supervising webhook / GitHub Actions treats anything else (no marker +
// dead PID, or timeout) as an incomplete/unknown deploy and reports failure.
function buildDeployCommand() {
  const inner = [...buildSteps(), ...verifySteps()].join(' && ');
  return `( ${inner} ) && echo "[deploy] complete $(date -u +%Y-%m-%dT%H:%M:%SZ)" || { rc=$?; echo "[deploy] failed (exit $rc) $(date -u +%Y-%m-%dT%H:%M:%SZ)"; exit 1; }`;
}

module.exports = {
  PROJECT_ROOT,
  buildDeployCommand,
};
