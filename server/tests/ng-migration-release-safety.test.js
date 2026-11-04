'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runNgMigrations,NG_LOCK_KEY}=require('../../ng/migrations/migrate');
const fs = require('node:fs');
const path = require('node:path');
const { checksum } = require('../../ng/migrations/migrate');

function migrationHistory() {
 const dir = path.resolve(__dirname, '../../ng/migrations');
 return fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort().map(filename => ({
  filename, sql: fs.readFileSync(path.join(dir, filename), 'utf8'),
 }));
}

test('NG checks all recorded digests before any pending SQL or legacy baseline write', async () => {
 const files = migrationHistory();
 assert.ok(files.length >= 3);
 const calls = [];
 const rows = files.slice(1).map((file, i, history) => ({
  filename: file.filename,
  checksum: i === history.length - 1 ? '0'.repeat(64) : i === 0 ? null : checksum(file.sql),
 }));
 const client = { async query(sql, args = []) {
  calls.push({ sql, args });
  return { rows: sql === 'SELECT filename, checksum FROM ng_migrations' ? rows : [] };
 }, release(discard) { calls.push({ sql: 'RELEASE', discard }); } };
 await assert.rejects(runNgMigrations({ connect: async () => client }), /Migration checksum mismatch/);
 assert.ok(!calls.some(call => files.some(file => file.sql === call.sql)), 'no pending migration may execute before all history is checked');
 assert.ok(!calls.some(call => /^(INSERT INTO|UPDATE) ng_migrations/.test(call.sql)), 'do not adopt or insert any digest before all history is checked');
 assert.ok(calls.some(call => call.sql.includes('pg_advisory_unlock')));
 assert.equal(calls.at(-1).sql, 'RELEASE');
 assert.equal(calls.at(-1).discard, false);
});

test('NG legacy checksum adoption warns without rerunning historical SQL', async (t) => {
 const files = migrationHistory();
 const calls = [], warnings = [];
 const rows = files.map((file, i) => ({ filename: file.filename, checksum: i === 0 ? null : checksum(file.sql) }));
 t.mock.method(console, 'warn', message => warnings.push({ message, count: calls.length }));
 const client = { async query(sql, args = []) {
  calls.push({ sql, args });
  return { rows: sql === 'SELECT filename, checksum FROM ng_migrations' ? rows : [] };
 }, release() {} };
 const result = await runNgMigrations({ connect: async () => client });
 assert.equal(result.ran, 0);
 assert.ok(!calls.some(call => files.some(file => file.sql === call.sql)));
 assert.equal(warnings.length, 1);
 assert.ok(warnings[0].message.includes(files[0].filename));
 assert.match(warnings[0].message, /historical SQL is not verified/);
 const adoption = calls.findIndex(call => call.sql.startsWith('UPDATE ng_migrations'));
 assert.ok(adoption >= warnings[0].count, 'warning precedes baseline write');
 assert.equal(calls[adoption].args[1], checksum(files[0].sql));
});
test('NG schema runner uses one connection and advisory lock for schema and tracking',async()=>{
 const calls=[];
 const client={async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes('SELECT filename, checksum FROM ng_migrations'))return {rows:[]};
  return {rows:[]};
 },release(){calls.push({sql:'RELEASE'});}};
 const pool={connect:async()=>client};
 const result=await runNgMigrations(pool);
 assert.ok(result.total>0);
 const all=calls.map(x=>x.sql);
 assert.ok(all.some(x=>x.includes('pg_advisory_lock')));
 assert.ok(all.some(x=>x.includes('pg_advisory_unlock')));
 assert.ok(all.some(x=>x.includes('INSERT INTO ng_migrations')));
 assert.equal(all.at(-1),'RELEASE');
 assert.equal(all.filter(x=>x==='BEGIN').length,all.filter(x=>x==='COMMIT').length);
 assert.equal(all.filter(x=>x==='ROLLBACK').length,0);
 assert.equal(NG_LOCK_KEY,'doctarx_ng_migrations_v1');
});
test('failed schema migration rolls back and always releases connection and advisory lock',async()=>{
 const calls=[];
 const client={async query(sql){
  calls.push(sql);
  if(sql.includes('SELECT filename, checksum FROM ng_migrations')) return {rows:[]};
  if(sql.includes('INSERT INTO ng_migrations'))throw Object.assign(new Error('synthetic schema failure'),{code:'SIMULATED'});
  return {rows:[]};
 },release(){calls.push('RELEASE');}};
 const pool={connect:async()=>client};
 await assert.rejects(runNgMigrations(pool),/synthetic schema failure/);
 assert.ok(calls.includes('ROLLBACK'));
 assert.ok(calls.some(x=>x.includes('pg_advisory_unlock')));
 assert.equal(calls.at(-1),'RELEASE');
});

for (const cleanupFailure of ['unlock', 'reset']) {
 test(`migration cleanup discards the session when ${cleanupFailure} fails`, async () => {
  let releaseArgument; let resetCount = 0;
  const client = { async query(sql) {
   if (sql.includes('SELECT filename, checksum FROM ng_migrations')) return { rows: [] };
   if (cleanupFailure === 'unlock' && sql.includes('pg_advisory_unlock')) throw new Error('Synthetic unlock failure');
   if (sql === 'SET lock_timeout TO DEFAULT' && ++resetCount === 2 && cleanupFailure === 'reset') throw new Error('Synthetic reset failure');
   return { rows: [] };
  }, release(discard) { releaseArgument = discard; } };
  await runNgMigrations({ connect: async () => client });
  assert.equal(releaseArgument, true, 'must destroy rather than pool an uncertain session');
 });
}
