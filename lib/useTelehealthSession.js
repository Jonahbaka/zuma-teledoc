'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { appointmentsAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';

const DEFAULT_ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ]
  }
];

const SOCKET_CONNECT_TIMEOUT_MS = 20000;
const SOCKET_ACK_TIMEOUT_MS = 10000;

const buildSocketUrl = () =>
  process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080');

const normalizeIceServers = (iceServers) =>
  Array.isArray(iceServers) && iceServers.length ? iceServers : DEFAULT_ICE_SERVERS;

const createUserMediaError = (message) => {
  const error = new Error(message);
  error.name = 'MediaStreamError';
  return error;
};

const getMediaErrorMessage = (error) => {
  const name = error?.name || '';

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera or microphone was found on this device.';
  }

  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your camera or microphone is already in use by another application.';
  }

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera or microphone permission was denied.';
  }

  return error?.message || 'Unable to access camera or microphone.';
};

export function useTelehealthSession({ appointmentId } = {}) {
  const { getToken } = useAuth();
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [remoteParticipant, setRemoteParticipant] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [callError, setCallError] = useState(null);
  const [mediaError, setMediaError] = useState(null);
  const [mediaWarning, setMediaWarning] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [participantCount, setParticipantCount] = useState(1);
  const [isSocketConnected, setIsSocketConnected] = useState(false);

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteSocketIdRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const joinStateRef = useRef({
    hasJoined: false,
    shouldRejoin: false,
    displayName: '',
  });
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const statusRef = useRef('idle');
  const rejoinRef = useRef(null);

  const setStatus = useCallback((nextStatus) => {
    statusRef.current = nextStatus;
    setConnectionStatus(nextStatus);
  }, []);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setLocalStream(null);
  }, []);

  const resetRemoteStream = useCallback(() => {
    remoteSocketIdRef.current = null;
    remoteStreamRef.current = null;
    pendingIceCandidatesRef.current = [];
    setRemoteStream(null);
    setRemoteParticipant(null);
    setParticipantCount(1);
  }, []);

  const closePeerConnection = useCallback(({ clearRemote = true } = {}) => {
    if (peerRef.current) {
      peerRef.current.ontrack = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.oniceconnectionstatechange = null;
      peerRef.current.close();
      peerRef.current = null;
    }

    pendingIceCandidatesRef.current = [];

    if (clearRemote) {
      resetRemoteStream();
    }
  }, [resetRemoteStream]);

  const emitWithAck = useCallback((socket, event, payload, timeoutMs = SOCKET_ACK_TIMEOUT_MS) => (
    new Promise((resolve, reject) => {
      socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
        if (error) {
          reject(new Error(typeof error === 'string' ? error : 'Socket request timed out'));
          return;
        }

        if (response?.ok === false) {
          reject(new Error(response.error || 'Socket request failed'));
          return;
        }

        resolve(response);
      });
    })
  ), []);

  const syncLocalTracks = useCallback((peerConnection, stream) => {
    if (!peerConnection || !stream) {
      return;
    }

    for (const track of stream.getTracks()) {
      const existingSender = peerConnection
        .getSenders()
        .find((sender) => sender.track?.kind === track.kind);

      if (existingSender) {
        if (existingSender.track !== track) {
          existingSender.replaceTrack(track);
        }
      } else {
        peerConnection.addTrack(track, stream);
      }
    }
  }, []);

  const flushPendingIceCandidates = useCallback(async () => {
    const peerConnection = peerRef.current;
    if (!peerConnection?.remoteDescription) {
      return;
    }

    while (pendingIceCandidatesRef.current.length) {
      const candidate = pendingIceCandidatesRef.current.shift();
      if (!candidate) continue;

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn('Failed to apply ICE candidate', error);
      }
    }
  }, []);

  const ensurePeerConnection = useCallback(async () => {
    if (peerRef.current) {
      syncLocalTracks(peerRef.current, localStreamRef.current);
      return peerRef.current;
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: normalizeIceServers(iceServersRef.current)
    });

    peerConnection.ontrack = (event) => {
      const incomingStream = event.streams?.[0];
      if (incomingStream) {
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);
        return;
      }

      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      remoteStreamRef.current.addTrack(event.track);
      setRemoteStream(remoteStreamRef.current);
    };

    peerConnection.onicecandidate = async (event) => {
      if (!event.candidate || !remoteSocketIdRef.current || !socketRef.current?.connected) {
        return;
      }

      try {
        await emitWithAck(socketRef.current, 'telehealth:signal', {
          toSocketId: remoteSocketIdRef.current,
          signalType: 'ice-candidate',
          signal: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
        });
      } catch (error) {
        console.warn('Failed to send ICE candidate', error);
      }
    };

    const syncConnectionState = () => {
      const currentState = peerConnection.connectionState;

      if (currentState === 'connected') {
        setCallError(null);
        setStatus('connected');
        return;
      }

      if (currentState === 'failed') {
        setCallError('The video connection failed. Rejoin the appointment if this persists.');
        setStatus('error');
        return;
      }

      if (currentState === 'disconnected') {
        setStatus('reconnecting');
        return;
      }

      if (currentState === 'closed') {
        setStatus('ended');
        return;
      }

      if (currentState === 'connecting' && statusRef.current !== 'connected') {
        setStatus('connecting');
      }
    };

    peerConnection.onconnectionstatechange = syncConnectionState;
    peerConnection.oniceconnectionstatechange = syncConnectionState;

    syncLocalTracks(peerConnection, localStreamRef.current);
    peerRef.current = peerConnection;

    return peerConnection;
  }, [emitWithAck, setStatus, syncLocalTracks]);

  const addIncomingIceCandidate = useCallback(async (candidate) => {
    if (!candidate) {
      return;
    }

    const peerConnection = peerRef.current;
    if (!peerConnection?.remoteDescription) {
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.warn('Failed to add incoming ICE candidate', error);
    }
  }, []);

  const ensureLocalStream = useCallback(async () => {
    const existingStream = localStreamRef.current;
    if (existingStream?.getTracks().some((track) => track.readyState === 'live')) {
      return existingStream;
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      throw createUserMediaError('Camera access is not supported in this browser.');
    }

    let stream = null;
    let warning = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: true
      });
    } catch (primaryError) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: false
        });
        warning = 'Microphone permission is not available. Joining video-only.';
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true
          });
          warning = 'Camera permission is not available. Joining audio-only.';
        } catch {
          const finalMessage = getMediaErrorMessage(primaryError);
          setMediaError(finalMessage);
          throw createUserMediaError(finalMessage);
        }
      }
    }

    localStreamRef.current = stream;
    setLocalStream(stream);
    setMediaError(null);
    setMediaWarning(warning);

    if (peerRef.current) {
      syncLocalTracks(peerRef.current, stream);
    }

    return stream;
  }, [syncLocalTracks]);

  const connectSocket = useCallback(async () => {
    if (socketRef.current?.connected) {
      return socketRef.current;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const token = getToken?.();
    if (!token) {
      throw new Error('Authentication expired. Please sign in again.');
    }

    const socket = io(buildSocketUrl(), {
      auth: { token },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: SOCKET_CONNECT_TIMEOUT_MS
    });

    socket.on('connect', () => {
      setIsSocketConnected(true);

      if (joinStateRef.current.shouldRejoin && joinStateRef.current.hasJoined && rejoinRef.current) {
        joinStateRef.current.shouldRejoin = false;
        rejoinRef.current().catch((error) => {
          setCallError(error.message || 'Failed to reconnect to the call');
          setStatus('error');
        });
      }
    });

    socket.on('disconnect', () => {
      setIsSocketConnected(false);

      if (joinStateRef.current.hasJoined) {
        joinStateRef.current.shouldRejoin = true;
        if (statusRef.current !== 'idle' && statusRef.current !== 'ended') {
          setStatus('reconnecting');
        }
      }
    });

    socket.on('connect_error', (error) => {
      setIsSocketConnected(false);
      setCallError(error.message || 'Failed to connect to the video signaling service');
      setStatus('error');
    });

    socket.on('telehealth:participant-joined', ({ participant }) => {
      if (!participant || participant.socketId === remoteSocketIdRef.current) {
        return;
      }

      setRemoteParticipant(participant);
      setParticipantCount(2);
      if (statusRef.current !== 'connected') {
        setStatus('connecting');
      }
    });

    socket.on('telehealth:participant-left', ({ participant }) => {
      if (participant?.socketId && participant.socketId !== remoteSocketIdRef.current) {
        return;
      }

      closePeerConnection({ clearRemote: true });
      setParticipantCount(1);
      setStatus('waiting');
      setCallError(null);
    });

    socket.on('telehealth:replaced', () => {
      setCallError('This call was opened in another tab or device.');
      setStatus('ended');
      socket.disconnect();
    });

    socket.on('telehealth:signal', async ({ fromSocketId, participant, signalType, signal }) => {
      try {
        if (!fromSocketId || !signalType) {
          return;
        }

        if (participant) {
          setRemoteParticipant(participant);
          setParticipantCount(2);
        }

        if (remoteSocketIdRef.current && remoteSocketIdRef.current !== fromSocketId && signalType === 'offer') {
          closePeerConnection({ clearRemote: true });
        }

        remoteSocketIdRef.current = fromSocketId;

        if (signalType === 'ice-candidate') {
          await addIncomingIceCandidate(signal);
          return;
        }

        await ensureLocalStream();
        const peerConnection = await ensurePeerConnection();

        if (signalType === 'offer') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
          await flushPendingIceCandidates();

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          await emitWithAck(socket, 'telehealth:signal', {
            toSocketId: fromSocketId,
            signalType: 'answer',
            signal: peerConnection.localDescription
          });

          setStatus('connecting');
          return;
        }

        if (signalType === 'answer') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
          await flushPendingIceCandidates();
          setStatus('connecting');
        }
      } catch (error) {
        console.error('Telehealth signaling error', error);
        setCallError(error.message || 'Failed to negotiate the video session');
        setStatus('error');
      }
    });

    socketRef.current = socket;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Video signaling connection timed out'));
      }, SOCKET_CONNECT_TIMEOUT_MS);

      const handleConnect = () => {
        clearTimeout(timer);
        cleanup();
        resolve();
      };

      const handleError = (error) => {
        clearTimeout(timer);
        cleanup();
        reject(error instanceof Error ? error : new Error('Failed to connect to signaling service'));
      };

      const cleanup = () => {
        socket.off('connect', handleConnect);
        socket.off('connect_error', handleError);
      };

      socket.on('connect', handleConnect);
      socket.on('connect_error', handleError);
    });

    return socket;
  }, [
    addIncomingIceCandidate,
    closePeerConnection,
    emitWithAck,
    ensureLocalStream,
    ensurePeerConnection,
    flushPendingIceCandidates,
    getToken,
    setStatus
  ]);

  const joinRoom = useCallback(async (displayName) => {
    if (!appointmentId) {
      throw new Error('Appointment ID is required to start a video call');
    }

    await ensureLocalStream();
    const joinResponse = await appointmentsAPI.join(appointmentId);
    const joinData = joinResponse?.data || {};
    const socket = await connectSocket();

    iceServersRef.current = normalizeIceServers(joinData.iceServers);
    setRoomId(joinData.roomId || null);

    const response = await emitWithAck(socket, 'telehealth:join', {
      appointmentId,
      displayName
    });

    iceServersRef.current = normalizeIceServers(response.iceServers || joinData.iceServers);
    joinStateRef.current = {
      hasJoined: true,
      shouldRejoin: false,
      displayName
    };

    setRoomId(response.roomId || joinData.roomId || null);
    setRemoteParticipant(response.participants?.[0] || null);
    setParticipantCount((response.participants?.length || 0) + 1);
    setCallError(null);

    if (response.participants?.length) {
      const participant = response.participants[0];
      remoteSocketIdRef.current = participant.socketId;

      const peerConnection = await ensurePeerConnection();
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await peerConnection.setLocalDescription(offer);
      await emitWithAck(socket, 'telehealth:signal', {
        toSocketId: participant.socketId,
        signalType: 'offer',
        signal: peerConnection.localDescription
      });

      setStatus('connecting');
    } else {
      setStatus('waiting');
    }
  }, [appointmentId, connectSocket, emitWithAck, ensureLocalStream, ensurePeerConnection, setStatus]);

  const joinCall = useCallback(async ({ displayName } = {}) => {
    setCallError(null);
    setStatus('joining');
    joinStateRef.current.displayName = displayName || '';
    await joinRoom(displayName || '');
  }, [joinRoom, setStatus]);

  rejoinRef.current = async () => {
    if (!joinStateRef.current.hasJoined) {
      return;
    }

    closePeerConnection({ clearRemote: true });
    await joinRoom(joinStateRef.current.displayName);
  };

  const leaveCall = useCallback(async ({ stopMedia = true } = {}) => {
    joinStateRef.current = {
      hasJoined: false,
      shouldRejoin: false,
      displayName: ''
    };

    try {
      if (socketRef.current?.connected) {
        await emitWithAck(socketRef.current, 'telehealth:leave', {});
      }
    } catch (error) {
      console.warn('Failed to leave telehealth room cleanly', error);
    } finally {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      setIsSocketConnected(false);
      closePeerConnection({ clearRemote: true });
      setRoomId(null);
      setCallError(null);
      setStatus('idle');

      if (stopMedia) {
        stopLocalStream();
        setMediaWarning(null);
        setMediaError(null);
      }
    }
  }, [closePeerConnection, emitWithAck, setStatus, stopLocalStream]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      closePeerConnection({ clearRemote: true });
      stopLocalStream();
    };
  }, [closePeerConnection, stopLocalStream]);

  return {
    callError,
    connectionStatus,
    ensureLocalStream,
    isSocketConnected,
    joinCall,
    leaveCall,
    localStream,
    mediaError,
    mediaWarning,
    participantCount,
    remoteParticipant,
    remoteStream,
    roomId
  };
}

export default useTelehealthSession;
