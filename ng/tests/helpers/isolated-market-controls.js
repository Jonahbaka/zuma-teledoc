'use strict';

const crypto = require('node:crypto');

// Call only after BEGIN in an isolated loopback *_test database. The caller
// must roll back its entire test. This never provisions or resets demo users.
async function getUSPatientControl(client) {
  const existing = await client.query("SELECT id FROM users WHERE role='patient' AND market_scope='US' AND is_active=TRUE ORDER BY id LIMIT 1");
  if (existing.rows[0]) return existing.rows[0];
  const database = (await client.query('SELECT current_database() AS name')).rows[0]?.name;
  if (!database || !database.endsWith('_test')) throw new Error('An isolated test database is required for a transient market control');
  const id = crypto.randomUUID();
  const result = await client.query(
    `INSERT INTO users (id,email,password_hash,role,first_name,last_name,is_active,market_scope,region,country,
      is_test_account,test_account_metadata)
     VALUES ($1,$2,'ISOLATED_CONTROL_NO_PASSWORD_LOGIN','patient','Isolated','Market control',TRUE,'US','US','US',TRUE,
       '{"isolatedNegativeControl":true,"testAccount":true}'::jsonb) RETURNING id`,
    [id, 'market-control-' + id + '@example.invalid']
  );
  return result.rows[0];
}

module.exports = { getUSPatientControl };
