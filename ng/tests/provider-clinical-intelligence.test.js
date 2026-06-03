const assert = require('node:assert/strict');
const test = require('node:test');

const {
  deriveProviderClinicalIntelligence,
  levelForScore,
} = require('../../lib/ng/providerClinicalIntelligence');

test('provider clinical intelligence derives risk, forecasts, and care model coverage', () => {
  const now = '2026-06-03T10:00:00.000Z';
  const intelligence = deriveProviderClinicalIntelligence({
    now,
    appointments: [
      { id: 'a1', type: 'video', status: 'confirmed', scheduledAt: now, patientFirstName: 'Chinedu' },
      { id: 'a2', type: 'video', status: 'scheduled', scheduledAt: '2026-06-04T10:00:00.000Z' },
    ],
    visits: [
      { id: 'v1', isSigned: false, followUpRequired: true },
      { id: 'v2', isSigned: true },
    ],
    prescriptions: [
      {
        id: 'rx1',
        lifecycle_status: 'sent',
        items: [{ medication_name: 'Artemether/lumefantrine' }],
      },
      {
        id: 'rx2',
        lifecycle_status: 'declined_by_pharmacy',
        items: [{ medication_name: 'Amlodipine' }],
      },
    ],
    referrals: [{ id: 'r1', status: 'sent', priority: 'urgent' }],
    patients: [{ id: 'p1' }],
  });

  assert.equal(intelligence.counts.activeConsultations, 2);
  assert.equal(intelligence.counts.openPrescriptions, 1);
  assert.equal(intelligence.counts.pendingReferrals, 1);
  assert.ok(intelligence.operationalRisk.score > 35);
  assert.ok(intelligence.medicationWarnings.some((warning) => warning.title.includes('Antimalarial')));
  assert.equal(intelligence.careModelCoverage.medicationHistory, true);
  assert.equal(intelligence.careModelCoverage.referralChains, true);
  assert.equal(intelligence.forecasts.consultationsNext7Days.value, 2);
});

test('risk score labels are deterministic', () => {
  assert.equal(levelForScore(20), 'routine');
  assert.equal(levelForScore(35), 'moderate');
  assert.equal(levelForScore(55), 'high');
  assert.equal(levelForScore(75), 'critical');
});
