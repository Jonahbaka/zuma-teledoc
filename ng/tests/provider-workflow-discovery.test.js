'use strict';

/**
 * ng/tests/provider-workflow-discovery.test.js
 *
 * Visible-workflow contract. The lifecycle is only "integrated" if a real
 * provider can DISCOVER and EXECUTE it from the visible portal — not merely if
 * routes return 200. These tests assert that the shipped components contain the
 * concrete, user-visible entry points and that the premium clinical room is
 * wired (no placeholder copy). This is the deterministic CI guarantee that the
 * deployed bundle carries the discoverable workflow; live browser screenshots
 * (scripts/e2e-ng-lifecycle-browser.cjs) provide the visual companion evidence.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const dashboard = read('components/provider/NGProviderDashboard.jsx');
const room = read('components/ng/conference/NGVideoCall.jsx');
const adminNav = read('components/ng/portalNavigation.js');
const adminConsult = read('app/ng/admin/consultations/page.js');
const adminRedirect = read('app/ng/admin/dashboard/page.js');
const adminApi = read('ng/routes/admin.js');

describe('Provider dashboard exposes the operating workspace (discoverable)', () => {
  it('shows a Telehealth entry point that routes to the clinical room', () => {
    assert.match(dashboard, /Telehealth Center/);
    // market-aware base resolves to /ng/provider or /provider at runtime
    assert.match(dashboard, /\$\{base\}\/call/);
  });

  it('exposes EMR/SOAP, Prescriptions, Referrals, and Pharmacy status', () => {
    assert.match(dashboard, /EMR \/ SOAP Notes/);
    assert.match(dashboard, /Prescriptions/);
    assert.match(dashboard, /Referrals/);
    assert.match(dashboard, /Pharmacy Status/);
  });

  it('exposes Appointments and Visits/Encounters', () => {
    assert.match(dashboard, /Appointments/);
    assert.match(dashboard, /Visits \/ Encounters/);
    assert.match(dashboard, /\$\{base\}\/visits/);
  });

  it('routes "Start" on a video appointment to a call page with appointment context', () => {
    assert.match(dashboard, /\$\{base\}\/call\?appointmentId=\$\{appt\.id\}/);
  });

  it('no longer ships a "Module Viewer" dead-end header for workspace items', () => {
    assert.doesNotMatch(dashboard, /Module Viewer/);
  });
});

describe('Premium clinical video room is wired (not a placeholder)', () => {
  it('uses clinical/product button copy, never "Start LiveKit Room"', () => {
    assert.doesNotMatch(room, /Start LiveKit Room/i);
    assert.match(room, /Start New Consultation/);
  });

  it('has mic, camera, and screen-share controls', () => {
    assert.match(room, /toggleMute/);
    assert.match(room, /toggleVideo/);
    assert.match(room, /toggleScreenShare/);
    assert.match(room, /setScreenShareEnabled/);
  });

  it('has participants, vitals, AI/SOAP, and chat panels', () => {
    assert.match(room, /ParticipantsPanel/);
    assert.match(room, /VitalsPanel/);
    assert.match(room, /NotesPanel/);
    assert.match(room, /ChatPanel/);
  });

  it('links SOAP/EMR and Create Prescription to the consultation context', () => {
    assert.match(room, /openClinicalRecord/);
    assert.match(room, /createPrescription/);
    assert.match(room, /\/ng\/provider\/appointments\/\$\{appointmentId\}\/visit/);
  });

  it('has return-to-dashboard navigation both in-call and on the ended screen', () => {
    const matches = room.match(/\/ng\/provider\/dashboard/g) || [];
    assert.ok(matches.length >= 2, 'expected at least two dashboard return paths');
  });

  it('passes appointment/patient linkage when creating a room', () => {
    assert.match(room, /appointment_id: appointmentId/);
    assert.match(room, /patient_user_id: patientId/);
  });
});

describe('Admin oversight route is correct and lifecycle-aware', () => {
  it('/ng/admin/dashboard redirects to the real admin root (no 404)', () => {
    assert.match(adminRedirect, /redirect\(['"]\/ng\/admin['"]\)/);
  });

  it('admin navigation exposes a Consultation Lifecycle item', () => {
    assert.match(adminNav, /Consultation Lifecycle/);
    assert.match(adminNav, /\/ng\/admin\/consultations/);
  });

  it('the consultations page renders the full lifecycle chain columns', () => {
    for (const col of ['Patient', 'Provider', 'Call Status', 'Encounter', 'Prescription', 'Dispense', 'Patient Status']) {
      assert.ok(adminConsult.includes(col), `consultations page missing column "${col}"`);
    }
  });

  it('the admin API joins appointment → room → encounter → prescription', () => {
    assert.match(adminApi, /\/consultations\/lifecycle/);
    assert.match(adminApi, /ng_conf_rooms\s+cr\s+ON\s+cr\.appointment_id\s*=\s*a\.id/);
    assert.match(adminApi, /ng_clinical_encounters\s+ce\s+ON\s+ce\.appointment_id\s*=\s*a\.id/);
    assert.match(adminApi, /ng_digital_prescriptions\s+dp/);
  });
});
