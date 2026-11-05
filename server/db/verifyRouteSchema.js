'use strict';

// Route imports and requests must never repair schema. The explicit migration
// runner owns DDL; a missing required column makes the route unavailable.
function createSchemaVerifier(db, required) {
  let verified;
  return function verifySchema() {
    if (!verified) {
      verified = (async () => {
        for (const [table, columns] of Object.entries(required)) {
          const result = await db.query(
            'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
            ['public', table]
          );
          const actual = new Set(result.rows.map(row => row.column_name));
          if (columns.some(column => !actual.has(column))) {
            throw Object.assign(new Error('Required database migration has not been applied.'), {
              code: 'ROUTE_SCHEMA_UNAVAILABLE', status: 503, statusCode: 503,
            });
          }
        }
      })().catch(() => {
        verified = null;
        throw Object.assign(new Error('Required database schema is unavailable.'), {
          code: 'ROUTE_SCHEMA_UNAVAILABLE', status: 503, statusCode: 503,
        });
      });
    }
    return verified;
  };
}

module.exports = { createSchemaVerifier };
