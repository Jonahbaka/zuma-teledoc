'use strict';

/**
 * lib/ng/networkQuality.js
 * Tiny browser-side bandwidth probe and quality classifier.
 *
 * Approach: time the download of a known-size cacheable static asset.
 * The asset URL is configurable via NG_NET_PROBE_URL (defaults to a
 * Next.js public path that ships with this repo). To get an honest
 * sample even when the asset has been HTTP-cached, we append a cache-
 * busting query string.
 *
 * For RTC stats during a live call, see `sampleRtcStats(pc)`.
 */

const DEFAULT_PROBE_URL = '/ng/net-probe-256k.bin'; // 256 KB asset in /public/ng
const PROBE_BYTES_DEFAULT = 256 * 1024;

/**
 * Classify downlink kbps into a label + score.
 *   good  ≥ 1500 kbps
 *   fair  ≥ 500
 *   poor  ≥ 150
 *   very_poor < 150
 */
function classify(kbps) {
  if (kbps == null || !isFinite(kbps) || kbps <= 0) return { label: 'unknown', score: 0 };
  if (kbps >= 1500) return { label: 'good',      score: 4 };
  if (kbps >= 500)  return { label: 'fair',      score: 3 };
  if (kbps >= 150)  return { label: 'poor',      score: 2 };
  return                   { label: 'very_poor', score: 1 };
}

/**
 * Estimate downlink kbps by downloading PROBE_BYTES from PROBE_URL.
 * Falls back to navigator.connection.downlink (Mbps) if probe fails.
 */
async function estimateDownlinkKbps({
  url = DEFAULT_PROBE_URL,
  expectedBytes = PROBE_BYTES_DEFAULT,
  timeoutMs = 6000,
} = {}) {
  // Network Information API hint (Chrome / Edge / mobile Chrome)
  const navHint = typeof navigator !== 'undefined' && navigator.connection
    ? Number(navigator.connection.downlink) * 1000
    : null;

  try {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const t = setTimeout(() => ctrl?.abort(), timeoutMs);

    const cacheBust = `${url}${url.includes('?') ? '&' : '?'}cb=${Date.now()}`;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const res = await fetch(cacheBust, { cache: 'no-store', signal: ctrl?.signal });
    if (!res.ok) throw new Error(`probe ${res.status}`);
    const blob = await res.blob();
    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    clearTimeout(t);

    const seconds = Math.max(0.05, (t1 - t0) / 1000);
    const bytes = blob.size || expectedBytes;
    const kbps = Math.round((bytes * 8) / 1000 / seconds);

    return { kbps, method: 'probe', durationMs: Math.round(t1 - t0), bytes };
  } catch (err) {
    if (navHint && isFinite(navHint) && navHint > 0) {
      return { kbps: Math.round(navHint), method: 'navigator-hint', error: String(err.message || err) };
    }
    return { kbps: null, method: 'unknown', error: String(err.message || err) };
  }
}

/**
 * Sample WebRTC stats for the live peer-connection.
 * Returns { downKbps, upKbps, rtt, jitter, packetLossPct } or null.
 */
async function sampleRtcStats(pc) {
  if (!pc || typeof pc.getStats !== 'function') return null;
  const stats = await pc.getStats();
  let inboundBytes = 0, outboundBytes = 0, jitter = 0, rtt = 0;
  let packetsReceived = 0, packetsLost = 0, hasInbound = false;
  let prevBytesIn = pc.__ngPrevBytesIn ?? 0;
  let prevBytesOut = pc.__ngPrevBytesOut ?? 0;
  let prevTs = pc.__ngPrevTs ?? null;
  const now = Date.now();
  stats.forEach(s => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') {
      inboundBytes  += Number(s.bytesReceived || 0);
      packetsReceived += Number(s.packetsReceived || 0);
      packetsLost += Number(s.packetsLost || 0);
      jitter = Number(s.jitter || jitter);
      hasInbound = true;
    } else if (s.type === 'outbound-rtp' && s.kind === 'video') {
      outboundBytes += Number(s.bytesSent || 0);
    } else if (s.type === 'candidate-pair' && s.state === 'succeeded' && typeof s.currentRoundTripTime === 'number') {
      rtt = s.currentRoundTripTime * 1000;
    }
  });

  let downKbps = null, upKbps = null;
  if (prevTs && now > prevTs) {
    const seconds = (now - prevTs) / 1000;
    downKbps = Math.round(((inboundBytes - prevBytesIn) * 8) / 1000 / seconds);
    upKbps   = Math.round(((outboundBytes - prevBytesOut) * 8) / 1000 / seconds);
  }
  pc.__ngPrevBytesIn = inboundBytes;
  pc.__ngPrevBytesOut = outboundBytes;
  pc.__ngPrevTs = now;

  const packetLossPct = packetsReceived > 0
    ? Math.round((packetsLost / (packetsReceived + packetsLost)) * 1000) / 10
    : 0;

  return {
    downKbps: hasInbound ? downKbps : null,
    upKbps,
    rtt: Math.round(rtt),
    jitter: Math.round(jitter * 1000),
    packetLossPct,
  };
}

module.exports = {
  classify,
  estimateDownlinkKbps,
  sampleRtcStats,
  DEFAULT_PROBE_URL,
  PROBE_BYTES_DEFAULT,
};
