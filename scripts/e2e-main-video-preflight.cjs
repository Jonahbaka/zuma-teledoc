'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

async function checkVideoPreflightLayout(page) {
  const video=page.locator('video');
  const card=video.locator('..').locator('..');
  const caption=card.locator(':scope > div').first();
  const status=page.locator('p').filter({hasText:/^Camera (unavailable|is off)$/});
  const microphone=page.getByRole('button',{name:/^(Mute|Enable) microphone on join$/});
  const camera=page.getByRole('button',{name:/^Turn camera (off|on)$/});
  const [captionBox,statusBox,microphoneBox,cameraBox,videoBox,cardBox]=await Promise.all([caption.boundingBox(),status.boundingBox(),microphone.boundingBox(),camera.boundingBox(),video.boundingBox(),card.boundingBox()]);
  assert.ok(captionBox&&statusBox&&microphoneBox&&cameraBox&&videoBox&&cardBox,'Preflight caption, unavailable status and device controls must be present');
  assert.match(await caption.textContent(),/\(You\)/);
  assert.ok(captionBox.y+captionBox.height<=videoBox.y+1,'Provider caption must sit above the video');
  assert.ok(microphoneBox.y>=videoBox.y+videoBox.height-1,'Microphone control must sit below the preview');
  assert.ok(cameraBox.y>=videoBox.y+videoBox.height-1,'Camera control must sit below the preview');
  for(const button of [microphoneBox,cameraBox])assert.ok(button.x>=cardBox.x&&button.x+button.width<=cardBox.x+cardBox.width&&button.y>=cardBox.y&&button.y+button.height<=cardBox.y+cardBox.height,'Every device control must be fully visible within the camera card');
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  const boxes=[captionBox,statusBox,microphoneBox,cameraBox];
  for(let first=0;first<boxes.length;first++)for(let second=first+1;second<boxes.length;second++)assert.equal(overlaps(boxes[first],boxes[second]),false,'Preflight name, camera status and device buttons must not overlap');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Preflight must fit the viewport');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('video,audio')].some(element=>element.srcObject)),false,'Permission-denied preview must not attach a live stream');
}

async function main() {
  // This focused check reuses the already-running isolated main preview. It
  // never starts a second Next process, resets an account, or joins a room.
  const target=process.env.SIMULATION_DATABASE_URL;
  assert.ok(target&&['localhost','127.0.0.1'].includes(new URL(target).hostname)&&new URL(target).pathname.endsWith('_test'),'Use an isolated loopback _test database');
  const password=process.env.CAREOPS_E2E_PASSWORD;
  assert.ok(password,'Use the existing provider credential supplied through the environment');
  const output=path.resolve(process.env.MAIN_PLATFORM_UI_OUTPUT_DIR||'work/main-platform-ui');
  const browser=await chromium.launch({headless:true});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    context.setDefaultTimeout(90000);context.setDefaultNavigationTimeout(90000);
    const response=await context.request.post('http://127.0.0.1:18081/api/auth/login',{data:{email:'doctor@demo.doctarx.com',password,role:'provider'}});
    assert.equal(response.ok(),true);const session=await response.json();assert.equal(session.success,true);
    await context.route('http://127.0.0.1:3003/api/health',async route=>{const health=await context.request.get('http://127.0.0.1:18081/api/health');await route.fulfill({response:health});});
    const page=await context.newPage();const runtime=[];const writes=[];
    page.on('pageerror',error=>runtime.push(error.message));
    page.on('request',request=>{if(!['GET','HEAD','OPTIONS'].includes(request.method())&&/\/conference(?:\/|$)/.test(new URL(request.url()).pathname))writes.push(new URL(request.url()).pathname);});
    await page.addInitScript(session=>{localStorage.setItem('accessToken',session.accessToken);localStorage.setItem('refreshToken',session.refreshToken);localStorage.setItem('user',JSON.stringify(session.user));},session);
    await page.goto('http://127.0.0.1:3003/ng/provider/call');
    await page.getByRole('button',{name:'Start New Consultation',exact:true}).waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await checkVideoPreflightLayout(page);
    const small=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(element=>{const box=element.getBoundingClientRect(),style=getComputedStyle(element);return box.width>2&&box.height>2&&style.visibility!=='hidden'&&style.display!=='none'&&[...element.childNodes].some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim())&&parseFloat(style.fontSize)<16;}).map(element=>({tag:element.tagName,text:element.textContent.trim().slice(0,70),size:getComputedStyle(element).fontSize})));
    assert.deepEqual(small,[],'Preflight must use readable text');
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    fs.writeFileSync(path.join(output,'DoctaRx video preflight mobile accessibility.json'),JSON.stringify(axe.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))})),null,2));
    assert.deepEqual(axe.violations.filter(item=>['serious','critical'].includes(item.impact)),[]);
    await page.screenshot({path:path.join(output,'DoctaRx video preflight mobile.png'),fullPage:true});
    assert.deepEqual(writes,[]);assert.deepEqual(runtime,[]);
    console.log(JSON.stringify({passed:true,screenshots:1,providerAuthentication:true,accountSeeding:false,conferenceWrites:0,videoPreflightMobile:true,captionDeviceOverlap:false,typographyMinimum:16,accessibility:true}));
    await context.close();
  } finally {await browser.close();}
}

module.exports={checkVideoPreflightLayout};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
