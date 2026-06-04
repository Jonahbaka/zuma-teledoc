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

test('US and Nigeria provider dashboards use the shared premium operating workspace', () => {
  const usPage = read('app/(dashboard)/provider/dashboard/page.js');
  const ngPage = read('app/ng/provider/dashboard/page.js');

  assert.match(usPage, /PremiumProviderDashboard/);
  assert.match(usPage, /market="US"/);
  assert.match(ngPage, /PremiumProviderDashboard/);
  assert.match(ngPage, /market="NG"/);
  assert.doesNotMatch(ngPage, /ProviderCommandCenter/);
  assert.doesNotMatch(ngPage, /NEXT_PUBLIC_NG_PROVIDER_COMMAND_CENTER_ENABLED/);
});

test('provider sidebar exposes healthcare operating system labels without old video hub copy', () => {
  const navigation = read('components/provider/providerNavigation.js');
  for (const label of [
    'Command Center',
    'Patient Queue',
    'Clinical Video',
    'EMR',
    'SOAP & Visits',
    'Prescriptions',
    'Referrals',
    'Care Teams',
    'Forecasts',
  ]) {
    assert.match(navigation, escaped(label));
  }
  assert.doesNotMatch(navigation, /Visit Hub/);
  assert.doesNotMatch(navigation, /Conferencing/);
});

test('premium provider dashboard binds the pasted command center design to live provider APIs', () => {
  const component = read('components/provider/PremiumProviderDashboard.jsx');
  for (const text of [
    'DoctaRx OS',
    'Command Center',
    'Population Health',
    'Clinical Records',
    'Clinical Video',
    'Start Secure Video Meeting',
    'Healthcare Operating Workspace',
    'Patient Flow & Capacity Forecast',
    'providersAPI.getPatients',
    '/ng/clinical/prescriptions',
    '/ng/clinical/referrals',
    "appointmentsAPI.getUpcoming(20)",
    "visitsAPI.getRecent(20)",
  ]) {
    assert.match(component, escaped(text));
  }
  assert.doesNotMatch(component, /MOCK DATA/);
  assert.doesNotMatch(component, /patientData/);
  assert.doesNotMatch(component, /Provider Dashboard ->/);
});

test('provider clinical video entry removes old visit hub and implementation-name language', () => {
  const callPage = read('app/(dashboard)/provider/call/page.js');
  assert.match(callPage, /Clinical Video/);
  assert.match(callPage, /Video Readiness Test/);
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

test('video consultation join fails closed when patient payment is required', () => {
  const service = read('server/services/telehealthSessionService.js');
  const patientPage = read('app/(dashboard)/patient/appointments/[id]/call/page.js');

  assert.match(service, /payment_required/);
  assert.match(service, /payment_completed/);
  assert.match(service, /getUserTestingAccess/);
  assert.match(service, /Payment required before joining video appointment/);
  assert.doesNotMatch(patientPage, /Allow access if check fails/);
  assert.match(patientPage, /Payment Verification Failed/);
  assert.match(patientPage, /router\.push\(appointmentReturnPath\)/);
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
