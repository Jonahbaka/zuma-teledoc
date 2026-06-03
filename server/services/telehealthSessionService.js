const db = require('../db');
const logger = require('../middleware/logger');
const { generateRoomId, keysToCamel } = require('../../lib/utils');
const { getUserTestingAccess } = require('./testingAccessService');

const DEFAULT_ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ]
  }
];

const JOINABLE_STATUSES = new Set(['scheduled', 'confirmed', 'in_progress']);
let missingTurnWarningLogged = false;

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
    process.env.WEBRTC_ICE_SERVERS_JSON ||
      process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS_JSON ||
      process.env.RTC_ICE_SERVERS_JSON ||
      process.env.ICE_SERVERS_JSON
  );

  if (explicitServers.length) {
    return explicitServers;
  }

  const stunServers = splitUrls(
    process.env.NEXT_PUBLIC_WEBRTC_STUN_URLS ||
      process.env.WEBRTC_STUN_URLS ||
      process.env.RTC_STUN_SERVERS ||
      process.env.STUN_SERVERS
  );
  const turnUrls = splitUrls(
    process.env.WEBRTC_TURN_URLS ||
      process.env.NEXT_PUBLIC_WEBRTC_TURN_URLS ||
      process.env.WEBRTC_TURN_URL ||
      process.env.NEXT_PUBLIC_WEBRTC_TURN_URL ||
      process.env.RTC_TURN_URLS ||
      process.env.TURN_URLS ||
      process.env.RTC_TURN_URL ||
      process.env.TURN_URL
  );
  const turnUsername =
    process.env.WEBRTC_TURN_USERNAME ||
    process.env.NEXT_PUBLIC_WEBRTC_TURN_USERNAME ||
    process.env.RTC_TURN_USERNAME ||
    process.env.TURN_USERNAME ||
    '';
  const turnCredential =
    process.env.WEBRTC_TURN_CREDENTIAL ||
    process.env.NEXT_PUBLIC_WEBRTC_TURN_CREDENTIAL ||
    process.env.WEBRTC_TURN_PASSWORD ||
    process.env.NEXT_PUBLIC_WEBRTC_TURN_PASSWORD ||
    process.env.RTC_TURN_CREDENTIAL ||
    process.env.TURN_CREDENTIAL ||
    process.env.RTC_TURN_PASSWORD ||
    process.env.TURN_PASSWORD ||
    '';

  const iceServers = [];

  if (stunServers.length) {
    iceServers.push({ urls: stunServers });
  }

  if (turnUrls.length && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential
    });
  } else if (process.env.NODE_ENV === 'production' && !missingTurnWarningLogged) {
    missingTurnWarningLogged = true;
    logger.warn('WebRTC TURN is not fully configured; calls may fail for users behind restrictive NATs', {
      hasTurnUrls: Boolean(turnUrls.length),
      hasTurnUsername: Boolean(turnUsername),
      hasTurnCredential: Boolean(turnCredential)
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
            a.payment_required,
            a.payment_completed,
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

  if (String(user.role || '').trim().toLowerCase() === 'patient') {
    const testingAccess = await getUserTestingAccess(user.id);
    const paymentBypassed = Boolean(testingAccess?.testingBypassActive);
    if (!paymentBypassed && appointment.paymentRequired && !appointment.paymentCompleted) {
      throw createHttpError(402, 'Payment required before joining video appointment');
    }
  }

  return appointment;
};

const ensureAppointmentRoomId = async (appointmentId, currentRoomId) => {
  if (currentRoomId) {
    return currentRoomId;
  }

  const roomId = generateRoomId();
  const { rows } = await db.query(
    `UPDATE appointments
        SET room_id = COALESCE(room_id, $1),
            updated_at = CASE WHEN room_id IS NULL THEN NOW() ELSE updated_at END
      WHERE id = $2
      RETURNING room_id`,
    [roomId, appointmentId]
  );

  return rows[0]?.room_id || roomId;
};

module.exports = {
  buildParticipantPayload,
  createHttpError,
  ensureAppointmentRoomId,
  getAuthorizedVideoAppointment,
  getTelehealthIceServers
};
