'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { withBookingIntent, readBookingIntent, canonicalIntent } = require('../services/appointmentIntentService');
const { fixtureTargetSafety } = require('../../ng/scripts/fixtureTargetSafety');
const actor = { id: crypto.randomUUID(), role: 'patient' };
const data = () => ({ clientRequestId: crypto.randomUUID(), category: 'primary_care', specialties: ['general'], providerId: null,
  scheduledAt: '2030-01-01T10:00:00Z', type: 'video', reasonForVisit: 'Synthetic symptom', patientNotes: 'Synthetic private context', durationMinutes: 30,
  intake: { historyReviewed: true, medicationStatus: 'unknown', allergyStatus: 'unknown' } });
function fixture() {
  const state = { intents: [], appointments: [], active: true, market: 'NG', calls: 0 };
  const client = { async query(sql, args) {
    if (sql.includes('FROM users')) return { rows: state.active && args[0] === actor.id && args[1] === state.market ? [{ id: actor.id }] : [] };
    if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('JOIN appointments a')) {
      const saved = state.intents.find(row => row.actor_id === args[0] && row.client_request_id === args[1] && row.market_scope === args[2]);
      return { rows: saved ? state.appointments.filter(row => row.id === saved.appointment_id) : [] };
    }
    if (sql.includes('FROM appointment_booking_intents')) return { rows: state.intents.filter(row => row.actor_id === args[0] && row.client_request_id === args[1]) };
    if (sql.startsWith('INSERT INTO appointment_booking_intents')) { state.intents.push({ actor_id: args[0], client_request_id: args[1], appointment_id: args[2], intent_envelope: JSON.parse(args[3]), market_scope: args[4] }); return { rows: [] }; }
    if (sql.includes('FROM appointments')) return { rows: state.appointments.filter(row => row.id === args[0] && row.patient_id === args[1]) };
    throw Error(sql);
  } };
  const db = { transaction: async fn => fn(client) };
  const book = input => withBookingIntent(db, { actor, marketScope: 'NG', data: input }, async tx => {
    await tx.transaction(async inner => assert.equal(inner, client)); state.calls++;
    const row = { id: crypto.randomUUID(), patient_id: actor.id, provider_id: crypto.randomUUID() }; state.appointments.push(row); return { rows: [row], providerId: row.provider_id };
  });
  return { state, book, read: (clientRequestId, override = {}) => readBookingIntent(db, { actor, marketScope: 'NG', clientRequestId, ...override }) };
}
test('exact intent replay precedes fallback selection and protected payload changes conflict', async () => {
  const f = fixture(), input = data(), first = await f.book(input);
  const replay = await f.book({ ...input, scheduledAt: '2030-01-01T10:00:00.000Z' });
  assert.equal(replay.rows[0].id, first.rows[0].id); assert.equal(replay.deduplicated, true); assert.equal(f.state.calls, 1);
  assert.ok(!JSON.stringify(f.state.intents).includes(input.reasonForVisit));
  for (const change of [{ reasonForVisit: 'Changed' }, { providerId: crypto.randomUUID() }, { patientNotes: 'Changed' }, { type: 'phone' }, { durationMinutes: 45 }]) {
    await assert.rejects(f.book({ ...input, ...change }), { statusCode: 409, code: 'BOOKING_INTENT_CONFLICT' });
  }
  assert.equal(f.state.calls, 1);
  f.state.active = false; await assert.rejects(f.book(input), { statusCode: 403 });
});
test('different explicit intents remain distinct and canonical payload excludes retry identifier', async () => {
  const f = fixture(), input = data(), next = { ...input, clientRequestId: crypto.randomUUID() };
  assert.equal(canonicalIntent(input), canonicalIntent(next));
  assert.notEqual((await f.book(input)).rows[0].id, (await f.book(next)).rows[0].id);
  assert.equal(f.state.calls, 2);
});
test('opaque request recovery returns only scoped saved identity and never calls selection again', async () => {
  const f=fixture(), input=data(), saved=await f.book(input);
  const recovered=await f.read(input.clientRequestId);
  assert.equal(recovered.id,saved.rows[0].id);assert.equal(f.state.calls,1);
  assert.deepEqual(Object.keys(recovered).sort(),['id','providerId','scheduledAt','status']);
  await assert.rejects(f.read(crypto.randomUUID()),{statusCode:404});
  await assert.rejects(f.read(input.clientRequestId,{marketScope:'US'}),{statusCode:403});
  f.state.market='US';await assert.rejects(f.read(input.clientRequestId,{marketScope:'US'}),{statusCode:404});f.state.market='NG';
  await assert.rejects(f.read(input.clientRequestId,{actor:{id:crypto.randomUUID(),role:'patient'}}),{statusCode:403});
  f.state.active=false;await assert.rejects(f.read(input.clientRequestId),{statusCode:403});
});
const target = process.env.SIMULATION_DATABASE_URL;
test('PostgreSQL intent races select once across fallback providers, conflict safely and rollback atomically', { skip: !target, timeout: 45000 }, async () => {
  const safety = fixtureTargetSafety({ env: { ...process.env, DATABASE_URL: target } }); assert.equal(safety.skipped, false, safety.reason);
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: target, max: 6, statement_timeout: 10000 });
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const currentActor = { id: ids[0], role: 'patient' }; let selections = 0;
  const db = { transaction: async fn => { const c = await pool.connect(); try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); } } };
  const book = (input, options = {}) => withBookingIntent(db, { actor: options.actor || currentActor, marketScope: options.marketScope || 'NG', data: input }, async tx => {
    const providerId = ids[1 + selections++ % 2];
    if (options.onSelected) options.onSelected((await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    if (options.pause) await options.pause;
    const rows = (await tx.query(`INSERT INTO appointments(patient_id,provider_id,scheduled_at,duration_minutes,type,reason_for_visit,status)
      VALUES($1,$2,$3,30,'video','Synthetic intent fixture','scheduled') RETURNING *`, [currentActor.id, providerId, input.scheduledAt])).rows;
    if (options.fail) throw Error('Synthetic precommit failure');
    return { rows, providerId };
  });
  try {
    for (const [i,id] of ids.entries()) await pool.query(`INSERT INTO users(id,email,password_hash,role,first_name,last_name,is_active,is_test_account,market_scope,provider_status)
      VALUES($1,$2,'!synthetic',$3,'Synthetic','Booking',TRUE,TRUE,'NG','approved')`, [id, `booking-${id}@example.invalid`, i === 0 || i === 3 ? 'patient' : 'provider']);
    const input = data();
    let release, selected;
    const pause = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { selected = resolve; });
    const firstRequest = book(input, { pause, onSelected: selected });
    const blockerPid = await entered;
    const secondRequest = book(input); secondRequest.catch(() => {});
    try {
      let waiting = false; const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        waiting = (await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))) AS waiting`, [blockerPid])).rows[0].waiting;
        if (waiting) break; await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(waiting, true, 'Same intent must actually wait for the first transaction before choosing a provider');
    } finally { release(); }
    const exact = await Promise.all([firstRequest, secondRequest]);
    assert.equal(exact[0].rows[0].id, exact[1].rows[0].id); assert.equal(selections, 1); assert.equal(exact.filter(r => !r.deduplicated).length, 1);
    const collision = { ...input, clientRequestId: crypto.randomUUID() };
    const conflict = await Promise.allSettled([book(collision), book({ ...collision, patientNotes: 'Changed intent' })]);
    assert.equal(conflict.filter(r => r.status === 'fulfilled').length, 1); assert.equal(conflict.find(r => r.status === 'rejected').reason.statusCode, 409);
    await assert.rejects(book(input, { marketScope: 'US' }), { statusCode: 403 });
    await pool.query("UPDATE users SET market_scope='US' WHERE id=$1", [ids[0]]);
    await assert.rejects(book(input, { marketScope: 'US' }), { statusCode: 403 });
    await pool.query("UPDATE users SET market_scope='NG' WHERE id=$1", [ids[0]]);
    // A different actor cannot replay the first actor's saved row. Its operation
    // here deliberately returns another patient's row and must roll back.
    await assert.rejects(book(input, { actor: { id: ids[3], role: 'patient' } }), { code: 'BOOKING_RESULT_INVALID' });
    const before = (await pool.query('SELECT count(*)::int AS n FROM appointments WHERE patient_id=$1', [ids[0]])).rows[0].n;
    await assert.rejects(book({ ...input, clientRequestId: crypto.randomUUID() }, { fail: true }), /precommit failure/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM appointments WHERE patient_id=$1', [ids[0]])).rows[0].n, before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM appointment_booking_intents WHERE actor_id=$1', [ids[0]])).rows[0].n, 2);
    // Execute the actual smart-book HTTP handler with real PostgreSQL intent,
    // fallback selection and reservation; only external notifications are stubbed.
    const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
    const filename = require.resolve('../routes/appointments'), actual = createRequire(filename), handlers = new Map();
    const router = {}; for (const method of ['get','post','put','patch','delete','use']) router[method] = (path,...chain) => handlers.set(`${method} ${path}`,chain.at(-1));
    let notifications = 0;
    const routeDb = { ...db, query: (sql,args) => {
      if (sql.includes('INSERT INTO notifications')) { notifications++; return Promise.resolve({rows:[]}); }
      return pool.query(sql,args);
    } };
    const deps = { express:{Router:()=>router}, '../db':routeDb,
      '../middleware/auth':{authenticate(){},requireRole:()=>()=>{}}, '../middleware/accessControl':{requirePaidAccess(){}},
      '../middleware/audit':{auditMiddleware:()=>()=>{}}, '../middleware/logger':{info(){},warn(){},error(){}},
      '../services/testingAccessService':{getUserTestingAccess:async()=>({testingBypassActive:false})},
      '../services/email':{sendAppointmentNotification:async()=>{}}, '../services/notifications':{},
    };
    const mod={exports:{}}; vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:mod,exports:mod.exports,require:name=>deps[name]||actual(name),console,process});
    const uniqueSpecialty=`synthetic-intent-${crypto.randomUUID()}`;
    await pool.query('UPDATE users SET specialty=$1 WHERE id=ANY($2::uuid[])',[uniqueSpecialty,[ids[1],ids[2]]]);
    const body={...data(),scheduledAt:'2031-01-01T10:00:00Z',specialties:[uniqueSpecialty],category:uniqueSpecialty};
    async function call(input) { const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
      await handlers.get('post /smart-book')({body:input,user:{...currentActor,marketScope:'NG'}},res);return res; }
    const responses=await Promise.all([call(body),call(body)]);
    assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,201]);
    assert.equal(responses[0].body.appointment.id,responses[1].body.appointment.id);
    assert.ok([ids[1],ids[2]].includes(responses[0].body.appointment.providerId));
    const recovered = await readBookingIntent(db,{actor:currentActor,marketScope:'NG',clientRequestId:body.clientRequestId});
    assert.equal(recovered.id,responses[0].body.appointment.id);
    assert.deepEqual(Object.keys(recovered).sort(),['id','providerId','scheduledAt','status']);
    await assert.rejects(readBookingIntent(db,{actor:{id:ids[3],role:'patient'},marketScope:'NG',clientRequestId:body.clientRequestId}),{statusCode:404});
    await assert.rejects(readBookingIntent(db,{actor:currentActor,marketScope:'NG',clientRequestId:crypto.randomUUID()}),{statusCode:404});

    await new Promise(resolve=>setImmediate(resolve));assert.equal(notifications,1);
    assert.equal(responses.find(r=>r.statusCode===200).body.dispatch.status,'not_repeated');
    const changed=await call({...body,reasonForVisit:'Changed clinical request'});assert.equal(changed.statusCode,409);
    assert.equal(notifications,1);assert.equal(responses[0].body.appointment.paymentCompleted,false);
    const tombstone = {...input,clientRequestId:crypto.randomUUID()}; const removable=await book(tombstone);
    await pool.query('DELETE FROM appointments WHERE id=$1',[removable.rows[0].id]);
    await assert.rejects(book(tombstone),{code:'BOOKING_RECONCILIATION_REQUIRED'});
    assert.equal((await pool.query('SELECT appointment_id FROM appointment_booking_intents WHERE actor_id=$1 AND client_request_id=$2',[ids[0],tombstone.clientRequestId])).rows[0].appointment_id,null);
    await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1', [ids[0]]);
    await assert.rejects(book(input), { statusCode: 403 });
  } finally {
    await pool.query('DELETE FROM appointment_booking_intents WHERE actor_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM appointments WHERE patient_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]); await pool.end();
  }
});
