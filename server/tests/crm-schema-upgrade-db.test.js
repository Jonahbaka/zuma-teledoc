'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const target = process.env.SIMULATION_DATABASE_URL;

test('the additive CRM upgrade creates an empty workspace, preserves actual records, and reruns without data seeding', { skip: !target }, async () => {
  const url = new URL(target);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_test'));
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/038_crm_recorded_workspace.sql'), 'utf8');
  assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|DROP)\s/im);
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: target });
  const client = await pool.connect();
  const schema = 'doctarx_crm_upgrade_' + crypto.randomUUID().replace(/-/g, '');
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET LOCAL search_path TO "' + schema + '", public');
    await client.query(sql);
    const tables = ['crm_contacts', 'crm_campaigns', 'crm_interactions', 'crm_email_templates', 'crm_social_engagements', 'crm_scrape_sources'];
    for (const table of tables) assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM "' + schema + '"."' + table + '"')).rows[0].count, 0, table + ' has no authored defaults or presentation data');
    const id = crypto.randomUUID();
    await client.query('INSERT INTO "' + schema + '".crm_email_templates (id,name,category,subject,body,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, 'Isolated stored template', 'provider_invite', 'Recorded subject', 'Recorded body', 'isolated-operator']);
    await client.query(sql);
    const existing = (await client.query('SELECT id,subject,body FROM "' + schema + '".crm_email_templates')).rows;
    assert.deepEqual(existing, [{ id, subject: 'Recorded subject', body: 'Recorded body' }]);
  } finally {
    await client.query('ROLLBACK');
    client.release(); await pool.end();
  }
});
