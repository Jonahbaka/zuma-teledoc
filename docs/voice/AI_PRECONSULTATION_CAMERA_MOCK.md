# AI pre-consultation assistant: optional camera mock

## Implemented scope

This is an optional, development-only interface rehearsal added to the authenticated synthetic voice lab. It is **not a video consultation, a functioning camera capture path or a clinical assistant release**. The only source is a fixed set of three illustrated objects: a blue notebook, green cup and yellow card. No person, photograph, patient, native camera, recording or model is used.

The panel starts off and asks for a separate local-demo acknowledgment. Starting the mock then presents an explicitly simulated camera permission choice. Neither action is patient consent or authorization to send images. The normal browser camera permission dialog is never called.

The evaluator can preview the fictional scenes, select up to three unique frames, inspect their local source/language metadata, remove individual selections and withdraw consent. Frames cannot be submitted. The UI makes no diagnosis, treatment recommendation or inferred visual observation. There is no upload, image byte encoding, network request, local storage, clinical document import or chart write.

`CameraPreviewPrototype` is mounted only inside the enabled, authenticated clinician/admin branch of `VoiceIntakeLab`. The existing server page remains restricted to `NODE_ENV=development` plus `DOCTARX_VOICE_SYNTHETIC_ENABLED=true`; production still returns 404. This mock does not enable live speech or configure a provider. Its standalone browser-test mount remains test-only, denies native camera and microphone by Permissions Policy, and has no application mount.

## Lifecycle and revocation

`lib/voice/syntheticCameraPreview.cjs` owns the local consent and resource lifecycle. It accepts only a fictional-camera adapter and only fixed scene identifiers. It has no generic image or model-input channel.

- Consent withdrawal, Stop, device-loss simulation, page hide, tab becoming hidden, component unmount, identity/role/language change and the three-minute timeout clear preview and all selected-frame metadata.
- Only a current permitted identity/role/language scope can start. Prop changes dispose the old scope and require fresh acknowledgment.
- A late permission grant, selected-frame completion, device-ended callback or queued timeout from an old session cannot alter the newer session.
- Expiration is checked after asynchronous permission/frame results and before selection operations, including when a background timer is delayed.
- Removing a selection wins over an older pending reselection.
- The controller returns copied selection metadata. No image pixels or personal data are created or retained.

## Provisional live voice plus vision boundary

The architecture direction is a natural live-audio frontend plus a separately authorized vision backend. It does **not** select an Astra product/model yet. The [official live delegation guide](https://developers.openai.com/api/docs/guides/live-delegation#add-images-and-visual-context) describes keeping images on the vision/backend path and returning bounded text context to the live conversation. This is a design reference, not evidence of an account integration.

The current mock does not construct or send a model request. A later adapter would need all of the following before receiving any genuine frame:

1. An explicit product decision on patient-selected still frames versus continuous sampling. This mock exercises selected frames only, not a continuous video stream.
2. Separate, current authorization for native camera use and image processing, bound to evaluator/patient, encounter, purpose, language, exact provider/account/project/model, region, terms and retention versions. Existing voice consent must not be reused as image consent.
3. Server-owned authorization and a fresh revocable processing lease, enforceable spend control, real provider/account binding, and approved retention/logging behavior. Approval metadata alone is not a spend cap or a guarantee that captured content contains no patient data.
4. Bounded image size/count, current frame/session revisions, cancellation on withdrawal, and rejection of stale results. A local preview must stay separate from the explicit decision to send a selected frame.
5. A clinician-review draft that separates patient-reported facts from provisional model observations, retaining source/time and uncertainty. No autonomous diagnosis, treatment, vital-sign estimation, identity/emotion inference, chart import or prescribing path is in scope.
6. Approved real-device/provider tests and Hausa/Igbo/Yoruba native-language evaluation. This mock proves none of those capabilities.

Actual camera, provider, processing permission, credential, retention, clinical or publication work remains outside this commit.

## Validation and limitations

- Seventeen new executed Node tests exercise fixed-frame selection, all three language scopes, separate consent/permission, refusal, withdrawal, expiry, fake device loss, asynchronous stale results and source isolation contracts.
- The full voice suite passes all 94 tests with zero failures or skips. Full lint passes with zero errors and 28 existing warnings. React event behavior and source-contract assertions are distinct from rendered browser evidence.
- Five new Playwright scenarios cover selection/removal/withdrawal, permission refusal, device loss, language change and cancellation/unmount, in desktop and mobile configurations. They remain unexecuted until a supported browser runner is available.
- The small fixture bundle compiled the actual panel successfully; Playwright discovery found all 32 prepared cases. It has no screenshots or browser pass proof until the cases run successfully.
- The supported cloud browser cannot reach this executor's loopback fixture. Prior executor Chromium launch was sandbox-blocked. Do not bypass either boundary or present this mock as a recorded/live product interaction.

See [browser QA instructions](VOICE_BROWSER_QA.md) for the safe CI command and artifact expectations. The frozen repository upload payload is separate and unchanged.
