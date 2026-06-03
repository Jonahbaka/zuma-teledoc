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
const MEDIA_REQUEST_TIMEOUT_MS = 8000;

const stripApiSuffix = (value) => String(value || '').replace(/\/api\/?$/, '');

const getLocalApiOrigin = () => {
  if (typeof window === 'undefined') {
    return 'http://localhost:8080';
  }

  const { protocol, hostname, origin } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:8080`;
  }

  return origin;
};

const buildSocketUrl = () =>
  stripApiSuffix(process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL) ||
  getLocalApiOrigin();

const getIceTransportPolicy = () => {
  const policy = String(process.env.NEXT_PUBLIC_WEBRTC_ICE_TRANSPORT_POLICY || '').trim();
  return ['all', 'relay'].includes(policy) ? policy : undefined;
};

const normalizeIceServers = (iceServers) =>
  Array.isArray(iceServers) && iceServers.length ? iceServers : DEFAULT_ICE_SERVERS;

const createUserMediaError = (message) => {
  const error = new Error(message);
  error.name = 'MediaStreamError';
  return error;
};

const getUserMediaWithTimeout = (constraints) => {
  const request = navigator.mediaDevices.getUserMedia(constraints);
  const timeout = new Promise((_, reject) => {
    window.setTimeout(() => {
      const error = new Error('Camera or microphone request timed out. Check browser and operating system permissions, then try again.');
      error.name = 'AbortError';
      reject(error);
    }, MEDIA_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([request, timeout]);
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
  const [callPhase, setCallPhase] = useState('idle');
  const [callError, setCallError] = useState(null);
  const [connectionQuality, setConnectionQuality] = useState({
    level: 'idle',
    label: 'Not connected'
  });
  const [mediaError, setMediaError] = useState(null);
  const [mediaWarning, setMediaWarning] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [participantCount, setParticipantCount] = useState(1);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [facingMode, setFacingMode] = useState('user');
  const [messages, setMessages] = useState([]);

  const socketRef = useRef(null);
  const selfSocketIdRef = useRef(null);
  const peerRef = useRef(null);
  const selfTestPeersRef = useRef(null);
  const localStreamRef = useRef(null);
  const localStreamPromiseRef = useRef(null);
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
  const facingModeRef = useRef('user');
  const makingOfferRef = useRef(false);
  const debugEventsRef = useRef([]);

  const publishDebugSnapshot = useCallback((overrides = {}) => {
    if (typeof window === 'undefined') {
      return null;
    }

    const peerConnection = peerRef.current;
    const localTracks = localStreamRef.current?.getTracks?.() || [];
    const remoteTracks = remoteStreamRef.current?.getTracks?.() || [];
    const snapshot = {
      appointmentId: appointmentId || null,
      roomId: overrides.roomId || roomId || null,
      socketId: selfSocketIdRef.current || socketRef.current?.id || null,
      remoteSocketId: remoteSocketIdRef.current || null,
      status: overrides.status || statusRef.current,
      callPhase,
      participantCount,
      isSocketConnected,
      localTrackCount: localTracks.length,
      localAudioTrackCount: localTracks.filter((track) => track.kind === 'audio').length,
      localVideoTrackCount: localTracks.filter((track) => track.kind === 'video').length,
      localEnabledAudioTrackCount: localTracks.filter((track) => track.kind === 'audio' && track.enabled).length,
      localEnabledVideoTrackCount: localTracks.filter((track) => track.kind === 'video' && track.enabled).length,
      remoteTrackCount: remoteTracks.length,
      remoteAudioTrackCount: remoteTracks.filter((track) => track.kind === 'audio').length,
      remoteVideoTrackCount: remoteTracks.filter((track) => track.kind === 'video').length,
      peerConnectionState: peerConnection?.connectionState || null,
      iceConnectionState: peerConnection?.iceConnectionState || null,
      signalingState: peerConnection?.signalingState || null,
      mediaError,
      mediaWarning,
      events: debugEventsRef.current.slice(-80),
      updatedAt: new Date().toISOString(),
      ...overrides
    };

    window.__doctarxTelehealthDebug = snapshot;
    return snapshot;
  }, [appointmentId, callPhase, isSocketConnected, mediaError, mediaWarning, participantCount, roomId]);

  const recordDebugEvent = useCallback((event, details = {}) => {
    const entry = {
      event,
      appointmentId: details.appointmentId || appointmentId || null,
      roomId: details.roomId || roomId || null,
      at: new Date().toISOString(),
      ...details
    };
    debugEventsRef.current = [...debugEventsRef.current.slice(-79), entry];
    publishDebugSnapshot(details);
  }, [appointmentId, publishDebugSnapshot, roomId]);

  const setStatus = useCallback((nextStatus) => {
    statusRef.current = nextStatus;
    setConnectionStatus(nextStatus);

    if (nextStatus === 'joining') {
      setCallPhase('joining');
    } else if (nextStatus === 'waiting') {
      setCallPhase('waiting');
    } else if (nextStatus === 'connecting' || nextStatus === 'reconnecting') {
      setCallPhase('peer_joined');
    } else if (nextStatus === 'connected') {
      setCallPhase('in_progress');
    } else if (nextStatus === 'ended') {
      setCallPhase('ended');
    } else if (nextStatus === 'error') {
      setCallPhase('failed');
    } else if (nextStatus === 'idle') {
      setCallPhase('idle');
    }
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
    if (selfTestPeersRef.current) {
      selfTestPeersRef.current.caller?.close();
      selfTestPeersRef.current.receiver?.close();
      selfTestPeersRef.current = null;
    }

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

  const getAudioConstraints = useCallback(() => ({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }), []);

  const getVideoConstraints = useCallback((mode = facingModeRef.current) => ({
    width: { ideal: 960 },
    height: { ideal: 540 },
    frameRate: { ideal: 24, max: 30 },
    facingMode: { ideal: mode }
  }), []);

  const isSecureMediaContext = useCallback(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    const host = window.location.hostname;
    return window.isSecureContext || host === 'localhost' || host === '127.0.0.1';
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

    const rtcConfig = {
      iceServers: normalizeIceServers(iceServersRef.current)
    };
    const iceTransportPolicy = getIceTransportPolicy();
    if (iceTransportPolicy) {
      rtcConfig.iceTransportPolicy = iceTransportPolicy;
    }
    const peerConnection = new RTCPeerConnection(rtcConfig);
    recordDebugEvent('peer-connection-created', {
      iceServerCount: rtcConfig.iceServers.length,
      iceTransportPolicy: rtcConfig.iceTransportPolicy || 'all'
    });

    peerConnection.ontrack = (event) => {
      const incomingStream = event.streams?.[0];
      if (incomingStream) {
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);
        recordDebugEvent('remote-track-received', {
          remoteTrackCount: incomingStream.getTracks().length,
          remoteAudioTrackCount: incomingStream.getAudioTracks().length,
          remoteVideoTrackCount: incomingStream.getVideoTracks().length
        });
        return;
      }

      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }

      remoteStreamRef.current.addTrack(event.track);
      setRemoteStream(remoteStreamRef.current);
      recordDebugEvent('remote-track-received', {
        remoteTrackCount: remoteStreamRef.current.getTracks().length,
        remoteAudioTrackCount: remoteStreamRef.current.getAudioTracks().length,
        remoteVideoTrackCount: remoteStreamRef.current.getVideoTracks().length
      });
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
      recordDebugEvent('peer-state-change', {
        peerConnectionState: peerConnection.connectionState,
        iceConnectionState: peerConnection.iceConnectionState,
        signalingState: peerConnection.signalingState
      });

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
  }, [emitWithAck, recordDebugEvent, setStatus, syncLocalTracks]);

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

  const shouldInitiateOffer = useCallback((participantSocketId) => {
    const selfSocketId = selfSocketIdRef.current;
    if (!selfSocketId || !participantSocketId) {
      return false;
    }

    return String(selfSocketId) < String(participantSocketId);
  }, []);

  const ensureLocalStream = useCallback(async () => {
    const existingStream = localStreamRef.current;
    if (existingStream?.getTracks().some((track) => track.readyState === 'live')) {
      return existingStream;
    }

    if (localStreamPromiseRef.current) {
      return localStreamPromiseRef.current;
    }

    const streamPromise = (async () => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw createUserMediaError('Camera access is not supported in this browser.');
      }

      if (!isSecureMediaContext()) {
        throw createUserMediaError('Camera and microphone require HTTPS. Open the secure DoctaRx link and try again.');
      }

      let stream = null;
      let warning = null;
      let primaryError = null;
      const attempts = [
        {
          constraints: { video: getVideoConstraints(), audio: getAudioConstraints() },
          warning: null
        },
        {
          constraints: { video: true, audio: getAudioConstraints() },
          warning: null
        },
        {
          constraints: { video: getVideoConstraints(), audio: false },
          warning: 'Microphone permission is not available. Joining video-only.'
        },
        {
          constraints: { video: true, audio: false },
          warning: 'Microphone permission is not available. Joining video-only.'
        },
        {
          constraints: { video: false, audio: getAudioConstraints() },
          warning: 'Camera permission is not available. Joining audio-only.'
        }
      ];

      for (const attempt of attempts) {
        try {
          stream = await getUserMediaWithTimeout(attempt.constraints);
          warning = attempt.warning;
          if (stream?.getTracks().length) {
            break;
          }
        } catch (error) {
          primaryError = primaryError || error;
          recordDebugEvent('local-media-attempt-failed', {
            errorName: error?.name || 'UnknownError',
            errorMessage: error?.message || 'Unable to access media'
          });
        }
      }

      if (!stream?.getTracks().length) {
        const finalMessage = getMediaErrorMessage(primaryError);
        setMediaError(finalMessage);
        recordDebugEvent('local-media-failed', {
          errorName: primaryError?.name || 'MediaStreamError',
          errorMessage: finalMessage
        });
        throw createUserMediaError(finalMessage);
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaError(null);
      setMediaWarning(warning);
      recordDebugEvent('local-media-ready', {
        localTrackCount: stream.getTracks().length,
        localAudioTrackCount: stream.getAudioTracks().length,
        localVideoTrackCount: stream.getVideoTracks().length,
        mediaWarning: warning
      });

      if (peerRef.current) {
        syncLocalTracks(peerRef.current, stream);
      }

      return stream;
    })();

    localStreamPromiseRef.current = streamPromise;

    try {
      return await streamPromise;
    } finally {
      localStreamPromiseRef.current = null;
    }
  }, [getAudioConstraints, getVideoConstraints, isSecureMediaContext, recordDebugEvent, syncLocalTracks]);

  const createAndSendOffer = useCallback(async (participant) => {
    if (!participant?.socketId || !socketRef.current?.connected || makingOfferRef.current) {
      return;
    }

    remoteSocketIdRef.current = participant.socketId;
    setRemoteParticipant(participant);
    setParticipantCount(2);

    makingOfferRef.current = true;
    try {
      await ensureLocalStream();
      const peerConnection = await ensurePeerConnection();

      if (peerConnection.signalingState !== 'stable') {
        return;
      }

      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await peerConnection.setLocalDescription(offer);
      await emitWithAck(socketRef.current, 'telehealth:signal', {
        toSocketId: participant.socketId,
        signalType: 'offer',
        signal: peerConnection.localDescription
      });
      recordDebugEvent('offer-sent', {
        toSocketId: participant.socketId,
        signalingState: peerConnection.signalingState
      });

      setStatus('connecting');
    } finally {
      makingOfferRef.current = false;
    }
  }, [emitWithAck, ensureLocalStream, ensurePeerConnection, recordDebugEvent, setStatus]);

  const switchCamera = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw createUserMediaError('Camera switching is not supported in this browser.');
    }

    const nextFacingMode = facingModeRef.current === 'user' ? 'environment' : 'user';
    let videoOnlyStream = null;

    try {
      videoOnlyStream = await navigator.mediaDevices.getUserMedia({
        video: getVideoConstraints(nextFacingMode),
        audio: false
      });
    } catch (switchError) {
      try {
        videoOnlyStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      } catch {
        const message = getMediaErrorMessage(switchError);
        setMediaError(message);
        throw createUserMediaError(message);
      }
    }

    const [nextVideoTrack] = videoOnlyStream.getVideoTracks();
    if (!nextVideoTrack) {
      videoOnlyStream.getTracks().forEach((track) => track.stop());
      throw createUserMediaError('No alternate camera was found on this device.');
    }

    const existingStream = localStreamRef.current || new MediaStream();
    const previousVideoTracks = existingStream.getVideoTracks();
    const audioTracks = existingStream.getAudioTracks();
    const nextStream = new MediaStream([...audioTracks, nextVideoTrack]);

    const videoSender = peerRef.current
      ?.getSenders()
      .find((sender) => sender.track?.kind === 'video');

    if (videoSender) {
      await videoSender.replaceTrack(nextVideoTrack);
    } else if (peerRef.current) {
      peerRef.current.addTrack(nextVideoTrack, nextStream);
    }

    previousVideoTracks.forEach((track) => track.stop());
    localStreamRef.current = nextStream;
    setLocalStream(nextStream);
    setMediaError(null);
    facingModeRef.current = nextFacingMode;
    setFacingMode(nextFacingMode);

    return nextStream;
  }, [getVideoConstraints]);

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
      recordDebugEvent('socket-connected', {
        socketId: socket.id,
        socketUrl: buildSocketUrl()
      });

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
      recordDebugEvent('socket-disconnected', { socketId: socket.id });

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
      recordDebugEvent('socket-connect-error', {
        errorMessage: error.message || 'Failed to connect to the video signaling service'
      });
      setStatus('error');
    });

    socket.on('telehealth:participant-joined', ({ participant }) => {
      if (!participant || participant.socketId === remoteSocketIdRef.current) {
        return;
      }

      setRemoteParticipant(participant);
      setParticipantCount(2);
      recordDebugEvent('participant-joined', {
        remoteSocketId: participant.socketId,
        remoteRole: participant.role
      });
      setCallPhase('peer_joined');
      if (statusRef.current !== 'connected') {
        setStatus('connecting');
      }

      if (shouldInitiateOffer(participant.socketId)) {
        createAndSendOffer(participant).catch((error) => {
          setCallError(error.message || 'Failed to start the video connection');
          setStatus('error');
        });
      }
    });

    socket.on('telehealth:participant-left', ({ participant }) => {
      if (participant?.socketId && participant.socketId !== remoteSocketIdRef.current) {
        return;
      }

      closePeerConnection({ clearRemote: true });
      setParticipantCount(1);
      recordDebugEvent('participant-left', {
        remoteSocketId: participant?.socketId || remoteSocketIdRef.current
      });
      setCallPhase('waiting');
      setStatus('waiting');
      setCallError(null);
    });

    socket.on('telehealth:replaced', () => {
      setCallError('This call was opened in another tab or device.');
      setCallPhase('ended');
      recordDebugEvent('socket-replaced');
      setStatus('ended');
      socket.disconnect();
    });

    socket.on('telehealth:status', ({ status, roomId: statusRoomId, participantCount: statusParticipantCount }) => {
      if (status) {
        setCallPhase(status);
      }
      recordDebugEvent('room-status', {
        status,
        roomId: statusRoomId,
        participantCount: statusParticipantCount
      });
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
        recordDebugEvent('signal-received', {
          fromSocketId,
          signalType,
          remoteRole: participant?.role
        });

        if (remoteSocketIdRef.current && remoteSocketIdRef.current !== fromSocketId && signalType === 'offer') {
          closePeerConnection({ clearRemote: true });
        }

        remoteSocketIdRef.current = fromSocketId;

        if (signalType === 'ice-candidate') {
          await addIncomingIceCandidate(signal);
          recordDebugEvent('ice-candidate-received', { fromSocketId });
          return;
        }

        await ensureLocalStream();
        let peerConnection = await ensurePeerConnection();

        if (signalType === 'offer') {
          if (peerConnection.signalingState !== 'stable') {
            try {
              await peerConnection.setLocalDescription({ type: 'rollback' });
            } catch {
              closePeerConnection({ clearRemote: false });
              peerConnection = await ensurePeerConnection();
            }
          }

          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
          await flushPendingIceCandidates();

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          await emitWithAck(socket, 'telehealth:signal', {
            toSocketId: fromSocketId,
            signalType: 'answer',
            signal: peerConnection.localDescription
          });
          recordDebugEvent('answer-sent', {
            toSocketId: fromSocketId,
            signalingState: peerConnection.signalingState
          });

          setStatus('connecting');
          return;
        }

        if (signalType === 'answer') {
          if (peerConnection.signalingState === 'stable') {
            return;
          }

          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
          await flushPendingIceCandidates();
          recordDebugEvent('answer-applied', {
            fromSocketId,
            signalingState: peerConnection.signalingState
          });
          setStatus('connecting');
        }
      } catch (error) {
        console.error('Telehealth signaling error', error);
        setCallError(error.message || 'Failed to negotiate the video session');
        setStatus('error');
      }
    });

    socket.on('telehealth:message', (message) => {
      if (!message?.id || !message?.body) {
        return;
      }

      setMessages((current) => {
        if (current.some((item) => item.id === message.id)) {
          return current;
        }
        return [...current.slice(-99), message];
      });
      recordDebugEvent('message-received', {
        messageId: message.id,
        senderRole: message.senderRole
      });
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
    createAndSendOffer,
    emitWithAck,
    ensureLocalStream,
    ensurePeerConnection,
    flushPendingIceCandidates,
    getToken,
    setStatus,
    shouldInitiateOffer,
    recordDebugEvent
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
    recordDebugEvent('join-api-ready', {
      roomId: joinData.roomId || null,
      iceServerCount: iceServersRef.current.length
    });

    const response = await emitWithAck(socket, 'telehealth:join', {
      appointmentId,
      displayName
    });
    if (!response?.ok) {
      throw new Error(response?.error || 'Video room join was rejected by the signaling service');
    }

    if (joinData.roomId && response.roomId && joinData.roomId !== response.roomId) {
      throw new Error('Video room mismatch detected. Please re-open the appointment and try again.');
    }

    iceServersRef.current = normalizeIceServers(response.iceServers || joinData.iceServers);
    selfSocketIdRef.current = response.participant?.socketId || socket.id || null;
    joinStateRef.current = {
      hasJoined: true,
      shouldRejoin: false,
      displayName
    };

    setRoomId(response.roomId || joinData.roomId || null);
    recordDebugEvent('room-joined', {
      roomId: response.roomId || joinData.roomId || null,
      socketId: selfSocketIdRef.current,
      participantCount: (response.participants?.length || 0) + 1,
      iceServerCount: iceServersRef.current.length
    });
    setRemoteParticipant(response.participants?.[0] || null);
    setParticipantCount((response.participants?.length || 0) + 1);
    setCallError(null);

    if (response.participants?.length) {
      const participant = response.participants[0];
      remoteSocketIdRef.current = participant.socketId;
      setRemoteParticipant(participant);

      if (shouldInitiateOffer(participant.socketId)) {
        await createAndSendOffer(participant);
      } else {
        setStatus('connecting');
      }
    } else {
      setStatus('waiting');
    }
  }, [
    appointmentId,
    connectSocket,
    createAndSendOffer,
    emitWithAck,
    ensureLocalStream,
    setStatus,
    recordDebugEvent,
    shouldInitiateOffer
  ]);

  const joinCall = useCallback(async ({ displayName } = {}) => {
    setCallError(null);
    setStatus('joining');
    joinStateRef.current.displayName = displayName || '';
    await joinRoom(displayName || '');
  }, [joinRoom, setStatus]);

  const sendMessage = useCallback(async (body) => {
    const text = String(body || '').trim();
    if (!text) {
      return null;
    }

    if (!socketRef.current?.connected) {
      throw new Error('Join the video visit before sending a message.');
    }

    const response = await emitWithAck(socketRef.current, 'telehealth:message', { body: text });
    if (!response?.ok) {
      throw new Error(response?.error || 'Message could not be sent.');
    }

    recordDebugEvent('message-sent', {
      messageId: response.message?.id || null,
      senderRole: response.message?.senderRole || null
    });
    return response.message || null;
  }, [emitWithAck, recordDebugEvent]);

  rejoinRef.current = async () => {
    if (!joinStateRef.current.hasJoined) {
      return;
    }

    closePeerConnection({ clearRemote: true });
    await joinRoom(joinStateRef.current.displayName);
  };

  const reconnectCall = useCallback(async () => {
    if (!joinStateRef.current.hasJoined) {
      throw new Error('Join the appointment before reconnecting.');
    }

    setCallError(null);
    setStatus('reconnecting');
    closePeerConnection({ clearRemote: true });
    await joinRoom(joinStateRef.current.displayName);
  }, [closePeerConnection, joinRoom, setStatus]);

  const startSelfTestCall = useCallback(async ({ displayName } = {}) => {
    setCallError(null);
    setStatus('joining');
    const stream = await ensureLocalStream();
    closePeerConnection({ clearRemote: true });

    const caller = new RTCPeerConnection({
      iceServers: normalizeIceServers(iceServersRef.current)
    });
    const receiver = new RTCPeerConnection({
      iceServers: normalizeIceServers(iceServersRef.current)
    });
    selfTestPeersRef.current = { caller, receiver };

    caller.onicecandidate = (event) => {
      if (event.candidate) receiver.addIceCandidate(event.candidate).catch(() => {});
    };
    receiver.onicecandidate = (event) => {
      if (event.candidate) caller.addIceCandidate(event.candidate).catch(() => {});
    };
    receiver.ontrack = (event) => {
      const incomingStream = event.streams?.[0] || new MediaStream([event.track]);
      remoteStreamRef.current = incomingStream;
      setRemoteStream(incomingStream);
    };

    const syncSelfTestState = () => {
      if (caller.connectionState === 'connected' || receiver.connectionState === 'connected') {
        setStatus('connected');
        setCallPhase('in_progress');
        setConnectionQuality({ level: 'good', label: 'Self-test connected' });
      } else if (caller.connectionState === 'failed' || receiver.connectionState === 'failed') {
        setCallError('The self-test WebRTC connection failed. Check camera, microphone, and browser permissions.');
        setStatus('error');
      } else if (caller.connectionState === 'connecting' || receiver.connectionState === 'connecting') {
        setStatus('connecting');
      }
    };
    caller.onconnectionstatechange = syncSelfTestState;
    receiver.onconnectionstatechange = syncSelfTestState;

    stream.getTracks().forEach((track) => caller.addTrack(track, stream));
    const offer = await caller.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await caller.setLocalDescription(offer);
    await receiver.setRemoteDescription(offer);
    const answer = await receiver.createAnswer();
    await receiver.setLocalDescription(answer);
    await caller.setRemoteDescription(answer);

    joinStateRef.current = {
      hasJoined: true,
      shouldRejoin: false,
      displayName: displayName || 'Provider self-test'
    };
    setRoomId('provider-self-test');
    setRemoteParticipant({
      socketId: 'self-test-loopback',
      role: 'patient',
      name: 'Self-test patient view',
      joinedAt: new Date().toISOString()
    });
    setParticipantCount(2);
    setStatus('connecting');
  }, [closePeerConnection, ensureLocalStream, setStatus]);

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
      selfSocketIdRef.current = null;
      makingOfferRef.current = false;
      closePeerConnection({ clearRemote: true });
      setRoomId(null);
      setCallError(null);
      setStatus('idle');
      setCallPhase('ended');
      setConnectionQuality({ level: 'idle', label: 'Not connected' });

      if (stopMedia) {
        stopLocalStream();
        setMediaWarning(null);
        setMediaError(null);
      }
    }
  }, [closePeerConnection, emitWithAck, setStatus, stopLocalStream]);

  const collectConnectionQuality = useCallback(async () => {
    const peerConnection = peerRef.current;

    if (!peerConnection || peerConnection.connectionState !== 'connected') {
      return;
    }

    try {
      const stats = await peerConnection.getStats();
      let selectedPair = null;

      stats.forEach((report) => {
        if (
          report.type === 'candidate-pair' &&
          (report.selected || report.nominated) &&
          report.state === 'succeeded'
        ) {
          selectedPair = report;
        }
      });

      const roundTripTimeMs = selectedPair?.currentRoundTripTime
        ? Math.round(selectedPair.currentRoundTripTime * 1000)
        : null;

      if (roundTripTimeMs === null) {
        setConnectionQuality({ level: 'good', label: 'Connected' });
        return;
      }

      if (roundTripTimeMs < 180) {
        setConnectionQuality({ level: 'good', label: `Good (${roundTripTimeMs} ms)` });
      } else if (roundTripTimeMs < 420) {
        setConnectionQuality({ level: 'fair', label: `Fair (${roundTripTimeMs} ms)` });
      } else {
        setConnectionQuality({ level: 'poor', label: `Poor (${roundTripTimeMs} ms)` });
      }
    } catch {
      setConnectionQuality({ level: 'good', label: 'Connected' });
    }
  }, []);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      const labelByStatus = {
        idle: 'Not connected',
        joining: 'Joining',
        waiting: 'Waiting',
        connecting: 'Connecting',
        reconnecting: 'Reconnecting',
        ended: 'Ended',
        error: 'Needs attention'
      };
      setConnectionQuality({
        level: connectionStatus === 'error' ? 'poor' : connectionStatus,
        label: labelByStatus[connectionStatus] || 'Not connected'
      });
      return undefined;
    }

    collectConnectionQuality();
    const timer = window.setInterval(collectConnectionQuality, 4000);
    return () => window.clearInterval(timer);
  }, [collectConnectionQuality, connectionStatus]);

  useEffect(() => {
    publishDebugSnapshot();
  }, [
    callPhase,
    connectionStatus,
    isSocketConnected,
    localStream,
    mediaError,
    mediaWarning,
    participantCount,
    publishDebugSnapshot,
    remoteStream,
    roomId
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => publishDebugSnapshot(), 1000);
    return () => window.clearInterval(timer);
  }, [publishDebugSnapshot]);

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
    callPhase,
    connectionStatus,
    connectionQuality,
    ensureLocalStream,
    facingMode,
    isSocketConnected,
    joinCall,
    leaveCall,
    localStream,
    mediaError,
    mediaWarning,
    messages,
    participantCount,
    reconnectCall,
    remoteParticipant,
    remoteStream,
    roomId,
    sendMessage,
    startSelfTestCall,
    switchCamera
  };
}

export default useTelehealthSession;
