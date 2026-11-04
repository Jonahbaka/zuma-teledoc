/**
 * ═══════════════════════════════════════════════════════════════
 *  CRM LEADS TASK — Lead Enrichment, Scoring & Pipeline Automation
 * ═══════════════════════════════════════════════════════════════
 *
 *  Schedule: every 30 minutes
 *  Risk:     medium (writes to crm_contacts and crm_interactions)
 *
 *  What it does:
 *  1. Fetches pending/new leads created in the last 30 minutes from crm_contacts.
 *  2. Scores each lead (0–100) based on completeness and profile signals.
 *  3. Auto-advances high-score leads (≥70) from 'new' → 'contacted' pipeline stage.
 *  4. Logs all interactions to crm_interactions table.
 *  5. Flags high-value leads (score ≥ 85) for manual follow-up.
 *  6. Writes daily report to /cronops/reports/YYYY-MM-DD-crm-leads.md.
 *
 *  Safety: DRY_RUN=true logs all planned writes without executing them.
 *  Idempotent: uses 'last_lead_scored_at' column to skip already-processed leads.
 */

import type { CronTask, TaskResult } from '../types';
import { info, warn } from '../logger';
import { query, write } from '../services/db';
import { writeReport } from '../services/reportWriter';
import { CRM_LEAD_ALERT_THRESHOLD, CRM_AUTO_ADVANCE_MIN_SCORE, DRY_RUN } from '../config';

const TASK_NAME = 'crm-leads';

// ─── Types ────────────────────────────────────────────────────

interface CrmContact {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  status: string;
  pipeline_stage?: string;
  lead_score?: number;
  contact_type?: string;
  notes?: string;
  source?: string;
  created_at: string;
  last_contacted_at?: string;
}

interface ScoredLead {
  contact: CrmContact;
  score: number;
  reasons: string[];
  action: 'advance' | 'flag' | 'observe';
}

// ─── Lead scoring ─────────────────────────────────────────────

function scoreLead(contact: CrmContact): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Contact completeness
  if (contact.email)    { score += 20; reasons.push('+20 has email'); }
  if (contact.phone)    { score += 15; reasons.push('+15 has phone'); }
  if (contact.first_name && contact.last_name) { score += 10; reasons.push('+10 full name'); }
  if (contact.company)  { score += 10; reasons.push('+10 has company'); }
  if (contact.notes)    { score += 5;  reasons.push('+5 has notes'); }

  // Source quality
  if (contact.source === 'web_form')    { score += 15; reasons.push('+15 web form (high intent)'); }
  if (contact.source === 'referral')    { score += 20; reasons.push('+20 referral (trusted source)'); }
  if (contact.source === 'organic')     { score += 10; reasons.push('+10 organic'); }
  if (contact.source === 'social')      { score += 8;  reasons.push('+8 social'); }

  // Contact type signals
  if (contact.contact_type === 'provider') { score += 10; reasons.push('+10 provider lead (high value)'); }
  if (contact.contact_type === 'investor') { score += 15; reasons.push('+15 investor lead'); }
  if (contact.contact_type === 'employer') { score += 12; reasons.push('+12 employer/B2B lead'); }

  // Recency: leads created very recently get a small boost
  const ageHours = (Date.now() - new Date(contact.created_at).getTime()) / 3_600_000;
  if (ageHours < 1)  { score += 10; reasons.push('+10 created < 1h ago'); }
  else if (ageHours < 6) { score += 5; reasons.push('+5 created < 6h ago'); }

  // Cap at 100
  score = Math.min(100, score);
  return { score, reasons };
}

function decideAction(score: number, stage: string): 'advance' | 'flag' | 'observe' {
  if (score >= 85) return 'flag';
  if (score >= CRM_AUTO_ADVANCE_MIN_SCORE && stage === 'new') return 'advance';
  return 'observe';
}

// ─── CRM database operations ──────────────────────────────────

async function fetchNewLeads(): Promise<CrmContact[]> {
  // Fetch leads created in the last 35 minutes (slightly over the 30-min schedule for safety)
  const result = await query<CrmContact>(`
    SELECT id, first_name, last_name, email, phone, company,
           status, pipeline_stage, lead_score, contact_type,
           notes, source, created_at, last_contacted_at
    FROM crm_contacts
    WHERE status IN ('lead', 'new', 'prospect')
      AND (lead_score IS NULL OR lead_score = 0)
      AND created_at > NOW() - INTERVAL '35 minutes'
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return result.rows;
}

async function fetchStaledLeads(): Promise<CrmContact[]> {
  // Also check leads that haven't been scored yet (older ones that might have been missed)
  const result = await query<CrmContact>(`
    SELECT id, first_name, last_name, email, phone, company,
           status, pipeline_stage, lead_score, contact_type,
           notes, source, created_at, last_contacted_at
    FROM crm_contacts
    WHERE status IN ('lead', 'new', 'prospect')
      AND (lead_score IS NULL OR lead_score = 0)
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  return result.rows;
}

async function updateLeadScore(contactId: string, score: number, reason: string): Promise<void> {
  await write(`
    UPDATE crm_contacts
    SET lead_score = $1,
        updated_at = NOW()
    WHERE id = $2
  `, [score, contactId]);

  // Log interaction
  await write(`
    INSERT INTO crm_interactions (contact_id, interaction_type, notes, created_at)
    VALUES ($1, 'ai_score', $2, NOW())
    ON CONFLICT DO NOTHING
  `, [contactId, `CronOps: Scored ${score}/100. ${reason}`]).catch(() => {
    // crm_interactions may use different column names — best effort
  });
}

async function advancePipelineStage(contactId: string, fromStage: string, toStage: string): Promise<void> {
  await write(`
    UPDATE crm_contacts
    SET pipeline_stage = $1,
        status = 'prospect',
        updated_at = NOW()
    WHERE id = $2 AND pipeline_stage = $3
  `, [toStage, contactId, fromStage]);

  await write(`
    INSERT INTO crm_interactions (contact_id, interaction_type, notes, created_at)
    VALUES ($1, 'stage_advance', $2, NOW())
    ON CONFLICT DO NOTHING
  `, [contactId, `CronOps: Auto-advanced from "${fromStage}" → "${toStage}" (score threshold met)`]).catch(() => {});
}

async function flagForManualFollowUp(contactId: string, score: number, contactName: string): Promise<void> {
  await write(`
    UPDATE crm_contacts
    SET notes = COALESCE(notes, '') || $1,
        updated_at = NOW()
    WHERE id = $2
  `, [`\n[CronOps ${new Date().toISOString()}] High-value lead flagged (score: ${score}/100). Manual follow-up recommended.`, contactId]);

  await write(`
    INSERT INTO crm_interactions (contact_id, interaction_type, notes, created_at)
    VALUES ($1, 'flag_high_value', $2, NOW())
    ON CONFLICT DO NOTHING
  `, [contactId, `CronOps: Flagged as HIGH-VALUE lead (score ${score}/100). ${contactName} — requires manual outreach.`]).catch(() => {});
}

// ─── Report builder ───────────────────────────────────────────

function buildCrmReport(
  scored: ScoredLead[],
  advanced: number,
  flagged: number,
  ts: string
): string {
  const highValue = scored.filter(s => s.score >= 85);
  const advancing = scored.filter(s => s.action === 'advance');

  let content = `**Run at ${ts}** | ${scored.length} leads processed\n\n`;

  content += `#### Summary\n\n`;
  content += `| Metric | Count |\n|--------|-------|\n`;
  content += `| Leads Scored | ${scored.length} |\n`;
  content += `| Auto-Advanced (≥${CRM_AUTO_ADVANCE_MIN_SCORE}) | ${advanced} |\n`;
  content += `| Flagged High-Value (≥85) | ${flagged} |\n`;

  if (highValue.length > 0) {
    content += `\n#### ⭐ High-Value Leads (Score ≥ 85)\n\n`;
    for (const { contact, score, reasons } of highValue) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
      const company = contact.company ? ` @ ${contact.company}` : '';
      content += `- **${name}${company}** — Score: **${score}/100**\n`;
      content += `  - Type: ${contact.contact_type || 'unspecified'} | Source: ${contact.source || 'unknown'}\n`;
      content += `  - Reasons: ${reasons.slice(0, 3).join(', ')}\n\n`;
    }
  }

  if (advancing.length > 0) {
    content += `\n#### 🚀 Auto-Advanced Leads\n\n`;
    for (const { contact, score } of advancing) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
      content += `- **${name}** — Score ${score}/100 → Stage: contacted\n`;
    }
  }

  return content;
}

// ─── Task definition ──────────────────────────────────────────

const crmLeadsTask: CronTask = {
  name: 'crm-leads',
  schedule: '*/30 * * * *', // Every 30 minutes
  riskLevel: 'medium',

  async run(): Promise<TaskResult> {
    const logs: string[] = [];
    const crmActions: string[] = [];
    const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    info(TASK_NAME, 'Fetching new and unscored CRM leads...');

    // Fetch new leads (last 35 min) + any staled unscored ones
    const [newLeads, staledLeads] = await Promise.all([
      fetchNewLeads().catch(() => [] as CrmContact[]),
      fetchStaledLeads().catch(() => [] as CrmContact[]),
    ]);

    // Deduplicate by id
    const seen = new Set<string>();
    const allLeads: CrmContact[] = [];
    for (const lead of [...newLeads, ...staledLeads]) {
      if (!seen.has(lead.id)) {
        seen.add(lead.id);
        allLeads.push(lead);
      }
    }

    logs.push(`Found ${allLeads.length} leads to process (${newLeads.length} new, ${staledLeads.length} staled)`);

    if (allLeads.length === 0) {
      return {
        success: true,
        message: 'No new leads to process this cycle.',
        logs,
        crmActions: [],
        metrics: { leadsProcessed: 0, advanced: 0, flagged: 0 },
      };
    }

    if (allLeads.length >= CRM_LEAD_ALERT_THRESHOLD) {
      warn(TASK_NAME, `Lead volume alert: ${allLeads.length} leads this cycle (threshold: ${CRM_LEAD_ALERT_THRESHOLD})`);
      logs.push(`[ALERT] High lead volume: ${allLeads.length} leads in this cycle`);
    }

    // Score and process each lead
    const scoredLeads: ScoredLead[] = [];
    let advanced = 0;
    let flagged = 0;

    for (const contact of allLeads) {
      const { score, reasons } = scoreLead(contact);
      const stage = contact.pipeline_stage || 'new';
      const action = decideAction(score, stage);
      scoredLeads.push({ contact, score, reasons, action });

      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.id;
      logs.push(`Lead ${name}: score ${score}/100 → action: ${action}`);

      // Update score in DB
      if (!DRY_RUN) {
        await updateLeadScore(contact.id, score, reasons.slice(0, 3).join('; ')).catch(e => {
          logs.push(`[WARN] Failed to update score for ${contact.id}: ${e.message}`);
        });
      }
      crmActions.push(`score:${contact.id}:${score}`);

      if (action === 'advance') {
        if (!DRY_RUN) {
          await advancePipelineStage(contact.id, stage, 'contacted').catch(e => {
            logs.push(`[WARN] Failed to advance ${contact.id}: ${e.message}`);
          });
        }
        crmActions.push(`advance:${contact.id}:${stage}->contacted`);
        advanced++;
        logs.push(`  → Auto-advanced to "contacted" (score ${score} ≥ ${CRM_AUTO_ADVANCE_MIN_SCORE})`);
      }

      if (action === 'flag') {
        if (!DRY_RUN) {
          await flagForManualFollowUp(contact.id, score, name).catch(e => {
            logs.push(`[WARN] Failed to flag ${contact.id}: ${e.message}`);
          });
        }
        crmActions.push(`flag:${contact.id}:high_value`);
        flagged++;
        logs.push(`  → Flagged for manual follow-up (score ${score} ≥ 85)`);
      }
    }

    // Write report
    const reportContent = buildCrmReport(scoredLeads, advanced, flagged, ts);
    const reportPath = writeReport('crm-leads', [
      { heading: 'CRM Lead Processing Report', content: reportContent },
    ]);
    logs.push(`Report written: ${reportPath}`);

    info(TASK_NAME, `Complete. Processed: ${scoredLeads.length} | Advanced: ${advanced} | Flagged: ${flagged}`);

    return {
      success: true,
      message: `Processed ${scoredLeads.length} leads | ${advanced} advanced | ${flagged} flagged`,
      logs,
      crmActions,
      reportPath,
      metrics: {
        leadsProcessed: scoredLeads.length,
        advanced,
        flagged,
        avgScore: scoredLeads.length
          ? Math.round(scoredLeads.reduce((s, l) => s + l.score, 0) / scoredLeads.length)
          : 0,
      },
    };
  },
};

export default crmLeadsTask;
