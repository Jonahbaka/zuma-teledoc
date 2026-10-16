'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertMinor, decimalToMinor, minorToDecimalString, buildPricing, stageAmounts, ledgerAllocations } = require('../services/logistics/deliveryPricing');

const now = Date.parse('2026-10-15T12:00:00Z');
const quote = { currency: 'NGN', feeMinor: 280000, expiresAt: '2026-10-15T12:15:00Z' };
const delivery = (overrides = {}) => buildPricing({ medicinesMinor: 900000, deliveryType: 'delivery', quote, now, ...overrides });
const coordination = { authorized: true, billable: true, authorizationReference: 'separate-coordination-authority' };

test('confirmed courier quote and fixed management fee produce the requested NGN 12,550 example', () => {
  const pricing = delivery();
  assert.equal(pricing.currency, 'NGN');
  assert.equal(pricing.medicinesMinor, 900000);
  assert.equal(pricing.courierMinor, 280000);
  assert.equal(pricing.managementMinor, 75000);
  assert.equal(pricing.coordinationMinor, 0);
  assert.equal(pricing.taxMinor, 0);
  assert.equal(pricing.totalMinor, 1255000);
  assert.equal(pricing.patientTotalMinor, 1255000);
  assert.equal(pricing.insurerTotalMinor, 0);
});

test('pickup carries no courier or delivery-management charge, including a stale saved quote', () => {
  const pricing = delivery({ deliveryType: 'pickup', quote: { ...quote, expiresAt: '2000-01-01T00:00:00Z' } });
  assert.equal(pricing.courierMinor, 0);
  assert.equal(pricing.managementMinor, 0);
  assert.equal(pricing.totalMinor, 900000);
  assert.equal(pricing.quoteExpiresAt, null);
  assert.equal(stageAmounts(pricing, 'delivery').totalMinor, 0);
});

test('unavailable quote preserves unknown courier totals while the medicine stage remains payable', () => {
  const pricing = delivery({ quote: null });
  assert.equal(pricing.courierMinor, null);
  assert.equal(pricing.managementMinor, 75000);
  assert.equal(pricing.totalMinor, null);
  assert.equal(pricing.patientTotalMinor, null);
  assert.equal(stageAmounts(pricing, 'medicines').patientMinor, 900000);
  assert.equal(stageAmounts(pricing, 'delivery').patientMinor, null);
  assert.throws(() => ledgerAllocations(pricing), { code: 'INCOMPLETE_DELIVERY_PRICING' });
});

test('a later courier quotation changes only its authoritative amount and never increases fees twice', () => {
  const original = delivery();
  const refreshed = delivery({ quote: { ...quote, feeMinor: 300001 } });
  assert.equal(refreshed.courierMinor - original.courierMinor, 20001);
  assert.equal(refreshed.patientTotalMinor - original.patientTotalMinor, 20001);
  assert.equal(refreshed.managementMinor, 75000);
  assert.equal(original.courierMinor, 280000);
});

test('expired quotes and quotes expiring exactly now are rejected', () => {
  for (const expiresAt of ['2026-10-15T11:59:59Z', '2026-10-15T12:00:00Z']) {
    assert.throws(() => delivery({ quote: { ...quote, expiresAt } }), { code: 'QUOTE_EXPIRED' });
  }
  assert.equal(delivery({ now: new Date(now) }).courierMinor, 280000);
});

test('courier prices require NGN, exact nonnegative kobo and an absolute expiry', () => {
  assert.throws(() => delivery({ quote: { ...quote, currency: 'USD' } }), { code: 'QUOTE_CURRENCY_MISMATCH' });
  for (const expiresAt of [undefined, null, '', 'tomorrow', '2026-10-15', '2026-10-15T12:15:00', 'invalidZ']) {
    assert.throws(() => delivery({ quote: { ...quote, expiresAt } }));
  }
  for (const feeMinor of [-1, 1.1, NaN, Infinity, undefined, null, '1e3', '0280000']) assert.throws(() => delivery({ quote: { ...quote, feeMinor } }));
});

test('coordination charges require separate authorization and billability and never duplicate an included fee', () => {
  for (const input of [null, {}, { authorized: true }, { billable: true }, { ...coordination, authorized: false }, { ...coordination, billable: false }, { ...coordination, includedElsewhere: true }]) {
    assert.equal(delivery({ coordination: input }).coordinationMinor, 0);
  }
  assert.equal(delivery({ coordination }).coordinationMinor, 50000);
  assert.throws(() => delivery({ coordination: { authorized: true, billable: true } }), { code: 'COORDINATION_AUTHORIZATION_REQUIRED' });
  assert.throws(() => delivery({ coordination: { ...coordination, payer: 'employer-guess' } }));
});

test('verified HMO coordination coverage is a separate NGN 500 receivable, leaving patient NGN 12,550', () => {
  const pricing = delivery({ coordination: { ...coordination, payer: 'insurer' }, coverage: { verified: true, authorizationReference: 'verified-hmo-service-approval', allocations: { coordinationMinor: 50000 } } });
  assert.equal(pricing.totalMinor, 1305000);
  assert.equal(pricing.patientTotalMinor, 1255000);
  assert.equal(pricing.insurerTotalMinor, 50000);
  const ledger = ledgerAllocations(pricing);
  assert.equal(ledger.insurerReceivableMinor, 50000);
  assert.equal(ledger.patientCashMinor, 0);
  assert.equal(ledger.coordinationRevenueMinor, 50000);
  assert.equal(ledger.managementRevenueMinor, 0);
  assert.equal(ledger.managementUnearnedMinor, 75000);
  assert.equal(ledger.balanced, true);
});

test('unverified or pending coverage never reduces a patient invoice', () => {
  for (const coverage of [null, {}, { verified: false, authorizationReference: 'pending', allocations: { medicinesMinor: 900000 } }, { verified: 'true', allocations: { medicinesMinor: 900000 } }]) {
    const pricing = delivery({ coverage });
    assert.equal(pricing.patientTotalMinor, 1255000);
    assert.equal(pricing.insurerTotalMinor, 0);
    assert.equal(pricing.coverageApplied, false);
  }
});

test('explicit insurer coordination payer cannot fall through to an unapproved patient charge', () => {
  for (const coverage of [null, { verified: false }, { verified: true, authorizationReference: 'approval', allocations: { coordinationMinor: 49999 } }]) {
    assert.throws(() => delivery({ coordination: { ...coordination, payer: 'insurer' }, coverage }), { code: 'COORDINATION_COVERAGE_REQUIRED' });
  }
  assert.throws(() => delivery({ coordination: { ...coordination, payer: 'patient' }, coverage: { verified: true, authorizationReference: 'approval', allocations: { coordinationMinor: 50000 } } }));
});

test('insurance allocations are explicit, bounded per line, and cannot cover an unknown quote', () => {
  for (const coverage of [
    { verified: true, allocations: {} },
    { verified: true, authorizationReference: 'approval' },
    { verified: true, authorizationReference: 'approval', allocations: { medicinesMinor: 900001 } },
    { verified: true, authorizationReference: 'approval', allocations: { arbitraryMinor: 1 } },
    { verified: true, authorizationReference: 'approval', allocations: { coordinationMinor: 1 } },
    { verified: true, authorizationReference: 'approval', allocations: { taxMinor: -1 } },
  ]) assert.throws(() => delivery({ coverage }));
  assert.throws(() => delivery({ quote: null, coverage: { verified: true, authorizationReference: 'approval', allocations: { courierMinor: 1 } } }), { code: 'COVERAGE_OVERALLOCATION' });
});

test('partial verified insurance coverage splits both payment stages exactly', () => {
  const pricing = delivery({ coordination, taxes: [{ amountMinor: 1234, verified: true, ruleReference: 'verified-applicable-tax-rule' }], coverage: { verified: true, authorizationReference: 'approval', allocations: { medicinesMinor: 400000, courierMinor: 50000, managementMinor: 25000, coordinationMinor: 10000, taxMinor: 234 } } });
  const medicines = stageAmounts(pricing, 'medicines');
  const dispatch = stageAmounts(pricing, 'delivery');
  assert.equal(medicines.totalMinor, 951234);
  assert.equal(medicines.insurerMinor, 410234);
  assert.equal(medicines.patientMinor, 541000);
  assert.equal(dispatch.totalMinor, 355000);
  assert.equal(dispatch.insurerMinor, 75000);
  assert.equal(dispatch.patientMinor, 280000);
  assert.equal(medicines.totalMinor + dispatch.totalMinor, pricing.totalMinor);
  assert.equal(medicines.patientMinor + dispatch.patientMinor, pricing.patientTotalMinor);
  assert.equal(medicines.insurerMinor + dispatch.insurerMinor, pricing.insurerTotalMinor);
});

test('tax is zero by default and every nonzero tax requires a verified applicable rule', () => {
  assert.equal(delivery().taxMinor, 0);
  assert.equal(delivery({ taxes: [{ amountMinor: 123, verified: true, ruleReference: 'verified-tax-rule' }] }).taxMinor, 123);
  for (const taxes of [750, {}, [{ amountMinor: 750, verified: true }], [{ amountMinor: 750, ruleReference: 'assumed-vat' }], [{ amountMinor: -1, verified: true, ruleReference: 'rule' }]]) assert.throws(() => delivery({ taxes }));
});

test('decimal conversion never rounds kobo or accepts permissive numeric representations', () => {
  assert.equal(decimalToMinor('9000'), 900000);
  assert.equal(decimalToMinor('2800.01'), 280001);
  assert.equal(decimalToMinor('0.1'), 10);
  assert.equal(decimalToMinor('0.00'), 0);
  assert.equal(decimalToMinor('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  for (const value of [null, undefined, true, '', '-1', '01', ' 1', '1e3', '1.001', '.10', '1.', '9,000', '90071992547409.92', NaN, Infinity]) assert.throws(() => decimalToMinor(value));
});

test('minor conversion accepts safe canonical database integers and preserves exact decimals', () => {
  assert.equal(assertMinor('280001'), 280001);
  assert.equal(assertMinor(0), 0);
  assert.equal(minorToDecimalString(280001), '2800.01');
  assert.equal(minorToDecimalString('10'), '0.10');
  assert.equal(minorToDecimalString(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  for (const value of [null, undefined, true, '', '00', '01', '1.0', '1e3', '-1', -1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) assert.throws(() => assertMinor(value));
});

test('every sum uses checked integer arithmetic, including tax and stage aggregates', () => {
  assert.throws(() => delivery({ medicinesMinor: Number.MAX_SAFE_INTEGER }));
  assert.throws(() => delivery({ taxes: [{ amountMinor: Number.MAX_SAFE_INTEGER, verified: true, ruleReference: 'a' }, { amountMinor: 1, verified: true, ruleReference: 'b' }] }));
  assert.throws(() => stageAmounts({ currency: 'NGN', medicinesMinor: Number.MAX_SAFE_INTEGER, coordinationMinor: 1, taxMinor: 0, allocations: { patient: { medicinesMinor: Number.MAX_SAFE_INTEGER, coordinationMinor: 1, taxMinor: 0 }, insurer: { medicinesMinor: 0, coordinationMinor: 0, taxMinor: 0 } } }, 'medicines'));
  assert.equal(buildPricing({ medicinesMinor: Number.MAX_SAFE_INTEGER, deliveryType: 'pickup' }).totalMinor, Number.MAX_SAFE_INTEGER);
});

test('ledger separates pass-through payables from earned DoctaRx revenue and actual processing cost', () => {
  const pricing = delivery();
  const before = ledgerAllocations(pricing, { patientCollectedMinor: 1255000, processingCostMinor: 15000 });
  assert.equal(before.pharmacyPayableMinor, 900000);
  assert.equal(before.courierPayableMinor, 280000);
  assert.equal(before.managementUnearnedMinor, 75000);
  assert.equal(before.managementRevenueMinor, 0);
  assert.equal(before.processingCostMinor, 15000);
  assert.equal(before.patientCashMinor, 1240000);
  assert.equal(before.patientReceivableMinor, 0);
  assert.equal(before.totalDebitsMinor, 1255000);
  assert.equal(before.totalCreditsMinor, 1255000);
  const completed = ledgerAllocations(pricing, { deliveryCompleted: true, patientCollectedMinor: 1255000, processingCostMinor: 15000 });
  assert.equal(completed.managementUnearnedMinor, 0);
  assert.equal(completed.managementRevenueMinor, 75000);
  assert.equal(completed.patientCashMinor - completed.pharmacyPayableMinor - completed.courierPayableMinor, 60000);
  assert.equal(completed.balanced, true);
});

test('posting never assumes an invoice or insurer receivable is cash already collected', () => {
  const ledger = ledgerAllocations(delivery());
  assert.equal(ledger.patientReceivableMinor, 1255000);
  assert.equal(ledger.patientCashMinor, 0);
  assert.equal(ledger.processingCostMinor, 0);
  assert.throws(() => ledgerAllocations(delivery(), { patientCollectedMinor: 1255001 }));
  assert.throws(() => ledgerAllocations(delivery(), { processingCostMinor: 1 }));
  assert.throws(() => ledgerAllocations(delivery(), { patientCollectedMinor: 10, processingCostMinor: 11 }));
});

test('tampered or incomplete invoice totals cannot post an unbalanced ledger', () => {
  assert.throws(() => ledgerAllocations({ ...delivery(), totalMinor: 1 }), { code: 'DELIVERY_LEDGER_UNBALANCED' });
  assert.throws(() => ledgerAllocations({ ...delivery(), courierMinor: 1 }), { code: 'DELIVERY_LEDGER_UNBALANCED' });
  const tamperedAllocation = delivery();
  tamperedAllocation.allocations.patient.courierMinor = 1;
  assert.throws(() => ledgerAllocations(tamperedAllocation), { code: 'DELIVERY_LEDGER_UNBALANCED' });
  const tamperedPayerTotals = delivery();
  tamperedPayerTotals.patientTotalMinor -= 100;
  tamperedPayerTotals.insurerTotalMinor += 100;
  assert.throws(() => ledgerAllocations(tamperedPayerTotals), { code: 'DELIVERY_LEDGER_UNBALANCED' });
  assert.throws(() => stageAmounts(delivery(), 'unknown-stage'));
  assert.throws(() => buildPricing({ medicinesMinor: 900000, deliveryType: 'drone' }));
});
