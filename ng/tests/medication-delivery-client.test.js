'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const filename = path.resolve(__dirname, '../../lib/ngDeliveryApi.js');
const sourceModule = { exports: {} };
const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript' } }, module: { type: 'commonjs' } }).code;
vm.runInNewContext(compiled, { module: sourceModule, exports: sourceModule.exports, URL, Intl, crypto: { randomUUID: () => 'isolated-test-key' }, require(name) { assert.equal(name, '@/lib/api'); return { __esModule: true, default: {} }; } });
const helpers = sourceModule.exports;

test('NGN input converts exactly to kobo without permissive rounding or scientific notation', () => {
  assert.equal(helpers.nairaInputToKobo('9000'), 900000);
  assert.equal(helpers.nairaInputToKobo('2800.01'), 280001);
  assert.equal(helpers.nairaInputToKobo('0.1'), 10);
  assert.equal(helpers.nairaInputToKobo('750.00'), 75000);
  for (const input of ['', null, '-1', '01', '1.001', '1e3', '9,000', 'NaN', '9007199254740992']) assert.throws(() => helpers.nairaInputToKobo(input));
});

test('itemized monetary display preserves kobo and does not invent zero for unconfirmed values', () => {
  assert.equal(helpers.formatKobo(1255000), 'NGN 12,550.00');
  assert.equal(helpers.formatKobo('280001'), 'NGN 2,800.01');
  assert.equal(helpers.formatKobo(0), 'NGN 0.00');
  assert.equal(helpers.koboInput(900001), '9000.01');
  for (const amount of [null, undefined, '', -1, 1.5, Infinity, '1e3', '75000.0', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(helpers.formatKobo(amount), 'Awaiting confirmation');
    assert.equal(helpers.koboInput(amount), '');
  }
});

test('only recognized payment providers and exact HTTPS checkout hosts permit navigation', () => {
  assert.equal(helpers.hostedMedicationPaymentUrl({ provider: 'paystack', authorizationUrl: 'https://checkout.paystack.com/approved' }), 'https://checkout.paystack.com/approved');
  assert.equal(helpers.hostedMedicationPaymentUrl({ provider: 'flutterwave', authorizationUrl: 'https://checkout.flutterwave.com/v3/hosted/pay' }), 'https://checkout.flutterwave.com/v3/hosted/pay');
  for (const url of ['javascript:alert(1)', 'http://checkout.paystack.com/a', 'https://checkout.paystack.com.attacker.test/a', 'https://checkout.paystack.com@attacker.test/a', 'https://username@checkout.paystack.com/a', 'https://checkout.paystack.com:444/a', '/checkout']) assert.throws(() => helpers.hostedMedicationPaymentUrl({ provider: 'paystack', authorizationUrl: url }));
  assert.throws(() => helpers.hostedMedicationPaymentUrl({ provider: 'unknown', authorizationUrl: 'https://checkout.paystack.com/approved' }));
  assert.throws(() => helpers.hostedMedicationPaymentUrl({ checkoutUrl: 'https://checkout.paystack.com/approved' }));
});

test('malformed historical items and absent dates do not crash or manufacture tracking evidence', () => {
  assert.equal(helpers.orderItems('{broken').length, 0);
  assert.equal(helpers.orderItems('[null,{"drug_name":"Approved medicine"}]').length, 1);
  assert.equal(helpers.deliveryDate(null), 'Not yet confirmed');
  assert.equal(helpers.deliveryDate('invalid'), 'Not yet confirmed');
  assert.equal(helpers.statusLabel('refund_pending'), 'Refund pending');
});

function checkout(extra = {}) {
  return { orderId: 'owned-order', version: 2, pharmacy: { id: 'approved-pharmacy' }, deliveryType: 'delivery', checkout: { enabled: true },
    items: [{ drugId: 'medicine', name: 'Medicine', quantity: 1, unitPriceMinor: 900000, lineTotalMinor: 900000 }],
    pricing: { currency: 'NGN', medicinesMinor: 900000, courierMinor: 280000, managementMinor: 75000, coordinationMinor: 0, taxMinor: 0, patientTotalMinor: 1255000, insurerTotalMinor: 0, totalMinor: 1255000 },
    quote: { id: 'approved-quote', provider: 'uber_direct', fareMinor: 280000, expiresAt: '2099-01-01T00:00:00.000Z' },
    actions: Object.fromEntries(['canChoose', 'canApproveMedicines', 'canPayMedicines', 'canRequestQuote', 'canApproveQuote', 'canPayDelivery', 'canDispatch', 'canCancel', 'canMarkCollected'].map(key => [key, false])), ...extra };
}

test('checkout renders the exact NGN 12550 itemization and a separately covered coordination receivable', () => {
  const base = checkout();
  assert.equal(helpers.readMedicationCheckout(base, base.orderId).pricing.patientTotalMinor, 1255000);
  const insured = checkout({ pricing: { ...base.pricing, coordinationMinor: 50000, insurerTotalMinor: 50000, totalMinor: 1305000 }, coordination: { authorized: true, payer: 'insurer' } });
  assert.equal(helpers.readMedicationCheckout(insured, insured.orderId).pricing.patientTotalMinor, 1255000);
});

test('unknown courier quotation remains unknown and cannot become a zero-priced checkout total', () => {
  const base = checkout();
  const unknown = checkout({ quote: null, pricing: { ...base.pricing, courierMinor: null, patientTotalMinor: null, totalMinor: null } });
  assert.equal(helpers.readMedicationCheckout(unknown, unknown.orderId).pricing.totalMinor, null);
  assert.equal(helpers.formatKobo(unknown.pricing.totalMinor), 'Awaiting confirmation');
  assert.throws(() => helpers.readMedicationCheckout({ ...unknown, pricing: { ...unknown.pricing, totalMinor: 975000 } }, unknown.orderId));
});

test('pickup rejects courier and delivery-management charges, malformed totals and unowned checkout responses', () => {
  const base = checkout();
  const pickup = checkout({ deliveryType: 'pickup', quote: null, pricing: { ...base.pricing, courierMinor: 0, managementMinor: 0, patientTotalMinor: 900000, totalMinor: 900000 } });
  assert.equal(helpers.readMedicationCheckout(pickup, pickup.orderId).pricing.courierMinor, 0);
  for (const changes of [{ orderId: 'someone-else' }, { version: null }, { pricing: { ...base.pricing, patientTotalMinor: 1255001 } }, { pricing: { ...base.pricing, courierMinor: '280000' } }, { actions: {} }]) assert.throws(() => helpers.readMedicationCheckout(checkout(changes), base.orderId));
  assert.throws(() => helpers.readMedicationCheckout({ ...base, deliveryType: 'pickup' }, base.orderId));
});

test('quote approval expires on the actual timestamp or explicit expired flag', () => {
  const quote = checkout().quote;
  const before = Date.parse(quote.expiresAt) - 1;
  assert.equal(helpers.quoteIsCurrent(quote, before), true);
  assert.equal(helpers.quoteIsCurrent(quote, before + 1), false);
  assert.equal(helpers.quoteIsCurrent({ ...quote, expired: true }, before), false);
  assert.equal(helpers.quoteIsCurrent({ ...quote, expiresAt: null }, before), false);
  assert.equal(helpers.quoteIsCurrent(null, before), false);
});

test('merchant activation is explicit and cannot expose payment actions while checkout is disabled', () => {
  const disabled = checkout({ checkout: { enabled: false } });
  assert.equal(helpers.readMedicationCheckout(disabled, disabled.orderId).checkout.enabled, false);
  assert.throws(() => helpers.readMedicationCheckout(checkout({ checkout: null }), disabled.orderId));
  assert.throws(() => helpers.readMedicationCheckout({ ...disabled, actions: { ...disabled.actions, canPayMedicines: true } }, disabled.orderId));
  assert.throws(() => helpers.readMedicationCheckout({ ...disabled, actions: { ...disabled.actions, canPayDelivery: true } }, disabled.orderId));
});

test('tracking presentation rejects another tracking identity and absent event evidence', () => {
  assert.equal(helpers.readMedicationTracking({ trackingId: 'owned', orderId: 'order', status: 'booked', events: [] }, 'owned').status, 'booked');
  assert.throws(() => helpers.readMedicationTracking({ trackingId: 'other', orderId: 'order', status: 'delivered', events: [] }, 'owned'));
  assert.throws(() => helpers.readMedicationTracking({ trackingId: 'owned', orderId: 'order', status: 'delivered' }, 'owned'));
});

test('financial reporting cannot claim a balanced ledger with mismatched totals or missing settlement evidence', () => {
  const report = { currency: 'NGN', totalDebitsMinor: 1255000, totalCreditsMinor: 1255000, balanced: true,
    accounts: [{ account: 'gateway_clearing', debitMinor: 1255000, creditMinor: 0 }, { account: 'pharmacy_payable', debitMinor: 0, creditMinor: 900000 }, { account: 'courier_payable', debitMinor: 0, creditMinor: 280000 }, { account: 'management_unearned', debitMinor: 0, creditMinor: 75000 }],
    refunds: [{ status: 'pending', count: 1, amountMinor: 355000 }], settlements: [] };
  assert.equal(helpers.readMedicationFinanceReport(report).balanced, true);
  for (const extra of [{ balanced: false }, { totalDebitsMinor: 1255001 }, { refunds: [{ status: 'processed', count: 1, amountMinor: null }] }, { accounts: [...report.accounts, report.accounts[0]] }, { settlements: [{ payee: 'pharmacy', status: 'verified', count: 1, amountMinor: -1 }] }]) assert.throws(() => helpers.readMedicationFinanceReport({ ...report, ...extra }));
});

test('medication pharmacy statements stay separate from legacy cash and require verified fields', () => {
  const statement = { currency: 'NGN', outstandingMinor: 900000, settledMinor: 0, orderCount: 1, processingCostsBorneBy: 'DoctaRx' };
  assert.equal(helpers.readMedicationPharmacyStatement(statement).outstandingMinor, 900000);
  assert.equal(helpers.legacyWalletAmount('0.00'), 'NGN 0.00'); assert.equal(helpers.legacyWalletAmount(null), 'Awaiting confirmation');
  for (const changes of [{ outstandingMinor: null }, { settledMinor: -1 }, { currency: 'USD' }, { orderCount: '1' }, { processingCostsBorneBy: null }]) assert.throws(() => helpers.readMedicationPharmacyStatement({ ...statement, ...changes }));
});

test('payout controls require explicit activation, super administrator and completed non-returned order', () => {
  const order = checkout({ status: 'delivered' });
  assert.equal(helpers.canApproveMedicationSettlement(order, 'super_admin', true), true);
  for (const [role, enabled] of [['admin', true], ['pharmacy', true], ['super_admin', false], ['super_admin', undefined], ['super_admin', 'true']]) assert.equal(helpers.canApproveMedicationSettlement(order, role, enabled), false);
  assert.equal(helpers.canApproveMedicationSettlement({ ...order, status: 'ready_for_pickup' }, 'super_admin', true), false);
  assert.equal(helpers.canApproveMedicationSettlement({ ...order, cancellationPending: true }, 'super_admin', true), false);
  assert.equal(helpers.canApproveMedicationSettlement({ ...order, returns: { receivedAt: '2099-01-01' } }, 'super_admin', true), false);
});
