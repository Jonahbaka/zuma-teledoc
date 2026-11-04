# Global Gemini Live language catalog

Checked against Google's current primary documentation on 4 November 2026.

## Selected voice model

The existing PCM evaluation path uses Google `gemini-3.8-live` with the Zephyr voice. It is separate from the OpenAI WebRTC comparison path, the fixed Hausa/Igbo/Yoruba text rehearsal, and Riko Nigerian-English narration. The [model page](https://aistudio.google.com/docs/models/gemini-3.8-live) identifies the audio-to-audio model. The [Live capabilities language table](https://aistudio.google.com/docs/live-api/capabilities#supported-languages) is the source for the catalog, not a transcription, translation or TTS product's list.

Google describes 99 languages in that table. It publishes 100 selectable BCP-47 codes because the Norwegian row includes both `no` and `nb`. The catalog preserves those codes and the separate Chinese and Portuguese variants. Native audio language preference is expressed in the system instruction, not an unsupported `speechConfig.languageCode` field.

## African-language coverage

The documented African-language selection is: Afrikaans (`af`), Akan (`ak`), Amharic (`am`), Arabic (`ar`), Hausa (`ha`), Kinyarwanda (`rw`), Oromo (`om`), Somali (`so`), Southern Sotho (`st`), Swahili (`sw`), Tswana (`tn`), Wolof (`wo`), Yoruba (`yo`) and Zulu (`zu`). Arabic is included for its extensive use across Africa. International languages used across African markets, including English, French, Portuguese and Spanish, remain available in the broader catalog rather than being described as uniquely African languages.

Igbo (`ig`) is preserved as a separate experimental evaluation option. It is absent from the checked provider table. Earlier typed-input playground transcripts and an audio-player observation are not native-speaker listening evidence, a spoken-input test, documented support or clinical validation. Igbo is therefore excluded from the public provider-documented coverage list without removing the existing internal evaluation path.

## Implementation

`shared/voiceLanguageCatalog.cjs` supplies the browser choice list, server transport configuration, WebSocket admission, capability metadata and public homepage names. The catalog contains 100 provider-documented codes plus the one experimental Igbo option. The homepage highlights all 14 documented African languages and offers the remaining documented names in an expandable list. Its global positioning does not limit the platform to Nigeria or Nigeria's languages. Provider signup remains linked to the existing registration route; this change does not create country eligibility rules, change licensing requirements, or grant new access to clinical data.

The Gemini audio selector is independent from the three-language fixed text rehearsal and OpenAI comparison. Changing the audio language disposes the previous panel/session and requires fresh consent. Existing per-language evaluator, processor and consent checks remain mandatory. Adding a name to the catalog does not broaden any existing approval, install an approval source, read a credential, enable a provider connection or bypass the production gate.

## Verification boundary

Structural tests exercise catalog integrity, fixed nonclinical configuration, synthetic PCM for each code, server admission and language-specific authorization. Public markup tests ensure the documented names appear and experimental Igbo is not promoted as documented support. They do not measure pronunciation, meaning, dialect coverage, translation, turn taking, native-speaker acceptance, real-device behavior or clinical suitability.

The original 22-scenario evidence kit and 24-check smoke remain a Hausa/Igbo/Yoruba fixture suite. They do not become coverage claims for every catalog language merely because the registry has grown. Additional spoken evaluation references and recordings must be supplied and reviewed separately before quality or activation claims. No new real provider session, patient data, credential, upload, deployment or paid CI was used for this expansion.

Public copy remains concise, with evaluation status and deployment conditions maintained here and in the internal development UI. The existing [homepage release gate](../HOMEPAGE_VOICE_LAUNCH_GATE.md) still applies to the unpublished design.
