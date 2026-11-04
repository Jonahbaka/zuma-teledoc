# DoctaRx Nigeria — Minister-of-Health Demo Walkthrough

A 7-minute live demo script designed to land the value of the platform
fast with senior government stakeholders. Run it after seeding demo data.

## 0. One-time setup (before the room)

```bash
DEMO_MODE=true node ng/scripts/seed-demo-mode.js
```

This idempotently seeds:
- 7 FCT/AMAC marketplace orgs (hospitals, lab, pharmacy, diagnostic center)
- 11 listings across cardiology, OB/GYN, peds, internal med, mental health, imaging, lab, pharmacy
- 3 field agents (Halima, Tunde, Grace)
- 12 cross-status referrals on 6 Nigerian patients
- Heatmap aggregates refreshed

Open these tabs in the browser **before** you start so they load fast:
- `/ng/referral-network` — DRN portal
- `/ng/medications/search` — medication search v2
- `/ng/soap` — SOAP composer
- `/ng/telehealth/diagnostics` — pre-call diagnostics
- `/ng/executive-view` — executive command centre

## 1. Open with the Referral Network (~2 min)

> "Doctors trust referrals — they don't always trust telemedicine. So we
> built a national referral network that meets them where they already
> are."

**On `/ng/referral-network` → Overview tab:**
- Point at KPIs: total referrals, completed, in-flight, emergencies,
  average AI match score, total completed fees in naira.
- "Every number here is real database state — not a mock."

**Switch to Marketplace tab:**
- Filter by specialty → "cardiology" — show ranked listings with
  acceptance rate, wait time, price band.
- "We rank by acceptance rate, wait, and price — not by who paid most."

**Switch to Compose tab:**
- Fill in: Aisha Mohammed, age 29, urgent, obstetrics, reason
  "pre-eclampsia screening, BP 150/100 at 32 weeks".
- Click **Find matches** — explain the **explainable** match score:
  "you can see *why* each facility scored this way — same LGA, accepts
  emergency, within budget, high acceptance rate."
- Click a match, then **Send referral**.
- When it confirms, click **Mint patient QR slip** — show the token.

**Open `/ng/referral-network/verify/{token}` in a new tab:**
- "This is what the patient sees on their phone when reception scans the
  slip. No login. Works on a feature-phone browser."

## 2. Cut to the Medication Search (~1.5 min)

> "Now the doctor needs to prescribe. Nigerian doctors don't say
> 'amoxicillin-clavulanate' — they say 'Augmentin'."

**On `/ng/medications/search`:**
- Type **Coartem** — point at the violet "alias" badge and "via Coartem"
  caption. "Search resolved the street name to the generic
  artemether-lumefantrine."
- Type **augmenti** (deliberate typo). Show fuzzy match still ranks
  Augmentin → amoxicillin-clavulanate first.
- Click **Add to basket** on Coartem + warfarin (search "warfarin" first).
- The **Interactions** panel lights up red: "High severity — increased
  bleeding risk. Avoid combination."

## 3. SOAP Composer (~1 min)

> "Documentation is where Nigerian doctors burn out. We give them
> templates."

**On `/ng/soap`:**
- Click **Adult uncomplicated malaria**.
- Show how all 4 SOAP sections are pre-scaffolded with Nigerian-clinic
  language (mRDT, ART-LUM 80/480 BD x 3 days, return for jaundice).
- Point at "Suggested history questions" and the **Compose referral**
  button on templates that hint a referral (e.g. severe malaria).

## 4. Pre-call Diagnostics (~1 min)

> "We assume bad networks, not good ones."

**On `/ng/telehealth/diagnostics`:**
- Click **Run all checks** — browser ✓, microphone with live level
  meter, camera preview, downlink probe.
- "We pick a video profile **per call** based on measured bandwidth.
  When the network is very poor, we don't pretend — we offer an
  audio-only join."

## 5. Executive Command Center (~1 min)

> "Once the network is running, you get something Nigeria has never had:
> live nationwide health intelligence."

**On `/ng/executive-view`:**
- Show KPIs, trends, signals, forecasts, governance status, facility map.
- "This is the FMOH view. FCT has the same view scoped to FCT. Each area
  council has the same view scoped to their LGA. Same code, federated
  data."

## 6. Closing pitch (~30s)

> "Three things that matter for nationwide rollout:
> 1. **Adoption** — we use referrals, not telemedicine, as the wedge.
> 2. **Reach** — works on a phone with one bar of signal.
> 3. **Sovereignty** — DHIS2-ready exports, ICD-10 coded, governed by
>    the FMOH hierarchy. Federal, state, LGA, facility — all the way down.
>
> We're ready to pilot in two area councils today."

## 7. Reset between demos

Re-running the seed script is safe — every insert is idempotent. If you
want a clean slate, manually truncate the `drn_*` tables (the migration
runner won't re-run because migrations 013 and 014 are already recorded).

## Routes touched in this demo

| URL                                              | What it shows                         |
|--------------------------------------------------|---------------------------------------|
| `/ng/referral-network`                           | DRN portal (8 tabs)                   |
| `/ng/referral-network/verify/{token}`            | Patient-facing QR slip                |
| `/ng/medications/search`                         | Brand-aware med search + interactions |
| `/ng/soap`                                       | SOAP composer with templates          |
| `/ng/telehealth/diagnostics`                     | Pre-call device + bandwidth check     |
| `/ng/executive-view`                             | National command centre               |
| `/ng/demo`                                       | This walkthrough's hub page           |

## API endpoints exercised

- `GET  /api/ng/referral-network/listings`
- `POST /api/ng/referral-network/match`
- `POST /api/ng/referral-network/referrals`
- `POST /api/ng/referral-network/referrals/:id/transition`
- `POST /api/ng/referral-network/referrals/:id/qr`
- `GET  /api/ng/referral-network/public/verify-qr/:token`
- `GET  /api/ng/medications/search?q=…`
- `GET  /api/ng/medications/autocomplete?q=…`
- `POST /api/ng/medications/check-interactions`
- `GET  /api/ng/soap/templates`
- `GET  /api/ng/executive-view/dashboard`
