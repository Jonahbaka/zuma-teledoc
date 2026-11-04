# Synthetic voice browser QA

This is a standalone, test-only browser harness for the implemented live-audio panel. It is not a live speech demonstration and must not be deployed as a clinical application.

## What runs

The bundle renders the actual `LiveVoicePrototype` component and actual browser session controller, plus the optional `CameraPreviewPrototype` with its fictional-only local controller. Requests pass through the actual Express live router, broker, evaluation-policy adapter, OpenAI request adapter and sideband implementation. The fixture replaces:

- Application identity and approval records with explicitly fictional records.
- The browser microphone, media peer, data channel, speaker playback and permission result with deterministic fake objects.
- Provider HTTP and WebSocket I/O with in-process fakes. No provider network request is made.
- The normal HTTP client with a same-origin fixture client. It does not exercise the real JWT/current-session database or the complete Next application shell and styles.

The fake captions in Hausa, Igbo and Yoruba are unreviewed fixture strings. This suite cannot establish fluency, pronunciation, audio latency, native browser permission-dialog behavior, genuine conversational barge-in or clinical translation quality.

## Isolation

`tests/voice-browser/server.cjs` refuses to initialize unless both `NODE_ENV=test` and `DOCTARX_VOICE_BROWSER_FIXTURE=true` are set. Its CLI binds only to `127.0.0.1`, expires after 15 minutes and cleans up its owned fake sessions. It is never imported or mounted by the application.

The harness rejects non-loopback hosts, cross-origin requests, missing mutation origins, unexpected fixture authorization and arbitrary caption text. The browser receives `Permissions-Policy: microphone=(), camera=(), geolocation=()` as a second boundary against accidental native capture. CSP confines connections and scripts to the fixture origin. Playwright blocks and fails on unexpected external requests. There are no real credentials, patient identifiers, free-text inputs, chart writes, model tools, persistence or production flags to enable this fixture in the app.

## Run in a supported CI runner

Use the existing lockfile and Node 22. Do not work around a browser or filesystem security denial in a restricted executor.

```sh
npm ci
npx --no-install playwright install --with-deps chromium
npx --no-install playwright test --config=playwright.voice.config.cjs
```

The Playwright configuration starts its own test server, refuses to reuse an unknown server on port 3219, uses one worker and performs no retries. No production build or real microphone permission is needed. The small fixture bundle uses the already-installed Webpack and Next compiler, with no new dependency.

Safe non-browser checks, which do not launch Chromium:

```sh
NODE_OPTIONS=--max-old-space-size=384 RAYON_NUM_THREADS=1 node tests/voice-browser/build.cjs
node --test server/tests/voice/voice-browser-fixture.test.js
npx --no-install playwright test --config=playwright.voice.config.cjs --list
```

## Prepared coverage

There are 16 cases in each of desktop Chromium and mobile Chromium, for 32 discovered cases:

- Each of Hausa, Igbo and Yoruba: language selection, pre-consent/no-capture gate, held permission, fake two-way captions, local speaker mute/resume and consent revocation.
- Permission denial without provider creation.
- Cancellation while permission is pending, including a late grant that must not revive capture.
- Microphone device loss.
- Processor approval and evaluator role revocation, including denial of a new capture.
- Language change ending the old session and clearing consent.
- Component unmount cleanup.
- Main-region accessibility and horizontal layout checks.
- Optional fictional camera: separate simulated permission, fixed-object frame selection/removal and withdrawal, refusal, device loss, language reset, pending-permission cancellation and unmount. These never use native camera access or image processing.

Successful browser runs save synthetic screenshots, traces on failure and the HTML report beneath the Git-ignored `artifacts/voice-browser/` directory. ESLint excludes only its generated `bundle/` subtree, not test source. These artifacts must be labeled synthetic. Native media, actual provider/account/usage/retention, full application authorization, device acoustics and human/native-language evaluation require separate approved tests.

## Evidence at this checkpoint

- Fixture bundle compilation: passed.
- Three executed loopback HTTP/isolation tests: passed. These verify the test-only gate, origin/auth/native-capture restrictions and real broker/policy behavior with the fake provider.
- Playwright discovery: 32 cases found successfully (22 voice and 10 optional fictional-camera cases).
- Rendered interactions: **not executed**. The supported cloud browser could not reach the owned loopback probe (`ERR_CONNECTION_REFUSED`). The earlier executor Chromium launch was sandbox-blocked; no bypass or repeated sandbox launch was attempted for this suite.
- Screenshots, axe results and browser case pass counts: **not yet available**. Compilation, test discovery and HTTP assertions are not substitutes for a rendered pass.
- The denied repository upload, production application routes and live activation remain unchanged.
