const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const migrate = require('../db/migrate');

test('npm run migrate includes the agent orchestrator schema migration', () => {
  const allMigrations = migrate.getMigrations();
  const agentMigration = allMigrations.find((item) => item.name === '400_agent_orchestrator_schema');

  assert.ok(agentMigration, '400_agent_orchestrator_schema must be part of getMigrations()');
  assert.match(agentMigration.up, /CREATE TABLE IF NOT EXISTS ai_agents/);
  assert.match(agentMigration.up, /CREATE TABLE IF NOT EXISTS ai_skills/);
  assert.match(agentMigration.up, /CREATE TABLE IF NOT EXISTS ai_audit_log/);
});

test('reviewed SQL migrations are loaded from the explicit allowlist', () => {
  assert.deepEqual(migrate.SQL_FILE_MIGRATIONS, [
    { name: '016_message_idempotency', file: '016_message_idempotency.sql' },
    {
      name: '037_encrypted_manual_insurance',
      file: '037_encrypted_manual_insurance.sql',
    },
    {
      name: '038_crm_recorded_workspace',
      file: '038_crm_recorded_workspace.sql',
    },
    {
      name: '039_medical_record_revisions',
      file: '039_medical_record_revisions.sql',
    },
    {
      name: '040_clinical_encrypted_history',
      file: '040_clinical_encrypted_history.sql',
    },
    {
      name: '041_atomic_auth_sessions',
      file: '041_atomic_auth_sessions.sql',
    },
    {
      name: '042_appointment_booking_intents',
      file: '042_appointment_booking_intents.sql',
    },
    {
      name: '400_agent_orchestrator_schema',
      file: '400_agent_orchestrator_schema.sql',
    },
  ]);

  const loaded = migrate.loadSqlFileMigrations();
  for (const migration of migrate.SQL_FILE_MIGRATIONS) {
    const sqlPath = path.join(repoRoot, 'server/db/migrations', migration.file);
    assert.equal(
      loaded.find((item) => item.name === migration.name)?.up,
      fs.readFileSync(sqlPath, 'utf8'),
      `${migration.name} must run the reviewed SQL file`
    );
  }
});

test('agent schema runs after inline core migrations', () => {
  const allMigrations = migrate.getMigrations();
  const inlineIndex = allMigrations.findIndex((item) => item.name === '031_agent_chat_uploads');
  const agentIndex = allMigrations.findIndex((item) => item.name === '400_agent_orchestrator_schema');

  assert.ok(inlineIndex >= 0, 'expected inline chat/upload migration to remain present');
  assert.ok(agentIndex > inlineIndex, 'agent orchestrator schema should run after core inline migrations');
});


test('session migration is additive and preserves credential epoch and token-family invariants', () => {
  const migration = migrate.getMigrations().find(item => item.name === '041_atomic_auth_sessions');
  assert.ok(migration);
  assert.match(migration.up, /credential_version INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration.up, /family_id UUID NOT NULL DEFAULT uuid_generate_v4\(\)/);
  assert.doesNotMatch(migration.up, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM/i);
});


test('message retry schema runs through the ordinary migration entrypoint without destructive SQL', () => {
  const all = migrate.getMigrations();
  const migration = all.find(item => item.name === '016_message_idempotency');
  assert.ok(migration);
  assert.match(migration.up, /ADD COLUMN IF NOT EXISTS client_message_id UUID/);
  assert.match(migration.up, /CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_sender_client_id/);
  assert.match(migration.up, /WHERE client_message_id IS NOT NULL/);
  assert.doesNotMatch(migration.up, /DROP\s+(TABLE|COLUMN)|DELETE\s+FROM|TRUNCATE/i);
  assert.equal(all.filter(item => item.name === migration.name).length, 1);
});
