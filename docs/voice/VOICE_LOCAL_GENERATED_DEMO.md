# Credential-free generated-audio developer demo

This is a separate local developer tool, not a live AI conversation or a clinical feature. It does not activate `/voice-lab`, bypass application authentication, mount a provider, or change production gates.

## Run it

From an existing non-production checkout with its dependencies installed, run:

```sh
npm run voice:demo:local
```

Open the printed `http://127.0.0.1:<port>` URL **on the same computer**. A cloud executor's loopback URL is not a public link and cannot be opened from another computer without a separately authorized environment setup. The server accepts no CLI arguments, binds a random IPv4 loopback port, rejects other hosts/origins and closes after 20 minutes or Ctrl+C. It refuses `NODE_ENV=production`. No package installation, key, Google login, database or microphone permission is needed.

1. Keep speaker volume low. Choose a language routing code and acknowledge generated-tone playback.
2. Start. The browser creates a quiet 220 Hz oscillator connected only to a generated MediaStream, not directly to the speakers. The existing 16 kHz capture AudioWorklet processes that stream.
3. The in-memory simulated provider counts PCM frames. It emits a quiet 440 Hz output tone and fixed English transport markers through the existing 24 kHz playback graph. Five received input frames trigger another fixed response.
4. Pause generated input, mute output, send a one-second tone, and interrupt queued output. These actions test plumbing; they do not test AI turn-taking or human interruption detection.
5. Stop and clear. Hiding/leaving the page or the 30-second session deadline also ends the session. A new run needs a new acknowledgment. Changing language requires the prior cleanup to settle; unconfirmed cleanup blocks that switch.
6. Show local run details. The report contains bounded metadata, not raw audio or a transcript recording. Refresh the report after Stop to inspect cleanup. A failure to confirm cleanup remains visible.

The generated source owns an extra AudioContext. Its separate cleanup result is joined with the shared PCM graph's receipt. A clean graph receipt alone cannot establish that the generated source closed. Source shutdown is bounded, including delayed startup, failures and repeated Stop.

## What is real and what is simulated

When run successfully in a browser, the page uses real browser AudioContexts, a generated MediaStream, the repository AudioWorklet, PCM framing and scheduled playback. It never calls the browser microphone API. All provider events, authorization identity, consent permit and text markers are local fixtures. No WebSocket or external network connection is created; the inert `.invalid` HTTPS origin exists only to exercise the unchanged controller with an injected socket.

The shared event names `microphone.started` and `provider.ready` describe the generated-source/provider-simulator roles here. They are not observations of a microphone or Google. The report always leaves audible playback, spoken-language accuracy, clinical use and activation unverified. Tone attempts are not proof of scheduled or heard audio. The 100 documented language codes plus experimental Igbo selection exercise routing only; every selection produces the same generated tones and fixed English markers.

The standalone server builds an explicit local browser bundle with the already installed webpack dependency. It serves four allowlisted assets, disables caching, denies framing, disallows external connections, and denies microphone/camera permissions. It never serves arbitrary repository paths or accepts uploads.

## Current verification

Automated checks execute the real controller composition using fictional browser-shaped objects for all 101 choices, plus the real local bundle build and HTTP asset server. These checks do not prove browser autoplay, rendering, AudioWorklet execution, actual sound, accessibility or device compatibility. Rendered-browser and listening checks remain pending in the current executor because its browser launch was previously blocked by environment socket restrictions; no bypass was attempted.

## Move from tones to an actual spoken Gemini demonstration

This tool is not an activation bridge. Keep the generated-tone simulator separate. The real application uses the following already implemented, currently disabled composition:

- Runtime: `createVoicePcmRuntime` in `server/services/voice/voicePcmRuntime.js`.
- Provider: Google Gemini **Developer API**, model `gemini-3.8-live`, voice `Zephyr`. Riko remains a separate narration reference. The owned WebSocket candidate is `createGeminiOwnedWebSocketClientFactory`, using the existing `ws` dependency and the pinned `generativelanguage.googleapis.com` v1beta Live endpoint. The SDK comparison factory is test-only.
- Exact binding fields: `provider`, `accountRef`, `projectRef`, `model`, `region`, `termsVersion`, `retentionVersion`. The candidate accepts `region: provider_global`; that records the absence of a regional processing guarantee, not a residency promise.
- Existing current-session authority: a designated `sessionPool` for the read-only session snapshot adapter, an authenticated clinician/admin identity, and matching HTTP/WebSocket session correlation.
- Approval reader: a fresh consistent `readApprovalSnapshot` for the named evaluation and language, covering evaluator grant, explicit fictional-audio consent, processor approval, zero-charge budget, and current verified project billing/eligibility evidence. The policy requires observed evidence no older than one second. Re-stamping an old manual observation cannot satisfy this requirement honestly.
- Credential reader: a reviewed enrollment reference and revision, matching key fingerprint, current non-revoked enrollment metadata, an authorized server-side read-only secret accessor, and the reviewed synchronous client factory. The fingerprint checks equality, not account ownership or retention terms.

**Still missing:** the chosen Google account/project and named development server; authoritative approval/enrollment/billing adapters; approved existing-credential access/configuration; applicable terms/processing review; actual HTTPS/browser/proxy/device acceptance; real provider setup/closure evidence; and native-speaker listening review. No existing environment flag or this local demo supplies those items. No credential creation, persistent grant/configuration, source upload, deployment or paid usage is performed or authorized by this document.

For onboarding, first identify the exact account, project and server using non-secret metadata. Google associates each API key with a project, and new AI Studio keys are service-account-bound authorization keys. A Studio login is not a verified application credential. Any creation or persistent configuration needs its own explicit approval and secure input mechanism. Do not paste keys into chat, screenshots, source or this demo. [Google key documentation](https://aistudio.google.com/docs/api-key).

Google currently documents `gemini-3.8-live` as its stable low-latency audio model and lists free input/output for the Free Tier. That does not prove a particular project's eligibility. If Free Tier is unavailable, stop this no-charge path; another key does not fix project eligibility and upgrading does not unlock free quota. Paid spend caps can overrun because enforcement/accounting is delayed. [Model](https://aistudio.google.com/docs/models/gemini-3.8-live), [pricing](https://aistudio.google.com/docs/pricing#gemini-3.8-live), [eligibility](https://aistudio.google.com/docs/troubleshooting#free-tier-unavailable), [billing](https://aistudio.google.com/docs/billing#project-spend-caps).

Google's Developer API terms prohibit clinical practice and medical advice. Unpaid services can use submissions for improvement and human review, so an authorized future demonstration must remain fictional, adult, nonclinical and free of personal/confidential data. The terms also impose location-specific conditions, including Paid Services for clients available in EEA/UK/Switzerland. These are provider-specific gates for this evaluation, not limits on DoctaRx's global platform vision. [Current terms](https://aistudio.google.com/docs/terms). Official sources checked 2026-11-04; recheck before any real connection.

See [the secure connection checklist](GEMINI_FREE_DEMO_CONNECTION.md) and [application composition](VOICE_PCM_APPLICATION_COMPOSITION.md) for the existing trust boundaries.
