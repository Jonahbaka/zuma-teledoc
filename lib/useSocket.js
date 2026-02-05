'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '@/components/providers/AuthProvider';

/**
 * Custom hook for Socket.io real-time chat functionality
 */
export function useSocket() {
  const { user, token } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState({}); // { conversationId: { userId, userName } }
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef({});

  // Initialize socket connection
  useEffect(() => {
    if (!user || !token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // Determine socket URL (same as API server)
    const socketUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 
                      (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080');

    console.log('🔌 Connecting to socket:', socketUrl);

    const newSocket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    // Connection events
    newSocket.on('connect', () => {
      console.log('🔌 Socket connected:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      setIsConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('🔌 Socket connection error:', error.message);
      setIsConnected(false);
    });

    // Online users events
    newSocket.on('users:online', (users) => {
      setOnlineUsers(users);
    });

    newSocket.on('user:online', (userData) => {
      setOnlineUsers(prev => {
        const exists = prev.find(u => u.userId === userData.userId);
        if (exists) return prev;
        return [...prev, userData];
      });
    });

    newSocket.on('user:offline', ({ userId }) => {
      setOnlineUsers(prev => prev.filter(u => u.userId !== userId));
    });

    // Typing indicator events
    newSocket.on('typing:update', ({ conversationId, userId, userName, isTyping }) => {
      setTypingUsers(prev => {
        if (isTyping) {
          return { ...prev, [conversationId]: { userId, userName } };
        } else {
          const updated = { ...prev };
          delete updated[conversationId];
          return updated;
        }
      });
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      console.log('🔌 Cleaning up socket');
      newSocket.disconnect();
    };
  }, [user, token]);

  // Join a conversation room
  const joinConversation = useCallback((conversationId) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('conversation:join', conversationId);
    }
  }, [isConnected]);

  // Leave a conversation room
  const leaveConversation = useCallback((conversationId) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('conversation:leave', conversationId);
    }
  }, [isConnected]);

  // Send typing indicator
  const sendTypingStart = useCallback((conversationId, recipientId) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('typing:start', { conversationId, recipientId });
      
      // Clear existing timeout
      if (typingTimeoutRef.current[conversationId]) {
        clearTimeout(typingTimeoutRef.current[conversationId]);
      }
      
      // Auto-stop typing after 3 seconds of inactivity
      typingTimeoutRef.current[conversationId] = setTimeout(() => {
        sendTypingStop(conversationId, recipientId);
      }, 3000);
    }
  }, [isConnected]);

  const sendTypingStop = useCallback((conversationId, recipientId) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('typing:stop', { conversationId, recipientId });
      
      // Clear timeout
      if (typingTimeoutRef.current[conversationId]) {
        clearTimeout(typingTimeoutRef.current[conversationId]);
        delete typingTimeoutRef.current[conversationId];
      }
    }
  }, [isConnected]);

  // Send read receipt
  const sendReadReceipt = useCallback((messageId, conversationId, senderId) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('message:read', { messageId, conversationId, senderId });
    }
  }, [isConnected]);

  // Subscribe to new messages
  const onNewMessage = useCallback((callback) => {
    if (socketRef.current) {
      socketRef.current.on('message:new', callback);
      return () => socketRef.current?.off('message:new', callback);
    }
    return () => {};
  }, []);

  // Subscribe to message read receipts
  const onMessageRead = useCallback((callback) => {
    if (socketRef.current) {
      socketRef.current.on('message:read', callback);
      return () => socketRef.current?.off('message:read', callback);
    }
    return () => {};
  }, []);

  // Subscribe to message notifications
  const onMessageNotification = useCallback((callback) => {
    if (socketRef.current) {
      socketRef.current.on('notification:message', callback);
      return () => socketRef.current?.off('notification:message', callback);
    }
    return () => {};
  }, []);

  // Check if a specific user is online
  const isUserOnline = useCallback((userId) => {
    return onlineUsers.some(u => u.userId === userId);
  }, [onlineUsers]);

  // Get typing user for a conversation
  const getTypingUser = useCallback((conversationId) => {
    return typingUsers[conversationId] || null;
  }, [typingUsers]);

  return {
    socket,
    isConnected,
    onlineUsers,
    typingUsers,
    joinConversation,
    leaveConversation,
    sendTypingStart,
    sendTypingStop,
    sendReadReceipt,
    onNewMessage,
    onMessageRead,
    onMessageNotification,
    isUserOnline,
    getTypingUser
  };
}

export default useSocket;
