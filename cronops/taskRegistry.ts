/**
 * ═══════════════════════════════════════════════════════════════
 *  TASK REGISTRY — Dynamic Task Loader
 * ═══════════════════════════════════════════════════════════════
 *
 *  Loads all CronTask modules from ./tasks/.
 *  Tracks runtime state (last run, failures) per task.
 *  Provides enable/disable/query API for the scheduler.
 */

import type { CronTask, TaskRegistration, TaskStatus } from './types';
import { info, warn, error } from './logger';
import { MAX_CONSECUTIVE_FAILURES } from './config';

const REGISTRY_NAME = 'TaskRegistry';

class TaskRegistry {
  private tasks: Map<string, TaskRegistration> = new Map();

  /**
   * Register a task. Idempotent — re-registering replaces the existing entry.
   */
  register(task: CronTask, enabled = true): void {
    if (this.tasks.has(task.name)) {
      warn(REGISTRY_NAME, `Re-registering task: ${task.name}`);
    }
    this.tasks.set(task.name, {
      task,
      enabled,
      consecutiveFailures: 0,
    });
    info(REGISTRY_NAME, `Registered: ${task.name} | schedule: ${task.schedule} | risk: ${task.riskLevel}`);
  }

  /**
   * Register multiple tasks at once.
   */
  registerAll(tasks: CronTask[]): void {
    for (const t of tasks) this.register(t);
    info(REGISTRY_NAME, `${tasks.length} tasks registered. Total: ${this.tasks.size}`);
  }

  /**
   * Retrieve all enabled task registrations.
   */
  getEnabled(): TaskRegistration[] {
    return Array.from(this.tasks.values()).filter(r => r.enabled);
  }

  /**
   * Retrieve a specific task by name.
   */
  get(name: string): TaskRegistration | undefined {
    return this.tasks.get(name);
  }

  /**
   * All task names (enabled + disabled).
   */
  list(): string[] {
    return Array.from(this.tasks.keys());
  }

  /**
   * Enable a task by name.
   */
  enable(name: string): boolean {
    const reg = this.tasks.get(name);
    if (!reg) { warn(REGISTRY_NAME, `enable: unknown task ${name}`); return false; }
    reg.enabled = true;
    reg.consecutiveFailures = 0;
    info(REGISTRY_NAME, `Enabled: ${name}`);
    return true;
  }

  /**
   * Disable a task by name.
   */
  disable(name: string): boolean {
    const reg = this.tasks.get(name);
    if (!reg) { warn(REGISTRY_NAME, `disable: unknown task ${name}`); return false; }
    reg.enabled = false;
    info(REGISTRY_NAME, `Disabled: ${name}`);
    return true;
  }

  /**
   * Record the outcome of a task run.
   * Automatically disables task if MAX_CONSECUTIVE_FAILURES is exceeded.
   */
  recordOutcome(name: string, status: TaskStatus): void {
    const reg = this.tasks.get(name);
    if (!reg) return;

    reg.lastRunAt = new Date();
    reg.lastStatus = status;

    if (status === 'failed') {
      reg.consecutiveFailures++;
      if (reg.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        reg.enabled = false;
        error(REGISTRY_NAME,
          `Task "${name}" disabled after ${reg.consecutiveFailures} consecutive failures.`
        );
      } else {
        warn(REGISTRY_NAME,
          `Task "${name}" failed (${reg.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES} before auto-disable)`
        );
      }
    } else if (status === 'success') {
      if (reg.consecutiveFailures > 0) {
        info(REGISTRY_NAME, `Task "${name}" recovered after ${reg.consecutiveFailures} failure(s)`);
      }
      reg.consecutiveFailures = 0;
    }
  }

  /**
   * Health summary for logging/monitoring.
   */
  summary(): Record<string, { enabled: boolean; lastStatus?: string; failures: number }> {
    const out: Record<string, { enabled: boolean; lastStatus?: string; failures: number }> = {};
    for (const [name, reg] of this.tasks) {
      out[name] = {
        enabled: reg.enabled,
        lastStatus: reg.lastStatus,
        failures: reg.consecutiveFailures,
      };
    }
    return out;
  }
}

// Singleton registry shared across the process
export const registry = new TaskRegistry();

/**
 * Load all tasks from the ./tasks/ directory.
 * Each module must export a default CronTask or an array of CronTask.
 */
export async function loadAllTasks(): Promise<void> {
  const taskModules = [
    './tasks/analytics',
    './tasks/crmLeads',
    './tasks/security',
    './tasks/healthcheck',
  ];

  for (const modulePath of taskModules) {
    try {
      const mod = await import(modulePath);
      const exported = mod.default ?? mod;
      if (Array.isArray(exported)) {
        for (const task of exported) registry.register(task);
      } else if (exported && typeof exported.run === 'function') {
        registry.register(exported);
      } else {
        warn(REGISTRY_NAME, `Module ${modulePath} does not export a valid CronTask`);
      }
    } catch (err) {
      error(REGISTRY_NAME, `Failed to load task module ${modulePath}: ${(err as Error).message}`);
    }
  }
}
