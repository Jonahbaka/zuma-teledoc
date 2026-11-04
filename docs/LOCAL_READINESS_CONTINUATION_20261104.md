# Local readiness continuation — 4 November 2026

The imported patch was verified as 722,878 compressed bytes with SHA-256
`5d4b9b73af6d504a5ce274c9c6f2282caa57e7bf5d04423aea94edeb168898d9`.
Applying it to integration commit `195a5a254188b51f060abf1c3e74224532aa6b03`
produced exactly tree `1d1314762bbb064ef55891f80f86f93e52744d1b`.
This preserves the supplied work through source commit `42e2ce8`; it is a
snapshot import, not a reconstruction of the source commit history.

## Changes after the imported patch

- Fixed a browser-only live WebRTC startup/cleanup failure: default native timers
  now retain the global receiver. Actual Chromium tests previously raised
  `Illegal invocation` before microphone permission.
- Allowed a strictly bounded 50 ms PostgreSQL observation clock lead, clamping
  it to receipt time. A one-millisecond host-clock difference reproduced a false
  authority failure on Windows. Stale/slow reads, revoked sessions and expiry
  remain denied; this does not extend a permit or refresh-token lifetime.
- Corrected the regional appointment fixture to use the actual `canceled` enum.
  Made the injected Gemini provider retain callbacks per connection, and wait
  for observed asynchronous cleanup rather than assuming one event-loop turn.
- Replaced public credential-document writes with encrypted private files and
  owner/current-market-reviewer downloads. Access requires current account state
  and a successful audit write. New storage follows the external runtime-state
  layout; legacy documents remain on disk and are read only through authorization.
  Static credential URLs, including encoded path variants, return 404. Upload
  and download controls now perform the real API operations.
- Added migration `045_clinical_lab_workflow` and a clinician-owned manual lab
  API/panel, limited to fictional accounts outside production. It records local
  orders, specimen collection/rejection/recollection, immutable encrypted result
  events, corrections, and separate critical-result acknowledgment with action.
  Retry identities, revision checks, current encounter/account locks and atomic
  audit writes prevent duplicate intents, stale acknowledgment and unauthorized
  reads. An unacknowledged critical handoff cannot silently become noncritical.

## Deliberate remaining boundaries

The medical live-voice feature is not clinically activated. Existing adapters
and microphone/speaker transports remain distinct from the tone rehearsal.
The current checkout has no approved clinical processor/account agreement,
server credential binding, encounter-specific clinical voice consent, reviewed
language admissions or live-provider speech acceptance evidence. Synthetic
evaluation consent does not authorize patient audio. See the existing medical
voice integration status document for required inputs.

The manual lab workflow is local fictional-data functionality, not an external
laboratory integration. Test catalogue approval, laboratory/technician identity,
partner transmission/receipts, automated alert delivery and escalation ownership,
clinical timing policy, patient release, and historical encryption-key retention
remain prerequisites for production. The ordering clinician records source
criticality; no invented clinical thresholds are applied. Existing public
laboratory availability controls stay unavailable. The endpoint refuses
production use and non-test patient/provider accounts.

Credential files are downloadable attachments, never inline active content.
Signature validation is not a malware scanner. Existing plaintext credential
documents need a separately reviewed migration/retention plan. The patch's
verified database certificate configuration is retained; no certificate checks
were disabled to accommodate this workstation.

Whole-release deployment quarantine remains enforced. Linux process/filesystem
foundation tests now pass without skips; an authorized host-specific rehearsal
with the actual application and writers is still required. A PostgreSQL restore is not proof of a
complete application/configuration/worker rollback. No deployment or paid CI
is authorized by this document or by local test success.

Validation must be recorded against the final commit, outside this source
document, including any unsupported Windows/POSIX checks and real-provider,
physical-device and restrictive-network gaps.

## Continuation: Linux gate and voice fallback reliability

- The agreed voice design is live voice as the primary path, with speech-to-text
  and text-to-speech as fallback. Clinical refinement is deferred by the user;
  no existing voice feature or provider connection was disabled in this work.
- Added a standard public-repository Ubuntu validation workflow with disposable
  PostgreSQL 18, Node 24.22.1, serial bounded test execution, all explicit database
  test files, browser checks, lint, type checking and a production build. It has
  no production credentials or deployment step. Account fixtures require an empty
  loopback `_test` database and cannot reset existing developer accounts.
- Declared the existing browser fixture's missing webpack dependency. Clean
  installs now reproduce the fixture builds. Closed the TLS fixture listener on
  setup errors and gave the image-specific timeout assertion a realistic budget.
- Caption fallback teardown now aborts recognition and in-flight translation,
  drops queued requests and stale callbacks, bounds retained translation work,
  and prevents permission/unsupported-language restart loops. Failed translations
  remain visibly unavailable while original captions are retained.
- The SFU harness verifies increasing audio packets/video frames, remote mute and
  camera state, and clean peer closure using real local Chrome/LiveKit processes
  with generated fictional media. HTTP throttling and page reload are labeled
  accurately; neither proves restrictive WebRTC networks or ICE reconnection.
- Production and auxiliary deployment workflows now require explicit dispatch.
  The external-service SFU workflow also requires explicit dispatch. Updating
  source cannot silently deploy or run load against an externally configured SFU.
