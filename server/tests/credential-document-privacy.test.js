'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const service = require('../services/credentialDocumentService');
const guard = require('../middleware/privateCredentialUploads');
const { runtimePath } = require('../utils/runtimeStatePolicy');

test('credential uploads are blocked before static serving including encoded and Windows paths', async () => {
  const app = express(); app.use('/uploads', guard, (_req, res) => res.send('public'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    for (const name of ['credentialing/id.pdf','%63redentialing/id.pdf','credentialing%2fid.pdf','credentialing%5cid.pdf','CREDENTIALING/id.pdf','x/%2e%2e/credentialing/id.pdf']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/uploads/${name}`);
      assert.equal(response.status, 404, name);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/uploads/public.png`)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('credential MIME labels cannot authorize arbitrary active content', () => {
  assert.throws(() => service.validateFile({ mimetype: 'application/pdf', buffer: Buffer.from('<script>fixture</script>') }), error => error.status === 400);
  assert.throws(() => service.validateFile({ mimetype: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }), error => error.status === 400);
});
test('PostgreSQL private documents enforce current owner, market reviewer, encryption and atomic audit', { skip: !process.env.SIMULATION_DATABASE_URL }, async () => {
  const url = new URL(process.env.SIMULATION_DATABASE_URL);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url.toString() });
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  const actors = ids.slice(0,4).map((id, i) => ({ id, role: i < 2 ? 'provider' : 'admin' }));
  const file = { mimetype: 'application/pdf', originalname: 'fictional-credential.pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic credential only') };
  const oldKey = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = 'c'.repeat(64);
  let saved;
  try {
    for (const [i, actor] of actors.entries()) await pool.query(`INSERT INTO users (id,email,password_hash,role,first_name,last_name,market_scope,is_active,account_status)
      VALUES($1,$2,'!fictional-no-login',$3,'Fictional','Credential',$4,TRUE,'active')`, [actor.id, actor.id + '@example.invalid', actor.role, i === 3 ? 'US' : 'NG']);
    await pool.query('INSERT INTO provider_credentialing(id,provider_id) VALUES($1,$2)', [ids[4], actors[0].id]);
    saved = await service.save(pool, actors[0], file, { documentType: 'medical_license' });
    assert.ok(saved.file_url.startsWith('/api/credentialing/documents/'));
    const stored = await fs.readFile(path.join(runtimePath('credentialDocuments'), saved.id + '.json'), 'utf8');
    assert.ok(!stored.includes('Synthetic credential'));
    assert.deepEqual((await service.read(pool, actors[0], saved.id)).bytes, file.buffer);
    assert.deepEqual((await service.read(pool, actors[2], saved.id)).bytes, file.buffer);
    for (const actor of [actors[1], actors[3], { ...actors[0], role: 'admin' }]) await assert.rejects(service.read(pool, actor, saved.id), error => error.status === 404);
    await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1', [actors[0].id]);
    await assert.rejects(service.read(pool, actors[0], saved.id), error => error.status === 404);
    await pool.query('UPDATE users SET is_active=TRUE WHERE id=$1', [actors[0].id]);
    await pool.query("UPDATE users SET account_status='suspended' WHERE id=$1", [actors[2].id]);
    await assert.rejects(service.read(pool, actors[2], saved.id), error => error.status === 404);
    const failAudit = { async connect() { const client = await pool.connect(); return { release: () => client.release(), query(sql, args) {
      if (sql.includes('INSERT INTO credentialing_audit_log')) throw new Error('Synthetic audit outage');
      return client.query(sql,args);
    } }; } };
    await assert.rejects(service.read(failAudit, actors[0], saved.id), /audit outage/);
    const before = await fs.readdir(runtimePath('credentialDocuments'));
    await assert.rejects(service.save(failAudit, actors[0], file, { documentType: 'photo_id' }), /audit outage/);
    assert.deepEqual(await fs.readdir(runtimePath('credentialDocuments')), before);
    assert.equal((await pool.query('SELECT count(*)::int n FROM credentialing_documents WHERE credentialing_id=$1', [ids[4]])).rows[0].n, 1);
    const audit = (await pool.query('SELECT details FROM credentialing_audit_log WHERE credentialing_id=$1', [ids[4]])).rows;
    assert.equal(audit.length, 3);
    assert.ok(audit.every(row => !JSON.stringify(row).includes(file.originalname)));
  } finally {
    await pool.query('DELETE FROM credentialing_audit_log WHERE credentialing_id=$1', [ids[4]]);
    await pool.query('DELETE FROM provider_credentialing WHERE id=$1', [ids[4]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids.slice(0,4)]);
    if (saved) await fs.unlink(path.join(runtimePath('credentialDocuments'), saved.id + '.json'));
    await pool.end(); if (oldKey === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = oldKey;
  }
});
