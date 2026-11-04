'use strict';

const { resolve4 } = require('node:dns').promises;
const net = require('node:net');
const { isNeonHost, configError } = require('./connectionConfig');

// Keep the accepted config and original certificate identity. Only change the
// dialing address, never parse/rebuild a URL that could override TLS settings.
async function resolveNeonConfig(config, { lookup = resolve4, timeoutMs = 5000 } = {}) {
  if (!isNeonHost(config.host)) return config;
  if (config.ssl?.rejectUnauthorized !== true || config.ssl.servername !== config.host || typeof config.ssl.checkServerIdentity !== 'function') throw configError('DATABASE_TLS_REQUIRED');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw configError('DATABASE_DNS_TIMEOUT_INVALID');
  let timer;
  try {
    const addresses = await Promise.race([
      Promise.resolve().then(() => lookup(config.host)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(configError('DATABASE_DNS_UNAVAILABLE')), timeoutMs); }),
    ]);
    if (!Array.isArray(addresses) || !addresses.length || !net.isIPv4(addresses[0])) throw configError('DATABASE_DNS_UNAVAILABLE');
    return { ...config, host: addresses[0], ssl: { ...config.ssl } };
  } catch { throw configError('DATABASE_DNS_UNAVAILABLE'); }
  finally { clearTimeout(timer); }
}
module.exports = { resolveNeonConfig };
