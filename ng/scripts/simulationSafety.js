const { Pool } = require('pg');

function redactDatabaseUrl(value = '') {
  return String(value).replace(/:\/\/([^:@/]+):([^@/]+)@/g, '://$1:<redacted>@');
}

function looksProductionLike(url = '') {
  const value = String(url).toLowerCase();
  try {
    const parsed = new URL(value);
    const host = parsed.hostname;
    if (['localhost', '127.0.0.1', '::1'].includes(host)) {
      return false;
    }
  } catch {
    // Fall through to conservative string checks.
  }

  return [
    'doctarx.com',
    'production',
    '-prod',
    '_prod',
    'neon.tech',
    'amazonaws.com',
    'rds.amazonaws.com',
    'render.com',
  ].some((marker) => value.includes(marker));
}

function resolveSimulationDatabaseUrl(env = process.env) {
  const url = env.SIMULATION_DATABASE_URL || env.DATABASE_URL;
  const source = env.SIMULATION_DATABASE_URL ? 'SIMULATION_DATABASE_URL' : 'DATABASE_URL';
  if (!url) {
    throw new Error('Set SIMULATION_DATABASE_URL for mutable Nigeria simulation work.');
  }

  if (source === 'DATABASE_URL' && env.ALLOW_DATABASE_URL_SIMULATION !== 'true') {
    throw new Error('Refusing to mutate DATABASE_URL. Set SIMULATION_DATABASE_URL, or ALLOW_DATABASE_URL_SIMULATION=true for a known non-production database.');
  }

  if (looksProductionLike(url) && env.ALLOW_PRODUCTION_SIMULATION !== 'true') {
    throw new Error(`Refusing production-like simulation target from ${source}: ${redactDatabaseUrl(url)}. Set ALLOW_PRODUCTION_SIMULATION=true only after explicit approval.`);
  }

  return { url, source, redactedUrl: redactDatabaseUrl(url) };
}

function createSimulationPool(env = process.env) {
  const resolved = resolveSimulationDatabaseUrl(env);
  return {
    ...resolved,
    pool: new Pool({
      connectionString: resolved.url,
      ssl: resolved.url.includes('sslmode=') || resolved.url.includes('neon.tech')
        ? { rejectUnauthorized: false }
        : false,
      max: Number(env.SIMULATION_DB_POOL_MAX || 4),
      connectionTimeoutMillis: Number(env.SIMULATION_DB_CONNECT_TIMEOUT_MS || 8000),
      query_timeout: Number(env.SIMULATION_DB_QUERY_TIMEOUT_MS || 15000),
    }),
  };
}

module.exports = {
  createSimulationPool,
  looksProductionLike,
  redactDatabaseUrl,
  resolveSimulationDatabaseUrl,
};
