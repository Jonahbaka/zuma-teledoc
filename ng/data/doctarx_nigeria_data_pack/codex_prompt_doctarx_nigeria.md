You are upgrading DoctaRx Nigeria into a production-grade telehealth + provider-discovery platform for Nigeria.

Non-negotiable rules:
- Production-grade only. No mock data.
- Preserve existing features unless explicitly replaced with a better real implementation.
- Optimize for Nigeria realities: patchy internet, inconsistent addresses, cash pay, HMO fragmentation, medicine availability uncertainty, WhatsApp and phone fallback.
- Do not assume United States infrastructure, e-prescribe rails, address quality, insurance maturity, or provider data cleanliness.
- Build on the attached seed files and schema.

Data sources to ingest:
1. `provider_seed_reliance.csv`
2. `nhia_hmo_seed.csv`
3. `nhia_sshia_seed.csv`
4. `nhia_meds_seed.csv`
5. `featured_meds.csv`
6. `sources.json`

Core product goals:
1. Let a patient or provider discover the nearest relevant provider using device location.
2. Match providers across NHIA, Reliance, and DoctaRx internal data.
3. Build a medication catalog that supports search, merchandising, and safe triage.
4. Build Nigeria-first patient flows for teleconsultation, pharmacy discovery, chronic care, and low-bandwidth fallback.

Implement these capabilities:

A. Data ingestion and normalization
- Create ingestion jobs to load all CSV seeds into Postgres using `db_schema.sql`.
- Normalize provider names and deduplicate cross-source entities.
- Add slug fields and normalized text search columns.
- Add a `provider_match_group` mechanism so one real-world provider can have many source rows.

B. Location services
- Ask patient permission for geolocation on mobile and web.
- If denied, allow manual location selection by state, city, area, landmark.
- Resolve nearest providers using a weighted ranking:
  - proximity
  - provider_type match
  - payer/HMO match
  - trust score
  - hours open
  - medicine/stock relevance
- Show address confidence and last verified date.
- Cache coarse geolocation to reduce repeated prompts.

C. Provider search UX
- Search by symptom, medicine, specialty, provider name, HMO, and state.
- Offer tabs:
  - nearest
  - teleconsult now
  - in-person
  - pharmacy / meds
  - labs / diagnostics
- For urgent cases, bubble emergency-capable providers.

D. Medication system
- Create a meds catalog page and search API using `nhia_meds_seed.csv`.
- Feature the `featured_meds.csv` categories on the homepage and medicine search page.
- Separate access logic:
  - OTC candidate
  - pharmacist review
  - prescription required
  - controlled / restricted
- Do not casually advertise antibiotics as simple consumer cards.
- For malaria, pain/fever, dehydration, gastric issues, respiratory issues, hypertension, and diabetes, create guided flows that connect symptoms -> safe medicine suggestions -> provider/pharmacy options.

E. Nigeria-first telehealth experience
- Support:
  - video consult
  - audio consult
  - async consult with photo upload and voice notes
  - WhatsApp fallback
  - phone callback fallback
- Build low-bandwidth mode that prefers audio and compressed images.
- Allow the patient to continue with a poor connection instead of failing hard.

F. Trust and conversion
- Every provider card should show:
  - official source badges: NHIA / Reliance / DoctaRx verified
  - accepted payment types: cash, HMO, insurance, self-pay
  - telehealth available
  - maternity / pediatric / dental / optical / pharmacy relevance
  - distance and ETA
  - address confidence
- Build a sticky “Get care now” mobile CTA.

G. Chronic care and follow-up
- Create refill request flows for hypertension, diabetes, asthma, and recurring gastric issues.
- Add medicine reminders, follow-up booking, and family profiles.
- Add “continue last care plan” entry on home screen.

H. Practical engineering
- Use clean typed APIs.
- Add seeders, migrations, and background normalization jobs.
- Add observability around:
  - search-to-book rate
  - medicine search success
  - location permission acceptance
  - provider selection rate
  - fallback usage rate
- Add a way to ingest more official NHIA HCP data later when a cleaner export becomes available.

I. UX quality bar
- Native-feeling responsive UI across Android, iPhone, and desktop.
- Fast first paint.
- Skeleton loading.
- Clear empty states.
- Nigeria-friendly copy.
- No awkward US-specific language like PCP, copay, ZIP code, or CVS/Walgreens assumptions.

Deliverables:
1. database migrations
2. provider + meds ingestion scripts
3. normalized search APIs
4. location-aware provider results page
5. medicine discovery page
6. patient home page sections for featured medicine categories and nearest providers
7. trust badges and source attribution
8. low-bandwidth fallback flows
9. README for running the ingestion and matching pipeline

Important product logic:
- If location is weak or denied, do not dead-end the user.
- If stock is uncertain, mark it as estimated and still let the patient continue.
- If the nearest provider is unavailable, immediately show the next best option.
- Build for graceful degradation at every step.
