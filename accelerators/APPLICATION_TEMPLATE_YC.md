# Y Combinator Application -- DocTarx (ZumaTeledocAI)

> Template for YC Spring/Summer/Fall 2026 application
> Adapt answers based on current traction metrics at time of submission

---

## Company

**Company name:** DocTarx

**Company URL:** [INSERT PRODUCTION URL]

**If you have a demo, what's the URL?** [INSERT DEMO URL OR PRODUCTION APP]

**Describe what your company does in 50 characters or less:**
AI-powered telehealth platform for underserved markets.

**What is your company going to make?**
DocTarx is a HIPAA-compliant telehealth platform that connects patients with healthcare providers through AI-powered triage, secure video consultations, encrypted messaging, and clinical documentation. Our AI agent "Nurse Nova" triages patients before visits, reducing provider burden and improving care routing. The platform serves three user types through dedicated portals -- patients book and manage care, providers run virtual clinics with SOAP notes and waiting rooms, and administrators oversee the entire operation with analytics, audit logs, and provider credentialing.

We're building the operating system for virtual clinics, starting with markets where the doctor-to-patient ratio makes in-person care inaccessible (sub-Saharan Africa averages 1 doctor per 5,000 people; rural Latin America faces similar gaps). Our subscription model (Free/Gold/Platinum) makes the platform accessible to individual practitioners while scaling to health systems.

**Category:** Healthcare / Digital Health

---

## Founders

**Please tell us about an interesting project, preferably outside of class or work, that two or more of you created together.**
[INSERT -- describe a joint project that shows execution speed and technical ability]

**How long have the founders known one another and how did you meet?**
[INSERT]

---

## Progress

**How far along are you?**
We have a production-deployed platform with:
- Working patient registration and provider onboarding with credentialing
- AI triage agent (Nurse Nova) that assesses symptoms before appointments
- Secure video consultations with virtual waiting rooms
- End-to-end encrypted messaging (AES-256-GCM)
- Full SOAP notes system for clinical documentation
- Stripe-integrated subscription billing (Free/Gold/Platinum tiers)
- Admin portal with analytics, HIPAA audit logs, and provider management
- Multi-factor authentication with TOTP backup codes
- Deployed on AWS with PostgreSQL (Aiven Cloud)

[INSERT current user/provider metrics if available]

**How long have each of you been working on this? How much of that has been full-time?**
[INSERT]

**When will you have a prototype or MVP? If you already have one, when did you launch it?**
We have a fully functional production platform live now. [INSERT launch date]

**How many active users or customers do you have? How many are paying? What is your monthly revenue?**
[INSERT current metrics]

**Anything else you would like us to know regarding your progress?**
Our platform already meets HIPAA technical safeguard requirements including PHI encryption at rest, complete audit logging, session management, role-based access controls, and secure authentication -- compliance work that typically takes healthtech startups 6-12 months and $50K+ in consulting fees. We built this from day one.

---

## Idea

**Why did you pick this idea to work on? Do you have domain expertise in this area? How do you know people need what you're making?**
[INSERT personal motivation / domain expertise]

Healthcare access is fundamentally a distribution problem. There are enough trained doctors globally -- they're just concentrated in urban areas of wealthy countries. Telemedicine eliminates geography as a barrier to care, but existing platforms (Teladoc, Amwell, MDLive) are designed for the US insured market with per-visit pricing that's inaccessible in emerging markets.

We're building for the next billion patients -- people who have smartphones and internet but no nearby clinic. Our subscription model (starting free) and AI triage (which handles routine assessments automatically) make virtual care economically viable in markets where a $75 per-visit fee is a month's salary.

**What's new about what you're making? What substitutes do people resort to now?**
Three things differentiate DocTarx:

1. **AI-first triage**: Nurse Nova assesses patients before they see a provider, routing simple cases to self-care guidance and complex cases to appropriate specialists. This 10x's provider throughput -- a single doctor can serve far more patients when AI handles initial assessment.

2. **Multi-portal architecture**: Unlike simple video-call apps, we provide a complete clinic operating system with patient records, clinical documentation (SOAP notes), scheduling, provider credentialing, and admin analytics. Providers don't need separate EHR, scheduling, and billing tools.

3. **Built for emerging markets**: Subscription tiers (Free/Gold/Platinum) instead of per-visit pricing. Mobile-optimized. Works on low bandwidth. Designed for markets where WhatsApp is the current "telehealth solution" -- unencrypted, unstructured, no clinical records.

Current substitutes: WhatsApp/phone calls with doctors (no records, no encryption, no structure), traveling hours to the nearest clinic, or simply going without care.

**Who are your competitors, and who might become competitors? Who do you fear most?**
**Direct competitors:**
- Teladoc / Amwell / MDLive -- dominant in US insured market but overpriced and US-focused. Teladoc's stock dropped 90% from peak; the "Zoom for doctors" model is commoditized.
- Babylon Health -- attempted global expansion but went bankrupt in 2023 trying to be both insurer and platform.
- mPharma / Helium Health (Africa) -- focused on pharmacy/EHR, not telemedicine.

**Who we fear most:** A well-funded competitor that combines AI triage with a complete clinic OS for emerging markets. No one is doing this yet, but Google Health or a YC-backed startup could. Our advantage is being production-deployed first with HIPAA compliance and AI triage already working.

**What do you understand about your business that other companies in it just don't?**
Virtual healthcare in emerging markets won't scale on a per-visit revenue model. The unit economics only work when AI handles the routine cases (medication refills, follow-up checks, symptom monitoring) so human providers focus on complex care. This means the product must be AI-first, not "video call + AI bolted on."

Every telehealth company that's struggled (Babylon, Teladoc's stock decline) tried to scale human-intensive care delivery. We're building a platform where AI does 70% of the work and providers handle the 30% that requires human judgment. That's the only way to serve markets where there's 1 doctor per 5,000 patients.

---

## Equity

**Have you incorporated, or formed any legal entity (like combinator LLC) yet?**
[INSERT]

**Have you taken any investment yet?**
[INSERT -- if bootstrapped, say so]

**If you have already participated in an ideation program, been ## through a+C accelerator, or received any other institutional support, please describe it.**
[INSERT or "No"]

---

## Others

**If you had any other ideas you considered applying with, please list them.**
[INSERT or "This is our sole focus"]

**Please tell us something surprising or amusing that one of you has discovered.**
[INSERT -- YC loves unexpected, specific observations that show you think differently. Example: "We discovered that in rural Kenya, patients trust AI symptom checkers more than human phone operators because they're less embarrassed to describe symptoms to a machine."]

---

## Video (1 minute)

**Key points to cover in the YC video:**
1. (0-10s) Who you are, what you're building, one sentence
2. (10-30s) Live demo -- show the patient flow: symptom entry -> AI triage -> video appointment -> SOAP notes
3. (30-45s) Why this matters -- the access gap statistic (1 doctor per 5,000 patients), your approach
4. (45-60s) Traction and what you'll do with YC -- specific metrics, specific plans

**Tips:**
- Film with your phone, no production value needed
- Look at the camera, be natural
- Show the actual product working, not slides
- YC prefers authenticity over polish
