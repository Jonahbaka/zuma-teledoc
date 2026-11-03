# AI-first and language voice homepage launch gate

## Status: Not approved for deployment

This is the requested unpublished, launch-oriented homepage design. The user requested confident AI-first telehealth and multilingual voice positioning without development caveats in public copy. It is not evidence that those voice functions are deployed, clinically validated, or ready for release. Do not publish this version merely because frontend tests pass.

The homepage is isolated on reviewed pharmacy/FHIR commit e2232b3539e1ced3665479ed166afc6a727444c8. It changes marketing, metadata, a generated illustration and their verification only. It does not activate voice, request microphone access, add a voice backend, use real patient data or change any clinical, privacy, financial or deployment settings. The voice link navigates to the description on the page; care links retain the existing market-specific destinations.

## Required before the launch copy can go live

- Integrate and independently review the actual DoctaRx voice experience, including patient authorization, informed consent, microphone lifecycle, interrupted and repeated sessions, retained-data policy and clinician handoff.
- Validate English and Nigerian English, and the initial evaluation languages Hausa, Igbo and Yoruba, using appropriate native-speaker review. A synthetic test or one provider-console response is not proof of language quality or clinical safety.
- Verify the advertised conversation, intake and clinician-review experience end to end in the actual DoctaRx application. Do not substitute provider-console demonstrations or fake-provider tests for this evidence.
- Obtain clinical and privacy approval of the voice workflow, escalation rules, retention and external processing, including relevant provider agreements.
- Run the complete checks on the integrated release tree, including database, browser, accessibility and production-build verification, and obtain explicit deployment authorization. Publishing a draft PR does not satisfy this gate.

## Illustration provenance

The hero is an original GPT image generation made for this task: abstract blue and teal glass speech bubbles, a voice waveform and an ivory clinician symbol. It depicts no real person, patient, medical result or product screenshot. The source PNG is retained in the task environment. The repository asset is a lossless-layout WebP conversion at 1536 × 1024, quality 88, 78,194 bytes.

Asset: `public/marketing/doctarx/ai-language-voice-hero-v1.webp`.

Prompt direction: premium 3D telehealth concept illustration, frosted cobalt and pale mint speech forms linked by a turquoise audio waveform, warm ivory medical and clinician symbols, soft studio light, no text, logos, fake UI, real patients or clinical claims. Generated with the built-in GPT image tool, not an external stock source.
