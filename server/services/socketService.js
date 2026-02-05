/**
 * Socket.io Real-Time Chat Service
 * Handles live messaging between patients and providers
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../middleware/logger');

// Store for online users and their socket IDs
const onlineUsers = new Map(); // userId -> { socketId, role, name, lastSeen }
const userSockets = new Map(); // socketId -> userId

let io = null;

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

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId || decoded.id;
      socket.userRole = decoded.role;
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

  console.log('🔌 Socket.io initialized');
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
  isUserOnline,
  getOnlineUsers,
  getUserLastSeen
};
