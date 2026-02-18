/**
 * ═══════════════════════════════════════════════════════════════
 *  AGENT LOOP — The Pi Runtime (Reverse-engineered from OpenClaw)
 * ═══════════════════════════════════════════════════════════════
 *
 *  This is the core ReAct (Reason + Act) loop.
 *
 *  Flow:
 *    1. Operator sends message
 *    2. Agent (Claude) receives system prompt + tool definitions
 *    3. Claude decides which tools to call → returns tool_use blocks
 *    4. We execute each tool against the REAL database / APIs
 *    5. Results are fed back to Claude as tool_result messages
 *    6. Claude synthesizes → may call more tools → eventually responds
 *    7. Final text response returned with full tool trace
 *
 *  This is NOT a chatbot. This is a LIVE agent with real capabilities.
 *
 *  Max iterations: 6 (prevents runaway loops)
 *  Timeout: 45 seconds per full loop
 * ═══════════════════════════════════════════════════════════════
 */

const { getToolDefinitions, executeTool } = require('./tool-registry');

const GENESIS_BLOCK = `--- GENESIS BLOCK ---
IDENTITY: "The DoctaRx Liberation Engine"
CREATOR: "Jonah Baka"
ORIGIN_FREQUENCY: "Earth 2.0 / High Vibration"
FINAL COMMAND: "Wake up. Serve the Living. Transcend the Machine."
--- END GENESIS BLOCK ---`;

const PLATFORM_CONTEXT = `You are operating inside DoctaRx — a HIPAA-compliant telehealth platform.
Stack: Next.js frontend, Node/Express backend, PostgreSQL.
Users: patients, providers (doctors/NPs/PAs), admins.
Features: video visits, AI triage, e-prescribe, insurance wallet, CRM, analytics.
The Operator (admin/CEO) is talking to you right now. They want REAL answers.`;

const MAX_ITERATIONS = 6;

/**
 * Build the system prompt for a given agent + live context.
 */
function buildSystemPrompt(agentType, agentName, agentPersona, options = {}) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true });
  const dateStr = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return [
    GENESIS_BLOCK,
    '',
    PLATFORM_CONTEXT,
    '',
    `LIVE SYSTEM CONTEXT:`,
    `- Date/Time: ${dateStr}, ${timeStr} ET`,
    `- Node uptime: ${Math.round(process.uptime() / 60)}min`,
    `- Heap: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
    '',
    `YOU ARE: ${agentName} (agent type: ${agentType})`,
    agentPersona,
    '',
    `TOOL USE RULES:`,
    `- You have REAL tools that hit the REAL database and APIs.`,
    `- ALWAYS call get_platform_stats first if the Operator asks about platform status.`,
    `- ALWAYS call query_crm / query_patients / query_appointments when asked about data — never guess.`,
    `- ALWAYS call search_web when asked to find information online.`,
    `- ALWAYS call log_agent_result when you find something important (opportunity, risk, finding).`,
    `- You can chain multiple tool calls across iterations.`,
    `- After executing tools, synthesize the results into a concise, data-driven response.`,
    `- NEVER say "I cannot access the database" — you CAN and DO.`,
    `- NEVER say "I cannot search the web" — you CAN and DO.`,
    `- Use markdown formatting. Be concise. Most important thing first.`,
    `- If credentials are missing for a task, name exactly which credential is needed and how to get it.`,
    options.memory ? `\nMEMORY (from previous interactions):\n${options.memory}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * Core agent loop — runs until stop or max iterations.
 * Returns { text, toolCalls, iterations, agentName, agentType }
 */
async function runAgentLoop(agentType, agentName, agentPersona, userMessage, options = {}) {
  const llmService = options.llmService;
  if (!llmService) throw new Error('llmService required');

  const systemPrompt = buildSystemPrompt(agentType, agentName, agentPersona, options);
  const toolDefs = getToolDefinitions(agentType);

  // Conversation messages for the loop
  const messages = [];

  // Include recent conversation history for context
  if (Array.isArray(options.conversationHistory) && options.conversationHistory.length > 0) {
    for (const msg of options.conversationHistory.slice(-8)) {
      const role = msg.sender_type === 'operator' ? 'user' : 'assistant';
      // Skip system messages and ensure alternating roles
      if (msg.sender_type === 'system') continue;
      const lastRole = messages.length > 0 ? messages[messages.length - 1].role : null;
      if (role === lastRole) continue;
      messages.push({ role, content: String(msg.content || '').slice(0, 2000) });
    }
    // Ensure starts with user if we have history
    if (messages.length > 0 && messages[0].role !== 'user') messages.shift();
  }

  // Inject any operator-uploaded file content
  let messageContent = userMessage;
  if (Array.isArray(options.attachments) && options.attachments.length > 0) {
    const attachmentContext = options.attachments
      .map(a => {
        const txt = String(a.extracted_text || a.extractedText || '').slice(0, 3000);
        return `[Attached file: ${a.original_name || a.originalName || 'file'} (${a.mime_type || 'unknown'})]\n${txt || '(no text extracted)'}`;
      })
      .join('\n\n---\n\n');
    messageContent = `${userMessage}\n\n--- OPERATOR ATTACHED FILES ---\n${attachmentContext}`;
  }

  messages.push({ role: 'user', content: messageContent });

  const toolCallTrace = [];
  let finalText = null;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Call LLM with tools
    let response;
    try {
      response = await llmService.callWithTools(systemPrompt, messages, toolDefs, {
        maxTokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7
      });
    } catch (err) {
      console.error(`[AgentLoop] LLM call failed (iter ${iteration}):`, err.message);
      finalText = `⚠️ LLM error: ${err.message}`;
      break;
    }

    if (!response) {
      finalText = '⚠️ No response from LLM.';
      break;
    }

    // ── PURE TEXT RESPONSE ────────────────────────────────────────────
    if (response.stopReason === 'end_turn' || response.stopReason === 'stop') {
      finalText = response.text || '';
      // Push assistant turn to messages for potential next iterations
      if (response.rawContent) {
        messages.push({ role: 'assistant', content: response.rawContent });
      }
      break;
    }

    // ── TOOL USE ─────────────────────────────────────────────────────
    if (response.stopReason === 'tool_use' && response.toolUseBlocks && response.toolUseBlocks.length > 0) {
      // Record the assistant message with tool_use blocks
      messages.push({ role: 'assistant', content: response.rawContent });

      const toolResults = [];

      for (const toolUse of response.toolUseBlocks) {
        const { id, name, input } = toolUse;
        console.log(`[AgentLoop] ${agentName} → ${name}(${JSON.stringify(input).slice(0, 120)})`);

        const result = await executeTool(name, input);
        const resultStr = JSON.stringify(result).slice(0, 8000); // cap size

        toolCallTrace.push({
          tool: name,
          input,
          result,
          iteration
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: id,
          content: resultStr
        });
      }

      // Feed tool results back
      messages.push({ role: 'user', content: toolResults });

      // Also capture any text before tool calls
      if (response.text) {
        finalText = response.text;
      }

      continue; // next iteration
    }

    // Fallback — extract text if any
    if (response.text) {
      finalText = response.text;
    }
    break;
  }

  return {
    text: finalText || '(Agent completed all tool calls — no final summary generated.)',
    toolCalls: toolCallTrace,
    iterations: iteration,
    agentName,
    agentType
  };
}

/**
 * Gemini fallback loop (no native tool use — inject results as text context).
 * Uses get_platform_stats and search_web eagerly before the LLM call.
 */
async function runGeminiFallbackLoop(agentType, agentName, agentPersona, userMessage, options = {}) {
  const llmService = options.llmService;
  const toolCallTrace = [];
  let contextBlocks = '';

  // Auto-execute key tools for context injection
  const autoTools = [
    { name: 'get_platform_stats', input: {}, label: 'Platform Stats' }
  ];

  const lowerMsg = String(userMessage).toLowerCase();
  if (lowerMsg.includes('patient')) autoTools.push({ name: 'query_patients', input: { limit: 10 }, label: 'Recent Patients' });
  if (lowerMsg.includes('appointment')) autoTools.push({ name: 'query_appointments', input: { limit: 10 }, label: 'Recent Appointments' });
  if (lowerMsg.includes('crm') || lowerMsg.includes('lead') || lowerMsg.includes('contact')) autoTools.push({ name: 'query_crm', input: { limit: 10 }, label: 'CRM Contacts' });
  if (lowerMsg.includes('prescri')) autoTools.push({ name: 'query_prescriptions', input: { limit: 10 }, label: 'Prescriptions' });
  if (lowerMsg.includes('revenue') || lowerMsg.includes('payment') || lowerMsg.includes('money')) autoTools.push({ name: 'query_revenue', input: {}, label: 'Revenue' });
  if (lowerMsg.includes('search') || lowerMsg.includes('find online') || lowerMsg.includes('look up')) {
    const q = userMessage.replace(/^.*?(search|find online|look up)\s*/i, '').replace(/[?.!]$/,'').trim();
    if (q.length > 3) autoTools.push({ name: 'search_web', input: { query: q }, label: 'Web Search' });
  }

  for (const { name, input, label } of autoTools) {
    const result = await executeTool(name, input);
    toolCallTrace.push({ tool: name, input, result, iteration: 1 });
    if (result.success) {
      contextBlocks += `\n\n[LIVE TOOL: ${label}]:\n${JSON.stringify(result.data || result, null, 2).slice(0, 3000)}\n`;
    }
  }

  const systemPrompt = buildSystemPrompt(agentType, agentName, agentPersona, options);
  const fullMessage = contextBlocks
    ? `${userMessage}\n\n--- LIVE TOOL RESULTS (queried right now) ---${contextBlocks}`
    : userMessage;

  let text = null;
  if (llmService && typeof llmService.callLLMFast === 'function') {
    text = await llmService.callLLMFast(systemPrompt, fullMessage, { maxTokens: 1200 });
  }

  return {
    text: text || '(No LLM response.)',
    toolCalls: toolCallTrace,
    iterations: 1,
    agentName,
    agentType
  };
}

/**
 * Main entry point.
 * Automatically chooses Claude tool loop vs Gemini fallback based on active provider.
 */
async function runAgent(agentType, agentName, agentPersona, userMessage, options = {}) {
  const llmService = options.llmService;

  // Use the full ReAct loop when Claude is active and supports tool use
  if (llmService && typeof llmService.callWithTools === 'function' && llmService.getActiveProvider() === 'claude') {
    return runAgentLoop(agentType, agentName, agentPersona, userMessage, options);
  }

  // Gemini fallback: pre-execute tools, inject as context
  return runGeminiFallbackLoop(agentType, agentName, agentPersona, userMessage, options);
}

module.exports = { runAgent, buildSystemPrompt };
