'use strict';
const { WebhookReceiver } = require('livekit-server-sdk');
const { getLiveKitConfig, disconnectParticipant } = require('./livekitService');

async function receiveEvent(rawBody, authorization, env = process.env) {
  const { apiKey, apiSecret } = getLiveKitConfig(env);
  if (!apiKey || !apiSecret || !Buffer.isBuffer(rawBody)) throw new Error('LiveKit webhook cannot be verified');
  return new WebhookReceiver(apiKey, apiSecret).receive(rawBody.toString('utf8'), authorization);
}

async function recordEvent(pool, event, { disconnect = disconnectParticipant } = {}) {
  const roomId = event.room?.name;
  if (!event.id || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(roomId || ''))) return { ignored: true };
  const room = await pool.query('SELECT id,status FROM ng_conf_rooms WHERE id = $1', [roomId]);
  if (!room.rows[0]) return { ignored: true };
  if (event.event === 'participant_joined') {
    const participant = await pool.query('SELECT status FROM ng_conf_participants WHERE room_id = $1 AND user_id::text = $2', [roomId, event.participant?.identity || '']);
    if (room.rows[0].status !== 'live' || participant.rows[0]?.status !== 'admitted') await disconnect(roomId, event.participant?.identity);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const receipt = await client.query(
      `INSERT INTO ng_integration_webhook_receipts (provider,event_key,event_type,resource_reference,status,processed_at)
       VALUES ('livekit',$1,$2,$3,'processed',NOW()) ON CONFLICT (provider,event_key) DO NOTHING RETURNING id`, [event.id, event.event, roomId]
    );
    if (receipt.rows.length) await client.query(
      `INSERT INTO ng_conf_events (room_id,event_kind,payload_json) VALUES ($1,$2,$3::jsonb)`,
      [roomId, `media_${event.event}`, JSON.stringify({ eventId: event.id, mediaTime: String(event.createdAt || ''), participantIdentity: event.participant?.identity || null })]
    );
    await client.query('COMMIT');
    return { recorded: true, duplicate: !receipt.rows.length };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { receiveEvent, recordEvent };
