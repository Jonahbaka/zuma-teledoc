/**
 * ═══════════════════════════════════════════════════════════════
 *  SCHEDULER — Cron Schedule Registry + Execution Engine
 * ═══════════════════════════════════════════════════════════════
 *
 *  Features:
 *  - Per-task mutex (no overlapping executions of the same task)
 *  - Exponential backoff retry on failure
 *  - DRY_RUN enforcement for high-risk tasks
 *  - Stale-lock cleanup (restart-safe)
 *  - Full execution recording for reporting
 */

import cron from 'node-cron';
import { registry } from './taskRegistry';
import { logExecution, info, warn, error } from './logger';
import { DRY_RUN, RETRY_BASE_DELAY_MS, MAX_RETRIES, LOCK_TTL_MINUTES } from './config';
import type { CronTask, TaskExecution, TaskResult, ExecutionLock, TaskStatus } from './types';

const SCHEDULER_NAME = 'Scheduler';

// In-process mutex: task name → lock entry
const locks: Map<string, ExecutionLock> = new Map();

// Daily counters for summary reporting
let dailyStats = { tasksRun: 0, successes: 0, failures: 0, totalDurationMs: 0, date: todayStr() };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Lock management ─────────────────────────────────────────

function acquireLock(taskName: string): boolean {
  const existing = locks.get(taskName);
  if (existing) {
    const ageMs = Date.now() - existing.acquiredAt.getTime();
    const ttlMs = LOCK_TTL_MINUTES * 60 * 1000;
    if (ageMs < ttlMs) {
      warn(SCHEDULER_NAME, `Skipping "${taskName}" — still locked (${Math.round(ageMs / 1000)}s old)`);
      return false;
    }
    warn(SCHEDULER_NAME, `Releasing stale lock for "${taskName}" (${Math.round(ageMs / 60000)}m old)`);
  }
  locks.set(taskName, { taskName, acquiredAt: new Date(), pid: process.pid });
  return true;
}

function releaseLock(taskName: string): void {
  locks.delete(taskName);
}

// ─── Retry with exponential backoff ──────────────────────────

async function runWithRetry(task: CronTask, attempt = 1): Promise<TaskResult> {
  try {
    return await task.run();
  } catch (err) {
    if (attempt <= MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
      warn(SCHEDULER_NAME, `"${task.name}" threw on attempt ${attempt}/${MAX_RETRIES}. Retrying in ${Math.round(delay / 1000)}s`);
      await new Promise(r => setTimeout(r, delay));
      return runWithRetry(task, attempt + 1);
    }
    // All retries exhausted
    const msg = (err as Error).message || String(err);
    error(SCHEDULER_NAME, `"${task.name}" failed after ${MAX_RETRIES} retries: ${msg}`);
    return {
      success: false,
      message: `Failed after ${MAX_RETRIES} retries: ${msg}`,
      logs: [`[ERROR] ${msg}`],
    };
  }
}

// ─── Execute one task ─────────────────────────────────────────

async function executeTask(task: CronTask): Promise<void> {
  // Skip high-risk tasks in dry-run mode but run low/medium with flag
  const isDryRun = DRY_RUN || (task.riskLevel === 'high' && DRY_RUN);
  if (DRY_RUN && task.riskLevel === 'high') {
    info(SCHEDULER_NAME, `[DRY_RUN] Skipping high-risk task "${task.name}"`);
    registry.recordOutcome(task.name, 'skipped');
    return;
  }

  if (!acquireLock(task.name)) return;

  const startedAt = new Date();
  info(SCHEDULER_NAME, `Starting "${task.name}" [${task.riskLevel}]${isDryRun ? ' [DRY_RUN]' : ''}`);

  let result: TaskResult;
  let status: TaskStatus = 'success';

  try {
    result = await runWithRetry(task);
    if (!result.success) status = 'failed';
  } catch (err) {
    // Should never reach here (runWithRetry catches everything), but be safe
    const msg = (err as Error).message || String(err);
    result = { success: false, message: msg, logs: [`[FATAL] ${msg}`] };
    status = 'failed';
  } finally {
    releaseLock(task.name);
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const execution: TaskExecution = {
    taskName: task.name,
    schedule: task.schedule,
    riskLevel: task.riskLevel,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    result,
    dryRun: isDryRun,
  };

  logExecution(execution);
  registry.recordOutcome(task.name, status);

  // Update daily counters
  if (todayStr() !== dailyStats.date) {
    dailyStats = { tasksRun: 0, successes: 0, failures: 0, totalDurationMs: 0, date: todayStr() };
  }
  dailyStats.tasksRun++;
  dailyStats.totalDurationMs += durationMs;
  if (status === 'success') dailyStats.successes++;
  else if (status === 'failed') dailyStats.failures++;

  const statusStr = status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭';
  console.log(`[Scheduler] ${statusStr} "${task.name}" in ${durationMs}ms — ${result.message}`);
}

// ─── Public: start the scheduler ─────────────────────────────

export function startScheduler(): void {
  const tasks = registry.getEnabled();
  if (tasks.length === 0) {
    warn(SCHEDULER_NAME, 'No enabled tasks found in registry. Scheduler idle.');
    return;
  }

  info(SCHEDULER_NAME, `Starting scheduler with ${tasks.length} tasks. DRY_RUN=${DRY_RUN}`);

  for (const { task } of tasks) {
    if (!cron.validate(task.schedule)) {
      error(SCHEDULER_NAME, `Invalid cron expression for "${task.name}": "${task.schedule}". Skipping.`);
      continue;
    }

    cron.schedule(task.schedule, () => {
      // Check registry still has this task enabled (could be disabled after max failures)
      const reg = registry.get(task.name);
      if (!reg?.enabled) {
        info(SCHEDULER_NAME, `Task "${task.name}" is disabled — skipping scheduled run`);
        return;
      }
      executeTask(task).catch(err => {
        error(SCHEDULER_NAME, `Unhandled exception in task runner for "${task.name}": ${(err as Error).message}`);
      });
    }, { timezone: 'America/New_York' });

    info(SCHEDULER_NAME, `Scheduled "${task.name}" → ${task.schedule} (ET)`);
  }

  // Daily summary at midnight ET
  cron.schedule('0 0 * * *', () => {
    const { logDailySummary } = require('./logger');
    logDailySummary(dailyStats);
    info(SCHEDULER_NAME, `Daily summary logged for ${dailyStats.date}`);
  }, { timezone: 'America/New_York' });

  info(SCHEDULER_NAME, 'All tasks scheduled. CronOps engine is live.');
}

/**
 * Run a specific task immediately by name (for manual trigger / testing).
 */
export async function runTaskNow(taskName: string): Promise<TaskResult | null> {
  const reg = registry.get(taskName);
  if (!reg) {
    error(SCHEDULER_NAME, `runTaskNow: unknown task "${taskName}"`);
    return null;
  }
  await executeTask(reg.task);
  return reg.task.run();
}

/**
 * Get current scheduler health status.
 */
export function getSchedulerStatus(): {
  activeLocks: string[];
  taskSummary: ReturnType<typeof registry.summary>;
  dailyStats: typeof dailyStats;
} {
  return {
    activeLocks: Array.from(locks.keys()),
    taskSummary: registry.summary(),
    dailyStats,
  };
}
