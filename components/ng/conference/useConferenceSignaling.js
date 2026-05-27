'use client';

/**
 * components/ng/conference/useConferenceSignaling.js
 *
 * React hook that joins an ng_conf_rooms room via socket.io, exchanges
 * WebRTC signaling (offer/answer/ice-candidate) with every other peer in
 * the room (mesh topology up to ~3 participants — for >3 the operator
 * should plug in an SFU and have the server emit aggregated streams).
 *
 * Reuses the same socket.io namespace + JWT that the existing 1:1
 * telehealth stack uses (`server/services/socketService.js`).
 */

import { useEffect, useRef, useState, useCallback } from 'react';

let ioPromise = null;
function loadSocketIO() {
  if (ioPromise) return ioPromise;
  ioPromise = import('socket.io-client').then(m => m.io || m.default);
  return ioPromise;
}

function getAuthToken() {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function fetchIceServers() {
  try {
    const r = await fetch('/api/ng/conference/ice-servers', { credentials: 'include' });
    if (!r.ok) return [];
    const b = await r.json();
    return b?.iceServers || [];
  } catch { return []; }
}

export function useConferenceSignaling({ roomId, enabled = true, displayName = 'Participant' }) {
  const [state, setState] = useState({
    phase: 'idle',           // idle | connecting | joined | error
    error: null,
    self: null,
    peers: [],               // [{ socketId, userId, role, name }]
    streams: {},             // socketId -> MediaStream
  });
  const socketRef    = useRef(null);
  const pcByPeer     = useRef(new Map()); // socketId -> RTCPeerConnection
  const localStream  = useRef(null);
  const iceServers   = useRef([]);

  // ── Establish local media ─────────────────────────────────────────────────
  const acquireLocalMedia = useCallback(async () => {
    if (localStream.current) return localStream.current;
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch {
      // Audio-only fallback for low-bandwidth / no-camera contexts
      localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    return localStream.current;
  }, []);

  // ── Build a peer connection toward a given peer ───────────────────────────
  const buildPeer = useCallback((peerSocketId, isInitiator) => {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current });

    // Pump local tracks to this peer
    if (localStream.current) {
      for (const track of localStream.current.getTracks()) {
        pc.addTrack(track, localStream.current);
      }
    }

    pc.ontrack = (ev) => {
      setState(s => ({ ...s, streams: { ...s.streams, [peerSocketId]: ev.streams[0] } }));
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && socketRef.current) {
        socketRef.current.emit('conference:signal', {
          toSocketId: peerSocketId,
          signalType: 'ice-candidate',
          signal: ev.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        // Let server-emitted participant-left clean up
      }
    };

    pcByPeer.current.set(peerSocketId, pc);

    if (isInitiator) {
      // Existing peers in room — new joiner initiates offers
      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('conference:signal', {
          toSocketId: peerSocketId,
          signalType: 'offer',
          signal: { sdp: offer.sdp, type: offer.type },
        });
      })().catch(e => console.error('offer failed', e));
    }

    return pc;
  }, []);

  // ── Main connect lifecycle ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !roomId) return;
    let cancelled = false;

    (async () => {
      setState(s => ({ ...s, phase: 'connecting', error: null }));

      try {
        iceServers.current = await fetchIceServers();
        await acquireLocalMedia();
        const io = await loadSocketIO();
        if (cancelled) return;

        const token = getAuthToken();
        const sock = io('/', {
          path: '/socket.io',
          transports: ['websocket', 'polling'],
          auth: token ? { token } : undefined,
          withCredentials: true,
        });
        socketRef.current = sock;

        sock.on('connect_error', (err) => {
          setState(s => ({ ...s, phase: 'error', error: err.message || 'socket connect error' }));
        });

        sock.on('connect', () => {
          sock.emit('conference:join', { roomId, displayName }, (resp) => {
            if (!resp?.ok) {
              setState(s => ({ ...s, phase: 'error', error: resp?.error || 'Join rejected' }));
              return;
            }
            setState(s => ({
              ...s,
              phase: 'joined',
              self: resp.participant,
              peers: resp.participants || [],
            }));
            // Initiate offers toward every existing peer (mesh)
            for (const peer of resp.participants || []) {
              buildPeer(peer.socketId, true);
            }
          });
        });

        sock.on('conference:participant-joined', ({ participant }) => {
          setState(s => ({ ...s, peers: [...s.peers, participant] }));
          // New peer; we wait for them to send the offer (they're initiator)
        });

        sock.on('conference:participant-left', ({ participant }) => {
          const pc = pcByPeer.current.get(participant.socketId);
          if (pc) { try { pc.close(); } catch {} pcByPeer.current.delete(participant.socketId); }
          setState(s => ({
            ...s,
            peers: s.peers.filter(p => p.socketId !== participant.socketId),
            streams: Object.fromEntries(
              Object.entries(s.streams).filter(([sid]) => sid !== participant.socketId)
            ),
          }));
        });

        sock.on('conference:signal', async ({ fromSocketId, signalType, signal }) => {
          let pc = pcByPeer.current.get(fromSocketId);
          if (!pc) pc = buildPeer(fromSocketId, false);

          try {
            if (signalType === 'offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(signal));
              const ans = await pc.createAnswer();
              await pc.setLocalDescription(ans);
              sock.emit('conference:signal', {
                toSocketId: fromSocketId,
                signalType: 'answer',
                signal: { sdp: ans.sdp, type: ans.type },
              });
            } else if (signalType === 'answer') {
              await pc.setRemoteDescription(new RTCSessionDescription(signal));
            } else if (signalType === 'ice-candidate') {
              await pc.addIceCandidate(new RTCIceCandidate(signal));
            }
          } catch (e) {
            console.error('conference signal handle failed', signalType, e);
          }
        });
      } catch (e) {
        setState(s => ({ ...s, phase: 'error', error: e.message }));
      }
    })();

    return () => {
      cancelled = true;
      try { socketRef.current?.emit('conference:leave'); } catch {}
      try { socketRef.current?.disconnect(); } catch {}
      for (const pc of pcByPeer.current.values()) { try { pc.close(); } catch {} }
      pcByPeer.current.clear();
      if (localStream.current) {
        for (const t of localStream.current.getTracks()) t.stop();
        localStream.current = null;
      }
    };
  }, [roomId, enabled, displayName, acquireLocalMedia, buildPeer]);

  const setMute = useCallback((kind, muted) => {
    if (!localStream.current) return;
    for (const t of localStream.current.getTracks()) {
      if ((kind === 'audio' && t.kind === 'audio') || (kind === 'video' && t.kind === 'video')) {
        t.enabled = !muted;
      }
    }
  }, []);

  return {
    ...state,
    localStream: localStream.current,
    setMute,
  };
}
