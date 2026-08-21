'use strict';

/**
 * ng/tests/rbac.test.js
 * Authorization unit tests for the RBAC + ABAC middleware.
 * Run with: node --test ng/tests/rbac.test.js
 * (Node.js 18+ built-in test runner — no Jest dependency required)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  canonicalRole,
  hasMinRole,
  isSuperAdmin,
  requireAnalystPlus,
  requireApprovalAuthority,
  requireExportAuthority,
  requireGovernmentMfa,
  roleLevel,
  scopeMatchesResource,
} = require('../middleware/rbac');

async function runMiddleware(middleware, user, cookies = {}) {
  let nextCalled = false;
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await middleware({ user, cookies }, response, () => { nextCalled = true; });
  return { nextCalled, response };
}

describe('canonicalRole', () => {
  it('normalises whitespace and case', () => {
    assert.equal(canonicalRole('  Super_Admin  '), 'super_admin');
    assert.equal(canonicalRole('ANALYST'), 'analyst');
    assert.equal(canonicalRole('Platform Admin'), 'platform_admin');
  });

  it('handles empty / null / undefined gracefully', () => {
    assert.equal(canonicalRole(''), '');
    assert.equal(canonicalRole(null), '');
    assert.equal(canonicalRole(undefined), '');
  });
});

describe('roleLevel', () => {
  it('super_admin has highest level', () => {
    assert.ok(roleLevel('super_admin') > roleLevel('platform_admin'));
    assert.ok(roleLevel('platform_admin') > roleLevel('executive_read_only'));
  });

  it('approver is above reviewer', () => {
    assert.ok(roleLevel('approver') > roleLevel('reviewer'));
  });

  it('provider has lowest level', () => {
    const roles = ['analyst', 'reviewer', 'approver', 'facility_admin', 'programme_admin', 'executive_read_only', 'platform_admin', 'super_admin'];
    for (const r of roles) {
      assert.ok(roleLevel(r) > roleLevel('provider'), `${r} should outrank provider`);
    }
  });

  it('unknown role returns 0', () => {
    assert.equal(roleLevel('unknown_role'), 0);
  });
});

describe('hasMinRole', () => {
  it('super_admin passes all min-role checks', () => {
    const user = { role: 'super_admin' };
    for (const r of ['analyst', 'reviewer', 'approver', 'platform_admin']) {
      assert.ok(hasMinRole(user, r), `super_admin should pass ${r} check`);
    }
  });

  it('provider fails analyst check', () => {
    const user = { role: 'provider' };
    assert.ok(!hasMinRole(user, 'analyst'));
  });

  it('analyst passes analyst check but fails approver check', () => {
    const user = { role: 'analyst' };
    assert.ok(hasMinRole(user, 'analyst'));
    assert.ok(!hasMinRole(user, 'approver'));
  });

  it('uses ng_role field as fallback', () => {
    const user = { ng_role: 'reviewer' };
    assert.ok(hasMinRole(user, 'analyst'));
    assert.ok(!hasMinRole(user, 'approver'));
  });
});

describe('isSuperAdmin', () => {
  it('returns true only for super_admin', () => {
    assert.ok(isSuperAdmin({ role: 'super_admin' }));
    assert.ok(!isSuperAdmin({ role: 'platform_admin' }));
    assert.ok(!isSuperAdmin({ role: 'approver' }));
    assert.ok(!isSuperAdmin({}));
  });
});

describe('government middleware scope requirements', () => {
  it('does not treat an unscoped analyst base role as global access', async () => {
    const result = await runMiddleware(requireAnalystPlus, { role: 'analyst' });
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.statusCode, 403);
  });

  it('does not grant export or approval authority from unscoped operational roles', async () => {
    const exportResult = await runMiddleware(requireExportAuthority(), { role: 'analyst' });
    const approvalResult = await runMiddleware(requireApprovalAuthority(), { role: 'approver' });
    assert.equal(exportResult.nextCalled, false);
    assert.equal(exportResult.response.statusCode, 403);
    assert.equal(approvalResult.nextCalled, false);
    assert.equal(approvalResult.response.statusCode, 403);
  });

  it('allows platform-wide administrators through the global role gate', async () => {
    const result = await runMiddleware(requireAnalystPlus, { role: 'platform_admin' });
    assert.equal(result.nextCalled, true);
  });
});

describe('government object scope matching', () => {
  const areaScope = {
    jurisdiction_id: 'area-1',
    facility_id: null,
    programme_area: null,
  };
  const facilityScope = {
    jurisdiction_id: 'facility-jurisdiction-1',
    facility_id: 'facility-1',
    programme_area: 'maternal_health',
  };

  it('allows a parent jurisdiction assignment to access a descendant resource', () => {
    assert.equal(scopeMatchesResource(areaScope, new Set(['facility-jurisdiction-1', 'area-1'])), true);
  });

  it('denies a resource outside the assigned jurisdiction ancestry', () => {
    assert.equal(scopeMatchesResource(areaScope, new Set(['facility-jurisdiction-2', 'area-2'])), false);
  });

  it('enforces facility and programme restrictions together', () => {
    const ancestors = new Set(['facility-jurisdiction-1']);
    assert.equal(scopeMatchesResource(facilityScope, ancestors, {
      facilityId: 'facility-1',
      programmeArea: 'maternal_health',
    }), true);
    assert.equal(scopeMatchesResource(facilityScope, ancestors, {
      facilityId: 'facility-2',
      programmeArea: 'maternal_health',
    }), false);
    assert.equal(scopeMatchesResource(facilityScope, ancestors, {
      facilityId: 'facility-1',
      programmeArea: 'teleconsultation_access',
    }), false);
  });
});

describe('government MFA enforcement', () => {
  it('denies government access until MFA is enrolled', async () => {
    const result = await runMiddleware(requireGovernmentMfa, { role: 'platform_admin', mfaEnabled: false });
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.body.code, 'GOVERNMENT_MFA_ENROLLMENT_REQUIRED');
  });

  it('denies an enrolled account without an MFA-verified session', async () => {
    const result = await runMiddleware(requireGovernmentMfa, { role: 'platform_admin', mfaEnabled: true });
    assert.equal(result.nextCalled, false);
    assert.equal(result.response.body.code, 'MFA_REQUIRED');
  });

  it('allows an enrolled account with an MFA-verified session', async () => {
    const result = await runMiddleware(
      requireGovernmentMfa,
      { role: 'platform_admin', mfaEnabled: true },
      { mfaVerified: 'true' }
    );
    assert.equal(result.nextCalled, true);
  });
});
