const crypto = require('crypto');
const db = require('../db');
const logger = require('../middleware/logger');
const { generateRoomId, keysToCamel } = require('../../lib/utils');

/**
 * Generate coturn REST-API time-limited TURN credentials.
 * Matches coturn's `use-auth-secret` / `static-auth-secret` mechanism:
 *   username   = <expiry_unix_ts>[:<user>]
 *   credential = base64( HMAC-SHA1( secret, username ) )
 * This is what makes TURN relay usable on symmetric NAT / Nigerian mobile
 * carriers without distributing long-lived static credentials.
 */
const buildTurnRestCredential = (secret, ttlSeconds = 86400, user = 'doctarx') => {
  const expiry = Math.floor(Date.now() / 1000) + Number(ttlSeconds || 86400);
  const username = `${expiry}:${user}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
};

const DEFAULT_ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ]
  }
];

const JOINABLE_STATUSES = new Set(['scheduled', 'confirmed', 'in_progress']);

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const parseIceServers = (value) => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((server) => normalizeIceServer(server))
        .filter(Boolean);
    }
  } catch (error) {
    logger.warn('Failed to parse ICE server JSON config', { error: error.message });
  }

  return [];
};

const splitUrls = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeIceServer = (server) => {
  if (!server || typeof server !== 'object') return null;

  const urls = Array.isArray(server.urls)
    ? server.urls.filter(Boolean)
    : splitUrls(server.urls || server.url);

  if (!urls.length) {
    return null;
  }

  const normalized = { urls };

  if (server.username) normalized.username = String(server.username);
  if (server.credential) normalized.credential = String(server.credential);

  return normalized;
};

const getTelehealthIceServers = () => {
  const explicitServers = parseIceServers(
    process.env.RTC_ICE_SERVERS_JSON || process.env.ICE_SERVERS_JSON
  );

  if (explicitServers.length) {
    return explicitServers;
  }

  const stunServers = splitUrls(
    process.env.RTC_STUN_SERVERS || process.env.STUN_SERVERS
  );
  const turnUrls = splitUrls(
    process.env.RTC_TURN_URLS ||
      process.env.TURN_URLS ||
      process.env.RTC_TURN_URL ||
      process.env.TURN_URL
  );
  const turnUsername =
    process.env.RTC_TURN_USERNAME ||
    process.env.TURN_USERNAME ||
    '';
  const turnCredential =
    process.env.RTC_TURN_CREDENTIAL ||
    process.env.TURN_CREDENTIAL ||
    process.env.RTC_TURN_PASSWORD ||
    process.env.TURN_PASSWORD ||
    '';

  const iceServers = [];

  if (stunServers.length) {
    iceServers.push({ urls: stunServers });
  }

  // TURN shared secret (coturn `static-auth-secret`) — preferred for production:
  // generates short-lived credentials per session so nothing long-lived ships to
  // the browser. Falls back to static username/credential if those are provided.
  const turnSharedSecret =
    process.env.RTC_TURN_STATIC_AUTH_SECRET ||
    process.env.TURN_STATIC_AUTH_SECRET ||
    process.env.TURN_SHARED_SECRET ||
    '';
  const turnTtl = process.env.RTC_TURN_TTL_SECONDS || process.env.TURN_TTL_SECONDS || 86400;

  if (turnUrls.length && turnSharedSecret) {
    const { username, credential } = buildTurnRestCredential(turnSharedSecret, turnTtl);
    iceServers.push({ urls: turnUrls, username, credential });
  } else if (turnUrls.length && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential
    });
  } else if (turnUrls.length) {
    // TURN host configured but no usable credential — warn loudly; STUN-only
    // will fail on symmetric/mobile NAT (the Nigerian carrier case).
    logger.warn('TURN URLs configured without credentials or shared secret — relay disabled, NAT traversal may fail', {
      turnUrls,
    });
  }

  return iceServers.length ? iceServers : DEFAULT_ICE_SERVERS;
};

const resolveParticipantName = (appointment, user, displayName) => {
  if (displayName && String(displayName).trim()) {
    return String(displayName).trim();
  }

  const normalizedRole = String(user?.role || '').trim().toLowerCase();

  if (normalizedRole === 'provider') {
    const fallback = `${appointment.providerFirstName || ''} ${appointment.providerLastName || ''}`.trim();
    return fallback ? `Dr. ${fallback}` : 'Provider';
  }

  if (normalizedRole === 'patient') {
    const fallback = `${appointment.patientFirstName || ''} ${appointment.patientLastName || ''}`.trim();
    return fallback || 'Patient';
  }

  return String(user?.name || '').trim() || 'Participant';
};

const buildParticipantPayload = ({ appointment, user, socketId, displayName }) => ({
  socketId,
  userId: user.id,
  role: String(user.role || '').trim().toLowerCase(),
  name: resolveParticipantName(appointment, user, displayName),
  joinedAt: new Date().toISOString()
});

const getAuthorizedVideoAppointment = async (appointmentId, user) => {
  const { rows } = await db.query(
    `SELECT a.id,
            a.patient_id,
            a.provider_id,
            a.room_id,
            a.status,
            a.type,
            p.first_name AS patient_first_name,
            p.last_name AS patient_last_name,
            pr.first_name AS provider_first_name,
            pr.last_name AS provider_last_name
       FROM appointments a
       JOIN users p ON p.id = a.patient_id
       JOIN users pr ON pr.id = a.provider_id
      WHERE a.id = $1
      LIMIT 1`,
    [appointmentId]
  );

  if (!rows.length) {
    throw createHttpError(404, 'Appointment not found');
  }

  const appointment = keysToCamel(rows[0]);
  const isParticipant =
    appointment.patientId === user.id ||
    appointment.providerId === user.id;

  if (!isParticipant) {
    throw createHttpError(403, 'Access denied');
  }

  if (appointment.type !== 'video') {
    throw createHttpError(400, 'This is not a video appointment');
  }

  if (!JOINABLE_STATUSES.has(appointment.status)) {
    throw createHttpError(400, 'This appointment cannot be joined');
  }

  return appointment;
};

const ensureAppointmentRoomId = async (appointmentId, currentRoomId) => {
  if (currentRoomId) {
    return currentRoomId;
  }

  const roomId = generateRoomId();
  await db.query(
    'UPDATE appointments SET room_id = $1, updated_at = NOW() WHERE id = $2',
    [roomId, appointmentId]
  );

  return roomId;
};

module.exports = {
  buildParticipantPayload,
  createHttpError,
  ensureAppointmentRoomId,
  getAuthorizedVideoAppointment,
  getTelehealthIceServers
};
