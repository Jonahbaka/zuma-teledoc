/**
 * ═══════════════════════════════════════════════════════════════
 *  PERSISTENT MEMORY — The Second Brain
 *  OpenClaw-style: Agents remember EVERYTHING across sessions.
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Every agent has a persistent memory store that survives:
 *    - Server restarts
 *    - Session changes
 *    - Multi-channel interactions (Telegram/WhatsApp/Web)
 * 
 *  Memory types:
 *    - facts: Permanent things about the Operator/business
 *    - context: Current goals, projects, priorities
 *    - preferences: How the Operator likes things done
 *    - learnings: What the agent has learned over time
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../db');

class PersistentMemory {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    try {
      // Create memory table if not exists
      await db.query(`
        CREATE TABLE IF NOT EXISTS ai_agent_memory (
          id SERIAL PRIMARY KEY,
          agent_type VARCHAR(50) NOT NULL,
          memory_type VARCHAR(30) NOT NULL DEFAULT 'context',
          memory_key VARCHAR(200) NOT NULL,
          memory_value TEXT NOT NULL,
          importance FLOAT DEFAULT 0.5,
          source VARCHAR(100) DEFAULT 'conversation',
          expires_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(agent_type, memory_key)
        )
      `);

      // Create index for fast lookup
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON ai_agent_memory(agent_type)
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_agent_memory_key ON ai_agent_memory(memory_type)
      `);

      this.initialized = true;
      console.log('  🧠 Persistent Memory: ONLINE (Second Brain active)');
    } catch (error) {
      console.error('  ⚠️ Persistent Memory init error:', error.message);
    }
  }

  /**
   * Store a memory for an agent
   */
  async remember(agentType, key, value, options = {}) {
    try {
      await db.query(`
        INSERT INTO ai_agent_memory (agent_type, memory_type, memory_key, memory_value, importance, source, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (agent_type, memory_key) DO UPDATE SET
          memory_value = EXCLUDED.memory_value,
          importance = EXCLUDED.importance,
          source = EXCLUDED.source,
          updated_at = NOW()
      `, [
        agentType,
        options.type || 'context',
        key,
        typeof value === 'object' ? JSON.stringify(value) : String(value),
        options.importance || 0.5,
        options.source || 'conversation',
        options.expiresAt || null
      ]);
    } catch (e) {
      console.error('Memory store error:', e.message);
    }
  }

  /**
   * Recall a specific memory
   */
  async recall(agentType, key) {
    try {
      const result = await db.query(
        'SELECT memory_value, memory_type FROM ai_agent_memory WHERE agent_type = $1 AND memory_key = $2 AND (expires_at IS NULL OR expires_at > NOW())',
        [agentType, key]
      );
      return result.rows[0]?.memory_value || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get all memories for an agent (for context injection into LLM)
   */
  async getAgentMemory(agentType, options = {}) {
    try {
      const limit = options.limit || 30;
      const result = await db.query(`
        SELECT memory_key, memory_value, memory_type, importance
        FROM ai_agent_memory
        WHERE agent_type = $1 AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY importance DESC, updated_at DESC
        LIMIT $2
      `, [agentType, limit]);

      if (result.rows.length === 0) return '';

      // Format memories as context string for LLM
      const grouped = {};
      for (const row of result.rows) {
        if (!grouped[row.memory_type]) grouped[row.memory_type] = [];
        grouped[row.memory_type].push(`- ${row.memory_key}: ${row.memory_value}`);
      }

      let context = '';
      for (const [type, memories] of Object.entries(grouped)) {
        context += `[${type.toUpperCase()}]\n${memories.join('\n')}\n\n`;
      }
      return context.trim();
    } catch (e) {
      return '';
    }
  }

  /**
   * Get shared memories (accessible by all agents)
   */
  async getSharedMemory(limit = 20) {
    try {
      const result = await db.query(`
        SELECT memory_key, memory_value, memory_type, agent_type
        FROM ai_agent_memory
        WHERE agent_type = 'shared' AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY importance DESC, updated_at DESC
        LIMIT $1
      `, [limit]);

      return result.rows.map(r => `- [${r.memory_type}] ${r.memory_key}: ${r.memory_value}`).join('\n');
    } catch (e) {
      return '';
    }
  }

  /**
   * Auto-extract memories from a conversation message
   * (Called after each operator message to build the Second Brain)
   */
  async extractAndStore(agentType, operatorMessage, agentResponse) {
    // Simple heuristic extraction — no LLM needed for basic facts
    const msg = operatorMessage.toLowerCase();

    // Detect preferences
    if (msg.includes('i prefer') || msg.includes('i like') || msg.includes('i want')) {
      await this.remember(agentType, `preference_${Date.now()}`, operatorMessage, { type: 'preference', importance: 0.7 });
    }

    // Detect goals
    if (msg.includes('goal') || msg.includes('target') || msg.includes('objective') || msg.includes('plan')) {
      await this.remember('shared', `goal_${Date.now()}`, operatorMessage, { type: 'context', importance: 0.8 });
    }

    // Detect important facts
    if (msg.includes('our') || msg.includes('we have') || msg.includes('we are') || msg.includes('doctarx')) {
      await this.remember('shared', `fact_${Date.now()}`, operatorMessage, { type: 'fact', importance: 0.6 });
    }
  }

  /**
   * Forget a specific memory
   */
  async forget(agentType, key) {
    await db.query('DELETE FROM ai_agent_memory WHERE agent_type = $1 AND memory_key = $2', [agentType, key]);
  }

  /**
   * Clear expired memories
   */
  async cleanup() {
    await db.query('DELETE FROM ai_agent_memory WHERE expires_at IS NOT NULL AND expires_at < NOW()');
  }

  /**
   * Get memory stats
   */
  async getStats() {
    try {
      const result = await db.query(`
        SELECT agent_type, memory_type, COUNT(*) as count
        FROM ai_agent_memory
        WHERE expires_at IS NULL OR expires_at > NOW()
        GROUP BY agent_type, memory_type
        ORDER BY count DESC
      `);
      return result.rows;
    } catch (e) {
      return [];
    }
  }

  /**
   * List raw memory rows for operator UI / debugging.
   * Keep separate from getAgentMemory() which returns a formatted context string.
   */
  async list(agentType, options = {}) {
    try {
      const limit = Math.min(200, Math.max(1, parseInt(options.limit) || 30));
      const params = [agentType, limit];
      let where = 'agent_type = $1 AND (expires_at IS NULL OR expires_at > NOW())';
      if (options.type) {
        params.splice(1, 0, String(options.type));
        where = 'agent_type = $1 AND memory_type = $2 AND (expires_at IS NULL OR expires_at > NOW())';
      }

      const q = `
        SELECT id, agent_type, memory_type, memory_key, memory_value, importance, source, created_at, updated_at, expires_at
        FROM ai_agent_memory
        WHERE ${where}
        ORDER BY updated_at DESC
        LIMIT $${params.length}
      `;
      const result = await db.query(q, params);
      return result.rows || [];
    } catch (e) {
      return [];
    }
  }
}

module.exports = new PersistentMemory();
