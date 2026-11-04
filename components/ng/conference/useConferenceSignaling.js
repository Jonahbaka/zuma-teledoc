'use client';

/**
 * useConferenceSignaling
 *
 * React hook for peer-mesh multi-party conferencing (≤ ~5 participants).
 * Joins the Socket.IO conference namespace, exchanges WebRTC offer/answer/ICE
 * with every other admitted peer, and surfaces:
 *
 *   localStream       – local camera/mic MediaStream (React state, triggers re-renders)
 *   screenStream      – active screen-share stream, or null
 *   isScreenSharing   – boolean
 *   peers             – array of { socketId, userId, role, name }
 *   streams           – { [socketId]: MediaStream }  remote media
 *   phase             – 'idle' | 'connecting' | 'joined' | 'error'
 *   error             – error message string when phase==='error'
 *   connectionQuality – 'good' | 'fair' | 'poor' | null (RTCPeerConnection stats)
 *   self              – this client's participant object
 *   setMute(kind, muted) – toggle local audio/video tracks
 *   startScreenShare()   – getDisplayMedia and replace video track in all peers
 *   stopScreenShare()    – stop screen share and restore camera track
 *   reconnect()          – close everything and reconnect from scratch
 */

import { useEffect, useRef, useState, useCallback } from 'react';

let ioPromise = null;
function loadSocketIO() {
  if (ioPromise) return ioPromise;
  ioPromise = import('socket.io-client').then((m) => m.io || m.default);
  return ioPromise;
}

function getAuthToken() {
  if (typeof document === 'undefined') return null;
  const cookieMatch = document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/);
  if (cookieMatch) return decodeURIComponent(cookieMatch[1]);
  try { return localStorage.getItem('accessToken') || null; } catch { return null; }
}

const DEFAULT_ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

async function fetchIceServers() {
  try {
    const r = await fetch('/api/ng/conference/ice-servers', { credentials: 'include' });
    if (!r.ok) return DEFAULT_ICE_SERVERS;
    const b = await r.json();
    return Array.isArray(b?.iceServers) && b.iceServers.length ? b.iceServers : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

export function useConferenceSignaling({ roomId, enabled = true, displayName = 'Participant' }) {
  // ── Public state ────────────────────────────────────────────────────────────
  const [sigState, setSigState] = useState({
    phase: 'idle',      // idle | connecting | joined | error
    error: null,
    self: null,
    peers: [],          // [{ socketId, userId, role, name }]
    streams: {},        // socketId -> MediaStream
  });
  const [localStream,      setLocalStream]      = useState(null);
  const [screenStream,     setScreenStream]     = useState(null);
  const [isScreenSharing,  setIsScreenSharing]  = useState(false);
  const [connectionQuality, setConnectionQuality] = useState(null);

  // ── Private refs ─────────────────────────────────────────────────────────
  const socketRef       = useRef(null);
  const pcByPeer        = useRef(new Map());   // socketId -> RTCPeerConnection
  const localStreamRef  = useRef(null);
  const screenStreamRef = useRef(null);
  const iceServersRef   = useRef([]);
  const [reconnectKey, setReconnectKey] = useState(0);

  // ── Acquire local media ────────────────────────────────────────────────────
  const acquireLocalMedia = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  // ── Replace video track in all peer connections ────────────────────────────
  const replaceVideoTrack = useCallback((newTrack) => {
    for (const pc of pcByPeer.current.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        sender.replaceTrack(newTrack).catch(() => {});
      }
    }
  }, []);

  // ── Build a peer connection ────────────────────────────────────────────────
  const buildPeer = useCallback((peerSocketId, isInitiator) => {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    pc.ontrack = (ev) => {
      setSigState((s) => ({ ...s, streams: { ...s.streams, [peerSocketId]: ev.streams[0] } }));
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

    pcByPeer.current.set(peerSocketId, pc);

    if (isInitiator) {
      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('conference:signal', {
          toSocketId: peerSocketId,
          signalType: 'offer',
          signal: { sdp: offer.sdp, type: offer.type },
        });
      })().catch((e) => console.error('[conference] offer failed', e));
    }

    return pc;
  }, []);

  // ── Clean up everything ────────────────────────────────────────────────────
  const cleanupAll = useCallback((stopMedia = true) => {
    try { socketRef.current?.emit('conference:leave'); } catch {}
    try { socketRef.current?.disconnect(); } catch {}
    socketRef.current = null;

    for (const pc of pcByPeer.current.values()) {
      try { pc.close(); } catch {}
    }
    pcByPeer.current.clear();

    if (stopMedia) {
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) t.stop();
        localStreamRef.current = null;
        setLocalStream(null);
      }
      if (screenStreamRef.current) {
        for (const t of screenStreamRef.current.getTracks()) t.stop();
        screenStreamRef.current = null;
        setScreenStream(null);
        setIsScreenSharing(false);
      }
    }
  }, []);

  // ── Main connect effect ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !roomId) return;
    let cancelled = false;

    (async () => {
      setSigState((s) => ({ ...s, phase: 'connecting', error: null }));

      try {
        iceServersRef.current = await fetchIceServers();
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
          if (!cancelled) {
            setSigState((s) => ({ ...s, phase: 'error', error: err.message || 'Connection error' }));
          }
        });

        sock.on('disconnect', () => {
          if (!cancelled) {
            setSigState((s) => ({ ...s, phase: 'error', error: 'Disconnected from server' }));
          }
        });

        sock.on('connect', () => {
          sock.emit('conference:join', { roomId, displayName }, (resp) => {
            if (cancelled) return;
            if (!resp?.ok) {
              setSigState((s) => ({ ...s, phase: 'error', error: resp?.error || 'Join rejected' }));
              return;
            }
            setSigState((s) => ({
              ...s,
              phase: 'joined',
              self: resp.participant,
              peers: resp.participants || [],
            }));
            for (const peer of resp.participants || []) {
              buildPeer(peer.socketId, true);
            }
          });
        });

        sock.on('conference:participant-joined', ({ participant }) => {
          if (cancelled) return;
          setSigState((s) => ({
            ...s,
            peers: s.peers.some((peer) => peer.socketId === participant.socketId)
              ? s.peers
              : [...s.peers, participant],
          }));
        });

        sock.on('conference:replaced', () => {
          if (!cancelled) {
            setSigState((state) => ({
              ...state,
              phase: 'error',
              error: 'This conference was reopened in another tab or device.',
            }));
          }
          cleanupAll(false);
        });

        sock.on('conference:participant-left', ({ participant }) => {
          if (cancelled) return;
          const pc = pcByPeer.current.get(participant.socketId);
          if (pc) {
            try { pc.close(); } catch {}
            pcByPeer.current.delete(participant.socketId);
          }
          setSigState((s) => ({
            ...s,
            peers: s.peers.filter((p) => p.socketId !== participant.socketId),
            streams: Object.fromEntries(
              Object.entries(s.streams).filter(([sid]) => sid !== participant.socketId)
            ),
          }));
        });

        sock.on('conference:signal', async ({ fromSocketId, signalType, signal }) => {
          if (cancelled) return;
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
            console.error('[conference] signal handling failed', signalType, e);
          }
        });
      } catch (e) {
        if (!cancelled) {
          setSigState((s) => ({ ...s, phase: 'error', error: e.message || 'Failed to connect' }));
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupAll(true);
      setSigState({ phase: 'idle', error: null, self: null, peers: [], streams: {} });
    };
  }, [roomId, enabled, displayName, reconnectKey, acquireLocalMedia, buildPeer, cleanupAll]);

  // ── Connection quality polling ─────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      const pcs = Array.from(pcByPeer.current.values()).filter(
        (pc) => pc.connectionState === 'connected'
      );
      if (!pcs.length) { setConnectionQuality(null); return; }

      let totalLoss = 0;
      let totalRtt  = 0;
      let count     = 0;

      await Promise.all(
        pcs.map(async (pc) => {
          try {
            const stats = await pc.getStats();
            stats.forEach((report) => {
              if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
                if (typeof report.fractionLost === 'number') { totalLoss += report.fractionLost; count++; }
                if (typeof report.roundTripTime === 'number') { totalRtt  += report.roundTripTime; }
              }
            });
          } catch {}
        })
      );

      if (!count) { setConnectionQuality(null); return; }
      const avgLoss = totalLoss / count;
      const avgRtt  = totalRtt  / count;
      if      (avgLoss < 0.02 && avgRtt < 0.15) setConnectionQuality('good');
      else if (avgLoss < 0.05 && avgRtt < 0.30) setConnectionQuality('fair');
      else                                        setConnectionQuality('poor');
    }, 5000);

    return () => clearInterval(id);
  }, []);

  // ── Public actions ─────────────────────────────────────────────────────────
  const setMute = useCallback((kind, muted) => {
    if (!localStreamRef.current) return;
    for (const t of localStreamRef.current.getTracks()) {
      if (t.kind === kind) t.enabled = !muted;
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    if (screenStreamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsScreenSharing(true);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) replaceVideoTrack(videoTrack);

      videoTrack?.addEventListener('ended', () => {
        screenStreamRef.current = null;
        setScreenStream(null);
        setIsScreenSharing(false);
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) replaceVideoTrack(cameraTrack);
      });
    } catch (e) {
      if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
        console.error('[conference] getDisplayMedia failed', e);
      }
    }
  }, [replaceVideoTrack]);

  const stopScreenShare = useCallback(() => {
    if (!screenStreamRef.current) return;
    for (const t of screenStreamRef.current.getTracks()) t.stop();
    screenStreamRef.current = null;
    setScreenStream(null);
    setIsScreenSharing(false);
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    if (cameraTrack) replaceVideoTrack(cameraTrack);
  }, [replaceVideoTrack]);

  const reconnect = useCallback(() => {
    cleanupAll(false);
    setSigState({ phase: 'connecting', error: null, self: null, peers: [], streams: {} });
    setReconnectKey((k) => k + 1);
  }, [cleanupAll]);

  return {
    ...sigState,
    localStream,
    screenStream,
    isScreenSharing,
    connectionQuality,
    setMute,
    startScreenShare,
    stopScreenShare,
    reconnect,
  };
}
