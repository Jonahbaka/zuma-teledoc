'use strict';

process.env.NODE_ENV = 'test';
const bcrypt = require('bcryptjs');
const { getPool, close } = require('../server/db');
const service = require('../ng/services/public-health/governmentDataService');

const PASSWORD = process.env.E2E_ROLE_PASSWORD || 'Fictional-Role-Browser-2099!';
const MFA_SECRET = process.env.E2E_MFA_SECRET || 'JBSWY3DPEHPK3PXP';
const USERS = [
  ['e2e-patient@example.test', 'patient', null, false],
  ['e2e-provider@example.test', 'provider', 'approved', false],
  ['e2e-pharmacy@example.test', 'pharmacy', null, false],
  ['e2e-government@example.test', 'patient', null, true],
  ['e2e-checker@example.test', 'patient', null, true],
  ['e2e-executive@example.test', 'patient', null, true],
];

async function main() {
  const pool = getPool();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const created = {};
  for (const [email, role, providerStatus, mfa] of USERS) {
    const result = await pool.query(
      `INSERT INTO users
         (email,password_hash,role,first_name,last_name,is_active,is_verified,provider_status,mfa_enabled,mfa_secret)
       VALUES ($1,$2,$3,'Fictional','Browser',TRUE,TRUE,$4,$5,$6)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,
         first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,is_active=TRUE,is_verified=TRUE,
         provider_status=EXCLUDED.provider_status,mfa_enabled=EXCLUDED.mfa_enabled,mfa_secret=EXCLUDED.mfa_secret
       RETURNING id,email,role`,
      [email, passwordHash, role, providerStatus, mfa, mfa ? MFA_SECRET : null]
    );
    created[email] = result.rows[0];
  }
  const amac = (await pool.query(`SELECT id FROM ng_jurisdictions WHERE code='AMAC'`)).rows[0];
  const fct = (await pool.query(`SELECT id FROM ng_jurisdictions WHERE code='FCT'`)).rows[0];
  const facility = (await pool.query(
    `INSERT INTO public_health_facilities (name,facility_type,ownership_type,lga,state,active)
     VALUES ('Fictional Browser PHC','primary_health_centre','public','AMAC','FCT',TRUE) RETURNING id`
  )).rows[0];
  const maker = created['e2e-government@example.test'];
  const checker = created['e2e-checker@example.test'];
  const executive = created['e2e-executive@example.test'];
  await pool.query(
    `INSERT INTO ng_user_jurisdiction_roles
       (user_id,jurisdiction_id,role,facility_id,programme_area,can_export,can_approve,can_view_aggregate,data_class_level)
     VALUES ($1,$4,'analyst',$5,NULL,TRUE,FALSE,TRUE,'aggregate'),
            ($2,$4,'approver',$5,NULL,TRUE,TRUE,TRUE,'aggregate'),
            ($3,$6,'executive_read_only',NULL,NULL,FALSE,FALSE,TRUE,'aggregate')
     ON CONFLICT (user_id,jurisdiction_id,role) DO UPDATE SET active=TRUE,facility_id=EXCLUDED.facility_id,
       programme_area=EXCLUDED.programme_area,can_export=EXCLUDED.can_export,can_approve=EXCLUDED.can_approve,
       can_view_aggregate=EXCLUDED.can_view_aggregate,data_class_level=EXCLUDED.data_class_level`,
    [maker.id, checker.id, executive.id, amac.id, facility.id, fct.id]
  );
  const source = await service.registerSource({
    name: 'Fictional browser government source', sourceType: 'api', jurisdictionId: amac.id, facilityId: facility.id,
  }, maker);
  const mapping = await service.saveMapping(source.id, {
    name: 'Browser indicator mapping',
    fieldMap: { recordKey: 'recordKey', title: 'title', indicatorKey: 'indicatorKey', observedValue: 'value', unit: 'unit' },
  }, maker);
  const values = [
    ['pnc_within_24h_percentage', 93, '%'], ['anc_eight_component_completeness_percentage', 91, '%'],
    ['referral_completion_percentage', 89, '%'], ['referral_response_time_hours', 5.2, 'hours'],
    ['unresolved_cases', 3, 'cases'], ['service_utilization', 184, 'encounters'],
    ['continuity_of_care_percentage', 87, '%'], ['reporting_completeness_percentage', 96, '%'],
    ['reporting_timeliness_percentage', 92, '%'], ['data_quality_pass_percentage', 98, '%'],
    ['dhis2_readiness_percentage', 75, '%'],
  ];
  const rows = values.map(([indicatorKey, value, unit], index) => ({
    recordKey: `E2E-${index + 1}`, title: indicatorKey.replaceAll('_', ' '), indicatorKey, value, unit,
  }));
  const imported = await service.createImport({
    sourceId: source.id, mappingId: mapping.id, jurisdictionId: amac.id, facilityId: facility.id,
    programmeArea: 'browser_evidence', reportingPeriod: '2099-02', rows,
    idempotencyKey: 'fictional-browser-evidence-2099-02', mediaType: 'application/json',
  }, maker);
  if (imported.batch.status !== 'committed') {
    if (['previewed', 'draft'].includes(imported.batch.status)) await service.validateBatch(imported.batch.id, maker);
    const current = (await service.getBatchReport(imported.batch.id)).batch.status;
    if (current === 'validated') await service.decideBatch(imported.batch.id, 'submit', maker, 'Browser evidence');
    const submitted = (await service.getBatchReport(imported.batch.id)).batch.status;
    if (submitted === 'submitted') await service.decideBatch(imported.batch.id, 'approve', checker, 'Independent browser evidence approval');
    const approved = (await service.getBatchReport(imported.batch.id)).batch.status;
    if (approved === 'approved') await service.commitBatch(imported.batch.id, checker);
  }
  console.log('GOVERNMENT_BROWSER_SEED=PASS');
}

main().then(close).catch(async (error) => {
  console.error(error.message);
  await close();
  process.exit(1);
});
