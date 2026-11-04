'use strict';

require('dotenv').config();
const { getPool, close } = require('../server/db');
const { processDueJobs } = require('../ng/services/public-health/dhis2DeliveryWorkerService');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(value => value !== '--watch' && !/^--limit=(?:[1-9]|[1-4]\d|50)$/.test(value)) || args.filter(value => value.startsWith('--limit=')).length > 1) throw new Error('Use --watch and/or --limit=1 through --limit=50.');
  const limitValue = args.find(value => value.startsWith('--limit=')); const limit = limitValue ? Number(limitValue.split('=')[1]) : 10;
  const interval = Number(process.env.DHIS2_WORKER_INTERVAL_MS || 30000);
  if (!Number.isInteger(interval) || interval < 1000 || interval > 60000) throw new Error('The worker interval must be from 1000 to 60000 milliseconds.');
  let stopping = false; let wake;
  const controller = new AbortController();
  const stop = () => { stopping = true; controller.abort(); wake?.(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    do {
      const result = await processDueJobs(getPool(), { limit, signal: controller.signal });
      console.log(JSON.stringify(result));
      if (!args.includes('--watch') || !result.enabled) { if (result.failed) process.exitCode = 1; break; }
      if (!stopping) await new Promise(resolve => { const timer = setTimeout(resolve, interval); wake = () => { clearTimeout(timer); resolve(); }; });
    } while (!stopping);
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
main().catch(() => { console.error('DHIS2 delivery worker could not complete. Review retained job codes and approved configuration.'); process.exitCode = 1; }).finally(close);
