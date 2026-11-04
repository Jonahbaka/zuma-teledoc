/**
 * lib/ng/connectionResilience.js
 *
 * Pure connection-resilience logic for Nigeria telehealth calls. No React and no
 * browser APIs, so every failure mode is unit-testable without a live call:
 * joining, permission denial, device loss, reconnecting, participant
 * departure/re-entry, duplicate tabs, session expiry, low bandwidth, and
 * unconfigured TURN/SFU media infrastructure.
 *
 * Design rules:
 *   - Fail closed on media infrastructure: multiparty is only reported as available
 *     when the SFU and TURN are actually configured. A contract test is not
 *     evidence that production media works.
 *   - Never hide a failure: every state carries user-facing copy and a next action.
 *   - Degrade before dropping: suggest audio-only before suggesting reschedule.
 */

export const CONNECTION_STATES = Object.freeze({
  IDLE: 'idle',
  JOINING: 'joining',
  CONNECTED: 'connected',
  DEGRADED: 'degraded',
  RECONNECTING: 'reconnecting',
  RECOVERED: 'recovered',
  FALLBACK_REQUIRED: 'fallback_required',
  ENDED: 'ended',
  FAILED: 'failed',
});

export const SEVERITY = Object.freeze({ INFO: 'info', WARNING: 'warning', CRITICAL: 'critical' });

const STATE_PRESENTATION = {
  [CONNECTION_STATES.IDLE]: { severity: SEVERITY.INFO, label: 'Ready to join' },
  [CONNECTION_STATES.JOINING]: { severity: SEVERITY.INFO, label: 'Joining the consultation' },
  [CONNECTION_STATES.CONNECTED]: { severity: SEVERITY.INFO, label: 'Connected' },
  [CONNECTION_STATES.DEGRADED]: {
    severity: SEVERITY.WARNING,
    label: 'Poor connection',
    guidance: 'Video may stutter. Turning off your camera keeps the audio clear.',
  },
  [CONNECTION_STATES.RECONNECTING]: {
    severity: SEVERITY.WARNING,
    label: 'Reconnecting',
    guidance: 'Your work is saved. We are restoring the call automatically.',
  },
  [CONNECTION_STATES.RECOVERED]: {
    severity: SEVERITY.INFO,
    label: 'Connection restored',
    guidance: 'Back online. Check that you can hear the other participants.',
  },
  [CONNECTION_STATES.FALLBACK_REQUIRED]: {
    severity: SEVERITY.CRITICAL,
    label: 'Call quality is not usable',
    guidance: 'Switch to an audio-only call, or end and reschedule on a better connection.',
  },
  [CONNECTION_STATES.ENDED]: { severity: SEVERITY.INFO, label: 'Consultation ended' },
  [CONNECTION_STATES.FAILED]: { severity: SEVERITY.CRITICAL, label: 'Could not connect' },
};

/** Quality thresholds tuned for a clinical conversation over mobile data. */
export const QUALITY_THRESHOLDS = Object.freeze({
  goodKbps: 500,
  fairKbps: 200,
  audioOnlyKbps: 80,
  highLossPct: 8,
  highRttMs: 600,
});

/** Maps a low-level media/network error to safe, actionable copy. */
export function describeFailure(error) {
  const name = String(error?.name || error?.code || error || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (name.includes('notallowed') || message.includes('permission') || message.includes('denied')) {
    return {
      code: 'PERMISSION_DENIED',
      severity: SEVERITY.CRITICAL,
      message: 'Camera or microphone access was blocked.',
      guidance: 'Allow access in your browser settings, then rejoin. No clinical notes are lost.',
      recoverable: true,
    };
  }
  if (name.includes('notfound') || name.includes('devicesnotfound') || message.includes('no camera')
    || message.includes('no microphone') || message.includes('requested device not found')) {
    return {
      code: 'DEVICE_NOT_FOUND',
      severity: SEVERITY.CRITICAL,
      message: 'No usable camera or microphone was found.',
      guidance: 'Connect a device, or continue with an audio-only call if a headset is available.',
      recoverable: true,
    };
  }
  if (name.includes('notreadable') || message.includes('in use') || message.includes('another application')) {
    return {
      code: 'DEVICE_BUSY',
      severity: SEVERITY.WARNING,
      message: 'The camera or microphone is being used by another application.',
      guidance: 'Close the other application and rejoin.',
      recoverable: true,
    };
  }
  if (message.includes('turn') || message.includes('ice') || message.includes('relay')) {
    return {
      code: 'MEDIA_RELAY_UNAVAILABLE',
      severity: SEVERITY.CRITICAL,
      message: 'The call could not reach the media relay.',
      guidance: 'Try a different network, or end and reschedule. Do not start a clinical decision on a broken call.',
      recoverable: true,
    };
  }
  if (message.includes('token') && (message.includes('expired') || message.includes('invalid'))) {
    return {
      code: 'SESSION_EXPIRED',
      severity: SEVERITY.WARNING,
      message: 'This consultation link has expired.',
      guidance: 'Reopen the consultation from the appointment to get a fresh link.',
      recoverable: true,
    };
  }
  if (name.includes('network') || message.includes('failed to fetch') || message.includes('offline')) {
    return {
      code: 'NETWORK_UNAVAILABLE',
      severity: SEVERITY.CRITICAL,
      message: 'The network connection dropped.',
      guidance: 'Reconnecting automatically. Your notes are saved until you are back online.',
      recoverable: true,
    };
  }
  return {
    code: 'UNKNOWN_MEDIA_ERROR',
    severity: SEVERITY.WARNING,
    message: 'The call hit an unexpected problem.',
    guidance: 'Rejoin the call. If it keeps happening, use an audio-only call and report it to your supervisor.',
    recoverable: true,
  };
}

/** Exponential backoff with a cap and deterministic jitter for tests. */
export function computeReconnectDelay(attempt, { baseMs = 1000, maxMs = 15000, jitterRatio = 0.25, random = 1 } = {}) {
  const safeAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
  const exponential = Math.min(maxMs, baseMs * (2 ** safeAttempt));
  const jitter = exponential * jitterRatio * (Number(random) - 0.5) * 2;
  return Math.max(0, Math.round(Math.min(maxMs, exponential + jitter)));
}

/** Single source of truth for what the call UI should show. */
export function deriveConnectionState(input = {}) {
  const {
    phase = CONNECTION_STATES.IDLE,
    downKbps = null,
    packetLossPct = null,
    rttMs = null,
    offline = false,
    reconnectAttempt = 0,
    lastError = null,
    forcedState = null,
  } = input;

  let state = forcedState || phase;
  const terminalPhase = phase === CONNECTION_STATES.ENDED || phase === CONNECTION_STATES.FAILED;

  // A finished or failed call is never resurrected by a quality reading.
  if (!forcedState && !terminalPhase) {
    if (offline) {
      state = reconnectAttempt > 0 ? CONNECTION_STATES.RECONNECTING : CONNECTION_STATES.DEGRADED;
    } else if (downKbps != null) {
      const loss = Number(packetLossPct) || 0;
      const rtt = Number(rttMs) || 0;
      if (downKbps < QUALITY_THRESHOLDS.audioOnlyKbps
        || loss > QUALITY_THRESHOLDS.highLossPct
        || rtt > QUALITY_THRESHOLDS.highRttMs) {
        state = CONNECTION_STATES.FALLBACK_REQUIRED;
      } else if (downKbps < QUALITY_THRESHOLDS.fairKbps || loss > 3) {
        state = CONNECTION_STATES.DEGRADED;
      } else if (phase === CONNECTION_STATES.RECONNECTING) {
        state = CONNECTION_STATES.RECOVERED;
      } else {
        state = CONNECTION_STATES.CONNECTED;
      }
    } else if (phase === CONNECTION_STATES.RECONNECTING) {
      state = CONNECTION_STATES.RECONNECTING;
    }
  }

  const presentation = STATE_PRESENTATION[state] || STATE_PRESENTATION[CONNECTION_STATES.FAILED];
  const failure = lastError ? describeFailure(lastError) : null;

  return {
    state,
    severity: failure ? failure.severity : presentation.severity,
    label: failure ? failure.message : presentation.label,
    guidance: failure ? failure.guidance : presentation.guidance || null,
    failureCode: failure ? failure.code : null,
    offerAudioOnly: state === CONNECTION_STATES.FALLBACK_REQUIRED
      || state === CONNECTION_STATES.DEGRADED
      || Boolean(failure && failure.code === 'MEDIA_RELAY_UNAVAILABLE'),
    offerReschedule: state === CONNECTION_STATES.FALLBACK_REQUIRED || state === CONNECTION_STATES.FAILED,
    canReconnect: state !== CONNECTION_STATES.ENDED,
    retryDelayMs: state === CONNECTION_STATES.RECONNECTING || state === CONNECTION_STATES.DEGRADED
      ? computeReconnectDelay(reconnectAttempt)
      : 0,
  };
}

/**
 * Fail-closed media capability report. Multiparty is only advertised when the
 * SFU and TURN are both configured and the server allows at least three parties.
 */
export function evaluateMediaReadiness({
  sfuConfigured = false,
  turnConfigured = false,
  iceServers = [],
  participantLimit = 1,
} = {}) {
  const blockers = [];
  if (!sfuConfigured) blockers.push('SFU_NOT_CONFIGURED');
  if (!turnConfigured) blockers.push('TURN_NOT_CONFIGURED');
  if (!iceServers || iceServers.length === 0) blockers.push('ICE_SERVERS_MISSING');

  const oneToOne = Boolean(sfuConfigured || turnConfigured) && iceServers.length > 0;
  const multiparty = blockers.length === 0 && Number(participantLimit) >= 3;

  return {
    oneToOneSupported: oneToOne,
    multipartySupported: multiparty,
    blockers,
    participantLimit: multiparty ? Number(participantLimit) : 2,
    advertisedAsOperational: multiparty,
  };
}

/**
 * Participant roster with duplicate-tab and re-entry handling.
 * Events: { type: 'join'|'leave'|'rejected', participantId, at }
 */
export function trackParticipants(events = [], existing = []) {
  const roster = new Map();
  for (const participant of existing) {
    roster.set(participant.participantId, {
      ...participant,
      present: true,
      joinCount: participant.joinCount || 1,
    });
  }

  const rejected = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    const id = event.participantId;
    if (!id) continue;
    if (event.type === 'join') {
      const known = roster.get(id);
      roster.set(id, {
        ...(known || {}),
        participantId: id,
        present: true,
        isReentry: Boolean(known),
        joinCount: known ? (known.joinCount || 1) + 1 : 1,
        lastSeenAt: event.at || null,
        role: event.role || (known && known.role) || null,
      });
    } else if (event.type === 'leave') {
      const known = roster.get(id);
      if (!known) continue;
      roster.set(id, { ...known, present: false, leftAt: event.at || null });
    } else if (event.type === 'rejected') {
      rejected.push({ participantId: id, reason: event.reason || 'rejected', at: event.at || null });
    }
  }

  const participants = Array.from(roster.values());
  const presentIds = participants.filter((p) => p.present).map((p) => p.participantId);

  return {
    participants,
    presentCount: presentIds.length,
    duplicatePresent: presentIds.length !== new Set(presentIds).size,
    reentries: participants.filter((p) => p.isReentry).map((p) => p.participantId),
    rejected,
  };
}

/** Guards against a second tab replacing the first tab's live session. */
export function detectDuplicateSession({ activeSessionId, incomingSessionId, tabs = 1 } = {}) {
  if (tabs > 1 && activeSessionId && incomingSessionId
    && activeSessionId !== incomingSessionId) {
    return {
      duplicate: true,
      reason: 'CONCURRENT_SESSION',
      message: 'This consultation is already open in another tab or device.',
      guidance: 'Continue here and close the other window, or rejoin from the appointment.',
    };
  }
  if (tabs > 1 && activeSessionId && incomingSessionId && activeSessionId === incomingSessionId) {
    return {
      duplicate: true,
      reason: 'SAME_SESSION_REOPENED',
      message: 'This call was reopened in a second tab.',
      guidance: 'Close the duplicate tab to avoid two audio streams.',
    };
  }
  return { duplicate: false, reason: null, message: null, guidance: null };
}

export const _test = { STATE_PRESENTATION };

