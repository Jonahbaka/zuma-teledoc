/**
 * ═══════════════════════════════════════════════════════════════
 *  REPORT WRITER — Markdown Report Generator
 * ═══════════════════════════════════════════════════════════════
 *
 *  Writes task reports to /cronops/reports/YYYY-MM-DD-{type}.md.
 *  All reports are append-safe: re-running a task on the same day
 *  appends a new section instead of overwriting.
 */

import fs from 'fs';
import path from 'path';
import { REPORTS_DIR } from '../config';

export type ReportType = 'analytics' | 'crm-leads' | 'security' | 'health' | 'summary';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function reportPath(type: ReportType, date = todayStr()): string {
  return path.join(REPORTS_DIR, `${date}-${type}.md`);
}

function now(): string {
  return new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
}

/**
 * Write (or append to) a markdown report file.
 * Returns the file path written.
 */
export function writeReport(
  type: ReportType,
  sections: { heading: string; content: string }[],
  options: { overwrite?: boolean; date?: string } = {}
): string {
  const filePath = reportPath(type, options.date);
  const timestamp = now();

  let md = '';

  // If overwriting or file doesn't exist, write a header
  if (options.overwrite || !fs.existsSync(filePath)) {
    md += `# DoctaRx CronOps — ${type.toUpperCase()} Report\n`;
    md += `_Generated: ${timestamp} ET_\n\n`;
    md += '---\n\n';
  } else {
    md += `\n---\n\n## 🔄 Updated: ${timestamp}\n\n`;
  }

  for (const { heading, content } of sections) {
    md += `### ${heading}\n\n${content}\n\n`;
  }

  try {
    if (options.overwrite) {
      fs.writeFileSync(filePath, md, 'utf8');
    } else {
      fs.appendFileSync(filePath, md, 'utf8');
    }
  } catch (err) {
    console.error('[ReportWriter] Failed to write report:', (err as Error).message);
  }

  return filePath;
}

/**
 * Write the daily summary report combining all task results.
 */
export function writeSummaryReport(entries: {
  task: string;
  status: string;
  durationMs: number;
  message: string;
  metrics?: Record<string, number | string>;
}[]): string {
  const timestamp = now();
  const passed = entries.filter(e => e.status === 'success').length;
  const failed = entries.filter(e => e.status === 'failed').length;

  let content = `| Task | Status | Duration | Message |\n`;
  content += `|------|--------|----------|---------|\n`;
  for (const e of entries) {
    const icon = e.status === 'success' ? '✅' : e.status === 'failed' ? '❌' : '⏭';
    content += `| ${e.task} | ${icon} ${e.status} | ${e.durationMs}ms | ${e.message.slice(0, 60)} |\n`;
  }
  content += `\n**${passed} passed | ${failed} failed | ${entries.length} total**\n`;

  const sections = [
    { heading: `Daily Task Execution — ${timestamp}`, content },
  ];

  return writeReport('summary', sections, { overwrite: true });
}
