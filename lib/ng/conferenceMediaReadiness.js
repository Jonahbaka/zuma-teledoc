'use strict';

const PEER_MESH_LIMIT = 3;
const SFU_MEDIA_SERVERS = new Set(['livekit', 'mediasoup', 'janus']);

function splitUrls(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseIceServers(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function urlsFromIceServer(server) {
  if (!server || typeof server !== 'object') return [];
  if (Array.isArray(server.urls)) return server.urls.filter(Boolean);
  return splitUrls(server.urls || server.url);
}

function hasReusableTurnCredential(env = process.env) {
  const hasSharedSecret = Boolean(
    env.RTC_TURN_STATIC_AUTH_SECRET ||
    env.TURN_STATIC_AUTH_SECRET ||
    env.TURN_SHARED_SECRET
  );
  const hasStaticCredential = Boolean(
    (env.RTC_TURN_USERNAME || env.TURN_USERNAME) &&
    (env.RTC_TURN_CREDENTIAL || env.TURN_CREDENTIAL || env.RTC_TURN_PASSWORD || env.TURN_PASSWORD)
  );

  return hasSharedSecret || hasStaticCredential;
}

function hasTurnConfig(env = process.env) {
  const explicit = parseIceServers(env.RTC_ICE_SERVERS_JSON || env.ICE_SERVERS_JSON);
  if (explicit.some((server) => {
    const hasTurnUrl = urlsFromIceServer(server).some((url) => /^turns?:/i.test(String(url)));
    const hasInlineCredential = Boolean(server?.username && server?.credential);
    return hasTurnUrl && (hasInlineCredential || hasReusableTurnCredential(env));
  })) {
    return true;
  }

  const turnUrls = splitUrls(
    env.RTC_TURN_URLS ||
    env.TURN_URLS ||
    env.RTC_TURN_URL ||
    env.TURN_URL
  );
  if (!turnUrls.length) return false;

  return hasReusableTurnCredential(env);
}

function configuredSfu(mediaServer, env = process.env) {
  const server = String(mediaServer || '').toLowerCase();
  if (!SFU_MEDIA_SERVERS.has(server)) return false;

  if (server === 'livekit') {
    return Boolean(
      (env.NG_LIVEKIT_URL || env.LIVEKIT_URL) &&
      (env.NG_LIVEKIT_API_KEY || env.LIVEKIT_API_KEY) &&
      (env.NG_LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET)
    );
  }

  if (server === 'mediasoup') {
    return Boolean(env.NG_MEDIASOUP_URL || env.MEDIASOUP_URL);
  }

  if (server === 'janus') {
    return Boolean(env.NG_JANUS_URL || env.JANUS_URL);
  }

  return false;
}

function suggestMediaServer(maxParticipants, env = process.env) {
  if (!maxParticipants || Number(maxParticipants) <= PEER_MESH_LIMIT) return 'peer_mesh';
  return env.NG_CONF_DEFAULT_MEDIA_SERVER || 'livekit';
}

function assessConferenceMediaReadiness({ maxParticipants, mediaServer, env = process.env } = {}) {
  const parsedMax = Number(maxParticipants || 10);
  const max = Number.isFinite(parsedMax) ? Math.max(2, Math.min(50, parsedMax)) : 10;
  const server = String(mediaServer || suggestMediaServer(max, env)).toLowerCase();
  const warnings = [];
  const blockers = [];

  if (server === 'peer_mesh') {
    if (max > PEER_MESH_LIMIT) {
      blockers.push(`peer_mesh is limited to ${PEER_MESH_LIMIT} participants; configure an SFU for ${max}-participant rooms`);
    }
    if (!hasTurnConfig(env)) {
      warnings.push('TURN relay is not configured; mobile/symmetric NAT users may fail to connect');
    }
  } else if (SFU_MEDIA_SERVERS.has(server)) {
    if (!configuredSfu(server, env)) {
      blockers.push(`${server} media server selected but required SFU environment is not configured`);
    }
    if (!hasTurnConfig(env)) {
      blockers.push('TURN relay is required for production multi-party media on mobile networks');
    }
  } else if (server === 'none') {
    blockers.push('media_server=none cannot host a live media session');
  } else {
    blockers.push(`unsupported media_server '${server}'`);
  }

  return {
    ready: blockers.length === 0,
    mediaServer: server,
    maxParticipants: max,
    peerMeshLimit: PEER_MESH_LIMIT,
    requiresSfu: max > PEER_MESH_LIMIT,
    hasTurn: hasTurnConfig(env),
    blockers,
    warnings,
  };
}

function assertConferenceMediaReady(input) {
  const readiness = assessConferenceMediaReadiness(input);
  if (!readiness.ready) {
    const err = new Error(`Conference media is not production-ready: ${readiness.blockers.join('; ')}`);
    err.code = 'MEDIA_NOT_READY';
    err.readiness = readiness;
    throw err;
  }
  return readiness;
}

module.exports = {
  PEER_MESH_LIMIT,
  SFU_MEDIA_SERVERS,
  assessConferenceMediaReadiness,
  assertConferenceMediaReady,
  configuredSfu,
  hasTurnConfig,
  suggestMediaServer,
};
