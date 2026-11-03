'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const target = process.env.SIMULATION_DATABASE_URL;
for (const tz of ['UTC','Africa/Lagos','America/New_York']) test(`PostgreSQL DATE authorization and timestamp distinction remain correct in ${tz}`, { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'), 'Only an explicitly disposable loopback database is supported.');
  await execFile(process.execPath,['-e',`require(${JSON.stringify(require.resolve('./helpers/sql-date-db-scenario'))}).run().catch(error=>{console.error(error);process.exitCode=1;})`],{
    env:{...process.env,TZ:tz,NODE_ENV:'test'},timeout:90000,maxBuffer:1024*1024,
  });
});
