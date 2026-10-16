'use strict';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function skipped(reason) {
  return { skipped: true, noWrites: true, code: 'FIXTURE_WRITES_DISABLED', reason };
}

function normalizedHost(host) {
  return String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
}

function parseFixtureTarget(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    // Query parameters can override pg's host/database/port. Fixture commands
    // deliberately accept only an unambiguous, explicit connection URL.
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) return null;
    const host = normalizedHost(url.hostname);
    const database = decodeURIComponent(url.pathname.slice(1));
    const port = Number(url.port || 5432);
    if (!LOOPBACK_HOSTS.has(host) || !/^[A-Za-z0-9_.-]+_test$/.test(database) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port, database };
  } catch { return null; }
}

function sameTarget(left, right) {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

function poolTarget(pool) {
  const options = pool?.options || pool?.connectionParameters;
  if (!options || typeof options !== 'object' || options.stream || options.hostaddr || options.service) return null;
  if (options.connectionString) {
    const target = parseFixtureTarget(options.connectionString);
    if (!target) return null;
    // Reject contradictory explicit options too, even though pg normally gives
    // its connectionString precedence over these fields.
    if (options.host && normalizedHost(options.host) !== target.host) return null;
    if (options.database && options.database !== target.database) return null;
    if (options.port && Number(options.port) !== target.port) return null;
    return target;
  }
  const host = normalizedHost(options.host);
  const port = Number(options.port);
  if (!LOOPBACK_HOSTS.has(host) || !/^[A-Za-z0-9_.-]+_test$/.test(options.database || '') || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, database: options.database };
}

function fixtureTargetSafety({ source = 'DATABASE_URL', pool, env = process.env } = {}) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'production') {
    return skipped('Fixture writes are disabled in NODE_ENV=production; existing accounts and records are preserved.');
  }
  const target = parseFixtureTarget(env[source]);
  if (!target) return skipped('Fixture writes require an explicit PostgreSQL loopback URL with a database name ending in _test and no connection URL options.');
  if (pool !== undefined) {
    const actual = poolTarget(pool);
    if (!actual || !sameTarget(target, actual)) return skipped('The supplied database pool cannot be verified as the same explicit isolated _test target.');
  }
  return { skipped: false, source, target };
}

module.exports = { fixtureTargetSafety };
