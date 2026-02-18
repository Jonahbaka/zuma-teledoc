/**
 * ═══════════════════════════════════════════════════════════════
 *  HIVE BRIDGE — WebSocket connection to the DoctaRx Agent Hive
 * ═══════════════════════════════════════════════════════════════
 *
 * Manages real-time communication between the Next.js frontend
 * and the agent orchestrator backend via Socket.io.
 *
 * Every session is sandboxed (HIPAA). The bridge authenticates
 * with JWTs so agents know caller identity: patient, provider, admin.
 */

import { io } from 'socket.io-client';

const HIVE_NS = '/hive';

function getSocketUrl() {
  if (typeof window === 'undefined') return '';
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:8080';
  return window.location.origin;
}

export default class HiveBridge {
  constructor() {
    this.socket = null;
    this.sessionId = null;
    this.listeners = new Map();
    this.connected = false;
    this.agentName = null;
    this.role = null;
    this._messageQueue = [];
    this._reconnectAttempts = 0;
  }

  connect(token, { role, agentId, sessionMeta } = {}) {
    if (this.socket?.connected) return Promise.resolve(this);

    return new Promise((resolve, reject) => {
      const url = getSocketUrl();
      this.role = role;
      this.agentName = agentId;

      this.socket = io(url + HIVE_NS, {
        auth: { token },
        query: { role, agentId, ...sessionMeta },
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 8,
        reconnectionDelay: 2000,
        timeout: 15000,
      });

      this.socket.on('connect', () => {
        this.connected = true;
        this._reconnectAttempts = 0;
        this._flushQueue();
        resolve(this);
      });

      this.socket.on('hive:session', (data) => {
        this.sessionId = data.sessionId;
        this._emit('session', data);
      });

      this.socket.on('hive:message', (data) => this._emit('message', data));
      this.socket.on('hive:tool_call', (data) => this._emit('tool_call', data));
      this.socket.on('hive:tool_result', (data) => this._emit('tool_result', data));
      this.socket.on('hive:thinking', (data) => this._emit('thinking', data));
      this.socket.on('hive:error', (data) => this._emit('error', data));
      this.socket.on('hive:stream', (data) => this._emit('stream', data));
      this.socket.on('hive:status', (data) => this._emit('status', data));

      this.socket.on('disconnect', (reason) => {
        this.connected = false;
        this._emit('disconnect', { reason });
      });

      this.socket.on('connect_error', (err) => {
        this._reconnectAttempts++;
        if (this._reconnectAttempts >= 3) {
          this._emit('error', { message: err.message || 'Connection failed' });
          reject(err);
        }
      });
    });
  }

  sendMessage(content, { attachments, context } = {}) {
    const payload = {
      sessionId: this.sessionId,
      content,
      attachments: attachments || [],
      context: context || {},
      timestamp: Date.now(),
    };
    if (!this.connected) {
      this._messageQueue.push(payload);
      return;
    }
    this.socket.emit('hive:send', payload);
  }

  sendCommand(command, params = {}) {
    if (!this.connected) return;
    this.socket.emit('hive:command', { sessionId: this.sessionId, command, params });
  }

  killAgent() {
    this.sendCommand('kill');
  }

  pauseAll() {
    this.sendCommand('pause_all');
  }

  resumeAll() {
    this.sendCommand('resume_all');
  }

  getStatus() {
    return new Promise((resolve) => {
      if (!this.connected) return resolve(null);
      this.socket.emit('hive:status_req', {}, (data) => resolve(data));
    });
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.sessionId = null;
    this.listeners.clear();
  }

  _emit(event, data) {
    const fns = this.listeners.get(event);
    if (fns) fns.forEach((fn) => { try { fn(data); } catch {} });
  }

  _flushQueue() {
    while (this._messageQueue.length > 0) {
      const msg = this._messageQueue.shift();
      this.socket.emit('hive:send', msg);
    }
  }
}
