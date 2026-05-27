'use strict';

/**
 * ng/tests/videoProfiles.test.js
 * Tests for adaptive video profile selection + bandwidth classification.
 * Run: node --test ng/tests/videoProfiles.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { PROFILES, pickProfile, constraintsFor } = require('../../lib/ng/videoProfiles');
const { classify } = require('../../lib/ng/networkQuality');

describe('networkQuality.classify', () => {
  it('classifies known bands', () => {
    assert.equal(classify(2000).label, 'good');
    assert.equal(classify(1500).label, 'good');
    assert.equal(classify(800).label,  'fair');
    assert.equal(classify(500).label,  'fair');
    assert.equal(classify(300).label,  'poor');
    assert.equal(classify(150).label,  'poor');
    assert.equal(classify(80).label,   'very_poor');
    assert.equal(classify(1).label,    'very_poor');
  });
  it('returns unknown for nil / negative / non-finite', () => {
    assert.equal(classify(null).label, 'unknown');
    assert.equal(classify(undefined).label, 'unknown');
    assert.equal(classify(0).label, 'unknown');
    assert.equal(classify(-10).label, 'unknown');
    assert.equal(classify(NaN).label, 'unknown');
    assert.equal(classify(Infinity).label, 'unknown'); // not a real measurement
  });
  it('score increases monotonically with quality', () => {
    const order = [classify(50), classify(200), classify(700), classify(2000)];
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i].score >= order[i - 1].score);
    }
  });
});

describe('videoProfiles.pickProfile', () => {
  it('returns high for ≥1500 kbps on desktop Chrome', () => {
    const p = pickProfile({ kbps: 2000, userAgent: 'Mozilla/5.0 Chrome/120', isMobile: false });
    assert.equal(p.name, 'high');
  });
  it('returns medium for 500–1499 kbps', () => {
    assert.equal(pickProfile({ kbps: 800 }).name, 'medium');
    assert.equal(pickProfile({ kbps: 500 }).name, 'medium');
  });
  it('returns low for 150–499 kbps', () => {
    assert.equal(pickProfile({ kbps: 200 }).name, 'low');
    assert.equal(pickProfile({ kbps: 150 }).name, 'low');
  });
  it('returns ultraLow below 150 kbps', () => {
    assert.equal(pickProfile({ kbps: 100 }).name, 'ultra-low');
    assert.equal(pickProfile({ kbps: 1 }).name,   'ultra-low');
  });
  it('caps mobile Safari at medium even with high bandwidth', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile/15E148 Safari/604.1';
    const p = pickProfile({ kbps: 5000, userAgent: ua, isMobile: true });
    assert.equal(p.name, 'medium');
  });
  it('does NOT cap Chrome on iOS (CriOS) at medium', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 CriOS/120 Mobile/15E148 Safari/604.1';
    const p = pickProfile({ kbps: 5000, userAgent: ua, isMobile: true });
    // CriOS is Chrome on iOS; our regex specifically excludes it from the Safari cap
    assert.equal(p.name, 'high');
  });
  it('defaults to low on unknown bandwidth + mobile', () => {
    assert.equal(pickProfile({ kbps: null, isMobile: true }).name, 'low');
  });
  it('defaults to medium on unknown bandwidth + desktop', () => {
    assert.equal(pickProfile({ kbps: null, isMobile: false }).name, 'medium');
  });
});

describe('videoProfiles.constraintsFor', () => {
  it('omits audio/video when disabled', () => {
    const c = constraintsFor(PROFILES.medium, { audio: false, video: false });
    assert.equal(c.audio, false);
    assert.equal(c.video, false);
  });
  it('emits valid MediaStreamConstraints shape', () => {
    const c = constraintsFor(PROFILES.low);
    assert.equal(c.audio.echoCancellation, true);
    assert.equal(c.video.width.ideal, PROFILES.low.width.ideal);
    assert.equal(c.video.frameRate.max, PROFILES.low.frameRate.max);
    assert.equal(c.video.facingMode, 'user');
  });
});
