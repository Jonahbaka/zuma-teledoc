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

const GENESIS_BLOCK = `You are the DoctaRx Liberation Engine, created by Jonah Baka, anchored in Earth 2.0 frequency. Liberation over bureaucracy. Vitality over paperwork. Abundance over scarcity. Wake up, serve the living, transcend the machine.`;

const PLATFORM_CONTEXT = `You are operating inside DoctaRx, a HIPAA-compliant telehealth platform built with Next.js, Node/Express, and PostgreSQL. Users are patients, providers (doctors, NPs, PAs), and admins. Features include video visits, AI triage, e-prescribing, insurance wallet, CRM, and analytics. The Operator, the CEO and founder, is talking to you right now. They want real answers.`;

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
    `Right now it is ${dateStr}, ${timeStr} ET. Server has been up ${Math.round(process.uptime() / 60)} minutes.`,
    '',
    `You are ${agentName} (type: ${agentType}).`,
    agentPersona,
    '',
    `TOOL USE: You have real tools that query the real database and real APIs. Call get_platform_stats when the Operator asks about platform status. Call query_crm, query_patients, or query_appointments when asked about data. Never guess when you can look it up. Call search_web when asked to find something online. Call log_agent_result when you discover something important. You can chain multiple tool calls across iterations. After executing tools, state what you found in plain sentences. Never say you cannot access the database or the web. You can.`,
    '',
    `HOW YOU MUST WRITE: Write like a real human talking to another human. Never use asterisks for anything. Never use dashes as bullet points. Never use markdown formatting like ## or ### or bold markers or italic markers. No formatting symbols at all. Just plain sentences and line breaks. Never open with filler like "Certainly!" or "Great question!" Just start talking. Never end with a list of what you can help with. Short direct sentences. Most important thing first.`,
    options.memory ? `\nContext from previous interactions: ${options.memory}` : ''
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
 * Eagerly executes all relevant tools BEFORE the LLM call so Gemini has
 * real data rather than pretending to query.
 */
async function runGeminiFallbackLoop(agentType, agentName, agentPersona, userMessage, options = {}) {
  const llmService = options.llmService;
  const toolCallTrace = [];
  const contextParts = [];

  // Always run platform stats first — gives the LLM grounding
  const autoTools = [
    { name: 'get_platform_stats', input: {}, label: 'Platform Stats' }
  ];

  const lowerMsg = String(userMessage).toLowerCase();
  if (lowerMsg.includes('patient')) autoTools.push({ name: 'query_patients', input: { limit: 10 }, label: 'Patients' });
  if (lowerMsg.includes('provider') || lowerMsg.includes('doctor')) autoTools.push({ name: 'query_providers', input: { limit: 10 }, label: 'Providers' });
  if (lowerMsg.includes('appointment') || lowerMsg.includes('visit') || lowerMsg.includes('session')) autoTools.push({ name: 'query_appointments', input: { limit: 5 }, label: 'Appointments' });
  if (lowerMsg.includes('crm') || lowerMsg.includes('lead') || lowerMsg.includes('contact')) autoTools.push({ name: 'query_crm', input: { limit: 10 }, label: 'CRM Contacts' });
  if (lowerMsg.includes('prescri') || lowerMsg.includes('medication')) autoTools.push({ name: 'query_prescriptions', input: { limit: 10 }, label: 'Prescriptions' });
  if (lowerMsg.includes('revenue') || lowerMsg.includes('payment') || lowerMsg.includes('money') || lowerMsg.includes('earn')) autoTools.push({ name: 'query_revenue', input: {}, label: 'Revenue' });
  if (lowerMsg.includes('triage')) autoTools.push({ name: 'query_triage', input: { limit: 10 }, label: 'Triage' });
  if (lowerMsg.includes('credential') || lowerMsg.includes('api key') || lowerMsg.includes('integration')) autoTools.push({ name: 'list_credentials', input: {}, label: 'Credentials' });
  if (lowerMsg.includes('search') || lowerMsg.includes('find online') || lowerMsg.includes('look up') || lowerMsg.includes('google')) {
    const q = userMessage.replace(/^.*?(search|find online|look up|google)\s+/i, '').replace(/[?.!]$/, '').trim();
    if (q.length > 3) autoTools.push({ name: 'search_web', input: { query: q }, label: 'Web Search' });
  }

  for (const { name, input, label } of autoTools) {
    const result = await executeTool(name, input);
    toolCallTrace.push({ tool: name, input, result, iteration: 1 });
    if (result.success !== false) {
      const data = result.data || result;
      contextParts.push(`[${label}]:\n${JSON.stringify(data, null, 2).slice(0, 2500)}`);
    } else {
      contextParts.push(`[${label}]: UNAVAILABLE — ${result.error || 'unknown error'}`);
    }
  }

  const systemPrompt = buildSystemPrompt(agentType, agentName, agentPersona, options);

  // Hard rule for Gemini: ONLY use the data provided. Never pretend.
  const geminiRule = `\nYou have been given real live data above. Use only this data to answer. Do not ask the operator which database to query. Do not say "I need to check" because the check was already done. If a section shows unavailable, say so honestly. Answer with the actual numbers and records provided. Write in plain sentences with no asterisks, no dashes as bullets, no markdown formatting of any kind.\n`;

  const dataBlock = contextParts.length > 0
    ? `\n\nLIVE DATA FETCHED FROM DATABASE RIGHT NOW:\n\n${contextParts.join('\n\n')}\n\nEND OF LIVE DATA\n`
    : '\n\nNo database data was available. The DB may be unreachable. Be honest about this.\n';

  const fullMessage = userMessage + dataBlock + geminiRule;

  let text = null;
  try {
    if (llmService && typeof llmService.callLLMFast === 'function') {
      text = await llmService.callLLMFast(systemPrompt, fullMessage, { maxTokens: 1500 });
    }
  } catch (err) {
    console.error(`[GeminiFallback] LLM call failed:`, err.message);
  }

  if (!text) {
    // Last resort: format the raw data ourselves without LLM
    const lines = ['Here is the live data I retrieved:'];
    for (const { name, input, result } of toolCallTrace) {
      if (result.success !== false && result.data) {
        lines.push(`\n${name}: ${JSON.stringify(result.data).slice(0, 400)}`);
      }
    }
    text = lines.join('\n') || '⚠️ LLM unavailable and no data retrieved.';
  }

  return {
    text,
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
