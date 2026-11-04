#!/usr/bin/env node

const assert = require('assert');
const service = require('../ng/services/public-health/publicHealthProgrammeService');

function testForecasts() {
  const values = [1, 2, 3, 4, 5, 6, 7];
  const ma = service.movingAverage(values, 7);
  assert.strictEqual(ma.method, 'simple_moving_average');
  assert.strictEqual(ma.confidenceLabel, 'low');
  assert.strictEqual(ma.predictedValue, 28);

  const wma = service.weightedMovingAverage(values, 7);
  assert.strictEqual(wma.method, 'weighted_moving_average');
  assert.ok(wma.predictedValue > ma.predictedValue);

  const insufficient = service.movingAverage([1, 2, 3], 7);
  assert.strictEqual(insufficient.confidenceLabel, 'insufficient_data');
  assert.strictEqual(insufficient.predictedValue, 0);

  const trend = service.linearTrendProjection([...values, 8, 9, 10, 11, 12, 13, 14], 7);
  assert.strictEqual(trend.method, 'linear_trend_projection');
  assert.ok(trend.predictedValue > 0);
}

function fakeReportBundle() {
  return {
    report: {
      id: '11111111-1111-4111-8111-111111111111',
      report_period: '2026-05',
      report_type: 'monthly_aggregate',
      status: 'approved',
      facility_id: null,
      facility_name: null,
      lga: null,
      generated_by_name: 'Admin',
      approved_by_name: 'Compliance',
      approved_at: '2026-05-07T00:00:00.000Z',
      notes: 'Aggregate report',
    },
    values: [
      {
        internal_key: 'total_consultations',
        display_name: 'Total consultations',
        programme_area: 'patient_access',
        value: 12,
        aggregation_type: 'count',
        dhis2_data_element_id: 'CONFIGURED_TOTAL_CONSULTATIONS',
        dhis2_category_option_combo_id: 'CONFIGURED_DEFAULT_COC',
      },
      {
        internal_key: 'teleconsultations',
        display_name: 'Teleconsultations',
        programme_area: 'teleconsultation',
        value: 7,
        aggregation_type: 'count',
        dhis2_data_element_id: null,
        dhis2_category_option_combo_id: null,
      },
    ],
  };
}

function testExports() {
  const json = service.reportToJson(fakeReportBundle());
  assert.strictEqual(json.report.governance.aggregateOnly, true);
  assert.strictEqual(json.report.governance.excludesPatientIdentifiers, true);
  assert.strictEqual(json.intelligenceReport.serviceDeliverySummary.consultations, 12);
  assert.strictEqual(json.intelligenceReport.dhis2ReadinessSummary.missingIndicators, 1);
  assert.ok(json.intelligenceReport.planningIntelligence.dataQualityIssues.some((item) => item.includes('teleconsultations')));
  assert.strictEqual(json.values.length, 2);
  assert.strictEqual(json.values[0].dhis2Mapped, true);
  assert.strictEqual(json.values[1].dhis2Mapped, false);

  const csv = service.reportToCsv(fakeReportBundle());
  assert.ok(csv.includes('total_consultations'));
  assert.ok(csv.includes('CONFIGURED_TOTAL_CONSULTATIONS'));
  assert.ok(!csv.toLowerCase().includes('patient_name'));
  assert.ok(!csv.toLowerCase().includes('email'));

  assert.strictEqual(service.assertNoPatientIdentifiers({ dataValues: [{ value: 10 }] }), true);
  assert.strictEqual(service.assertNoPatientIdentifiers({ patient_name: 'Unsafe' }), false);
}

function testReadinessAndSyncValidation() {
  const filterState = service.buildFilterState({ period: '2026-05', lga: 'AMAC', ward: 'Garki' });
  assert.ok(filterState.applied.includes('period'));
  assert.ok(filterState.applied.includes('lga_for_referral_tables'));
  assert.ok(filterState.limitations.some((item) => item.includes('ward mapping')));

  const readiness = service.buildReadiness(
    {
      enabled: false,
      dryRunOnly: true,
      governmentApprovalStatus: 'pending',
      apiCredentialsStatus: 'pending',
      dataSharingAgreementStatus: 'pending',
      ndprReviewStatus: 'pending',
    },
    [
      {
        id: 'indicator-1',
        active: true,
        internal_key: 'total_consultations',
        display_name: 'Total consultations',
        programme_area: 'patient_access',
        dhis2_data_element_id: null,
      },
    ]
  );
  assert.strictEqual(readiness.status, 'government_and_mapping_pending');
  assert.strictEqual(readiness.missingMappings.length, 1);

  const blockers = service.validateDhis2Sync(
    fakeReportBundle(),
    {
      enabled: false,
      dryRunOnly: true,
      datasetId: '',
      orgUnitId: '',
      governmentApprovalStatus: 'pending',
      dataSharingAgreementStatus: 'pending',
      apiCredentialsStatus: 'pending',
    },
    {
      missingMappings: [{ internalKey: 'teleconsultations' }],
    }
  );
  assert.ok(blockers.length >= 6);
  assert.ok(blockers.some((item) => item.includes('disabled')));
  assert.ok(blockers.some((item) => item.includes('dry-run')));
}

function main() {
  testForecasts();
  testExports();
  testReadinessAndSyncValidation();
  console.log('Public-health programme tests passed.');
}

main();
