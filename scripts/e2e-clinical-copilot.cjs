#!/usr/bin/env node
'use strict';

// Mandatory synthetic browser regression. Generation transport alone is routed
// to drafts created by the real service with an injected, no-network model.
// Review, protected storage, canonical notes and tasks use the actual backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const { fixtureTargetSafety } = require('../ng/scripts/fixtureTargetSafety');
const safety = fixtureTargetSafety();
assert.equal(safety.skipped, false, safety.reason);
assert.ok(!process.env.SIMULATION_DATABASE_URL || process.env.SIMULATION_DATABASE_URL === process.env.DATABASE_URL);
process.env.CLINICAL_AI_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.CLINICAL_AI_KILL_SWITCH = 'false';
// Synthetic peer-media stays on loopback; no public STUN/TURN service is used.
process.env.WEBRTC_ICE_SERVERS_JSON = JSON.stringify([{ urls: 'stun:127.0.0.1:9' }]);
const { getPool, close } = require('../server/db');
const { seedDemoAccounts } = require('../ng/scripts/seed-demo-accounts');
const workflow = require('../ng/services/phc/phcWorkflowService');
const scope = require('../ng/services/phc/programmeScopeService');
const ai = require('../ng/services/phc/clinicalAiService');
const BASE = 'http://127.0.0.1:8080';
// Existing root-layout font stylesheet is a named offline static fixture only.
// No remote font request is sent; every other external request still fails.
const OFFLINE_FONT_STYLESHEET = 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Instrument+Serif:ital@0;1&display=swap';
function isOfflineFontFixture(requestUrl, method, resourceType) {
  return requestUrl === OFFLINE_FONT_STYLESHEET && method === 'GET' && resourceType === 'stylesheet';
}
const ART = path.join(__dirname, '../artifacts/government-browser/clinical-copilot');
fs.mkdirSync(ART, { recursive: true });
const request = { ip: '127.0.0.1', headers: { 'user-agent': 'synthetic-copilot-browser' } };
const PASSWORD = 'Demo12345678!';
const evidence = { syntheticOnly: true, mockedEndpoints: ['POST /api/ng/phc/ai/suggestions'], offlineStaticFixtures: [], checks: [] };
const pass = name => { evidence.checks.push(name); console.log(`COPILOT PASS: ${name}`); };
let child, browser, context, page, pool;
let stopping = false;
function assertRunning() { if (stopping) throw new Error('Browser run cancelled'); }
let unblockGeneration = () => {};
let signalRouteFailure;
const routeFailure = new Promise((_resolve, reject) => { signalRouteFailure = reject; });
const childLog = fs.createWriteStream(path.join(ART, 'server.log'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function startServer() {
  assertRunning();
  // Never reuse an unknown process/server against the synthetic database.
  try { await fetch(`${BASE}/readyz`, { signal: AbortSignal.timeout(1000) }); throw new Error('Port 8080 is already occupied'); }
  catch (error) { if (error.message === 'Port 8080 is already occupied') throw error; }
  assertRunning();
  child = spawn(process.execPath, ['server/index.js'], { cwd: path.join(__dirname, '..'), detached: true,
    env: { ...process.env, NODE_ENV: 'production', PORT: '8080', DISABLE_SCHEDULERS: 'true', NG_AUTO_SEED_DISCOVERY: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(childLog, { end: false }); child.stderr.pipe(childLog, { end: false });
  let spawnError; child.on('error', error => { spawnError = error; });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    assertRunning();
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Owned backend exited: ${child.exitCode}`);
    try { if ((await fetch(`${BASE}/readyz`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch { /* readiness not yet established */ }
    await delay(500);
  }
  throw new Error('Owned backend did not become ready within 180 seconds');
}
async function main() {
  pool = getPool();
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, safety.target.database);
  pool = getPool();
  const actual = fixtureTargetSafety({ pool }); assert.equal(actual.skipped, false, actual.reason);
  const seeded = await seedDemoAccounts({ pool, password: PASSWORD, mfaSecret: 'JBSWY3DPEHPK3PXP' });
  assert.ok(seeded.demoProgramme);
  const accounts = (await pool.query('SELECT id,email,role,is_test_account,first_name,last_name FROM users WHERE email=ANY($1::text[])',
    [['doctor@demo.doctarx.com', 'nurse@demo.doctarx.com', 'patient@demo.doctarx.com']])).rows;
  assert.ok(accounts.length === 3 && accounts.every(account => account.is_test_account));
  const doctor = accounts.find(account => account.email.startsWith('doctor@'));
  const nurse = accounts.find(account => account.email.startsWith('nurse@'));
  const patient = accounts.find(account => account.role === 'patient');
  const input = { programmeId: seeded.demoProgramme.programmeId, facilityId: seeded.demoProgramme.facilityId };
  const dc = await scope.assertProgrammeScope(pool, doctor, { ...input, allowedRoles: ['remote_clinician'] });
  const nc = await scope.assertProgrammeScope(pool, nurse, { ...input, allowedRoles: ['phc_nurse'] });
  assert.equal(dc.demo_only, true);
  await pool.query(`UPDATE public_health_programmes SET settings_json=settings_json || '{"clinicalAiEnabled":true}'::jsonb WHERE id=$1 AND demo_only=TRUE`, [dc.programme_id]);
  const cases = [];
  for (const suffix of ['A', 'B']) {
    assertRunning();
    const complaint = `Synthetic browser documentation ${suffix} ${crypto.randomUUID()}`;
    const encounter = await workflow.createEncounter(pool, request, nc, { patientUserId: patient.id, chiefComplaint: complaint, reasonForVisit: complaint,
      identityVerified: true, identityVerificationMethod: 'synthetic_fixture', idempotencyKey: crypto.randomUUID() });
    const queue = await workflow.enqueueEncounter(pool, request, nc, { encounterId: encounter.id, priority: 'routine', priorityScore: 50, idempotencyKey: crypto.randomUUID() });
    await workflow.claimQueueEntry(pool, request, dc, { queueEntryId: queue.id });
    const output = { summary: complaint, handoverDraft: complaint, missingInformation: [], uncertainties: [],
      assertions: [{ text: complaint, sourceRefs: ['encounter:chief_complaint'] }],
      soapDraft: { subjective: complaint, objective: '', assessment: '', plan: '' },
      followUpDrafts: [{ title: `Synthetic documentation check ${suffix}`, instructions: 'Review synthetic documentation.', sourceRefs: ['encounter:chief_complaint'] }] };
    const draft = await ai.createSuggestion(pool, request, dc, { encounterId: encounter.id, suggestionType: 'soap_draft' }, async () => ({
      text: JSON.stringify(output), provider: 'synthetic-browser-test', model: 'no-network-fixture', modelVersion: '1' }));
    cases.push({ encounter, draft, complaint });
  }
  await startServer();
  assertRunning();
  browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const login = await context.request.post('/api/auth/login', { data: { email: doctor.email, password: PASSWORD, role: 'provider' } });
  assert.equal(login.ok(), true, `Synthetic login failed ${login.status()}`);
  const session = await login.json(); assert.equal(session.success, true);
  await context.addInitScript(({ accessToken, refreshToken, user }) => {
    localStorage.setItem('accessToken', accessToken); localStorage.setItem('refreshToken', refreshToken); localStorage.setItem('user', JSON.stringify(user));
  }, { accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user });
  const external = [], pageErrors = [], writes = [];
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', req => { if (req.method() !== 'GET' && /\/api\/(ng\/phc\/(follow-ups|ai\/suggestions\/[^/]+\/review)|clinical-encounters)/.test(req.url())) writes.push({ url: req.url(), body: req.postDataJSON() }); });
  let generationError = true, holdGeneration = false;
  const generationHeld = deferred(), generationRelease = deferred();
  unblockGeneration = generationRelease.resolve;
  await context.route('**/*', async route => {
    try {
    if (stopping) return await route.abort('aborted');
    const url = new URL(route.request().url());
    if (isOfflineFontFixture(url.href, route.request().method(), route.request().resourceType())) {
      evidence.offlineStaticFixtures.push('Root-layout Google Fonts stylesheet replaced with empty local CSS; system font fallback');
      return await route.fulfill({ status: 200, contentType: 'text/css', body: '/* Offline synthetic browser fixture: system fonts only. */' });
    }
    if (url.origin !== BASE) { external.push(url.href); return await route.abort('blockedbyclient'); }
    if (url.pathname === '/api/ng/phc/ai/suggestions' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      assert.equal(body.suggestionType, 'soap_draft');
      const item = cases.find(candidate => candidate.encounter.id === body.encounterId); assert.ok(item);
      if (generationError) { generationError = false; return await route.fulfill({ status: 503, json: { success: false, error: 'Synthetic model temporarily unavailable' } }); }
      if (holdGeneration && item === cases[0]) { generationHeld.resolve(); await waitForSignal(generationRelease.promise, 'release generation'); assertRunning(); }
      return await route.fulfill({ status: 201, json: { success: true, suggestion: item.draft } });
    }
    return await route.continue();
    } catch (error) {
      (evidence.routeErrors ||= []).push(error.stack || String(error));
      signalRouteFailure(error);
      await route.abort('failed').catch(() => {});
    }
  });
  const [a, b] = cases;
  const openWorkspace = async () => {
    await page.goto('/ng/phc', { waitUntil: 'networkidle' });
    await page.getByLabel('Clinical draft type').selectOption('soap_draft');
    await page.getByRole('tab', { name: /queue/i }).click();
  };
  const generateButton = item => page.locator('div.grid').filter({ has: page.getByText(item.complaint, { exact: false }) }).filter({ has: page.getByRole('button', { name: 'AI draft', exact: true }) }).last().getByRole('button', { name: 'AI draft', exact: true });
  await openWorkspace();
  await generateButton(a).click();
  await expect(page.getByText('Synthetic model temporarily unavailable', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept edited draft' })).toHaveCount(0);
  pass('generation failure remains actionable and does not expose an acceptance control');
  await generateButton(a).click();
  await page.getByLabel('Assessment', { exact: true }).fill('Clinician edited synthetic assessment.');
  await page.getByLabel('Follow-up instructions', { exact: true }).fill('Clinician edited synthetic follow-up.');
  await page.getByRole('button', { name: 'Accept edited draft', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open chart to import reviewed SOAP' })).toBeVisible();
  const reviewWrite = writes.find(write => write.url.endsWith(`/${a.draft.id}/review`));
  assert.equal(reviewWrite.body.decision, 'accepted_with_edits');
  assert.equal(reviewWrite.body.expectedEncounterId, a.encounter.id);
  assert.equal(Number((await pool.query('SELECT count(*) FROM clinical_notes WHERE encounter_id=$1', [a.encounter.canonical_id])).rows[0].count), 0);
  pass('SOAP selected, clinician edits accepted via real API, acceptance does not write chart');
  await page.getByRole('button', { name: 'Create reviewed task', exact: true }).click();
  await expect(page.getByText('Choose a due date and responsible role before creating this task.', { exact: true })).toBeVisible();
  assert.equal(writes.filter(write => write.url.endsWith('/follow-ups')).length, 0);
  await page.getByLabel('Due date', { exact: true }).fill('2099-01-02T10:30');
  await page.getByLabel('Responsible role', { exact: true }).selectOption('phc_nurse');
  await page.getByRole('button', { name: 'Create reviewed task', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Task created', exact: true })).toBeDisabled();
  const taskWrite = writes.find(write => write.url.endsWith('/follow-ups'));
  assert.equal(taskWrite.body.sourceSuggestionId, a.draft.id); assert.equal(taskWrite.body.sourceDraftIndex, 0);
  const apiHeaders = { Authorization: `Bearer ${session.accessToken}`, 'x-programme-id': dc.programme_id, 'x-facility-id': dc.facility_id };
  const replay = await context.request.post('/api/ng/phc/follow-ups', { headers: apiHeaders, data: taskWrite.body });
  assert.equal(replay.ok(), true, `Real task replay failed ${replay.status()}: ${await replay.text()}`);
  const taskRow = (await pool.query('SELECT * FROM ng_follow_up_tasks WHERE programme_id=$1 AND idempotency_key=$2', [dc.programme_id, taskWrite.body.idempotencyKey])).rows;
  assert.equal(taskRow.length, 1); assert.notEqual(taskRow[0].status, 'completed');
  pass('reviewed task requires explicit date/role, stays open and real API retry creates no duplicate');
  await page.screenshot({ path: path.join(ART, 'reviewed-task.png'), fullPage: true });
  await page.getByRole('link', { name: 'Open chart to import reviewed SOAP' }).click();
  await expect(page.getByRole('button', { name: 'Load reviewed AI draft', exact: true })).toBeVisible();
  await expect(page.getByTestId('encounter-patient')).toHaveText(`Patient: ${patient.first_name} ${patient.last_name}`);
  await expect(page.getByTestId('encounter-provider')).toHaveText(`Provider: ${doctor.first_name} ${doctor.last_name}`);
  pass('canonical chart displays the actual encounter patient and assigned provider identity');
  const editor = label => page.locator('div.space-y-2').filter({ has: page.locator('label').filter({ hasText: new RegExp(`^${label}$`) }) }).locator('textarea');
  await editor('Subjective').fill('Unsaved synthetic clinician text');
  await page.getByRole('button', { name: 'Load reviewed AI draft', exact: true }).click();
  await expect(editor('Subjective')).toHaveValue('Unsaved synthetic clinician text');
  await expect(page.getByText('Draft preserved', { exact: true })).toBeVisible();
  await editor('Subjective').fill('');
  await page.getByRole('button', { name: 'Load reviewed AI draft', exact: true }).click();
  await expect(editor('Assessment')).toHaveValue('Clinician edited synthetic assessment.');
  assert.equal(Number((await pool.query('SELECT count(*) FROM clinical_notes WHERE encounter_id=$1', [a.encounter.canonical_id])).rows[0].count), 0);
  await page.getByRole('button', { name: 'Save Note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign', exact: true })).toBeVisible();
  const note = (await pool.query('SELECT id,is_signed,signature_hash FROM clinical_notes WHERE encounter_id=$1', [a.encounter.canonical_id])).rows;
  assert.equal(note.length, 1); assert.equal(note[0].is_signed, false); assert.equal(note[0].signature_hash, null);
  assert.equal(writes.some(write => /\/sign$/.test(write.url)), false);
  const noteWrite = writes.find(write => write.url.endsWith(`/${a.encounter.canonical_id}/notes`));
  assert.equal(noteWrite.body.aiSuggestionId, a.draft.id);
  const noteReplay = await context.request.post(`/api/clinical-encounters/${a.encounter.canonical_id}/notes`, { headers: apiHeaders, data: noteWrite.body });
  assert.equal(noteReplay.ok(), true, `Note replay failed ${noteReplay.status()}`);
  assert.equal(Number((await pool.query('SELECT count(*) FROM clinical_notes WHERE encounter_id=$1', [a.encounter.canonical_id])).rows[0].count), 1);
  pass('explicit import preserves unsaved text; explicit save creates one unsigned note, signing remains separate');
  await page.screenshot({ path: path.join(ART, 'unsigned-chart.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByText('Signed', { exact: true })).toBeVisible();
  assert.equal((await pool.query('SELECT is_signed FROM clinical_notes WHERE id=$1', [note[0].id])).rows[0].is_signed, true);
  assert.equal(writes.filter(write => /\/sign$/.test(write.url)).length, 1);
  pass('signing occurs only after a separate explicit clinician click');
  // A second in-flight generation must not replace a newer encounter selection.
  await openWorkspace(); holdGeneration = true;
  await generateButton(a).click(); await waitForSignal(generationHeld.promise, 'generation request');
  await generateButton(b).click();
  await expect(page.getByLabel('Encounter summary', { exact: true })).toHaveValue(b.complaint);
  const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/ng/phc/ai/suggestions') && response.request().postDataJSON().encounterId === a.encounter.id);
  const lateFinished = page.waitForEvent('requestfinished', req => req.url().endsWith('/api/ng/phc/ai/suggestions') && req.postDataJSON().encounterId === a.encounter.id);
  generationRelease.resolve();
  const late = await lateResponse;
  await late.finished();
  await late.body();
  await lateFinished;
  await expect(generateButton(a)).toBeEnabled();
  // Response headers alone are insufficient: consume the body and wait for the
  // browser's next two render frames so Axios/React can apply the late result.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByLabel('Encounter summary', { exact: true })).toHaveValue(b.complaint);
  pass('late encounter A generation cannot overwrite the displayed encounter B draft');
  await page.screenshot({ path: path.join(ART, 'stale-context-protected.png'), fullPage: true });
  // The creating doctor cannot act on a task assigned to the nurse role.
  await page.getByRole('tab', { name: /follow-ups/i }).click();
  const doctorTask = page.getByTestId(`follow-up-${taskRow[0].id}`);
  await expect(doctorTask).toBeVisible();
  await expect(doctorTask.getByRole('button', { name: 'Start task', exact: true })).toHaveCount(0);
  await expect(doctorTask.getByRole('button', { name: 'Complete task', exact: true })).toHaveCount(0);
  const forbiddenTransition = await context.request.patch(`/api/ng/phc/follow-ups/${taskRow[0].id}/status`, {
    headers: apiHeaders, data: { toStatus: 'in_progress', expectedVersion: taskRow[0].record_version },
  });
  assert.equal(forbiddenTransition.status(), 403);
  pass('non-responsible clinician has no task actions and direct transition is rejected');

  const nurseBrowser = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } });
  await nurseBrowser.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await nurseBrowser.route('**/*', async route => {
      const req = route.request();
      if (isOfflineFontFixture(req.url(), req.method(), req.resourceType())) {
        return route.fulfill({ status: 200, contentType: 'text/css', body: '/* offline */' });
      }
      if (new URL(req.url()).origin !== BASE) { external.push(req.url()); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const nurseLogin = await nurseBrowser.request.post('/api/auth/login', { data: { email: nurse.email, password: PASSWORD, role: 'provider' } });
    assert.equal(nurseLogin.ok(), true, `Synthetic nurse login failed ${nurseLogin.status()}`);
    const nurseSession = await nurseLogin.json(); assert.equal(nurseSession.success, true);
    await nurseBrowser.addInitScript(({ accessToken, refreshToken, user }) => {
      localStorage.setItem('accessToken', accessToken); localStorage.setItem('refreshToken', refreshToken); localStorage.setItem('user', JSON.stringify(user));
    }, { accessToken: nurseSession.accessToken, refreshToken: nurseSession.refreshToken, user: nurseSession.user });
    const nursePage = await nurseBrowser.newPage(); nursePage.setDefaultTimeout(15000);
    nursePage.on('pageerror', error => pageErrors.push(error.message));
    const taskWrites = [];
    nursePage.on('request', req => {
      if (req.method() === 'PATCH' && req.url().endsWith(`/follow-ups/${taskRow[0].id}/status`)) taskWrites.push(req.postDataJSON());
    });
    await nursePage.goto('/ng/phc', { waitUntil: 'networkidle' });
    await nursePage.getByRole('tab', { name: /follow-ups/i }).click();
    const card = nursePage.getByTestId(`follow-up-${taskRow[0].id}`);
    await expect(card.getByText('Clinician edited synthetic follow-up.', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Complete task', exact: true })).toBeDisabled();
    await card.getByRole('button', { name: 'Start task', exact: true }).click();
    await expect(card.getByText('In Progress', { exact: true })).toBeVisible();
    assert.equal(taskWrites.length, 1);
    assert.deepEqual(taskWrites[0], { toStatus: 'in_progress', expectedVersion: taskRow[0].record_version });
    const syntheticOutcome = 'Synthetic nurse confirmed documentation review; no live patient involved.';
    await card.getByLabel(`Outcome or cancellation reason for ${taskRow[0].title || 'Synthetic documentation check A'}`).fill(syntheticOutcome);
    // Same-render repeated clicks exercise the synchronous client in-flight guard.
    await card.getByRole('button', { name: 'Complete task', exact: true }).evaluate(button => { button.click(); button.click(); });
    await expect(card.getByText('Completed', { exact: true })).toBeVisible();
    assert.equal(taskWrites.length, 2);
    assert.equal(taskWrites[1].expectedVersion, taskRow[0].record_version + 1);
    const closed = (await pool.query('SELECT * FROM ng_follow_up_tasks WHERE id=$1', [taskRow[0].id])).rows[0];
    assert.equal(closed.status, 'completed'); assert.equal(closed.completed_by, nurse.id); assert.ok(closed.completed_at);
    assert.equal(closed.record_version, taskRow[0].record_version + 2);
    assert.ok(closed.closure_evidence_json.encrypted && closed.closure_evidence_json.iv && closed.closure_evidence_json.tag);
    assert.equal(JSON.stringify(closed.closure_evidence_json).includes(syntheticOutcome), false);
    assert.equal(require('../lib/encryption').decrypt(closed.closure_evidence_json.encrypted, closed.closure_evidence_json.iv, closed.closure_evidence_json.tag), syntheticOutcome);
    const audit = (await pool.query("SELECT metadata_json FROM ng_programme_audit_events WHERE resource_type='follow_up_task' AND resource_id=$1 AND action='follow_up_transition'", [closed.id])).rows;
    assert.equal(audit.length, 2); assert.equal(JSON.stringify(audit).includes(syntheticOutcome), false);
    await nursePage.reload({ waitUntil: 'networkidle' });
    await nursePage.getByRole('tab', { name: /follow-ups/i }).click();
    await expect(card.getByText('Completed', { exact: true })).toBeVisible();
    await expect(card.getByText(syntheticOutcome, { exact: false })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Complete task', exact: true })).toHaveCount(0);
    await nursePage.screenshot({ path: path.join(ART, 'completed-follow-up.png'), fullPage: true });
    pass('responsible nurse starts and explicitly completes once; encrypted outcome, actor, audit and terminal state survive reload');
  } finally {
    await nurseBrowser.tracing.stop({ path: path.join(ART, 'follow-up-trace.zip') });
    await nurseBrowser.close();
  }
  await exerciseConference({ doctor, nurse, patient, external, pageErrors, session });
  assert.deepEqual(pageErrors, []); assert.deepEqual(external, []);
  pass('no uncaught browser errors or unexpected external requests; named font stylesheet fulfilled offline');
}

async function exerciseConference({ doctor, nurse, patient, external, pageErrors, session }) {
  const guests=[]; let conference;
  const refreshFrames=new Map(),signalFrames=new Map();let latestExpiry=0;
  const observeRefresh=p=>{refreshFrames.set(p,0);signalFrames.set(p,0);p.on('websocket',ws=>{ws.on('framesent',frame=>{if(String(frame.payload).includes('auth:reauthenticate'))refreshFrames.set(p,refreshFrames.get(p)+1);});ws.on('framereceived',frame=>{if(String(frame.payload).includes('conference:signal'))signalFrames.set(p,signalFrames.get(p)+1);});});};
  const shortSession=async p=>{const jwt=require('jsonwebtoken');const original=await p.evaluate(()=>localStorage.getItem('accessToken'));const claims=jwt.verify(original,process.env.JWT_ACCESS_SECRET);assert.ok(claims.sessionId,'Actual login must create a session family');const access=jwt.sign({userId:claims.userId,role:claims.role,sessionVersion:claims.sessionVersion,sessionId:claims.sessionId},process.env.JWT_ACCESS_SECRET,{expiresIn:'12s'});latestExpiry=Math.max(latestExpiry,jwt.decode(access).exp*1000);await p.evaluate(token=>localStorage.setItem('accessToken',token),access);};
  const bearer=new Map([[context,session.accessToken]]);
  const request=async(ctx,route,data)=>{const response=await ctx.request.post(route,{data,...(bearer.has(ctx)?{headers:{Authorization:`Bearer ${bearer.get(ctx)}`}}:{})});assert.equal(response.ok(),true,`Synthetic conference API ${route}: ${response.status()}`);return response.json();};
  const trackMedia=()=>{window.__conferencePeers=[];const OriginalPeer=window.RTCPeerConnection;window.RTCPeerConnection=class extends OriginalPeer{constructor(...args){super(...args);window.__conferencePeers.push(this);this.addEventListener('icecandidate',event=>{if(event.candidate)this.__lastCandidate=event.candidate;});}};window.__conferenceStreams=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.__conferenceStreams.push(stream);return stream;};};
  try {
    await context.grantPermissions(['camera','microphone']);await context.addInitScript(trackMedia);
    conference=(await request(context,'/api/ng/conference/rooms',{title:'Synthetic three-party workflow',host_display_name:'Synthetic clinical host',patient_user_id:patient.id,max_participants:3,media_server:'peer_mesh',requires_waiting_room:false})).room;
    for(const [index,account] of [patient,nurse].entries()) {
      const invite=await request(context,`/api/ng/conference/rooms/${conference.id}/invites`,{role:'family',display_name:`Synthetic invited family ${index+1}`});
      const token=invite.invite?.token || invite.token;assert.ok(token);
      const anonymous=await fetch(`${BASE}/api/ng/conference/public/redeem-invite`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(anonymous.status,401);
      const guest=await browser.newContext({baseURL:BASE,viewport:{width:1440,height:1000},permissions:['camera','microphone']});guests.push({context:guest,account});
      await guest.route('**/*',async route=>{const req=route.request();const url=req.url();if(url.startsWith(BASE)||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();if(isOfflineFontFixture(url,req.method(),req.resourceType()))return route.fulfill({status:200,contentType:'text/css',body:''});external.push(url);return route.abort();});
      const login=await request(guest,'/api/auth/login',{email:account.email,password:PASSWORD,role:account.role});
      bearer.set(guest,login.accessToken);
      await guest.addInitScript(({accessToken,refreshToken,user})=>{localStorage.setItem('accessToken',accessToken);localStorage.setItem('refreshToken',refreshToken);localStorage.setItem('user',JSON.stringify(user));},login);
      await guest.addInitScript(trackMedia);
      const guestPage=await guest.newPage();guestPage.setDefaultTimeout(20000);guestPage.on('pageerror',error=>pageErrors.push(error.message));guests[index].page=guestPage;
      await guestPage.goto(`/ng/conference/join/${token}`,{waitUntil:'networkidle'});
      await guestPage.getByRole('button',{name:'Accept invitation',exact:true}).evaluate(button=>{button.click();button.click();});
      await guestPage.waitForURL(`**/ng/conference/${conference.id}`);
      const participant=(await pool.query('SELECT * FROM ng_conf_participants WHERE room_id=$1 AND user_id=$2',[conference.id,account.id])).rows[0];
      assert.equal(participant.role,'family');guests[index].participant=participant;
    }
    await request(context,`/api/ng/conference/rooms/${conference.id}/start`,{});
    await page.goto(`/ng/conference/${conference.id}`,{waitUntil:'networkidle'});
    await expect(page.getByPlaceholder('e.g. Dr. Amina Okafor')).toHaveValue('Synthetic clinical host');
    observeRefresh(page);await shortSession(page);
    await page.getByRole('button',{name:'Join Now',exact:true}).click();
    await expect(page.getByRole('button',{name:'End room',exact:true})).toBeVisible();
    for(const [index,guest] of guests.entries()) {
      await guest.page.goto(`/ng/conference/${conference.id}`,{waitUntil:'networkidle'});
      await expect(guest.page.getByPlaceholder('e.g. Dr. Amina Okafor')).toHaveValue(`Synthetic invited family ${index+1}`);
      observeRefresh(guest.page);await shortSession(guest.page);
      await guest.page.getByRole('button',{name:'Join Now',exact:true}).click();
      await expect(guest.page.getByRole('button',{name:'End room',exact:true})).toHaveCount(0);
    }
    const activeVideos=p=>p.evaluate(()=>Array.from(document.querySelectorAll('video')).filter(video=>video.srcObject?.getVideoTracks().some(track=>track.readyState==='live')&&video.readyState>=2).length);
    for(const p of [page,...guests.map(guest=>guest.page)])await expect.poll(()=>activeVideos(p),{timeout:45000}).toBeGreaterThanOrEqual(3);
    await page.screenshot({path:path.join(ART,'three-party-conference.png'),fullPage:true});
    await delay(Math.max(0,latestExpiry-Date.now()+1000));
    for(const p of [page,...guests.map(guest=>guest.page)]) {
      // Retransmit a real gathered candidate through the actual conference
      // socket, forcing an expired transport token to refresh without mock I/O.
      const signalsBefore=Array.from(signalFrames.values()).reduce((sum,value)=>sum+value,0);
      assert.ok(await p.evaluate(()=>{const peer=window.__conferencePeers.find(value=>value.__lastCandidate&&value.onicecandidate);if(!peer)return false;peer.onicecandidate({candidate:peer.__lastCandidate});return true;}));
      await expect.poll(()=>refreshFrames.get(p),{timeout:30000}).toBeGreaterThan(0);
      await expect.poll(()=>Array.from(signalFrames.values()).reduce((sum,value)=>sum+value,0),{timeout:30000}).toBeGreaterThan(signalsBefore);
      await expect.poll(()=>activeVideos(p),{timeout:20000}).toBeGreaterThanOrEqual(3);
    }
    pass('three-party media remains active while expired socket tokens refresh and reauthenticate through real HTTP/socket paths');
    await request(context,`/api/ng/conference/rooms/${conference.id}/participants/${guests[1].participant.id}/remove`,{});
    await expect.poll(()=>guests[1].page.evaluate(()=>window.__conferenceStreams.length>0&&window.__conferenceStreams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended'))),{timeout:20000}).toBe(true);
    const rejoin=await guests[1].context.request.post(`/api/ng/conference/rooms/${conference.id}/join`,{data:{role:'host'},headers:{Authorization:`Bearer ${bearer.get(guests[1].context)}`}});assert.equal(rejoin.status(),403);
    await guests[0].page.getByTitle('Leave call',{exact:true}).click();
    await expect.poll(async()=>(await pool.query('SELECT status FROM ng_conf_participants WHERE id=$1',[guests[0].participant.id])).rows[0].status).toBe('left');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'End room',exact:true}).click();
    await expect.poll(async()=>(await pool.query('SELECT status FROM ng_conf_rooms WHERE id=$1',[conference.id])).rows[0].status).toBe('ended');
    pass('synthetic three-party generic conference: authenticated role-preserving invites, own identity, provider-host controls, real peer video, removal stops tracks, leave releases membership and end persists');
  } finally {for(const guest of guests)await guest.context.close();}
}

async function waitForSignal(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
}

async function boundedCleanup(label, operation, timeoutMs = 5000) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } catch (error) {
    (evidence.cleanupErrors ||= []).push(`${label}: ${error.message}`);
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}

(async () => {
  let deadline;
  const timeout = new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Clinical Copilot browser test exceeded 8 minutes')), 480000); });
  try { await Promise.race([main(), timeout, routeFailure]); }
  catch (error) {
    stopping = true;
    evidence.error = error.stack; console.error(error); process.exitCode = 1;
    unblockGeneration();
    if (page) await boundedCleanup('failure screenshot', () => page.screenshot({ path: path.join(ART, 'failure.png'), fullPage: true, timeout: 4000 }));
  } finally {
    clearTimeout(deadline);
    stopping = true;
    unblockGeneration();
    // Each operation is independently bounded and captured: a stuck trace or
    // browser must never prevent terminating our server or closing the test DB.
    if (page) await boundedCleanup('page abort', () => page.close({ runBeforeUnload: false }));
    if (context) await boundedCleanup('trace', () => context.tracing.stop({ path: path.join(ART, 'trace.zip') }));
    if (browser) await boundedCleanup('browser', () => browser.close());
    if (child?.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
      await boundedCleanup('server exit', () => new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)));
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    await boundedCleanup('database', () => close());
    await boundedCleanup('server log', () => new Promise(resolve => childLog.end(resolve)));
    fs.writeFileSync(path.join(ART, 'evidence.json'), JSON.stringify(evidence, null, 2));
  }
})().then(() => {
  // Also terminate leaked transport handles after all owned-process cleanup and
  // durable evidence writes; timeout/failure must be a bounded nonzero CI exit.
  process.exit(process.exitCode || 0);
}, error => {
  console.error(error);
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* exited */ } }
  process.exit(1);
});
