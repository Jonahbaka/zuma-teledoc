'use strict';

/**
 * LiveKit token generation service.
 *
 * LiveKit access tokens are HS256-signed JWTs. This module generates them
 * using the jsonwebtoken package (already a project dependency) so the server
 * does NOT need the heavy livekit-server-sdk installed.
 *
 * Required env vars:
 *   NG_LIVEKIT_URL         WebSocket URL of the LiveKit server, e.g. wss://livekit.example.com
 *   NG_LIVEKIT_API_KEY     LiveKit API key
 *   NG_LIVEKIT_API_SECRET  LiveKit API secret
 *
 * Aliases without the NG_ prefix are also accepted.
 */

const jwt = require('jsonwebtoken');

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
 * @param {number}  [options.ttlSeconds=14400] - token lifetime (default 4 h)
 * @param {object}  [options.env]              - process.env override for testing
 * @returns {string} signed JWT
 */
function generateRoomToken(roomName, participantId, participantName, options = {}) {
  const env       = options.env || process.env;
  const { apiKey, apiSecret } = getLiveKitConfig(env);

  if (!apiKey || !apiSecret) {
    const err = new Error(
      'LiveKit is not configured. Set NG_LIVEKIT_API_KEY and NG_LIVEKIT_API_SECRET.'
    );
    err.code = 'SFU_NOT_CONFIGURED';
    throw err;
  }

  const ttl = Number(options.ttlSeconds) > 0 ? Number(options.ttlSeconds) : 14400;
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss:  apiKey,
    sub:  String(participantId),
    name: String(participantName || participantId),
    exp:  now + ttl,
    nbf:  now - 10,
    video: {
      room:                 String(roomName),
      roomJoin:             true,
      canPublish:           options.canPublish           !== false,
      canSubscribe:         options.canSubscribe         !== false,
      canPublishData:       options.canPublishData       !== false,
      canUpdateOwnMetadata: true,
    },
  };

  // LiveKit accepts HS256 JWTs; noTimestamp avoids a duplicate iat claim.
  return jwt.sign(payload, apiSecret, { algorithm: 'HS256', noTimestamp: true });
}

module.exports = { getLiveKitConfig, isLiveKitConfigured, generateRoomToken };
