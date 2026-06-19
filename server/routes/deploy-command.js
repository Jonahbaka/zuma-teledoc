const PROJECT_ROOT = '/home/ec2-user/zuma-teledoc';
const CRONOPS_ROOT = `${PROJECT_ROOT}/cronops`;
const DEPLOY_BUILD_MEMORY_MB = process.env.DEPLOY_BUILD_MEMORY_MB || '4096';
const PM2_APP_NAME = process.env.PM2_APP_NAME || 'zuma-teledoc';
const NEXT_STAGING_DIR = '.next.build';
const NEXT_PREVIOUS_DIR = '.next.previous-good';

// ── Phases ──────────────────────────────────────────────────────────────────
// The deploy runs as four phases. Each phase is wrapped so it emits exactly one
// checkpoint marker into the log:
//   [deploy:check] <phase>=success   — every step in the phase passed
//   [deploy:check] <phase>=failed    — a step failed (chain aborts here)
// These markers are the contract the status endpoint reads to populate
// `checks.{build,pm2,health,ngHealth}`. Phase steps are joined with ` && ` and
// run in ONE bash subshell, so shell variables persist within a phase.

// 1) build — sync source to origin/main, install, migrate, build, prep assets.
function buildPhase() {
  return [
    `cd ${PROJECT_ROOT}`,
    // Production checkout should match origin/main exactly before building.
    'rm -f .git/index.lock',
    'git fetch --prune origin main',
    'git reset --hard origin/main',
    'echo "[deploy] checkout $(git rev-parse --short HEAD)"',
    // Failed/manual artifact deploys can leave root-owned .next.broken files.
    // Remove those before git clean so stale build debris cannot block deploy.
    `(sudo rm -rf .next.broken .next.failed .next.tmp ${NEXT_STAGING_DIR} ${NEXT_PREVIOUS_DIR} 2>/dev/null || rm -rf .next.broken .next.failed .next.tmp ${NEXT_STAGING_DIR} ${NEXT_PREVIOUS_DIR} || true)`,
    // Preserve production-only secrets and certificates that are intentionally untracked.
    'git clean -fd -e .env -e .env.* -e global-bundle.pem -e *.pem',
    'npm install --include=dev --prefer-offline --no-audit --no-fund',
    `rm -rf .turbo ${NEXT_STAGING_DIR} _next public/_next`,
    'npm run migrate',
    'node ng/migrations/migrate.js',
    'node ng/scripts/ingest-doctarx-nigeria-pack.js',
    'npm run test:deploy-gate',
    `NEXT_DIST_DIR=${NEXT_STAGING_DIR} NODE_OPTIONS="--max-old-space-size=${DEPLOY_BUILD_MEMORY_MB}" npm run build`,
    `test -s ${NEXT_STAGING_DIR}/BUILD_ID`,
    `test -n "$(find ${NEXT_STAGING_DIR}/static/chunks/app -path '*/admin/testing-links/page-*.js' -print -quit)"`,
    `test -n "$(find ${NEXT_STAGING_DIR}/static/chunks/app -path '*/ng/provider/call/page-*.js' -print -quit)"`,
    `(rm -rf ${NEXT_STAGING_DIR}/_next ${NEXT_STAGING_DIR}/static/_next ${NEXT_STAGING_DIR}/static/chunks/_next || true)`,
  ];
}

// 2) pm2 — fix nginx asset routes (best-effort) and reload the app + cronops.
// `pm2 reload` restarts the Node process that serves this very endpoint; the
// detached bash keeps running and writing the log across that restart. The
// phase ends with a hard gate: the pm2 daemon must answer `pm2 jlist`.
function pm2Phase() {
  return [
    `test -d ${NEXT_STAGING_DIR}/static`,
    `bash scripts/doctarx-blue-green-switch.sh ${NEXT_STAGING_DIR}`,
    `(pm2 reload ecosystem.config.js --only cronops --update-env 2>/dev/null || pm2 start ecosystem.config.js --only cronops --env production)`,
    // Informational PM2 snapshot (never fails the phase).
    'echo "[verify:pm2]" && (pm2 jlist 2>/dev/null | python3 -c "import json,sys; [print(\'[verify:pm2]\', {\'name\':p[\'name\'],\'status\':p[\'pm2_env\'][\'status\'],\'pid\':p[\'pid\'],\'restarts\':p[\'pm2_env\'].get(\'restart_time\')}) for p in json.load(sys.stdin)]" 2>/dev/null || echo "[verify:pm2] pm2 jlist failed")',
    // Hard gate: the pm2 daemon must be responsive.
    'pm2 jlist >/dev/null 2>&1',
  ];
}

// 3) health — wait for the app and require base /api/health == 200.
function healthPhase() {
  return [
    'echo "[verify] waiting for app to be ready..."',
    'APP_UP=no; for i in $(seq 1 90); do HTTP=$(curl -s -o /dev/null -w "%{http_code}" --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/api/health 2>/dev/null); if [ "$HTTP" = "200" ] || [ "$HTTP" = "503" ]; then echo "[verify] app responded HTTP $HTTP after ${i}s"; APP_UP=yes; break; fi; sleep 2; done; echo "[verify:app-up] $APP_UP"; [ "$APP_UP" = "yes" ]',
    // Hard gate: base health must be 200.
    'BASE_HEALTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/api/health 2>/dev/null); echo "[verify:api-health] HTTP=$BASE_HEALTH_HTTP"; [ "$BASE_HEALTH_HTTP" = "200" ]',
  ];
}

// 4) ngHealth — verify the NG platform on localhost:8080 (bypasses the public
// IP allowlist). Ends with a hard gate: /api/ng/health must report status=ok.
function ngHealthPhase() {
  return [
    'NG_HEALTH=""; for i in $(seq 1 15); do NG_HEALTH=$(curl -s --max-time 10 --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/api/ng/health 2>/dev/null || true); echo "$NG_HEALTH" | grep -q \'"status":"ok"\' && break; sleep 2; done; echo "[verify:ng-health] $NG_HEALTH"',
    'echo "$NG_HEALTH" | grep -q \'"multiPartyConferencing":true\' && echo "[verify:ng-multiparty] true" || echo "[verify:ng-multiparty] false"',
    // NG conference media-readiness — LiveKit / SFU check (informational).
    'NG_MEDIA=$(curl -s --max-time 10 --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/api/ng/conference/media-readiness 2>/dev/null || true); echo "[verify:ng-media-readiness] $NG_MEDIA"',
    'if echo "$NG_MEDIA" | grep -q \'"configured":true\'; then echo "[verify:livekit] configured=true — SFU ready (5-10 participant conferencing enabled)"; echo "[verify:sfu-5] READY"; echo "[verify:sfu-10] READY"; else echo "[verify:livekit] configured=false — SFU NOT ready (check NG_LIVEKIT_URL/API_KEY/API_SECRET in .env)"; echo "[verify:sfu-5] NOT_READY"; echo "[verify:sfu-10] NOT_READY"; fi',
    // NG routes (informational)
    'HTTP=$(curl -s -o /dev/null -w "%{http_code}" --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/ng/conference 2>/dev/null); echo "[verify:ng-conference-route] HTTP=$HTTP"',
    'HTTP=$(curl -s -o /dev/null -w "%{http_code}" --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/ng 2>/dev/null); echo "[verify:ng-root] HTTP=$HTTP"',
    // ── Hard gate ──: NG platform must report healthy or the deploy is a failure.
    'if echo "$NG_HEALTH" | grep -q \'"status":"ok"\'; then echo "[verify:result] PASS"; else echo "[verify:result] FAIL — /api/ng/health did not report status=ok"; exit 1; fi',
  ];
}

// Wrap a phase so it emits exactly one checkpoint marker and aborts the whole
// deploy (propagating the exit code) on the first failing step.
function wrapPhase(name, steps) {
  const inner = steps.join(' && ');
  return `( ${inner} ) && echo "[deploy:check] ${name}=success" || { rc=$?; echo "[deploy:check] ${name}=failed (exit $rc)"; exit $rc; }`;
}

// Returns a single shell command whose log is guaranteed to:
//   • begin with `[deploy:id] <id>`, `[deploy:pid] <pid>`, `[deploy] start <ts>`
//     so the status endpoint can recover identity/PID even after pm2 reload
//     restarts the Node process mid-deploy;
//   • carry `[deploy:check] <phase>=success|failed` for each phase;
//   • end with exactly one terminal marker:
//       [deploy] complete   → all phases + verification gate passed
//       [deploy] failed (exit N) → some phase failed
// The supervising poller treats anything else (no terminal marker + dead PID,
// or lock timeout) as an incomplete/unknown deploy and reports failure.
function buildDeployCommand(deployId) {
  const id = String(deployId || '').replace(/[^A-Za-z0-9_.-]/g, '') || 'unknown';
  const chain = [
    wrapPhase('build', buildPhase()),
    wrapPhase('pm2', pm2Phase()),
    wrapPhase('health', healthPhase()),
    wrapPhase('ngHealth', ngHealthPhase()),
  ].join(' && ');
  // `$$` is the PID of this bash (the detached process spawned by runDetachedCommand).
  const prefix = `echo "[deploy:id] ${id}"; echo "[deploy:pid] $$"; echo "[deploy] start $(date -u +%Y-%m-%dT%H:%M:%SZ)";`;
  const rollback = [
    'restore_next_on_failure() {',
    'rc=$?;',
    `if [ "$rc" != "0" ] && [ -d ${PROJECT_ROOT}/${NEXT_PREVIOUS_DIR} ]; then`,
    `cd ${PROJECT_ROOT};`,
    'echo "[deploy:rollback] restoring previous .next";',
    'rm -rf .next.failed;',
    'if [ -d .next ]; then mv .next .next.failed; fi;',
    `mv ${NEXT_PREVIOUS_DIR} .next;`,
    'ln -sfn .next _next || true;',
    `(pm2 reload ecosystem.config.js --only ${PM2_APP_NAME} --update-env 2>/dev/null || true);`,
    'fi;',
    'exit $rc;',
    '};',
    'trap restore_next_on_failure EXIT;',
  ].join(' ');

  return `${prefix} ${rollback} ( ${chain} ) && echo "[deploy] complete $(date -u +%Y-%m-%dT%H:%M:%SZ)" || { rc=$?; echo "[deploy] failed (exit $rc) $(date -u +%Y-%m-%dT%H:%M:%SZ)"; exit $rc; }`;
}

module.exports = {
  PROJECT_ROOT,
  buildDeployCommand,
};
