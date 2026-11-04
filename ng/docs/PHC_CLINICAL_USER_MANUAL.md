# DoctaRx Nigeria PHC Clinical User Manual

## What this guide is for

This field guide helps PHC nurses, remote doctors, consultants, supervisors, and facility administrators learn the DoctaRx Nigeria PHC workspace. It is written for supervised orientation and refresher practice. It does not replace a facility's clinical SOPs, emergency plan, privacy policy, or professional judgement.

The same guide is available in the product at `/ng/phc` under **Training & assessment**, and as a print-friendly page at `/ng/phc/training`.

## Before you begin

1. Use your own account. Never share a password or leave a signed-in device unattended.
2. Confirm the programme and facility shown in the workspace header. Stop if the scope is wrong.
3. Use fictional records for training. Do not type real patient identifiers into a training checklist, screenshot, or demo note.
4. For an emergency, follow the facility escalation process first. The workspace is not an emergency response service.

## The five-minute safe start

1. **Confirm scope.** Read the programme, facility, and role badge before opening a patient record.
2. **Confirm the person.** Use the minimum necessary identifiers, confirm consent, and protect the conversation.
3. **Capture clearly.** Record the complaint and observations with units. Re-check surprising values.
4. **Close the loop.** Assign or claim the queue item, sign the core note, and name the next action.
5. **Escalate early.** Use local clinical and safeguarding pathways for danger signs or urgent concerns.

## Nurse workflow: intake to handoff

1. Sign in through `/ng/provider/login` and open `/ng/phc`.
2. Select the assigned programme and facility context. A nurse can only work inside that scope.
3. Search for the enrolled patient. Confirm the person's identity and consent before documenting.
4. Start or resume the intake encounter. Record the chief complaint using clear, minimum-necessary language.
5. Add observations using the correct type and unit: blood pressure, pulse, temperature, or oxygen saturation. Re-check a value that does not fit the clinical picture.
6. Review the encounter summary. Do not place a diagnosis or clinician plan in the nurse handoff field.
7. Dispatch the completed intake to the clinician queue. If the patient needs a different pathway, use the local escalation process and the referral workflow.
8. Arrange a follow-up when a next contact, review date, or patient education action is needed.

### Nurse teach-back

Ask the learner to explain why each observation has a unit, how they would correct a mistaken value, and who owns the next action after dispatch. The supervisor records the result in the approved local training register, not in the product checklist.

## Doctor or consultant workflow: queue to closure

1. Sign in through `/ng/provider/login` and open `/ng/phc`.
2. Confirm the programme and facility badge. Review only the assigned clinician queue.
3. Open a queue item and claim it. The status should move through called and in consultation as the consultation progresses.
4. Review the nurse's intake, observations, and relevant context. Ask the patient to confirm the history during the consultation.
5. Document the assessment and plan in the clinical note. If an optional AI suggestion is displayed, treat it as a draft and verify every item against the patient and accepted guidance.
6. Sign the core note. An encounter cannot be completed without the required clinician sign-off.
7. Complete the encounter, create a follow-up, or create a referral. State the next action and responsible team clearly.
8. Re-check the queue after closure so no assigned case is left without an owner.

### Doctor teach-back

Ask the learner to demonstrate how they would refuse an unassigned case, explain why signing is required, and identify the difference between a follow-up and a referral. The qualified assessor records the outcome outside the PHC record.

## Follow-ups and referrals

- A follow-up is used when the same care team owns the next contact or review.
- A referral is used when another service or facility must accept the next action.
- Referral coordinators keep the referral open until acceptance and an outcome are recorded.
- Do not close a referral simply because a message was sent. Confirm the receiving service and document the outcome.

## Offline capture and synchronisation

Offline capture is available only when the programme has explicitly enabled it and the device is registered.

1. Check the header status before starting. **Offline** means the draft is queued, not uploaded.
2. Record only the minimum necessary information and keep the device physically secure.
3. Do not change programme or facility context while an offline item is pending.
4. Return online, confirm the correct context, and use **Sync**.
5. Review rejected or conflicted items with a supervisor. Never create a second patient record to work around a conflict.

## Privacy, AI, and break-glass rules

- Programme and facility scope is enforced for every clinical request.
- Break-glass access is for a documented emergency only and is audited.
- AI is optional, feature-gated, and review-only. A human clinician owns the final note and plan.
- Do not copy clinical text into personal notes, screenshots, chat, or external tools.
- Government reporting is aggregate-only; it does not expose patient-level clinical records.

## Assessment rubric for supervisors

Use the in-product checklist for teach-back, then record the official result in the facility's training register.

| Domain | Meets standard when the learner can... |
| --- | --- |
| Scope | Select the correct programme and facility and explain why sharing accounts is unsafe. |
| Consent and privacy | Explain consent, minimum necessary access, and emergency escalation. |
| Observations | Capture a value with the right unit, recognise an implausible value, and re-check it. |
| Queue ownership | Dispatch or claim only the work permitted by the learner's role. |
| Documentation | Explain that the clinician signs the core note before completion. |
| Continuity | Create the correct follow-up or referral and identify the next owner. |
| Offline safety | Protect the device, preserve scope, and sync without duplicating or bypassing conflicts. |

## Troubleshooting

**I cannot see a programme or facility.** Confirm that your account has an active programme membership. Contact the facility administrator; do not use another person's account.

**The queue action is unavailable.** The case may not be assigned to your role, or the status may not allow that transition. Ask the queue owner or supervisor to correct the assignment.

**The encounter will not complete.** Check that the required clinician core note is signed and that the next action is recorded.

**Sync reports a conflict.** Keep the original queued item, stop editing it, and ask a supervisor to reconcile the conflict. Never create a duplicate patient to bypass the safeguard.

**Government login asks for another code.** Government and executive accounts require MFA. Use the developer authenticator seed documented in [DEVELOPER_DEMO_LOGINS.md](./DEVELOPER_DEMO_LOGINS.md) for controlled demo use only.

## Developer demo setup

The short developer accounts and their online routes are listed in [DEVELOPER_DEMO_LOGINS.md](./DEVELOPER_DEMO_LOGINS.md). They are fictional, test-labelled, and for controlled developer demonstrations only. Do not use them for real patient care, real reporting, or institutional administration.

## Version and ownership

- Product: DoctaRx Nigeria PHC workspace
- Manual version: 1.0
- Audience: PHC nurses, remote doctors, consultants, supervisors, facility administrators, and controlled developer demonstrators
- Review trigger: update this guide whenever the intake, queue, sign-off, referral, offline, or permission model changes
