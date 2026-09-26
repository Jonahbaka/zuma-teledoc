'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clampLimit } = require('../routes/clinical')._test;

test('a page size is always a positive integer within the route maximum', () => {
  assert.equal(clampLimit('25', { fallback: 20, max: 100 }), 25);
  assert.equal(clampLimit(25, { fallback: 20, max: 100 }), 25);
  assert.equal(clampLimit('5000', { fallback: 20, max: 100 }), 100, 'an oversized page is capped');
});

test('a missing, negative, or non-numeric limit falls back instead of reaching the database', () => {
  // LIMIT -5 is a database error, not a bad request, so it must never be passed through.
  assert.equal(clampLimit(undefined, { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('-5', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('0', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit('abc', { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit(NaN, { fallback: 20, max: 100 }), 20);
  assert.equal(clampLimit({ toString: () => 'nope' }, { fallback: 20, max: 100 }), 20);
});

test('the clamped value is always usable in a LIMIT clause', () => {
  for (const input of ['-1', '0', 'null', '10; DROP TABLE users', '1e3', '3.9']) {
    const value = clampLimit(input, { fallback: 50, max: 200 });
    assert.ok(Number.isInteger(value) && value >= 1 && value <= 200, `clamped ${input} to ${value}`);
  }
});
