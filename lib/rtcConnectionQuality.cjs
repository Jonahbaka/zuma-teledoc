'use strict';

// UX thresholds, not clinical acceptance criteria. Rates describe observed RTP
// intervals; they are not an estimate of available network bandwidth.
const QUALITY_THRESHOLDS = Object.freeze({ fairRttMs: 180, poorRttMs: 420, fairLossPct: 2, poorLossPct: 5 });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) && value >= 0;
const largest = values => values.length ? Math.max(...values) : null;
const unknownQuality = () => ({ level: 'unknown', label: 'Not measured', rttMs: null, packetLossPct: null, guidance: null });

function describeQuality({ rttMs = null, packetLossPct = null } = {}) {
  rttMs = nonnegative(rttMs) ? rttMs : null;
  packetLossPct = nonnegative(packetLossPct) && packetLossPct <= 100 ? packetLossPct : null;
  let level = 'unknown';
  if ((rttMs !== null && rttMs >= QUALITY_THRESHOLDS.poorRttMs) || (packetLossPct !== null && packetLossPct >= QUALITY_THRESHOLDS.poorLossPct)) level = 'poor';
  else if ((rttMs !== null && rttMs >= QUALITY_THRESHOLDS.fairRttMs) || (packetLossPct !== null && packetLossPct >= QUALITY_THRESHOLDS.fairLossPct)) level = 'fair';
  else if (rttMs !== null && packetLossPct !== null) level = 'good';
  const metrics = [rttMs === null ? null : `${Math.round(rttMs)} ms`, packetLossPct === null ? null : `${Math.round(packetLossPct * 10) / 10}% loss`].filter(Boolean);
  const title = level === 'unknown' ? (metrics.length ? 'Partial measurement' : 'Not measured') : level[0].toUpperCase() + level.slice(1);
  return {
    level, label: title + (metrics.length ? ` (${metrics.join(', ')})` : ''), rttMs, packetLossPct,
    guidance: level === 'poor' ? 'Try turning off your camera to reduce data use. If audio remains unclear, reconnect or arrange another visit.' : null,
  };
}

function readQualitySnapshot(stats, previous = new Map()) {
  const reports = new Map();
  stats?.forEach?.(report => { if (report && typeof report.id === 'string') reports.set(report.id, report); });
  const next = new Map(), losses = [], rtts = [];
  let incompleteLoss = false;
  const fresh = report => finite(report.timestamp) && (!previous.has(report.id) || report.timestamp > previous.get(report.id).timestamp);

  for (const report of reports.values()) {
    // Keep only scalar counters for the next sample. Never retain candidate
    // addresses, SDP, participant details or the raw RTCStatsReport.
    if (['inbound-rtp', 'remote-inbound-rtp'].includes(report.type) && ['audio', 'video'].includes(report.kind || report.mediaType)) {
      if (!fresh(report)) {
        if (previous.has(report.id)) next.set(report.id, previous.get(report.id));
        incompleteLoss = true;
        continue;
      }
      next.set(report.id, { timestamp: report.timestamp, packetsReceived: report.packetsReceived, packetsLost: report.packetsLost, kind: report.kind || report.mediaType, ssrc: report.ssrc });
      if (report.type === 'remote-inbound-rtp') {
        if (finite(report.fractionLost) && report.fractionLost >= 0 && report.fractionLost <= 1) losses.push(report.fractionLost * 100);
        else incompleteLoss = true;
        if (nonnegative(report.roundTripTime)) rtts.push(report.roundTripTime * 1000);
      } else {
        const before = previous.get(report.id);
        if (!before || before.kind !== (report.kind || report.mediaType) || before.ssrc !== report.ssrc || !nonnegative(report.packetsReceived) || !nonnegative(before.packetsReceived) || !finite(report.packetsLost) || !finite(before.packetsLost)) { incompleteLoss = true; continue; }
        const received = report.packetsReceived - before.packetsReceived;
        if (received < 0) { incompleteLoss = true; continue; } // Changed/reset source requires a new baseline.
        const lost = Math.max(0, report.packetsLost - before.packetsLost);
        if (received + lost > 0) losses.push(lost * 100 / (received + lost));
        else incompleteLoss = true;
      }
    }
  }

  // Standard transport references take precedence over browser legacy flags.
  const transports = [...reports.values()].filter(report => report.type === 'transport' && typeof report.selectedCandidatePairId === 'string');
  let selectedPairs;
  if (transports.length) selectedPairs = transports.map(report => reports.get(report.selectedCandidatePairId)).filter(Boolean);
  else {
    const candidates = [...reports.values()].filter(report => report.type === 'candidate-pair' && report.state === 'succeeded' && (report.selected === true || report.nominated === true));
    selectedPairs = candidates.length === 1 ? candidates : [];
  }
  for (const pair of selectedPairs) {
    next.set(pair.id, fresh(pair) ? { timestamp: pair.timestamp } : previous.get(pair.id) || { timestamp: pair.timestamp });
    if (pair.type === 'candidate-pair' && pair.state === 'succeeded' && fresh(pair) && nonnegative(pair.currentRoundTripTime)) rtts.push(pair.currentRoundTripTime * 1000);
  }

  const quality = describeQuality({ rttMs: largest(rtts), packetLossPct: largest(losses) });
  if (incompleteLoss && quality.level === 'good') {
    quality.level = 'unknown';
    quality.label = quality.label.replace(/^Good/, 'Partial measurement');
  }
  return { quality, snapshot: next };
}

function createRtcQualitySampler({ timeoutMs = 2500 } = {}) {
  const snapshots = new WeakMap();
  return async function sample(pc) {
    if (!pc || typeof pc.getStats !== 'function') return unknownQuality();
    if (pc.connectionState !== 'connected') {
      snapshots.delete(pc);
      return pc.connectionState === 'failed'
        ? { ...unknownQuality(), level: 'poor', label: 'Media connection failed', guidance: 'Reconnect, or arrange another visit if audio cannot be restored.' }
        : unknownQuality();
    }
    try {
      let timer;
      let reports;
      try {
        reports = await Promise.race([
          pc.getStats(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('RTC statistics unavailable')), timeoutMs); }),
        ]);
      } finally { if (timer !== undefined) clearTimeout(timer); }
      if (pc.connectionState !== 'connected') { snapshots.delete(pc); return unknownQuality(); }
      const result = readQualitySnapshot(reports, snapshots.get(pc));
      snapshots.set(pc, result.snapshot);
      return result.quality;
    } catch {
      snapshots.delete(pc);
      return unknownQuality();
    }
  };
}

function worstConnectionQuality(qualities) {
  if (!qualities.length) return null;
  for (const level of ['poor', 'fair', 'unknown']) if (qualities.some(quality => !quality ? level === 'unknown' : quality.level === level)) return level;
  return qualities.every(quality => quality?.level === 'good') ? 'good' : 'unknown';
}

module.exports = { QUALITY_THRESHOLDS, unknownQuality, describeQuality, readQualitySnapshot, createRtcQualitySampler, worstConnectionQuality };
