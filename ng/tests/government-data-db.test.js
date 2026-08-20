'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const ExcelJS = require('exceljs');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required: government database tests must run against disposable PostgreSQL and may not be skipped.');
}

const { getPool, close } = require('../../server/db');
const { runNgMigrations } = require('../migrations/migrate');
const service = require('../services/public-health/governmentDataService');
const rbac = require('../middleware/rbac');

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let context;

test('migration ledger is idempotent and checksum-backed', async () => {
  const pool = getPool();
  const secondRun = await runNgMigrations(pool);
  assert.equal(secondRun.ran, 0);
  const ledger = await pool.query(`SELECT filename,checksum FROM ng_migrations WHERE filename='019_ng_government_data_platform.sql'`);
  assert.equal(ledger.rows.length, 1);
  assert.match(ledger.rows[0].checksum.trim(), /^[a-f0-9]{64}$/);
});

test('CSV, XLSX, and JSON intake parsers preserve missing observations', async () => {
  const csv = await service.parseFile(Buffer.from('Record ID,Indicator,Value\nA,pnc_within_24h_percentage,92\nB,pnc_within_24h_percentage,\n'), 'pilot.csv', 'text/csv');
  assert.equal(csv.rows.length, 2);
  assert.equal(csv.rows[1].Value, null);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Observations');
  sheet.addRow(['Record ID', 'Indicator', 'Value']);
  sheet.addRow(['X1', 'pnc_within_24h_percentage', 94]);
  const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const xlsx = await service.parseFile(xlsxBuffer, 'pilot.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(xlsx.sourceType, 'xlsx');
  assert.equal(xlsx.rows[0].Value, 94);

  const json = await service.parseFile(Buffer.from(JSON.stringify({ records: [{ id: 'J1', value: null }] })), 'pilot.json', 'application/json');
  assert.equal(json.rows[0].value, null);
});

test('government imports enforce scope, maker-checker, quarantine, duplicate detection, commit, export, and rollback', async () => {
  const pool = getPool();
  const users = await pool.query(
    `INSERT INTO users (email,password_hash,role,is_active)
     VALUES ($1,'not-a-login-secret','patient',TRUE),($2,'not-a-login-secret','patient',TRUE),($3,'not-a-login-secret','patient',TRUE)
     RETURNING id,email`,
    [`maker-${suffix}@example.test`, `checker-${suffix}@example.test`, `outsider-${suffix}@example.test`]
  );
  const [maker, checker, outsider] = users.rows;
  const fct = (await pool.query(`SELECT id FROM ng_jurisdictions WHERE code='FCT'`)).rows[0];
  const amac = (await pool.query(`SELECT id FROM ng_jurisdictions WHERE code='AMAC'`)).rows[0];
  const facility = (await pool.query(
    `INSERT INTO public_health_facilities (name,facility_type,ownership_type,lga,state,active)
     VALUES ($1,'primary_health_centre','public','AMAC','FCT',TRUE) RETURNING id`, [`Fictional PHC ${suffix}`]
  )).rows[0];
  await pool.query(
    `INSERT INTO ng_user_jurisdiction_roles
       (user_id,jurisdiction_id,role,facility_id,programme_area,can_export,can_approve,data_class_level)
     VALUES ($1,$3,'analyst',$4,'maternal_health',TRUE,FALSE,'aggregate'),
            ($2,$3,'approver',$4,'maternal_health',TRUE,TRUE,'aggregate')`,
    [maker.id, checker.id, amac.id, facility.id]
  );
  const source = await service.registerSource({
    name: `Fictional monthly source ${suffix}`,
    sourceType: 'csv',
    jurisdictionId: amac.id,
    facilityId: facility.id,
    programmeArea: 'maternal_health',
  }, maker);
  const mapping = await service.saveMapping(source.id, {
    name: 'Monthly aggregate mapping',
    fieldMap: { recordKey: 'record_id', title: 'label', indicatorKey: 'indicator', observedValue: 'value' },
  }, maker);
  const rows = [
    { record_id: 'PNC-A', label: 'PNC within 24 hours', indicator: 'pnc_within_24h_percentage', value: 92 },
    { record_id: 'PNC-A', label: 'Duplicate PNC record', indicator: 'pnc_within_24h_percentage', value: 92 },
    { record_id: 'PNC-MISSING', label: 'PNC observation unavailable', indicator: 'pnc_within_24h_percentage', value: null },
    { record_id: 'PNC-PII', label: 'Unsafe row', indicator: 'pnc_within_24h_percentage', value: 5, patient_name: 'Fictional Person' },
  ];
  const rawBuffer = Buffer.from('fictional-government-intake');
  const created = await service.createImport({
    sourceId: source.id, mappingId: mapping.id, jurisdictionId: amac.id, facilityId: facility.id,
    programmeArea: 'maternal_health', reportingPeriod: '2099-01', rows, rawBuffer,
    filename: 'fictional.csv', mediaType: 'text/csv',
  }, maker);
  assert.equal(created.created, true);
  const duplicateUpload = await service.createImport({
    sourceId: source.id, mappingId: mapping.id, jurisdictionId: amac.id, facilityId: facility.id,
    programmeArea: 'maternal_health', reportingPeriod: '2099-01', rows, rawBuffer,
    filename: 'fictional.csv', mediaType: 'text/csv',
  }, maker);
  assert.equal(duplicateUpload.duplicateUpload, true);
  assert.equal(duplicateUpload.batch.id, created.batch.id);

  const validation = await service.validateBatch(created.batch.id, maker);
  assert.deepEqual({ valid: validation.valid, duplicate: validation.duplicate, quarantined: validation.quarantined, missing: validation.missing }, { valid: 2, duplicate: 1, quarantined: 1, missing: 1 });
  assert.equal(validation.reconciled, true);
  const report = await service.getBatchReport(created.batch.id);
  assert.ok(report.findings.some((finding) => finding.finding_code === 'DIRECT_IDENTIFIER'));
  assert.ok(report.findings.some((finding) => finding.finding_code === 'MISSING_OBSERVATION'));
  assert.equal(report.rows.find((row) => row.source_row_number === 3).mapped_payload_json.observedValue, null);

  await service.decideBatch(created.batch.id, 'submit', maker, 'Fictional validation complete');
  await assert.rejects(
    () => service.decideBatch(created.batch.id, 'approve', maker, 'Self approval must fail'),
    /different user/
  );
  await service.decideBatch(created.batch.id, 'approve', checker, 'Independent fictional approval');
  const committed = await service.commitBatch(created.batch.id, checker);
  assert.equal(committed.committed, 2);
  const committedAgain = await service.commitBatch(created.batch.id, checker);
  assert.equal(committedAgain.idempotent, true);
  const committedReport = await service.getBatchReport(created.batch.id);
  const commitReconciliation = committedReport.reconciliations.find((item) => item.stage === 'commit');
  assert.equal(commitReconciliation.reconciled, true);
  assert.equal(commitReconciliation.source_row_count, 4);
  assert.equal(commitReconciliation.valid_row_count, 2);
  assert.equal(commitReconciliation.missing_value_count, 1);
  assert.equal(Number(commitReconciliation.observed_numeric_total), 92);

  const inScope = await service.searchRecords({ q: 'PNC', facilityId: facility.id }, maker, [amac.id]);
  assert.equal(inScope.total, 2);
  assert.ok(inScope.records.some((record) => record.observed_value === null));
  const crossJurisdiction = await service.searchRecords({ q: 'PNC' }, outsider, [fct.id]);
  assert.equal(crossJurisdiction.total, 0);
  assert.equal(await rbac.userCanAccessResource({ id: outsider.id, role: 'patient' }, { jurisdictionId: amac.id, facilityId: facility.id, programmeArea: 'maternal_health' }), false);

  const csvExport = await service.exportSearch('csv', { facilityId: facility.id }, maker, [amac.id]);
  assert.match(csvExport.body, /Missing — not zero|""/);
  const xlsxExport = await service.exportSearch('xlsx', { facilityId: facility.id }, maker, [amac.id]);
  assert.ok(xlsxExport.body.length > 500);
  const pdfExport = await service.exportSearch('pdf', { facilityId: facility.id }, maker, [amac.id]);
  assert.equal(pdfExport.body.subarray(0, 4).toString(), '%PDF');
  const dhis2 = await service.dhis2Export(created.batch.id);
  assert.equal(dhis2.dataValues.length, 0);
  assert.equal(dhis2.omissions.length, 2);

  const rolledBack = await service.rollbackBatch(created.batch.id, checker, 'Fictional rollback recovery proof');
  assert.equal(rolledBack.rolledBack, 2);
  const afterRollback = await service.searchRecords({ q: 'PNC', facilityId: facility.id }, maker, [amac.id]);
  assert.equal(afterRollback.total, 0);
  context = { maker, checker, outsider, amac, facility };
});

test('government accounts are invitation-only, require MFA enrollment, and revoke immediately', async () => {
  const pool = getPool();
  const email = `invitee-${suffix}@example.test`;
  const created = await service.createGovernmentInvitation({
    email, jurisdictionId: context.amac.id, facilityId: context.facility.id,
    programmeArea: 'maternal_health', role: 'executive_read_only', canExport: false,
    dataClassLevel: 'sensitive', expiresHours: 1,
  }, context.checker);
  const accepted = await service.acceptGovernmentInvitation({
    token: created.token, password: 'Fictional-Only-Password-2099!', firstName: 'Fictional', lastName: 'Executive',
  });
  assert.equal(accepted.requiresMfaEnrollment, true);
  const account = (await pool.query(
    `SELECT u.is_active,u.mfa_enabled,r.role,r.data_class_level,r.active
       FROM users u JOIN ng_user_jurisdiction_roles r ON r.user_id=u.id WHERE u.id=$1`, [accepted.user.id]
  )).rows[0];
  assert.equal(account.mfa_enabled, false);
  assert.equal(account.role, 'executive_read_only');
  assert.equal(account.data_class_level, 'aggregate');
  await assert.rejects(() => service.acceptGovernmentInvitation({ token: created.token, password: 'Fictional-Only-Password-2099!' }), /invalid, expired, used, or revoked/);
  const revoked = await service.revokeGovernmentAccount(accepted.user.id, context.checker);
  assert.equal(revoked.revoked, true);
  const inactive = (await pool.query('SELECT is_active FROM users WHERE id=$1', [accepted.user.id])).rows[0];
  assert.equal(inactive.is_active, false);
  const activeScopes = await pool.query('SELECT COUNT(*)::int AS count FROM ng_user_jurisdiction_roles WHERE user_id=$1 AND active=TRUE', [accepted.user.id]);
  assert.equal(activeScopes.rows[0].count, 0);
});

test.after(async () => {
  await close();
});
