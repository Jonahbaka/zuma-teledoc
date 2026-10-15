'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const filename = path.resolve(__dirname, '../services/financialService.js');
const source = fs.readFileSync(filename, 'utf8');
const migration = fs.readFileSync(path.resolve(__dirname, '../db/migrations/400_financial_system.sql'), 'utf8');

// Execute the actual service with a recording storage boundary. These startup
// controls never connect to, seed, clear, or alter a database or real account.
function serviceFixture({ failures = [], sql = migration, accounts = [] } = {}) {
  const queries = [], timers = [];
  const isolated = { exports: {} };
  const db = {
    async query(statement, params) {
      queries.push({ statement, params });
      if (failures.length) throw failures.shift();
      return { rows: statement.includes('SELECT ba.*') ? accounts : [] };
    },
    getClient() { throw new Error('Startup must never acquire a ledger-seeding client.'); },
  };
  const dependencies = { '../db': db, path, fs: { readFileSync() { return sql; } } };
  vm.runInNewContext(source, {
    __dirname: path.dirname(filename), module: isolated, exports: isolated.exports,
    process: { env: { NODE_ENV: 'production' } }, console: { log() {}, error() {} },
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    require(name) { assert.ok(name in dependencies, 'Unexpected startup dependency: ' + name); return dependencies[name]; },
  }, { filename });
  return { service: isolated.exports, queries, timers };
}

function assertOnlySchemaAndStaticAccounts(statement) {
  const tables = text => [...text.matchAll(/CREATE TABLE IF NOT EXISTS (fin_\w+)/g)].map(match => match[1]);
  const indexes = text => [...text.matchAll(/CREATE INDEX IF NOT EXISTS (idx_fin_\w+)/g)].map(match => match[1]);
  assert.deepEqual(tables(statement), tables(migration), 'All existing financial table definitions remain available');
  assert.deepEqual(indexes(statement), indexes(migration), 'All existing financial index definitions remain available');
  assert.ok(tables(statement).length >= 16);
  const mutations = [...statement.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+(\w+)/gi)].map(match => match[1]);
  assert.deepEqual(mutations, ['fin_chart_of_accounts'], 'Only the approved static account definitions may be inserted at startup');
  assert.match(statement, /ON CONFLICT \(account_number\) DO NOTHING/);
  assert.doesNotMatch(statement, /INSERT INTO fin_(?:bank_accounts|fiscal_periods|journal_entries|journal_lines|bank_transactions|accounts_receivable|accounts_payable|stripe_bridge|roi_tracking|investor_relations)/);
}

test('production startup initializes every financial table without populating an empty ledger or unverified bank records', async () => {
  const fixture = serviceFixture();
  assert.equal(await fixture.service.initialize(), true);
  assert.equal(fixture.queries.length, 1); assert.equal(fixture.timers.length, 0);
  assertOnlySchemaAndStaticAccounts(fixture.queries[0].statement);
  assert.doesNotMatch(source, /seedOpeningTransactions|system_seed|Seeding opening financial transactions/);
});

test('already-existing financial schema cannot trigger opening entries through either compatibility error branch', async () => {
  for (const failure of [Object.assign(new Error('duplicate relation'), { code: '42P07' }), new Error('relation already exists')]) {
    const fixture = serviceFixture({ failures: [failure] });
    assert.equal(await fixture.service.initialize(), true);
    assert.equal(fixture.queries.length, 1); assert.equal(fixture.timers.length, 0);
    assertOnlySchemaAndStaticAccounts(fixture.queries[0].statement);
  }
});

test('financial initialization recovery retries only schema and static account definitions', async () => {
  const fixture = serviceFixture({ failures: [new Error('temporary storage outage')] });
  assert.equal(await fixture.service.initialize(), false);
  assert.equal(fixture.timers.length, 1); assert.equal(fixture.timers[0].delay, 10000);
  await fixture.timers[0].callback();
  assert.equal(fixture.queries.length, 2);
  for (const query of fixture.queries) assertOnlySchemaAndStaticAccounts(query.statement);
});

test('an unreviewed or ambiguous financial SQL boundary fails before database execution, including recovery', async () => {
  for (const sql of [migration.replace('--  SEED DATA: Bank Accounts', '-- moved bank fixtures'), migration + '\n--  SEED DATA: Bank Accounts']) {
    const fixture = serviceFixture({ sql });
    assert.equal(await fixture.service.initialize(), false);
    assert.equal(fixture.queries.length, 0);
    await fixture.timers[0].callback(); assert.equal(fixture.queries.length, 0);
  }
});

test('startup leaves recorded bank rows intact and existing financial readers continue returning their actual results', async () => {
  const accounts = [{ id: 'recorded-bank-row', account_number: 'existing-account', current_balance: '215.37', available_balance: '200.00', transaction_count: '2' }];
  const snapshot = structuredClone(accounts); const fixture = serviceFixture({ accounts });
  assert.equal(await fixture.service.initialize(), true);
  assert.equal(await fixture.service.getBankAccounts(), accounts);
  assert.deepEqual(accounts, snapshot);
  assert.equal(fixture.queries.length, 2);
  assert.match(fixture.queries[1].statement, /FROM fin_bank_accounts ba/);
  assert.match(fixture.queries[1].statement, /WHERE ba.is_active = true/);
  assertOnlySchemaAndStaticAccounts(fixture.queries[0].statement);
});
