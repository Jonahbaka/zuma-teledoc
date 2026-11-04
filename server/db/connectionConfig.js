'use strict';

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { X509Certificate } = require('node:crypto');
const MAX_CA_BYTES = 1024 * 1024;
function configError(code) { return Object.assign(new Error('Database transport configuration is unavailable or unsafe.'), { code }); }
function value(input) { return input === undefined || input === null ? '' : String(input); }
function normalizedHost(input) {
  let host = value(input).toLowerCase();
  if (host.startsWith('[') || host.endsWith(']')) {
    if (!(host.startsWith('[') && host.endsWith(']') && net.isIPv6(host.slice(1, -1)))) throw configError('DATABASE_HOST_INVALID');
    host = host.slice(1, -1);
  }
  host = host.replace(/\.$/, '');
  if (net.isIP(host)) return host;
  if (!host || host.length > 253 || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw configError('DATABASE_HOST_INVALID');
  return host;
}
function isLoopback(host) { return host === 'localhost' || host === '::1' || (net.isIPv4(host) && host.split('.')[0] === '127'); }
function isNeonHost(host) { return typeof host === 'string' && !host.includes('/') && (host === 'neon.tech' || host.endsWith('.neon.tech')); }
function readRootCertificates(filename, { cwd = process.cwd() } = {}) {
  let descriptor;
  try {
    if (!Number.isInteger(fs.constants.O_NOFOLLOW) || !Number.isInteger(fs.constants.O_NONBLOCK)) throw configError('DATABASE_CA_INVALID');
    descriptor = fs.openSync(path.resolve(cwd, filename), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const metadata = fs.fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_CA_BYTES) throw configError('DATABASE_CA_INVALID');
    const buffer = Buffer.alloc(MAX_CA_BYTES + 1);
    let size = 0, count;
    do { count = fs.readSync(descriptor, buffer, size, buffer.length - size, size); size += count; } while (count && size < buffer.length);
    const after = fs.fstatSync(descriptor);
    if (size !== metadata.size || size > MAX_CA_BYTES || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs || after.ctimeMs !== metadata.ctimeMs) throw configError('DATABASE_CA_INVALID');
    const pem = buffer.subarray(0, size).toString('utf8');
    if (/PRIVATE KEY/.test(pem)) throw configError('DATABASE_CA_INVALID');
    const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    const remainder = pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').replace(/^\s*#.*$/gm, '').trim();
    if (!certificates?.length || remainder) throw configError('DATABASE_CA_INVALID');
    for (const certificate of certificates) new X509Certificate(certificate);
    return certificates.join('\n');
  } catch { throw configError('DATABASE_CA_INVALID'); }
  finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { throw configError('DATABASE_CA_INVALID'); } }
  }
}

function buildDatabaseConfig(env = process.env, { urlKey = 'DATABASE_URL', caKey = 'PGSSLROOTCERT', requireUrl = false, forceTls = false, requireExplicitPlaintext = false, ...certificateOptions } = {}) {
  try {
    const environment = value(env.NODE_ENV);
    if (!['', 'development', 'test', 'production'].includes(environment)) throw configError('DATABASE_ENVIRONMENT_INVALID');
    const production = environment === 'production';
    if (env.NODE_PG_FORCE_NATIVE || env.PGOPTIONS || env.PGREPLICATION) throw configError('DATABASE_DRIVER_OPTION_UNSUPPORTED');
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw configError('DATABASE_TLS_VERIFICATION_DISABLED');
    for (const key of ['PGSSLCERT', 'PGSSLKEY', 'PGSSLCRL', 'PGSSLCRLDIR', 'PGSSLNEGOTIATION']) {
      if (env[key]) throw configError('DATABASE_TLS_OPTION_UNSUPPORTED');
    }
    const raw = value(env[urlKey]);
    if (!raw && (production || requireUrl)) throw configError('DATABASE_URL_REQUIRED');
    let host, port, user, password, database, urlMode, applicationName, binding;
    if (raw) {
      const url = new URL(raw);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || !url.hostname || !url.username || !url.pathname.slice(1)) throw configError('DATABASE_URL_INVALID');
      const seen = new Set();
      for (const key of url.searchParams.keys()) {
        if (seen.has(key) || !['sslmode', 'application_name', 'channel_binding'].includes(key)) throw configError('DATABASE_URL_OPTION_UNSUPPORTED');
        seen.add(key);
      }
      host = normalizedHost(decodeURIComponent(url.hostname));
      port = url.port || '5432'; user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); database = decodeURIComponent(url.pathname.slice(1));
      urlMode = url.searchParams.get('sslmode'); applicationName = url.searchParams.get('application_name'); binding = url.searchParams.get('channel_binding');
      if (!user || !database || /[\0\r\n]/.test(user + database + password)) throw configError('DATABASE_URL_INVALID');
      if (!password && (production || !isLoopback(host))) throw configError('DATABASE_AUTH_UNCONFIGURED');
    } else {
      const envHost = value(env.PGHOST) || 'localhost';
      // A local development Unix socket is explicit local transport, not a
      // production exception. Production always requires an identified URL.
      host = envHost.startsWith('/') && !/[\0\r\n]/.test(envHost) ? envHost : normalizedHost(envHost);
      port = env.PGPORT || '5432'; user = env.PGUSER; password = env.PGPASSWORD; database = env.PGDATABASE;
      if (!isLoopback(host) && !host.startsWith('/') && (!user || !password || !database)) throw configError('DATABASE_AUTH_UNCONFIGURED');
    }
    if (!/^\d+$/.test(String(port)) || Number(port) < 1 || Number(port) > 65535) throw configError('DATABASE_PORT_INVALID');
    const envMode = value(env.PGSSLMODE);
    if (urlMode !== null && urlMode !== undefined && (!urlMode || (envMode && urlMode !== envMode))) throw configError('DATABASE_TLS_MODE_CONFLICT');
    const mode = urlMode || envMode;
    const local = isLoopback(host) || host.startsWith('/');
    const plaintext = ['development', 'test'].includes(environment) && !forceTls && local && (mode === 'disable' || (!mode && !requireExplicitPlaintext));
    if (mode && !['require', 'verify-ca', 'verify-full', ...(plaintext ? ['disable'] : [])].includes(mode)) throw configError('DATABASE_TLS_REQUIRED');
    const envBinding = value(env.PGCHANNELBINDING);
    if (binding !== null && binding !== undefined && (!binding || (envBinding && binding !== envBinding))) throw configError('DATABASE_CHANNEL_BINDING_UNSUPPORTED');
    binding = binding || envBinding || 'prefer';
    // Installed pg can prefer PLUS when offered, but cannot enforce 'require'.
    // Never silently downgrade a requested authentication guarantee.
    if (!['prefer', 'disable'].includes(binding)) throw configError('DATABASE_CHANNEL_BINDING_UNSUPPORTED');
    const caPath = value(env[caKey]);
    if (plaintext && caPath) throw configError('DATABASE_CA_WITHOUT_TLS');
    if (host.startsWith('/') && !plaintext) throw configError('DATABASE_SOCKET_TLS_UNSUPPORTED');
    const ssl = plaintext ? false : {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      // Existing sockets and IP dialing must verify the intended original peer,
      // never Node's fallback 'localhost' or a substituted DNS/IP name.
      checkServerIdentity: (_hostname, certificate) => tls.checkServerIdentity(host, certificate),
      ...(net.isIP(host) ? {} : { servername: host }),
      ...(caPath ? { ca: readRootCertificates(caPath, certificateOptions) } : {}),
    };
    applicationName = applicationName || value(env.PGAPPNAME);
    if (applicationName && (applicationName.length > 256 || /[\0\r\n]/.test(applicationName))) throw configError('DATABASE_APPLICATION_NAME_INVALID');
    // No raw connectionString: pg's URL parser otherwise overwrites ssl and can
    // read arbitrary sslkey/sslcert paths before our transport policy runs.
    return { host, port: Number(port), ...(user === undefined ? {} : { user }), ...(password === undefined ? {} : { password: raw && password === '' ? () => '' : password }),
      ...(database === undefined ? {} : { database }), ssl, enableChannelBinding: !plaintext && binding === 'prefer',
      ...(applicationName ? { application_name: applicationName } : {}) };
  } catch (error) {
    if (/^DATABASE_[A-Z_]+$/.test(error?.code || '')) throw error;
    throw configError('DATABASE_URL_INVALID');
  }
}
module.exports = { buildDatabaseConfig, normalizedHost, isLoopback, isNeonHost, readRootCertificates, configError };
