/** Strict, side-effect-free request options for CronOps health/security probes. */
import type { RequestOptions } from 'https';
import tls from 'tls';
const { normalizedHost, isLoopback } = require('../../server/db/connectionConfig');

export function buildProbeRequestOptions(target: string, env: NodeJS.ProcessEnv = process.env): RequestOptions {
  try {
    if (!['', 'development', 'test', 'production'].includes(env.NODE_ENV || '')) throw new Error();
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error();
    const url = new URL(target);
    if (url.username || url.password || url.hash) throw new Error();
    const host = normalizedHost(url.hostname);
    if (url.protocol === 'http:') {
      if (!['development', 'test'].includes(env.NODE_ENV || '') || !isLoopback(host)) throw new Error();
      return {};
    }
    if (url.protocol !== 'https:') throw new Error();
    return {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      checkServerIdentity: (_hostname, certificate) => tls.checkServerIdentity(host, certificate),
    };
  } catch {
    throw Object.assign(new Error('Probe transport configuration is unavailable or unsafe.'), { code: 'CRONOPS_PROBE_TRANSPORT_UNSAFE' });
  }
}
