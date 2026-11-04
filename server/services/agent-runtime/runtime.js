const db = require('../../db');
const { AGENT_REGISTRY, classifyTask, getAgentById } = require('./agentRegistry');
const { getTool, listTools } = require('./toolRegistry');

let workerTimer = null;
let workerBusy = false;
let workerState = {
  running: false,
  lastPollAt: null,
  lastRunAt: null,
  lastError: null,
  intervalMs: null,
};

function modelConfiguration() {
  const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const fastModel = process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash';
  const strongModel = process.env.AGENT_MODEL_STRONG || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

  let primaryProvider = 'none';
  let currentModel = null;
  if (anthropicConfigured) {
    primaryProvider = 'anthropic';
    currentModel = strongModel;
  } else if (geminiConfigured) {
    primaryProvider = 'google';
    currentModel = fastModel;
  } else if (openaiConfigured) {
    primaryProvider = 'openai';
    currentModel = process.env.AGENT_MODEL_FAST || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  return {
    configured: anthropicConfigured || geminiConfigured || openaiConfigured,
    primaryProvider,
    currentModel,
    fastModel,
    strongModel,
    anthropicConfigured,
    geminiConfigured,
    openaiConfigured,
    tokenMode: 'tool_first_deterministic',
  };
}

async function getBudgetSettings() {
  const result = await db.query(
    `SELECT daily_budget_usd, monthly_budget_usd, simple_model, strong_model, updated_at
       FROM ai_operational_agent_budget_settings
      WHERE id = 1`
  );
  return result.rows[0] || {
    daily_budget_usd: 5,
    monthly_budget_usd: 100,
    simple_model: 'gemini-2.0-flash',
    strong_model: 'claude-sonnet-4-6',
  };
}

async function updateBudgetSettings(input = {}, userId = null) {
  const daily = Number(input.dailyBudgetUsd);
  const monthly = Number(input.monthlyBudgetUsd);
  const simpleModel = String(input.simpleModel || '').trim();
  const strongModel = String(input.strongModel || '').trim();

  const result = await db.query(
    `INSERT INTO ai_operational_agent_budget_settings
       (id, daily_budget_usd, monthly_budget_usd, simple_model, strong_model, updated_by, updated_at)
     VALUES (
       1,
       COALESCE($1, 5.00),
       COALESCE($2, 100.00),
       COALESCE(NULLIF($3, ''), 'gemini-2.0-flash'),
       COALESCE(NULLIF($4, ''), 'claude-sonnet-4-6'),
       $5,
       NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       daily_budget_usd = EXCLUDED.daily_budget_usd,
       monthly_budget_usd = EXCLUDED.monthly_budget_usd,
       simple_model = EXCLUDED.simple_model,
       strong_model = EXCLUDED.strong_model,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      Number.isFinite(daily) ? daily : null,
      Number.isFinite(monthly) ? monthly : null,
      simpleModel,
      strongModel,
      userId,
    ]
  );
  return result.rows[0];
}

async function currentSpend() {
  const result = await db.query(
    `SELECT
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= CURRENT_DATE), 0)::float AS daily_cost,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())), 0)::float AS monthly_cost,
       COALESCE(SUM(input_tokens + output_tokens), 0)::int AS monthly_tokens
     FROM ai_operational_agent_tasks`
  );
  return result.rows[0] || { daily_cost: 0, monthly_cost: 0, monthly_tokens: 0 };
}

async function createTask(input = {}, user = {}) {
  const selectedAgent = input.agentId ? getAgentById(input.agentId) : classifyTask(input);
  if (!selectedAgent || !selectedAgent.active) {
    throw new Error('No active agent is available for this task');
  }

  const title = String(input.title || input.prompt || selectedAgent.description || 'Agent task').slice(0, 500);
  const taskType = String(input.taskType || selectedAgent.id || 'general').slice(0, 120);
  const model = modelConfiguration();
  const budget = await getBudgetSettings();
  const spend = await currentSpend();

  if (Number(spend.monthly_cost || 0) >= Number(budget.monthly_budget_usd || 0)) {
    throw new Error('Agent monthly budget reached. Increase the budget or wait until next month.');
  }

  const result = await db.query(
    `INSERT INTO ai_operational_agent_tasks
       (title, task_type, requested_by, selected_agent_id, selected_agent_name,
        status, risk_level, requires_approval, input, model_provider, model_name,
        max_tool_calls, max_tokens, queued_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7, $8, $9, $10, $11, $12, NOW())
     RETURNING *`,
    [
      title,
      taskType,
      user.id || null,
      selectedAgent.id,
      selectedAgent.name,
      selectedAgent.riskLevel || 'low',
      Boolean(input.requiresApproval),
      JSON.stringify(input),
      model.primaryProvider,
      selectedAgent.modelChoice || model.currentModel,
      selectedAgent.maxToolCalls || 4,
      selectedAgent.maxTokenBudget || 800,
    ]
  );

  return result.rows[0];
}

async function listTasks(filters = {}) {
  const values = [];
  let where = 'WHERE 1=1';
  let idx = 1;
  if (filters.status) {
    where += ` AND status = $${idx++}`;
    values.push(filters.status);
  }
  if (filters.agentId) {
    where += ` AND selected_agent_id = $${idx++}`;
    values.push(filters.agentId);
  }

  const limit = Math.min(Math.max(parseInt(filters.limit || 30, 10), 1), 100);
  values.push(limit);

  const result = await db.query(
    `SELECT *
       FROM ai_operational_agent_tasks
      ${where}
      ORDER BY created_at DESC
      LIMIT $${idx}`,
    values
  );
  return result.rows;
}

async function logToolCall({ taskId, agentId, toolName, inputSummary, outputSummary, status = 'completed', error, durationMs = 0 }) {
  await db.query(
    `INSERT INTO ai_operational_agent_tool_calls
       (task_id, agent_id, tool_name, status, input_summary, output_summary, error, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      taskId,
      agentId,
      toolName,
      status,
      JSON.stringify(inputSummary || {}),
      outputSummary ? JSON.stringify(outputSummary) : null,
      error || null,
      durationMs,
    ]
  );
}

async function callTool(task, agent, toolName, input = {}) {
  if (!agent.allowedTools.includes(toolName)) {
    throw new Error(`${agent.id} is not allowed to call ${toolName}`);
  }
  const tool = getTool(toolName);
  if (!tool) throw new Error(`Tool not registered: ${toolName}`);

  const start = Date.now();
  try {
    const output = await tool(input);
    await logToolCall({
      taskId: task.id,
      agentId: agent.id,
      toolName,
      inputSummary: input,
      outputSummary: output,
      status: 'completed',
      durationMs: Date.now() - start,
    });
    return output;
  } catch (error) {
    await logToolCall({
      taskId: task.id,
      agentId: agent.id,
      toolName,
      inputSummary: input,
      status: 'failed',
      error: error.message,
      durationMs: Date.now() - start,
    });
    throw error;
  }
}

function asInput(task) {
  if (!task.input) return {};
  if (typeof task.input === 'object') return task.input;
  try {
    return JSON.parse(task.input);
  } catch {
    return {};
  }
}

async function createApproval(task, agent, actionType, proposedAction) {
  const result = await db.query(
    `INSERT INTO ai_operational_agent_approvals
       (task_id, agent_id, action_type, risk_level, proposed_action, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      task.id,
      agent.id,
      actionType,
      agent.riskLevel || task.risk_level || 'medium',
      JSON.stringify(proposedAction || {}),
      task.requested_by || null,
    ]
  );
  return result.rows[0];
}

async function executeTask(task) {
  const agent = getAgentById(task.selected_agent_id);
  if (!agent) throw new Error(`Agent not found: ${task.selected_agent_id}`);
  const input = asInput(task);

  if (agent.id === 'router') {
    const selected = classifyTask(input);
    return {
      status: 'completed',
      agent: agent.id,
      selectedAgent: selected?.id || null,
      taskType: input.taskType || selected?.id || 'general',
      riskLevel: selected?.riskLevel || 'low',
      requiredTools: selected?.allowedTools || [],
      requiresApproval: Boolean(input.requiresApproval),
      reason: selected ? `Routed to ${selected.name}` : 'No specialist matched',
    };
  }

  if (agent.id === 'admin_test_account') {
    const visibility = await callTool(task, agent, 'verifyTestAccountVisibility', input);
    return {
      status: visibility.status === 'ok' ? 'completed' : 'needs_fix',
      agent: agent.id,
      problem: visibility.errors?.[0] || null,
      evidence: visibility.counts || [],
      recommended_actions: [
        'Keep the admin test account list filtered by is_test_account=true.',
        'Use role and market filters to confirm patient, provider, and pharmacy accounts.',
        'Show duplicate email errors instead of optimistic success.',
      ],
      requires_approval: false,
      risk_level: agent.riskLevel,
      data: visibility,
    };
  }

  if (agent.id === 'pharmacy_onboarding') {
    const pending = await callTool(task, agent, 'getPendingPharmacyOnboardings', input);
    const message = await callTool(task, agent, 'prepareWhatsAppMessage', input);
    const result = {
      status: pending.status,
      agent: agent.id,
      problem: pending.error || null,
      evidence: pending.pharmacies || [],
      recommended_actions: [
        'Review pending pharmacy profiles with missing license, WhatsApp, phone, or location fields.',
        'Approve or reject onboarding only after admin review.',
        'Use the prepared WhatsApp text only as a manual fallback unless the WhatsApp API is configured.',
      ],
      requires_approval: true,
      risk_level: agent.riskLevel,
      preparedMessage: message,
    };
    await createApproval(task, agent, 'pharmacy_onboarding_review', result);
    return result;
  }

  if (agent.id === 'provider_trial_revenue') {
    const usage = await callTool(task, agent, 'getProviderUsage', input);
    const expired = await callTool(task, agent, 'getExpiredProviderTrials', input);
    const result = {
      status: usage.status === 'ok' && expired.status === 'ok' ? 'completed' : 'needs_fix',
      agent: agent.id,
      evidence: [usage.summary || {}, { expiredCount: expired.expiredCount }],
      recommended_actions: expired.expiredCount > 0
        ? ['Review expired provider trials and approve subscription-required notices before any access change.']
        : ['No expired provider trial action is required from this run.'],
      requires_approval: expired.expiredCount > 0,
      risk_level: agent.riskLevel,
      data: { usage, expired },
    };
    if (expired.expiredCount > 0) {
      await createApproval(task, agent, 'provider_subscription_notice_review', result);
    }
    return result;
  }

  if (agent.id === 'whatsapp_operations') {
    const status = await callTool(task, agent, 'getWhatsAppNotificationStatus', input);
    const message = await callTool(task, agent, 'prepareWhatsAppMessage', input);
    const result = {
      status: status.manualFallbackRequired ? 'waiting_manual_fallback' : 'ready_for_api',
      agent: agent.id,
      evidence: [status],
      recommended_actions: [
        status.manualFallbackRequired
          ? 'Use manual WhatsApp fallback until WhatsApp Business API credentials are configured.'
          : 'Send through the configured WhatsApp Business API only after admin approval.',
      ],
      requires_approval: true,
      risk_level: agent.riskLevel,
      preparedMessage: message,
    };
    await createApproval(task, agent, 'whatsapp_message_review', result);
    return result;
  }

  if (agent.id === 'growth_partnership') {
    const draft = await callTool(task, agent, 'draftPartnershipMessage', input);
    return {
      status: 'completed',
      agent: agent.id,
      evidence: [draft],
      recommended_actions: ['Review and approve the draft before sending externally.'],
      requires_approval: false,
      risk_level: agent.riskLevel,
      draft,
    };
  }

  const routes = await callTool(task, agent, 'scanRoutes', input);
  const logins = agent.allowedTools.includes('checkMissingLoginRoutes')
    ? await callTool(task, agent, 'checkMissingLoginRoutes', input)
    : null;

  return {
    status: routes.criticalMissing?.length || logins?.missing?.length ? 'needs_fix' : 'completed',
    agent: agent.id,
    problem: routes.criticalMissing?.length ? 'Critical routes are missing.' : null,
    evidence: [routes, logins].filter(Boolean),
    recommended_actions: routes.criticalMissing?.length || logins?.missing?.length
      ? ['Create missing routes or fix CTAs before launch.']
      : ['No critical route gaps detected by the deterministic route scan.'],
    requires_approval: false,
    risk_level: agent.riskLevel,
  };
}

async function claimNextTask(taskId = null) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const params = [];
    let where = `status = 'queued'`;
    if (taskId) {
      where += ' AND id = $1';
      params.push(taskId);
    }
    const result = await client.query(
      `SELECT *
         FROM ai_operational_agent_tasks
        WHERE ${where}
        ORDER BY queued_at ASC NULLS LAST, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      params
    );

    const task = result.rows[0];
    if (!task) {
      await client.query('COMMIT');
      return null;
    }

    const updated = await client.query(
      `UPDATE ai_operational_agent_tasks
          SET status = 'running',
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [task.id]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function runNextTask(taskId = null) {
  const task = await claimNextTask(taskId);
  if (!task) return null;

  try {
    const result = await executeTask(task);
    const nextStatus = result.requires_approval ? 'waiting_approval' : 'completed';
    const updated = await db.query(
      `UPDATE ai_operational_agent_tasks
          SET status = $2,
              result = $3,
              error = NULL,
              completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [task.id, nextStatus, JSON.stringify(result)]
    );
    workerState.lastRunAt = new Date().toISOString();
    return updated.rows[0];
  } catch (error) {
    const updated = await db.query(
      `UPDATE ai_operational_agent_tasks
          SET status = 'failed',
              error = $2,
              completed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [task.id, error.message]
    );
    workerState.lastError = error.message;
    return updated.rows[0];
  }
}

async function getTaskToolCalls(taskId) {
  const result = await db.query(
    `SELECT *
       FROM ai_operational_agent_tool_calls
      WHERE task_id = $1
      ORDER BY created_at ASC`,
    [taskId]
  );
  return result.rows;
}

async function listApprovals(filters = {}) {
  const status = filters.status || 'pending';
  const result = await db.query(
    `SELECT a.*, t.title, t.selected_agent_name
       FROM ai_operational_agent_approvals a
       JOIN ai_operational_agent_tasks t ON t.id = a.task_id
      WHERE ($1::text IS NULL OR a.status = $1)
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [status === 'all' ? null : status]
  );
  return result.rows;
}

async function decideApproval(id, decision, userId, notes = '') {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Approval decision must be approved or rejected');
  }

  const result = await db.query(
    `UPDATE ai_operational_agent_approvals
        SET status = $2,
            decided_by = $3,
            decision_notes = $4,
            decided_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, decision, userId || null, notes || null]
  );

  const approval = result.rows[0];
  if (!approval) throw new Error('Approval request not found');

  await db.query(
    `UPDATE ai_operational_agent_tasks
        SET status = CASE
              WHEN $2 = 'approved' THEN 'completed'
              ELSE 'cancelled'
            END,
            completed_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE completed_at END,
            cancelled_at = CASE WHEN $2 = 'rejected' THEN NOW() ELSE cancelled_at END,
            updated_at = NOW()
      WHERE id = $1`,
    [approval.task_id, decision]
  );

  return approval;
}

async function cancelTask(id) {
  const result = await db.query(
    `UPDATE ai_operational_agent_tasks
        SET status = 'cancelled',
            cancelled_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('draft', 'queued', 'running', 'waiting_approval')
      RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

async function getHealth() {
  const dbHealth = await db.healthCheck();
  const model = modelConfiguration();
  const budget = await getBudgetSettings();
  const spend = await currentSpend();
  const counts = await db.query(
    `SELECT status, COUNT(*)::int AS count
       FROM ai_operational_agent_tasks
      GROUP BY status`
  );
  const lastRun = await db.query(
    `SELECT id, title, selected_agent_id, status, error, created_at, updated_at, completed_at
       FROM ai_operational_agent_tasks
      ORDER BY updated_at DESC
      LIMIT 1`
  );

  const statusCounts = counts.rows.reduce((acc, row) => {
    acc[row.status] = Number(row.count || 0);
    return acc;
  }, {});

  return {
    runtimeOnline: process.env.AGENT_RUNTIME_DISABLED !== 'true',
    worker: {
      processRunning: workerState.running,
      intervalMs: workerState.intervalMs,
      busy: workerBusy,
      lastPollAt: workerState.lastPollAt,
      lastRunAt: workerState.lastRunAt,
      lastError: workerState.lastError,
    },
    queue: {
      type: 'postgres_db_queue',
      connected: dbHealth.healthy === true,
      pendingTaskCount: statusCounts.queued || 0,
      runningTaskCount: statusCounts.running || 0,
      waitingApprovalCount: statusCounts.waiting_approval || 0,
      failedTaskCount: statusCounts.failed || 0,
    },
    database: dbHealth,
    model,
    tools: {
      loaded: listTools().length,
      names: listTools().map((tool) => tool.name),
    },
    registry: {
      agents: AGENT_REGISTRY.length,
      activeAgents: AGENT_REGISTRY.filter((agent) => agent.active).length,
    },
    cost: {
      dailyCostUsd: Number(spend.daily_cost || 0),
      monthlyCostUsd: Number(spend.monthly_cost || 0),
      monthlyTokens: Number(spend.monthly_tokens || 0),
      dailyBudgetUsd: Number(budget.daily_budget_usd || 0),
      monthlyBudgetUsd: Number(budget.monthly_budget_usd || 0),
      monthlyBudgetRemainingUsd: Math.max(0, Number(budget.monthly_budget_usd || 0) - Number(spend.monthly_cost || 0)),
    },
    statusCounts,
    lastRun: lastRun.rows[0] || null,
  };
}

function startAgentWorker({ intervalMs = Number(process.env.AGENT_RUNTIME_POLL_INTERVAL_MS || 15000) } = {}) {
  if (process.env.AGENT_RUNTIME_DISABLED === 'true') {
    workerState.running = false;
    workerState.lastError = 'AGENT_RUNTIME_DISABLED=true';
    return workerState;
  }

  if (workerTimer) return workerState;

  workerState.running = true;
  workerState.intervalMs = intervalMs;
  workerTimer = setInterval(async () => {
    if (workerBusy) return;
    workerBusy = true;
    workerState.lastPollAt = new Date().toISOString();
    try {
      await runNextTask();
    } catch (error) {
      workerState.lastError = error.message;
    } finally {
      workerBusy = false;
    }
  }, intervalMs);

  if (workerTimer.unref) workerTimer.unref();
  return workerState;
}

function stopAgentWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerState.running = false;
  return workerState;
}

module.exports = {
  modelConfiguration,
  getBudgetSettings,
  updateBudgetSettings,
  createTask,
  listTasks,
  runNextTask,
  getTaskToolCalls,
  listApprovals,
  decideApproval,
  cancelTask,
  getHealth,
  startAgentWorker,
  stopAgentWorker,
  registry: AGENT_REGISTRY,
  tools: listTools,
};
