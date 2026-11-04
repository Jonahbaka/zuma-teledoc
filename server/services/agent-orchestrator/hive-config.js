/**
 * ═══════════════════════════════════════════════════════════════
 *  HIVE CONFIG — Central configuration for the DoctaRx Agent Hive
 * ═══════════════════════════════════════════════════════════════
 *
 *  Defines all Hive agents, their sandboxes, skill files,
 *  and the gateway configuration.
 */

const path = require('path');
const fs = require('fs');

const SKILLS_DIR = path.join(__dirname, 'skills');

function loadSkill(filename) {
  try {
    return fs.readFileSync(path.join(SKILLS_DIR, filename), 'utf-8');
  } catch {
    return null;
  }
}

const HIVE_CONFIG = {
  gateway: {
    port: parseInt(process.env.HIVE_PORT, 10) || 18789,
    socketNamespace: '/hive',
    maxSessionsPerUser: 3,
    sessionTimeoutMs: 30 * 60 * 1000,
  },

  sandbox: {
    mode: 'all',
    isolation: true,
    hipaaCompliant: true,
    auditLog: true,
  },

  agents: {
    nova: {
      id: 'nova',
      name: 'Nurse Nova',
      type: 'concierge',
      description: 'Public health concierge for the DoctaRx homepage',
      skillFile: 'zuma_public.md',
      knowledgeBase: 'knowledge_base.md',
      sandbox: { dbRead: false, dbWrite: false, webSearch: true, medical: false },
      publicAccess: true,
      color: '#3B82F6',
    },
    triage: {
      id: 'triage',
      name: 'Triage Bot',
      type: 'triage',
      description: 'AI symptom assessment for the patient portal',
      skillFile: 'zuma_triage.md',
      sandbox: { dbRead: true, dbWrite: true, webSearch: false, medical: true },
      publicAccess: false,
      color: '#8B5CF6',
    },
    hippocrates: {
      id: 'hippocrates',
      name: 'Hippocrates',
      type: 'clinical',
      description: 'Clinical co-pilot for provider consultations',
      skillFile: 'zuma_clinical.md',
      sandbox: { dbRead: true, dbWrite: true, webSearch: true, medical: true },
      publicAccess: false,
      requiredRole: 'provider',
      color: '#10B981',
    },
    overwatch: {
      id: 'overwatch',
      name: 'The Conductor',
      type: 'ceo',
      description: 'Hive monitoring and admin control intelligence',
      skillFile: null,
      sandbox: { dbRead: true, dbWrite: true, webSearch: true, medical: false },
      publicAccess: false,
      requiredRole: 'admin',
      color: '#F59E0B',
    },
  },

  loadAgentSkill(agentId) {
    const agent = this.agents[agentId];
    if (!agent?.skillFile) return null;
    return loadSkill(agent.skillFile);
  },

  loadKnowledgeBase() {
    return loadSkill('knowledge_base.md');
  },

  getAgentList() {
    return Object.values(this.agents).map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description,
      publicAccess: a.publicAccess,
      color: a.color,
    }));
  },
};

module.exports = HIVE_CONFIG;
