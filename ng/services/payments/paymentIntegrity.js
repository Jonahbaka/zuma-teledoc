'use strict';

const crypto = require('crypto');

function toMinorUnits(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Invalid monetary amount');
  const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Monetary amount exceeds supported range');
  return amount;
}

function verifyPaystackSignature(rawBody, signature, secretKey) {
  if (!Buffer.isBuffer(rawBody) || !secretKey || !/^[a-f\d]{128}$/i.test(String(signature || ''))) return false;
  const expected = crypto.createHmac('sha512', secretKey).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function assertPaymentMatches(verification, expected) {
  if (!verification?.verified || verification.reference !== expected.reference ||
      verification.currency !== expected.currency || verification.amountMinor !== expected.amountMinor ||
      !Number.isSafeInteger(verification.amountMinor) ||
      (expected.environment && verification.environment !== expected.environment)) {
    const error = new Error('Payment does not match the expected invoice');
    error.code = 'PAYMENT_MISMATCH';
    throw error;
  }
}

module.exports = { toMinorUnits, verifyPaystackSignature, assertPaymentMatches };
