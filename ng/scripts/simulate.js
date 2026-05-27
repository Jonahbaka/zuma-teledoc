'use strict';

/**
 * ng/scripts/simulate.js
 *
 * Agent-based simulation harness for the DoctaRx NG platform.
 *
 * The directive asks for "specialized simulation agents" that
 * autonomously exercise the conferencing, prescription, and referral
 * workflows under realistic clinical scenarios — multi-party
 * conferences, weak-network reconnects, partial dispenses, declined
 * referrals, etc.
 *
 * This is a hermetic, deterministic driver. It does NOT touch the
 * database — it exercises the pure state-machine and permission
 * helpers that the production services delegate to, so it runs in
 * about 100ms with no infrastructure. The point is to surface
 * invariant violations before they make it into a demo or a release.
 *
 * USAGE:
 *   node ng/scripts/simulate.js                       # run all suites
 *   node ng/scripts/simulate.js --suite=conferencing  # one suite
 *   node ng/scripts/simulate.js --verbose             # log every step
 *
 * Exits 0 if every scenario passes, 1 if any fails.
 */

const args = parseArgs(process.argv.slice(2));
const SUITES = ['conferencing', 'prescriptions', 'referrals'];

const ALL_SCENARIOS = [
  ...require('./simulate/conferencingFlows').scenarios,
  ...require('./simulate/prescriptionFlows').scenarios,
  ...require('./simulate/referralFlows').scenarios,
];

(async function main() {
  const chosen = args.suite ? ALL_SCENARIOS.filter(s => s.suite === args.suite) : ALL_SCENARIOS;
  if (chosen.length === 0) {
    console.error(`No scenarios match suite=${args.suite}. Available: ${SUITES.join(', ')}`);
    process.exit(2);
  }

  console.log(`╭─ DoctaRx NG simulation — ${chosen.length} scenario(s)`);

  const results = [];
  for (const sc of chosen) {
    const t0 = Date.now();
    const ctx = { steps: [] };
    try {
      await sc.run(ctx);
      results.push({ name: sc.name, suite: sc.suite, ok: true, ms: Date.now() - t0, steps: ctx.steps });
    } catch (e) {
      results.push({ name: sc.name, suite: sc.suite, ok: false, ms: Date.now() - t0, steps: ctx.steps, err: e.message });
    }
  }

  // Report
  let bySuite = {};
  for (const r of results) {
    (bySuite[r.suite] = bySuite[r.suite] || []).push(r);
  }
  for (const suite of Object.keys(bySuite)) {
    console.log(`│`);
    console.log(`├─ ${suite}`);
    for (const r of bySuite[suite]) {
      const icon = r.ok ? '✓' : '✗';
      const colour = r.ok ? '\x1b[32m' : '\x1b[31m';
      console.log(`│  ${colour}${icon}\x1b[0m ${r.name}  \x1b[90m${r.ms}ms\x1b[0m`);
      if (args.verbose) {
        for (const s of r.steps) console.log(`│      · ${s}`);
      }
      if (!r.ok) {
        console.log(`│      \x1b[31m${r.err}\x1b[0m`);
      }
    }
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`│`);
  console.log(`╰─ ${passed}/${results.length} passed${failed ? `, \x1b[31m${failed} failed\x1b[0m` : ''}`);

  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Harness crashed:', e);
  process.exit(2);
});

function parseArgs(argv) {
  const out = { verbose: false, suite: null };
  for (const a of argv) {
    if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a.startsWith('--suite=')) out.suite = a.split('=')[1];
  }
  return out;
}
