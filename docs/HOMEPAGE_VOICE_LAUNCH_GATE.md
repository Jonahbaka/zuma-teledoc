# AI-first and language voice homepage launch gate

## Status: Not approved for deployment

This is the requested unpublished, launch-oriented homepage design. The user requested confident AI-first telehealth and multilingual voice positioning without development caveats in public copy. It is not evidence that those voice functions are deployed, clinically validated, or ready for release. Do not publish this version merely because frontend tests pass.

The original homepage design was prepared on reviewed pharmacy/FHIR commit e2232b3539e1ced3665479ed166afc6a727444c8. The 4 November local continuation preserves that homepage, now with the user-approved medical voice hero replacing the earlier maternity image, alongside the latest unpublished voice work. It changes marketing, metadata, a generated image and their verification only. It does not activate voice, request microphone access, add a voice backend, use real patient data or change any clinical, privacy, financial or deployment settings. The voice link navigates to the description on the page; care links retain the existing market-specific destinations.

## Required before the launch copy can go live

- Integrate and independently review the actual DoctaRx voice experience, including patient authorization, informed consent, microphone lifecycle, interrupted and repeated sessions, retained-data policy and clinician handoff.
- Validate English and Nigerian English, and the initial evaluation languages Hausa, Igbo and Yoruba, using appropriate native-speaker review. A synthetic test or one provider-console response is not proof of language quality or clinical safety.
- Verify the advertised conversation, intake and clinician-review experience end to end in the actual DoctaRx application. Do not substitute provider-console demonstrations or fake-provider tests for this evidence.
- Obtain clinical and privacy approval of the voice workflow, escalation rules, retention and external processing, including relevant provider agreements.
- Run the complete checks on the integrated release tree, including database, browser, accessibility and production-build verification, and obtain explicit deployment authorization. Publishing a draft PR does not satisfy this gate.

## Image provenance

The current hero is original AI-generated concept artwork made for this task. A fictional adult patient in a primary healthcare centre speaks with a fictional woman clinician, with a luminous cyan-and-blue voice orb and sound waves between them. At the user's request, it replaces the previous maternity hero rather than adding another homepage section. The clinic scene illustrates one care setting within the site's unchanged global platform positioning. The image is not a real patient, doctor testimonial, clinical result or screenshot of a deployed voice session.

The generated artwork's invented logo was removed with the built-in GPT image-editing tool. The homepage places the existing `DoctaRxLogo` vector component over that area, so the real brand is preserved. This overlay is decorative, hidden from assistive technology, and has no interaction. There are no pretend microphone controls, listening states or new operational claims. The accessible image description explicitly identifies the image as an AI-generated medical voice concept.

The existing visible figure caption still shows Hausa → English as an illustrative conversation. That language pairing is authored marketing context, not an inference about the patient's appearance or English proficiency, a live translation control, or evidence of translation quality. Existing global language coverage, homepage text and care destinations remain unchanged.

Asset: `public/marketing/doctarx/medical-live-voice-hero-v6.webp`. Dimensions: 1672 × 941. WebP quality 86, 126,688 bytes. The full landscape composition is retained with dimensioned `next/image`, proportional responsive sizing and `object-fit: contain`. Previous generated artwork remains in the repository but is no longer selected as the hero.

Edit prompt (built-in tool): “Use case: precise-object-edit. Input image 1 is the edit target: the DoctaRx medical live voice homepage concept. Change only the generated brand lettering and turquoise four-petal logo at the upper-left of the floating glass panel: remove both cleanly, leaving an unmarked translucent dark-glass surface matching its surroundings. The real DoctaRx vector brand will be placed separately in the webpage. Preserve everything else: man at left, smiling female clinician in video at right, luminous cyan-and-blue voice orb and sound waves, composition, lighting, panel outline, clinic setting and Primary Healthcare Centre sign. No new logos, text, controls, faces or objects. Keep the same wide landscape aspect ratio and full image composition.”

## Global language catalog addition, 4 November 2026

The local homepage now highlights the 14 African languages listed in Google's current Gemini Live documentation and exposes the complete documented language range, including internationally used languages. The global provider/patient positioning does not change country authorization or clinical access rules. Igbo remains an internal experimental evaluation option and is not represented as documented Live support on the public language list. The shared catalog, code-count distinction, sources and validation limits are recorded in [the language coverage note](voice/GEMINI_LANGUAGE_COVERAGE.md). Documentation coverage is not native-speaker or clinical acceptance; the live activation and publication conditions above remain unchanged.
