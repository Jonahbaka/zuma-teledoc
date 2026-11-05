'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { fixtureTargetSafety } = require('../../ng/scripts/fixtureTargetSafety');
const target = process.env.SIMULATION_DATABASE_URL;
// Validate before importing database clients; never fall back to DATABASE_URL.
if (target) {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
}

const access = require('../services/predictive-engine/access-policy');
const { artifactDigest, CONTRACT } = require('../services/predictive-engine/model-validation');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('PostgreSQL predictive access preserves current patient authority and atomic mutations', { skip: !target, timeout: 40000 }, async (t) => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target, max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 1000 });
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL', pool });
  assert.equal(safety.skipped, false, safety.reason);
  // Optional predictive schema is deliberately absent from the core baseline.
  // Create it from the real migration in this run's private schema so a clean
  // core+NG CI database needs no manually installed optional tables.
  const schema = `predictive_fixture_${crypto.randomBytes(12).toString('hex')}`;
  assert.match(schema, /^predictive_fixture_[a-f0-9]{24}$/);
  const acquire = async () => {
    const client = await pool.connect();
    try { await client.query(`SET search_path TO "${schema}",public`); return client; }
    catch (error) { client.release(); throw error; }
  };
  const database = { getClient: acquire };
  const ids = Object.fromEntries(['patient', 'otherPatient', 'ngPatient', 'provider', 'otherProvider', 'model', 'prediction', 'legacyPrediction', 'otherPrediction', 'alert', 'otherAlert', 'wrongOwnerAlert'].map(key => [key, crypto.randomUUID()]));
  const users = [ids.patient, ids.otherPatient, ids.ngPatient, ids.provider, ids.otherProvider];
  const predictionIds = [ids.prediction, ids.legacyPrediction, ids.otherPrediction];
  const alertIds = [ids.alert, ids.otherAlert, ids.wrongOwnerAlert];
  const actor = { id: ids.provider, role: 'provider', marketScope: 'US' };
  const priorApprovals = process.env.PREDICTIVE_MODEL_APPROVALS_JSON;
  const fixture = await acquire();
  let fixturesCommitted = false;
  try {
    await fixture.query('BEGIN');
    await fixture.query(`CREATE SCHEMA "${schema}"`);
    assert.equal((await fixture.query('SELECT current_schema() AS name')).rows[0].name, schema);
    await fixture.query(fs.readFileSync(require.resolve('../db/migrations/300_predictive_engine_schema.sql'), 'utf8'));
    for (const id of users) {
      const role = [ids.provider, ids.otherProvider].includes(id) ? 'provider' : 'patient';
      const market = id === ids.ngPatient ? 'NG' : 'US';
      await fixture.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,market_scope,region,country,is_active,is_test_account,provider_status,must_change_password)
        VALUES($1,$2,'!isolated-no-login',$3,'Fictional','Predictive test',$4,$5,$6,TRUE,TRUE,'approved',FALSE)`, [id, `predictive-${id}@example.invalid`, role, market, market, market]);
    }
    await fixture.query('INSERT INTO provider_patient_relationships(provider_id,patient_id,is_active) VALUES($1,$2,TRUE)', [ids.provider, ids.patient]);
    const { rows: [model] } = await fixture.query(`INSERT INTO ml_models(id,model_name,model_version,model_type,algorithm,model_weights,feature_names,preprocessing_config,hyperparameters,status,is_champion,trained_by)
      VALUES($1,$2,'test-1','no_show','logistic_regression',$3::jsonb,$4::jsonb,'{}','{}','production',FALSE,'fictional-test-only') RETURNING *`,
    [ids.model, `fictional_authority_${ids.model}`, JSON.stringify({ intercept: 0, recorded_value: 0.1 }), JSON.stringify(['recorded_value'])]);
    const digest = artifactDigest(model);
    process.env.PREDICTIVE_MODEL_APPROVALS_JSON = JSON.stringify([{
      modelId: ids.model, artifactSha256: digest, markets: ['US'], inputContract: CONTRACT,
      reviewedBy: 'Fictional test reviewer', evidenceReference: 'fictional-fixture-only',
      reviewedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      maxInputAgeSeconds: 60, featureRanges: { recorded_value: [0, 10] },
    }]);
    for (const id of predictionIds) {
      await fixture.query(`INSERT INTO ml_predictions(id,model_id,model_name,model_version,patient_hash,prediction_type,risk_score,risk_level,prediction_label,request_context)
        VALUES($1,$2,$3,'test-1',$4,'no_show',0.2,'low','Fictional output',$5::jsonb)`,
      [id, ids.model, model.model_name, access.hash(id === ids.otherPrediction ? ids.otherPatient : ids.patient),
        JSON.stringify(id === ids.legacyPrediction ? {} : { artifactSha256: digest, market: 'US', inputContract: CONTRACT })]);
    }
    for (const id of alertIds) {
      await fixture.query(`INSERT INTO ml_alerts(id,prediction_id,alert_type,severity,title,message,target_user_id,status)
        VALUES($1,$2,'operational','low','Fictional test alert','Fictional test only',$3,'active')`,
      [id, id === ids.otherAlert ? ids.otherPrediction : ids.prediction, id === ids.wrongOwnerAlert ? ids.otherProvider : ids.provider]);
    }
    await fixture.query('COMMIT');
    fixturesCommitted = true;

    const scoped = (work, auditContext) => access.withPatient(database, ids.patient, actor, work, auditContext);
    await t.test('authorized history is patient-scoped and omits predictions without approved provenance', async () => {
      const rows = await scoped((client, scope) => access.history(client, scope), { operation: 'history' });
      assert.deepEqual(rows.map(row => row.id), [ids.prediction]);
      assert.equal(rows[0].requiresClinicalReview, true);
      assert.deepEqual((await scoped((client, scope) => access.alerts(client, scope))).map(row => row.id), [ids.alert]);
    });

    await t.test('cross-market, unrelated provider, and patient-role calls fail before patient work', async () => {
      for (const [patient, unauthorized] of [
        [ids.patient, { ...actor, marketScope: 'NG' }],
        [ids.ngPatient, actor],
        [ids.patient, { ...actor, id: ids.otherProvider }],
        [ids.patient, { id: ids.patient, role: 'patient', marketScope: 'US' }],
      ]) await assert.rejects(access.withPatient(database, patient, unauthorized, () => assert.fail('unauthorized work executed')), { statusCode: 403 });
    });

    await t.test('patient and alert ownership are checked again for individual mutations', async () => {
      for (const id of [ids.otherAlert, ids.wrongOwnerAlert]) {
        await assert.rejects(scoped((client, scope) => access.acknowledge(client, scope, id)), { statusCode: 404 });
      }
      for (const id of [ids.otherPrediction, ids.legacyPrediction]) {
        await assert.rejects(scoped((client, scope) => access.outcome(client, scope, id, 'positive')), { statusCode: 404 });
      }
      const rows = (await fixture.query('SELECT status FROM ml_alerts WHERE id=ANY($1::uuid[])', [alertIds])).rows;
      assert.ok(rows.every(row => row.status === 'active'));
    });

    await t.test('a downstream transaction failure rolls back both alert and outcome changes', async () => {
      await assert.rejects(scoped(async (client, scope) => {
        await access.acknowledge(client, scope, ids.alert, 'Fictional review');
        await access.outcome(client, scope, ids.prediction, 'positive');
        throw new Error('Fictional downstream failure');
      }), /Fictional downstream failure/);
      const alert = (await fixture.query('SELECT status,acknowledged_by,action_taken FROM ml_alerts WHERE id=$1', [ids.alert])).rows[0];
      assert.deepEqual(alert, { status: 'active', acknowledged_by: null, action_taken: null });
      assert.equal((await fixture.query('SELECT actual_outcome FROM ml_predictions WHERE id=$1', [ids.prediction])).rows[0].actual_outcome, null);
    });

    await t.test('durable audit failure suppresses reads and rolls back alert and outcome mutations', async () => {
      let rejectedAudits = 0;
      const auditUnavailable = {
        async getClient() {
          const client = await acquire();
          return {
            query(sql, parameters) {
              if (/INSERT\s+INTO\s+audit_logs/i.test(sql)) {
                rejectedAudits += 1;
                throw new Error('Fictional durable audit failure');
              }
              return client.query(sql, parameters);
            },
            release() { client.release(); },
          };
        },
      };
      // Only the audit insert is fault-injected. Authority, locks, mutations and
      // rollback execute on the real PostgreSQL client; no global trigger exists.
      const failAudited = (work, auditContext) => access.withPatient(auditUnavailable, ids.patient, actor, work, auditContext);
      await assert.rejects(failAudited((client, scope) => access.history(client, scope), { operation: 'history' }), /Fictional durable audit failure/);
      await assert.rejects(failAudited((client, scope) => access.acknowledge(client, scope, ids.alert, 'Fictional attempted action'), { operation: 'acknowledge', resourceId: ids.alert }), /Fictional durable audit failure/);
      await assert.rejects(failAudited((client, scope) => access.outcome(client, scope, ids.prediction, 'positive'), { operation: 'outcome', resourceId: ids.prediction }), /Fictional durable audit failure/);
      assert.equal(rejectedAudits, 3);
      const alert = (await fixture.query('SELECT status,acknowledged_by,action_taken FROM ml_alerts WHERE id=$1', [ids.alert])).rows[0];
      assert.deepEqual(alert, { status: 'active', acknowledged_by: null, action_taken: null });
      assert.equal((await fixture.query('SELECT actual_outcome FROM ml_predictions WHERE id=$1', [ids.prediction])).rows[0].actual_outcome, null);
    });

    await t.test('authorized mutations commit with clinician ownership and no invented correctness score', async () => {
      assert.deepEqual(await scoped((client, scope) => access.acknowledge(client, scope, ids.alert, 'Fictional reviewed action'), { operation: 'acknowledge', resourceId: ids.alert }), { acknowledged: true });
      assert.deepEqual(await scoped((client, scope) => access.outcome(client, scope, ids.prediction, 'negative'), { operation: 'outcome', resourceId: ids.prediction }), { recorded: true });
      const alert = (await fixture.query('SELECT status,acknowledged_by FROM ml_alerts WHERE id=$1', [ids.alert])).rows[0];
      assert.deepEqual(alert, { status: 'acted_upon', acknowledged_by: ids.provider });
      const prediction = (await fixture.query('SELECT actual_outcome,prediction_correct FROM ml_predictions WHERE id=$1', [ids.prediction])).rows[0];
      assert.deepEqual(prediction, { actual_outcome: 'negative', prediction_correct: null });
      await fixture.query("UPDATE ml_alerts SET status='active' WHERE id=$1", [ids.alert]);
      assert.deepEqual(await scoped((client, scope) => access.acknowledge(client, scope, ids.alert), { operation: 'acknowledge', resourceId: ids.alert }), { acknowledged: true });
      const plain = (await fixture.query('SELECT status,action_taken,action_taken_at FROM ml_alerts WHERE id=$1', [ids.alert])).rows[0];
      assert.deepEqual(plain, { status: 'acknowledged', action_taken: null, action_taken_at: null });
      const audits = (await fixture.query('SELECT action,resource_type,resource_id,description,phi_accessed,success FROM audit_logs WHERE user_id=$1 AND patient_id=$2', [ids.provider, ids.patient])).rows;
      for (const [action, resourceType, resourceId] of [['read', 'predictive_clinical', ids.patient], ['update', 'predictive_alert', ids.alert], ['update', 'predictive_outcome', ids.prediction]]) {
        assert.ok(audits.some(row => row.action === action && row.resource_type === resourceType && row.resource_id === resourceId && row.phi_accessed && row.success));
      }
      assert.ok(audits.every(row => /^Predictive [a-z_]+$/.test(row.description)));
      assert.ok(!JSON.stringify(audits).includes('Fictional reviewed action'));
    });

    await t.test('care relationship remains locked through work and revocation blocks subsequent reads and writes', async () => {
      const previousOutcome = (await fixture.query('SELECT actual_outcome FROM ml_predictions WHERE id=$1', [ids.prediction])).rows[0].actual_outcome;
      const entered = deferred(), release = deferred();
      const authorized = scoped(async (client, scope) => { entered.resolve(); await release.promise; return access.history(client, scope); });
      const revoker = await acquire();
      try {
        await Promise.race([entered.promise, authorized]);
        await revoker.query('BEGIN');
        await revoker.query("SET LOCAL lock_timeout='150ms'");
        await assert.rejects(revoker.query('UPDATE provider_patient_relationships SET is_active=FALSE WHERE provider_id=$1 AND patient_id=$2', [ids.provider, ids.patient]), { code: '55P03' });
        await revoker.query('ROLLBACK');
      } finally { await revoker.query('ROLLBACK'); release.resolve(); revoker.release(); }
      assert.equal((await authorized).length, 1);
      await fixture.query('UPDATE provider_patient_relationships SET is_active=FALSE WHERE provider_id=$1 AND patient_id=$2', [ids.provider, ids.patient]);
      await assert.rejects(scoped((client, scope) => access.history(client, scope)), { statusCode: 403 });
      await assert.rejects(scoped((client, scope) => access.outcome(client, scope, ids.prediction, 'positive')), { statusCode: 403 });
      assert.equal((await fixture.query('SELECT actual_outcome FROM ml_predictions WHERE id=$1', [ids.prediction])).rows[0].actual_outcome, previousOutcome);
    });
  } finally {
    if (priorApprovals === undefined) delete process.env.PREDICTIVE_MODEL_APPROVALS_JSON;
    else process.env.PREDICTIVE_MODEL_APPROVALS_JSON = priorApprovals;
    try {
      await fixture.query('ROLLBACK');
      if (fixturesCommitted) {
        await fixture.query('BEGIN');
        // The identifier is generated and validated above, never supplied by an
        // environment variable or request. Only this test's schema is dropped.
        await fixture.query(`DROP SCHEMA "${schema}" CASCADE`);
        await fixture.query('DELETE FROM provider_patient_relationships WHERE provider_id=$1 AND patient_id=$2', [ids.provider, ids.patient]);
        await fixture.query('DELETE FROM audit_logs WHERE user_id=ANY($1::uuid[])', [users]);
        await fixture.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
        await fixture.query('COMMIT');
      }
    } finally { fixture.release(); await pool.end(); }
  }
});
