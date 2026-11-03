/**
 * Destructive down-migrations are intentionally unavailable.
 * Previous versions dropped clinical and audit tables with CASCADE. An
 * application rollback or reviewed isolated restore must preserve those records.
 */
'use strict';

function refuseRollback() {
  throw new Error('Automated database rollback is disabled: it can permanently delete clinical and audit records. '
    + 'Use the application rollback and isolated restore procedure in docs/backup-restore-runbook.md.');
}

if (require.main === module) {
  try { refuseRollback(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { refuseRollback };
