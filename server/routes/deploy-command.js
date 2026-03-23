const PROJECT_ROOT = '/home/ec2-user/zuma-teledoc';
const DEPLOY_BUILD_MEMORY_MB = process.env.DEPLOY_BUILD_MEMORY_MB || '1536';

function buildDeployCommand() {
  return [
    `cd ${PROJECT_ROOT}`,
    // Stop stale processes before rebuilding so Next can replace .next safely.
    'pkill -9 -f "node server" || true',
    'sleep 2',
    'git pull --ff-only origin main',
    'npm install --prefer-offline --no-audit --no-fund',
    'rm -rf .next .turbo',
    `NODE_OPTIONS="--max-old-space-size=${DEPLOY_BUILD_MEMORY_MB}" npm run build`,
    'ln -sfn .next _next || true',
    "sudo find /etc/nginx -name '*.conf' -exec grep -l '_next' {} \\; 2>/dev/null | xargs -r sudo sed -i 's|/home/ubuntu/zuma-teledoc|/home/ec2-user/zuma-teledoc|g' 2>/dev/null || true",
    'sudo nginx -t 2>&1 && sudo nginx -s reload 2>&1 || true',
    'pm2 delete doctarx cronops 2>/dev/null || true',
    'sleep 1',
    'pm2 start npm --name doctarx -- start',
    'pm2 start npm --name cronops -- run cronops',
  ].join(' && ');
}

module.exports = {
  PROJECT_ROOT,
  buildDeployCommand,
};
