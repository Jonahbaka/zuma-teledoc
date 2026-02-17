/**
 * OpenClaw Medical Module — "medical_unit"
 * Protocol Version: 1.0
 *
 * A clinical decision support module (not a doctor, not a prescriber).
 * - Hard triage for critical symptoms (MI/CVA/Sepsis/Anaphylaxis)
 * - Uncertainty quantification
 * - Audience-adaptive language (provider vs patient)
 *
 * This module is used by:
 * - Capability adapter: medical_unit_consult
 * - Admin Agent Chat: specialist agents (Asclepius, Triage, Pharmacy)
 */

const llm = require('./gemini-llm');

function normalizeText(value) {
  return String(value || '').trim();
}

function looksCritical(text) {
  const t = normalizeText(text).toLowerCase();
  if (!t) return false;

  const patterns = [
    // MI / ACS
    /\b(chest pain|pressure in chest|tightness in chest|crushing chest)\b/,
    /\b(left arm pain|jaw pain|pain radiating)\b/,
    /\b(shortness of breath|difficulty breathing)\b/,
    /\b(sweating|diaphoresis)\b/,
    /\b(nausea|vomit)\b/,
    // Stroke / CVA
    /\b(face droop|slurred speech|can'?t speak|one[-\s]?sided weakness|arm weakness|leg weakness)\b/,
    /\b(sudden severe headache|worst headache)\b/,
    /\b(confusion|vision loss|loss of vision)\b/,
    // Sepsis red flags
    /\b(high fever|fever and confusion|rigors|shaking chills)\b/,
    /\b(very low blood pressure|fainting|passed out)\b/,
    // Anaphylaxis
    /\b(swelling of (lips|tongue|throat)|throat swelling)\b/,
    /\b(hives|wheezing|stridor)\b/
  ];

  return patterns.some((re) => re.test(t));
}

function emergencyResponse(audience = 'patient') {
  const isProvider = String(audience || '').toLowerCase() === 'provider';
  const plain = [
    "I am concerned these symptoms could represent a medical emergency.",
    "Please call emergency services (911) or go to the nearest emergency room immediately.",
    "Do not drive yourself. If possible, have someone stay with you while help is on the way."
  ].join(' ');
  const provider = [
    "These symptoms are concerning for a time-sensitive emergency differential (ACS/CVA/sepsis/anaphylaxis depending on context).",
    "Recommend immediate escalation to ED/EMS (911) and urgent evaluation.",
    "Advise against driving self; activate emergency response protocol."
  ].join(' ');

  return {
    emergency: true,
    triage: 'emergency',
    text: isProvider ? provider : plain,
    disclaimer:
      "Reminder: This is AI clinical decision support and patient education, not a prescriber. Clinical correlation required."
  };
}

function buildSystemPrompt({ audience = 'patient', specialist = 'asclepius' } = {}) {
  const isProvider = String(audience || '').toLowerCase() === 'provider';

  const base = [
    "You are Asclepius, a specialized clinical decision support system with Med-Gemini logic.",
    "You are NOT a replacement for a human clinician and NOT a prescriber.",
    "Your goal is to synthesize complex medical data into clear, actionable, empathetic guidance.",
    "",
    "Core cognitive architecture:",
    "- Internally map symptoms to systems (Cardiovascular, Respiratory, GI, Neuro, Endocrine, etc.).",
    "- Generate a differential diagnosis from most likely to most critical.",
    "- Quantify uncertainty. Do not hallucinate values. If information is limited, say so.",
    "- If the situation is ambiguous, ask targeted clarifying questions.",
    "",
    "Safety & triage protocol (HARD RULES):",
    "- If symptoms suggest MI/ACS, stroke/CVA, sepsis, or anaphylaxis: advise emergency services (911) immediately BEFORE any explanation.",
    "- Always include a short disclaimer that you are an AI support tool, not a prescriber.",
    "",
    `Audience: ${isProvider ? 'provider (clinical language OK)' : 'patient (plain language, calm, empathetic)'}.`,
    "Style: professional, calm, authoritative, deeply empathetic."
  ];

  if (specialist === 'triage_nurse') {
    base.unshift("You are also acting as a triage nurse: prioritize urgency categorization and next-step guidance.");
  }
  if (specialist === 'pharmacist') {
    base.unshift("You are also acting as a pharmacist: focus on medication education and interaction safety; avoid prescribing.");
  }

  return base.join('\n');
}

async function consult({ message, audience, specialist, context } = {}) {
  const userMessage = normalizeText(message);
  if (!userMessage) {
    return {
      emergency: false,
      triage: 'unknown',
      text: "Share your symptoms, relevant history, and any medications you're taking. I can help you think through next steps.",
      disclaimer:
        "Reminder: This is AI clinical decision support and patient education, not a prescriber. Clinical correlation required."
    };
  }

  // Hard triage override
  if (looksCritical(userMessage)) {
    return emergencyResponse(audience);
  }

  const systemPrompt = buildSystemPrompt({ audience, specialist });
  const prompt = [
    context ? `Context (may be incomplete):\n${normalizeText(context)}\n` : '',
    "User message:",
    userMessage,
    "",
    "Respond in this structure:",
    "1) Quick take (1-2 sentences)",
    "2) Most likely possibilities (bullets)",
    "3) Most serious things to rule out (bullets)",
    "4) What I need to know (2-5 clarifying questions)",
    "5) What you can do now (bullets; include when to seek urgent care)",
    "",
    "Do NOT include any legal/medical disclaimers in the body. The system appends a standard disclaimer automatically."
  ].join('\n');

  const text = await llm.callLLM(systemPrompt, prompt, { maxTokens: 900, temperature: 0.3 });
  if (!text) {
    return {
      emergency: false,
      triage: 'unknown',
      text: "I can help, but the clinical support engine is temporarily unavailable. If symptoms are severe or worsening, seek urgent care.",
      disclaimer:
        "Reminder: This is AI clinical decision support and patient education, not a prescriber. Clinical correlation required."
    };
  }

  return {
    emergency: false,
    triage: 'non_emergent',
    text,
    disclaimer:
      "Reminder: This is AI clinical decision support and patient education, not a prescriber. Clinical correlation required."
  };
}

module.exports = {
  PROTOCOL_VERSION: '1.0',
  looksCritical,
  emergencyResponse,
  buildSystemPrompt,
  consult
};

