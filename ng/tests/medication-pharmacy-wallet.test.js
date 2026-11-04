'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PHARMACY = '00000000-0000-4000-8000-000000000001';

function fixture({ walletExists = true, statement, statementError } = {}) {
  const calls = [];
  const legacy = { id: 'legacy-wallet', pharmacy_id: PHARMACY, balance: '1200.50', pending_balance: '300.25', total_withdrawn: '500.00' };
  const transaction = { id: 'legacy-credit', type: 'credit', amount: '300.25' };
  const pool = {
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      assert.deepEqual(Array.from(parameters), [PHARMACY]);
      assert.match(sql.trim(), /^(?:SELECT|WITH) /);
      if (sql.includes('WITH pharmacy_liability')) {
        if (statementError) throw statementError;
        return { rows: statement === null ? [] : [{ outstanding_minor: '900000', settled_minor: '450000', order_count: '2', ...statement }] };
      }
      if (sql.includes('FROM ng_pharmacy_wallets')) return { rows: walletExists ? [legacy] : [] };
      if (sql.includes("date_trunc('month'")) return { rows: [{ total: '900.50' }] };
      if (sql.includes('CURRENT_DATE')) return { rows: [{ total: '300.25' }] };
      if (sql.includes('FROM ng_wallet_transactions')) return { rows: [transaction] };
      throw new Error('Unexpected wallet database access');
    },
  };
  let providerCalls = 0;
  const loaded = { exports: {} };
  const filename = path.resolve(__dirname, '../services/pharmacy/walletService.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: loaded,
    require(name) {
      if (name === '../../../server/db') return { getPool: () => pool };
      if (name === '../payments/paymentOrchestrator') return { settlePharmacy() { providerCalls++; throw new Error('Read-only statement must never transfer funds'); } };
      throw new Error(`Unexpected wallet dependency ${name}`);
    },
  }, { filename });
  return { service: loaded.exports, calls, legacy, transaction, providerCalls: () => providerCalls };
}

test('medication statement reports integer kobo while preserving every legacy wallet balance and transaction', async () => {
  const f = fixture();
  const wallet = await f.service.getWallet(PHARMACY);
  assert.equal(wallet.balance, f.legacy.balance);
  assert.equal(wallet.pending_balance, f.legacy.pending_balance);
  assert.equal(wallet.total_withdrawn, f.legacy.total_withdrawn);
  assert.equal(wallet.todayEarnings, 300.25);
  assert.equal(wallet.monthEarnings, 900.5);
  assert.equal(wallet.recentTransactions[0], f.transaction);
  assert.deepEqual(JSON.parse(JSON.stringify(wallet.medicationStatement)), {
    currency: 'NGN', outstandingMinor: 900000, settledMinor: 450000, orderCount: 2, processingCostsBorneBy: 'DoctaRx',
  });
  assert.equal(f.providerCalls(), 0);
  const aggregate = f.calls.find(call => call.sql.includes('WITH pharmacy_liability')).sql;
  assert.match(aggregate, /o\.pharmacy_id=\$1 AND l\.account='pharmacy_payable' AND l\.currency='NGN'/);
  assert.match(aggregate, /o\.pharmacy_id=\$1 AND s\.payee='pharmacy' AND s\.status='verified'/);
  assert.match(aggregate, /SUM\(l\.credit_minor-l\.debit_minor\)/);
  assert.equal((aggregate.match(/JOIN ng_orders o ON o.id=/g) || []).length, 2);
});

test('empty medication ledger produces explicit zero balances without fabricating legacy cash', async () => {
  const f = fixture({ statement: { outstanding_minor: '0', settled_minor: '0', order_count: '0' } });
  const wallet = await f.service.getWallet(PHARMACY);
  assert.equal(wallet.medicationStatement.outstandingMinor, 0);
  assert.equal(wallet.medicationStatement.settledMinor, 0);
  assert.equal(wallet.medicationStatement.orderCount, 0);
  assert.equal(wallet.balance, '1200.50');
  assert.equal(f.providerCalls(), 0);
});

test('unsafe, negative or non-integer statement amounts fail without rounding or presenting invented balances', async () => {
  for (const statement of [
    { outstanding_minor: '9007199254740992' },
    { outstanding_minor: '-1' },
    { settled_minor: '12.5' },
    { order_count: null },
  ]) {
    const f = fixture({ statement });
    await assert.rejects(f.service.getWallet(PHARMACY), /financial reconciliation/);
    assert.equal(f.providerCalls(), 0);
  }
});

test('missing ledger or aggregate evidence fails visibly instead of returning a zero statement', async () => {
  for (const options of [{ statement: null }, { statementError: new Error('Medication ledger unavailable') }]) {
    const f = fixture(options);
    await assert.rejects(f.service.getWallet(PHARMACY), /(?:statement is unavailable|ledger unavailable)/);
    assert.equal(f.providerCalls(), 0);
  }
});

test('a missing onboarded wallet preserves the existing failure without inventing an account or payout', async () => {
  const f = fixture({ walletExists: false });
  await assert.rejects(f.service.getWallet(PHARMACY), /Wallet not found/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.providerCalls(), 0);
});
