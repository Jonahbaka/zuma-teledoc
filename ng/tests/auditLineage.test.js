'use strict';

/**
 * ng/tests/auditLineage.test.js
 * Tests for audit lineage write logic (pure logic — no DB).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Helpers mirrored from governanceService.js ──────────────────────────────

const VALID_ACTIONS = new Set([
  'view', 'export', 'approve', 'reject', 'modify',
  'search', 'import', 'validate', 'rollback',
  'sync', 'dry_run', 'submit', 'review', 'generate',
  'login', 'logout', 'permission_grant', 'permission_revoke',
]);

const VALID_DATA_CLASSES = new Set(['aggregate', 'operational', 'sensitive']);

function validateAuditEntry({ action, dataClass }) {
  const errors = [];
  if (!VALID_ACTIONS.has(action)) errors.push(`Unknown action: ${action}`);
  if (dataClass && !VALID_DATA_CLASSES.has(dataClass)) errors.push(`Unknown data class: ${dataClass}`);
  return errors;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('audit lineage validation', () => {
  it('accepts all valid actions', () => {
    for (const action of VALID_ACTIONS) {
      const errors = validateAuditEntry({ action, dataClass: 'aggregate' });
      assert.equal(errors.length, 0, `${action} should be valid`);
    }
  });

  it('rejects unknown action', () => {
    const errors = validateAuditEntry({ action: 'hack', dataClass: 'aggregate' });
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('Unknown action'));
  });

  it('accepts all valid data classes', () => {
    for (const dc of VALID_DATA_CLASSES) {
      const errors = validateAuditEntry({ action: 'view', dataClass: dc });
      assert.equal(errors.length, 0);
    }
  });

  it('rejects unknown data class', () => {
    const errors = validateAuditEntry({ action: 'view', dataClass: 'classified' });
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('Unknown data class'));
  });

  it('null data class is allowed (optional)', () => {
    const errors = validateAuditEntry({ action: 'view', dataClass: null });
    assert.equal(errors.length, 0);
  });
});
