'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const db = require('../db');
const encounters = require('../services/clinicalEncounterService');
const profiles = require('../services/patientClinicalProfileService');
const { encrypt, decrypt } = require('../../lib/encryption');
const { readClinicalNarrative } = require('../services/clinicalContentService');

const fields = ['follow_up_notes', 'amendment_reason', 'inactivation_reason', 'discontinuation_reason'];
function protectedRow(field, value, primitive = { encrypt }) {
  const secured = primitive.encrypt(value);
  return { [field + '_encrypted']: secured.encrypted, [field + '_iv']: secured.iv, [field + '_tag']: secured.tag };
}
function isolatedPrimitives(env) {
  const sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../lib/encryption'), 'utf8'), {
    module: sourceModule, exports: sourceModule.exports, Buffer, process: { env }, console: { error() {} },
    require(name) { assert.equal(name, 'crypto'); return crypto; },
  });
  return sourceModule.exports;
}
function isolatedReader(primitives) {
  const sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/clinicalContentService'), 'utf8'), {
    module: sourceModule, exports: sourceModule.exports,
    require(name) { assert.equal(name, '../../lib/encryption'); return primitives; },
  });
  return sourceModule.exports.readClinicalNarrative;
}

test('new protected narratives round trip while older plaintext remains readable without rewriting rows', () => {
  for (const field of fields) {
    const original = { [field]: 'Legacy recorded clinical context' };
    const retained = structuredClone(original);
    assert.equal(readClinicalNarrative(original, field), original[field]);
    assert.deepEqual(original, retained);
    assert.equal(readClinicalNarrative({}, field), null);
    const secured = protectedRow(field, 'Current protected clinical context');
    assert.ok(!JSON.stringify(secured).includes('Current protected'));
    assert.equal(readClinicalNarrative({ ...original, ...secured }, field), 'Current protected clinical context');
  }
});

test('corrupt or partial protected narratives never disclose a stale plaintext fallback', () => {
  for (const field of fields) {
    const secured = protectedRow(field, 'Current protected clinical context');
    for (const patch of [{ [field + '_tag']: '00'.repeat(16) }, { [field + '_iv']: null }, { [field + '_encrypted']: '' }]) {
      assert.throws(() => readClinicalNarrative({ [field]: 'Stale confidential fallback', ...secured, ...patch }, field),
        error => error.statusCode === 503 && error.code === 'CLINICAL_DECRYPTION_UNAVAILABLE' && !error.message.includes('confidential'));
    }
  }
});

test('production narratives require the complete GCM tag, IV and canonical ciphertext encoding', () => {
  const current = isolatedPrimitives({ NODE_ENV: 'production', ENCRYPTION_KEY: 'ab'.repeat(32) });
  const read = isolatedReader(current);
  for (const field of fields) {
    const secured = protectedRow(field, 'Synthetic production narrative', current);
    const tag = secured[field + '_tag']; const iv = secured[field + '_iv']; const encrypted = secured[field + '_encrypted'];
    for (const patch of [
      ...[8, 16, 24, 26, 28, 30, 31].map(length => ({ [field + '_tag']: tag.slice(0, length) })),
      { [field + '_tag']: tag + 'INVALID' }, { [field + '_tag']: tag + '00' }, { [field + '_tag']: tag + '\n' },
      { [field + '_iv']: iv.slice(0, 22) }, { [field + '_iv']: iv + 'INVALID' }, { [field + '_iv']: iv + '00' },
      { [field + '_iv']: iv + '\n' }, { [field + '_encrypted']: encrypted + '\n' },
      { [field + '_encrypted']: '!' + encrypted }, { [field + '_encrypted']: encrypted + '=' },
    ]) {
      assert.throws(() => read({ [field]: 'Stale plaintext must not escape', ...secured, ...patch }, field),
        error => error.code === 'CLINICAL_DECRYPTION_UNAVAILABLE' && error.statusCode === 503);
    }
    assert.equal(read({ ...secured, [field + '_tag']: tag.toUpperCase(), [field + '_iv']: iv.toUpperCase() }, field), 'Synthetic production narrative');
  }
});

test('new narrative columns reject known fallback keys and missing or changed production keys', () => {
  const fallback = isolatedPrimitives({ NODE_ENV: 'development' });
  const current = isolatedPrimitives({ NODE_ENV: 'production', ENCRYPTION_KEY: 'ab'.repeat(32) });
  const field = fields[0];
  const read = isolatedReader(current);
  assert.throws(() => read(protectedRow(field, 'Legacy-key ciphertext', fallback), field), { code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
  const stored = protectedRow(field, 'Current-key ciphertext', current);
  assert.equal(read(stored, field), 'Current-key ciphertext');
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', ENCRYPTION_KEY: 'cd'.repeat(32) }]) {
    assert.throws(() => isolatedReader(isolatedPrimitives(env))({ [field]: 'Stale plaintext', ...stored }, field), { code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
  }
  assert.throws(() => isolatedPrimitives({ NODE_ENV: 'production' }).encrypt('New narrative'), { code: 'PHI_ENCRYPTION_KEY_REQUIRED' });
});

test('clinical serializers reveal only decoded narratives, never ciphertext or tags', () => {
  const note = encounters._formatNote({
    ...protectedRow('follow_up_notes', 'Follow-up clinical context'), ...protectedRow('amendment_reason', 'Amendment clinical context'),
  });
  assert.equal(note.followUpNotes, 'Follow-up clinical context'); assert.equal(note.amendmentReason, 'Amendment clinical context');
  const allergy = profiles._formatAllergy(protectedRow('inactivation_reason', 'Allergy clinical context'));
  const medication = profiles._formatMedication(protectedRow('discontinuation_reason', 'Medication clinical context'));
  assert.equal(allergy.inactivationReason, 'Allergy clinical context'); assert.equal(medication.discontinuationReason, 'Medication clinical context');
  assert.ok(!JSON.stringify([note, allergy, medication]).includes('_encrypted'));
  assert.ok(!JSON.stringify([note, allergy, medication]).includes('_tag'));
});

// Exercise the actual create/edit/amend/sign service methods. This fake storage
// projects INSERT/UPDATE parameters into returned rows; it does not replace the
// encryption primitives or claim to test PostgreSQL locking/authorization.
test('note writes protect new narratives and decode before commit; explicit clearing cannot revive legacy text', async () => {
  const originalPool = db.getPool, originalEncounter = encounters._lockEncounter, originalNote = encounters._lockNote;
  const logger = require('../middleware/logger'); const originalLogging = { info: logger.info, error: logger.error };
  const ids = { patient: crypto.randomUUID(), provider: crypto.randomUUID(), encounter: crypto.randomUUID(), note: crypto.randomUUID() };
  let row = { id: ids.note, encounter_id: ids.encounter, patient_id: ids.patient, provider_id: ids.provider, is_signed: false, is_locked: false, version: 1, parent_note_id: null, icd_codes: [], cpt_codes: [] };
  let commands = [], captures = [], corruptReturn = false;
  function scalar(expression, params) {
    const input = expression.trim();
    if (/^\$\d+$/.test(input)) return params[Number(input.slice(1)) - 1];
    if (input === 'NULL') return null;
    if (input === 'true') return true;
    if (/^\d+$/.test(input)) return Number(input);
    if (/^'.*'$/.test(input)) return input.slice(1, -1);
    return undefined;
  }
  const query = async (sql, params = []) => {
    commands.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('INSERT INTO audit_logs')) return { rows: [] };
    if (sql.includes('SELECT MAX(version)')) return { rows: [{ max_version: 1 }] };
    if (sql.includes('INSERT INTO clinical_notes')) {
      captures.push({ sql, params });
      const match = sql.match(/INSERT INTO clinical_notes\s*\(([\s\S]+?)\)\s*VALUES\s*\(([\s\S]+?)\)\s*RETURNING/);
      assert.ok(match);
      const columns = match[1].split(',').map(value => value.trim()); const values = match[2].split(',');
      assert.equal(columns.length, values.length);
      assert.equal(Math.max(...[...sql.matchAll(/\$(\d+)/g)].map(value => Number(value[1]))), params.length);
      row = { ...row, ...Object.fromEntries(columns.map((column, index) => [column, scalar(values[index], params)])) };
      return { rows: [row] };
    }
    if (sql.includes('UPDATE clinical_notes')) {
      captures.push({ sql, params });
      for (const assignment of sql.split(/\s+SET\s+/)[1].split(/\bWHERE\b/)[0].split(',')) {
        const [column, expression] = assignment.split('=');
        const value = scalar(expression, params);
        if (value !== undefined) row[column.trim()] = value;
      }
      if (corruptReturn) row.follow_up_notes_tag = row.follow_up_notes_tag.slice(0, 8);
      return { rows: [row] };
    }
    throw new Error('Unexpected isolated clinical narrative SQL');
  };
  db.getPool = () => ({ connect: async () => ({ query, release() {} }) });
  encounters._lockEncounter = async () => ({ id: ids.encounter, patient_id: ids.patient, provider_id: ids.provider });
  encounters._lockNote = async () => ({ ...row });
  logger.info = logger.error = () => {};
  try {
    const narrative = 'Sensitive follow-up narrative';
    const created = await encounters.createNote(ids.encounter, ids.provider, { followUpNotes: narrative });
    assert.equal(created.followUpNotes, narrative);
    assert.equal(row.follow_up_notes, undefined);
    assert.ok(!JSON.stringify(captures).includes(narrative));
    row.follow_up_notes = 'Retained legacy narrative';
    await encounters.updateNote(ids.note, ids.provider, { followUpNotes: 'Corrected follow-up context' });
    assert.equal(row.follow_up_notes, null);
    assert.equal(decrypt(row.follow_up_notes_encrypted, row.follow_up_notes_iv, row.follow_up_notes_tag), 'Corrected follow-up context');
    row.follow_up_notes = 'Stale legacy narrative';
    const cleared = await encounters.updateNote(ids.note, ids.provider, { followUpNotes: '' });
    assert.equal(cleared.followUpNotes, null); assert.equal(row.follow_up_notes, null); assert.equal(row.follow_up_notes_encrypted, null);
    row.is_signed = true; row.is_locked = true;
    const amended = await encounters.createAmendment(ids.note, ids.provider, { reason: 'Protected clinical correction', plan: 'Corrected plan' });
    assert.equal(amended.amendmentReason, 'Protected clinical correction'); assert.equal(row.amendment_reason, undefined);
    assert.ok(!JSON.stringify(captures).includes('Protected clinical correction'));
    row.is_signed = false; row.is_locked = false;
    await encounters.updateNote(ids.note, ids.provider, { followUpNotes: narrative });
    corruptReturn = true; commands = [];
    await assert.rejects(encounters.updateNote(ids.note, ids.provider, { followUpRequired: true }), { code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
    assert.ok(commands.includes('ROLLBACK')); assert.ok(!commands.includes('COMMIT'));
    commands = [];
    await assert.rejects(encounters.signNote(ids.note, ids.provider), { code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
    assert.ok(commands.includes('ROLLBACK')); assert.ok(!commands.includes('COMMIT'));
  } finally { db.getPool = originalPool; encounters._lockEncounter = originalEncounter; encounters._lockNote = originalNote; Object.assign(logger, originalLogging); }
});

test('narrative schema migration is registered, additive, idempotent and has no history backfill', () => {
  const migration = require('../db/migrate').getMigrations().find(item => item.name === '044_clinical_narrative_encryption');
  assert.ok(migration);
  for (const field of fields) for (const suffix of ['encrypted', 'iv', 'tag']) assert.match(migration.up, new RegExp('ADD COLUMN IF NOT EXISTS ' + field + '_' + suffix + '\\b'));
  assert.doesNotMatch(migration.up.replace(/--[^\n]*/g, ''), /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i);
  assert.deepEqual(require('../../scripts/verify-migration-safety.cjs').checkSql(migration.up, 'server/db/migrations/044_clinical_narrative_encryption.sql'), []);
});

test('authorized allergy and medication state changes protect reasons and roll back if the audit fails', async () => {
  const oldPool = db.getPool;
  const logger = require('../middleware/logger'); const oldInfo = logger.info; logger.info = () => {};
  const patient = crypto.randomUUID(), actor = { id: crypto.randomUUID(), role: 'provider', marketScope: 'US' };
  let row, snapshot, field, table, captures, commands, failAudit = false;
  const query = async (sql, params = []) => {
    commands.push(sql);
    if (sql === 'BEGIN') { snapshot = structuredClone(row); return { rows: [] }; }
    if (sql === 'ROLLBACK') { row = snapshot; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (sql.includes('INSERT INTO audit_logs')) {
      if (failAudit) throw new Error('Isolated narrative audit outage');
      captures.push({ sql, params }); return { rows: [] };
    }
    if (sql.includes('FROM users actor')) return { rows: [{ id: actor.id, role: actor.role, market_scope: 'US' }] };
    if (sql.includes('FROM provider_patient_relationships')) return { rows: [{ id: crypto.randomUUID() }] };
    if (sql.startsWith('SELECT id,patient_id FROM ' + table)) return { rows: [{ id: row.id, patient_id: patient }] };
    if (sql.includes('UPDATE ' + table)) {
      assert.equal(params.length, 5); assert.equal(params[0], actor.id); assert.equal(params[4], row.id);
      assert.match(sql, new RegExp(field + ' = NULL'));
      captures.push({ sql, params });
      row = { ...row, is_active: false, [field]: null, [field + '_encrypted']: params[1], [field + '_iv']: params[2], [field + '_tag']: params[3] };
      return { rows: [row] };
    }
    throw new Error('Unexpected isolated clinical profile SQL');
  };
  db.getPool = () => ({ connect: async () => ({ query, release() {} }) });
  try {
    for (const [method, recordTable, reasonField, output] of [
      ['inactivateAllergy', 'patient_allergies', 'inactivation_reason', 'inactivationReason'],
      ['discontinueMedication', 'patient_medications', 'discontinuation_reason', 'discontinuationReason'],
    ]) {
      table = recordTable; field = reasonField; commands = []; captures = [];
      row = { id: crypto.randomUUID(), patient_id: patient, is_active: true, [field]: 'Existing legacy context' };
      const original = structuredClone(row); const reason = 'Sensitive clinical state-change reason';
      failAudit = true;
      await assert.rejects(profiles[method](row.id, actor.id, reason, actor), /Isolated narrative audit outage/);
      assert.deepEqual(row, original); assert.ok(commands.includes('ROLLBACK')); assert.ok(!commands.includes('COMMIT'));
      failAudit = false; commands = [];
      const changed = await profiles[method](row.id, actor.id, reason, actor);
      assert.equal(changed[output], reason); assert.equal(changed.isActive, false); assert.equal(row[field], null);
      assert.ok(!JSON.stringify(captures).includes(reason)); assert.ok(commands.includes('COMMIT'));
    }
  } finally { db.getPool = oldPool; logger.info = oldInfo; }
});

const target = process.env.SIMULATION_DATABASE_URL;
test('isolated PostgreSQL narrative migration reruns without modifying older plaintext history', { skip: !target }, async () => {
  const safety = require('../../ng/scripts/fixtureTargetSafety').fixtureTargetSafety({ env: { ...process.env, DATABASE_URL: target } });
  assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target, statement_timeout: 10000 }); const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE clinical_notes (id uuid,follow_up_notes text,amendment_reason text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE patient_allergies (id uuid,inactivation_reason text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE patient_medications (id uuid,discontinuation_reason text) ON COMMIT DROP');
    await client.query("INSERT INTO clinical_notes VALUES($1,'Retained old follow-up','Retained old amendment')", [crypto.randomUUID()]);
    await client.query("INSERT INTO patient_allergies VALUES($1,'Retained old allergy reason')", [crypto.randomUUID()]);
    await client.query("INSERT INTO patient_medications VALUES($1,'Retained old medication reason')", [crypto.randomUUID()]);
    const migration = fs.readFileSync(require.resolve('../db/migrations/044_clinical_narrative_encryption.sql'), 'utf8');
    await client.query(migration); await client.query(migration);
    for (const [table, field, expected] of [
      ['clinical_notes', 'follow_up_notes', 'Retained old follow-up'], ['clinical_notes', 'amendment_reason', 'Retained old amendment'],
      ['patient_allergies', 'inactivation_reason', 'Retained old allergy reason'], ['patient_medications', 'discontinuation_reason', 'Retained old medication reason'],
    ]) {
      const row = (await client.query('SELECT * FROM ' + table)).rows[0];
      assert.equal(row[field], expected); assert.equal(row[field + '_encrypted'], null); assert.equal(readClinicalNarrative(row, field), expected);
    }
  } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
