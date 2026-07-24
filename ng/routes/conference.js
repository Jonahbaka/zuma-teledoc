/**
 * ng/routes/conference.js
 * Multi-party conferencing control-plane API.
 * Mounted at /api/ng/conference (authenticated except /public/*).
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const svc = require('../services/conferencing/conferenceService');
const conferenceChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Conference chat rate limit exceeded' },
});

function actor(req) {
  return {
    user_id: req.user?.id || null,
    role:    req.user?.role || null,
    display_name: req.user?.display_name || req.user?.name || null,
  };
}

function handleError(res, err) {
  if (err.code === 'NOT_FOUND')      return res.status(404).json({ ok: false, error: err.message });
  if (err.code === 'FORBIDDEN')      return res.status(403).json({ ok: false, error: err.message });
  if (err.code === 'INVALID_STATE')  return res.status(409).json({ ok: false, error: err.message });
  if (err.code === 'MEDIA_NOT_READY') return res.status(409).json({ ok: false, error: err.message, readiness: err.readiness });
  if (err.code === 'ROOM_FULL')      return res.status(409).json({ ok: false, error: err.message });
  if (err.code === 'BAD_INPUT')      return res.status(400).json({ ok: false, error: err.message });
  console.error('[NG/Conf]', err);
  return res.status(500).json({ ok: false, error: err.message });
}

// ─── Public ──────────────────────────────────────────────────────────────────

const publicRouter = express.Router();
publicRouter.post('/redeem-invite', express.json(), async (req, res) => {
  try {
    const out = await svc.redeemInvite(req.body?.token, actor(req));
    if (!out) return res.status(404).json({ ok: false, error: 'Invalid or expired invite' });
    res.json({ ok: true, participant: out });
  } catch (e) { handleError(res, e); }
});
router.use('/public', publicRouter);

// ─── Rooms ───────────────────────────────────────────────────────────────────

router.get('/rooms', async (req, res) => {
  try {
    const rows = await svc.listRooms({
      host_user_id: ['admin', 'super_admin'].includes(req.user?.role)
        ? req.query.host_user_id
        : undefined,
      status: req.query.status,
      kind: req.query.kind,
      since: req.query.since,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      actor_user_id: req.user?.id,
      actor_role: req.user?.role,
    });
    res.json({ ok: true, rooms: rows });
  } catch (e) { handleError(res, e); }
});

router.post('/rooms', express.json(), async (req, res) => {
  try {
    if (!['provider', 'admin', 'super_admin', 'hospital_admin'].includes(req.user?.role)) {
      return res.status(403).json({ ok: false, error: 'Only authorized clinical hosts can create conference rooms' });
    }
    res.status(201).json({ ok: true, room: await svc.createRoom(req.body || {}, actor(req)) });
  }
  catch (e) { handleError(res, e); }
});

router.get('/rooms/code/:code', async (req, res) => {
  try {
    const r = await svc.getRoomByCode(req.params.code);
    if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
    await svc.assertRoomAccess(r.id, actor(req));
    res.json({ ok: true, room: r });
  } catch (e) { handleError(res, e); }
});

router.get('/rooms/:id', async (req, res) => {
  try {
    await svc.assertRoomAccess(req.params.id, actor(req));
    const r = await svc.getRoom(req.params.id);
    if (!r) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, room: r });
  } catch (e) { handleError(res, e); }
});

router.post('/rooms/:id/start', async (req, res) => {
  try { res.json({ ok: true, room: await svc.startRoom(req.params.id, actor(req)) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/end', async (req, res) => {
  try { res.json({ ok: true, room: await svc.endRoom(req.params.id, actor(req)) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/cancel', express.json(), async (req, res) => {
  try { res.json({ ok: true, room: await svc.cancelRoom(req.params.id, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});

// ─── Participants ────────────────────────────────────────────────────────────

router.get('/rooms/:id/participants', async (req, res) => {
  try {
    await svc.assertRoomAccess(req.params.id, actor(req));
    res.json({ ok: true, participants: await svc.listParticipants(req.params.id) });
  }
  catch (e) { handleError(res, e); }
});

router.post('/rooms/:id/join', express.json(), async (req, res) => {
  try {
    const p = await svc.joinRoom(req.params.id, actor(req), {
      display_name: req.body?.display_name,
      role: req.body?.role,
      user_agent: req.headers['user-agent'],
      client_ip: req.ip || null,
    });
    res.status(201).json({ ok: true, participant: p });
  } catch (e) { handleError(res, e); }
});

router.post('/rooms/:id/participants/:pid/admit', async (req, res) => {
  try { res.json({ ok: true, participant: await svc.admitParticipant(req.params.id, req.params.pid, actor(req)) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/participants/:pid/deny', async (req, res) => {
  try { res.json({ ok: true, participant: await svc.denyParticipant(req.params.id, req.params.pid, actor(req)) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/participants/:pid/leave', async (req, res) => {
  try { res.json({ ok: true, participant: await svc.leaveRoom(req.params.id, req.params.pid, actor(req)) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/participants/:pid/remove', express.json(), async (req, res) => {
  try { res.json({ ok: true, participant: await svc.removeParticipant(req.params.id, req.params.pid, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/participants/:pid/promote', express.json(), async (req, res) => {
  try { res.json({ ok: true, participant: await svc.promoteParticipant(req.params.id, req.params.pid, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/participants/:pid/hand', express.json(), async (req, res) => {
  try { res.json({ ok: true, participant: await svc.raiseHand(req.params.id, req.params.pid, !!req.body?.raised, actor(req)) }); }
  catch (e) { handleError(res, e); }
});
router.post('/rooms/:id/participants/:pid/mute', express.json(), async (req, res) => {
  try { res.json({ ok: true, participant: await svc.setMute(req.params.id, req.params.pid, req.body || {}, actor(req)) }); }
  catch (e) { handleError(res, e); }
});

// ─── Invites ─────────────────────────────────────────────────────────────────

router.post('/rooms/:id/invites', express.json(), async (req, res) => {
  try { res.status(201).json({ ok: true, ...(await svc.createInvite(req.params.id, actor(req), req.body || {})) }); }
  catch (e) { handleError(res, e); }
});

// ─── Chat ────────────────────────────────────────────────────────────────────

router.get('/rooms/:id/chat', async (req, res) => {
  try {
    res.json({ ok: true, messages: await svc.listChat(req.params.id, {
      user_id: req.user?.id || null,
      since: req.query.since,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }) });
  } catch (e) { handleError(res, e); }
});

router.post('/rooms/:id/chat', conferenceChatLimiter, express.json(), async (req, res) => {
  try { res.status(201).json({ ok: true, message: await svc.sendChat(req.params.id, actor(req), req.body || {}) }); }
  catch (e) { handleError(res, e); }
});

// ─── Events ──────────────────────────────────────────────────────────────────

router.get('/rooms/:id/events', async (req, res) => {
  try {
    await svc.assertRoomAccess(req.params.id, actor(req));
    res.json({ ok: true, events: await svc.listEvents(req.params.id) });
  }
  catch (e) { handleError(res, e); }
});

// ─── ICE servers (for client WebRTC config) ──────────────────────────────────
// Reuses the same env-var-driven config as 1:1 telehealth so a single TURN
// deployment serves both stacks. Falls back to Google STUN if no TURN is set.
router.get('/ice-servers', (req, res) => {
  try {
    const { getTelehealthIceServers } = require('../../server/services/telehealthSessionService');
    res.json({ ok: true, iceServers: getTelehealthIceServers() });
  } catch (e) { handleError(res, e); }
});

router.get('/media-readiness', (req, res) => {
  try {
    const readiness = svc.assessConferenceMediaReadiness({
      maxParticipants: req.query.max_participants ? Number(req.query.max_participants) : undefined,
      mediaServer: req.query.media_server,
    });
    res.json({ ok: true, readiness });
  } catch (e) { handleError(res, e); }
});

// ─── LiveKit Token ────────────────────────────────────────────────────────────
// Issues a LiveKit participant access token so the browser can join an SFU room.
// Returns 409 with code SFU_NOT_CONFIGURED when LiveKit env vars are absent.
router.post('/rooms/:id/token', express.json(), async (req, res) => {
  try {
    const room = await svc.assertRoomAccess(
      req.params.id,
      actor(req),
      { admittedOnly: true, allowAdmin: false }
    );

    const lk = require('../services/conferencing/livekitService');
    if (!lk.isLiveKitConfigured()) {
      return res.status(409).json({
        ok: false,
        code: 'SFU_NOT_CONFIGURED',
        error: 'LiveKit SFU is not configured on this server. Set NG_LIVEKIT_URL, NG_LIVEKIT_API_KEY, NG_LIVEKIT_API_SECRET.',
      });
    }

    const userId      = req.user.id;
    const displayName = (req.body?.display_name || req.user?.name || req.user?.display_name || 'Participant').slice(0, 80);

    const token      = lk.generateRoomToken(room.id, userId, displayName, { canPublish: true, canSubscribe: true });
    const { url }    = lk.getLiveKitConfig();

    res.json({ ok: true, token, livekitUrl: url, roomId: room.id, displayName });
  } catch (e) { handleError(res, e); }
});

// ─── Per-room media readiness ─────────────────────────────────────────────────
// Returns TURN + SFU readiness for a specific room's configuration.
router.get('/rooms/:id/media-status', async (req, res) => {
  try {
    await svc.assertRoomAccess(req.params.id, actor(req));
    const room = await svc.getRoom(req.params.id);
    if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });

    const readiness = svc.assessConferenceMediaReadiness({
      maxParticipants: room.max_participants,
      mediaServer:     room.media_server,
    });

    const lk = require('../services/conferencing/livekitService');
    res.json({
      ok: true,
      readiness,
      livekit: {
        configured: lk.isLiveKitConfigured(),
        url:        lk.isLiveKitConfigured() ? lk.getLiveKitConfig().url : null,
      },
    });
  } catch (e) { handleError(res, e); }
});

module.exports = router;
