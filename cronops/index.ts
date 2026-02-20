/**
 * ═══════════════════════════════════════════════════════════════
 *  CRONOPS INDEX — DoctaRx Automated Operations Engine
 *  Main entrypoint: loads tasks, starts scheduler, handles signals.
 * ═══════════════════════════════════════════════════════════════
 *
 *  Run: ts-node cronops/index.ts
 *  Or via PM2: pm2 start cronops/index.ts --interpreter ts-node --name cronops
 */

import { loadAllTasks } from './taskRegistry';
import { startScheduler, getSchedulerStatus } from './scheduler';
import { info, error, warn } from './logger';
import { DRY_RUN, NODE_ENV } from './config';

const MAIN = 'CronOps';

async function bootstrap(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  DoctaRx CronOps Engine  |  Automated Operations  ');
  console.log(`  ENV: ${NODE_ENV.toUpperCase().padEnd(12)} DRY_RUN: ${DRY_RUN ? 'YES ⚠️ ' : 'NO ✅'}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  info(MAIN, `Bootstrapping CronOps. NODE_ENV=${NODE_ENV} DRY_RUN=${DRY_RUN}`);

  // Load all task modules into the registry
  await loadAllTasks();

  // Start the cron scheduler
  startScheduler();

  // Log status after a short delay to let tasks initialize
  setTimeout(() => {
    const status = getSchedulerStatus();
    info(MAIN, `Scheduler active. Tasks: ${Object.keys(status.taskSummary).length}. Locks: ${status.activeLocks.length}`);
    console.log('\n[CronOps] Task Summary:');
    for (const [name, s] of Object.entries(status.taskSummary)) {
      console.log(`  ${s.enabled ? '✅' : '❌'} ${name} | failures: ${s.failures}`);
    }
    console.log('');
  }, 2000);
}

// ─── Graceful shutdown ────────────────────────────────────────

function shutdown(signal: string): void {
  warn(MAIN, `Received ${signal}. Shutting down CronOps gracefully.`);
  console.log(`\n[CronOps] Shutdown initiated (${signal}). Goodbye.\n`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  error(MAIN, `Unhandled promise rejection: ${reason}`);
});
process.on('uncaughtException', (err) => {
  error(MAIN, `Uncaught exception: ${err.message}`);
  // Do not exit — keep the scheduler alive
});

// ─── Boot ─────────────────────────────────────────────────────

bootstrap().catch(err => {
  error(MAIN, `Fatal bootstrap error: ${(err as Error).message}`);
  console.error('[CronOps] FATAL:', err);
  process.exit(1);
});
