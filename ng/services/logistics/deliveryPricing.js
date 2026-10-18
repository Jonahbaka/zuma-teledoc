'use strict';

// All amounts in this module are NGN kobo. Pricing is an invoice calculation,
// not evidence that money was received, a benefit was approved, or a delivery
// was completed. Those facts must be verified by the calling workflow.
const CURRENCY = 'NGN';
const MANAGEMENT_MINOR = 75000;
const COORDINATION_MINOR = 50000;
const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);
const LINES = Object.freeze(['medicinesMinor', 'courierMinor', 'managementMinor', 'coordinationMinor', 'taxMinor']);

function fail(message, code = 'INVALID_DELIVERY_PRICING') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeNumber(value, label) {
  if (value < 0n || value > MAX_MINOR) throw fail(`${label} exceeds the supported monetary range`);
  return Number(value);
}

function assertMinor(value, label = 'Amount') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw fail(`${label} must be non-negative integer kobo`);
    return value;
  }
  if (typeof value === 'string' && value.length <= 16 && /^(?:0|[1-9]\d*)$/.test(value)) {
    return safeNumber(BigInt(value), label);
  }
  throw fail(`${label} must be non-negative integer kobo`);
}

function decimalToMinor(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw fail('Amount must be a decimal NGN value');
  const text = String(value);
  const match = text.length <= 18 && /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw fail('Amount must be a decimal NGN value with at most two decimal places');
  return safeNumber(BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0')), 'Amount');
}

function minorToDecimalString(value) {
  const amount = BigInt(assertMinor(value));
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

function sum(values, label = 'Total') {
  return safeNumber(values.reduce((total, value) => total + BigInt(assertMinor(value, label)), 0n), label);
}

function nullableSum(values, label) {
  return values.includes(null) ? null : sum(values, label);
}

function reference(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
}

function instant(value, label) {
  const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(result)) throw fail(`${label} must be a valid timestamp`);
  return result;
}

function quoteFare(quote, now) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) throw fail('A valid courier quote is required');
  if (quote.currency !== CURRENCY) throw fail('Courier quote currency must be NGN', 'QUOTE_CURRENCY_MISMATCH');
  if (typeof quote.expiresAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(quote.expiresAt)) {
    throw fail('Courier quote must include an absolute expiration timestamp', 'QUOTE_EXPIRATION_REQUIRED');
  }
  if (instant(quote.expiresAt, 'Courier quote expiration') <= instant(now, 'Current time')) {
    throw fail('Courier quote has expired; obtain and approve a fresh quote', 'QUOTE_EXPIRED');
  }
  return assertMinor(quote.feeMinor, 'Courier quote fare');
}

function verifiedTaxes(taxes) {
  if (taxes === undefined || taxes === null) return { amountMinor: 0, records: [] };
  if (!Array.isArray(taxes)) throw fail('Taxes must be individually verified records');
  const records = taxes.map((tax) => {
    if (!tax || typeof tax !== 'object' || tax.verified !== true || !reference(tax.ruleReference)) {
      throw fail('A tax requires a verified applicable rule reference', 'TAX_RULE_UNVERIFIED');
    }
    return { amountMinor: assertMinor(tax.amountMinor, 'Tax amount'), ruleReference: tax.ruleReference };
  });
  return { amountMinor: sum(records.map((tax) => tax.amountMinor), 'Tax total'), records };
}

function commercialFees(snapshot) {
  if (!snapshot) return null;
  if (snapshot.currency !== CURRENCY || !reference(snapshot.profileId) || !Number.isInteger(snapshot.profileVersion) || snapshot.profileVersion < 1 || !reference(snapshot.feeScheduleReference) || snapshot.coordinationEarnedOnFulfillment !== true) throw fail('An approved pharmacy commercial snapshot is required', 'COMMERCIAL_POLICY_UNVERIFIED');
  return { orderServiceMinor: assertMinor(snapshot.orderServiceMinor, 'Agreed order service fee'), deliverySupportMinor: assertMinor(snapshot.deliverySupportMinor, 'Agreed delivery support fee') };
}

function buildPricing({ medicinesMinor, deliveryType, quote = null, coordination = null, coverage = null, taxes = [], commercialSnapshot = null, now = Date.now() } = {}) {
  if (deliveryType !== 'pickup' && deliveryType !== 'delivery') throw fail('Delivery type must be pickup or delivery');
  const medicines = assertMinor(medicinesMinor, 'Confirmed medicine price');
  const tax = verifiedTaxes(taxes);
  const delivery = deliveryType === 'delivery';
  const courier = delivery ? (quote === null || quote === undefined ? null : quoteFare(quote, now)) : 0;
  const commercial = commercialFees(commercialSnapshot);
  if (commercial && coverage?.verified === true && Object.values(coverage.allocations || {}).some(amount => assertMinor(amount) > 0)) throw fail('This pharmacy commercial profile is approved for self-paying orders only', 'PARTNER_INSURANCE_NOT_ACTIVATED');
  const management = delivery ? (commercial ? commercial.deliverySupportMinor : MANAGEMENT_MINOR) : 0;

  const coordinationRequested = coordination?.authorized === true && coordination?.billable === true && coordination?.includedElsewhere !== true;
  if (coordinationRequested && !reference(coordination.authorizationReference)) {
    throw fail('A separately billable coordination fee requires an authorization reference', 'COORDINATION_AUTHORIZATION_REQUIRED');
  }
  if (coordinationRequested && coordination.payer !== undefined && !['patient', 'insurer'].includes(coordination.payer)) {
    throw fail('Coordination payer must be patient or insurer');
  }
  if (commercial && coordinationRequested) throw fail('The agreed order-service fee already includes coordination; a second coordination charge is not permitted', 'COORDINATION_ALREADY_INCLUDED');
  const coordinationAmount = commercial ? commercial.orderServiceMinor : coordinationRequested ? COORDINATION_MINOR : 0;
  const amounts = { medicinesMinor: medicines, courierMinor: courier, managementMinor: management, coordinationMinor: coordinationAmount, taxMinor: tax.amountMinor };
  const insurer = Object.fromEntries(LINES.map((line) => [line, 0]));
  const coverageApplied = coverage?.verified === true;
  if (coverageApplied) {
    if (!reference(coverage.authorizationReference) || !coverage.allocations || typeof coverage.allocations !== 'object' || Array.isArray(coverage.allocations)) {
      throw fail('Verified coverage requires an authorization reference and explicit line allocations', 'COVERAGE_AUTHORIZATION_REQUIRED');
    }
    for (const [line, amount] of Object.entries(coverage.allocations)) {
      if (!LINES.includes(line)) throw fail(`Unsupported insurance allocation: ${line}`);
      insurer[line] = assertMinor(amount, `Insurer ${line}`);
      if ((amounts[line] === null && insurer[line] > 0) || (amounts[line] !== null && insurer[line] > amounts[line])) {
        throw fail(`Insurance allocation exceeds the confirmed ${line} charge`, 'COVERAGE_OVERALLOCATION');
      }
    }
  }
  if (coordinationRequested && coordination.payer === 'insurer' && insurer.coordinationMinor !== coordinationAmount) {
    throw fail('Insurer coordination billing requires verified coverage for the complete fee', 'COORDINATION_COVERAGE_REQUIRED');
  }
  if (coordinationRequested && coordination.payer === 'patient' && insurer.coordinationMinor !== 0) {
    throw fail('Coordination payer conflicts with the verified insurance allocation');
  }
  const patient = Object.fromEntries(LINES.map((line) => [line, amounts[line] === null ? null : amounts[line] - insurer[line]]));
  const totalMinor = nullableSum(Object.values(amounts), 'Invoice total');
  const insurerTotalMinor = sum(Object.values(insurer), 'Insurer total');
  const patientTotalMinor = nullableSum(Object.values(patient), 'Patient total');
  if (totalMinor !== null && sum([patientTotalMinor, insurerTotalMinor]) !== totalMinor) throw fail('Payer allocation does not balance');

  return {
    currency: CURRENCY,
    deliveryType,
    commercialProfile: commercial ? { id: commercialSnapshot.profileId, version: commercialSnapshot.profileVersion, feeScheduleReference: commercialSnapshot.feeScheduleReference } : null,
    coordinationEarnedOnFulfillment: !!commercial,
    feeLabels: commercial ? { coordination: 'DoctaRx order service', management: 'DoctaRx delivery support' } : null,
    ...amounts,
    patientTotalMinor,
    insurerTotalMinor,
    totalMinor,
    quoteExpiresAt: delivery && quote ? quote.expiresAt : null,
    coverageApplied,
    coverageAuthorizationReference: coverageApplied ? coverage.authorizationReference : null,
    coordinationAuthorizationReference: coordinationRequested ? coordination.authorizationReference : null,
    taxRules: tax.records,
    allocations: { patient, insurer },
    revenue: { managementEarnedMinor: 0, managementUnearnedMinor: management, coordinationMinor: commercial ? 0 : coordinationAmount, ...(commercial ? {coordinationUnearnedMinor:coordinationAmount} : {}) },
  };
}

function stageAmounts(pricing, stage) {
  if (pricing?.currency !== CURRENCY || !pricing.allocations?.patient || !pricing.allocations?.insurer) throw fail('A calculated NGN invoice is required');
  const lines = stage === 'medicines' ? ['medicinesMinor', 'coordinationMinor', 'taxMinor'] : stage === 'delivery' ? ['courierMinor', 'managementMinor'] : null;
  if (!lines) throw fail('Payment stage must be medicines or delivery');
  return {
    currency: CURRENCY,
    stage,
    ...(pricing.coordinationEarnedOnFulfillment ? { coordinationEarnedOnFulfillment: true } : {}),
    totalMinor: nullableSum(lines.map((line) => pricing[line]), 'Stage total'),
    patientMinor: nullableSum(lines.map((line) => pricing.allocations.patient[line]), 'Patient stage total'),
    insurerMinor: sum(lines.map((line) => pricing.allocations.insurer[line]), 'Insurer stage total'),
    allocations: Object.fromEntries(lines.map((line) => [line, { amountMinor: pricing[line], patientMinor: pricing.allocations.patient[line], insurerMinor: pricing.allocations.insurer[line] }])),
  };
}

function ledgerAllocations(pricing, { deliveryCompleted = false, patientCollectedMinor = 0, processingCostMinor = 0 } = {}) {
  if (pricing?.currency !== CURRENCY || pricing.totalMinor === null || pricing.patientTotalMinor === null) {
    throw fail('A complete confirmed NGN invoice is required before posting a ledger', 'INCOMPLETE_DELIVERY_PRICING');
  }
  const total = assertMinor(pricing.totalMinor, 'Invoice total');
  const patientDue = assertMinor(pricing.patientTotalMinor, 'Patient total');
  const insurerDue = assertMinor(pricing.insurerTotalMinor, 'Insurer total');
  const medicineStage = stageAmounts(pricing, 'medicines');
  const deliveryStage = stageAmounts(pricing, 'delivery');
  for (const line of LINES) {
    if (sum([pricing.allocations.patient[line], pricing.allocations.insurer[line]]) !== assertMinor(pricing[line])) {
      throw fail('Delivery payer line allocations do not balance', 'DELIVERY_LEDGER_UNBALANCED');
    }
  }
  if (sum([medicineStage.patientMinor, deliveryStage.patientMinor]) !== patientDue ||
      sum([medicineStage.insurerMinor, deliveryStage.insurerMinor]) !== insurerDue) {
    throw fail('Delivery payer totals do not balance', 'DELIVERY_LEDGER_UNBALANCED');
  }
  const collected = assertMinor(patientCollectedMinor, 'Verified patient payment');
  const processing = assertMinor(processingCostMinor, 'Actual payment processing cost');
  if (collected > patientDue) throw fail('Verified payment exceeds the patient invoice');
  if (processing > collected) throw fail('Processing costs cannot exceed confirmed collected funds');
  const management = assertMinor(pricing.managementMinor, 'Management fee');
  const entries = {
    currency: CURRENCY,
    patientReceivableMinor: patientDue - collected,
    patientCashMinor: collected - processing,
    insurerReceivableMinor: insurerDue,
    pharmacyPayableMinor: assertMinor(pricing.medicinesMinor, 'Pharmacy payable'),
    courierPayableMinor: assertMinor(pricing.courierMinor, 'Courier payable'),
    taxPayableMinor: assertMinor(pricing.taxMinor, 'Tax payable'),
    managementUnearnedMinor: deliveryCompleted === true ? 0 : management,
    managementRevenueMinor: deliveryCompleted === true ? management : 0,
    coordinationRevenueMinor: pricing.coordinationEarnedOnFulfillment && !deliveryCompleted ? 0 : assertMinor(pricing.coordinationMinor, 'Coordination revenue'),
    ...(pricing.coordinationEarnedOnFulfillment ? { coordinationUnearnedMinor: deliveryCompleted ? 0 : assertMinor(pricing.coordinationMinor, 'Unearned order service fee') } : {}),
    processingCostMinor: processing,
  };
  entries.totalDebitsMinor = sum([entries.patientReceivableMinor, entries.patientCashMinor, entries.insurerReceivableMinor, entries.processingCostMinor], 'Ledger debits');
  entries.totalCreditsMinor = sum([entries.pharmacyPayableMinor, entries.courierPayableMinor, entries.taxPayableMinor, entries.managementUnearnedMinor, entries.managementRevenueMinor, entries.coordinationRevenueMinor, entries.coordinationUnearnedMinor || 0], 'Ledger credits');
  if (sum([patientDue, insurerDue]) !== total || entries.totalDebitsMinor !== entries.totalCreditsMinor || entries.totalCreditsMinor !== total) {
    throw fail('Delivery ledger does not balance', 'DELIVERY_LEDGER_UNBALANCED');
  }
  entries.balanced = true;
  return entries;
}

module.exports = { assertMinor, decimalToMinor, minorToDecimalString, buildPricing, stageAmounts, ledgerAllocations, commercialFees };
