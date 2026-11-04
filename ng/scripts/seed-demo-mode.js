'use strict';

/**
 * ng/scripts/seed-demo-mode.js
 *
 * Idempotently load realistic Nigerian demo fixtures into the DRN
 * (referrals, agents, commissions) and the medication catalog notes,
 * so the Minister-of-Health walkthrough has live data on day zero.
 *
 * SAFETY:
 *  - Aborts unless DEMO_MODE=true OR --force is passed.
 *  - Only writes to ng_/drn_ tables. Does not touch US tables.
 *  - All inserts are idempotent (ON CONFLICT DO NOTHING / lookup-by-key).
 *
 * USAGE:
 *   DEMO_MODE=true node ng/scripts/seed-demo-mode.js
 *   node ng/scripts/seed-demo-mode.js --force
 */

const path = require('path');
const { getPool } = require('../../server/db');
const drn = require('../services/referral-network/referralNetworkService');

function abortGuard() {
  const force = process.argv.includes('--force');
  if (!force && process.env.DEMO_MODE !== 'true') {
    console.error('[demo-seed] Refusing to run — set DEMO_MODE=true or pass --force.');
    process.exit(1);
  }
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

async function getOrgIdBySlug(pool, slug) {
  const r = await pool.query(`SELECT id FROM drn_organizations WHERE slug = $1 LIMIT 1`, [slug]);
  return r.rows[0]?.id || null;
}

async function seedListings(pool) {
  let inserted = 0;
  for (const l of LISTINGS) {
    const orgId = await getOrgIdBySlug(pool, l.org_slug);
    if (!orgId) { console.warn(`[demo-seed] org ${l.org_slug} not found, skipping listing`); continue; }
    // idempotent: lookup by (org_id, title)
    const existing = await pool.query(
      `SELECT id FROM drn_marketplace_listings WHERE organization_id = $1 AND title = $2 LIMIT 1`,
      [orgId, l.title]
    );
    if (existing.rows[0]) continue;
    await pool.query(
      `INSERT INTO drn_marketplace_listings
         (organization_id, specialty, service_kind, title, price_min_naira, price_max_naira,
          avg_wait_minutes, accepts_emergency, accepts_insurance, acceptance_rate,
          total_referrals, completed_referrals, featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,false))`,
      [orgId, l.specialty, l.service_kind, l.title, l.price_min, l.price_max,
        l.wait_min, l.emergency, l.insurance, l.acceptance,
        Math.round((l.completed || 0) * 1.15), l.completed || 0, l.featured || false]
    );
    inserted++;
  }
  return inserted;
}

async function seedAgents(pool) {
  let inserted = 0;
  for (const a of AGENTS) {
    const existing = await pool.query(
      `SELECT id FROM drn_agents WHERE phone = $1 LIMIT 1`, [a.phone]
    );
    if (existing.rows[0]) continue;
    await drn.registerAgent({ ...a, status: 'active' }, pool);
    inserted++;
  }
  return inserted;
}

async function seedReferrals(pool) {
  const agentRows = (await pool.query(`SELECT id, full_name FROM drn_agents WHERE status='active' ORDER BY full_name`)).rows;
  const agentByIdx = (i) => agentRows[i % Math.max(1, agentRows.length)]?.id || null;

  let inserted = 0;
  for (let i = 0; i < REFERRALS.length; i++) {
    const r = REFERRALS[i];
    const p = PATIENTS.find(x => x.name === r.patient);
    const orgId = await getOrgIdBySlug(pool, r.org_slug);
    if (!orgId) continue;

    // idempotent: lookup by (destination, reason, patient_phone)
    const exists = await pool.query(
      `SELECT id FROM drn_referrals
        WHERE destination_org = $1 AND patient_phone = $2 AND reason = $3 LIMIT 1`,
      [orgId, p.phone, r.reason]
    );
    if (exists.rows[0]) continue;

    const created = await drn.createReferral({
      specialty: r.spec,
      service_kind: null,
      reason: r.reason,
      clinical_summary: `Demo referral. Patient ${p.name}, age ${p.age}, ${p.sex}, ${p.area} (${p.lga}).`,
      patient_name: p.name,
      patient_phone: p.phone,
      patient_age: p.age,
      patient_sex: p.sex,
      destination_org: orgId,
      service_fee_naira: r.fee,
      match_score: 60 + (i % 5) * 7,
      urgency: r.urgency,
      originating_agent: agentByIdx(i),
    }, { kind: 'system' }, pool);

    // Walk to target status
    const refId = created.id;
    const order = ['sent', 'received', 'accepted', 'scheduled', 'in_progress', 'completed'];
    for (const step of order) {
      const idx = order.indexOf(step);
      const targetIdx = order.indexOf(r.status);
      if (targetIdx < 0) break;
      if (idx > targetIdx) break;
      try {
        await drn.transitionReferral(refId, step, { kind: 'system' }, { notes: 'seed' }, pool);
      } catch { break; }
    }
    inserted++;
  }
  return inserted;
}

async function main() {
  abortGuard();
  const pool = getPool();
  console.log('[demo-seed] starting demo fixtures…');

  const listings = await seedListings(pool);
  console.log(`[demo-seed] marketplace listings inserted: ${listings}`);

  const agents = await seedAgents(pool);
  console.log(`[demo-seed] agents inserted: ${agents}`);

  const refs = await seedReferrals(pool);
  console.log(`[demo-seed] referrals inserted: ${refs}`);

  try {
    await drn.refreshHeatmap({}, pool);
    console.log('[demo-seed] heatmap refreshed');
  } catch (err) {
    console.warn('[demo-seed] heatmap refresh failed:', err.message);
  }

  console.log('[demo-seed] done.');
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[demo-seed] FAILED:', err);
    process.exit(1);
  });
}

module.exports = { main, PATIENTS, AGENTS, LISTINGS, REFERRALS };
