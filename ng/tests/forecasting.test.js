'use strict';

/**
 * ng/tests/forecasting.test.js
 * Unit tests for the forecasting algorithm logic.
 * Mirrors the weighted_moving_average and linear_trend_projection
 * implementations in publicHealthProgrammeService.js.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Algorithm mirrors ───────────────────────────────────────────────────────

function weightedMovingAverage(values) {
  if (!values.length) return 0;
  let weightedSum = 0, totalWeight = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = i + 1;
    weightedSum  += values[i] * weight;
    totalWeight  += weight;
  }
  return totalWeight ? weightedSum / totalWeight : 0;
}

function linearTrendProjection(values, steps) {
  const n = values.length;
  if (n < 2) return values[n - 1] ?? 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope     = den ? num / den : 0;
  const intercept = yMean - slope * xMean;
  return intercept + slope * (n - 1 + steps);
}

function confidenceLabel(points) {
  if (points >= 14) return 'high';
  if (points >= 7)  return 'medium';
  if (points >= 3)  return 'low';
  return 'insufficient_data';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('weightedMovingAverage', () => {
  it('weights later values more heavily', () => {
    const wma = weightedMovingAverage([1, 2, 3]);
    // weights: 1*1 + 2*2 + 3*3 = 14; total = 6; wma = 14/6 ≈ 2.33
    assert.ok(Math.abs(wma - 14 / 6) < 0.001);
  });

  it('constant series returns the constant', () => {
    const wma = weightedMovingAverage([5, 5, 5, 5]);
    assert.ok(Math.abs(wma - 5) < 0.001);
  });

  it('empty array returns 0', () => {
    assert.equal(weightedMovingAverage([]), 0);
  });

  it('single value returns that value', () => {
    assert.ok(Math.abs(weightedMovingAverage([42]) - 42) < 0.001);
  });
});

describe('linearTrendProjection', () => {
  it('perfectly linear series extrapolates correctly', () => {
    const values = [10, 20, 30, 40, 50];
    const next = linearTrendProjection(values, 1);
    assert.ok(Math.abs(next - 60) < 0.01, `Expected ~60, got ${next}`);
  });

  it('projects multiple steps forward', () => {
    const values = [0, 10, 20, 30];
    const next2 = linearTrendProjection(values, 2);
    assert.ok(Math.abs(next2 - 50) < 0.01, `Expected ~50, got ${next2}`);
  });

  it('flat series returns same value', () => {
    const values = [5, 5, 5, 5, 5];
    const next = linearTrendProjection(values, 1);
    assert.ok(Math.abs(next - 5) < 0.01);
  });

  it('handles 1-element array without crash', () => {
    const next = linearTrendProjection([7], 1);
    assert.ok(Number.isFinite(next));
  });
});

describe('confidenceLabel', () => {
  it('returns insufficient_data for < 3 points', () => {
    assert.equal(confidenceLabel(0), 'insufficient_data');
    assert.equal(confidenceLabel(2), 'insufficient_data');
  });

  it('returns low for 3-6 points', () => {
    assert.equal(confidenceLabel(3), 'low');
    assert.equal(confidenceLabel(6), 'low');
  });

  it('returns medium for 7-13 points', () => {
    assert.equal(confidenceLabel(7),  'medium');
    assert.equal(confidenceLabel(13), 'medium');
  });

  it('returns high for 14+ points', () => {
    assert.equal(confidenceLabel(14), 'high');
    assert.equal(confidenceLabel(90), 'high');
  });
});
