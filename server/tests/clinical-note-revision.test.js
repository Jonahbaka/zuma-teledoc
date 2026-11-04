'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { noteRevision, assertNoteRevision } = require('../services/clinicalNoteRevision');
const encryption = require('../../lib/encryption');
const content = require('../services/clinicalContentService');
const oldKey = process.env.ENCRYPTION_KEY;
process.env.ENCRYPTION_KEY = '17'.repeat(32); // Synthetic content only, never a configured database.
test.after(() => { if (oldKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = oldKey; });

function load(file, dependencies) {
  const filename = path.resolve(__dirname, file), sourceModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: sourceModule, exports: sourceModule.exports, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency: ' + name);
    return dependencies[name];
  } }, { filename });
  return sourceModule.exports;
}
function initialRow() {
  const row = { id: crypto.randomUUID(), encounter_id: crypto.randomUUID(), patient_id: crypto.randomUUID(), provider_id: crypto.randomUUID(),
    note_type: 'soap', version: 1, is_amendment: false, is_signed: false, is_locked: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    icd_codes: ['Z00.00'], cpt_codes: ['99213'], follow_up_required: true, follow_up_interval: '2 weeks' };
  for (const [field, value] of Object.entries({ subjective: 'Synthetic subjective', objective: 'Synthetic objective', assessment: 'Synthetic assessment', plan: 'Synthetic plan', physical_exam: 'Synthetic examination', vitals: '{"heartRate":76}', follow_up_notes: 'Synthetic follow up' })) {
    const enc = encryption.encrypt(value);
    row[field + '_encrypted'] = enc.encrypted; row[field + '_iv'] = enc.iv; row[field + '_tag'] = enc.tag;
  }
  return row;
}

// This adapter models transactions and lock waiting. It is NOT PostgreSQL and
// cannot establish actual PostgreSQL isolation/rollback behavior. Production
// SQL and _lockNote/_lockEncounter/_lockAccounts are executed without stubbing.
function fixture() {
  const state = { row: initialRow(), audits: [], statements: [], releases: 0, failAudit: false, failCommit: false, denyAccount: false, status: 'in_progress' };
  let queue = Promise.resolve();
  const database = { getPool: () => ({ async connect() {
    let unlock, working, pending = [], locked = false;
    return { async query(sql, params = []) {
      state.statements.push(sql);
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'COMMIT') {
        if (state.failCommit) throw new Error('Synthetic commit failure');
        if (working) state.row = structuredClone(working);
        state.audits.push(...pending); if (unlock) unlock(); unlock = null; return { rows: [] };
      }
      if (sql === 'ROLLBACK') { working = null; pending = []; if (unlock) unlock(); unlock = null; return { rows: [] }; }
      if (sql.startsWith('SELECT encounter_id FROM clinical_notes')) return { rows: params[0] === state.row.id ? [{ encounter_id: state.row.encounter_id }] : [] };
      if (sql.startsWith('SELECT * FROM clinical_encounters')) {
        const previous = queue; queue = new Promise(resolve => { unlock = resolve; }); await previous; locked = true;
        working = structuredClone(state.row);
        return { rows: [{ id: state.row.encounter_id, patient_id: state.row.patient_id, provider_id: state.row.provider_id, status: state.status }] };
      }
      if (sql.includes('FROM users patient JOIN users actor')) return { rows: state.denyAccount ? [] : [{ id: state.row.patient_id, market_scope: 'US' }] };
      if (sql.startsWith('SELECT * FROM clinical_notes')) {
        assert.ok(locked); assert.match(sql, /FOR UPDATE/);
        return { rows: params.every((value, i) => value === [working.id, working.encounter_id, working.patient_id, working.provider_id][i]) ? [structuredClone(working)] : [] };
      }
      if (sql.startsWith('UPDATE clinical_notes')) {
        assert.ok(locked); assert.match(sql, /is_signed IS NOT TRUE AND is_locked IS NOT TRUE/);
        if (working.is_signed || working.is_locked) return { rows: [] };
        if (sql.includes('signature_hash = $1')) Object.assign(working, { is_signed: true, is_locked: true, signature_hash: params[0], signed_at: '2026-01-02', locked_at: '2026-01-02', locked_reason: 'signed' });
        else {
          for (const match of sql.split(' WHERE ')[0].matchAll(/(\w+) = \$(\d+)/g)) working[match[1]] = params[Number(match[2]) - 1];
          if (sql.includes('follow_up_notes = NULL')) working.follow_up_notes = null;
          working.updated_at = '2026-01-02';
        }
        return { rows: [structuredClone(working)] };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) {
        if (state.failAudit) throw new Error('Synthetic audit failure');
        pending.push(JSON.parse(params[5])); return { rows: [] };
      }
      throw new Error('Unexpected SQL: ' + sql);
    }, release() { state.releases++; assert.equal(unlock, null, 'Transaction must finish before release'); } };
  } }) };
  const service = load('../services/clinicalEncounterService.js', {
    crypto, '../db': database, 'node:async_hooks': require('node:async_hooks'), '../middleware/logger': { info() {}, error() {} },
    '../../lib/encryption': encryption, './clinicalContentService': content, './clinicalNoteRevision': { noteRevision, assertNoteRevision }, '../../lib/utils': require('../../lib/utils'),
  });
  return { state, service, update: data => service.updateNote(state.row.id, state.row.provider_id, data), sign: data => service.signNote(state.row.id, state.row.provider_id, data) };
}

test('revision binds every clinical field and identity, not joined display metadata', () => {
  const row = initialRow(), revision = noteRevision(row);
  assert.match(revision, /^[a-f\d]{64}$/); assert.equal(noteRevision(structuredClone(row)), revision);
  const fields = ['id', 'encounter_id', 'patient_id', 'provider_id', 'note_type', 'version', 'parent_note_id', 'is_amendment', 'is_signed', 'is_locked', 'signature_hash', 'signed_at', 'locked_at', 'locked_reason', 'created_at', 'updated_at', 'icd_codes', 'cpt_codes', 'follow_up_required', 'follow_up_interval',
    ...['subjective', 'objective', 'assessment', 'plan', 'vitals', 'physical_exam', 'follow_up_notes', 'amendment_reason'].flatMap(field => [field, field + '_encrypted', field + '_iv', field + '_tag'])];
  for (const field of fields) assert.notEqual(noteRevision({ ...row, [field]: 'Changed synthetic value' }), revision, field);
  assert.equal(noteRevision({ ...row, provider_first_name: 'Changed', provider_last_name: 'Name', provider_credentials: 'MD', patient_first_name: 'Other' }), revision);
  assert.throws(() => assertNoteRevision({ ...row, id: crypto.randomUUID() }, revision), { statusCode: 409, code: 'CLINICAL_NOTE_REVISION_CONFLICT' });
  for (const value of [null, '', 1, {}, 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) assert.throws(() => assertNoteRevision(row, value), { statusCode: 400, code: 'CLINICAL_NOTE_REVISION_INVALID' });
  assert.doesNotThrow(() => assertNoteRevision(row, undefined));
});

test('simulated transaction: partial edit preserves omitted content and metadata; explicit clearing is applied', async () => {
  const f = fixture(), original = structuredClone(f.state.row), revision = noteRevision(original);
  const result = await f.update({ subjective: 'Edited synthetic subjective', expectedRevision: revision });
  assert.notEqual(result.revision, revision); assert.equal(result.revision, noteRevision(f.state.row));
  for (const key of Object.keys(original).filter(key => !key.startsWith('subjective_') && key !== 'updated_at')) assert.deepEqual(f.state.row[key], original[key], key);
  assert.equal(f.service._formatNote(f.state.row, true).subjective, 'Edited synthetic subjective');
  assert.deepEqual(f.state.audits[0].changedFields, ['subjective']);
  assert.ok(!JSON.stringify(f.state.audits).includes(revision));
  await f.update({ subjective: '', physicalExam: '', vitals: {}, icdCodes: [], cptCodes: [], followUpRequired: false, followUpInterval: '', followUpNotes: '', expectedRevision: result.revision });
  const cleared = f.service._formatNote(f.state.row, true);
  // The existing encryption contract represents a deliberately empty narrative as null.
  assert.equal(cleared.subjective, null); assert.equal(cleared.physicalExam, null); assert.equal(cleared.followUpNotes, null);
  assert.deepEqual(structuredClone(cleared.vitals), {}); assert.deepEqual(cleared.icdCodes, []); assert.deepEqual(cleared.cptCodes, []);
  assert.equal(cleared.followUpRequired, false); assert.equal(cleared.followUpInterval, '');
});

test('simulated transaction: stale, wrong-note and malformed tokens never write or audit, for update and sign', async () => {
  for (const method of ['update', 'sign']) for (const token of ['0'.repeat(64), noteRevision(initialRow()), null]) {
    const f = fixture(), original = structuredClone(f.state.row);
    await assert.rejects(f[method]({ subjective: 'Do not store', expectedRevision: token }), { code: token === null ? 'CLINICAL_NOTE_REVISION_INVALID' : 'CLINICAL_NOTE_REVISION_CONFLICT' });
    assert.deepEqual(f.state.row, original); assert.equal(f.state.audits.length, 0);
    assert.ok(!f.state.statements.some(sql => sql.startsWith('UPDATE') || sql.startsWith('INSERT')));
    assert.ok(f.state.statements.includes('ROLLBACK')); assert.equal(f.state.releases, 1);
  }
});

test('simulated transaction: authorization and signed/locked protections precede revision acceptance', async () => {
  for (const method of ['updateNote', 'signNote']) {
    const f = fixture(), row = f.state.row;
    await assert.rejects(f.service[method](row.id, crypto.randomUUID(), { expectedRevision: noteRevision(row) }), { code: 'CLINICAL_CONTEXT_DENIED' });
    f.state.denyAccount = true;
    await assert.rejects(f.service[method](row.id, row.provider_id, { expectedRevision: noteRevision(row) }), { code: 'CLINICAL_CONTEXT_DENIED' });
    f.state.denyAccount = false;
    for (const flag of ['is_signed', 'is_locked']) {
      row[flag] = true;
      await assert.rejects(f.service[method](row.id, row.provider_id, { expectedRevision: 'invalid' }), { code: 'CLINICAL_NOTE_IMMUTABLE' });
      row[flag] = false;
    }
    assert.equal(f.state.audits.length, 0);
  }
});

test('simulated transaction: audit and commit failures roll back content/signature and audit together', async () => {
  for (const method of ['update', 'sign']) for (const failure of ['failAudit', 'failCommit']) {
    const f = fixture(), original = structuredClone(f.state.row); f.state[failure] = true;
    await assert.rejects(f[method]({ subjective: 'Must roll back', expectedRevision: noteRevision(original) }), /Synthetic (audit|commit) failure/);
    assert.deepEqual(f.state.row, original); assert.deepEqual(f.state.audits, []);
    assert.ok(f.state.statements.includes('ROLLBACK')); assert.equal(f.state.releases, 1);
  }
});

test('simulated row-lock wait: two editors sharing a revision cannot both save; stale signing cannot sign a newer draft', async () => {
  const f = fixture(), revision = noteRevision(f.state.row);
  const outcomes = await Promise.allSettled([f.update({ plan: 'First edit', expectedRevision: revision }), f.update({ plan: 'Second edit', expectedRevision: revision })]);
  assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(outcomes[1].reason.code, 'CLINICAL_NOTE_REVISION_CONFLICT'); assert.equal(f.state.audits.length, 1);
  await assert.rejects(f.sign({ expectedRevision: revision }), { code: 'CLINICAL_NOTE_REVISION_CONFLICT' });
  const latest = outcomes[0].value.revision, signed = await f.sign({ expectedRevision: latest });
  assert.equal(signed.isSigned, true); assert.equal(signed.isLocked, true); assert.notEqual(signed.revision, latest);
  assert.equal(signed.revision, noteRevision(f.state.row)); assert.equal(f.state.audits.length, 2);
});

test('simulated row-lock wait: a winning signature prevents a concurrent editor write', async () => {
  const f = fixture(), revision = noteRevision(f.state.row);
  const outcomes = await Promise.allSettled([f.sign({ expectedRevision: revision }), f.update({ plan: 'Delayed draft', expectedRevision: revision })]);
  assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'rejected']);
  assert.equal(outcomes[1].reason.code, 'CLINICAL_NOTE_IMMUTABLE');
  assert.equal(f.state.audits.length, 1); assert.equal(f.state.row.is_signed, true);
  assert.equal(f.service._formatNote(f.state.row, true).plan, 'Synthetic plan');
});

test('simulated transaction: response decryption failure rolls back the write and pending audit', async () => {
  const f = fixture(); f.state.row.follow_up_notes_tag = '0'.repeat(32);
  const original = structuredClone(f.state.row);
  await assert.rejects(f.update({ plan: 'Do not commit unreadable response', expectedRevision: noteRevision(original) }), { code: 'CLINICAL_DECRYPTION_UNAVAILABLE' });
  assert.deepEqual(f.state.row, original); assert.equal(f.state.audits.length, 0);
  assert.ok(!f.state.statements.includes('COMMIT')); assert.ok(f.state.statements.includes('ROLLBACK'));
});

test('legacy callers may omit revision, but a revision-only update is not a clinical change', async () => {
  const f = fixture();
  await assert.rejects(f.update({ expectedRevision: noteRevision(f.state.row) }), { code: 'CLINICAL_NOTE_UPDATE_INVALID' });
  assert.equal(f.state.audits.length, 0);
  await f.update({ plan: 'Legacy caller change' });
  assert.equal((await f.sign()).isSigned, true);
});

function routerFor(service, providerId) {
  const pass = () => (_req, _res, next) => next();
  return load('../routes/clinicalEncounters.js', { express, zod: require('zod'),
    '../middleware/auth': { authenticate(req, _res, next) { req.user = { id: providerId, role: 'provider' }; next(); }, requireRole: pass, canAccessPatient: pass },
    '../middleware/audit': { auditMiddleware: pass, auditPhiAccess: pass }, '../../lib/validation': require('../../lib/validation'), '../../lib/utils': require('../../lib/utils'),
    '../middleware/logger': { error() {} }, '../services/clinicalEncounterService': service, '../services/patientClinicalProfileService': {}, '../services/eRxIntegrationService': {}, '../services/telehealthConsentService': {}, '../../ng/services/rx-engine/privatePrescriptionUploadService': {}, '../db': {},
  });
}

test('actual Express router with simulated storage: forwards revisions, rejects malformed tokens, returns safe conflicts, supports bodyless legacy signing', async () => {
  const f = fixture(), app = express(); app.use(express.json()); app.use(routerFor(f.service, f.state.row.provider_id));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const request = async (sign, body) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/notes/' + f.state.row.id + (sign ? '/sign' : ''), {
      method: sign ? 'POST' : 'PUT', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const sign of [false, true]) for (const token of [null, 2, {}, '', 'z'.repeat(64)]) {
      const before = f.state.statements.length, response = await request(sign, { plan: 'Invalid', expectedRevision: token });
      assert.equal(response.status, 400); assert.equal(f.state.statements.length, before, 'Validation happens before service/storage');
      assert.deepEqual(Object.keys(response.body).sort(), ['code', 'error', 'success']);
    }
    const revision = noteRevision(f.state.row), original = structuredClone(f.state.row);
    const saved = await request(false, { plan: 'Router edit', expectedRevision: revision });
    assert.equal(saved.status, 200); assert.notEqual(saved.body.note.revision, revision);
    assert.equal(f.state.row.vitals_encrypted, original.vitals_encrypted); assert.deepEqual(f.state.row.icd_codes, original.icd_codes);
    for (const sign of [false, true]) {
      const before = structuredClone(f.state.row), audits = f.state.audits.length;
      const stale = await request(sign, { plan: 'Do not save', expectedRevision: revision });
      assert.equal(stale.status, 409); assert.equal(stale.body.code, 'CLINICAL_NOTE_REVISION_CONFLICT');
      assert.match(stale.body.error, /Keep your draft/); assert.deepEqual(Object.keys(stale.body).sort(), ['code', 'error', 'success']);
      assert.ok(!JSON.stringify(stale.body).includes('Router edit')); assert.deepEqual(f.state.row, before); assert.equal(f.state.audits.length, audits);
    }
    assert.equal((await request(true, { expectedRevision: saved.body.note.revision })).status, 200);
    const legacy = fixture();
    // A fresh router uses the original optional-body route contract.
    const legacyApp = express(); legacyApp.use(express.json()); legacyApp.use(routerFor(legacy.service, legacy.state.row.provider_id));
    const other = await new Promise(resolve => { const listener = legacyApp.listen(0, '127.0.0.1', () => resolve(listener)); });
    try {
      const response = await fetch('http://127.0.0.1:' + other.address().port + '/notes/' + legacy.state.row.id + '/sign', { method: 'POST' });
      assert.equal(response.status, 200); assert.equal((await response.json()).note.isSigned, true);
    } finally { await new Promise(resolve => other.close(resolve)); }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
