'use strict';

const { scopeError } = require('./programmeScopeService');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ALLOWED_NON_PRODUCTION_ENVS = new Set(['development', 'test']);

function assertDemoGroqPermitted(context, env = process.env) {
  if (context?.demo_only !== true
    || !ALLOWED_NON_PRODUCTION_ENVS.has(env.NODE_ENV)
    || env.CLINICAL_AI_ALLOW_DEMO_GROQ !== 'true') {
    throw scopeError(
      503,
      'Groq inference is restricted to explicitly enabled, non-production synthetic demos.',
      'CLINICAL_AI_GROQ_DEMO_ONLY'
    );
  }
}

async function requestGroqDraft(
  { context, model, systemPrompt, userPrompt },
  { env = process.env, fetchImpl = globalThis.fetch } = {}
) {
  // A provider key, model and opt-in are independent deployment settings.
  // Never forward clinical records through this free-tier development adapter.
  assertDemoGroqPermitted(context, env);
  if (!env.GROQ_API_KEY || !model || !/^[a-zA-Z0-9_.:/-]{1,120}$/.test(model)) {
    throw scopeError(503, 'Clinical AI Groq credentials or model are not configured.', 'CLINICAL_AI_PROVIDER_UNAVAILABLE');
  }
  if (typeof fetchImpl !== 'function') {
    throw scopeError(503, 'Clinical AI HTTP transport is unavailable.', 'CLINICAL_AI_PROVIDER_UNAVAILABLE');
  }

  let response;
  try {
    response = await fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GROQ_API_KEY,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: 1800,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
  } catch {
    // Do not propagate provider errors that could include private payloads.
    throw scopeError(502, 'Clinical AI model provider request failed.', 'CLINICAL_AI_PROVIDER_ERROR');
  }
  if (!response?.ok) {
    throw scopeError(502, 'Clinical AI model provider request failed.', 'CLINICAL_AI_PROVIDER_ERROR');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw scopeError(502, 'Clinical AI model provider returned invalid JSON.', 'CLINICAL_AI_PROVIDER_ERROR');
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw scopeError(502, 'Clinical AI model provider returned no draft.', 'CLINICAL_AI_PROVIDER_ERROR');
  }

  return {
    text,
    provider: 'groq',
    model,
    modelVersion: String(payload.model || model).slice(0, 120),
  };
}

module.exports = { assertDemoGroqPermitted, requestGroqDraft };
