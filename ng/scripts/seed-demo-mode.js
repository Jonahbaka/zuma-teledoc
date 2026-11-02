'use strict';

/**
 * ng/scripts/seed-demo-mode.js
 *
 * Idempotently load realistic Nigerian demo fixtures into the DRN
 * (referrals, agents, commissions) and the medication catalog notes,
 * so the Minister-of-Health walkthrough has live data on day zero.
 *
 * SAFETY:
 *  - Requires DEMO_MODE=true and an explicit loopback *_test database.
 *  - Creates only marked synthetic NG accounts and fixture-owned catalogue rows.
 *  - All inserts are idempotent (ON CONFLICT DO NOTHING / lookup-by-key).
 *
 * USAGE:
 *   DEMO_MODE=true node ng/scripts/seed-demo-mode.js
 *   --force never bypasses the isolated-database safety guard.
 */

const { Pool } = require('pg');
const { fixtureTargetSafety } = require('./fixtureTargetSafety');
const drn = require('../services/referral-network/referralNetworkService');

function abortGuard(pool) {
  const safety = fixtureTargetSafety({ pool, env: process.env });
  if (safety.skipped) throw new Error(safety.reason);
  if (process.env.DEMO_MODE !== 'true') throw new Error('Set DEMO_MODE=true for isolated synthetic fixtures; --force does not bypass safety.');
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const FCT_AREAS = ['Lugbe', 'Gwarinpa', 'Wuse', 'Garki', 'Kuje', 'Maitama', 'Jabi', 'Apo'];

const PATIENTS = [
  { name: 'Aisha Mohammed', phone: '+2348012340001', age: 29, sex: 'female', lga: 'AMAC', area: 'Lugbe' },
  { name: 'Chidi Okoro',    phone: '+2348012340002', age: 47, sex: 'male',   lga: 'AMAC', area: 'Gwarinpa' },
  { name: 'Fatima Sani',    phone: '+2348012340003', age: 6,  sex: 'female', lga: 'AMAC', area: 'Wuse' },
  { name: 'Emeka Nwosu',    phone: '+2348012340004', age: 58, sex: 'male',   lga: 'BWARI', area: 'Bwari Town' },
  { name: 'Ngozi Ibe',      phone: '+2348012340005', age: 33, sex: 'female', lga: 'AMAC', area: 'Garki' },
  { name: 'Yakubu Bello',   phone: '+2348012340006', age: 71, sex: 'male',   lga: 'KUJE',  area: 'Kuje' },
];

const AGENTS = [
  { full_name: 'Halima Yusuf',    phone: '+2348023450001', whatsapp_phone: '+2348023450001', email: 'halima@demo.local', commission_rate: 5.0 },
  { full_name: 'Tunde Adeyemi',   phone: '+2348023450002', whatsapp_phone: '+2348023450002', email: 'tunde@demo.local',  commission_rate: 5.0 },
  { full_name: 'Grace Onyekwere', phone: '+2348023450003', whatsapp_phone: '+2348023450003', email: 'grace@demo.local',  commission_rate: 5.5 },
];

// Demo listings to attach to the seeded orgs (the migration already seeded the orgs)
const LISTINGS = [
  // hospital specialties
  { org_slug: 'natl-hosp-abuja',   specialty: 'cardiology',    service_kind: 'consultation', title: 'Cardiology consultation', price_min: 15000, price_max: 35000, wait_min: 45, emergency: true,  insurance: true,  acceptance: 92, completed: 320, featured: true },
  { org_slug: 'natl-hosp-abuja',   specialty: 'obstetrics',    service_kind: 'consultation', title: 'Antenatal specialist',    price_min: 12000, price_max: 25000, wait_min: 60, emergency: true,  insurance: true,  acceptance: 95, completed: 410 },
  { org_slug: 'maitama-dh',        specialty: 'obstetrics',    service_kind: 'consultation', title: 'High-risk pregnancy clinic', price_min: 18000, price_max: 30000, wait_min: 40, emergency: true, insurance: true, acceptance: 90, completed: 220 },
  { org_slug: 'maitama-dh',        specialty: 'pediatrics',    service_kind: 'consultation', title: 'General pediatrics',      price_min: 8000,  price_max: 18000, wait_min: 30, emergency: true,  insurance: true,  acceptance: 96, completed: 540 },
  { org_slug: 'wuse-dh',           specialty: 'internal_medicine', service_kind: 'consultation', title: 'Internal medicine OPD', price_min: 7000, price_max: 15000, wait_min: 50, emergency: false, insurance: true, acceptance: 88, completed: 260 },
  { org_slug: 'wuse-dh',           specialty: 'mental_health', service_kind: 'consultation', title: 'Mental health clinic',     price_min: 10000, price_max: 22000, wait_min: 60, emergency: false, insurance: true, acceptance: 85, completed: 95 },
  // labs
  { org_slug: 'clina-lancet-wuse', specialty: 'lab_general',   service_kind: 'lab',          title: 'Full blood count + LFT + U&E', price_min: 5500, price_max: 5500, wait_min: 30, emergency: false, insurance: true, acceptance: 99, completed: 1200 },
  { org_slug: 'clina-lancet-wuse', specialty: 'lab_general',   service_kind: 'lab',          title: 'HbA1c',                    price_min: 4500, price_max: 4500, wait_min: 20, emergency: false, insurance: true, acceptance: 99, completed: 840 },
  // diagnostic
  { org_slug: 'bridge-diag',       specialty: 'imaging_mri',   service_kind: 'imaging',      title: '1.5T MRI brain (with contrast)', price_min: 95000, price_max: 130000, wait_min: 120, emergency: true, insurance: true, acceptance: 90, completed: 110, featured: true },
  { org_slug: 'bridge-diag',       specialty: 'imaging_ct',    service_kind: 'imaging',      title: '64-slice CT chest',         price_min: 55000, price_max: 75000, wait_min: 90, emergency: true, insurance: true, acceptance: 92, completed: 180 },
  // pharmacy
  { org_slug: 'healthplus-garki',  specialty: 'pharmacy_fulfilment', service_kind: 'pharmacy', title: 'Antimalarial dispensing (ACT)', price_min: 1500, price_max: 4500, wait_min: 10, emergency: false, insurance: true, acceptance: 98, completed: 2100 },
];

// Referrals to seed across the workflow
const REFERRALS = [
  { patient: 'Aisha Mohammed',  spec: 'obstetrics',      org_slug: 'maitama-dh',        reason: 'Pre-eclampsia screening, BP 150/100 at 32 weeks', urgency: 'urgent',    fee: 18000, status: 'completed' },
  { patient: 'Chidi Okoro',     spec: 'cardiology',      org_slug: 'natl-hosp-abuja',   reason: 'Uncontrolled HTN despite triple therapy',          urgency: 'routine',   fee: 25000, status: 'scheduled' },
  { patient: 'Fatima Sani',     spec: 'pediatrics',      org_slug: 'maitama-dh',        reason: 'Recurrent malaria episodes in last 3 months',      urgency: 'routine',   fee: 12000, status: 'in_progress' },
  { patient: 'Emeka Nwosu',     spec: 'imaging_mri',     org_slug: 'bridge-diag',       reason: 'New focal neurological deficit',                   urgency: 'urgent',    fee: 110000, status: 'completed' },
  { patient: 'Ngozi Ibe',       spec: 'mental_health',   org_slug: 'wuse-dh',           reason: 'Postpartum depression PHQ-9 = 17',                 urgency: 'urgent',    fee: 15000, status: 'accepted' },
  { patient: 'Yakubu Bello',    spec: 'internal_medicine', org_slug: 'wuse-dh',         reason: 'Acute on chronic CKD, eGFR 22',                    urgency: 'urgent',    fee: 12000, status: 'completed' },
  { patient: 'Aisha Mohammed',  spec: 'lab_general',     org_slug: 'clina-lancet-wuse', reason: 'Routine antenatal labs',                           urgency: 'routine',   fee: 5500,  status: 'completed' },
  { patient: 'Fatima Sani',     spec: 'lab_general',     org_slug: 'clina-lancet-wuse', reason: 'FBC + malaria RDT',                                urgency: 'routine',   fee: 5500,  status: 'completed' },
  { patient: 'Chidi Okoro',     spec: 'lab_general',     org_slug: 'clina-lancet-wuse', reason: 'HbA1c + renal function (HTN workup)',              urgency: 'routine',   fee: 8500,  status: 'sent' },
  { patient: 'Emeka Nwosu',     spec: 'pharmacy_fulfilment', org_slug: 'healthplus-garki', reason: 'Post-CT discharge meds',                        urgency: 'routine',   fee: 3500,  status: 'completed' },
  { patient: 'Yakubu Bello',    spec: 'pharmacy_fulfilment', org_slug: 'healthplus-garki', reason: 'Erythropoietin + ferrous',                      urgency: 'routine',   fee: 22000, status: 'received' },
  { patient: 'Ngozi Ibe',       spec: 'cardiology',      org_slug: 'natl-hosp-abuja',   reason: 'Postpartum palpitations + chest tightness',        urgency: 'emergency', fee: 30000, status: 'completed' },
];

// ─── Seed routine ────────────────────────────────────────────────────────────

async function syntheticProvider(pool, key) {
  abortGuard(pool);
  const email = `drn-fixture-${key}@example.invalid`;
  let user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
  if (user && (!user.is_test_account || !user.is_active || user.market_scope !== 'NG' || user.role !== 'provider' || user.provider_status !== 'approved')) throw new Error('Existing fixture identity is not an active synthetic NG provider');
  if (!user) user = (await pool.query("INSERT INTO users(email,password_hash,role,first_name,last_name,is_active,is_test_account,market_scope,provider_status) VALUES($1,'!disabled-synthetic','provider','Synthetic','DRN',TRUE,TRUE,'NG','approved') RETURNING *", [email])).rows[0];
  let provider = (await pool.query('SELECT * FROM ng_providers WHERE user_id=$1', [user.id])).rows[0];
  if (provider && (provider.status !== 'verified' || provider.full_name !== `[SYNTHETIC DRN] ${key}` || provider.email !== email)) throw new Error('Existing synthetic provider is not verified; refusing to promote it');
  if (!provider) provider = (await pool.query("INSERT INTO ng_providers(user_id,full_name,email,phone,status) VALUES($1,$2,$3,'synthetic-no-phone','verified') RETURNING *", [user.id, `[SYNTHETIC DRN] ${key}`, email])).rows[0];
  return { user_id: user.id, provider_id: provider.id };
}

async function getOrgIdBySlug(pool, slug) {
  const fixtureSlug = `synthetic-drn-${slug}`;
  let org = (await pool.query('SELECT * FROM drn_organizations WHERE slug=$1', [fixtureSlug])).rows[0];
  if (org && (!org.active || org.name !== `[SYNTHETIC DRN] ${slug}`)) throw new Error('Existing organization is not this active synthetic fixture');
  if (!org) org = (await pool.query("INSERT INTO drn_organizations(org_type,name,slug,active) VALUES('specialist_practice',$1,$2,TRUE) RETURNING *", [`[SYNTHETIC DRN] ${slug}`, fixtureSlug])).rows[0];
  return org.id;
}

async function seedListings(pool, receiver) {
  let inserted = 0;
  for (const l of LISTINGS) {
    if (l.service_kind === 'imaging' && process.env.NG_MEDICAL_IMAGING_AUTHORIZED !== 'true') continue;
    const orgId = await getOrgIdBySlug(pool, l.org_slug);
    if (!orgId) { console.warn(`[demo-seed] org ${l.org_slug} not found, skipping listing`); continue; }
    // idempotent: lookup by (org_id, title)
    const existing = await pool.query(
      `SELECT * FROM drn_marketplace_listings WHERE organization_id = $1 AND title = $2 LIMIT 1`,
      [orgId, l.title]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].provider_id !== receiver.provider_id || !existing.rows[0].active || existing.rows[0].metadata_json?.fixture !== 'synthetic-drn') throw new Error('Existing listing is not this active mapped synthetic fixture');
      continue;
    }
    await pool.query(
      `INSERT INTO drn_marketplace_listings
         (organization_id, specialty, service_kind, title, price_min_naira, price_max_naira,
          avg_wait_minutes, accepts_emergency, accepts_insurance, acceptance_rate,
          total_referrals, completed_referrals, featured, provider_id, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,false),$14,'{"fixture":"synthetic-drn"}'::jsonb)`,
      [orgId, l.specialty, l.service_kind, l.title, l.price_min, l.price_max,
        l.wait_min, l.emergency, l.insurance, l.acceptance,
        Math.round((l.completed || 0) * 1.15), l.completed || 0, l.featured || false, receiver.provider_id]
    );
    inserted++;
  }
  return inserted;
}

async function seedReferrals(pool, origin, receiver) {
  let inserted = 0;
  for (let i = 0; i < REFERRALS.length; i++) {
    const r = REFERRALS[i];
    if (r.spec.startsWith('imaging_') && process.env.NG_MEDICAL_IMAGING_AUTHORIZED !== 'true') continue;
    const p = PATIENTS.find(x => x.name === r.patient);
    const orgId = await getOrgIdBySlug(pool, r.org_slug);
    if (!orgId) continue;

    const listing = (await pool.query("SELECT * FROM drn_marketplace_listings WHERE organization_id=$1 AND specialty=$2 AND provider_id=$3 AND active=TRUE AND metadata_json->>'fixture'='synthetic-drn' ORDER BY id LIMIT 1", [orgId, r.spec, receiver.provider_id])).rows[0];
    if (!listing) throw new Error('Synthetic mapped catalogue listing missing');
    // idempotent: lookup by (destination, reason, patient_phone)
    const exists = await pool.query(
      `SELECT * FROM drn_referrals
        WHERE destination_org = $1 AND patient_phone = $2 AND reason = $3 LIMIT 1`,
      [orgId, p.phone, r.reason]
    );
    const prior = exists.rows[0];
    if (prior && (prior.originating_provider !== origin.provider_id || prior.destination_provider !== receiver.provider_id || prior.destination_listing !== listing.id)) throw new Error('Existing referral is not this synthetic actor/catalogue fixture');

    const created = prior || await drn.createReferral({
      specialty: r.spec,
      service_kind: null,
      reason: r.reason,
      clinical_summary: `Demo referral. Patient ${p.name}, age ${p.age}, ${p.sex}, ${p.area} (${p.lga}).`,
      patient_name: p.name,
      patient_phone: p.phone,
      patient_age: p.age,
      patient_sex: p.sex,
      destination_org: orgId,
      destination_listing: listing.id,
      urgency: r.urgency,
    }, origin, pool);

    // Walk to target status
    const refId = created.id;
    const order = ['sent', 'received', 'accepted', 'scheduled', 'in_progress', 'completed'];
    if (created.status !== 'draft' && !order.includes(created.status)) throw new Error('Synthetic referral was closed outside this fixture workflow');
    for (const step of order) {
      const idx = order.indexOf(step);
      const targetIdx = order.indexOf(r.status);
      if (targetIdx < 0) break;
      if (idx > targetIdx) break;
      if (idx <= order.indexOf(created.status)) continue;
      await drn.transitionReferral(refId, step, step === 'sent' ? origin : receiver, { notes: 'Synthetic fixture only' }, pool);
    }
    if (!prior) inserted++;
  }
  return inserted;
}

async function main() {
  abortGuard();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  abortGuard(pool);
  try {
    const origin = await syntheticProvider(pool, 'origin');
    const receiver = await syntheticProvider(pool, 'receiver');
    console.log('[demo-seed] starting demo fixtures…');

    const listings = await seedListings(pool, receiver);
    console.log(`[demo-seed] marketplace listings inserted: ${listings}`);

    console.log('[demo-seed] Agent-signing fixtures omitted: current user-role schema has no agent role.');

    const refs = await seedReferrals(pool, origin, receiver);
    console.log(`[demo-seed] referrals inserted: ${refs}`);

    try {
      await drn.refreshHeatmap({}, pool);
      console.log('[demo-seed] heatmap refreshed');
    } catch (err) {
      console.warn('[demo-seed] heatmap refresh failed:', err.message);
    }

    console.log('[demo-seed] done.');
  } finally { await pool.end(); }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[demo-seed] FAILED:', err);
    process.exit(1);
  });
}

module.exports = { abortGuard, syntheticProvider, main, PATIENTS, AGENTS, LISTINGS, REFERRALS };
