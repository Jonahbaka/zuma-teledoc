const PROJECT_ROOT = '/home/ec2-user/zuma-teledoc';
const CRONOPS_ROOT = `${PROJECT_ROOT}/cronops`;
const DEPLOY_BUILD_MEMORY_MB = process.env.DEPLOY_BUILD_MEMORY_MB || '1536';
const PM2_APP_NAME = process.env.PM2_APP_NAME || 'zuma-teledoc';

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
    'rm -rf .turbo .next _next public/_next',
    'npm run migrate',
    'node ng/migrations/migrate.js',
    'node ng/scripts/ingest-doctarx-nigeria-pack.js',
    `NODE_OPTIONS="--max-old-space-size=${DEPLOY_BUILD_MEMORY_MB}" npm run build`,
    'test -n "$(find .next/static/chunks/app -path \'*/admin/testing-links/page-*.js\' -print -quit)"',
    '(ln -sfn .next _next || true)',
    '(rm -rf public/_next || true)',
    '(rm -rf .next/_next && mkdir -p .next/_next && ln -sfn ../static .next/_next/static || true)',
    '(rm -rf .next/static/_next && mkdir -p .next/static/_next && ln -sfn .. .next/static/_next/static || true)',
    '(rm -rf .next/static/chunks/_next && mkdir -p .next/static/chunks/_next/static && ln -sfn ../.. .next/static/chunks/_next/static/chunks || true)',
    "(sudo mkdir -p /home/ubuntu 2>/dev/null && sudo ln -sfn /home/ec2-user/zuma-teledoc /home/ubuntu/zuma-teledoc 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l '_next' {} \\; 2>/dev/null | xargs -r sudo sed -i 's|/home/ubuntu/zuma-teledoc|/home/ec2-user/zuma-teledoc|g' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l 'location[[:space:]]*/_next/static' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+/_next/static/?\\s*\\{[^}]*\\}#location /_next/static/ {\\n    alias /home/ec2-user/zuma-teledoc/.next/static/;\\n    expires 1y;\\n    access_log off;\\n    add_header Cache-Control \"public, immutable\";\\n}#sg' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l '_next/static' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+(?:\\^~\\s+)?/_next/static/?\\s*\\{[^}]*\\}#location ^~ /_next/static/ {\\n    alias /home/ec2-user/zuma-teledoc/.next/static/;\\n    expires 1y;\\n    access_log off;\\n    add_header Cache-Control \"public, immutable\";\\n}#sg' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l 'location.*_next' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+(?:\\^~\\s+)?/_next/\\s*\\{[^}]*\\}#location ^~ /_next/ {\\n    alias /home/ec2-user/zuma-teledoc/.next/;\\n    expires 1y;\\n    access_log off;\\n    add_header Cache-Control \"public, immutable\";\\n}#sg' 2>/dev/null || true)",
    "(sudo find /etc/nginx -name '*.conf' -exec grep -l 'server_name.*doctarx' {} \\; 2>/dev/null | xargs -r sudo perl -0pi -e 's#location\\s+(?:=\\s+|~\\*?\\s+|\\^~\\s+)?[^\\{]*_next[^\\{]*\\{[^}]*\\}\\s*##sg; s#(server_name[^;]*doctarx[^;]*;)#$1\\n    location ^~ /_next/static/ {\\n        alias /home/ec2-user/zuma-teledoc/.next/static/;\\n        expires 1y;\\n        access_log off;\\n        add_header Cache-Control \"public, immutable\";\\n    }\\n    location ^~ /_next/ {\\n        alias /home/ec2-user/zuma-teledoc/.next/;\\n        expires 1y;\\n        access_log off;\\n        add_header Cache-Control \"public, immutable\";\\n    }\\n#sg' 2>/dev/null || true)",
    '(sudo nginx -t 2>&1 && sudo nginx -s reload 2>&1 || true)',
    '(pm2 delete doctarx 2>/dev/null || true)',
    'sleep 1',
    `(pm2 restart ${PM2_APP_NAME} --update-env || pm2 start npm --name ${PM2_APP_NAME} -- start)`,
    `(pm2 restart cronops --update-env || pm2 start npm --name cronops --cwd ${CRONOPS_ROOT} -- run start:prod)`,
    'echo "[deploy] complete"',
  ].join(' && ');
}

module.exports = {
  PROJECT_ROOT,
  buildDeployCommand,
};
