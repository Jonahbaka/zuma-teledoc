# Clinical journey audit: local candidate, 4 November 2026

Base: `a574572`. This audit and the accompanying local fix do **not** certify production readiness or clinical/regulatory compliance. No production deployment, remote write, paid CI, real patient record, or external provider credential was used.

## Reproduced and fixed: camera/microphone lifecycle

The active one-to-one video implementation is `lib/useTelehealthSession.js`, used by both dashboard patient/provider appointment call pages. The Nigeria appointment call pages reuse those pages. It is a different implementation from the Nigeria conference signaling hook.

Before the fix, seven new tests failed against this hook:

- A camera/microphone request could resolve after its eight-second timeout and keep its abandoned tracks alive.
- Leaving or navigating away did not invalidate a pending permission request. A late stream could be published after cleanup.
- An old pending request could survive leave and interfere with a newer retry.
- A permission rejection after navigation could start more fallback permission requests.
- A camera-switch request could complete after navigation and retain the new camera.
- Leaving waited for the signaling acknowledgement before stopping active tracks.
- A duplicate-tab takeover disconnected signaling but kept media alive and the old session eligible to rejoin.

A further test reproduced a late HTTP join result reestablishing signaling after leave. The fix now disposes late streams, invalidates abandoned operations, retains a newer pending request when an older one finishes, stops capture immediately on leave, rejects stale joins, and releases devices on duplicate-tab replacement. Camera-switch clicks share one request and preserve the disabled-camera track state. Leave removes signaling listeners before waiting, preventing a late offer from recapturing devices.

Independent review rejected the first local fix (`98a27d2`) before integration. It found that mounted SelfView effects could reacquire capture after the hook published a null stream during hangup or duplicate-tab takeover. It also reproduced stale offer acknowledgements overwriting ended state, a replacement camera remaining live while `replaceTrack` was pending, and an incoming rollback rejection recreating a peer after unmount.

The correction closes a dedicated acquisition gate before teardown publishes state; only a subsequent explicit join can reopen it. Captured replacement streams become owned resources before sender replacement begins. Negotiation continuations check both session generation and peer identity after each awaited operation. Repeated leave requests are serialized, and joining while leave is pending is rejected. The independent five-case reproduction passes on the corrected hook, in addition to the committed 25-case suite covering delayed success and failure at incoming/outgoing negotiation boundaries and actual SelfView rerenders.

Regression coverage: `server/tests/telehealth-media-lifecycle.test.js` is included in `npm test`. It executes the actual transpiled hook, the shipped provider SelfView component effects with retained hook state/dependencies, and controlled device, peer, socket, and HTTP dependencies. It is not physical-device or browser-media evidence.

## Validation actually performed

- Focused journey/video run: **255 passed, 7 skipped, 0 failed** (262 tests across 25 files, 17 nested suites). The skips are explicit PostgreSQL cases because no isolated database target was provided.
- All 25 lifecycle cases pass, including success, timeout, interrupted capture, repeated camera switch, leave, stale HTTP join, and replacement cases.
- Full `npm run lint`: **0 errors, 28 existing warnings**. Focused lint for both changed JavaScript files: no warnings/errors.
- `git diff --check`: passed.
- Production build, full `npm test`, actual browser call, database migration/recovery, and production smoke tests: **not run by this audit**. Build is delegated to the combined candidate validation to avoid competing heavy builds.

Local, uncommitted corrected evidence logs are `artifacts/clinical-journey-audit/focused-tests-corrected.log`, `lint-corrected.log`, and `independent-repro-corrected.log` (the latter two in the same directory) in the audit worktree. These logs should not be confused with old release evidence in the repository.

## Journey inventory and limits

| Journey | Active implementation inspected | Current local evidence | Still not established |
|---|---|---|---|
| Registration/login | Auth pages, `server/routes/auth.js`, `server/middleware/auth.js`, auth-session service | Session issuance, refresh/account-switch races and authorization tests passed; public roles limited; providers require approved status to use protected APIs | Fresh signup, email verification delivery, MFA UI, recovery, and signup rollback with a real isolated DB were not exercised |
| Booking/current visits | Patient booking/list/detail pages, appointments routes | Booking interruption/repeat-submit/reconciliation, intent/payload/scope and ongoing-visit navigation tests passed | Rendered end-to-end booking and real DB concurrency are not established by this run |
| One-to-one appointment video | Shared appointment call pages and `lib/useTelehealthSession.js`; telehealth session service | New lifecycle regressions pass; auth/consent and socket refresh tests pass | Camera hardware, browser autoplay, NAT traversal, relay-only TURN, long-call/reconnect media continuity, and mobile backgrounding were not exercised |
| Multi-person conference | `components/ng/conference/NGVideoCall.jsx`, `useConferenceSignaling.js`, NG conference services/routes | Membership/role/admission, media readiness, LiveKit contract, callback failure/cleanup tests pass | Live 3/5/10-party SFU, adverse networks, physical devices, and production credentials/host readiness were not tested |
| Secure messaging | `server/routes/messages.js`, message services and socket session authorization | Recipient/care/market scope, audit/transaction handling, current socket authority, and refresh tests passed | Actual two-user browser inbox/call chat and DB persistence are not established by this run |
| Prescription/pharmacy | NG prescriber/pharmacist gateways and patient combined listing | Current authority, suspension/market/ownership checks, audit failure handling, quantity holds and patient list tests passed | Actual prescribing/dispensing UI, pharmacy partner delivery, payment, courier and stock-concurrency DB execution were not tested here |
| Referral | Referral composer/worklist and manual referral services | Intent idempotency, authority, interrupted mutation/recovery and actionable receiver tests passed | Actual external receiver delivery/acceptance and database execution were not tested |
| EMR/consent | Medical records and clinical encounter APIs; patient visit continuity | Clinical integrity, revisions/authority, consent and active visit continuity suites passed | DB-only integrity cases skipped; rendered encounter/note workflow, FHIR interoperability, restore and operational retention are not established here |

## Remaining findings requiring verification

1. **Registration was not atomic at this audit base (source inspection, not fault-injection reproduction in this audit).** `server/routes/auth.js` inserts the user, then updates Nigeria market metadata in a swallowed-error block, then creates subscription/verification/session records in separate calls. A downstream failure can leave an account despite a failed response; a failed metadata update may leave NG registration with the default market. A separate signup fix has since been integrated at `2d102c6`; its evidence and remaining real-PostgreSQL/ambiguous-COMMIT limitations belong to that review, not this video branch.
2. **TURN and real-network readiness remain unproven.** `server/services/telehealthSessionService.js` warns and falls back to STUN when TURN configuration is incomplete. `scripts/e2e-ng-video-call.cjs` uses fixture signaling and local browsers; it cannot certify restrictive-NAT production connectivity. `scripts/e2e-livekit-sfu.cjs` is a separate credential-dependent test, not evidence produced here.
3. **Quality/resilience test scope is broader than the active appointment UI.** `NetworkQualityBadge.jsx` and its bandwidth/loss/fallback core have no app/component callers. The active one-to-one hook samples RTT only and shows "Connected" when stats are unavailable. NG LiveKit room UI listens to SDK reconnect events, but that is not measured network-recovery evidence.
4. **Historical readiness documents overstate current certainty.** `FEATURE_INVENTORY.md`, `PRODUCTION_READINESS.md` and `OPEN_BLOCKERS.md` contain August release claims. `README.md` also claims HIPAA compliance. None is evidence that this November candidate has completed production, physical-device, institutional, or regulatory acceptance.

## Next acceptance evidence

Validate the final combined commit, not just this branch: production build/full suite, isolated PostgreSQL migrations and skipped DB tests, authenticated desktop/mobile patient-provider-pharmacy journey, and actual two-party video with controls/chat/rejoin. For broad internet or multi-party readiness, add relay-only TURN and live SFU adverse-network tests with approved sandbox configuration. Until those pass, distinguish implemented code and passing hermetic checks from production readiness.
