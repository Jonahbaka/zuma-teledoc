const test = require('node:test');
const assert = require('node:assert/strict');
const { renderDashboard } = require('./dashboard-render-fixture.cjs');

const appointment = { id: 'fictional-visit', status: 'confirmed', type: 'video', scheduledAt: new Date(Date.now() - 15 * 60000).toISOString(), patientFirstName: 'Fictional', providerFirstName: 'Fictional' };
const providerSections = {
  appointments: { rows: [appointment] },
  patients: { rows: [{ id: 'fictional-patient', firstName: 'Fictional', lastVisit: '2026-12-01T12:00:00Z' }] },
  notes: { rows: [{ id: 'note-signed', isSigned: true, appointmentId: 'signed-visit', patientFirstName: 'Signed' }, { id: 'note-draft', isSigned: false, appointmentId: 'draft-visit', patientFirstName: 'Unsigned' }] },
};

test('provider dashboard retains late appointment links, real signing states, and accurate history labels', () => {
  const rendered = renderDashboard('provider', providerSections);
  assert.ok(rendered.links.includes('/provider/appointments/fictional-visit/call'));
  assert.ok(rendered.links.includes('/provider/appointments/fictional-visit/visit'));
  assert.ok(rendered.links.indexOf('/provider/appointments/draft-visit/visit') < rendered.links.indexOf('/provider/appointments/signed-visit/visit'));
  assert.match(rendered.text, /Unsigned/); assert.match(rendered.text, /Signed/);
  assert.match(rendered.text, /Latest appointment:/); assert.doesNotMatch(rendered.text, /Last visit:/);
});
test('Nigeria dashboards retain market-specific record and appointment paths', () => {
  const provider = renderDashboard('provider', providerSections, { market: 'ng' });
  assert.ok(provider.links.includes('/ng/provider/appointments/fictional-visit/call'));
  assert.ok(provider.links.includes('/ng/provider/patients/fictional-patient/ehr'));
  assert.ok(provider.links.every(href => href.startsWith('/ng/provider/')));
  const patient = renderDashboard('patient', { appointments: { rows: [appointment] }, prescriptions: { rows: [] }, messages: { rows: [] } }, { market: 'NG' });
  assert.ok(patient.links.includes('/ng/patient/appointments/fictional-visit/call'));
  assert.ok(patient.links.every(href => href.startsWith('/ng/patient/')));
});
test('unavailable analytics stays unavailable instead of claiming zero work', () => {
  const rendered = renderDashboard('provider', { appointments: { error: true }, patients: { error: true }, notes: { error: true } }, { view: 'analytics' });
  assert.match(rendered.text, /Unavailable/);
  assert.ok(rendered.nodes.some(node => node.props.role === 'alert'));
  assert.doesNotMatch(rendered.text, /ETL|Production Guardrail|success rate|readmission/i);
  assert.match(rendered.text, /loaded subsets/);
});
test('partial Nigeria scheduling warns that counts and lists are incomplete', () => {
  const rendered = renderDashboard('provider', { ...providerSections, appointments: { rows: [appointment], partial: true } }, { market: 'ng', view: 'analytics' });
  assert.match(rendered.text, /counts and lists are partial/);
  assert.match(rendered.text, /up to 50 Nigeria scheduling records/);
});
test('operational analytics accounts for no-shows and unrecognized scheduling statuses', () => {
  const rendered = renderDashboard('provider', { ...providerSections, appointments: { rows: [{ ...appointment, status: 'no_show' }, { ...appointment, id: 'legacy-unknown', status: 'pending' }] } }, { view: 'analytics' });
  const descriptions = rendered.nodes.filter(node => node.type === 'dl');
  assert.ok(descriptions.length > 0);
  assert.match(rendered.text, /no show 1/);
  assert.match(rendered.text, /Other \/ not recorded 1/);
});
test('patient failed and pending reads never render a phantom next visit or video link', () => {
  for (const loading of [true, false]) {
    const rendered = renderDashboard('patient', { appointments: { error: true }, prescriptions: { error: true }, messages: { error: true } }, { loading });
    assert.ok(rendered.links.includes('/patient/appointments/book'));
    assert.ok(!rendered.links.some(href => /appointments\/[^/]+\/call/.test(href)));
    assert.match(rendered.text, loading ? /Loading your care information/ : /could not be loaded/);
  }
});
