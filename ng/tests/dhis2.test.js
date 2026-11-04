'use strict';

/**
 * ng/tests/dhis2.test.js
 * Unit tests for DHIS2 dry-run validation logic.
 * These tests validate the readiness check logic without DB access.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Readiness check mirrors (from publicHealthProgrammeService.js) ──────────

function buildReadinessBlockers(settings) {
  const blockers = [];
  if (!settings) { blockers.push('DHIS2 settings not configured.'); return blockers; }

  if (!settings.enabled)                                           blockers.push('DHIS2 integration is disabled.');
  if (settings.environment === 'disabled')                         blockers.push('DHIS2 environment is set to disabled.');
  if (!settings.base_url_configured)                              blockers.push('DHIS2 base URL not configured.');
  if (!settings.api_token_configured)                             blockers.push('DHIS2 API token not configured.');
  if (!settings.dataset_id)                                        blockers.push('dataset_id not configured.');
  if (!settings.org_unit_id)                                       blockers.push('org_unit_id not configured.');
  if (settings.government_approval_status !== 'approved')          blockers.push('Government approval for DHIS2 integration is pending.');
  if (settings.data_sharing_agreement_status !== 'approved')       blockers.push('Data sharing agreement not approved.');
  if (settings.ndpr_review_status !== 'approved')                  blockers.push('NDPR review not approved.');

  return blockers;
}

function isDryRunSafe(settings) {
  return settings?.dry_run_only === true;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DHIS2 readiness checks', () => {
  it('returns blocker when settings are null', () => {
    const blockers = buildReadinessBlockers(null);
    assert.ok(blockers.length > 0);
    assert.ok(blockers.some((b) => b.toLowerCase().includes('not configured')));
  });

  it('returns blocker when disabled', () => {
    const blockers = buildReadinessBlockers({
      enabled: false, environment: 'disabled',
      base_url_configured: false, api_token_configured: false,
      dataset_id: null, org_unit_id: null,
      government_approval_status: 'pending',
      data_sharing_agreement_status: 'pending',
      ndpr_review_status: 'pending',
    });
    assert.ok(blockers.some((b) => b.includes('disabled')));
  });

  it('fully configured and approved settings have no blockers', () => {
    const blockers = buildReadinessBlockers({
      enabled: true,
      environment: 'sandbox',
      base_url_configured: true,
      api_token_configured: true,
      dataset_id: 'DS123',
      org_unit_id: 'OU456',
      government_approval_status: 'approved',
      data_sharing_agreement_status: 'approved',
      ndpr_review_status: 'approved',
    });
    assert.equal(blockers.length, 0, `Unexpected blockers: ${blockers.join(', ')}`);
  });

  it('partial config produces multiple targeted blockers', () => {
    const blockers = buildReadinessBlockers({
      enabled: true,
      environment: 'sandbox',
      base_url_configured: true,
      api_token_configured: false,     // missing
      dataset_id: null,                // missing
      org_unit_id: 'OU456',
      government_approval_status: 'approved',
      data_sharing_agreement_status: 'pending',   // not approved
      ndpr_review_status: 'approved',
    });
    assert.ok(blockers.some((b) => b.includes('API token')),           'Should flag missing API token');
    assert.ok(blockers.some((b) => b.includes('dataset_id')),          'Should flag missing dataset_id');
    assert.ok(blockers.some((b) => b.includes('Data sharing')),        'Should flag data sharing agreement');
  });
});

describe('DHIS2 dry-run safety', () => {
  it('dry_run_only = true is safe', () => {
    assert.ok(isDryRunSafe({ dry_run_only: true }));
  });

  it('dry_run_only = false is not safe for dry-run', () => {
    assert.ok(!isDryRunSafe({ dry_run_only: false }));
  });

  it('null settings are not safe', () => {
    assert.ok(!isDryRunSafe(null));
  });
});
