const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SCENARIO_NAMES,
  createFakeClient,
  permissionFor,
  resolveSimulationDemoPassword,
  runClinicalSimulation,
} = require('../scripts/simulate-live-clinical-workflows');
const {
  looksProductionLike,
  resolveSimulationDatabaseUrl,
} = require('../scripts/simulationSafety');

test('clinical simulation dry run completes every healthcare workflow scenario', async () => {
  const evidence = await runClinicalSimulation({ dryRun: true, runId: 'test-clinical-dry-run' });
  assert.equal(evidence.finalResult, 'pass');
  assert.equal(evidence.scenarios.length, SCENARIO_NAMES.length);
  assert.deepEqual(evidence.scenarios.map((scenario) => scenario.name), SCENARIO_NAMES);
  assert.ok(evidence.records.soapNoteId);
  assert.ok(evidence.records.prescriptionId);
  assert.ok(evidence.records.referralId);
  assert.ok(evidence.scenarios.some((scenario) => scenario.details?.deniedSafely));
});

test('clinical role matrix enforces nurse, pharmacist, and intern limits', () => {
  assert.equal(permissionFor('Nurse', 'record_vitals'), true);
  assert.equal(permissionFor('Nurse', 'create_prescription'), false);
  assert.equal(permissionFor('Pharmacist', 'dispense_prescription'), true);
  assert.equal(permissionFor('Pharmacist', 'create_soap'), false);
  assert.equal(permissionFor('Intern Observer', 'view_record'), true);
  assert.equal(permissionFor('Intern Observer', 'create_soap'), false);
});

test('simulation safety refuses production-like DATABASE_URL by default', () => {
  assert.equal(looksProductionLike('postgres://user:pass@ep-green.neon.tech/db'), true);
  assert.throws(
    () => resolveSimulationDatabaseUrl({
      DATABASE_URL: 'postgres://user:pass@ep-green.neon.tech/db',
    }),
    /Refusing to mutate DATABASE_URL/
  );
  assert.throws(
    () => resolveSimulationDatabaseUrl({
      SIMULATION_DATABASE_URL: 'postgres://user:pass@ep-green.neon.tech/db',
    }),
    /Refusing production-like simulation target/
  );
});

test('simulation safety allows explicit non-production simulation URL', () => {
  const resolved = resolveSimulationDatabaseUrl({
    SIMULATION_DATABASE_URL: 'postgres://user:pass@localhost:5432/doctarx_sim',
  });
  assert.equal(resolved.source, 'SIMULATION_DATABASE_URL');
  assert.match(resolved.redactedUrl, /<redacted>/);
});

test('live database simulation requires explicit demo password source', () => {
  assert.equal(
    resolveSimulationDemoPassword({ dryRun: true, env: {} }),
    'DoctaRxDemo!2026'
  );
  assert.throws(
    () => resolveSimulationDemoPassword({ dryRun: false, env: {} }),
    /Set NG_DEMO_PASSWORD/
  );
  assert.equal(
    resolveSimulationDemoPassword({
      dryRun: false,
      env: { ALLOW_DEFAULT_DEMO_PASSWORD: 'true' },
    }),
    'DoctaRxDemo!2026'
  );
  assert.equal(
    resolveSimulationDemoPassword({
      dryRun: false,
      env: { NG_DEMO_PASSWORD: 'custom-demo-password' },
    }),
    'custom-demo-password'
  );
});

test('fake client records SQL operations for dry-run verification', async () => {
  const client = createFakeClient();
  await client.query('SELECT to_regclass($1) AS table_name', ['users']);
  assert.equal(client.queries.length, 1);
  assert.equal(client.queries[0].params[0], 'users');
});
