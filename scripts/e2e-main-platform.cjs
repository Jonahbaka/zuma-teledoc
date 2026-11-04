'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { checkVideoPreflightLayout } = require('./e2e-main-video-preflight.cjs');

const target = process.env.SIMULATION_DATABASE_URL;
if (!target || !['localhost','127.0.0.1'].includes(new URL(target).hostname) || !new URL(target).pathname.endsWith('_test')) throw new Error('Use an isolated loopback database ending in _test.');
process.env.DATABASE_URL=target;
process.env.NODE_ENV='development';
process.env.JWT_ACCESS_SECRET='doctarx-main-browser-test-access-secret-at-least-32-characters';
process.env.JWT_REFRESH_SECRET='doctarx-main-browser-test-refresh-secret-at-least-32-characters';
process.env.ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NG_AUTO_SEED_DISCOVERY='false';
process.env.NEXT_PUBLIC_API_URL='http://127.0.0.1:18081/api';
const db = require('../server/db');
const password=process.env.CAREOPS_E2E_PASSWORD;
if (!password) throw new Error('CAREOPS_E2E_PASSWORD must match the existing demo accounts; this preview never resets credentials.');
const output=path.resolve(process.env.MAIN_PLATFORM_UI_OUTPUT_DIR || 'work/main-platform-ui');
fs.mkdirSync(output,{recursive:true});
let screenshotCount = 0;

async function waitFor(url) {
  for(let attempt=0;attempt<100;attempt++) { try {if((await fetch(url)).ok)return;} catch {} await new Promise(resolve=>setTimeout(resolve,1000)); }
  throw new Error('Main platform preview did not start');
}
async function capture(page,name) {
  await page.waitForFunction(() => {
    const main=document.querySelector('main');
    if(!main) return false;
    return !main.querySelector('.animate-spin') && ![...main.querySelectorAll('[role="status"],p')].some(element=>/^Loading\b|^Checking secure access/i.test(element.textContent.trim()));
  });
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>image.decode()));});
  // Analyze the rendered state after finite tab/hover transitions settle. A
  // mid-transition sample can combine two intended color pairs into an
  // intermediate pair that is never the resting interface.
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})));});
  const small=await page.evaluate(()=>[...document.querySelectorAll('main *,header *,nav *,aside *')].filter(element=>{
    const box=element.getBoundingClientRect(),style=getComputedStyle(element);
    return box.width>2&&box.height>2&&style.visibility!=='hidden'&&style.display!=='none'&&[...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim())&&parseFloat(style.fontSize)<16;
  }).map(element=>({tag:element.tagName,text:element.textContent.trim().slice(0,70),size:getComputedStyle(element).fontSize})));
  assert.deepEqual(small,[],name+' must use readable text');
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  fs.writeFileSync(path.join(output,name+' accessibility.json'),JSON.stringify(axe.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))})),null,2));
  assert.deepEqual(axe.violations.filter(item=>['serious','critical'].includes(item.impact)),[],name+' must not have serious accessibility violations');
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
  screenshotCount++;
}

async function checkUnavailableGuidance(page, name) {
  await page.getByLabel('Your symptoms',{exact:true}).fill('Browser availability check only; no patient assessment requested.');
  await page.getByRole('button',{name:'Check optional guidance',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Optional automated symptom guidance is not connected.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Check optional guidance',exact:true}).isEnabled(),true,'Unavailable guidance must exit the pending state');
  assert.equal(await page.getByRole('link',{name:'Book a visit',exact:true}).count(),1,'Booking remains available');
  assert.equal(await page.locator('main').getByText(/SOAP|medication recommendation:|suggested medications|severity score/i).count(),0,'Unavailable guidance must not fabricate a clinical assessment');
  await capture(page,name);
}

async function checkPharmacyWorkspace(page, size) {
  const preferencePath='**/api/pharmacy/preferences';
  const prescriptionPath='**/api/prescriptions';
  const readResponse=(resource,method='GET')=>{
    const response=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/'+resource&&response.request().method()===method);
    response.catch(()=>{});
    return response;
  };
  const recordReads=Promise.all([readResponse('pharmacy/preferences'),readResponse('prescriptions')]);
  recordReads.catch(()=>{}); // Keep later assertions authoritative while navigation is pending.
  await page.goto('http://127.0.0.1:3003/patient/pharmacy');
  await page.getByRole('heading',{level:1,name:'Your pharmacies',exact:true}).waitFor();
  const [preferencesResponse,prescriptionsResponse]=await recordReads;
  assert.equal(preferencesResponse.status(),200,'Saved pharmacies must use the actual authorized API');
  assert.equal(prescriptionsResponse.status(),200,'Recorded prescriptions must use the actual authorized API');
  const preferences=await preferencesResponse.json();
  const prescriptions=await prescriptionsResponse.json();
  assert.equal(preferences.success,true);assert.ok(Array.isArray(preferences.pharmacies));
  assert.equal(prescriptions.success,true);assert.ok(Array.isArray(prescriptions.prescriptions));
  console.log('Verified: actual pharmacy and prescription reads',size);
  // A manual area performs only a directory read. It cannot save the area as a
  // patient preference, infer device coordinates, or claim stock/coverage.
  await page.getByRole('button',{name:'Change location',exact:true}).click();
  await page.getByRole('combobox').selectOption('Home');
  const city=size==='mobile'?'San Francisco':'Los Angeles';
  await page.getByLabel('City or town',{exact:true}).fill(city);
  await page.getByLabel('State or region',{exact:true}).fill('CA');
  await page.getByLabel('Postal code',{exact:true}).fill('');
  const directoryRead=readResponse('directory/pharmacies','POST');
  await page.getByRole('button',{name:'Use this area',exact:true}).click();
  const directoryResponse=await directoryRead;
  assert.equal(directoryResponse.status(),200,'Manual pharmacy lookup must use the real public registry');
  const directory=await directoryResponse.json();
  assert.equal(directory.success,true);assert.ok(Array.isArray(directory.pharmacies));
  await page.getByText('Home: '+city+', CA',{exact:true}).waitFor();
  if(directory.pharmacies.length===0) await page.getByText('No pharmacies were returned for this search. You can enter pharmacy details below.',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Pharmacy phone (optional)',{exact:true}).count(),1);
  assert.equal(await page.getByLabel('Email or fax (optional)',{exact:true}).count(),0);
  await capture(page,'DoctaRx pharmacy finder '+size);
  console.log('Verified: pharmacy finder',size);
  const checkRecords=async (tab,rows,emptyMessage,name)=>{
    await page.getByRole('button',{name:tab,exact:true}).click();
    await capture(page,name);
    assert.equal(await page.locator('main .portal-error').count(),0,tab+' must load actual records');
    if(rows.length===0) await page.getByText(emptyMessage,{exact:true}).waitFor();
    else assert.equal(await page.locator('main article').count(),rows.length,tab+' must match the actual API record count');
    console.log('Verified:',name);
  };
  await checkRecords('Saved pharmacies',preferences.pharmacies,'No pharmacy choices are saved in your account.','DoctaRx saved pharmacies '+size);
  await checkRecords('Prescriptions',prescriptions.prescriptions,'No prescriptions are recorded for your account.','DoctaRx recorded prescriptions '+size);
  // Fault injection blocks a read rather than inventing records or successful
  // transactions. Each error must remain distinct from a real empty result.
  for(const [pattern,tab,emptyMessage,name] of [
    [preferencePath,'Saved pharmacies','No pharmacy choices are saved in your account.','DoctaRx saved pharmacies unavailable '+size],
    [prescriptionPath,'Prescriptions','No prescriptions are recorded for your account.','DoctaRx recorded prescriptions unavailable '+size],
  ]) {
    const unavailable=route=>route.request().method()==='GET'?route.abort('failed'):route.continue();
    await page.route(pattern,unavailable);
    await page.goto('http://127.0.0.1:3003/patient/pharmacy');
    await page.getByRole('heading',{level:1,name:'Your pharmacies',exact:true}).waitFor();
    await page.getByRole('button',{name:tab,exact:true}).click();
    await page.getByRole('alert').filter({hasText:'These records could not be loaded. Please try again.'}).waitFor();
    assert.equal(await page.getByText(emptyMessage,{exact:true}).count(),0,'Unavailable records cannot become an empty-success claim');
    await capture(page,name);
    console.log('Verified:',name);
    await page.unroute(pattern,unavailable);
    const retryPreferences=readResponse('pharmacy/preferences'),retryPrescriptions=readResponse('prescriptions');
    await page.getByRole('button',{name:'Try again',exact:true}).click();
    const retry=await Promise.all([retryPreferences,retryPrescriptions]);
    assert.ok(retry.every(response=>response.status()===200),'Read retry must restore actual authorized API results');
    await page.waitForFunction(()=>!document.querySelector('main .portal-error')&&!document.querySelector('main .animate-spin'));
  }
  if(size==='mobile') assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Pharmacy mobile tabs must fit the viewport');
}

async function installHealthProxy(context) {
  // A two-port local preview needs the same-origin PWA check forwarded to its
  // actual database-backed API health response; never manufacture connectivity.
  await context.route('http://127.0.0.1:3003/api/health', async route => {
    const response = await context.request.get('http://127.0.0.1:18081/api/health');
    await route.fulfill({ response });
  });
}
async function main() {
  const accounts=(await db.getPool().query("SELECT email FROM users WHERE email IN ('patient@demo.doctarx.com','doctor@demo.doctarx.com') AND is_active=true")).rows;
  assert.equal(accounts.length,2,'Use the existing provisioned DoctaRx demo accounts');
  const app=express();
  app.use(cors({origin:'http://127.0.0.1:3003',credentials:true})); app.use(cookieParser()); app.use(express.json({limit:'10mb'}));
  app.get('/api/health',async (_req,res)=>{
    const health=await db.healthCheck();
    res.status(health.healthy?200:503).json({status:health.healthy?'ok':'unavailable'});
  });
  for(const [route,module] of [['auth','auth'],['appointments','appointments'],['providers','providers'],['clinical-encounters','clinicalEncounters'],['medical-records','medicalRecords'],['visits','visits'],['messages','messages'],['notifications','notifications'],['users','users'],['insurance','insurance'],['subscriptions','subscriptions'],['triage','triage'],['pharmacy','pharmacy'],['prescriptions','prescriptions'],['directory','publicDirectory']]) app.use('/api/'+route,require('../server/routes/'+module));
  app.use('/api/ng',require('../ng/routes'));
  app.use((error,_req,res,_next)=>res.status(500).json({error:error.message}));
  const server=app.listen(18081,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const log=fs.openSync(path.join(output,'main-platform-next.log'),'w');
  const next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','-p','3003','-H','127.0.0.1'],{cwd:path.join(__dirname,'..'),env:{...process.env,NEXT_DIST_DIR:'.next-main-platform-preview',DOCTARX_DISABLE_BUILD_CACHE:'true'},windowsHide:true,stdio:['ignore',log,log]});
  let browser;
  try {
    await waitFor('http://127.0.0.1:3003/patient/login');
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await installHealthProxy(context);
    context.setDefaultNavigationTimeout(90000); context.setDefaultTimeout(90000);
    const page=await context.newPage();const runtime=[];const patientWrites=[];
    page.on('request',request=>{
      const pathname=new URL(request.url()).pathname;
      if(!['GET','HEAD','OPTIONS'].includes(request.method())&&/^\/api\/(insurance|subscriptions|triage(?:-queue)?|pharmacy|prescriptions)(\/|$)/.test(pathname)) patientWrites.push({path:pathname,method:request.method()});
    });
    page.on('pageerror',error=>{runtime.push(error.message);console.error('Browser runtime:',error.message);});
    if(process.env.MAIN_PLATFORM_FOCUS==='video') {
      const conferenceWrites=[];
      page.on('request',request=>{const path=new URL(request.url()).pathname;if(!['GET','HEAD','OPTIONS'].includes(request.method())&&/\/conference(?:\/|$)/.test(path))conferenceWrites.push(path);});
      const response=await context.request.post('http://127.0.0.1:18081/api/auth/login',{data:{email:'doctor@demo.doctarx.com',password,role:'provider'}});
      assert.equal(response.ok(),true);const session=await response.json();assert.equal(session.success,true);
      await page.addInitScript(session=>{localStorage.setItem('accessToken',session.accessToken);localStorage.setItem('refreshToken',session.refreshToken);localStorage.setItem('user',JSON.stringify(session.user));},session);
      for(const width of [1440,390]) {
        await page.setViewportSize({width,height:width===390?844:1000});
        await page.goto('http://127.0.0.1:3003/ng/provider/call');
        await page.getByRole('button',{name:'Start New Consultation',exact:true}).waitFor();
        await checkVideoPreflightLayout(page);
        await capture(page,'DoctaRx video preflight '+(width===390?'mobile':'desktop'));
      }
      assert.deepEqual(runtime,[]);assert.deepEqual(conferenceWrites,[]);
      console.log(JSON.stringify({passed:true,focus:'video',screenshots:screenshotCount,accountSeeding:false,conferenceWrites:0,captionDeviceOverlap:false,deviceClipping:false}));
      await context.close();return;
    }
    if(process.env.MAIN_PLATFORM_FOCUS==='pharmacy') {
      page.on('request',request=>{const pathname=new URL(request.url()).pathname;if(/^\/api\/(pharmacy\/preferences|prescriptions)$/.test(pathname))console.log('Pharmacy read request:',request.method(),pathname);});
      page.on('response',response=>{const pathname=new URL(response.url()).pathname;if(/^\/api\/(pharmacy\/preferences|prescriptions)$/.test(pathname))console.log('Pharmacy read response:',response.status(),pathname);});
      const response=await context.request.post('http://127.0.0.1:18081/api/auth/login',{data:{email:'patient@demo.doctarx.com',password,role:'patient'}});
      assert.equal(response.ok(),true);const session=await response.json();assert.equal(session.success,true);
      await page.addInitScript(session=>{localStorage.setItem('accessToken',session.accessToken);localStorage.setItem('refreshToken',session.refreshToken);localStorage.setItem('user',JSON.stringify(session.user));},session);
      try { await checkPharmacyWorkspace(page,'desktop');await page.setViewportSize({width:390,height:844});await checkPharmacyWorkspace(page,'mobile'); }
      catch(error) {console.error('Pharmacy check location:',new URL(page.url()).pathname);console.error('Pharmacy check headings:',await page.getByRole('heading').allTextContents());throw error;}
      assert.deepEqual(patientWrites,[]);assert.deepEqual(runtime,[]);
      console.log(JSON.stringify({passed:true,focus:'pharmacy',screenshots:screenshotCount,accountSeeding:false,patientWrites:0}));
      await context.close();return;
    }
    await page.goto('http://127.0.0.1:3003/patient/login'); await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
    const apiHealth=await page.evaluate(async()=>{const response=await fetch('/api/health',{cache:'no-store'});return {status:response.status,body:await response.json()};});
    assert.deepEqual(apiHealth,{status:200,body:{status:'ok'}},'PWA connectivity must come from the actual database-backed API');
    await capture(page,'DoctaRx sign-in desktop');
    await page.goto('http://127.0.0.1:3003/ng/patient/login');
    await page.getByLabel('Email',{exact:true}).fill('patient@demo.doctarx.com'); await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click(); await page.waitForURL('**/ng/patient');
    for(const [url,heading,name] of [
      ['/ng/patient',/^Welcome/,'DoctaRx patient home desktop'],
      ['/ng/patient/appointments/book',/Book Consultation/,'DoctaRx booking desktop'],
      ['/ng/patient/appointments',/^Visits$/,'DoctaRx visits desktop'],
      ['/ng/patient/records',/^Health records$/,'DoctaRx health records desktop'],
      ['/ng/patient/prescriptions',/^Prescriptions$/,'DoctaRx prescriptions desktop'],
      ['/ng/patient/messages',/Messages and support/,'DoctaRx messages desktop'],
      ['/ng/patient/consultation-billing',/Consultation payments/,'DoctaRx billing desktop'],
      ['/patient/wallet',/^Insurance and benefits$/,'DoctaRx insurance desktop'],
      ['/patient/triage',/^Symptom guidance$/,'DoctaRx symptom guidance desktop']
    ]) { await page.goto('http://127.0.0.1:3003'+url);await page.getByRole('heading',{level:1,name:heading,exact:true}).waitFor();await capture(page,name);assert.equal(await page.locator('main .portal-error').count(),0,name+' must load actual data');console.log('Verified:',name); }
    await checkUnavailableGuidance(page,'DoctaRx unavailable symptom guidance desktop');
    await checkPharmacyWorkspace(page,'desktop');
    await page.setViewportSize({width:390,height:844});
    for(const [url,name] of [['/ng/patient','DoctaRx patient home mobile'],['/ng/patient/appointments/book','DoctaRx booking mobile'],['/patient/wallet','DoctaRx insurance mobile'],['/patient/triage','DoctaRx symptom guidance mobile']]) {
      await page.goto('http://127.0.0.1:3003'+url);await capture(page,name);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' must fit mobile width');
    }
    await checkUnavailableGuidance(page,'DoctaRx unavailable symptom guidance mobile');
    await checkPharmacyWorkspace(page,'mobile');
    assert.deepEqual(patientWrites,[],'Patient preview must not mutate insurance, pharmacy, prescriptions, or symptoms');
    await page.goto('http://127.0.0.1:3003/ng/patient/appointments/book');await page.getByRole('heading',{level:1,name:/Book Consultation/}).waitFor();
    await page.getByRole('button',{name:'Open patient menu',exact:true}).click();await page.getByRole('button',{name:'Close patient navigation',exact:true}).waitFor();await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button',{name:'Open patient navigation',exact:true}).getAttribute('aria-expanded'),'false');
    await context.close();
    const provider=await browser.newContext({viewport:{width:1440,height:1000}});await installHealthProxy(provider);provider.setDefaultNavigationTimeout(90000);provider.setDefaultTimeout(90000);const providerPage=await provider.newPage();providerPage.on('pageerror',error=>{runtime.push(error.message);console.error('Provider runtime:',error.message);});
    // API authentication still verifies the existing account. Provider UI invite
    // and credential-rotation paths are preserved, not reseeded for a preview.
    const response=await provider.request.post('http://127.0.0.1:18081/api/auth/login',{data:{email:'doctor@demo.doctarx.com',password,role:'provider'}});assert.equal(response.ok(),true);const session=await response.json();assert.equal(session.success,true);
    await providerPage.addInitScript(session=>{localStorage.setItem('accessToken',session.accessToken);localStorage.setItem('refreshToken',session.refreshToken);localStorage.setItem('user',JSON.stringify(session.user));},session);
    await providerPage.goto('http://127.0.0.1:3003/ng/provider/dashboard');await providerPage.getByRole('heading',{name:'Your day in care',exact:true}).waitFor();await capture(providerPage,'DoctaRx provider home desktop');
    assert.equal(await providerPage.locator('main .portal-error').count(),0,'Provider data must load');
    await providerPage.goto('http://127.0.0.1:3003/ng/provider/visits');await providerPage.getByRole('heading',{level:1,name:'Clinical notes',exact:true}).waitFor();await capture(providerPage,'DoctaRx clinical notes desktop');
    for (const [path,title,name] of [['appointments','Appointments','DoctaRx provider appointments desktop'],['prescriptions','Prescriptions','DoctaRx provider prescriptions desktop'],['referrals','Referrals','DoctaRx provider referrals desktop']]) {
      await providerPage.goto('http://127.0.0.1:3003/ng/provider/'+path);
      await providerPage.getByRole('heading',{level:1,name:title,exact:true}).waitFor();
      await capture(providerPage,name);
      assert.equal(await providerPage.locator('main .portal-error').count(),0,name+' must load actual data');
      console.log('Verified:',name);
    }
    await providerPage.goto('http://127.0.0.1:3003/ng/provider/call');
    await providerPage.getByRole('button',{name:'Start New Consultation',exact:true}).waitFor();
    await checkVideoPreflightLayout(providerPage);
    await capture(providerPage,'DoctaRx video preflight desktop');
    await providerPage.setViewportSize({width:390,height:844});
    await checkVideoPreflightLayout(providerPage);
    await capture(providerPage,'DoctaRx video preflight mobile');
    await providerPage.setViewportSize({width:1440,height:1000});
    await providerPage.getByRole('button',{name:'Return to Dashboard',exact:true}).click();
    await providerPage.waitForURL('**/ng/provider/dashboard');
    await providerPage.setViewportSize({width:390,height:844});await providerPage.goto('http://127.0.0.1:3003/ng/provider/dashboard');await capture(providerPage,'DoctaRx provider home mobile');
    assert.equal(await providerPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Provider mobile width');
    assert.deepEqual(runtime,[],'Main platform must not have uncaught browser errors');await provider.close();
    console.log(JSON.stringify({passed:true,accountSeeding:false,patientWrites:patientWrites.length,screenshots:screenshotCount,patientSignIn:true,providerSignIn:true,typographyMinimum:16,mobileWidth:true,keyboardMenu:true,accessibility:true,videoPreflight:true,insuranceRead:true,unavailableGuidance:true,pharmacyReads:true,pharmacyUnavailableReads:true,apiHealth:true}));
  } finally { if(browser)await browser.close();next.kill();fs.closeSync(log);await new Promise(resolve=>server.close(resolve));await db.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
