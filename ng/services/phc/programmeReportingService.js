'use strict';

const crypto = require('crypto');
const { recordProgrammeAudit, scopeError } = require('./programmeScopeService');
const { canonicalJson } = require('./offlineSyncService');

function parsePeriod(period) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(period || ''));
  if (!match) throw scopeError(400, 'Reporting period must use YYYY-MM format.', 'INVALID_REPORTING_PERIOD');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { period: match[0], start: start.toISOString(), end: end.toISOString(), dhis2Period: `${year}${match[2]}` };
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function aggregateMetrics(pool, context, period) {
  const parsed = parsePeriod(period);
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM ng_programme_patient_enrollments e
         WHERE e.programme_id=$1 AND e.facility_id=$2 AND e.created_at >= $3 AND e.created_at < $4) AS new_patient_registrations,
       (SELECT COUNT(*) FROM ng_programme_patient_enrollments e
         WHERE e.programme_id=$1 AND e.facility_id=$2 AND e.status IN ('active','paused','transferred')) AS active_patients,
       (SELECT COUNT(*) FROM ng_clinical_encounters e
         WHERE e.programme_id=$1 AND e.facility_id=$2 AND e.started_at >= $3 AND e.started_at < $4) AS total_consultations,
       (SELECT COUNT(*) FROM ng_clinical_encounters e
         WHERE e.programme_id=$1 AND e.facility_id=$2 AND e.encounter_type='phc_assisted_telehealth'
           AND e.started_at >= $3 AND e.started_at < $4) AS teleconsultations,
       (SELECT COUNT(*) FROM ng_phc_queue_entries q
         WHERE q.programme_id=$1 AND q.facility_id=$2 AND q.status='completed'
           AND q.completed_at >= $3 AND q.completed_at < $4) AS completed_consultations,
       (SELECT COUNT(*) FROM ng_phc_queue_entries q
         WHERE q.programme_id=$1 AND q.facility_id=$2 AND q.status='cancelled'
           AND q.updated_at >= $3 AND q.updated_at < $4) AS cancelled_consultations,
       (SELECT COUNT(*) FROM ng_appointments a
         WHERE a.programme_id=$1 AND a.hospital_id=$2 AND a.created_at >= $3 AND a.created_at < $4) AS appointment_bookings,
       (SELECT COUNT(*) FROM ng_referrals r
         WHERE r.programme_id=$1 AND r.facility_id=$2 AND r.created_at >= $3 AND r.created_at < $4) AS referrals_created,
       (SELECT COUNT(*) FROM ng_referrals r
         WHERE r.programme_id=$1 AND r.facility_id=$2 AND r.status='completed'
           AND r.completed_at >= $3 AND r.completed_at < $4) AS referrals_completed,
       (SELECT COUNT(*) FROM ng_referrals r
         WHERE r.programme_id=$1 AND r.facility_id=$2
           AND r.status NOT IN ('completed','cancelled','declined')) AS pending_referrals,
       (SELECT COUNT(*) FROM ng_digital_prescriptions p
         WHERE p.programme_id=$1 AND p.facility_id=$2 AND p.created_at >= $3 AND p.created_at < $4) AS prescriptions_created,
       (SELECT COUNT(DISTINCT a.provider_user_id) FROM ng_clinician_programme_assignments a
         WHERE a.programme_id=$1 AND (a.facility_id IS NULL OR a.facility_id=$2) AND a.status='active') AS active_providers,
       (SELECT COUNT(*) FROM ng_programme_facilities f
         WHERE f.programme_id=$1 AND f.facility_id=$2 AND f.status='active') AS active_facilities,
       (SELECT COUNT(*) FROM public_health_reports r
         WHERE r.programme_id=$1 AND r.hospital_id=$2 AND r.report_period=$5) AS reports_generated,
       (SELECT COUNT(*) FROM ng_phc_queue_entries q
         WHERE q.programme_id=$1 AND q.facility_id=$2 AND q.status='completed'
           AND q.completed_at >= $3 AND q.completed_at < $4) AS service_utilization`,
    [context.programme_id, context.facility_id, parsed.start, parsed.end, parsed.period]
  );
  const metrics = Object.fromEntries(
    Object.entries(result.rows[0] || {}).map(([key, value]) => [key, numberOrZero(value)])
  );
  return { ...parsed, metrics };
}

async function loadApprovedDefinitions(pool, context, metricKeys) {
  const result = await pool.query(
    `SELECT d.id, d.source_version, d.source_table, d.null_policy,
            d.numerator_definition_json, d.denominator_definition_json,
            i.id AS indicator_id, i.internal_key, i.display_name,
            i.aggregation_type, i.dhis2_data_element_id,
            i.dhis2_category_option_combo_id
       FROM ng_indicator_source_definitions d
       JOIN public_health_indicators i ON i.id = d.indicator_id
      WHERE d.programme_id = $1 AND d.status = 'approved'
        AND i.active = TRUE AND i.internal_key = ANY($2::TEXT[])
        AND d.source_version = (
          SELECT MAX(latest.source_version)
            FROM ng_indicator_source_definitions latest
           WHERE latest.programme_id=d.programme_id AND latest.indicator_id=d.indicator_id
             AND latest.status='approved'
        )
      ORDER BY i.programme_area, i.display_name`,
    [context.programme_id, metricKeys]
  );
  return result.rows;
}

async function previewReport(pool, context, period) {
  const aggregate = await aggregateMetrics(pool, context, period);
  const definitions = await loadApprovedDefinitions(pool, context, Object.keys(aggregate.metrics));
  const approvedKeys = new Set(definitions.map((item) => item.internal_key));
  const values = definitions.map((definition) => ({
    indicatorId: definition.indicator_id,
    internalKey: definition.internal_key,
    displayName: definition.display_name,
    aggregationType: definition.aggregation_type,
    value: aggregate.metrics[definition.internal_key],
    sourceDefinitionId: definition.id,
    sourceVersion: definition.source_version,
    sourceTable: definition.source_table,
    dataStatus: 'observed',
  }));
  const unavailable = Object.keys(aggregate.metrics).filter((key) => !approvedKeys.has(key));
  const reconciliationHash = crypto.createHash('sha256').update(canonicalJson({
    programmeId: context.programme_id,
    facilityId: context.facility_id,
    period: aggregate.period,
    values: values.map(({ internalKey, sourceVersion, value }) => ({ internalKey, sourceVersion, value })),
  })).digest('hex');
  return {
    period: aggregate.period,
    programmeId: context.programme_id,
    facilityId: context.facility_id,
    aggregateOnly: true,
    containsPatientIdentifiers: false,
    values,
    unavailable,
    sourceReconciliationHash: reconciliationHash,
  };
}

async function generateReport(pool, req, context, { period, notes = null }) {
  const preview = await previewReport(pool, context, period);
  if (!preview.values.length) {
    throw scopeError(409, 'No approved indicator source definitions are available.', 'REPORT_SOURCES_UNAPPROVED');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const facilityResult = await client.query(
      `SELECT id, lga FROM public_health_facilities
        WHERE hospital_id = $1 AND active = TRUE LIMIT 1`,
      [context.facility_id]
    );
    if (!facilityResult.rows.length) {
      throw scopeError(409, 'Reporting facility mapping is unavailable.', 'REPORTING_FACILITY_MAPPING_REQUIRED');
    }
    const sourceVersion = Math.max(...preview.values.map((item) => Number(item.sourceVersion) || 1));
    const reportResult = await client.query(
      `INSERT INTO public_health_reports
         (report_period, report_type, facility_id, lga, status, generated_by,
          notes, metadata_json, programme_id, hospital_id,
          source_definition_version, source_reconciliation_hash, contains_patient_identifiers)
       VALUES ($1,'phc_monthly_aggregate',$2,$3,'generated',$4,$5,$6::JSONB,
               $7,$8,$9,$10,FALSE)
       RETURNING *`,
      [
        preview.period,
        facilityResult.rows[0].id,
        facilityResult.rows[0].lga,
        context.userId,
        notes,
        JSON.stringify({
          generatedFrom: 'programme_scoped_phc_aggregates',
          excludesPatientIdentifiers: true,
          sourceDefinitionIds: preview.values.map((item) => item.sourceDefinitionId),
          unavailableIndicators: preview.unavailable,
        }),
        context.programme_id,
        context.facility_id,
        sourceVersion,
        preview.sourceReconciliationHash,
      ]
    );
    for (const value of preview.values) {
      await client.query(
        `INSERT INTO public_health_report_values
           (report_id, indicator_id, value, metadata_json)
         VALUES ($1,$2,$3,$4::JSONB)`,
        [
          reportResult.rows[0].id,
          value.indicatorId,
          value.value,
          JSON.stringify({
            sourceDefinitionId: value.sourceDefinitionId,
            sourceVersion: value.sourceVersion,
            sourceTable: value.sourceTable,
            noPatientIdentifiers: true,
            dataStatus: value.dataStatus,
          }),
        ]
      );
    }
    await recordProgrammeAudit(client, req, context, {
      action: 'aggregate_report_generated',
      resourceType: 'public_health_report',
      resourceId: reportResult.rows[0].id,
      purpose: 'Programme performance reporting',
      dataClass: 'aggregate',
      metadata: {
        period: preview.period,
        indicatorCount: preview.values.length,
        sourceReconciliationHash: preview.sourceReconciliationHash,
      },
    });
    await client.query('COMMIT');
    return { report: reportResult.rows[0], values: preview.values };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listReports(pool, context, limit = 25) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const result = await pool.query(
    `SELECT id, report_period, report_type, status, source_definition_version,
            source_reconciliation_hash, contains_patient_identifiers,
            created_at, approved_at, exported_at
       FROM public_health_reports
      WHERE programme_id=$1 AND hospital_id=$2
      ORDER BY created_at DESC LIMIT $3`,
    [context.programme_id, context.facility_id, safeLimit]
  );
  return result.rows;
}

async function buildDhis2DryRun(pool, req, context, reportId) {
  const reportResult = await pool.query(
    `SELECT r.*, f.dhis2_org_unit_id
       FROM public_health_reports r
       LEFT JOIN public_health_facilities f ON f.id=r.facility_id
      WHERE r.id=$1 AND r.programme_id=$2 AND r.hospital_id=$3
        AND r.contains_patient_identifiers=FALSE
      LIMIT 1`,
    [reportId, context.programme_id, context.facility_id]
  );
  const report = reportResult.rows[0];
  if (!report) throw scopeError(404, 'Aggregate report not found.', 'REPORT_NOT_FOUND');
  const valuesResult = await pool.query(
    `SELECT v.value, i.internal_key, i.dhis2_data_element_id,
            i.dhis2_category_option_combo_id
       FROM public_health_report_values v
       JOIN public_health_indicators i ON i.id=v.indicator_id
      WHERE v.report_id=$1 ORDER BY i.internal_key`,
    [reportId]
  );
  const settingsResult = await pool.query(
    `SELECT dataset_id, org_unit_id, attribute_option_combo_id,
            enabled, dry_run_only, government_approval_status,
            data_sharing_agreement_status, api_credentials_status
       FROM dhis2_integration_settings
      WHERE programme_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [context.programme_id]
  );
  const settings = settingsResult.rows[0] || {};
  const mapped = valuesResult.rows.filter((value) => value.dhis2_data_element_id && value.value != null);
  const missingMappings = valuesResult.rows
    .filter((value) => !value.dhis2_data_element_id)
    .map((value) => value.internal_key);
  const parsed = parsePeriod(report.report_period);
  const payload = {
    dataSet: settings.dataset_id || null,
    period: parsed.dhis2Period,
    orgUnit: report.dhis2_org_unit_id || settings.org_unit_id || null,
    attributeOptionCombo: settings.attribute_option_combo_id || undefined,
    dataValues: mapped.map((value) => ({
      dataElement: value.dhis2_data_element_id,
      categoryOptionCombo: value.dhis2_category_option_combo_id || undefined,
      value: Number(value.value),
    })),
  };
  const blockers = [];
  if (!payload.dataSet) blockers.push('DHIS2 dataset ID is not configured.');
  if (!payload.orgUnit) blockers.push('DHIS2 organisation-unit ID is not configured.');
  if (missingMappings.length) blockers.push(`${missingMappings.length} indicator mapping(s) are missing.`);
  if (settings.government_approval_status !== 'approved') blockers.push('Government reporting approval is pending.');
  if (settings.data_sharing_agreement_status !== 'approved') blockers.push('Data-sharing agreement approval is pending.');
  await recordProgrammeAudit(pool, req, context, {
    action: 'dhis2_dry_run_generated',
    resourceType: 'public_health_report',
    resourceId: report.id,
    purpose: 'DHIS2 readiness validation',
    dataClass: 'aggregate',
    metadata: { blockerCount: blockers.length, mappedValueCount: payload.dataValues.length },
  });
  return {
    reportId: report.id,
    dryRunOnly: true,
    liveSubmissionEnabled: false,
    containsPatientIdentifiers: false,
    payload,
    payloadHash: crypto.createHash('sha256').update(canonicalJson(payload)).digest('hex'),
    blockers,
    missingMappings,
  };
}

module.exports = {
  aggregateMetrics,
  buildDhis2DryRun,
  generateReport,
  listReports,
  parsePeriod,
  previewReport,
};
