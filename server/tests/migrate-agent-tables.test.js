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

test('agent schema is loaded from the reviewed SQL migration allowlist', () => {
  assert.deepEqual(migrate.SQL_FILE_MIGRATIONS, [
    {
      name: '400_agent_orchestrator_schema',
      file: '400_agent_orchestrator_schema.sql',
    },
  ]);

  const sqlPath = path.join(repoRoot, 'server/db/migrations/400_agent_orchestrator_schema.sql');
  assert.equal(
    migrate.loadSqlFileMigrations()[0].up,
    fs.readFileSync(sqlPath, 'utf8')
  );
});

test('agent schema runs after inline core migrations', () => {
  const allMigrations = migrate.getMigrations();
  const inlineIndex = allMigrations.findIndex((item) => item.name === '031_agent_chat_uploads');
  const agentIndex = allMigrations.findIndex((item) => item.name === '400_agent_orchestrator_schema');

  assert.ok(inlineIndex >= 0, 'expected inline chat/upload migration to remain present');
  assert.ok(agentIndex > inlineIndex, 'agent orchestrator schema should run after core inline migrations');
});
