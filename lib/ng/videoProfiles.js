'use strict';

/**
 * lib/ng/videoProfiles.js
 * Adaptive WebRTC media-constraint profiles tuned for the Nigerian
 * mobile environment (2G/3G/4G/wifi, low-end Android, mobile Safari).
 *
 * Pure JS — safe to import from server or client.
 */

const PROFILES = {
  ultraLow: {
    name: 'ultra-low',
    minKbps: 0,
    width:      { ideal: 240, max: 320 },
    height:     { ideal: 180, max: 240 },
    frameRate:  { ideal: 10,  max: 12 },
    targetBitrateKbps: 80,
  },
  low: {
    name: 'low',
    minKbps: 150,
    width:      { ideal: 320, max: 480 },
    height:     { ideal: 240, max: 360 },
    frameRate:  { ideal: 15,  max: 20 },
    targetBitrateKbps: 200,
  },
  medium: {
    name: 'medium',
    minKbps: 500,
    width:      { ideal: 640, max: 854 },
    height:     { ideal: 480, max: 480 },
    frameRate:  { ideal: 24,  max: 30 },
    targetBitrateKbps: 500,
  },
  high: {
    name: 'high',
    minKbps: 1500,
    width:      { ideal: 1280, max: 1280 },
    height:     { ideal: 720,  max: 720 },
    frameRate:  { ideal: 30,   max: 30 },
    targetBitrateKbps: 1200,
  },
};

const ORDER = ['ultraLow', 'low', 'medium', 'high'];

/**
 * Pick a profile based on measured downlink kbps + device hint.
 *  - If the user is on mobile Safari, cap at "medium" (regression-prone codec).
 *  - If kbps is unknown (null), default to "low".
 */
function pickProfile({ kbps, userAgent = '', isMobile = false } = {}) {
  let key = 'low';
  if (kbps == null) key = isMobile ? 'low' : 'medium';
  else if (kbps >= PROFILES.high.minKbps)    key = 'high';
  else if (kbps >= PROFILES.medium.minKbps)  key = 'medium';
  else if (kbps >= PROFILES.low.minKbps)     key = 'low';
  else                                        key = 'ultraLow';

  const ua = String(userAgent).toLowerCase();
  const isMobileSafari = /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/crios|fxios/.test(ua);
  if (isMobileSafari && (key === 'high')) key = 'medium';

  return PROFILES[key];
}

function constraintsFor(profile, { audio = true, video = true } = {}) {
  return {
    audio: audio ? {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl:  true,
      channelCount:     1,
      sampleRate:       16000,
    } : false,
    video: video ? {
      width:     profile.width,
      height:    profile.height,
      frameRate: profile.frameRate,
      facingMode: 'user',
    } : false,
  };
}

/**
 * Apply a bitrate cap to an existing RTCRtpSender (call after addTrack).
 * Returns true if applied; false if the browser refuses (Safari, old Android).
 */
async function applyBitrate(sender, targetBitrateKbps) {
  try {
    if (!sender || typeof sender.getParameters !== 'function') return false;
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings[0] = { ...(params.encodings[0] || {}), maxBitrate: targetBitrateKbps * 1000 };
    await sender.setParameters(params);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  PROFILES,
  ORDER,
  pickProfile,
  constraintsFor,
  applyBitrate,
};
