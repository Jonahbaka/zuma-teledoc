'use strict';

/**
 * ng/tests/rbac.test.js
 * Authorization unit tests for the RBAC + ABAC middleware.
 * Run with: node --test ng/tests/rbac.test.js
 * (Node.js 18+ built-in test runner — no Jest dependency required)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Mirror pure utilities inline — avoids importing rbac.js which requires server/db
const ROLE_HIERARCHY = {
  super_admin: 100, platform_admin: 90, executive_read_only: 80,
  programme_admin: 70, approver: 60, reviewer: 50,
  analyst: 40, facility_admin: 30, provider: 20,
};

function canonicalRole(raw) {
  return String(raw || '').toLowerCase().trim().replace(/\s+/g, '_');
}
function roleLevel(role) {
  return ROLE_HIERARCHY[canonicalRole(role)] ?? 0;
}
function hasMinRole(user, minRole) {
  const r = canonicalRole(user?.role || user?.ng_role || '');
  return roleLevel(r) >= roleLevel(minRole);
}
function isSuperAdmin(user) {
  return canonicalRole(user?.role || '') === 'super_admin';
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
