/**
 * ═══════════════════════════════════════════════════════════════
 *  CRONOPS LOGGER — Structured Execution Logging
 * ═══════════════════════════════════════════════════════════════
 *
 *  Writes structured JSON entries to /cronops/logs/YYYY-MM-DD.log.
 *  Console output is always plain text.
 *  PHI GUARD: Never log patient names, DOBs, or health data.
 *  All log lines go through sanitize() before writing to disk.
 */

import fs from 'fs';
import path from 'path';
import { LOGS_DIR } from './config';
import type { TaskExecution } from './types';

// ─── PHI Guard ────────────────────────────────────────────────

const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,           // SSN
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,  // DOB date patterns
  /patient_id["\s:=]+[^\s,}"]+/gi,    // patient_id values
];

function sanitize(line: string): string {
  let s = line;
  for (const p of PHI_PATTERNS) s = s.replace(p, '[REDACTED]');
  return s;
}

// ─── Log file path helpers ────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function logFilePath(date = todayStr()): string {
  return path.join(LOGS_DIR, `${date}.log`);
}

// ─── Low-level write (append to daily file) ───────────────────

function appendToFile(filePath: string, content: string): void {
  try {
    fs.appendFileSync(filePath, content + '\n', 'utf8');
  } catch (e) {
    // Never crash the process over a log write failure
    console.error('[CronOps Logger] Write failed:', (e as Error).message);
  }
}

// ─── Public API ───────────────────────────────────────────────

export function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', taskName: string, message: string, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const clean = sanitize(message);
  const entry = {
    ts,
    level,
    task: taskName,
    msg: clean,
    ...(extra ? { extra } : {}),
  };

  // Console
  const prefix = `[${ts}] [${level}] [${taskName}]`;
  if (level === 'ERROR') console.error(prefix, clean);
  else if (level === 'WARN') console.warn(prefix, clean);
  else console.log(prefix, clean);

  // File
  appendToFile(logFilePath(), JSON.stringify(entry));
}

export function info(taskName: string, message: string, extra?: Record<string, unknown>): void {
  log('INFO', taskName, message, extra);
}

export function warn(taskName: string, message: string, extra?: Record<string, unknown>): void {
  log('WARN', taskName, message, extra);
}

export function error(taskName: string, message: string, extra?: Record<string, unknown>): void {
  log('ERROR', taskName, message, extra);
}

/**
 * Write a full TaskExecution record to the daily log.
 * Called by the scheduler after each task run completes.
 */
export function logExecution(execution: TaskExecution): void {
  const ts = new Date().toISOString();
  const entry = {
    ts,
    type: 'EXECUTION',
    task: execution.taskName,
    status: execution.status,
    durationMs: execution.durationMs,
    dryRun: execution.dryRun,
    message: sanitize(execution.result.message),
    crmActions: (execution.result.crmActions || []).length,
    metrics: execution.result.metrics || {},
    reportPath: execution.result.reportPath,
    errorLogs: execution.result.logs
      .filter(l => l.toLowerCase().includes('error') || l.toLowerCase().includes('fail'))
      .map(sanitize)
      .slice(0, 10),
  };

  const prefix = `[${ts}] [EXEC] [${execution.taskName}] ${execution.status.toUpperCase()} in ${execution.durationMs}ms`;
  if (execution.status === 'failed') console.error(prefix);
  else console.log(prefix);

  appendToFile(logFilePath(), JSON.stringify(entry));
}

/**
 * Generate a daily summary log entry (called by scheduler at midnight).
 */
export function logDailySummary(stats: {
  tasksRun: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  date: string;
}): void {
  const ts = new Date().toISOString();
  const entry = { ts, type: 'DAILY_SUMMARY', ...stats };
  console.log(`[${ts}] [SUMMARY] Day complete: ${stats.successes}/${stats.tasksRun} succeeded`);
  appendToFile(logFilePath(stats.date), JSON.stringify(entry));
}

/**
 * Read the last N log entries from the daily log (for reporting).
 */
export function readTodaysLog(): TaskExecution[] {
  try {
    const raw = fs.readFileSync(logFilePath(), 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter((e): e is TaskExecution => e !== null && e.type === 'EXECUTION');
  } catch {
    return [];
  }
}
