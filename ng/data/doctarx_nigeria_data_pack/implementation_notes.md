# Nigeria-specific implementation logic for DoctaRx

## 1) Provider discovery should not assume perfect addresses
Nigeria address quality is inconsistent. Build a 4-stage provider matching pipeline:
1. exact GPS if provider has lat/lng
2. geocode normalized address
3. fuzzy geocode using state + city/LGA + landmark
4. fallback to city/state popularity ranking when geocoding confidence is low

Store `geocode_quality` as one of: exact, rooftop, street, area, city_only, unresolved.

## 2) Nearest provider logic should rank by more than distance
Recommended ranking score:
`final_score = 0.35 * proximity + 0.20 * provider_type_match + 0.15 * payer_match + 0.10 * trust_score + 0.10 * hours_open + 0.10 * stock_match`

Examples:
- If patient searched malaria meds, prioritize pharmacy-capable or clinic providers that can actually fulfil the case flow.
- If patient is pregnant, prioritize maternity-capable providers.
- If the case looks urgent, prioritize emergency-capable facilities even if slightly farther away.

## 3) Use hybrid access modes
Nigeria telehealth should support:
- app/web full flow
- WhatsApp handoff
- phone callback request
- low-bandwidth audio-first consult
- async consult with photos and voice notes
- save-and-resume for intermittent connectivity

## 4) Build trust hard
Each provider card should show:
- NHIA official badge if matched
- Reliance network badge if matched
- address confidence
- last verified date
- average response time
- accepts cash / insurance / HMO
- telehealth available / in-person only

## 5) Medication UX should be safe and practical
Split meds into:
- OTC candidate
- pharmacist review
- clinician prescription required
- controlled / restricted

Never merchandize antibiotics as casual consumer-first cards.
Surface them only inside diagnosis-aware pathways or clinician workflow.

## 6) Low-friction patient journey
Recommended home flow:
1. detect coarse location with consent
2. show nearest trusted providers
3. ask symptom-first question
4. suggest self-care / pharmacy / teleconsult / in-person based on triage
5. display medicine availability and likely price ranges if known
6. allow WhatsApp/phone fallback if checkout fails

## 7) Continuity care is huge
Nigeria needs strong repeat-care flows:
- refill request
- chronic medication reminders
- BP / glucose follow-up
- lab follow-up via photo upload
- family/shared account support

## 8) Smart provider normalization
Map provider names aggressively:
- remove punctuation
- normalize “hospital”, “clinic”, “medical centre”, “eye clinic”
- collapse spacing and casing
- keep alias table for duplicates from NHIA, Reliance, and your own partners

## 9) Minimum search experience
Patient can search by:
- symptom
- medicine
- specialty
- hospital/clinic name
- HMO name
- state / area / landmark

## 10) Strong operational tables to add later
- provider_hours
- provider_contacts
- provider_reviews
- med_price_observations
- partner_pharmacies
- consultation_slots
- triage_protocols
- referral_rules
