/**
 * Manual task runner — execute any cronops task on demand.
 * Usage: ts-node scripts/run-task.ts <task-name>
 * Example: ts-node scripts/run-task.ts healthcheck
 */

import { loadAllTasks, registry } from '../taskRegistry';

const taskName = process.argv[2];

if (!taskName) {
  console.error('Usage: ts-node scripts/run-task.ts <task-name>');
  console.error('Available tasks: analytics, crmLeads, security, healthcheck');
  process.exit(1);
}

(async () => {
  console.log(`[run-task] Running task: ${taskName}`);
  await loadAllTasks();
  const registration = registry.get(taskName);

  if (!registration) {
    console.error(`[run-task] Unknown task: "${taskName}"`);
    console.error('Available:', registry.list().join(', '));
    process.exit(1);
  }

  const start = Date.now();
  try {
    const result = await registration.task.run();
    const ms = Date.now() - start;
    console.log(`\n[run-task] ✅ Completed in ${ms}ms`);
    console.log('[run-task] Message:', result.message);
    if (result.logs?.length) {
      console.log('\n--- Logs ---');
      result.logs.forEach(l => console.log(' ', l));
    }
    if (result.reportPath) {
      console.log('\n[run-task] Report:', result.reportPath);
    }
  } catch (err) {
    console.error('[run-task] ❌ Task failed:', (err as Error).message);
    process.exit(1);
  }

  process.exit(0);
})();
