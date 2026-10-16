'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { resolveDeploymentProfile } = require('../lib/deploymentProfile.cjs');

function run(action, env = process.env) {
  if (!['validate', 'build', 'start'].includes(action)) throw new Error('Choose validate, build or start.');
  const runtime = { ...env, DOCTARX_PRODUCT_PROFILE: 'careops', NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE: 'careops' };
  const profile = resolveDeploymentProfile(runtime, { production: true });
  runtime.NODE_ENV = 'production'; runtime.NEXT_DIST_DIR = profile.distDir; runtime.NEXT_PUBLIC_API_URL = '/api';
  const buildFile = path.resolve(profile.distDir, 'doctarx-profile.json');
  const identity = { profile: profile.profile, deploymentId: profile.deploymentId, appOrigin: profile.appOrigin, apiProxyTarget: profile.apiProxyTarget, mediaOrigins: profile.mediaOrigins.join(',') };
  if (action === 'validate') { console.log(JSON.stringify({ valid: true, profile: profile.profile, deploymentId: profile.deploymentId, distDir: profile.distDir, apiMode: 'same-origin-shared-backend' })); return 0; }
  if (action === 'start') {
    const recorded = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
    const buildId = fs.readFileSync(path.resolve(profile.distDir, 'BUILD_ID'), 'utf8').trim();
    if (Object.entries(identity).some(([key, value]) => recorded[key] !== value) || recorded.buildId !== buildId) throw new Error('CareOps runtime configuration does not match its built release. Rebuild this profile before starting.');
  }
  const port = Number(runtime.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid listening port.');
  if (action === 'build') {
    try { fs.unlinkSync(buildFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (action === 'start') {
    const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--port',String(port),'--hostname',runtime.CAREOPS_HOST||'0.0.0.0'],{env:runtime,stdio:'inherit',windowsHide:true});
    return new Promise((resolve,reject)=>{
      let stopSignal;
      const interrupt=()=>{stopSignal='SIGINT';child.kill(stopSignal);};const terminate=()=>{stopSignal='SIGTERM';child.kill(stopSignal);};
      const cleanup=()=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);};
      process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
      child.once('error',error=>{cleanup();reject(error);});
      child.once('exit',(code,signal)=>{cleanup();resolve(code ?? (signal && signal===stopSignal ? 0 : 1));});
    });
  }
  const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), action, ...(action === 'start' ? ['--port', String(port), '--hostname', runtime.CAREOPS_HOST || '0.0.0.0'] : [])], { env: runtime, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) return result.status || 1;
  if (action === 'build') fs.writeFileSync(buildFile, JSON.stringify({ ...identity, buildId: fs.readFileSync(path.resolve(profile.distDir, 'BUILD_ID'), 'utf8').trim() }, null, 2) + '\n');
  return 0;
}

if (require.main === module) {
  Promise.resolve().then(()=>run(process.argv[2])).then(code=>{process.exitCode=code;}).catch(error=>{
    console.error(error.code === 'DEPLOYMENT_PROFILE_INVALID' ? error.message : 'CareOps profile validation/start failed. Check the approved configuration and built release.'); process.exitCode=1;
  });
}
module.exports = { run };
