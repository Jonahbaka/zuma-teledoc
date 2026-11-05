'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixtureTargetSafety } = require('../../ng/scripts/fixtureTargetSafety');
const target = process.env.SIMULATION_DATABASE_URL;
const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/046_explicit_route_schema.sql'), 'utf8');
const serviceSql = fs.readFileSync(path.join(__dirname, '../db/migrations/047_explicit_service_schema.sql'), 'utf8');

test('explicit service schema migration retains profiles, events and memory on repeat', { skip: !target }, async () => {
  const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
  assert.equal(safety.skipped, false, safety.reason);
  const { Client } = require('pg');
  const client = new Client({ connectionString: target });
  await client.connect();
  try {
    await client.query('CREATE TEMP TABLE users (id UUID PRIMARY KEY)');
    await client.query('SET search_path TO pg_temp');
    await client.query(serviceSql);
    await client.query("INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000001', false)");
    await client.query("INSERT INTO nova_user_profiles (user_id, message_count) VALUES ('00000000-0000-4000-8000-000000000001', 7)");
    await client.query("INSERT INTO ai_agent_memory (agent_type, memory_key, memory_value) VALUES ('fictional', 'key', 'retain this fixture')");
    await client.query("INSERT INTO ai_event_queue (event_type) VALUES ('fictional.event')");
    await client.query(serviceSql);
    assert.equal((await client.query('SELECT message_count FROM nova_user_profiles')).rows[0].message_count, 7);
    assert.equal((await client.query('SELECT memory_value FROM ai_agent_memory')).rows[0].memory_value, 'retain this fixture');
    assert.equal((await client.query('SELECT event_type FROM ai_event_queue')).rows[0].event_type, 'fictional.event');
    for (const table of ['users', 'nova_user_profiles', 'ai_agent_memory', 'ai_event_queue', 'ai_event_cursors', 'ai_agent_goals', 'ai_agent_milestones']) {
      assert.equal((await client.query('SELECT relpersistence FROM pg_class WHERE oid = to_regclass($1)', [table])).rows[0].relpersistence, 't');
    }
  } finally { await client.end(); }
});

for (const legacy of [false, true]) {
  test(`explicit route migration preserves records and is repeatable (${legacy ? 'legacy' : 'fresh'} schema)`, { skip: !target }, async () => {
    const safety = fixtureTargetSafety({ source: 'SIMULATION_DATABASE_URL' });
    assert.equal(safety.skipped, false, safety.reason);
    const { Client } = require('pg');
    const client = new Client({ connectionString: target });
    await client.connect();
    try {
      // All objects live only in this session; public fixture tables are never touched.
      await client.query('CREATE TEMP TABLE users (id UUID PRIMARY KEY)');
      await client.query('SET search_path TO pg_temp');
      await client.query('CREATE TEMP TABLE testing_access_links (id INTEGER PRIMARY KEY, token TEXT)');
      await client.query("INSERT INTO testing_access_links VALUES (1, 'fictional-token')");
      if (legacy) {
        await client.query('CREATE TEMP TABLE social_posts (id VARCHAR(255) PRIMARY KEY, hashtags TEXT)');
        await client.query("INSERT INTO social_posts VALUES ('fictional-post', 'preserve legacy text')");
      }
      await client.query(sql);
      await client.query(sql);
      assert.deepEqual((await client.query('SELECT id, token, target_user_id, target_email FROM testing_access_links')).rows,
        [{ id: 1, token: 'fictional-token', target_user_id: null, target_email: null }]);
      if (legacy) {
        assert.deepEqual((await client.query('SELECT * FROM social_posts')).rows,
          [{ id: 'fictional-post', hashtags: 'preserve legacy text', media_url: null, platforms: [], retry_count: 0, last_error: null }]);
      }
      await client.query("INSERT INTO realtime_analytics_events (session_id) VALUES ('fictional-session')");
      assert.equal((await client.query('SELECT event_type FROM realtime_analytics_events')).rows[0].event_type, 'page_view');
      const tables = ['social_accounts', 'social_posts', 'social_platform_posts', 'realtime_analytics_events', 'testing_access_links'];
      for (const table of tables) {
        const { rows } = await client.query('SELECT relpersistence FROM pg_class WHERE oid = to_regclass($1)', [table]);
        assert.equal(rows[0].relpersistence, 't', 'test objects must remain session-local');
      }
    } finally { await client.end(); }
  });
}
