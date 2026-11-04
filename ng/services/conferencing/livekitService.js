'use strict';

/**
 * LiveKit token generation service.
 *
 * Uses the official SDK for tokens and server room controls. Application
 * membership and clinical permissions remain authoritative on the server.
 *
 * Required env vars:
 *   NG_LIVEKIT_URL         WebSocket URL of the LiveKit server, e.g. wss://livekit.example.com
 *   NG_LIVEKIT_API_KEY     LiveKit API key
 *   NG_LIVEKIT_API_SECRET  LiveKit API secret
 *
 * Aliases without the NG_ prefix are also accepted.
 */

const { AccessToken, RoomServiceClient, TrackSource } = require('livekit-server-sdk');
const { effectivePermissions } = require('../../../lib/ng/conferencePermissions');

function participantMediaGrants(role, overrides) {
  const permissions = effectivePermissions(role, overrides);
  const sources = permissions.speak ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [];
  if (permissions.share_screen) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  return {
    canPublish: sources.length > 0,
    canPublishSources: sources,
    canSubscribe: permissions.see_video === true,
    canPublishData: permissions.send_chat === true,
    canUpdateOwnMetadata: false,
  };
}

function roomService(env = process.env) {
  const { url, apiKey, apiSecret } = getLiveKitConfig(env);
  if (!url || !apiKey || !apiSecret) throw new Error('LiveKit room controls are not configured');
  const host = new URL(url);
  host.protocol = host.protocol === 'wss:' ? 'https:' : host.protocol === 'ws:' ? 'http:' : host.protocol;
  return new RoomServiceClient(host.toString(), apiKey, apiSecret);
}

async function disconnectParticipant(roomName, identity, env = process.env) {
  const client = roomService(env);
  try { await client.removeParticipant(roomName, identity, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) }); }
  catch (error) { if (error.status !== 404 && error.code !== 'not_found') throw error; }
}

async function updateMediaPermissions(roomName, participant, env = process.env) {
  await roomService(env).updateParticipant(roomName, participant.user_id, {
    permission: participantMediaGrants(participant.role, participant.permissions_json),
  });
}

async function closeMediaRoom(roomName, env = process.env) {
  try { await roomService(env).deleteRoom(roomName); }
  catch (error) { if (error.status !== 404 && error.code !== 'not_found') throw error; }
}

function getLiveKitConfig(env = process.env) {
  return {
    url:       env.NG_LIVEKIT_URL       || env.LIVEKIT_URL       || null,
    apiKey:    env.NG_LIVEKIT_API_KEY    || env.LIVEKIT_API_KEY    || null,
    apiSecret: env.NG_LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET || null,
  };
}

function isLiveKitConfigured(env = process.env) {
  const { url, apiKey, apiSecret } = getLiveKitConfig(env);
  return Boolean(url && apiKey && apiSecret);
}

/**
 * Generate a LiveKit participant token for the given room.
 *
 * @param {string} roomName        - LiveKit room name (we use the ng_conf_rooms UUID)
 * @param {string} participantId   - stable unique identity for this participant
 * @param {string} participantName - display name shown in the LiveKit client
 * @param {object} [options]
 * @param {boolean} [options.canPublish=true]
 * @param {boolean} [options.canSubscribe=true]
 * @param {number}  [options.ttlSeconds=900] - initial-join token lifetime
 * @param {object}  [options.env]              - process.env override for testing
 * @returns {string} signed JWT
 */
async function generateRoomToken(roomName, participantId, participantName, options = {}) {
  const env       = options.env || process.env;
  const { apiKey, apiSecret } = getLiveKitConfig(env);

  if (!apiKey || !apiSecret) {
    const err = new Error(
      'LiveKit is not configured. Set NG_LIVEKIT_API_KEY and NG_LIVEKIT_API_SECRET.'
    );
    err.code = 'SFU_NOT_CONFIGURED';
    throw err;
  }

  const requestedTtl = Number(options.ttlSeconds ?? env.NG_LIVEKIT_TOKEN_TTL_SECONDS ?? 900);
  const ttl = Number.isInteger(requestedTtl) ? Math.min(3600, Math.max(60, requestedTtl)) : 900;
  const token = new AccessToken(apiKey, apiSecret, { identity: String(participantId), name: String(participantName || 'Participant'), ttl });
  token.addGrant({
    room: String(roomName), roomJoin: true,
    canPublish: options.canPublish === true,
    canPublishSources: options.canPublishSources || [],
    canSubscribe: options.canSubscribe === true,
    canPublishData: options.canPublishData === true,
    canUpdateOwnMetadata: false,
  });
  return token.toJwt();
}

module.exports = { getLiveKitConfig, isLiveKitConfigured, generateRoomToken, participantMediaGrants, disconnectParticipant, updateMediaPermissions, closeMediaRoom };
