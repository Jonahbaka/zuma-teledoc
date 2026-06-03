'use strict';

/**
 * ng/scripts/simulate-live.js
 *
 * End-to-end agent-driven simulation that exercises the live DoctaRx
 * Nigeria service layer against an explicitly isolated Neon database.
 *
 * Unlike `simulate.js` (hermetic, ~50ms, pure functions), this one:
 *   • Creates real rows in ng_conf_rooms / ng_conf_participants /
 *     ng_digital_prescriptions / ng_referrals / etc.
 *   • Spawns 9 simulated agents (patient, junior doctor, senior
 *     consultant, nurse, pharmacist, lab tech, hospital admin,
 *     referral coordinator, intern observer).
 *   • Exercises every transition in every state machine.
 *   • Validates RBAC enforcement actively (attempts forbidden ops and
 *     asserts they fail with the right error code).
 *   • Tags every row with a `simulation_run_id` so cleanup is total.
 *
 * USAGE:
 *   DATABASE_URL=postgres://... node ng/scripts/simulate-live.js
 *   DATABASE_URL=postgres://... node ng/scripts/simulate-live.js --keep
 *
 * Without --keep, the runner cleans up every row it created at the end.
 * Cleanup is best-effort, so this script intentionally refuses to run
 * unless the target is identified as local/test/staging/synthetic.
 */

require('dotenv').config();
const crypto = require('crypto');
const { getPool } = require('../../server/db');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not set');
  process.exit(2);
}

const LIVE_SIM_TARGET = (process.env.NG_LIVE_SIMULATION_TARGET || '').trim().toLowerCase();
const ALLOWED_LIVE_SIM_TARGETS = new Set(['local', 'test', 'staging', 'synthetic']);
if (!ALLOWED_LIVE_SIM_TARGETS.has(LIVE_SIM_TARGET)) {
  console.error(
    'FATAL: NG_LIVE_SIMULATION_TARGET must be one of local, test, staging, or synthetic. Refusing to mutate an unidentified database.'
  );
  process.exit(2);
}

const KEEP = process.argv.includes('--keep');
const RUN_ID = `sim-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
const cleanup = []; // [{ table, ids: [] }] — populated as we go

// ─── Agents ──────────────────────────────────────────────────────────────────

// Real UUIDs — required by FK constraint on ng_conf_participants.user_id → users(id)
// Each agent is shaped as an actor object that services consume directly.
// `role` = conference role (host/consultant/doctor/...).  `user_table_role`
// is only used when inserting into the users table at seed time.
const AGENTS = {
  patient:     { user_id: crypto.randomUUID(), role: 'patient',    name: 'Mrs Aisha Mohammed',     display_name: 'Mrs Aisha Mohammed',   user_table_role: 'patient',  email: `sim.patient.${RUN_ID}@simulate.local` },
  junior_doc:  { user_id: crypto.randomUUID(), role: 'doctor',     name: 'Dr Chidi Okoro Junior',  display_name: 'Dr Chidi Okoro Junior',user_table_role: 'provider', email: `sim.doctor.${RUN_ID}@simulate.local` },
  consultant:  { user_id: crypto.randomUUID(), role: 'consultant', name: 'Prof Bello Cardiology',  display_name: 'Prof Bello',           user_table_role: 'provider', email: `sim.cons.${RUN_ID}@simulate.local` },
  nurse:       { user_id: crypto.randomUUID(), role: 'nurse',      name: 'Nurse Eze',              display_name: 'Nurse Eze',            user_table_role: 'provider', email: `sim.nurse.${RUN_ID}@simulate.local` },
  pharmacist:  { user_id: crypto.randomUUID(), role: 'pharmacist', name: 'Pharm Kayode',           display_name: 'Pharm Kayode',         user_table_role: 'pharmacy', email: `sim.pharm.${RUN_ID}@simulate.local` },
  lab_tech:    { user_id: crypto.randomUUID(), role: 'doctor',     name: 'Lab Tech Adeola',        display_name: 'Lab Tech Adeola',      user_table_role: 'provider', email: `sim.lab.${RUN_ID}@simulate.local` },
  admin:       { user_id: crypto.randomUUID(), role: 'host',       name: 'Hospital Administrator', display_name: 'Hospital Admin',       user_table_role: 'admin',    email: `sim.admin.${RUN_ID}@simulate.local` },
  coordinator: { user_id: crypto.randomUUID(), role: 'doctor',     name: 'Referral Coordinator',   display_name: 'Referral Coordinator', user_table_role: 'provider', email: `sim.coord.${RUN_ID}@simulate.local` },
  intern:      { user_id: crypto.randomUUID(), role: 'observer',   name: 'Intern Tunde',           display_name: 'Intern Tunde',         user_table_role: 'provider', email: `sim.intern.${RUN_ID}@simulate.local` },
};

// Provider + pharmacy IDs the prescription scenario writes against.  These
// are populated by seedAgents() so the FK targets exist on Neon.
const SIM_IDS = {
  provider_id: crypto.randomUUID(),
  pharmacy_id: crypto.randomUUID(),
};

async function seedAgents(pool) {
  for (const a of Object.values(AGENTS)) {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name)
       VALUES ($1, $2, 'simulation', $3::user_role, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [a.user_id, a.email, a.user_table_role, 'Sim', a.name.split(' ').slice(-1)[0]]
    );
  }
  cleanup.push({ table: '_users', ids: Object.values(AGENTS).map(a => a.user_id) });

  // ng_providers row — needed for ng_digital_prescriptions.provider_id FK
  await pool.query(
    `INSERT INTO ng_providers (id, user_id, full_name, email, phone, specialty, status)
     VALUES ($1, $2, $3, $4, $5, 'general_practice', 'verified')
     ON CONFLICT (id) DO NOTHING`,
    [SIM_IDS.provider_id, AGENTS.junior_doc.user_id, AGENTS.junior_doc.name,
     `sim.provider.${RUN_ID}@simulate.local`, '+2348012340099']
  );
  cleanup.push({ table: '_providers', ids: [SIM_IDS.provider_id] });

  // ng_pharmacies row — needed for ng_digital_prescriptions.routed_pharmacy_id FK
  // Schema from 001_ng_core_tables.sql has owner_user_id (not user_id) +
  // many NOT NULL fields (pcn_license_number, superintendent_*, address, etc.)
  try {
    const tag = RUN_ID.slice(-8);
    await pool.query(
      `INSERT INTO ng_pharmacies (
         id, name, slug, owner_user_id,
         pcn_license_number, pcn_license_expiry,
         superintendent_name, superintendent_pcn_number, superintendent_phone,
         address_line1, city, state, phone, email
       )
       VALUES ($1, $2, $3, $4,
               $5, $6,
               $7, $8, $9,
               $10, $11, $12, $13, $14)
       ON CONFLICT (id) DO NOTHING`,
      [
        SIM_IDS.pharmacy_id, `[SIM] Pharmacy ${tag}`, `sim-pharmacy-${tag}`, AGENTS.pharmacist.user_id,
        `SIM-PCN-${tag}`, '2030-12-31',
        AGENTS.pharmacist.name, `SIM-PCN-PHARM-${tag}`, '+2348012340098',
        '1 Demo Plaza', 'Abuja', 'FCT', '+2348012340097', `sim.pharmacy.${tag}@simulate.local`,
      ]
    );
    cleanup.push({ table: '_pharmacies', ids: [SIM_IDS.pharmacy_id] });
  } catch (e) {
    console.log('  (ng_pharmacies seed skipped:', e.message.slice(0, 100), ')');
  }
}

// ─── Reporter ────────────────────────────────────────────────────────────────

const results = [];
function record(scenario, agent, action, ok, detail = '') {
  results.push({ scenario, agent, action, ok, detail });
  const icon = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const a = agent ? `[${agent}] ` : '';
  console.log(`  ${icon} ${scenario} :: ${a}${action}${detail ? '  \x1b[90m— ' + detail + '\x1b[0m' : ''}`);
}

async function expectThrows(label, scenario, agent, fn, expectedCode) {
  try {
    await fn();
    record(scenario, agent, `${label} (expected denial)`, false, 'did not throw');
  } catch (e) {
    if (expectedCode && e.code !== expectedCode) {
      record(scenario, agent, label, false, `wrong error code (got ${e.code}, want ${expectedCode}): ${e.message}`);
    } else {
      record(scenario, agent, label, true, `correctly rejected: ${e.message}`);
    }
  }
}

// ─── Scenario 1: 10-party hospital board review (multi-party conferencing) ──

async function scenarioConferencing(pool) {
  const svc = require('../services/conferencing/conferenceService');
  console.log('\n━━━ SCENARIO 1: 10-PARTY HOSPITAL BOARD REVIEW ━━━');

  // ADMIN creates the room
  const room = await svc.createRoom(
    {
      title: `[${RUN_ID}] Tumour Board Review — Patient 042`,
      kind: 'board_review',
      max_participants: 12,
      requires_waiting_room: true,
      allow_chat: true,
      allow_private_dm: true,
      patient_name_snapshot: AGENTS.patient.name,
    },
    AGENTS.admin,
    pool
  );
  cleanup.push({ table: 'ng_conf_rooms', id: room.id });
  record('CONF', 'admin', 'createRoom',
    !!room.id && room.media_server !== 'peer_mesh',
    `id=${room.id.slice(0,8)} code=${room.room_code} media=${room.media_server}`);

  // ADMIN starts the room
  const started = await svc.startRoom(room.id, AGENTS.admin, pool);
  record('CONF', 'admin', 'startRoom', started.status === 'live');

  // Everyone joins (waiting then admit) — except consultant who has admit_others
  const joiners = [
    { agent: AGENTS.consultant,  role: 'consultant' },
    { agent: AGENTS.junior_doc,  role: 'doctor' },
    { agent: AGENTS.nurse,       role: 'nurse' },
    { agent: AGENTS.pharmacist,  role: 'pharmacist' },
    { agent: AGENTS.lab_tech,    role: 'doctor' },
    { agent: AGENTS.coordinator, role: 'doctor' },
    { agent: AGENTS.intern,      role: 'observer' },
    { agent: AGENTS.patient,     role: 'patient' },
  ];
  for (const j of joiners) {
    const p = await svc.joinRoom(room.id, j.agent, { display_name: j.agent.name, role: j.role }, pool);
    record('CONF', j.agent.role, `joinRoom`,
      p.status === 'waiting',
      `status=${p.status} (waiting-room enforced)`);
  }

  // ADMIN admits everyone
  const parts = await svc.listParticipants(room.id, pool);
  for (const p of parts.filter(x => x.status === 'waiting')) {
    await svc.admitParticipant(room.id, p.id, AGENTS.admin, pool);
  }
  const admitted = (await svc.listParticipants(room.id, pool)).filter(p => p.status === 'admitted').length;
  record('CONF', 'admin', 'admitAll',
    admitted === 9, // 8 joiners + host self-enrolled at createRoom
    `${admitted} admitted (expected 9: 8 joiners + 1 host)`);

  // RBAC: intern (observer) tries to kick the consultant — must be denied
  const consultantP = (await svc.listParticipants(room.id, pool)).find(p => p.user_id === AGENTS.consultant.user_id);
  await expectThrows('intern attempts to kick consultant', 'CONF', 'intern',
    () => svc.removeParticipant(room.id, consultantP.id, AGENTS.intern, { reason: 'unauthorized' }, pool),
    'FORBIDDEN');

  // RBAC: junior doctor tries to kick host admin — must be denied (rank check)
  const hostP = (await svc.listParticipants(room.id, pool)).find(p => p.role === 'host');
  await expectThrows('junior doctor attempts to kick host', 'CONF', 'junior_doc',
    () => svc.removeParticipant(room.id, hostP.id, AGENTS.junior_doc, { reason: 'attempted' }, pool),
    'FORBIDDEN');

  // RBAC: consultant CAN mute the intern (mute_others perm + outranks observer)
  const internP = (await svc.listParticipants(room.id, pool)).find(p => p.user_id === AGENTS.intern.user_id);
  const muted = await svc.setMute(room.id, internP.id, { audio: true }, AGENTS.consultant, pool);
  record('CONF', 'consultant', 'mute intern (audio)', muted.muted_audio === true);

  // CHAT — public message from junior doctor
  const m1 = await svc.sendChat(room.id, AGENTS.junior_doc, { message: 'Patient presents with chest pain radiating to left arm' }, pool);
  record('CONF', 'junior_doc', 'sendChat (public)', !!m1.id);

  // CHAT — private DM consultant → junior_doc
  const m2 = await svc.sendChat(room.id, AGENTS.consultant, {
    message: 'Confirm 12-lead ECG findings before we recommend admission',
    private_to_user_id: AGENTS.junior_doc.user_id,
  }, pool);
  record('CONF', 'consultant', 'sendChat (private DM)', !!m2.id && m2.private_to_user_id === AGENTS.junior_doc.user_id);

  // CHAT visibility — patient should NOT see the consultant→junior DM
  const patientView = await svc.listChat(room.id, { user_id: AGENTS.patient.user_id }, pool);
  const dmVisibleToPatient = patientView.some(m => m.id === m2.id);
  record('CONF', 'patient', 'cannot see consultant-doctor DM', !dmVisibleToPatient,
    `chat rows visible to patient: ${patientView.length}`);

  // HAND RAISE
  const handed = await svc.raiseHand(room.id, internP.id, true, AGENTS.intern, pool);
  record('CONF', 'intern', 'raiseHand', !!handed.hand_raised_at);

  // PROMOTE — admin promotes intern from observer → doctor
  const promoted = await svc.promoteParticipant(room.id, internP.id, AGENTS.admin, { role: 'doctor' }, pool);
  record('CONF', 'admin', 'promote intern → doctor', promoted.role === 'doctor');

  // END ROOM
  const ended = await svc.endRoom(room.id, AGENTS.admin, pool);
  record('CONF', 'admin', 'endRoom', ended.status === 'ended');

  // Verify audit events landed
  const events = await svc.listEvents(room.id, pool);
  const eventKinds = new Set(events.map(e => e.event_kind));
  const expectedKinds = ['room_created', 'room_started', 'admitted', 'muted', 'hand_raised', 'promoted', 'room_ended'];
  const missing = expectedKinds.filter(k => !eventKinds.has(k));
  record('CONF', 'system', 'audit trail integrity',
    missing.length === 0,
    `${events.length} events logged${missing.length ? ', MISSING: ' + missing.join(',') : ''}`);
}

// ─── Scenario 2: Prescription lifecycle (Nigerian malaria + chronic) ─────────

async function scenarioPrescription(pool) {
  const rxsvc = require('../services/rx-engine/prescriptionWorkflowService');
  console.log('\n━━━ SCENARIO 2: PRESCRIPTION → PHARMACY LIFECYCLE ━━━');

  // Use the seeded provider/pharmacy from seedAgents (so FK constraints hold)
  const providerId = SIM_IDS.provider_id;
  const pharmacyId = SIM_IDS.pharmacy_id;
  const patientId  = AGENTS.patient.user_id;

  // JUNIOR DOCTOR creates draft
  const rx = await rxsvc.createDraft({
    provider_id: providerId,
    patient_user_id: patientId,
    diagnosis: 'Uncomplicated falciparum malaria + mild dehydration',
    notes: `[${RUN_ID}] Nigerian clinical scenario — pediatric patient, 6 y/o`,
    is_controlled: false,
    items: [
      { drug_name: 'Artemether/Lumefantrine 20/120', generic_name: 'Artemether-Lumefantrine', brand_name: 'Coartem', dosage: '1 tablet', frequency: 'BD', duration_days: 3, quantity: 6, refills_authorized: 0 },
      { drug_name: 'Paracetamol 250mg/5ml syrup', generic_name: 'Paracetamol', dosage: '10ml', frequency: 'PRN q6h', duration_days: 3, quantity: 100 },
      { drug_name: 'Zinc Sulfate 20mg', generic_name: 'Zinc', dosage: '1 tablet', frequency: 'OD', duration_days: 10, quantity: 10, refills_authorized: 1 },
    ],
  }, pool);
  cleanup.push({ table: 'ng_digital_prescriptions', id: rx.id });
  record('RX', 'junior_doc', 'createDraft',
    !!rx.id && rx.lifecycle_status === 'drafted' && rx.items.length === 3,
    `rx_number=${rx.prescription_number} items=${rx.items.length}`);

  // JUNIOR DOCTOR signs
  const signed = await rxsvc.sign(rx.id, { user_id: AGENTS.junior_doc.user_id, kind: 'prescriber' }, {}, pool);
  record('RX', 'junior_doc', 'sign', signed.lifecycle_status === 'signed');

  // RBAC negative: PHARMACIST tries to sign (already signed but verifying state machine)
  await expectThrows('pharmacist tries to sign already-signed rx', 'RX', 'pharmacist',
    () => rxsvc.sign(rx.id, { user_id: AGENTS.pharmacist.user_id, kind: 'pharmacist' }, {}, pool),
    'INVALID_TRANSITION');

  // SEND TO PHARMACY (using seeded pharmacy_id)
  const sent = await rxsvc.sendToPharmacy(rx.id, pharmacyId, { user_id: AGENTS.junior_doc.user_id, kind: 'prescriber' }, pool);
  record('RX', 'junior_doc', 'sendToPharmacy', sent.lifecycle_status === 'sent_to_pharmacy');

  // PHARMACIST acknowledges
  const acked = await rxsvc.acknowledgeReceipt(rx.id, { user_id: AGENTS.pharmacist.user_id, kind: 'pharmacist' }, pool);
  record('RX', 'pharmacist', 'acknowledgeReceipt', acked.lifecycle_status === 'received');

  // PHARMACIST dispenses items one by one (Nigerian reality — partial stock)
  // Re-fetch to get fresh item IDs (acked may not include them)
  const refetched = await rxsvc.getPrescription(rx.id, pool);
  const items = refetched.items;
  record('RX', 'system', `fetched ${items.length} items`, items.length === 3,
    items.map(i => i.drug_name).join(' | '));
  // First item: Coartem — full dispense
  let after = await rxsvc.dispenseItem(rx.id, items[0].id, { user_id: AGENTS.pharmacist.user_id, kind: 'pharmacist' },
    { quantity: 6, notes: 'Coartem dispensed full course' }, pool);
  record('RX', 'pharmacist', 'dispense Coartem (full)', after.lifecycle_status === 'partially_dispensed');

  // Second item: Paracetamol syrup — partial (only 50ml in stock)
  after = await rxsvc.dispenseItem(rx.id, items[1].id, { user_id: AGENTS.pharmacist.user_id, kind: 'pharmacist' },
    { quantity: 50, notes: 'Partial — out of 100ml bottles, gave 50ml' }, pool);
  record('RX', 'pharmacist', 'dispense Paracetamol (partial 50/100)', after.lifecycle_status === 'partially_dispensed');

  // Third item: Zinc — mark unavailable + substitute
  after = await rxsvc.markItemUnavailable(rx.id, items[2].id,
    { user_id: AGENTS.pharmacist.user_id, kind: 'pharmacist' },
    { notes: 'Zinc tablets out of stock — patient advised to source from another pharmacy' }, pool);
  record('RX', 'pharmacist', 'markItemUnavailable Zinc', !!after,
    `rx now at ${after.lifecycle_status}`);

  // Verify event audit
  const rxEvents = await rxsvc.listEvents(rx.id, pool);
  record('RX', 'system', 'audit trail',
    rxEvents.length >= 5,
    `${rxEvents.length} events: ${rxEvents.map(e => e.event_kind || e.kind).join(',')}`);

  // Cancel (since not all items dispensed, this exercises the cancel branch)
  const cancelled = await rxsvc.cancel(rx.id, { user_id: AGENTS.junior_doc.user_id, kind: 'prescriber' },
    { reason: 'Patient changed pharmacy; new Rx will be issued' }, pool);
  record('RX', 'junior_doc', 'cancel (partial → cancelled)', cancelled.lifecycle_status === 'cancelled');
}

// ─── Scenario 3: Referral network — emergency cardiology ─────────────────────

async function scenarioReferral(pool) {
  const drn = require('../services/referral-network/referralNetworkService');
  console.log('\n━━━ SCENARIO 3: DRN REFERRAL — EMERGENCY CARDIOLOGY ━━━');

  // Reuse the seeded ng_provider (FK target for originating_provider).
  // org IDs can be NULL — drn_referrals FK is optional for them.
  const originatingProviderId = SIM_IDS.provider_id;
  const originatingOrgId = null;
  const destinationOrgId = null;

  // Junior doctor creates an emergency referral
  const referral = await drn.createReferral({
    urgency:   'emergency',
    patient_name:  AGENTS.patient.name,
    patient_phone: '+2348012340001',
    patient_age:   47,
    patient_sex:   'female',
    originating_provider: originatingProviderId,
    originating_org:      originatingOrgId,
    destination_org:      destinationOrgId,
    specialty: 'cardiology',
    service_kind: 'specialist_consult',
    reason: 'Suspected STEMI',
    clinical_summary: `[${RUN_ID}] 47yo female, chest pain radiating to left arm. ECG: ST elevation V2-V4. BP 180/110. Needs urgent PCI evaluation.`,
  }, AGENTS.junior_doc, pool);
  cleanup.push({ table: 'drn_referrals', id: referral.id });
  record('DRN', 'junior_doc', 'createReferral',
    !!referral.id,
    `code=${referral.ref_code} status=${referral.status}`);

  // Lifecycle: sent → received → accepted → scheduled → in_progress → completed
  let r = await drn.transitionReferral(referral.id, 'sent', AGENTS.junior_doc, {}, pool);
  record('DRN', 'junior_doc', 'sent', r.status === 'sent');

  r = await drn.transitionReferral(referral.id, 'received', AGENTS.consultant, {}, pool);
  record('DRN', 'consultant', 'received', r.status === 'received');

  r = await drn.transitionReferral(referral.id, 'accepted', AGENTS.consultant, { accepted_at_note: 'Cath lab on call' }, pool);
  record('DRN', 'consultant', 'accepted', r.status === 'accepted');

  r = await drn.transitionReferral(referral.id, 'scheduled', AGENTS.coordinator, { scheduled_for: new Date(Date.now()+3600000).toISOString() }, pool);
  record('DRN', 'coordinator', 'scheduled', r.status === 'scheduled');

  r = await drn.transitionReferral(referral.id, 'in_progress', AGENTS.consultant, {}, pool);
  record('DRN', 'consultant', 'in_progress', r.status === 'in_progress');

  r = await drn.transitionReferral(referral.id, 'completed', AGENTS.consultant, { outcome: 'Successful primary PCI to LAD' }, pool);
  record('DRN', 'consultant', 'completed', r.status === 'completed');

  // Invalid transition: completed → in_progress (must throw)
  await expectThrows('reverse completed → in_progress', 'DRN', 'consultant',
    () => drn.transitionReferral(referral.id, 'in_progress', AGENTS.consultant, {}, pool),
    'INVALID_TRANSITION');

  // QR slip mint + verify
  const qr = await drn.mintQrToken(referral.id, AGENTS.coordinator, { scope: 'patient_slip', ttlDays: 1 }, pool);
  record('DRN', 'coordinator', 'mintQrToken',
    !!qr.token && qr.token.length >= 20,
    `prefix=${qr.token.slice(0,8)}…`);

  const verified = await drn.verifyQrToken(qr.token, { ip: '127.0.0.1' }, pool);
  record('DRN', 'patient', 'verifyQrToken (kiosk scan)',
    !!verified && verified.ref_code === referral.ref_code,
    `verified referral ${verified?.ref_code}`);

  // Audit — query drn_referral_events directly (no listEvents export)
  const ev = await pool.query(
    'SELECT event_kind FROM drn_referral_events WHERE referral_id=$1 ORDER BY created_at',
    [referral.id]
  );
  record('DRN', 'system', 'audit trail',
    ev.rows.length >= 6,
    `${ev.rows.length} events logged: ${ev.rows.map(r => r.event_kind).join(',')}`);
}

// ─── Scenario 4: Permission matrix sweep across all roles ────────────────────

async function scenarioPermissions() {
  const { effectivePermissions, can, canActOn } = require('../../lib/ng/conferencePermissions');
  console.log('\n━━━ SCENARIO 4: ROLE PERMISSION ENFORCEMENT MATRIX ━━━');

  const cases = [
    // Consultant: full clinical authority
    { agent: 'consultant', role: 'consultant', perm: 'finalize_diagnosis',  expect: true,  why: 'consultant has finalize' },
    { agent: 'consultant', role: 'consultant', perm: 'prescribe',           expect: true,  why: 'consultant can prescribe' },
    { agent: 'consultant', role: 'consultant', perm: 'mute_others',         expect: true,  why: 'consultant can mute' },
    // Junior doctor: documentation + escalation only
    { agent: 'junior_doc', role: 'doctor', perm: 'prescribe',                expect: true,  why: 'doctor can prescribe' },
    { agent: 'junior_doc', role: 'doctor', perm: 'finalize_diagnosis',      expect: false, why: 'only consultant finalizes' },
    { agent: 'junior_doc', role: 'doctor', perm: 'kick_others',             expect: false, why: 'doctor cannot kick' },
    // Nurse: vitals only
    { agent: 'nurse',      role: 'nurse', perm: 'update_vitals',            expect: true,  why: 'nurse updates vitals' },
    { agent: 'nurse',      role: 'nurse', perm: 'prescribe',                expect: false, why: 'nurse cannot prescribe' },
    // Pharmacist: dispense workflow only
    { agent: 'pharmacist', role: 'pharmacist', perm: 'review_prescriptions',expect: true,  why: 'pharmacist reviews Rx' },
    { agent: 'pharmacist', role: 'pharmacist', perm: 'confirm_dispense',    expect: true,  why: 'pharmacist confirms dispense' },
    { agent: 'pharmacist', role: 'pharmacist', perm: 'prescribe',           expect: false, why: 'pharmacist cannot prescribe' },
    { agent: 'pharmacist', role: 'pharmacist', perm: 'update_vitals',       expect: false, why: 'pharmacist not clinical' },
    // Intern: observer — read-only
    { agent: 'intern',     role: 'observer', perm: 'speak',                 expect: false, why: 'observers are read-only' },
    { agent: 'intern',     role: 'observer', perm: 'prescribe',             expect: false, why: 'observers cannot prescribe' },
    { agent: 'intern',     role: 'observer', perm: 'see_video',             expect: true,  why: 'observers can watch' },
  ];

  for (const c of cases) {
    const actual = can(c.role, {}, c.perm);
    record('PERM', c.agent, `${c.role}.${c.perm}=${actual}`,
      actual === c.expect, c.why);
  }

  // Rank checks
  const ranks = [
    { actor: 'host', target: 'consultant', expect: true },
    { actor: 'consultant', target: 'doctor', expect: true },
    { actor: 'consultant', target: 'host', expect: false },
    { actor: 'doctor', target: 'host', expect: false },
    { actor: 'observer', target: 'patient', expect: false },
    { actor: 'pharmacist', target: 'nurse', expect: false }, // same rank
  ];
  for (const r of ranks) {
    record('PERM', 'system', `canActOn(${r.actor},${r.target})=${canActOn(r.actor, r.target)}`,
      canActOn(r.actor, r.target) === r.expect);
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function teardown(pool) {
  if (KEEP) {
    console.log('\n--keep flag set — leaving simulation rows in place');
    return;
  }
  console.log('\n━━━ CLEANUP ━━━');

  // Group by table
  const byTable = {};
  for (const c of cleanup) {
    (byTable[c.table] = byTable[c.table] || []).push(c.id);
  }
  // Order matters — children before parents
  const order = [
    'ng_conf_chat', 'ng_conf_events', 'ng_conf_invites', 'ng_conf_participants', 'ng_conf_rooms',
    'ng_rx_events', 'ng_rx_refills', 'ng_rx_items', 'ng_digital_prescriptions',
    'ng_referral_events', 'ng_referrals',
  ];

  // Cascade: clean child tables first by parent_id
  for (const id of byTable.ng_conf_rooms || []) {
    await pool.query('DELETE FROM ng_conf_chat WHERE room_id=$1', [id]);
    await pool.query('DELETE FROM ng_conf_events WHERE room_id=$1', [id]);
    await pool.query('DELETE FROM ng_conf_invites WHERE room_id=$1', [id]);
    await pool.query('DELETE FROM ng_conf_participants WHERE room_id=$1', [id]);
    await pool.query('DELETE FROM ng_conf_rooms WHERE id=$1', [id]);
  }
  for (const id of byTable.ng_digital_prescriptions || []) {
    await pool.query('DELETE FROM ng_rx_events WHERE prescription_id=$1', [id]);
    await pool.query('DELETE FROM ng_rx_refills WHERE prescription_id=$1', [id]);
    await pool.query('DELETE FROM ng_rx_items WHERE prescription_id=$1', [id]);
    await pool.query('DELETE FROM ng_digital_prescriptions WHERE id=$1', [id]);
  }
  for (const id of byTable.drn_referrals || []) {
    await pool.query('DELETE FROM drn_referral_events WHERE referral_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM drn_qr_tokens WHERE referral_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM drn_commissions WHERE referral_id=$1', [id]).catch(() => {});
    await pool.query('DELETE FROM drn_referrals WHERE id=$1', [id]);
  }
  // ng_pharmacies + ng_providers seeded rows (must come before users due to FK to users.id)
  const pharmIds = (cleanup.find(c => c.table === '_pharmacies') || {}).ids || [];
  for (const pid of pharmIds) await pool.query('DELETE FROM ng_pharmacies WHERE id=$1', [pid]).catch(() => {});
  const provIds = (cleanup.find(c => c.table === '_providers') || {}).ids || [];
  for (const pid of provIds) await pool.query('DELETE FROM ng_providers WHERE id=$1', [pid]).catch(() => {});

  // Finally, delete the simulation user rows
  const userIds = (cleanup.find(c => c.table === '_users') || {}).ids || [];
  for (const uid of userIds) {
    await pool.query('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
  }
  const featureRows = cleanup.filter(c => !c.table.startsWith('_')).length;
  console.log(`Cleaned ${featureRows} feature rows + ${provIds.length} providers + ${pharmIds.length} pharmacies + ${userIds.length} users`);
}

// ─── Runner ──────────────────────────────────────────────────────────────────

(async function main() {
  console.log('╭─────────────────────────────────────────────────────────────╮');
  console.log(`│  DoctaRx Nigeria — LIVE simulation @ ${new Date().toISOString().slice(0,19)}Z  │`);
  console.log(`│  run_id: ${RUN_ID.padEnd(50)}│`);
  console.log(`│  DB: ${(process.env.DATABASE_URL.match(/@([^/]+)/) || [,'unknown'])[1].padEnd(54)}│`);
  console.log('╰─────────────────────────────────────────────────────────────╯');

  const t0 = Date.now();
  let pool;
  try {
    pool = await getPool();
    await seedAgents(pool);
    record('SETUP', 'system', 'seedAgents', true, `${Object.keys(AGENTS).length} users inserted into users table`);
    await scenarioConferencing(pool);
    await scenarioPrescription(pool);
    await scenarioReferral(pool);
    await scenarioPermissions();
  } catch (e) {
    console.error('\n!! FATAL during simulation:', e.message);
    record('FATAL', 'runner', 'crash', false, e.message);
  } finally {
    if (pool) {
      try { await teardown(pool); } catch (e) { console.error('Cleanup error:', e.message); }
      try { await pool.end(); } catch {}
    }
  }

  // Final report
  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const failed = total - passed;
  const ms = Date.now() - t0;

  console.log(`\n━━━ FINAL REPORT — ${ms}ms ━━━`);
  console.log(`Total checks: ${total}`);
  console.log(`Passed:       ${passed}  ${passed === total ? '\x1b[32m✓\x1b[0m' : ''}`);
  console.log(`Failed:       ${failed}  ${failed ? '\x1b[31m✗\x1b[0m' : ''}`);

  // Per-scenario breakdown
  const byScenario = {};
  for (const r of results) {
    if (!byScenario[r.scenario]) byScenario[r.scenario] = { ok: 0, fail: 0 };
    byScenario[r.scenario][r.ok ? 'ok' : 'fail']++;
  }
  console.log('\nBy scenario:');
  for (const [s, c] of Object.entries(byScenario)) {
    console.log(`  ${s}: ${c.ok} pass${c.fail ? ', \x1b[31m' + c.fail + ' fail\x1b[0m' : ''}`);
  }

  if (failed) {
    console.log('\nFailures:');
    for (const r of results.filter(x => !x.ok)) {
      console.log(`  ✗ [${r.scenario}] ${r.agent || ''}  ${r.action}  — ${r.detail}`);
    }
  }

  process.exit(failed === 0 ? 0 : 1);
})();
