'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  prepareDhis2DataValues,
  reportToJson,
  reportToCsv,
} = require('../services/public-health/publicHealthProgrammeService');

function bundle(values) {
  return {
    report: {
      id: 'report-1',
      report_period: '2026-08',
      report_type: 'monthly_aggregate',
      status: 'generated',
      facility_id: null,
      facility_name: null,
      lga: null,
    },
    values,
  };
}

describe('public-health missing-data semantics', () => {
  it('preserves an unavailable metric as null while retaining a measured zero', () => {
    const result = reportToJson(bundle([
      { internal_key: 'total_consultations', display_name: 'Consultations', programme_area: 'service', value: null, aggregation_type: 'count', dhis2_data_element_id: 'DX1' },
      { internal_key: 'prescriptions_created', display_name: 'Prescriptions', programme_area: 'pharmacy', value: '0', aggregation_type: 'count', dhis2_data_element_id: 'DX2' },
    ]));

    assert.equal(result.intelligenceReport.serviceDeliverySummary.consultations, null);
    assert.equal(result.intelligenceReport.pharmacyPrescriptionSummary.prescriptionsCreated, 0);
    assert.deepEqual(result.intelligenceReport.planningIntelligence.unavailableIndicators, ['total_consultations']);
    assert.equal(result.values[0].dataStatus, 'unavailable');
    assert.equal(result.values[1].dataStatus, 'observed');
  });

  it('omits unavailable values from DHIS2 instead of exporting them as zero', () => {
    const prepared = prepareDhis2DataValues([
      { internal_key: 'total_consultations', display_name: 'Consultations', value: null, dhis2_data_element_id: 'DX1' },
      { internal_key: 'prescriptions_created', display_name: 'Prescriptions', value: '0', dhis2_data_element_id: 'DX2' },
      { internal_key: 'pending_referrals', display_name: 'Pending referrals', value: '3', dhis2_data_element_id: null },
    ]);

    assert.deepEqual(prepared.dataValues, [{ dataElement: 'DX2', categoryOptionCombo: undefined, value: 0 }]);
    assert.equal(prepared.missingValues[0].internalKey, 'total_consultations');
    assert.equal(prepared.missingMappings[0].internalKey, 'pending_referrals');
  });

  it('renders unavailable CSV cells as blank', () => {
    const csv = reportToCsv(bundle([
      { internal_key: 'total_consultations', display_name: 'Consultations', programme_area: 'service', value: null, aggregation_type: 'count', dhis2_data_element_id: 'DX1' },
    ]));
    assert.match(csv, /Consultations",,count,DX1/);
  });
});
