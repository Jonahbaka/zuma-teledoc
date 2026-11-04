const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function escaped(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('US and Nigeria provider dashboards use the shared HealthOS operating workspace', () => {
  const usPage = read('app/(dashboard)/provider/dashboard/page.js');
  const ngPage = read('app/ng/provider/dashboard/page.js');

  // Both markets mount the single supplied HealthOS dashboard component.
  assert.match(usPage, /NGProviderDashboard/);
  assert.match(usPage, /market="us"/);
  assert.match(ngPage, /NGProviderDashboard/);
  // The old premium dashboard must no longer power any active provider route.
  assert.doesNotMatch(usPage, /PremiumProviderDashboard/);
  assert.doesNotMatch(ngPage, /PremiumProviderDashboard/);
});

test('US and Nigeria provider visits routes are folded into the new workspace, not the old shell', () => {
  const usVisits = read('app/(dashboard)/provider/visits/page.js');
  const ngVisits = read('app/ng/provider/visits/page.js');

  assert.match(usVisits, /NGProviderDashboard/);
  assert.match(ngVisits, /NGProviderDashboard/);
  assert.doesNotMatch(usVisits, /Visit Notes/);
  assert.doesNotMatch(ngVisits, /Visit Notes/);
});

test('provider sidebar exposes professional clinical labels without old video hub copy', () => {
  const navigation = read('components/provider/providerNavigation.js');
  for (const label of [
    'Today',
    'Patient Queue',
    'Video consultations',
    'Patients',
    'Clinical notes',
    'Prescriptions',
    'Referrals',
    'Care Teams',
    'Analytics',
  ]) {
    assert.match(navigation, escaped(label));
  }
  assert.doesNotMatch(navigation, /Visit Hub/);
  assert.doesNotMatch(navigation, /Conferencing/);
});

test('provider dashboard binds its clinical workspace to live provider APIs without invented charts or risk', () => {
  const component = read('components/provider/NGProviderDashboard.jsx');
  for (const text of [
    'Your day in care',
    'Video consultations',
    'Patients',
    'fetchProviderPatients',
    'fetchProviderAppointments',
  ]) {
    assert.match(component, escaped(text));
  }
  // Real patient data must be loaded dynamically, not from a hardcoded array.
  assert.doesNotMatch(component, /const patientData = \[/);
  assert.doesNotMatch(component, /Module Viewer/);
  assert.doesNotMatch(component, /admissionData|vitalsHistory|buildProviderDemoData|Math\.min\(95/);
});

test('provider clinical video entry mounts the Meet-style room without implementation-name language', () => {
  const callPage = read('app/(dashboard)/provider/call/page.js');
  assert.match(callPage, /import NGVideoCall/);
  assert.match(callPage, /<NGVideoCall/);
  assert.doesNotMatch(callPage, /Provider Visit Hub/);
  assert.doesNotMatch(callPage, /Visit Hub/);
  assert.doesNotMatch(callPage, /LiveKit/);
  assert.doesNotMatch(callPage, /SFU/);
});

test('Nigeria clinical route loads required services', () => {
  assert.doesNotThrow(() => require('../../ng/routes/clinical'));
});

test('referral route supports provider-visible lifecycle tracking', () => {
  const route = read('ng/routes/clinical.js');
  assert.match(route, /router\.get\('\/referrals'/);
  assert.match(route, /router\.patch\('\/referrals\/:id\/status'/);
  assert.match(route, /soapNoteIds/);
  assert.match(route, /prescriptionIds/);
});

test('prescription creation enforces patient-scoped clinical write access before insert', () => {
  const route = read('ng/routes/clinical.js');
  const prescriptionRouteStart = route.indexOf("router.post('/prescriptions'");
  const accessCheck = route.indexOf('await assertClinicalWriteAccess(req, req.body.patientUserId);', prescriptionRouteStart);
  const insert = route.indexOf('INSERT INTO ng_digital_prescriptions', prescriptionRouteStart);

  assert.notEqual(prescriptionRouteStart, -1);
  assert.ok(accessCheck > prescriptionRouteStart);
  assert.ok(insert > prescriptionRouteStart);
  assert.ok(accessCheck < insert);
});

test('Nigeria provider layout rejects providers outside the Nigeria market', () => {
  const layout = read('components/provider/ProviderPortalLayout.jsx');
  assert.match(layout, /normalizeProviderMarket/);
  assert.match(layout, /isProviderMarketMismatch/);
  assert.match(layout, /router\.replace\(providerMarketDashboard\)/);
  assert.match(layout, /market === 'NG'/);
});

test('shared provider APIs filter provider workspace records by authenticated market scope', () => {
  const appointments = read('server/routes/appointments.js');
  const providers = read('server/routes/providers.js');

  assert.match(appointments, /normalizeMarketScope/);
  assert.match(appointments, /userMarketScopeSql\('pr'\)/);
  assert.match(appointments, /userMarketScopeSql\('p'\)/);
  assert.match(providers, /normalizeMarketScope/);
  assert.match(providers, /userMarketScopeSql\('pr'\)/);
  assert.match(providers, /userMarketScopeSql\('u'\)/);
});

test('video consultation join requires current verified funding even when cached payment flags claim completion', async () => {
  const source = read('server/services/telehealthSessionService.js');
  const patientPage = read('app/(dashboard)/patient/appointments/[id]/call/page.js');
  const sourceModule = { exports: {} };
  let decision = { covered: false, source: 'funding_not_verified' }; let checks = 0;
  const dependencies = {
    '../db': { async query(sql) { assert.match(sql, /SELECT/); assert.doesNotMatch(sql, /UPDATE|INSERT/); return { rows: [{ id: 'visit', patient_id: 'patient', provider_id: 'provider', status: 'scheduled', type: 'video', payment_required: true, payment_completed: true }] }; } },
    '../middleware/logger': { warn() {} },
    '../../lib/utils': require('../../lib/utils'),
    './testingAccessService': { getUserTestingAccess: async () => ({ skipPayment: true }) },
    './consumerMembershipService': { async appointmentFunding(patientId, appointmentId) { assert.equal(patientId, 'patient'); assert.equal(appointmentId, 'visit'); checks++; return decision; } },
  };
  require('node:vm').runInNewContext(source, { module: sourceModule, exports: sourceModule.exports, process,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  const join = sourceModule.exports.getAuthorizedVideoAppointment;
  const patient = { id: 'patient', role: 'patient', hasGoldCard: true };
  await assert.rejects(join('visit', patient), (error) => error.status === 402);
  decision = { covered: false, source: 'financial_verification_unavailable' };
  await assert.rejects(join('visit', patient), (error) => error.status === 503);
  decision = { covered: true, source: 'verified_receipt' };
  assert.equal((await join('visit', patient)).id, 'visit');
  const before = checks;
  await assert.rejects(join('visit', { id: 'foreign', role: 'patient' }), (error) => error.status === 403);
  assert.equal(checks, before);
  assert.doesNotMatch(patientPage, /Allow access if check fails/);
  assert.match(patientPage, /Payment Verification Failed/);
  assert.match(patientPage, /router\.push\(appointmentReturnPath\)/);
});

test('provider appointments keep US bootstrap independent of Nigeria and preserve appointment origins', () => {
  const us = read('app/(dashboard)/provider/appointments/page.js');
  const ng = read('app/ng/provider/appointments/page.js');
  const appointments = read('components/provider/ProviderAppointments.jsx');
  assert.match(us, /<ProviderAppointments market="us"/);
  assert.match(ng, /<ProviderAppointments market="ng"/);
  assert.doesNotMatch(us, /\/ng\/providers/);
  assert.match(appointments, /api\.get\('\/appointments',/);
  assert.match(appointments, /market === 'us' \? Promise\.resolve\(\{ data: \{ appointments: \[\] \} \}\) : \(async/);
  assert.match(appointments, /source === 'legacy' \? `\$\{base\}\/call\?appointmentId=/);
  assert.match(appointments, /`\$\{base\}\/appointments\/\$\{appointment\.id\}\/call`/);
  assert.match(appointments, /controller\.signal\.aborted/);
  assert.doesNotMatch(appointments, /ngPresentationDemoData|buildProviderDemoData|shouldShowPresentationDemoData/);
});

test('provider referral form matches the active draft contract without invented delivery success', () => {
  const page = read('app/ng/provider/referrals/page.js');
  const route = read('ng/routes/clinical.js');
  assert.doesNotMatch(page, /ngPresentationDemoData|buildProviderDemoData|Demo referral prepared|Referral sent|mapped to a FHIR/);
  for (const field of ['patient_user_id', 'target_name', 'referral_type', 'clinical_notes', 'destination_type']) {
    assert.match(page, escaped(field + ':'));
    assert.match(route, escaped(field));
  }
  assert.match(page, /Referral draft saved/);
  assert.match(page, /patientResult\.status === 'fulfilled'/);
  assert.match(page, /referralResult\.status === 'fulfilled'/);
  assert.match(page, /errors\.patients/);
  assert.match(page, /errors\.referrals/);
  assert.match(page, /request\.current\?\.abort\(\)/);
  assert.match(page, /response_summary: summary/);
  assert.match(page, /currentUser\.current !== actor/);
});

test('presentation data stays disabled for provisioned accounts and browser overrides', async () => {
  const source = read('lib/ngPresentationDemoData.js');
  const presentation = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const previousWindow = global.window;
  let storageReads = 0;
  try {
    global.window = { localStorage: { getItem() { storageReads++; return 'true'; } } };
    for (const user of [undefined, { email: 'patient@demo.doctarx.com' }, { email: 'doctor@demo.doctarx.com' }, { email: 'pharmacy@demo.doctarx.com' }, { email: 'admin@demo.doctarx.com' }, { firstName: 'DoctaRx Demo' }]) {
      assert.equal(presentation.shouldShowPresentationDemoData(user), false);
    }
    assert.equal(storageReads, 0, 'Browser presentation flags may not substitute product records');
    delete global.window;
    assert.equal(presentation.shouldShowPresentationDemoData({ email: 'executive@demo.doctarx.com' }), false);
  } finally {
    if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
  }
});

test('government and PHC product interfaces cannot substitute generated reports or observations', () => {
  const ministry = read('components/ng/portal/FmohPortal.jsx');
  const phc = read('components/ng/phc/PhcWorkspace.jsx');
  assert.doesNotMatch(ministry, /applyDemoData|buildMinistryDemoData|ngPresentationDemoData/);
  assert.match(ministry, /Your account is not authorized/);
  assert.match(ministry, /controller\.signal\.aborted/);
  assert.doesNotMatch(phc, /captureSyntheticDeviceReading|captureMockDevice|Mock blood pressure|Mock oxygen saturation/);
  assert.match(phc, /Save observation/);
});

test('pharmacy dashboard reads real sections and separates failed requests from confirmed empty lists', () => {
  const page = read('components/ng/pharmacy/NGPharmacyDashboard.jsx');
  assert.doesNotMatch(page, /fallbackVolumeData|fetchNigeriaPharmacyDashboard|callGemini|Summarize pharmacy/);
  assert.match(page, /Promise\.allSettled/);
  assert.match(page, /errors\.prescriptions \? null/);
  assert.match(page, /errors\.orders \? null/);
  assert.match(page, /errors\.inventory \? null/);
  assert.match(page, /!failed\.prescriptions/);
  assert.match(page, /!failed\.alerts/);
  assert.match(page, /controller\.signal\.aborted/);
});

test('pharmacy discovery preserves genuine empty results and fails visibly without invented directory or availability data', async () => {
  const service = require('../../server/services/pharmacyService');
  const previousLocal = service._findLocalPharmacies;
  const previousFetch = global.fetch;
  try {
    assert.equal(service._getFallbackPharmacies, undefined);
    service._findLocalPharmacies = async () => { throw new Error('Directory store unavailable'); };
    await assert.rejects(service.findNearbyPharmacies(0, 0), { code: 'PHARMACY_DIRECTORY_UNAVAILABLE' });
    service._findLocalPharmacies = async () => [];
    global.fetch = async () => ({ ok: false });
    await assert.rejects(service.findNearbyPharmacies(0, 0), { code: 'PHARMACY_DIRECTORY_UNAVAILABLE' });
    global.fetch = async () => ({ ok: true, json: async () => ({ elements: [] }) });
    assert.deepEqual(await service.findNearbyPharmacies(0, 0), []);
    global.fetch = async () => ({ ok: true, json: async () => ({ elements: [{ id: 1, lat: 0, lon: 0, tags: { name: 'Directory entry' } }] }) });
    const results = await service.findNearbyPharmacies(0, 0);
    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'openstreetmap');
    assert.equal(results[0].distanceKm, 0);
    assert.equal(results[0].isOpen, null);
    assert.equal(results[0].acceptsEprescriptions, null);
    assert.equal(results[0].isPreferred, false);
    assert.equal(service._isPharmacyOpen('Mo-Fr 09:00-17:00'), null);
    assert.equal(service._isPharmacyOpen('24/7'), true);
    await assert.rejects(service.findNearbyPharmacies(91, 0), { code: 'PHARMACY_LOCATION_INVALID' });
  } finally {
    service._findLocalPharmacies = previousLocal;
    global.fetch = previousFetch;
  }
});

test('Nigeria discovery pages use one device/manual location source and never retain GPS in a manual request', () => {
  const care = read('components/ng/NigeriaCareDiscoveryExperience.jsx');
  const medicine = read('components/ng/NigeriaMedicineSearchPage.jsx');
  for (const page of [care, medicine]) {
    assert.match(page, /useCareLocation\('NG'\)/);
    assert.match(page, /CareLocationPicker careLocation=\{careLocation\}/);
    assert.match(page, /careLocation\.params/);
    assert.doesNotMatch(page, /navigator\.geolocation|setManualState|setManualCity|setLocationStatus/);
  }
  assert.match(medicine, /locationLatitude: location\.mode === 'device' \? latitude \?\? null : null/);
  assert.match(medicine, /locationLongitude: location\.mode === 'device' \? longitude \?\? null : null/);
  assert.match(care, /providerRequest\.current\?\.abort\(\)/);
  assert.match(care, /homeRequest\.current\?\.abort\(\)/);
  assert.match(care, /'providerType', 'sourceType', 'accessMode', 'category', 'resultCount', 'mode'/);
  assert.doesNotMatch(care, /payload: nextLocation|\.\.\.details\.payload/);
});

test('telehealth socket join and chat emit metadata-only audit events', () => {
  const socketService = read('server/services/socketService.js');
  const chatAuditStart = socketService.indexOf("description: 'Telehealth in-call chat message sent'");
  const chatAuditEnd = socketService.indexOf('});', chatAuditStart);
  const chatAuditSnippet = socketService.slice(chatAuditStart, chatAuditEnd);

  assert.match(socketService, /logAuditEvent/);
  assert.match(socketService, /auditTelehealthSocketEvent/);
  assert.match(socketService, /Telehealth participant joined video session/);
  assert.match(socketService, /Telehealth in-call chat message sent/);
  assert.match(socketService, /messageLength: body\.length/);
  assert.notEqual(chatAuditStart, -1);
  assert.doesNotMatch(chatAuditSnippet, /\bbody\b(?!\.length)/);
});
