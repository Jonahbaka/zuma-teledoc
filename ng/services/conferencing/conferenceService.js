'use strict';

/**
 * ng/services/conferencing/conferenceService.js
 *
 * Multi-party conferencing control plane. Handles rooms, participants,
 * waiting-room admission, role permissions, chat, audit. Media plane is
 * pluggable (peer_mesh / livekit / mediasoup / janus).
 */

const crypto = require('crypto');
const { getPool } = require('../../../server/db');
const { effectivePermissions, can, canActOn, ROLE_RANK } = require('../../../lib/ng/conferencePermissions');
const {
  PEER_MESH_LIMIT,
  assessConferenceMediaReadiness,
  assertConferenceMediaReady,
  suggestMediaServer,
} = require('../../../lib/ng/conferenceMediaReadiness');

// ─── State machine ───────────────────────────────────────────────────────────

const ROOM_TRANSITIONS = {
  scheduled: ['live', 'cancelled'],
  live:      ['ended'],
  ended:     [],
  cancelled: [],
};

function isValidRoomTransition(from, to) {
  return (ROOM_TRANSITIONS[from] || []).includes(to);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genRoomCode() {
  const year = new Date().getUTCFullYear();
  const rand = crypto.randomBytes(4).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return `CONF-${year}-${rand}`;
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}
function mintToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// ─── Conference role coercion ────────────────────────────────────────────────
// `ng_conf_role` is the conference-participant role enum and is INTENTIONALLY
// distinct from the DoctaRx platform role (e.g. a platform 'provider' is a
// clinical 'doctor' inside a room). Any value reaching the DB must be a valid
// enum member, so we whitelist + map here. This is the authoritative guard:
// never trust a client-supplied role to be a valid enum value.
const VALID_CONF_ROLES = new Set([
  'host', 'consultant', 'doctor', 'nurse',
  'pharmacist', 'patient', 'family', 'observer',
]);

// Platform / synonym role → conference role
const CONF_ROLE_ALIASES = {
  provider: 'doctor',
  clinician: 'doctor',
  physician: 'doctor',
  gp: 'doctor',
  specialist: 'consultant',
  attending: 'consultant',
  admin: 'host',
  super_admin: 'host',
  hospital_admin: 'host',
  clinic_admin: 'host',
  facility_admin: 'host',
  pharmacy: 'pharmacist',
  pharmacist_user: 'pharmacist',
  rn: 'nurse',
  caregiver: 'family',
  guardian: 'family',
  intern: 'observer',
  guest: 'observer',
};

function coerceConfRole(role, fallback = 'observer') {
  if (!role) return fallback;
  const normalized = String(role).trim().toLowerCase();
  if (VALID_CONF_ROLES.has(normalized)) return normalized;
  if (CONF_ROLE_ALIASES[normalized]) return CONF_ROLE_ALIASES[normalized];
  return fallback;
}

async function logEvent(roomId, participantId, actor, eventKind, payload, pool = getPool()) {
  // actor_role is ng_conf_role enum; coerce platform roles (e.g. 'provider') before insert
  const actorRole = actor?.role ? coerceConfRole(actor.role, null) : null;
  await pool.query(
    `INSERT INTO ng_conf_events
       (room_id, participant_id, actor_user_id, actor_role, event_kind, payload_json)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::jsonb,'{}'::jsonb))`,
    [
      roomId, participantId || null,
      actor?.user_id || null, actorRole,
      eventKind,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

// Pool callers use one checked-out transaction. Internal callers may pass the
// already-checked-out client so invite consumption and joining stay atomic.
async function conferenceTransaction(pool, work) {
  if (typeof pool.connect !== 'function') return work(pool);
  const client = await pool.connect(); let discard = false;
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch (_) { discard = true; } throw error; }
  finally { client.release(discard); }
}
function lockedRoomOperation(operation, poolIndex, { allowClosed = false, revoke = false, end = false } = {}) {
  return async (...args) => {
    const pool = args[poolIndex] || getPool(); let room;
    const result = await conferenceTransaction(pool, async client => {
      room = (await client.query('SELECT * FROM ng_conf_rooms WHERE id = $1 FOR UPDATE', [args[0]])).rows[0];
      if (!room) throwNotFound();
      if (!allowClosed && !['scheduled', 'live'].includes(room.status)) throwInvalid('Conference is not open');
      args[poolIndex] = client;
      return operation(...args);
    });
    // Revoke signaling/media only after the authoritative transaction commits.
    if (revoke && result && (end || result.user_id)) {
      require('../../../server/services/socketService').revokeConferenceAccess(args[0], end ? null : result.user_id);
      if (room.media_server === 'livekit') {
        const media = require('./livekitService');
        if (end) await media.closeMediaRoom(args[0]);
        else if (result.user_id) await media.disconnectParticipant(args[0], result.user_id);
      }
    }
    return result;
  };
}
function forbidden(message) { const error = new Error(message); error.code = 'FORBIDDEN'; return error; }

// ─── Room CRUD ───────────────────────────────────────────────────────────────

async function createRoom(input, actor, pool = getPool()) {
  const code = genRoomCode();
  const maxParticipants = Math.max(2, Math.min(50, Number(input.max_participants || 10)));
  const mediaServer = input.media_server || suggestMediaServer(maxParticipants);
  const mediaReadiness = assessConferenceMediaReadiness({ maxParticipants, mediaServer });
  const baseMetadata = input.metadata_json && typeof input.metadata_json === 'object' && !Array.isArray(input.metadata_json)
    ? input.metadata_json
    : {};
  const metadata = {
    ...baseMetadata,
    media_readiness: mediaReadiness,
  };

  if (!mediaReadiness.ready && input.require_media_ready === true) {
    const e = new Error(`Conference media is not production-ready: ${mediaReadiness.blockers.join('; ')}`);
    e.code = 'MEDIA_NOT_READY';
    e.readiness = mediaReadiness;
    throw e;
  }

  const r = await pool.query(
    `INSERT INTO ng_conf_rooms
       (room_code, title, kind, host_user_id, host_provider_id, hospital_id,
        appointment_id, patient_user_id, patient_name_snapshot,
        max_participants, requires_waiting_room, recording_enabled,
        allow_chat, allow_private_dm,
        media_server, media_server_url, signaling_namespace,
        scheduled_start, scheduled_end, parent_room_id, metadata_json)
     VALUES ($1,$2,COALESCE($3::ng_conf_kind,'consultation'::ng_conf_kind),$4,$5,$6,$7,$8,$9,
             $10,COALESCE($11,TRUE),COALESCE($12,FALSE),
             COALESCE($13,TRUE),COALESCE($14,TRUE),
             COALESCE($15::ng_conf_media_server,'peer_mesh'::ng_conf_media_server),$16,$17,$18,$19,$20,COALESCE($21::jsonb,'{}'::jsonb))
     RETURNING *`,
    [
      code, input.title || 'Consultation', input.kind || null,
      actor?.user_id || null, input.host_provider_id || null, input.hospital_id || null,
      input.appointment_id || null, input.patient_user_id || null, input.patient_name_snapshot || null,
      maxParticipants, input.requires_waiting_room, input.recording_enabled,
      input.allow_chat, input.allow_private_dm,
      mediaServer, input.media_server_url || null, input.signaling_namespace || `/conf:${code}`,
      input.scheduled_start || null, input.scheduled_end || null, input.parent_room_id || null,
      JSON.stringify(metadata),
    ]
  );
  const room = r.rows[0];

  // Self-enrol the clinical host with moderator overrides while preserving
  // the provider's clinical conference role (for example, doctor).
  if (actor?.user_id) {
    const hostRole = ['admin', 'super_admin', 'hospital_admin'].includes(String(actor.role || '').toLowerCase())
      ? 'host'
      : coerceConfRole(actor.role, 'host');
    const hostPermissions = hostRole === 'host'
      ? {}
      : {
          admit_others: true,
          kick_others: true,
          mute_others: true,
          end_room: true,
          start_recording: true,
          manage_breakouts: true,
        };
    await pool.query(
      `INSERT INTO ng_conf_participants
         (room_id, user_id, display_name, role, status, joined_at, permissions_json)
       VALUES ($1,$2,$3,$4,'admitted',NOW(),$5::jsonb)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [
        room.id,
        actor.user_id,
        input.host_display_name || actor.display_name || 'Host',
        hostRole,
        JSON.stringify(hostPermissions),
      ]
    );
  }

  await logEvent(room.id, null, actor, 'room_created', { kind: room.kind, max: maxParticipants }, pool);
  return room;
}

async function getRoom(id, pool = getPool()) {
  const r = await pool.query(`SELECT * FROM ng_conf_rooms WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

async function getRoomByCode(code, pool = getPool()) {
  const r = await pool.query(`SELECT * FROM ng_conf_rooms WHERE room_code = $1`, [code]);
  return r.rows[0] || null;
}

async function assertRoomAccess(roomId, actor, options = {}, pool = getPool()) {
  const { admittedOnly = false, moderatorOnly = false, allowAdmin = true } = options;
  if (!actor?.user_id) {
    const error = new Error('Authenticated room membership is required');
    error.code = 'FORBIDDEN';
    throw error;
  }
  const result = await pool.query(
    `SELECT r.*, p.id AS actor_participant_id, p.role AS actor_participant_role,
            p.status AS actor_participant_status, p.permissions_json AS actor_permissions
       FROM ng_conf_rooms r
       LEFT JOIN ng_conf_participants p
         ON p.room_id = r.id AND p.user_id = $2
      WHERE r.id = $1
      LIMIT 1`,
    [roomId, actor.user_id]
  );
  const room = result.rows[0];
  if (!room) throwNotFound();

  const isAdmin = allowAdmin && ['admin', 'super_admin'].includes(String(actor.role || '').toLowerCase());
  const isHost = String(room.host_user_id) === String(actor.user_id);
  const isAdmitted = room.actor_participant_status === 'admitted';
  const isKnownParticipant = ['invited', 'waiting', 'admitted', 'left'].includes(room.actor_participant_status);
  const canModerate =
    isHost ||
    isAdmin ||
    (isAdmitted && (
      room.actor_participant_role === 'host' ||
      can(room.actor_participant_role, room.actor_permissions, 'admit_others') ||
      can(room.actor_participant_role, room.actor_permissions, 'end_room')
    ));
  const allowed = moderatorOnly
    ? canModerate
    : admittedOnly
      ? isAdmitted
      : isHost || isAdmin || isKnownParticipant;
  if (!allowed) {
    const error = new Error('You are not authorized to access this conference room');
    error.code = 'FORBIDDEN';
    throw error;
  }
  return room;
}

async function listRooms({ host_user_id, status, kind, since, limit = 50, actor_user_id, actor_role } = {}, pool = getPool()) {
  const where = [];
  const params = [];
  const isAdmin = ['admin', 'super_admin'].includes(String(actor_role || '').toLowerCase());
  if (actor_user_id && !isAdmin) {
    params.push(actor_user_id);
    where.push(`(
      host_user_id = $${params.length}
      OR EXISTS (
        SELECT 1 FROM ng_conf_participants access_participant
         WHERE access_participant.room_id = ng_conf_rooms.id
           AND access_participant.user_id = $${params.length}
      )
    )`);
  }
  if (host_user_id) { params.push(host_user_id); where.push(`host_user_id = $${params.length}`); }
  if (status)       { params.push(status);       where.push(`status = $${params.length}`); }
  if (kind)         { params.push(kind);         where.push(`kind = $${params.length}`); }
  if (since)        { params.push(since);        where.push(`created_at >= $${params.length}`); }
  params.push(Math.min(limit, 500));
  const sql = `
    SELECT * FROM ng_conf_rooms
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(started_at, scheduled_start, created_at) DESC
    LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

async function startRoom(id, actor, pool = getPool()) {
  await assertRoomAccess(id, actor, { moderatorOnly: true }, pool);
  const room = await getRoom(id, pool);
  if (!room) throwNotFound();
  if (!isValidRoomTransition(room.status, 'live')) throwInvalid(`Cannot start from ${room.status}`);
  assertConferenceMediaReady({ maxParticipants: room.max_participants, mediaServer: room.media_server });
  const r = await pool.query(
    `UPDATE ng_conf_rooms SET status='live', started_at=NOW(), updated_at=NOW()
      WHERE id=$1 RETURNING *`, [id]
  );
  await logEvent(id, null, actor, 'room_started', null, pool);
  return r.rows[0];
}

async function endRoom(id, actor, pool = getPool()) {
  await assertRoomAccess(id, actor, { moderatorOnly: true }, pool);
  const room = await getRoom(id, pool);
  if (!room) throwNotFound();
    if (room.status === 'ended') {
          return room;
    }
  if (!isValidRoomTransition(room.status, 'ended')) throwInvalid(`Cannot end from ${room.status}`);
  const r = await pool.query(
    `UPDATE ng_conf_rooms SET status='ended', ended_at=NOW(), updated_at=NOW()
      WHERE id=$1 RETURNING *`, [id]
  );
  // Mark anyone still admitted as 'left' with their attended_seconds updated
  await pool.query(
    `UPDATE ng_conf_participants
        SET status='left', left_at=NOW(),
            attended_seconds = attended_seconds +
              GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(joined_at, NOW())))::int)
      WHERE room_id=$1 AND status='admitted'`, [id]
  );
  await logEvent(id, null, actor, 'room_ended', null, pool);
  return r.rows[0];
}

async function cancelRoom(id, actor, { reason } = {}, pool = getPool()) {
  await assertRoomAccess(id, actor, { moderatorOnly: true }, pool);
  const room = await getRoom(id, pool);
  if (!room) throwNotFound();
  if (room.status === 'cancelled') return room;
  if (!isValidRoomTransition(room.status, 'cancelled')) throwInvalid(`Cannot cancel from ${room.status}`);
  const r = await pool.query(
    `UPDATE ng_conf_rooms SET status='cancelled', cancelled_at=NOW(),
            cancellation_reason=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, reason || null]
  );
  await pool.query("UPDATE ng_conf_participants SET status='left', left_at=NOW() WHERE room_id=$1 AND status IN ('admitted','waiting','invited')", [id]);
  await logEvent(id, null, actor, 'room_cancelled', { reason }, pool);
  return r.rows[0];
}

// ─── Participants ────────────────────────────────────────────────────────────

async function joinRoom(roomId, actor, options = {}, pool = getPool()) {
  if (!actor?.user_id) throw forbidden('Sign in before joining this conference');
  return conferenceTransaction(pool, client => joinRoomInTransaction(roomId, actor, options, client));
}

async function joinRoomInTransaction(roomId, actor, { display_name, role = 'observer', user_agent, client_ip } = {}, pool) {
  const room = (await pool.query('SELECT * FROM ng_conf_rooms WHERE id = $1 FOR UPDATE', [roomId])).rows[0];
  if (!room) throwNotFound();
  if (room.status === 'cancelled' || room.status === 'ended') throwInvalid(`Room is ${room.status}`);

  const existing = await getActorParticipant(roomId, actor.user_id, pool);
  const isRoomHost = String(room.host_user_id) === String(actor.user_id);
  const isRoomPatient = String(room.patient_user_id) === String(actor.user_id);
  if (existing && ['removed', 'denied'].includes(existing.status)) throw forbidden('A new authorized invitation is required');
  if (!isRoomHost && !isRoomPatient && !existing) throw forbidden('An authorized room invitation is required');
  if (isRoomHost) role = coerceConfRole(actor.role, 'host');
  else if (existing?.role) role = existing.role;
  else if (isRoomPatient) role = 'patient';
  else role = 'observer';

  // Count current admitted
  const c = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ng_conf_participants WHERE room_id=$1 AND status='admitted'`,
    [roomId]
  );
  if (existing?.status !== 'admitted' && c.rows[0].n >= room.max_participants) {
    const e = new Error('Room is full');
    e.code = 'ROOM_FULL'; throw e;
  }

  // The platform provider retains the clinical doctor role. Room ownership,
  // rather than that role's label, grants host admission. A retry also must not
  // demote an already admitted member back into the waiting room.
  const status = isRoomHost || existing?.status === 'admitted' || (!room.requires_waiting_room && existing?.status !== 'waiting')
    ? 'admitted'
    : 'waiting';
  const joinedAt = status === 'admitted' ? 'NOW()' : 'NULL';

  // Upsert (idempotent for re-joins from the same user)
  const r = await pool.query(
    `INSERT INTO ng_conf_participants
       (room_id, user_id, display_name, role, status, joined_at, user_agent, client_ip)
     VALUES ($1,$2,$3,$4,$5,${joinedAt},$6,$7)
     ON CONFLICT (room_id, user_id) DO UPDATE
       SET status     = EXCLUDED.status,
           display_name = COALESCE(EXCLUDED.display_name, ng_conf_participants.display_name),
           joined_at  = COALESCE(ng_conf_participants.joined_at, EXCLUDED.joined_at),
           last_seen_at = NOW()
     RETURNING *`,
    [roomId, actor?.user_id || null, display_name || 'Guest', role, status, user_agent || null, client_ip || null]
  );
  const participant = r.rows[0];
  await logEvent(roomId, participant.id, actor,
    status === 'waiting' ? 'participant_invited' : 'participant_joined',
    { role }, pool);
  return participant;
}

async function admitParticipant(roomId, participantId, actor, pool = getPool()) {
  const part = (await pool.query(
    `SELECT * FROM ng_conf_participants WHERE id=$1 AND room_id=$2`,
    [participantId, roomId]
  )).rows[0];
  if (!part) throwNotFound();
  if (part.status !== 'waiting') throwInvalid(`Participant is ${part.status}`);

  // Authorisation — actor must have admit_others
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  if (actorPart?.status !== 'admitted' || !can(actorPart?.role, actorPart?.permissions_json, 'admit_others')) {
    const e = new Error('Insufficient permission to admit'); e.code = 'FORBIDDEN'; throw e;
  }

  const room = await getRoom(roomId, pool);
  const count = (await pool.query("SELECT COUNT(*)::int AS n FROM ng_conf_participants WHERE room_id=$1 AND status='admitted'", [roomId])).rows[0].n;
  if (count >= room.max_participants) { const error = new Error('Room is full'); error.code = 'ROOM_FULL'; throw error; }

  const r = await pool.query(
    `UPDATE ng_conf_participants
        SET status='admitted', admitted_by_user=$3, joined_at=NOW()
      WHERE id=$1 AND room_id=$2 RETURNING *`,
    [participantId, roomId, actor?.user_id || null]
  );
  await logEvent(roomId, participantId, actor, 'admitted', { role: part.role }, pool);
  return r.rows[0];
}

async function denyParticipant(roomId, participantId, actor, pool = getPool()) {
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  if (actorPart?.status !== 'admitted' || !can(actorPart?.role, actorPart?.permissions_json, 'admit_others')) {
    const e = new Error('Insufficient permission'); e.code = 'FORBIDDEN'; throw e;
  }
  const r = await pool.query(
    `UPDATE ng_conf_participants
        SET status='denied'
      WHERE id=$1 AND room_id=$2 AND status='waiting' RETURNING *`,
    [participantId, roomId]
  );
  if (!r.rows[0]) throwNotFound();
  await logEvent(roomId, participantId, actor, 'denied', null, pool);
  return r.rows[0];
}

async function leaveRoom(roomId, participantId, actor, pool = getPool()) {
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  const target = (await pool.query(
    `SELECT role FROM ng_conf_participants WHERE id=$1 AND room_id=$2`,
    [participantId, roomId]
  )).rows[0];
  if (!actorPart || !target) throwNotFound();
  const isSelf = actorPart.id === participantId;
  if (isSelf && actorPart.status === 'left') return actorPart;
  if (['removed', 'denied'].includes(actorPart.status)) throw forbidden('Active room membership required');
  if (!isSelf && (actorPart.status !== 'admitted' || !can(actorPart.role, actorPart.permissions_json, 'kick_others') || !canActOn(actorPart.role, target.role))) {
    const error = new Error('Cannot end another participant session');
    error.code = 'FORBIDDEN';
    throw error;
  }
  const r = await pool.query(
    `UPDATE ng_conf_participants
        SET status='${isSelf ? 'left' : 'removed'}', left_at=NOW(),
            attended_seconds = attended_seconds +
              GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(joined_at, NOW())))::int)
      WHERE id=$1 AND room_id=$2 RETURNING *`,
    [participantId, roomId]
  );
  if (!r.rows[0]) throwNotFound();
  await logEvent(roomId, participantId, actor, 'participant_left', null, pool);
  return r.rows[0];
}

async function removeParticipant(roomId, participantId, actor, { reason } = {}, pool = getPool()) {
  const room = await assertRoomAccess(roomId, actor, { admittedOnly: true, allowAdmin: false }, pool);
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  const target = (await pool.query(`SELECT role FROM ng_conf_participants WHERE id=$1 AND room_id=$2`, [participantId, roomId])).rows[0];
  if (!actorPart || !target) throwNotFound();
  if (!can(actorPart.role, actorPart.permissions_json, 'kick_others') || !canActOn(actorPart.role, target.role)) {
    const e = new Error('Cannot remove this participant'); e.code = 'FORBIDDEN'; throw e;
  }
  const r = await pool.query(
    `UPDATE ng_conf_participants
        SET status='removed', removed_by_user=$3, removed_at=NOW(), left_at=NOW()
      WHERE id=$1 AND room_id=$2 RETURNING *`,
    [participantId, roomId, actor?.user_id || null]
  );
  await logEvent(roomId, participantId, actor, 'removed', { reason }, pool);
  return r.rows[0];
}

async function promoteParticipant(roomId, participantId, actor, { role, permissions_overrides } = {}, pool = getPool()) {
  const room = await assertRoomAccess(roomId, actor, { admittedOnly: true, allowAdmin: false }, pool);
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  const owner = String(room.host_user_id) === String(actor.user_id);
  if (!owner && actorPart?.role !== 'host' && actorPart?.role !== 'consultant') {
    const e = new Error('Only host or consultant can promote'); e.code = 'FORBIDDEN'; throw e;
  }
  // Coerce to a valid enum member; null leaves the existing role untouched.
  role = role ? coerceConfRole(role, 'observer') : null;
  const target = (await pool.query('SELECT role FROM ng_conf_participants WHERE id=$1 AND room_id=$2', [participantId, roomId])).rows[0];
  if (!target) throwNotFound();
  if (!owner && (!canActOn(actorPart.role, target.role) || (role && !canActOn(actorPart.role, role)))) {
    const error = new Error('Cannot grant an equal or higher conference role'); error.code = 'FORBIDDEN'; throw error;
  }
  if (permissions_overrides) {
    const { PERMISSION_KEYS } = require('../../../lib/ng/conferencePermissions');
    if (typeof permissions_overrides !== 'object' || Array.isArray(permissions_overrides) || Object.entries(permissions_overrides).some(([key, value]) =>
      !PERMISSION_KEYS.includes(key) || typeof value !== 'boolean' || (value && !can(actorPart.role, actorPart.permissions_json, key)))) {
      const error = new Error('Conference permission override is invalid or exceeds moderator authority'); error.code = 'FORBIDDEN'; throw error;
    }
  }
  const r = await pool.query(
    `UPDATE ng_conf_participants
        SET role = COALESCE($3::ng_conf_role, role),
            permissions_json = COALESCE($4::jsonb, permissions_json)
      WHERE id=$1 AND room_id=$2 RETURNING *`,
    [participantId, roomId, role || null,
      permissions_overrides ? JSON.stringify(permissions_overrides) : null]
  );
  if (!r.rows[0]) throwNotFound();
  await logEvent(roomId, participantId, actor, 'promoted', { new_role: role, overrides: permissions_overrides }, pool);
  if (room.media_server === 'livekit' && r.rows[0]?.status === 'admitted') await require('./livekitService').updateMediaPermissions(roomId, r.rows[0]);
  return r.rows[0];
}

async function listParticipants(roomId, pool = getPool()) {
  const r = await pool.query(
    `SELECT * FROM ng_conf_participants WHERE room_id=$1 ORDER BY
       CASE status WHEN 'admitted' THEN 1 WHEN 'waiting' THEN 2 WHEN 'invited' THEN 3 ELSE 4 END,
       role,
       display_name`,
    [roomId]
  );
  return r.rows;
}

async function getActorParticipant(roomId, userId, pool = getPool()) {
  if (!userId) return null;
  const r = await pool.query(
    `SELECT * FROM ng_conf_participants WHERE room_id=$1 AND user_id=$2`,
    [roomId, userId]
  );
  return r.rows[0] || null;
}

// ─── In-call controls ────────────────────────────────────────────────────────

async function raiseHand(roomId, participantId, raised, actor, pool = getPool()) {
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  if (actorPart?.status !== 'admitted') {
    const error = new Error('Active conference membership required');
    error.code = 'FORBIDDEN';
    throw error;
  }
  if (actorPart.id !== participantId && !can(actorPart.role, actorPart.permissions_json, 'mute_others')) {
    const error = new Error('Cannot change another participant hand state');
    error.code = 'FORBIDDEN';
    throw error;
  }
  const r = await pool.query(
    `UPDATE ng_conf_participants
        SET hand_raised_at = ${raised ? 'NOW()' : 'NULL'}
      WHERE id=$1 AND room_id=$2 RETURNING *`,
    [participantId, roomId]
  );
  if (!r.rows[0]) throwNotFound();
  await logEvent(roomId, participantId, actor, raised ? 'hand_raised' : 'hand_lowered', null, pool);
  return r.rows[0];
}

async function setMute(roomId, participantId, { audio, video }, actor, pool = getPool()) {
  // Only an admitted participant can control the active room.
  if (!actor?.user_id) throw forbidden('Active conference membership required');
  {
    const actorPart = await getActorParticipant(roomId, actor.user_id, pool);
    if (actorPart?.status !== 'admitted') throw forbidden('Active conference membership required');
    const self = actorPart.id === participantId;
    if (!self && !can(actorPart?.role, actorPart?.permissions_json, 'mute_others')) {
      const e = new Error('Cannot mute others'); e.code = 'FORBIDDEN'; throw e;
    }
  }
  const sets = [];
  const params = [participantId, roomId];
  if (typeof audio === 'boolean') { params.push(audio); sets.push(`muted_audio = $${params.length}`); }
  if (typeof video === 'boolean') { params.push(video); sets.push(`muted_video = $${params.length}`); }
  if (sets.length === 0) {
    const e = new Error('No mute fields provided'); e.code = 'BAD_INPUT'; throw e;
  }
  const r = await pool.query(
    `UPDATE ng_conf_participants SET ${sets.join(', ')} WHERE id=$1 AND room_id=$2 RETURNING *`,
    params
  );
  if (!r.rows[0]) throwNotFound();
  await logEvent(roomId, participantId, actor, audio === false || video === false ? 'unmuted' : 'muted', { audio, video }, pool);
  return r.rows[0];
}

// ─── Chat ────────────────────────────────────────────────────────────────────

async function sendChat(roomId, actor, { message, private_to_user_id } = {}, pool = getPool()) {
  const sanitizedMessage = String(message || '')
    .normalize('NFKC')
    .replace(/\0/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 2000);
  if (!sanitizedMessage) {
    const e = new Error('Empty message'); e.code = 'BAD_INPUT'; throw e;
  }
  const room = await assertRoomAccess(
    roomId,
    actor,
    { admittedOnly: true, allowAdmin: false },
    pool
  );
  if (!can(room.actor_participant_role, room.actor_permissions, 'send_chat')) {
    const error = new Error('Chat permission is not enabled for this participant');
    error.code = 'FORBIDDEN';
    throw error;
  }
  if (
    private_to_user_id &&
    !can(room.actor_participant_role, room.actor_permissions, 'send_private_dm')
  ) {
    const error = new Error('Private messaging permission is not enabled for this participant');
    error.code = 'FORBIDDEN';
    throw error;
  }
  if (private_to_user_id && !room.allow_private_dm) {
    const e = new Error('Private DMs disabled in this room'); e.code = 'FORBIDDEN'; throw e;
  }
  if (!room.allow_chat) {
    const e = new Error('Chat disabled in this room'); e.code = 'FORBIDDEN'; throw e;
  }
  const r = await pool.query(
    `INSERT INTO ng_conf_chat (room_id, sender_user_id, sender_display, message, private_to_user_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [roomId, actor.user_id, actor.display_name || 'Participant', sanitizedMessage, private_to_user_id || null]
  );
  if (private_to_user_id) {
    await logEvent(roomId, null, actor, 'dm_sent', { to: private_to_user_id }, pool);
  }
  return r.rows[0];
}

async function listChat(roomId, { user_id, since, limit = 200 } = {}, pool = getPool()) {
  await assertRoomAccess(
    roomId,
    { user_id, role: null },
    { admittedOnly: true, allowAdmin: false },
    pool
  );
  const where = [`room_id = $1`];
  const params = [roomId];
  if (since) { params.push(since); where.push(`created_at >= $${params.length}`); }
  // user_id controls private-DM visibility: a viewer only sees room-wide
  // messages + DMs to/from themselves.
  if (user_id) {
    params.push(user_id);
    where.push(`(private_to_user_id IS NULL OR private_to_user_id = $${params.length} OR sender_user_id = $${params.length})`);
  } else {
    where.push(`private_to_user_id IS NULL`);
  }
  params.push(Math.min(limit, 500));
  const sql = `
    SELECT * FROM ng_conf_chat
    WHERE ${where.join(' AND ')}
    ORDER BY created_at ASC
    LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

// ─── Invites (hashed token, parallels portal_access_tokens) ──────────────────

async function createInvite(roomId, actor, { role = 'observer', email, phone, display_name, ttlHours = 24 } = {}, pool = getPool()) {
  const room = await assertRoomAccess(roomId, actor, { admittedOnly: true, allowAdmin: false }, pool);
  const inviter = await getActorParticipant(roomId, actor.user_id, pool);
  const owner = String(room.host_user_id) === String(actor.user_id);
  role = coerceConfRole(role, 'observer');
  if (!owner && (!can(inviter?.role, inviter?.permissions_json, 'admit_others') || !canActOn(inviter.role, role) || Object.entries(effectivePermissions(role)).some(([key, value]) => value && !can(inviter.role, inviter.permissions_json, key)))) throw forbidden('Invitation exceeds current moderator authority');
  if (!Number.isFinite(Number(ttlHours)) || Number(ttlHours) <= 0 || Number(ttlHours) > 168) { const error = new Error('Invitation expiry must be within seven days'); error.code = 'BAD_INPUT'; throw error; }
  const raw = mintToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO ng_conf_invites
       (room_id, email, phone, role, display_name, token_hash, token_prefix, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [roomId, email || null, phone || null, role, display_name || null, hashToken(raw), raw.slice(0, 8), actor?.user_id || null, expiresAt]
  );
  await logEvent(roomId, null, actor, 'participant_invited', { role, email, phone }, pool);
  return { token: raw, prefix: raw.slice(0, 8), expires_at: expiresAt };
}

async function redeemInvite(rawToken, actor, pool = getPool()) {
  if (!actor?.user_id) throw forbidden('Sign in before redeeming a conference invitation');
  if (typeof rawToken !== 'string' || !rawToken || rawToken.length > 512) return null;
  return conferenceTransaction(pool, async client => {
    const inv = (await client.query(
      `SELECT * FROM ng_conf_invites WHERE token_hash=$1 AND revoked_at IS NULL
         AND used_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [hashToken(rawToken)]
    )).rows[0];
    if (!inv) return null;
    // Lock room before participant updates, consistent with join/moderation.
    const room = (await client.query('SELECT * FROM ng_conf_rooms WHERE id = $1 FOR UPDATE', [inv.room_id])).rows[0];
    if (!room) throwNotFound();
    if (!['scheduled', 'live'].includes(room.status)) throwInvalid('Conference is not open');
    await client.query(
      `INSERT INTO ng_conf_participants (room_id,user_id,display_name,role,status)
       VALUES ($1,$2,$3,$4,'invited') ON CONFLICT (room_id,user_id) DO UPDATE
       SET role=CASE WHEN ng_conf_participants.status IN ('removed','denied','left','invited') THEN EXCLUDED.role ELSE ng_conf_participants.role END,
           status=CASE WHEN ng_conf_participants.status IN ('removed','denied','left') THEN 'invited'::ng_conf_participant_status ELSE ng_conf_participants.status END,
           permissions_json=CASE WHEN ng_conf_participants.status IN ('removed','denied','left','invited') THEN '{}'::jsonb ELSE ng_conf_participants.permissions_json END`,
      [inv.room_id,actor.user_id,inv.display_name || actor.display_name || 'Participant',coerceConfRole(inv.role)]
    );
    const participant = await joinRoomInTransaction(inv.room_id,actor,{display_name:inv.display_name},client);
    const used = await client.query(
      `UPDATE ng_conf_invites SET used_at=NOW(),used_by_user=$2 WHERE id=$1
         AND used_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING id`, [inv.id,actor.user_id]
    );
    if (!used.rows.length) throwInvalid('Invitation expired or already redeemed');
    return participant;
  });
}

// ─── Events readout ──────────────────────────────────────────────────────────

async function listEvents(roomId, pool = getPool()) {
  const r = await pool.query(
    `SELECT * FROM ng_conf_events WHERE room_id = $1 ORDER BY created_at ASC LIMIT 1000`,
    [roomId]
  );
  return r.rows;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

function throwNotFound() { const e = new Error('Not found'); e.code = 'NOT_FOUND'; throw e; }
function throwInvalid(msg) { const e = new Error(msg); e.code = 'INVALID_STATE'; throw e; }

module.exports = {
  // constants
  PEER_MESH_LIMIT,
  ROOM_TRANSITIONS,
  // state machine
  isValidRoomTransition,
  coerceConfRole,
  suggestMediaServer,
  assessConferenceMediaReadiness,
  // rooms
  createRoom,
  getRoom,
  getRoomByCode,
  assertRoomAccess,
  listRooms,
  startRoom: lockedRoomOperation(startRoom, 2),
  endRoom: lockedRoomOperation(endRoom, 2, { allowClosed: true, revoke: true, end: true }),
  cancelRoom: lockedRoomOperation(cancelRoom, 3, { allowClosed: true, revoke: true, end: true }),
  // participants
  joinRoom,
  admitParticipant: lockedRoomOperation(admitParticipant, 3),
  denyParticipant: lockedRoomOperation(denyParticipant, 3),
  leaveRoom: lockedRoomOperation(leaveRoom, 3, { allowClosed: true, revoke: true }),
  removeParticipant: lockedRoomOperation(removeParticipant, 4, { revoke: true }),
  promoteParticipant: lockedRoomOperation(promoteParticipant, 4),
  listParticipants,
  // in-call
  raiseHand: lockedRoomOperation(raiseHand, 4),
  setMute: lockedRoomOperation(setMute, 4),
  // chat
  sendChat: lockedRoomOperation(sendChat, 3),
  listChat,
  // invites
  createInvite: lockedRoomOperation(createInvite, 3),
  redeemInvite,
  // events
  listEvents,
  // re-exports
  effectivePermissions,
  can,
  canActOn,
  ROLE_RANK,
  // exposed for tests
  genRoomCode,
  hashToken,
};
