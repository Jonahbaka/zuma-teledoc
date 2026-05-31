'use strict';

/**
 * ng/tests/portal-contract.test.js
 *
 * Durable portal-correctness regression suite. CI-safe and hermetic: it asserts
 * against the actual Next.js route files on disk (no browser, no server). These
 * tests fail the build if portal routing regresses to the failure modes that
 * shipped to production before (e.g. /ng/patient rendering pharmacy search, or a
 * Nigeria route falling back into the US dashboard tree).
 *
 * Contract enforced:
 *   1. Every expected /ng/* portal route file EXISTS (a missing file == 404).
 *   2. /ng/patient renders a PATIENT portal, not a pharmacy-search experience.
 *   3. /ng/pharmacy renders a PHARMACY portal, not the patient portal.
 *   4. /ng/admin and /ng/provider render their own portals.
 *   5. Country separation: Nigeria portal layouts use the Nigeria shell and never
 *      the US DashboardLayout as their portal chrome.
 *
 *   node ng/tests/portal-contract.test.js   → exit 0 if all pass, 1 otherwise
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
const APP = path.join(ROOT, 'app');

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// Pharmacy-search marker strings that were the ORIGINAL defect on /ng/patient.
const PHARMACY_SEARCH_MARKERS = [
  'Compare Pharmacies',
  'Find Best Pharmacies',
  'Search medications',
  'Open Test Video Call',
];

// ── 1. Route existence: a missing page.js for an expected route == 404 ─────────
const REQUIRED_NG_ROUTES = {
  patient: [
    'app/ng/patient/page.js',
    'app/ng/patient/appointments/page.js',
    'app/ng/patient/prescriptions/page.js',
    'app/ng/patient/orders/page.js',
    'app/ng/patient/messages/page.js',
    'app/ng/patient/records/page.js',
    'app/ng/patient/profile/page.js',
    'app/ng/patient/settings/page.js',
    'app/ng/patient/notifications/page.js',
    'app/ng/patient/search/page.js',
  ],
  provider: [
    'app/ng/provider/page.js',
    'app/ng/provider/dashboard/page.js',
    'app/ng/provider/appointments/page.js',
    'app/ng/provider/patients/page.js',
    'app/ng/provider/prescriptions/page.js',
    'app/ng/provider/referrals/page.js',
    'app/ng/provider/profile/page.js',
    'app/ng/provider/settings/page.js',
  ],
  pharmacy: [
    'app/ng/pharmacy/page.js',
    'app/ng/pharmacy/login/page.js',
    'app/ng/pharmacy/register/page.js',
    'app/ng/pharmacy/dashboard/page.js',
    'app/ng/pharmacy/orders/page.js',
    'app/ng/pharmacy/inventory/page.js',
    'app/ng/pharmacy/wallet/page.js',
    'app/ng/pharmacy/profile/page.js',
    'app/ng/pharmacy/settings/page.js',
    'app/ng/pharmacy/notifications/page.js',
  ],
  admin: [
    'app/ng/admin/page.js',
    'app/ng/admin/pharmacies/page.js',
    'app/ng/admin/analytics/page.js',
    'app/ng/admin/compliance/page.js',
    'app/ng/admin/revenue/page.js',
    'app/ng/admin/profile/page.js',
    'app/ng/admin/settings/page.js',
    'app/ng/admin/notifications/page.js',
  ],
};

for (const [portal, routes] of Object.entries(REQUIRED_NG_ROUTES)) {
  test(`route existence: /ng/${portal} tree has no missing pages (404 guard)`, () => {
    const missing = routes.filter((r) => !exists(r));
    assert.strictEqual(missing.length, 0, `missing route files (would 404): ${missing.join(', ')}`);
  });
}

// ── 2. /ng/patient is a PATIENT portal, NOT pharmacy search ────────────────────
test('/ng/patient renders a patient portal (not pharmacy-search UI)', () => {
  const src = read('app/ng/patient/page.js');
  // Must NOT be the pharmacy-search experience that was the original bug.
  for (const marker of PHARMACY_SEARCH_MARKERS) {
    assert.ok(!src.includes(marker),
      `/ng/patient must not present pharmacy-search "${marker}" as its primary experience`);
  }
  // Must contain genuine patient-portal functionality.
  const patientSignals = ['Book Consultation', 'Prescriptions', 'Messages', 'appointmentsAPI'];
  const present = patientSignals.filter((s) => src.includes(s));
  assert.ok(present.length >= 3,
    `/ng/patient must expose patient functionality; found only: ${present.join(', ')}`);
  // Must actually load data (not a static shell).
  assert.ok(/useEffect|Promise\.all|await /.test(src), '/ng/patient must load data, not be a static stub');
});

test('/ng/patient/search exists as a SUBFEATURE, not the portal root', () => {
  // Pharmacy / care discovery is allowed here — but only as a nested route.
  assert.ok(exists('app/ng/patient/search/page.js'), 'search subfeature must exist');
  const src = read('app/ng/patient/search/page.js');
  assert.ok(/NigeriaCareDiscoveryExperience|embeddedInPortal/.test(src),
    'search route should embed the discovery experience inside the patient portal');
});

// ── 3. /ng/pharmacy is a PHARMACY portal, not the patient portal ───────────────
test('/ng/pharmacy renders the pharmacy portal (not the patient portal)', () => {
  const src = read('app/ng/pharmacy/page.js');
  assert.ok(/Pharmacy/i.test(src), '/ng/pharmacy must reference pharmacy context');
  assert.ok(!/NigeriaPatientPortalPage|patient dashboard/i.test(src),
    '/ng/pharmacy must not render the patient portal');
});

// ── 4. /ng/admin and /ng/provider render their own portals ─────────────────────
test('/ng/admin renders the admin/ops portal', () => {
  const src = read('app/ng/admin/page.js');
  assert.ok(/Admin|Ops|Operations|Dashboard/i.test(src), '/ng/admin must render an admin/ops surface');
  const layout = read('app/ng/admin/layout.js');
  assert.ok(/nigeriaAdminNavigation/.test(layout), '/ng/admin layout must use the Nigeria admin navigation');
});

test('/ng/provider renders the provider portal', () => {
  assert.ok(exists('app/ng/provider/page.js'));
  const src = read('app/ng/provider/page.js');
  assert.ok(/Provider/i.test(src), '/ng/provider must render a provider surface');
});

// ── 5. Country separation: NG portal chrome uses the Nigeria shell, never US ───
const NG_LAYOUTS = [
  'app/ng/patient/layout.js',
  'app/ng/admin/layout.js',
];
for (const layout of NG_LAYOUTS) {
  test(`country separation: ${layout} uses the Nigeria shell, not US DashboardLayout`, () => {
    assert.ok(exists(layout), `${layout} must exist`);
    const src = read(layout);
    assert.ok(/NigeriaPortalShell|NigeriaPharmacyPortalShell/.test(src),
      `${layout} must use a Nigeria portal shell`);
    assert.ok(!/components\/layouts\/DashboardLayout/.test(src),
      `${layout} must NOT import the US DashboardLayout as its portal chrome`);
  });
}

test('country separation: US patient portal is independent of the NG patient shell', () => {
  // The US portal must keep using its own DashboardLayout, untouched by NG work.
  const usLayout = read('app/(dashboard)/patient/layout.js');
  assert.ok(/components\/layouts\/DashboardLayout/.test(usLayout),
    'US patient portal must retain its own DashboardLayout');
  assert.ok(!/NigeriaPortalShell/.test(usLayout),
    'US patient portal must not be overwritten with the Nigeria shell');
});

test('auth guard: /ng/patient layout protects the portal', () => {
  const src = read('app/ng/patient/layout.js');
  assert.ok(/login|redirect|loginPath|auth/i.test(src),
    '/ng/patient layout must gate access (login/redirect)');
});

// ── Runner ────────────────────────────────────────────────────────────────────
(async () => {
  let passed = 0, failed = 0;
  for (const { name, fn } of cases) {
    try { await fn(); console.log(`\x1b[32m✓\x1b[0m [PASS] ${name}`); passed++; }
    catch (e) { console.log(`\x1b[31m✗\x1b[0m [FAIL] ${name} — ${e.message}`); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
