'use strict';

/**
 * ng/scripts/simulate/lib.js
 * Shared assertions + tiny helpers for the simulation scenarios.
 */

const assert = require('node:assert/strict');

function expectThrows(fn, code, label) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(
        () => { throw new Error(`expected throw (${code || 'any'}) but resolved: ${label || ''}`); },
        (e) => { if (code && e.code !== code) throw new Error(`expected code ${code}, got ${e.code}: ${e.message}`); }
      );
    }
    throw new Error(`expected throw (${code || 'any'}) but returned: ${label || ''}`);
  } catch (e) {
    if (code && e.code !== code) throw new Error(`expected code ${code}, got ${e.code}: ${e.message}`);
  }
}

function step(ctx, msg) { ctx.steps.push(msg); }

module.exports = { assert, expectThrows, step };
