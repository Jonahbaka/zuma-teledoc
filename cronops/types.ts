/**
 * ═══════════════════════════════════════════════════════════════
 *  CRONOPS TYPES — DoctaRx Automated Operations Engine
 * ═══════════════════════════════════════════════════════════════
 *
 *  Shared interface definitions for all CronOps tasks.
 *  No business logic — only contracts.
 */

export type RiskLevel = 'low' | 'medium' | 'high';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/**
 * Core task interface every CronOps task must satisfy.
 */
export interface CronTask {
  /** Unique human-readable name for logs and reports */
  name: string;
  /** cron expression e.g. '0 * * * *' */
  schedule: string;
  /** Risk classification — controls DRY_RUN enforcement */
  riskLevel: RiskLevel;
  /** The work. Must be idempotent. Must not throw — return TaskResult with success:false instead. */
  run(): Promise<TaskResult>;
}

/**
 * Structured result every task returns.
 */
export interface TaskResult {
  /** Was the task successful overall? */
  success: boolean;
  /** Short human-readable summary of what happened */
  message: string;
  /** Detailed execution log lines (no PHI) */
  logs: string[];
  /** CRM contact/interaction IDs affected by this task run */
  crmActions?: string[];
  /** Numeric metrics for the report */
  metrics?: Record<string, number | string>;
  /** Any generated report file path */
  reportPath?: string;
}

/**
 * Execution record stored in log files.
 */
export interface TaskExecution {
  taskName: string;
  schedule: string;
  riskLevel: RiskLevel;
  status: TaskStatus;
  startedAt: string;   // ISO 8601
  completedAt: string; // ISO 8601
  durationMs: number;
  result: TaskResult;
  dryRun: boolean;
}

/**
 * Registry entry — task definition + runtime state.
 */
export interface TaskRegistration {
  task: CronTask;
  enabled: boolean;
  lastRunAt?: Date;
  lastStatus?: TaskStatus;
  consecutiveFailures: number;
}

/**
 * Scheduler lock entry to prevent overlapping executions.
 */
export interface ExecutionLock {
  taskName: string;
  acquiredAt: Date;
  pid: number;
}
