'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import HiveBridge from '@/lib/hive_bridge';
import { useAuth } from './AuthProvider';

const HiveContext = createContext({
  bridge: null,
  connected: false,
  sessionId: null,
  messages: [],
  thinking: false,
  toolCalls: [],
  sendMessage: () => {},
  sendCommand: () => {},
  connectAgent: () => Promise.resolve(),
  disconnect: () => {},
  clearMessages: () => {},
  status: null,
});

export function HiveProvider({ children }) {
  const { user } = useAuth();
  const bridgeRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [toolCalls, setToolCalls] = useState([]);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    return () => {
      bridgeRef.current?.disconnect();
    };
  }, []);

  const connectAgent = useCallback(async (agentId, meta = {}) => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('accessToken');

    if (bridgeRef.current) {
      bridgeRef.current.disconnect();
    }

    const bridge = new HiveBridge();
    bridgeRef.current = bridge;

    bridge.on('session', (data) => setSessionId(data.sessionId));
    bridge.on('message', (data) => {
      setThinking(false);
      setMessages((prev) => [...prev, { role: 'agent', ...data, ts: Date.now() }]);
    });
    bridge.on('thinking', () => setThinking(true));
    bridge.on('tool_call', (data) => setToolCalls((prev) => [...prev, data]));
    bridge.on('tool_result', (data) => {
      setToolCalls((prev) => prev.map((tc) => tc.id === data.id ? { ...tc, result: data.result } : tc));
    });
    bridge.on('status', (data) => setStatus(data));
    bridge.on('error', (data) => {
      setThinking(false);
      setMessages((prev) => [...prev, { role: 'system', content: data.message || 'Hive error', ts: Date.now() }]);
    });
    bridge.on('disconnect', () => setConnected(false));

    try {
      await bridge.connect(token, {
        role: user?.role || 'guest',
        agentId,
        sessionMeta: { userId: user?.id, ...meta },
      });
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [user]);

  const sendMessage = useCallback((content, opts) => {
    if (!bridgeRef.current) return;
    setMessages((prev) => [...prev, { role: 'user', content, ts: Date.now() }]);
    setThinking(true);
    setToolCalls([]);
    bridgeRef.current.sendMessage(content, opts);
  }, []);

  const sendCommand = useCallback((cmd, params) => {
    bridgeRef.current?.sendCommand(cmd, params);
  }, []);

  const disconnect = useCallback(() => {
    bridgeRef.current?.disconnect();
    setConnected(false);
    setSessionId(null);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setToolCalls([]);
  }, []);

  return (
    <HiveContext.Provider value={{
      bridge: bridgeRef.current,
      connected,
      sessionId,
      messages,
      thinking,
      toolCalls,
      sendMessage,
      sendCommand,
      connectAgent,
      disconnect,
      clearMessages,
      status,
    }}>
      {children}
    </HiveContext.Provider>
  );
}

export function useHive() {
  return useContext(HiveContext);
}
