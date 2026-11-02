'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const service = require('../services/triageService');
const data = { symptoms: 'Synthetic fixture' };
const patient = { id: 'patient-1', role: 'patient' };
const provider = { id: 'provider-1', role: 'provider' };
function database() {
  return { async query(sql, args) {
    if (sql.includes('information_schema')) return { rows: [{}] };
    assert.match(sql, /patient_id = \$2/);
    assert.match(sql, /provider_id = \$2/);
    assert.match(sql, /\$3 = 'patient'/);
    assert.match(sql, /\$3 = 'provider'/);
    const allowed = args[0] === 'appointment-1' &&
      ((args[2] === 'patient' && args[1] === patient.id) || (args[2] === 'provider' && args[1] === provider.id));
    return { rows: allowed ? [{ triage_data: data }] : [] };
  } };
}
test('triage read permits only appointment owner or assigned provider', async () => {
  for (const actor of [patient, provider]) {
    assert.deepEqual(await service.getTriageForAppointment('appointment-1', actor, database()), data);
  }
});
test('cross-patient, unassigned provider, arbitrary IDs and missing identity do not expose triage', async () => {
  for (const actor of [{ id: 'patient-2', role: 'patient' }, { id: 'provider-2', role: 'provider' }, { id: patient.id, role: 'admin' }, null]) {
    assert.equal(await service.getTriageForAppointment('appointment-1', actor, database()), null);
  }
  assert.equal(await service.getTriageForAppointment('appointment-2', patient, database()), null);
});

test('historical patient-submitted clinical suggestions are stripped on read', () => {
  const input={symptoms:'synthetic',severity:5,triageLevel:'URGENT',suggestedMeds:['fictional medicine'],soapDraft:'invented plan',flags:['urgent'],suggestedSpecialty:'Surgery'};
  const safe=service.normalizePatientReportedTriage(input);
  assert.equal(safe.symptoms,'synthetic');
  assert.equal(safe.triageLevel,'UNASSESSED');
  assert.equal(safe.severity,null);
  assert.equal(safe.assessmentStatus,'unassessed');
  assert.deepEqual(safe.suggestedMeds,[]);
  assert.equal(safe.soapDraft,'');
  assert.equal(input.triageLevel,'URGENT');
});
