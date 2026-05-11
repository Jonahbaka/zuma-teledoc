'use strict';

const { resolve4 } = require('dns').promises;

/**
 * For Neon PostgreSQL endpoints:
 * - Pre-resolves hostname to an IPv4 address (Neon endpoints return both A and AAAA
 *   records, but many on-prem / consumer ISP networks cannot route IPv6).
 * - Strips ?sslmode= from the URL so pg doesn't duplicate the SSL config.
 * - Preserves the original hostname as ssl.servername for TLS SNI.
 *
 * For non-Neon URLs the input is returned unchanged.
 */
async function resolveNeonUrl(connectionString) {
  if (!connectionString || !connectionString.includes('neon.tech')) {
    return { connectionString, ssl: null };
  }

  const stripped = connectionString
    .replace(/[?&]sslmode=[^&]+/, (m) => (m.startsWith('?') ? '?' : ''))
    .replace(/\?$/, '');

  const url = new URL(stripped);
  const originalHostname = url.hostname;

  const [ipv4] = await resolve4(originalHostname);
  url.hostname = ipv4;

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false, servername: originalHostname },
  };
}

module.exports = { resolveNeonUrl };
