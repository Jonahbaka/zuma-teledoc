'use strict';
// Execute the real switch script against isolated process-manager and HTTP
// transports. No application, socket, package installer or AWS call is run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root=path.resolve(__dirname,'../..');
const bash=process.env.DEPLOY_TEST_BASH || '/bin/bash';
const bashAvailable=process.platform!=='win32' || fs.existsSync(bash);

for (const wrongBuild of [false,true]) test(`direct tunnel deployment ${wrongBuild ? 'restores the prior build when final identity differs' : 'validates candidate and switches only the named app'}`,{skip:bashAvailable ? false : 'Linux deployment script is executed in the GitHub Linux gate'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'doctarx-switch-'));
  try {
    for(const d of ['bin','.next','incoming'])fs.mkdirSync(path.join(dir,d));
    fs.writeFileSync(path.join(dir,'.next/BUILD_ID'),'old-build');fs.writeFileSync(path.join(dir,'incoming/BUILD_ID'),'new-build');
    const executable=(name,body)=>fs.writeFileSync(path.join(dir,'bin',name),`#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`,{mode:0o755});
    executable('pm2',`printf '%s %s %s\\n' "$*" "\${NEXT_DIST_DIR:-unset}" "\${PORT:-unset}" >> "$PROJECT_ROOT/pm2-commands"
if [ "$1" = jlist ]; then printf '%s' '[{"name":"doctarx","pm2_env":{"status":"online","NEXT_DIST_DIR":".next"}}]'; fi
if [ "$1" = restart ]; then printf '%s' "$NEXT_DIST_DIR" > "$PROJECT_ROOT/current-dist"; fi`);
    executable('curl',`dist=$(cat "$PROJECT_ROOT/current-dist" 2>/dev/null || echo .next)
case "$*" in *8081*) dist=.next.blue;; esac
build=$(cat "$PROJECT_ROOT/$dist/BUILD_ID")
if [ "\${TEST_WRONG_BUILD:-no}" = yes ] && [ -f "$PROJECT_ROOT/current-dist" ] && [ "$dist" = .next.blue ]; then build=unexpected-build; fi
case "$*" in */api/ng/health*) printf '%s' '{"status":"ok"}';; *) printf '{"status":"healthy","nextReady":true,"buildId":"%s"}' "$build";; esac`);
    executable('sleep','exit 0');
    const script=fs.readFileSync(path.join(root,'scripts/doctarx-blue-green-switch.sh'),'utf8').replace(/\r\n/g,'\n');
    fs.writeFileSync(path.join(dir,'switch.sh'),script);
    // A fresh PATH excludes a host nginx installation. Node remains the actual
    // JSON parser, while PM2/curl/sleep are isolated test transports.
    const nodeDir=path.dirname(process.execPath).replace(/\\/g,'/');
    const result=spawnSync(bash,['-c',`export PATH="$PROJECT_ROOT/bin:${nodeDir}:/usr/bin:/bin"; bash "$PROJECT_ROOT/switch.sh" incoming`],{cwd:dir,encoding:'utf8',timeout:15000,env:{...process.env,PROJECT_ROOT:dir.replace(/\\/g,'/'),PM2_APP_NAME:'doctarx',DEPLOY_TRANSPORT:'cloudflare-tunnel',NGINX_CONF:path.join(dir,'absent-nginx.conf'),TEST_WRONG_BUILD:wrongBuild?'yes':'no'}});
    assert.equal(result.error,undefined,result.error?.message);
    assert.equal(result.status,wrongBuild?1:0,result.stdout+'\n'+result.stderr);
    const commands=fs.readFileSync(path.join(dir,'pm2-commands'),'utf8');
    assert.match(commands,/start server\/index.js --name doctarx-deploy-check/);assert.match(commands,/restart doctarx --update-env .next.blue 8080/);
    assert.doesNotMatch(commands,/cftunnel|cloudflared|cronops|delete doctarx /);
    if(wrongBuild){assert.equal(fs.readFileSync(path.join(dir,'current-dist'),'utf8'),'.next');assert.match(commands,/restart doctarx --update-env .next 8080/);}
    else assert.equal(fs.readFileSync(path.join(dir,'.doctarx-active-port'),'utf8').trim(),'8080');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
