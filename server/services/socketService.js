/**
 * Socket.io Real-Time Chat Service
 * Handles live messaging between patients and providers
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../middleware/logger');
const {
  buildParticipantPayload,
  ensureAppointmentRoomId,
  getAuthorizedVideoAppointment,
  getTelehealthIceServers
} = require('./telehealthSessionService');

// Store for online users and their socket IDs
const onlineUsers = new Map(); // userId -> { socketId, role, name, lastSeen }
const userSockets = new Map(); // socketId -> userId
const telehealthRooms = new Map(); // roomId -> Map(socketId, participant)
const telehealthSocketMeta = new Map(); // socketId -> { appointmentId, roomId, roomKey, participant }

// Multi-party NG conferencing — separate maps so telehealth + conference
// don't share state. Each conference room is keyed by ng_conf_rooms.id.
const conferenceRooms = new Map(); // roomId -> Map(socketId, participant)
const conferenceSocketMeta = new Map(); // socketId -> { roomId, roomKey, participant }
const getConferenceRoomKey = (roomId) => `conference:${roomId}`;

let io = null;

const normalizeRole = (role) => String(role || '').trim().toLowerCase();
const roleAliasMap = {
  administrator: 'admin',
  superadmin: 'super_admin',
  'super-admin': 'super_admin'
};
const canonicalRole = (role) => roleAliasMap[normalizeRole(role)] || normalizeRole(role);

const deriveStableJwtSecret = (purpose) => {
  const seed =
    process.env.JWT_SECRET ||
    process.env.JWT_DERIVATION_SEED ||
    process.env.SESSION_SECRET ||
    process.env.ENCRYPTION_KEY;
    // DATABASE_URL deliberately excluded — it is not a cryptographic secret and
    // leaks via logs/CI/Sentry; using it to sign tokens would allow forgery.
    // Must match server/middleware/auth.js so socket + HTTP auth share a key.
  if (!seed) return null;
  return crypto.createHmac('sha256', String(seed)).update(String(purpose)).digest('hex');
};

const getTelehealthRoomKey = (roomId) => `telehealth:${roomId}`;

const emitSocketAck = (ack, payload) => {
  if (typeof ack === 'function') {
    ack(payload);
  }
};

const removeTelehealthMembership = (socket, { emitLeft = true } = {}) => {
  const session = telehealthSocketMeta.get(socket.id);
  if (!session) {
    return;
  }

  const roomParticipants = telehealthRooms.get(session.roomId);
  if (roomParticipants) {
    roomParticipants.delete(socket.id);
    if (roomParticipants.size === 0) {
      telehealthRooms.delete(session.roomId);
    }
  }

  socket.leave(session.roomKey);
  telehealthSocketMeta.delete(socket.id);

  if (emitLeft && io) {
    socket.to(session.roomKey).emit('telehealth:participant-left', {
      appointmentId: session.appointmentId,
      roomId: session.roomId,
      participant: session.participant
    });
  }
};

// ── NG Conference helpers ────────────────────────────────────────────────────

const removeConferenceMembership = (socket, { emitLeft = true } = {}) => {
  const session = conferenceSocketMeta.get(socket.id);
  if (!session) return;

  const roomParticipants = conferenceRooms.get(session.roomId);
  if (roomParticipants) {
    roomParticipants.delete(socket.id);
    if (roomParticipants.size === 0) {
      conferenceRooms.delete(session.roomId);
    }
  }

  socket.leave(session.roomKey);
  conferenceSocketMeta.delete(socket.id);

  if (emitLeft && io) {
    socket.to(session.roomKey).emit('conference:participant-left', {
      roomId: session.roomId,
      participant: session.participant,
    });
  }
};

const disconnectDuplicateTelehealthParticipant = (roomId, currentSocketId, userId) => {
  const roomParticipants = telehealthRooms.get(roomId);
  if (!roomParticipants) {
    return;
  }

  for (const [socketId] of roomParticipants.entries()) {
    if (socketId === currentSocketId) {
      continue;
    }

    const existingSession = telehealthSocketMeta.get(socketId);
    if (existingSession?.participant?.userId !== userId) {
      continue;
    }

    const existingSocket = io?.sockets?.sockets?.get(socketId);
    if (existingSocket) {
      existingSocket.emit('telehealth:replaced', {
        appointmentId: existingSession.appointmentId,
        roomId: existingSession.roomId
      });
      removeTelehealthMembership(existingSocket, { emitLeft: true });
      existingSocket.disconnect(true);
    } else {
      roomParticipants.delete(socketId);
      telehealthSocketMeta.delete(socketId);
    }
  }
};

/**
 * Initialize Socket.io with the HTTP server
 */
const initializeSocket = (httpServer) => {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://doctarx.com';
  
  io = new Server(httpServer, {
    cors: {
      origin: [
        appUrl,
        'http://localhost:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'https://doctarx.com',
        'https://www.doctarx.com'
      ],
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      // Use same secret as main auth system
      const accessSecret =
        process.env.JWT_ACCESS_SECRET ||
        deriveStableJwtSecret('doctarx.jwt.access.v1') ||
        process.env.JWT_SECRET ||
        global.__JWT_ACCESS_SECRET;
      const decoded = jwt.verify(token, accessSecret);
      socket.userId = decoded.userId || decoded.id;
      socket.userRole = canonicalRole(decoded.role);
      socket.userName = decoded.name || `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim();
      
      next();
    } catch (error) {
      logger.warn('Socket authentication failed', { error: error.message });
      next(new Error('Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    const userId = socket.userId;
    const userRole = socket.userRole;
    const userName = socket.userName;

    console.log(`🔌 Socket connected: ${userName} (${userRole}) - ${socket.id}`);

    // Register user as online
    onlineUsers.set(userId, {
      socketId: socket.id,
      role: userRole,
      name: userName,
      lastSeen: new Date()
    });
    userSockets.set(socket.id, userId);

    // Notify others that user is online
    socket.broadcast.emit('user:online', {
      userId,
      role: userRole,
      name: userName
    });

    // Send current online users to the connected user
    const onlineList = Array.from(onlineUsers.entries()).map(([id, data]) => ({
      userId: id,
      ...data
    }));
    socket.emit('users:online', onlineList);

    // Join personal room for direct messages
    socket.join(`user:${userId}`);

    // Admin room for Agent Ops real-time telemetry
    if (userRole === 'admin' || userRole === 'super_admin') {
      socket.join('agent-ops:admins');
    }

    /**
     * Handle joining a conversation room
     */
    socket.on('conversation:join', (conversationId) => {
      socket.join(`conversation:${conversationId}`);
      console.log(`👥 ${userName} joined conversation: ${conversationId}`);
    });

    /**
     * Handle leaving a conversation room
     */
    socket.on('conversation:leave', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`👋 ${userName} left conversation: ${conversationId}`);
    });

    /**
     * Handle typing indicator
     */
    socket.on('typing:start', ({ conversationId, recipientId }) => {
      // Emit to the conversation room
      socket.to(`conversation:${conversationId}`).emit('typing:update', {
        conversationId,
        userId,
        userName,
        isTyping: true
      });
      
      // Also emit directly to the recipient
      socket.to(`user:${recipientId}`).emit('typing:update', {
        conversationId,
        userId,
        userName,
        isTyping: true
      });
    });

    socket.on('typing:stop', ({ conversationId, recipientId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing:update', {
        conversationId,
        userId,
        userName,
        isTyping: false
      });
      
      socket.to(`user:${recipientId}`).emit('typing:update', {
        conversationId,
        userId,
        userName,
        isTyping: false
      });
    });

    /**
     * Handle message read receipts
     */
    socket.on('message:read', ({ messageId, conversationId, senderId }) => {
      // Notify the sender that their message was read
      socket.to(`user:${senderId}`).emit('message:read', {
        messageId,
        conversationId,
        readBy: userId,
        readAt: new Date()
      });
    });

    /**
     * Handle new message (for real-time delivery)
     */
    socket.on('message:send', (messageData) => {
      const { conversationId, recipientId, message } = messageData;
      
      // Emit to conversation room
      socket.to(`conversation:${conversationId}`).emit('message:new', {
        ...message,
        senderName: userName,
        senderId: userId
      });
      
      // Also emit directly to recipient's personal room
      socket.to(`user:${recipientId}`).emit('message:new', {
        ...message,
        senderName: userName,
        senderId: userId
      });
    });

    socket.on('telehealth:join', async (payload = {}, ack) => {
      try {
        const appointment = await getAuthorizedVideoAppointment(payload.appointmentId, {
          id: socket.userId,
          role: socket.userRole,
          name: socket.userName
        });
        const roomId = await ensureAppointmentRoomId(appointment.id, appointment.roomId);
        const roomKey = getTelehealthRoomKey(roomId);

        removeTelehealthMembership(socket, { emitLeft: true });
        disconnectDuplicateTelehealthParticipant(roomId, socket.id, socket.userId);

        const roomParticipants = telehealthRooms.get(roomId) || new Map();
        const participant = buildParticipantPayload({
          appointment,
          user: {
            id: socket.userId,
            role: socket.userRole,
            name: socket.userName
          },
          socketId: socket.id,
          displayName: payload.displayName
        });
        const participants = Array.from(roomParticipants.values());

        roomParticipants.set(socket.id, participant);
        telehealthRooms.set(roomId, roomParticipants);
        telehealthSocketMeta.set(socket.id, {
          appointmentId: appointment.id,
          roomId,
          roomKey,
          participant
        });

        socket.join(roomKey);

        const response = {
          ok: true,
          appointmentId: appointment.id,
          roomId,
          participant,
          participants,
          iceServers: getTelehealthIceServers()
        };

        socket.emit('telehealth:joined', response);
        socket.to(roomKey).emit('telehealth:participant-joined', {
          appointmentId: appointment.id,
          roomId,
          participant
        });
        emitSocketAck(ack, response);
      } catch (error) {
        logger.warn('Telehealth join failed', {
          userId: socket.userId,
          appointmentId: payload?.appointmentId,
          error: error.message
        });
        emitSocketAck(ack, { ok: false, error: error.message || 'Failed to join video room' });
      }
    });

    socket.on('telehealth:signal', (payload = {}, ack) => {
      const session = telehealthSocketMeta.get(socket.id);

      if (!session) {
        emitSocketAck(ack, { ok: false, error: 'Video session not initialized' });
        return;
      }

      const targetSocketId = payload.toSocketId;
      const signalType = String(payload.signalType || '').trim();
      const roomParticipants = telehealthRooms.get(session.roomId);

      if (!targetSocketId || !roomParticipants?.has(targetSocketId)) {
        emitSocketAck(ack, { ok: false, error: 'Participant unavailable' });
        return;
      }

      if (!['offer', 'answer', 'ice-candidate'].includes(signalType)) {
        emitSocketAck(ack, { ok: false, error: 'Unsupported signal type' });
        return;
      }

      io.to(targetSocketId).emit('telehealth:signal', {
        appointmentId: session.appointmentId,
        roomId: session.roomId,
        fromSocketId: socket.id,
        participant: session.participant,
        signalType,
        signal: payload.signal || null
      });

      emitSocketAck(ack, { ok: true });
    });

    socket.on('telehealth:leave', (_, ack) => {
      removeTelehealthMembership(socket, { emitLeft: true });
      emitSocketAck(ack, { ok: true });
    });

    /**
     * NG Multi-party conferencing signaling
     *   conference:join     — validate participant against ng_conf_participants, return ICE
     *   conference:signal   — relay WebRTC offer/answer/ice-candidate to a peer socket in the room
     *   conference:leave    — leave the conference room
     */
    socket.on('conference:join', async (payload = {}, ack) => {
      try {
        const roomId = String(payload.roomId || '').trim();
        if (!roomId) {
          return emitSocketAck(ack, { ok: false, error: 'roomId required' });
        }

        // Validate via Neon — must be an admitted participant of this room
        const db = require('../db');
        const { rows: rRows } = await db.query(
          `SELECT id, status, max_participants FROM ng_conf_rooms WHERE id = $1`,
          [roomId]
        );
        if (!rRows.length) {
          return emitSocketAck(ack, { ok: false, error: 'Room not found' });
        }
        const room = rRows[0];
        if (room.status === 'ended' || room.status === 'cancelled') {
          return emitSocketAck(ack, { ok: false, error: `Room is ${room.status}` });
        }

        const { rows: pRows } = await db.query(
          `SELECT id, role, status, display_name, permissions_json
             FROM ng_conf_participants
            WHERE room_id = $1 AND user_id = $2`,
          [roomId, socket.userId]
        );
        if (!pRows.length || pRows[0].status !== 'admitted') {
          return emitSocketAck(ack, { ok: false, error: 'Not admitted to this room' });
        }

        const participantRow = pRows[0];
        const participant = {
          socketId: socket.id,
          participantId: participantRow.id,
          userId: socket.userId,
          role: participantRow.role,
          name: participantRow.display_name || socket.userName || 'Participant',
          joinedAt: new Date().toISOString(),
        };

        const roomKey = getConferenceRoomKey(roomId);

        // Clean up any prior membership
        removeConferenceMembership(socket, { emitLeft: true });

        const roomParticipants = conferenceRooms.get(roomId) || new Map();
        const peers = Array.from(roomParticipants.values());
        roomParticipants.set(socket.id, participant);
        conferenceRooms.set(roomId, roomParticipants);
        conferenceSocketMeta.set(socket.id, { roomId, roomKey, participant });
        socket.join(roomKey);

        const response = {
          ok: true,
          roomId,
          participant,
          participants: peers,           // peers already in the room (for mesh new-comer)
          iceServers: getTelehealthIceServers(),
        };
        socket.emit('conference:joined', response);
        socket.to(roomKey).emit('conference:participant-joined', { roomId, participant });
        emitSocketAck(ack, response);
      } catch (error) {
        logger.warn('Conference join failed', {
          userId: socket.userId,
          roomId: payload?.roomId,
          error: error.message,
        });
        emitSocketAck(ack, { ok: false, error: error.message || 'Failed to join conference' });
      }
    });

    socket.on('conference:signal', (payload = {}, ack) => {
      const session = conferenceSocketMeta.get(socket.id);
      if (!session) {
        return emitSocketAck(ack, { ok: false, error: 'Conference session not initialized' });
      }
      const targetSocketId = payload.toSocketId;
      const signalType = String(payload.signalType || '').trim();
      const roomParticipants = conferenceRooms.get(session.roomId);

      if (!targetSocketId || !roomParticipants?.has(targetSocketId)) {
        return emitSocketAck(ack, { ok: false, error: 'Peer unavailable' });
      }
      if (!['offer', 'answer', 'ice-candidate'].includes(signalType)) {
        return emitSocketAck(ack, { ok: false, error: 'Unsupported signal type' });
      }

      io.to(targetSocketId).emit('conference:signal', {
        roomId: session.roomId,
        fromSocketId: socket.id,
        participant: session.participant,
        signalType,
        signal: payload.signal || null,
      });
      emitSocketAck(ack, { ok: true });
    });

    socket.on('conference:leave', (_, ack) => {
      removeConferenceMembership(socket, { emitLeft: true });
      emitSocketAck(ack, { ok: true });
    });

    /**
     * Agent Ops live stream subscription (admin only)
     */
    socket.on('agent-ops:subscribe', () => {
      if (socket.userRole !== 'admin' && socket.userRole !== 'super_admin') {
        socket.emit('agent-ops:error', { message: 'Unauthorized' });
        return;
      }
      socket.join('agent-ops:admins');
      socket.emit('agent-ops:subscribed', { ok: true, at: new Date().toISOString() });
    });

    /**
     * Handle disconnect
     */
    socket.on('disconnect', (reason) => {
      removeTelehealthMembership(socket, { emitLeft: true });
      removeConferenceMembership(socket, { emitLeft: true });
      console.log(`🔌 Socket disconnected: ${userName} - ${reason}`);
      
      // Update last seen
      const userData = onlineUsers.get(userId);
      if (userData) {
        userData.lastSeen = new Date();
      }
      
      // This socket id is gone regardless of reconnection state — drop it now,
      // otherwise on multi-tab/rapid-reconnect the guard below (which matches the
      // *current* socket) skips it and the old id leaks in userSockets forever.
      userSockets.delete(socket.id);

      // Remove from online users after a delay (to handle reconnections)
      setTimeout(() => {
        const currentSocket = onlineUsers.get(userId);
        if (currentSocket && currentSocket.socketId === socket.id) {
          onlineUsers.delete(userId);

          // Notify others that user went offline
          socket.broadcast.emit('user:offline', {
            userId,
            lastSeen: new Date()
          });
        }
      }, 5000); // 5 second grace period for reconnection
    });

    /**
     * Handle errors
     */
    socket.on('error', (error) => {
      logger.error('Socket error', { userId, error: error.message });
    });
  });

  // ═══ HIVE NAMESPACE — Dedicated real-time channel for agent sessions ═══
  const hiveNs = io.of('/hive');

  hiveNs.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        socket.hiveRole = 'guest';
        return next();
      }
      const accessSecret =
        process.env.JWT_ACCESS_SECRET ||
        deriveStableJwtSecret('doctarx.jwt.access.v1') ||
        process.env.JWT_SECRET ||
        global.__JWT_ACCESS_SECRET;
      const decoded = jwt.verify(token, accessSecret);
      socket.userId = decoded.userId || decoded.id;
      socket.userRole = canonicalRole(decoded.role);
      socket.userName = decoded.name || `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim();
      socket.hiveRole = socket.userRole;
      next();
    } catch {
      socket.hiveRole = 'guest';
      next();
    }
  });

  hiveNs.on('connection', (hiveSocket) => {
    const agentId = hiveSocket.handshake.query.agentId || 'nova';
    const sessionId = `hive_ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    hiveSocket.hiveSessionId = sessionId;

    hiveSocket.emit('hive:session', { sessionId, agentId, role: hiveSocket.hiveRole });
    hiveSocket.join(`hive:session:${sessionId}`);

    if (hiveSocket.userRole === 'admin' || hiveSocket.userRole === 'super_admin') {
      hiveSocket.join('hive:overwatch');
    }

    hiveSocket.on('hive:send', async (payload) => {
      try {
        const { content } = payload;
        if (!content) return;

        hiveSocket.emit('hive:thinking', { sessionId });

        let agentLoop, llmService;
        try { agentLoop = require('../agent-orchestrator/agent-loop'); } catch {}
        try { llmService = require('../agent-orchestrator/gemini-llm'); } catch {}

        const AGENTS = {
          nova:        { type: 'concierge', name: 'Nurse Nova', persona: 'Public concierge. Answer FAQs, guide signups. No patient data access.' },
          triage:      { type: 'triage',    name: 'Triage Bot', persona: 'Symptom assessor. Ask questions, rate urgency 1-5, advise.' },
          hippocrates: { type: 'clinical',  name: 'Hippocrates', persona: 'Clinical co-pilot. SOAP notes, labs, drug interactions.' },
          overwatch:   { type: 'ceo',       name: 'The Conductor', persona: 'Hive monitor. Platform stats, flagged items, ops.' },
        };
        const agent = AGENTS[agentId] || AGENTS.nova;
        let response;

        if (agentLoop?.runAgent) {
          response = await agentLoop.runAgent(agent.type, agent.name, agent.persona, content, { llmService });
        } else if (llmService?.callLLM) {
          const text = await llmService.callLLM(agent.persona, content);
          response = { text, toolCalls: [], iterations: 0 };
        } else {
          response = { text: `${agent.name} is starting up. Try again in a moment.`, toolCalls: [], iterations: 0 };
        }

        if (response.toolCalls?.length) {
          for (const tc of response.toolCalls) {
            hiveSocket.emit('hive:tool_call', { id: tc.id, tool: tc.tool, input: tc.input });
            hiveSocket.emit('hive:tool_result', { id: tc.id, result: tc.result });
          }
        }

        hiveSocket.emit('hive:message', { content: response.text, agentId, agentName: agent.name, toolCalls: response.toolCalls || [], ts: Date.now() });

        // Broadcast to overwatch for monitoring
        hiveNs.to('hive:overwatch').emit('hive:status', {
          type: 'message_completed',
          sessionId,
          agentId,
          messageLength: response.text?.length || 0,
          toolCallCount: response.toolCalls?.length || 0,
          ts: Date.now(),
        });
      } catch (err) {
        hiveSocket.emit('hive:error', { message: err.message || 'Agent error' });
      }
    });

    hiveSocket.on('hive:command', (payload) => {
      const { command } = payload;
      if (command === 'kill') {
        hiveSocket.emit('hive:status', { type: 'session_killed', sessionId });
        hiveSocket.disconnect();
      }
    });

    hiveSocket.on('hive:status_req', (_, cb) => {
      if (typeof cb === 'function') {
        cb({ sessionId, agentId, role: hiveSocket.hiveRole, connected: true });
      }
    });

    hiveSocket.on('disconnect', () => {
      hiveNs.to('hive:overwatch').emit('hive:status', { type: 'session_ended', sessionId, agentId, ts: Date.now() });
    });
  });

  console.log('🔌 Socket.io initialized (+ /hive namespace)');
  return io;
};

/**
 * Get the Socket.io instance
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

/**
 * Emit a new message to a conversation (called from message routes)
 */
const emitNewMessage = (conversationId, recipientId, message) => {
  if (!io) return;
  
  // Emit to conversation room
  io.to(`conversation:${conversationId}`).emit('message:new', message);
  
  // Also emit to recipient's personal room
  io.to(`user:${recipientId}`).emit('message:new', message);
  
  // Emit notification for unread count update
  io.to(`user:${recipientId}`).emit('notification:message', {
    conversationId,
    messageId: message.id,
    senderName: message.senderName,
    preview: message.content?.substring(0, 50) || 'New message'
  });
};

/**
 * Emit Agent Ops event to admin subscribers
 */
const emitAgentOpsEvent = (payload) => {
  if (!io) return;
  io.to('agent-ops:admins').emit('agent-ops:event', payload);
};

/**
 * Check if a user is online
 */
const isUserOnline = (userId) => {
  return onlineUsers.has(userId);
};

/**
 * Get online users
 */
const getOnlineUsers = () => {
  return Array.from(onlineUsers.entries()).map(([id, data]) => ({
    userId: id,
    ...data
  }));
};

/**
 * Get user's last seen time
 */
const getUserLastSeen = (userId) => {
  const user = onlineUsers.get(userId);
  return user?.lastSeen || null;
};

module.exports = {
  initializeSocket,
  getIO,
  emitNewMessage,
  emitAgentOpsEvent,
  isUserOnline,
  getOnlineUsers,
  getUserLastSeen
};
