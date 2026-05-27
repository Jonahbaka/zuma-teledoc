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

// Peer-mesh is sane up to ~3; above that the media plane must be SFU.
const PEER_MESH_LIMIT = 3;

function suggestMediaServer(maxParticipants) {
  if (!maxParticipants || maxParticipants <= PEER_MESH_LIMIT) return 'peer_mesh';
  // Use whatever the operator has configured; default to livekit
  return process.env.NG_CONF_DEFAULT_MEDIA_SERVER || 'livekit';
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

async function logEvent(roomId, participantId, actor, eventKind, payload, pool = getPool()) {
  await pool.query(
    `INSERT INTO ng_conf_events
       (room_id, participant_id, actor_user_id, actor_role, event_kind, payload_json)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::jsonb,'{}'::jsonb))`,
    [
      roomId, participantId || null,
      actor?.user_id || null, actor?.role || null,
      eventKind,
      payload ? JSON.stringify(payload) : null,
    ]
  );
}

// ─── Room CRUD ───────────────────────────────────────────────────────────────

async function createRoom(input, actor, pool = getPool()) {
  const code = genRoomCode();
  const maxParticipants = Math.max(2, Math.min(50, Number(input.max_participants || 10)));
  const mediaServer = input.media_server || suggestMediaServer(maxParticipants);

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
      input.metadata_json ? JSON.stringify(input.metadata_json) : null,
    ]
  );
  const room = r.rows[0];

  // Host self-enrolled as 'host' with status 'admitted'
  if (actor?.user_id) {
    await pool.query(
      `INSERT INTO ng_conf_participants
         (room_id, user_id, display_name, role, status, joined_at)
       VALUES ($1,$2,$3,'host','admitted',NOW())
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [room.id, actor.user_id, input.host_display_name || 'Host']
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

async function listRooms({ host_user_id, status, kind, since, limit = 50 } = {}, pool = getPool()) {
  const where = [];
  const params = [];
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
  const room = await getRoom(id, pool);
  if (!room) throwNotFound();
  if (!isValidRoomTransition(room.status, 'live')) throwInvalid(`Cannot start from ${room.status}`);
  const r = await pool.query(
    `UPDATE ng_conf_rooms SET status='live', started_at=NOW(), updated_at=NOW()
      WHERE id=$1 RETURNING *`, [id]
  );
  await logEvent(id, null, actor, 'room_started', null, pool);
  return r.rows[0];
}

async function endRoom(id, actor, pool = getPool()) {
  const room = await getRoom(id, pool);
  if (!room) throwNotFound();
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
  const room = await getRoom(id, pool);
  if (!room) throwNotFound();
  if (!isValidRoomTransition(room.status, 'cancelled')) throwInvalid(`Cannot cancel from ${room.status}`);
  const r = await pool.query(
    `UPDATE ng_conf_rooms SET status='cancelled', cancelled_at=NOW(),
            cancellation_reason=$2, updated_at=NOW() WHERE id=$1 RETURNING *`,
    [id, reason || null]
  );
  await logEvent(id, null, actor, 'room_cancelled', { reason }, pool);
  return r.rows[0];
}

// ─── Participants ────────────────────────────────────────────────────────────

async function joinRoom(roomId, actor, { display_name, role = 'observer', user_agent, client_ip } = {}, pool = getPool()) {
  const room = await getRoom(roomId, pool);
  if (!room) throwNotFound();
  if (room.status === 'cancelled' || room.status === 'ended') throwInvalid(`Room is ${room.status}`);

  // Count current admitted
  const c = await pool.query(
    `SELECT COUNT(*)::int AS n FROM ng_conf_participants WHERE room_id=$1 AND status='admitted'`,
    [roomId]
  );
  if (c.rows[0].n >= room.max_participants) {
    const e = new Error('Room is full');
    e.code = 'ROOM_FULL'; throw e;
  }

  const status = room.requires_waiting_room && role !== 'host' ? 'waiting' : 'admitted';
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
  if (!can(actorPart?.role, actorPart?.permissions_json, 'admit_others')) {
    const e = new Error('Insufficient permission to admit'); e.code = 'FORBIDDEN'; throw e;
  }

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
  if (!can(actorPart?.role, actorPart?.permissions_json, 'admit_others')) {
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
  const r = await pool.query(
    `UPDATE ng_conf_participants
        SET status='left', left_at=NOW(),
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
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  const target = (await pool.query(`SELECT role FROM ng_conf_participants WHERE id=$1`, [participantId])).rows[0];
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
  const actorPart = await getActorParticipant(roomId, actor?.user_id, pool);
  if (actorPart?.role !== 'host' && actorPart?.role !== 'consultant') {
    const e = new Error('Only host or consultant can promote'); e.code = 'FORBIDDEN'; throw e;
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
  // Self-mute is always allowed; muting others needs the permission.
  if (actor?.user_id) {
    const actorPart = await getActorParticipant(roomId, actor.user_id, pool);
    const self = actorPart?.id === participantId;
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

async function sendChat(roomId, actor, { message, private_to_user_id, sender_display } = {}, pool = getPool()) {
  if (!message || !String(message).trim()) {
    const e = new Error('Empty message'); e.code = 'BAD_INPUT'; throw e;
  }
  const room = await getRoom(roomId, pool);
  if (!room) throwNotFound();
  if (private_to_user_id && !room.allow_private_dm) {
    const e = new Error('Private DMs disabled in this room'); e.code = 'FORBIDDEN'; throw e;
  }
  if (!room.allow_chat) {
    const e = new Error('Chat disabled in this room'); e.code = 'FORBIDDEN'; throw e;
  }
  const r = await pool.query(
    `INSERT INTO ng_conf_chat (room_id, sender_user_id, sender_display, message, private_to_user_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [roomId, actor?.user_id || null, sender_display || actor?.display_name || 'Anon', String(message).slice(0, 2000), private_to_user_id || null]
  );
  if (private_to_user_id) {
    await logEvent(roomId, null, actor, 'dm_sent', { to: private_to_user_id }, pool);
  }
  return r.rows[0];
}

async function listChat(roomId, { user_id, since, limit = 200 } = {}, pool = getPool()) {
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
  if (!rawToken) return null;
  const hash = hashToken(rawToken);
  const r = await pool.query(
    `SELECT * FROM ng_conf_invites
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND used_at IS NULL
        AND expires_at > NOW()`,
    [hash]
  );
  const inv = r.rows[0];
  if (!inv) return null;
  await pool.query(
    `UPDATE ng_conf_invites SET used_at = NOW(), used_by_user = $2 WHERE id = $1`,
    [inv.id, actor?.user_id || null]
  );
  // Auto-join as the invited role
  return joinRoom(inv.room_id, actor, { display_name: inv.display_name, role: inv.role }, pool);
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
  suggestMediaServer,
  // rooms
  createRoom,
  getRoom,
  getRoomByCode,
  listRooms,
  startRoom,
  endRoom,
  cancelRoom,
  // participants
  joinRoom,
  admitParticipant,
  denyParticipant,
  leaveRoom,
  removeParticipant,
  promoteParticipant,
  listParticipants,
  // in-call
  raiseHand,
  setMute,
  // chat
  sendChat,
  listChat,
  // invites
  createInvite,
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
