/**
 * Socket.io Real-Time Chat Service
 * Handles live messaging between patients and providers
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const logger = require('../middleware/logger');

// Store for online users and their socket IDs
const onlineUsers = new Map(); // userId -> { socketId, role, name, lastSeen }
const userSockets = new Map(); // socketId -> userId

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
    process.env.ENCRYPTION_KEY ||
    process.env.DATABASE_URL;
  if (!seed) return null;
  return crypto.createHmac('sha256', String(seed)).update(String(purpose)).digest('hex');
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
      console.log(`🔌 Socket disconnected: ${userName} - ${reason}`);
      
      // Update last seen
      const userData = onlineUsers.get(userId);
      if (userData) {
        userData.lastSeen = new Date();
      }
      
      // Remove from online users after a delay (to handle reconnections)
      setTimeout(() => {
        const currentSocket = onlineUsers.get(userId);
        if (currentSocket && currentSocket.socketId === socket.id) {
          onlineUsers.delete(userId);
          userSockets.delete(socket.id);
          
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
