'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const ts = require('typescript');
const express = require('express');
const { resolveDeploymentProfile } = require('../../lib/deploymentProfile.cjs');
const cookiePolicy = require('../utils/authCookiePolicy');
const root = path.resolve(__dirname, '../..');
const valid = { NODE_ENV: 'production', DOCTARX_PRODUCT_PROFILE: 'careops', NEXT_PUBLIC_APP_URL: 'https://care.example.org', DOCTARX_API_PROXY_TARGET: 'https://existing-api.example.org/api' };

function browserProfile(profile = 'careops') {
  const sandboxModule = { exports: {} };
  const source = fs.readFileSync(path.join(root, 'lib/careopsProfile.js'), 'utf8').replace(/export /g, '');
  vm.runInNewContext(source + '\nmodule.exports={CAREOPS_PROFILE,isCareOpsSurface,careOpsReturnPath,careOpsLoginPath,careOpsPasswordPath,careOpsNavigation};', { module: sandboxModule, process: { env: { NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE: profile } }, URL, URLSearchParams });
  return sandboxModule.exports;
}
function authSession() {
  const sandboxModule = { exports: {} }; const source = fs.readFileSync(path.join(root,'lib/authSession.js'),'utf8').replace(/export /g,'');
  vm.runInNewContext(source+'\nmodule.exports={authSessionGeneration,beginAuthSessionTransition,acquireAuthCookieWrite,isAuthCookieMutation,staleAuthSessionError,authTokenOwnerHint,assertAuthSessionConfirmed,writeAuthSessionTokens};',{module:sandboxModule,atob});
  return sandboxModule.exports;
}

test('CareOps configuration is explicit, isolated and rejects unsafe or contradictory release identity', () => {
  const main = resolveDeploymentProfile({ NODE_ENV: 'production' }); assert.equal(main.profile, 'main'); assert.equal(main.distDir, '.next'); assert.equal(main.apiProxyTarget, null);
  const careops = resolveDeploymentProfile(valid); assert.equal(careops.distDir, '.next-careops'); assert.equal(careops.apiBaseUrl, '/api'); assert.equal(careops.appOrigin, valid.NEXT_PUBLIC_APP_URL);
  for (const patch of [
    { DOCTARX_PRODUCT_PROFILE: 'unknown' }, { NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE: 'main' }, { NEXT_DIST_DIR: '.next' },
    { DOCTARX_API_PROXY_TARGET: '' }, { DOCTARX_API_PROXY_TARGET: valid.NEXT_PUBLIC_APP_URL }, { NEXT_PUBLIC_API_URL: 'https://another.example.org/api' },
    { NEXT_PUBLIC_APP_URL: 'http://care.example.org' }, { NEXT_PUBLIC_APP_URL: 'https://care.example.org/path' },
    { DOCTARX_API_PROXY_TARGET: 'https://user:secret@existing-api.example.org/api' }, { DOCTARX_API_PROXY_TARGET: 'https://existing-api.example.org/api?token=never' },
    { CAREOPS_MEDIA_ORIGINS: 'wss://*.example.org' }, { CAREOPS_MEDIA_ORIGINS: 'https://media.example.org/path' },
    { NEXT_PUBLIC_APP_URL: 'https://unprovisioned.example.invalid' },
  ]) assert.throws(() => resolveDeploymentProfile({ ...valid, ...patch }), 'Invalid deployments must fail before startup');
  assert.equal(resolveDeploymentProfile({ ...valid, NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3002', DOCTARX_API_PROXY_TARGET: 'http://127.0.0.1:18080/api' }).apiProxyTarget, 'http://127.0.0.1:18080/api');
});

test('actual Next profile config changes entry/proxy/identity without altering default main redirects or API routes', async () => {
  function load(env) {
    const sandboxModule = { exports: {} }; const actualRequire = createRequire(path.join(root, 'next.config.js'));
    const configuredRequire = name => name === './lib/deploymentProfile.cjs' ? { resolveDeploymentProfile:()=>resolveDeploymentProfile(env) } : actualRequire(name);
    vm.runInNewContext(fs.readFileSync(path.join(root, 'next.config.js'), 'utf8'), { module: sandboxModule, require: configuredRequire, process: { env }, __dirname: root, URL }); return sandboxModule.exports;
  }
    const config = load(valid);
    assert.equal(config.distDir, '.next-careops'); assert.equal(config.env.NEXT_PUBLIC_API_URL, '/api');
    assert.ok((await config.redirects()).some(row => row.source === '/' && row.destination === '/careops'));
    const rewrite = (await config.rewrites()).find(row => row.source === '/api/:path*'); assert.equal(rewrite.destination, valid.DOCTARX_API_PROXY_TARGET + '/:path*');
    const headers = (await config.headers()).find(row => row.source === '/:path*').headers;
    assert.ok(headers.some(row => row.key === 'X-Robots-Tag' && row.value === 'noindex, nofollow')); assert.ok(headers.some(row => row.key === 'Content-Security-Policy' && row.value.includes("connect-src 'self'")));
    const main = load({}); assert.equal(main.distDir, '.next'); assert.equal((await main.rewrites()).length, 0); assert.equal((await main.redirects()).some(row => row.source === '/'), false);
});

test('actual launcher records build identity, forwards stop signals and refuses failed or mismatched releases',async()=>{
  const files=new Map();const children=[];let childStatus=0;const sandboxModule={exports:{}};const actualRequire=createRequire(path.join(root,'scripts/careops-profile.cjs'));
  const startChild=new EventEmitter();const signals=[];startChild.kill=signal=>signals.push(signal);
  const fakeProcess=Object.assign(new EventEmitter(),{env:{},execPath:process.execPath});
  const fakeFs={readFileSync(file){if(!files.has(file))throw Object.assign(new Error('Missing isolated build'),{code:'ENOENT'});return files.get(file);},writeFileSync(file,value){files.set(file,value);},unlinkSync(file){if(!files.delete(file))throw Object.assign(new Error('Missing isolated build'),{code:'ENOENT'});}};
  const configuredRequire=name=>name==='node:fs'?fakeFs:name==='node:child_process'?{spawnSync(_binary,args,options){children.push({args,options});files.set(path.resolve('.next-careops','BUILD_ID'),'isolated-build-id');return{status:childStatus};},spawn(_binary,args,options){children.push({args,options});return startChild;}}:name==='../lib/deploymentProfile.cjs'?{resolveDeploymentProfile}:actualRequire(name);
  configuredRequire.resolve=actualRequire.resolve;
  vm.runInNewContext(fs.readFileSync(path.join(root,'scripts/careops-profile.cjs'),'utf8'),{module:sandboxModule,exports:sandboxModule.exports,require:configuredRequire,process:fakeProcess,console:{log(){}}});
  const {run}=sandboxModule.exports;assert.equal(run('validate',valid),0);assert.equal(children.length,0);assert.throws(()=>run('start',valid));
  assert.equal(run('build',valid),0);assert.equal(children[0].args[1],'build');assert.equal(children[0].options.env.NODE_ENV,'production');
  const running=run('start',{...valid,PORT:'3002'});assert.equal(children[1].args[1],'start');assert.equal(children[1].options.env.NEXT_DIST_DIR,'.next-careops');
  fakeProcess.emit('SIGTERM');assert.deepEqual(signals,['SIGTERM']);startChild.emit('exit',0);assert.equal(await running,0);assert.equal(fakeProcess.listenerCount('SIGTERM'),0);assert.equal(fakeProcess.listenerCount('SIGINT'),0);
  const crashed=run('start',valid);startChild.emit('exit',null,'SIGKILL');assert.equal(await crashed,1,'Unexpected child termination is a release failure');
  for(const patch of [{NEXT_PUBLIC_APP_URL:'https://changed.example.org'},{DOCTARX_API_PROXY_TARGET:'https://changed-api.example.org/api'},{DOCTARX_DEPLOYMENT_ID:'other-release'},{CAREOPS_MEDIA_ORIGINS:'wss://media.example.org'}])assert.throws(()=>run('start',{...valid,...patch}),/does not match/);
  assert.equal(children.length,3,'Mismatches never start a child/listener');
  childStatus=1;assert.equal(run('build',valid),1);assert.equal(files.has(path.resolve('.next-careops','doctarx-profile.json')),false,'A failed rebuild cannot retain an older successful attestation');
  assert.throws(()=>run('start',valid));assert.equal(children.length,4,'An incomplete release cannot start after a failed build');
});

test('auth return paths preserve bounded CareOps destinations and cannot escape or loop through auth routes', () => {
  const helpers = browserProfile();
  const destination = '/careops/delivery?facilityId=recorded-facility';
  assert.equal(helpers.careOpsReturnPath(destination), destination);
  assert.equal(new URL(helpers.careOpsLoginPath(destination, true), 'https://care.example.org').searchParams.get('returnTo'), destination);
  assert.equal(new URL(helpers.careOpsPasswordPath(destination), 'https://care.example.org').searchParams.get('returnTo'), destination);
  for (const value of ['https://evil.example/careops', '//evil.example/careops', '/careops/login', '/careops/create-password', '/careops\\evil', '/careops/%2f%2fevil.example', '/careopsx', '/careops\n']) assert.equal(helpers.careOpsReturnPath(value), '/careops');
  assert.equal(browserProfile('main').isCareOpsSurface('/patient/dashboard'), false); assert.equal(helpers.isCareOpsSurface('/'), true);
  assert.equal(helpers.careOpsNavigation([], {}).length, 0);
  assert.equal(helpers.careOpsNavigation([{ programme_role: 'phc_nurse' }], {}).map(row=>row.href).join(','), '/careops');
  assert.equal(helpers.careOpsNavigation([{ programme_role: 'government_analyst' }], { government: true, reports: true }).map(row=>row.href).join(','), '/careops/government,/careops/delivery');
  assert.equal(helpers.careOpsNavigation([{ programme_role: 'facility_admin' }], {}).map(row=>row.href).join(','), '/careops/insurance');
});

test('actual API interceptors keep expired and forced-password sessions in CareOps without password-route loops', async () => {
  const callbacks = {}; const storage = new Map(); const location = { hostname: 'care.example.org', origin: valid.NEXT_PUBLIC_APP_URL, pathname: '/careops/delivery', href: '' };
  const fakeApi = { interceptors: { request: { use(fn) { callbacks.request = fn; } }, response: { use(_success, failure) { callbacks.failure = failure; } } } };
  const sandboxModule = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/api.js'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const axios = { create(config) { assert.equal(config.baseURL, '/api'); return fakeApi; } };
  vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports, require(name) { if (name === 'axios') return axios; if (name === '@/lib/careopsProfile') return browserProfile(); if(name==='@/lib/authSession')return authSession(); throw new Error(name); }, process: { env: {} }, window: { location }, localStorage: { getItem: key=>storage.get(key), removeItem: key=>storage.delete(key) }, console });
  await assert.rejects(callbacks.failure({ config: { url: '/ng/phc/contexts' }, response: { status: 401 } }));
  assert.match(location.href, /^\/careops\/login\?/); assert.equal(new URL(location.href,'https://care.example.org').searchParams.get('session'),'expired');
  location.href = ''; await assert.rejects(callbacks.failure({ config: { url: '/ng/phc/contexts' }, response: { status: 403, data: { code: 'PASSWORD_CHANGE_REQUIRED' } } }));
  assert.match(location.href, /^\/careops\/create-password\?/);
  location.pathname = '/careops/create-password'; location.href = ''; await assert.rejects(callbacks.failure({ config: { url: '/auth/me' }, response: { status: 403, data: { code: 'PASSWORD_CHANGE_REQUIRED' } } })); assert.equal(location.href, '');
});

test('host-only auth cookie deployment preserves HttpOnly/Secure/MFA clearing and default existing domain behavior', async () => {
  assert.equal(cookiePolicy.authCookieDomain({ NODE_ENV: 'production' }), '.doctarx.com'); assert.equal(cookiePolicy.authCookieDomain({ NODE_ENV: 'production', COOKIE_DOMAIN: '.approved.example.org' }), '.approved.example.org');
  assert.throws(()=>cookiePolicy.authCookieDomain({ AUTH_COOKIE_DOMAIN_MODE: 'wildcard' }));
  const source = fs.readFileSync(path.join(root,'server/routes/auth.js'),'utf8').replace(/\r\n/g,'\n');
  const setters = source.slice(source.indexOf('const setAuthCookies ='), source.indexOf('/**\n * POST /api/auth/register'));
  const sandboxModule = { exports: {} }; vm.runInNewContext(setters+'\nmodule.exports={setAuthCookies,clearAuthCookies};', { module: sandboxModule, process: { env: { NODE_ENV: 'production', AUTH_COOKIE_DOMAIN_MODE: 'host-only' } }, authCookieDomain:()=>cookiePolicy.authCookieDomain({ NODE_ENV:'production', AUTH_COOKIE_DOMAIN_MODE:'host-only' }), legacyAuthCookieDomain:()=>'.doctarx.com' });
  const app=express(); app.post('/login',(_req,res)=>{sandboxModule.exports.setAuthCookies(res,'isolated-access','isolated-refresh');res.json({success:true});});app.post('/logout',(_req,res)=>{sandboxModule.exports.clearAuthCookies(res);res.json({success:true});});
  const server = await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  try {
    const response = await fetch('http://127.0.0.1:'+server.address().port+'/login',{method:'POST'}); const cookies=response.headers.getSetCookie();
    const current=cookies.filter(value=>!value.includes('Domain='));assert.equal(current.length,2);assert.ok(current.every(value=>/HttpOnly/.test(value)&&/Secure/.test(value)&&/SameSite=Lax/.test(value)));
    assert.ok(cookies.some(value=>value.startsWith('mfaVerified=')&&value.includes('Domain=.doctarx.com')));
    const logout=await fetch('http://127.0.0.1:'+server.address().port+'/logout',{method:'POST'});assert.equal(logout.headers.getSetCookie().length,6);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
