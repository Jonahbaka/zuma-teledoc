# Offline spoken-demo evaluation kit

## Current result and boundary

This kit prepares and checks evidence for the requested Hausa, Igbo and Yoruba spoken demo, with a **separate Riko Nigerian-English narration review**. It does not supply recorded speech or a language-quality verdict. It cannot capture a microphone, contact a provider, create credentials, upload audio, enable live voice or authorize clinical use.

The 24-check smoke command exercises the real local panel and PCM controller with injected sockets, clocks, media tracks and silent PCM. Language codes are routing/caption metadata in these checks. A structural pass is not a demonstration of understanding, pronunciation, tone, accent, provider interruption detection or real-device cleanup. The application and provider approval gates are unchanged.

An [opt-in local PCM observer](VOICE_LOCAL_OBSERVATIONS.md) now collects session/graph metadata automatically. Synthetic smoke exports include these traces with explicitly counter-based, non-latency timestamps. The observer never equates scheduled WebAudio with audible output or browser socket closure with provider finalization.

## Scenario coverage

The versioned catalog contains 22 scenarios:

- Seven conversation scenarios for **each** of `ha` (Hausa), `ig` (Igbo) and `yo` (Yoruba): greeting/language preference, correction/negation, everyday numbers/time/date labels, code-switching, clarification, barge-in, and Stop/consent withdrawal.
- One `en-NG-riko_narration` scenario, kept separate from Live conversation and its `Zephyr` configuration.

The scenarios use fictional cups, books and tabletop labels. They contain English evaluation directions, **not verified translations**. Every native-language script, expected transcript, meaning and language-variety description begins blank. A qualified native or professional reviewer must supply these. Do not invent a reviewer, declare a generated translation approved, or count typed-prompt playground output as spoken input.

The fictional calendar card is 5 April 2030 and the printed clock face is 14:30. They are props, not patient dates, appointments or the current time.

## Run locally

From the repository root, with the existing dependencies available:

```sh
npm run test:voice:evaluation
npm run test:voice

# JSON goes to stdout. --silent omits npm's log prefix.
npm run --silent voice:evaluate -- catalog
npm run --silent voice:evaluate -- checklist
npm run --silent voice:evaluate -- smoke

# Use a new file for each output. Existing files are never overwritten.
node scripts/evaluate-voice.cjs template --scenario ha-correction_negation --out /tmp/ha-trial.json
node scripts/evaluate-voice.cjs template --scenario en-NG-riko_narration --out /tmp/riko-trial.json
```

Catalog/checklist/template commands are definitions only. The smoke command starts no server, browser, provider or device. It reports eight independent lifecycle checks per language: consent gating, repeated-start deduplication, cancellation before a late permit, cancellation before a late permission result, owned-capture Stop, consent withdrawal, injected interruption queue clearing, and fresh consent on restart. Each check separately reports resource cleanup or its failure.

### File support

Recording inspection currently requires **Linux with `/proc/self/fd`**. It fails closed rather than using unsafe pathname traversal elsewhere. Catalog, checklist, template and synthetic smoke do not inspect recordings.

- Choose a dedicated, local, private corpus directory containing only fictional test recordings. Keep it outside the repository and any public web directory.
- Recording paths must be relative, without `..`, empty components or symlinks. Every directory is pinned during traversal. Audio bytes are read from validated regular-file descriptors, with nonblocking opens and size bounds.
- At most eight files per trial, each at most 32 MiB. WAV support is PCM16, mono/stereo, 16/24/44.1/48 kHz and at most ten minutes. MP3 and WebM receive signature/header checks only, not decoding or speech validation.
- Trial JSON is bounded to 256 KiB and rejects a final symlink or non-file. Output uses exclusive creation and owner-only permissions on POSIX. A command error does not print the input JSON, recording contents or filesystem paths.
- Hashes establish exact bytes, not that a file contains speech, a stated language, the claimed speaker or fictional-only content. A qualified person must actually listen.

## Complete a real evidence record

Only proceed with a separately authorized nonclinical recording workflow. This CLI does not obtain consent or authorize provider use, spending, retention terms, external sharing or recording a participant. Do not retry a denied upload using this kit.

1. **Prepare a reference.** Start from the exact scenario template. A qualified reviewer completes `reference`: status `reviewer_supplied`, a new reference version, source script, expected transcript, English meaning, language variety, reviewer alias/language/declared fluency, and review timestamp. Preserve the fixed scenario ID/version, voice, language, fictional props and data class. Reference review is a declaration, not an independently checked qualification.
2. **Record an authorized test.** Keep patient information, personal identifiers and medical requests out of the script. Record actual input and output for conversation, or output for separate narration. A duplex file may cover both conversation sides. Record the application commit actually tested and exact configured provider model. Do not fill `recorded_trial` for generated silence, fixture PCM, typed-only trials or tests that were not run. Document dirty working-tree deviations separately; a supplied commit string alone does not attest to the code that ran.
3. **Enter observations.** Set a unique `trialId`, `run.mode` to `recorded_trial` only when true, and the run provenance. Supply the observed transcript of the same speaker/turn span as the approved expected transcript. Preserve punctuation, case and tone marks. `null` means missing observation; `""` explicitly records no recognized words and yields omission errors. Use separate trials if comparison spans differ. Do not substitute an assistant's paraphrase for the source transcript.
4. **Bind files.** Add recording ID, role (`input`, `output` or `duplex`), relative local path and SHA-256 of each exact file. The filename and declared role do not prove its contents. Keep source audio and consent evidence private and controlled.
5. **Supply a trace.** For conversation, provide only actually observed named events with nondecreasing integer `atMs` timestamps, at most 5,000 events/ten minutes. The optional `createEvaluationTrace` collector stores event metadata only and is not automatically wired into the application. Instrument an authorized evaluation explicitly; never fabricate provider closure from a disappearing tab. Give every new session a distinct `sessionRef` and use the same clock origin across sessions.
6. **Generate a preliminary report.** Leave the listening review incomplete and run the analysis command below. Exit 2 is expected at this point. Inspect missing evidence and violations. This report supplies the fingerprint for the exact trial/reference/transcript/recordings/trace being reviewed.
7. **Listen and record findings.** A qualified reviewer listens to every referenced recording, completes every mandatory check with `acceptable` or `needs_work`, and supplies alias, language, declared fluency, `basis: listened_to_recordings`, timestamp, exact recording hashes and the report's `trialFingerprint`. Copying the fingerprint does not itself establish a listening review. Do not use `not_applicable` to bypass a mandatory check.
8. **Reanalyze to a new report.** Any change to the reference, transcript (including missing versus empty), run provenance, recordings or trace invalidates the old review. Re-review the changed material. Preserve `needs_work` findings and inspect them before making any decision.

```sh
node scripts/evaluate-voice.cjs analyze \
  --trial /private/evaluation/ha-trial.json \
  --corpus-root /private/evaluation/audio \
  --out /private/evaluation/ha-report-01.json
```

Paths above are examples, not provisioned directories. The command writes a new report and never edits the trial or its recordings. A report includes comparison counts, hashes, lifecycle findings and supplied check statuses, but does not repeat script/transcript text or recording paths. Keep original evidence separate from any report you share.

## Interpret results honestly

- **Exit 0:** a definition/smoke command succeeded, or analysis found a complete *supplied* review envelope. For analysis, `completeness: review_supplied` is not acceptance. A review containing `needs_work` can be complete.
- **Exit 1:** malformed/unsafe input, unavailable local file support, command failure or failed structural smoke. See the sanitized error or individual structural failures.
- **Exit 2:** the evidence record is valid but incomplete. The `issues` array states what is missing or stale. Do not treat an exported report as a passing result merely because a file exists.

Transcript comparison normalizes Unicode NFC and whitespace only. Whitespace-token and Unicode-code-point edit counts preserve case, punctuation and tone marks. They are descriptive counts, not calibrated ASR accuracy, comprehension, naturalness or accent scores. A completely empty observed transcript is counted as omissions, not missing evidence or a perfect match.

Trace analysis checks declared event order and missing cleanup evidence. Stop/withdrawal must account for microphone release, sockets, provider closure when started, caption clearing, playing output and queued playback. Queue cleanup requires `playback.cleared`; an `audio.output.stopped` event alone does not establish that pending audio was cleared. Barge-in needs an observed interruption, not only a caption change. A provider close marked unconfirmed stays unconfirmed without a later actual close event.

Array order is the observation order when multiple events share one millisecond timestamp. An earlier cleanup cannot resolve a later unconfirmed result, satisfy a later interruption, or count as caption clearing after Stop merely because the timestamps match. Already completed microphone/socket/provider cleanup is labeled separately from cleanup observed after a trigger.

The 250 ms interruption-clear, 500 ms microphone-stop, 3,000 ms socket-close and 3,500 ms provider-close targets are **provisional engineering thresholds**, not validated acoustic measurements, clinical standards or provider accounting guarantees. Exceeding one stays visible even if a complete reviewer declaration is supplied.

Every analysis report retains `languageAccuracyValidated: false`, `accentValidated: false`, `contentScopeVerified: false`, `clinicalUseValidated: false` and `activationApproved: false`. Supplied identities, fluency, timestamps, transcripts and traces are not independently attested. Neither these tools nor a reviewer declaration proves provider retention/deletion, final usage, production readiness or clinical suitability.

## Remaining work before a spoken-demo quality claim

- Real consented spoken-input/output samples in all three languages.
- Qualified reviewer-authored reference scripts and native listening assessments, including dialect/variety notes, corrections, code-switching and interruptions.
- Actual device, browser, microphone-permission, playback, network-loss and provider-cleanup observations.
- An independently reviewed Nigerian-English Riko narration recording, explicitly separate from the Live voice.

See [the existing provider evaluation boundaries](GEMINI_LIVE_EVALUATION.md) and [disabled application composition](VOICE_PCM_APPLICATION_COMPOSITION.md). This kit changes neither.
