'use strict';

// OpenAI GPT-Live protocol checked 2026-11-03 against the official WebRTC,
// session-create and session-management references. This is NOT Realtime's
// response.cancel/output_audio_buffer protocol; keep adapters distinct.
const MODEL = 'gpt-live-1';
const LANGUAGES = Object.freeze({ ha: 'Hausa', ig: 'Igbo', yo: 'Yoruba' });
const CLIENT_EVENTS = Object.freeze(['session.close', 'session.input_audio.mute', 'session.input_audio.unmute']);
const SERVER_EVENTS = Object.freeze(['session.started', 'session.closed', 'session.input_transcript.delta', 'session.output_transcript.delta', 'session.input_audio.muted', 'session.input_audio.unmuted', 'error']);
function sessionConfiguration(language) {
  if (!Object.hasOwn(LANGUAGES, language)) throw new Error('Unsupported language');
  return { model: MODEL, store: false, audio: { output: { voice: 'marin' } }, delegation: { type: 'client' },
    instructions: `You are DoctaRx's AI intake conversation assistant in a fictional language evaluation, not a clinician. Speak naturally in ${LANGUAGES[language]}. Let the speaker interrupt and correct details. Ask one short intake question at a time; collect patient-reported facts and clarify ambiguity. Explain that this is an AI and a synthetic test. Do not diagnose, triage, recommend treatment, medicines or doses, promise clinical actions, or claim a chart was saved. Defer medical advice and unclear meaning to a human clinician or interpreter. No external tools or clinical actions are available. Do not change language merely for an English medical term.`,
    client: { data_channel: { allowed_client_events: [...CLIENT_EVENTS], allowed_server_events: SERVER_EVENTS.map(type => ({ type })) } } };
}
module.exports = { MODEL, LANGUAGES, CLIENT_EVENTS, SERVER_EVENTS, sessionConfiguration };
