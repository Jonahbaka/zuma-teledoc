const PROJECT_ROOT = '/home/ec2-user/zuma-teledoc';
const CRONOPS_ROOT = `${PROJECT_ROOT}/cronops`;
const DEPLOY_BUILD_MEMORY_MB = process.env.DEPLOY_BUILD_MEMORY_MB || '1536';

function buildDeployCommand() {
  return [
    `cd ${PROJECT_ROOT}`,
    // Production checkout should match origin/main exactly before building.
    'rm -f .git/index.lock',
    'git fetch --prune origin main',
    'git reset --hard origin/main',
    // Preserve production-only secrets and certificates that are intentionally untracked.
    'git clean -fd -e .env -e .env.* -e global-bundle.pem -e *.pem',
    'npm install --include=dev --prefer-offline --no-audit --no-fund',
    'rm -rf .turbo',
    'node ng/migrations/migrate.js',
    'node ng/scripts/ingest-doctarx-nigeria-pack.js',
    `NODE_OPTIONS="--max-old-space-size=${DEPLOY_BUILD_MEMORY_MB}" npm run build`,
    'ln -sfn .next _next || true',
    "sudo find /etc/nginx -name '*.conf' -exec grep -l '_next' {} \\; 2>/dev/null | xargs -r sudo sed -i 's|/home/ubuntu/zuma-teledoc|/home/ec2-user/zuma-teledoc|g' 2>/dev/null || true",
    'sudo nginx -t 2>&1 && sudo nginx -s reload 2>&1 || true',
    'pm2 delete doctarx cronops 2>/dev/null || true',
    // The bracketed pattern avoids killing this deploy shell while matching stale node server processes.
    'pkill -9 -f "[n]ode server" || true',
    'sleep 1',
    'pm2 start npm --name doctarx -- start',
    `pm2 start npm --name cronops --cwd ${CRONOPS_ROOT} -- run start:prod`,
  ].join(' && ');
}

module.exports = {
  PROJECT_ROOT,
  buildDeployCommand,
};
