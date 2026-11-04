'use strict';
const { createLocalDemoController, canReplaceDemoController } = require('./controller.cjs');
const { GEMINI_LIVE_LANGUAGE_CATALOG } = require('../../shared/voiceLanguageCatalog.cjs');
const byId = id => document.getElementById(id);
let controller, state, changing = false;
const language = byId('language'), consent = byId('consent');
for (const item of GEMINI_LIVE_LANGUAGE_CATALOG) {
  const option = document.createElement('option'); option.value = item.code;
  option.textContent = `${item.name}${item.support === 'experimental_observation' ? ' (experimental)' : ''}`;
  language.append(option);
}
language.value = 'ha';
const supported = window.isSecureContext === true && typeof window.AudioContext === 'function' && typeof window.AudioWorkletNode === 'function';
function render(next) {
  state = next; const running = !['idle', 'stopped', 'failed'].includes(next.phase), ready = ['listening', 'speaker_paused'].includes(next.phase);
  byId('status').textContent = ({ idle: 'Ready for generated tones', authorizing: 'Starting local simulation', requesting_microphone: 'Creating generated input, not requesting a microphone', listening: 'Generated audio pipeline running', speaker_paused: 'Output tones muted', stopped: 'Local stop requested', failed: 'Generated audio test unavailable' })[next.phase] || 'Preparing';
  consent.checked = next.consent; consent.disabled = !supported || changing;
  byId('start').disabled = !supported || running || !next.consent || next.loading || changing;
  byId('stop').disabled = !running && !next.consent;
  language.disabled = running || changing;
  for (const id of ['capture', 'speaker', 'reply', 'interrupt']) byId(id).disabled = !ready;
  byId('capture').textContent = next.microphonePaused ? 'Resume generated input' : 'Pause generated input'; byId('capture').setAttribute('aria-pressed', String(next.microphonePaused));
  byId('speaker').textContent = next.speakerPaused ? 'Resume output tones' : 'Mute output tones'; byId('speaker').setAttribute('aria-pressed', String(next.speakerPaused));
  byId('warning').textContent = [next.error, next.cleanupWarning].filter(Boolean).join(' ');
  byId('metrics').textContent = `Generated PCM input frames received: ${next.metrics?.generatedInputFrames || 0}. Simulator output tone attempts: ${next.metrics?.outputToneAttempts || 0}. Injected interruptions: ${next.metrics?.injectedInterruptions || 0}.`;
  byId('captions').replaceChildren(...next.captions.map(fragment => { const p = document.createElement('p'); p.textContent = fragment.text; return p; }));
}
async function replaceController() {
  if (changing) return;
  changing = true;
  if (controller) {
    const receipt = await controller.stop(); await controller.dispose();
    if (!canReplaceDemoController(receipt, controller.snapshot())) {
      byId('warning').textContent = 'Earlier generated-audio cleanup was not confirmed. Close this demo tab before starting another language.';
      byId('start').disabled = true; consent.disabled = true; language.disabled = true; return;
    }
  }
  controller = createLocalDemoController({ language: language.value, createContext: options => new window.AudioContext(options),
    createWorkletNode: (context, name, options) => new window.AudioWorkletNode(context, name, options), pageTarget: window, documentTarget: document, onChange: render });
  changing = false; await controller.load(); render({ ...controller.snapshot(), metrics: {} });
}
consent.addEventListener('change', () => controller?.setConsent(consent.checked));
byId('start').addEventListener('click', () => { void controller?.start(); });
byId('stop').addEventListener('click', () => { void controller?.stop(); });
byId('capture').addEventListener('click', () => controller?.setMicrophonePaused(!state.microphonePaused));
byId('speaker').addEventListener('click', () => { if (state.speakerPaused) void controller?.resumeSpeaker(); else controller?.pauseSpeaker(); });
byId('reply').addEventListener('click', () => controller?.reply());
byId('interrupt').addEventListener('click', () => controller?.interrupt());
byId('evidence').addEventListener('click', () => { byId('report').textContent = JSON.stringify(controller?.evidence(), null, 2); });
language.addEventListener('change', () => { void replaceController(); });
if (!supported) { byId('warning').textContent = 'Open the loopback URL in a browser with AudioWorklet support. This demo never requests microphone permission.'; byId('start').disabled = true; consent.disabled = true; }
else void replaceController();
