const AGENT_REGISTRY = [
  {
    id: 'router',
    name: 'Router Agent',
    description: 'Classifies admin tasks and routes them to a narrow specialist worker.',
    role: 'router',
    allowedTools: ['classifyTask'],
    allowedActions: ['route_task'],
    modelChoice: process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
    maxTokenBudget: 400,
    maxToolCalls: 1,
    riskLevel: 'low',
    requiresApprovalForMutations: true,
    active: true,
  },
  {
    id: 'qa_anti_vaporware',
    name: 'QA Anti-Vaporware Agent',
    description: 'Finds missing routes, dead CTAs, placeholder flows, and disconnected UI.',
    role: 'quality_assurance',
    allowedTools: ['scanRoutes', 'checkMissingLoginRoutes'],
    allowedActions: ['create_review_item'],
    modelChoice: process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
    maxTokenBudget: 900,
    maxToolCalls: 4,
    riskLevel: 'low',
    requiresApprovalForMutations: true,
    active: true,
  },
  {
    id: 'pharmacy_onboarding',
    name: 'Pharmacy Onboarding Agent',
    description: 'Reviews pharmacy onboarding completeness and prepares approval checklists.',
    role: 'pharmacy_operations',
    allowedTools: ['getPendingPharmacyOnboardings', 'prepareWhatsAppMessage'],
    allowedActions: ['recommend_pharmacy_review'],
    modelChoice: process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
    maxTokenBudget: 800,
    maxToolCalls: 4,
    riskLevel: 'medium',
    requiresApprovalForMutations: true,
    active: true,
  },
  {
    id: 'provider_trial_revenue',
    name: 'Provider Trial/Revenue Agent',
    description: 'Tracks provider trials, expired access, usage, and subscription follow-up.',
    role: 'revenue_operations',
    allowedTools: ['getProviderUsage', 'getExpiredProviderTrials'],
    allowedActions: ['recommend_subscription_notice'],
    modelChoice: process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
    maxTokenBudget: 800,
    maxToolCalls: 4,
    riskLevel: 'medium',
    requiresApprovalForMutations: true,
    active: true,
  },
  {
    id: 'whatsapp_operations',
    name: 'WhatsApp Operations Agent',
    description: 'Prepares safe WhatsApp messages and manual fallback records.',
    role: 'communications_operations',
    allowedTools: ['prepareWhatsAppMessage', 'getWhatsAppNotificationStatus'],
    allowedActions: ['prepare_message_only'],
    modelChoice: process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
    maxTokenBudget: 500,
    maxToolCalls: 3,
    riskLevel: 'medium',
    requiresApprovalForMutations: true,
    active: true,
  },
  {
    id: 'admin_test_account',
    name: 'Admin Test Account Agent',
    description: 'Verifies test account visibility, filters, routing, and must-change-password setup.',
    role: 'admin_operations',
    allowedTools: ['verifyTestAccountVisibility'],
    allowedActions: ['recommend_test_account_fix'],
    modelChoice: process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
    maxTokenBudget: 700,
    maxToolCalls: 3,
    riskLevel: 'medium',
    requiresApprovalForMutations: true,
    active: true,
  },
  {
    id: 'growth_partnership',
    name: 'Growth/Partnership Drafting Agent',
    description: 'Drafts hospital, pharmacy, and organisation partnership messages for review.',
    role: 'growth_operations',
    allowedTools: ['draftPartnershipMessage'],
    allowedActions: ['draft_only'],
    modelChoice: process.env.AGENT_MODEL_FAST || process.env.GEMINI_FLASH_MODEL || 'gemini-2.0-flash',
    maxTokenBudget: 900,
    maxToolCalls: 2,
    riskLevel: 'low',
    requiresApprovalForMutations: true,
    active: true,
  },
  {
    id: 'compliance_review',
    name: 'Compliance Review Agent',
    description: 'Reviews sensitive healthcare, account, prescription, and notification workflows.',
    role: 'compliance',
    allowedTools: ['scanRoutes'],
    allowedActions: ['create_review_item'],
    modelChoice: process.env.AGENT_MODEL_STRONG || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    maxTokenBudget: 1600,
    maxToolCalls: 4,
    riskLevel: 'high',
    requiresApprovalForMutations: true,
    active: true,
  },
];

function getAgentById(id) {
  return AGENT_REGISTRY.find((agent) => agent.id === id) || null;
}

function classifyTask(input = {}) {
  const text = `${input.taskType || ''} ${input.title || ''} ${input.prompt || ''}`.toLowerCase();

  if (text.includes('test account') || text.includes('mustchangepassword') || text.includes('must change password')) {
    return getAgentById('admin_test_account');
  }
  if (text.includes('pharmacy') || text.includes('prescription receiving') || text.includes('onboarding')) {
    return getAgentById('pharmacy_onboarding');
  }
  if (text.includes('trial') || text.includes('subscription') || text.includes('provider usage') || text.includes('revenue')) {
    return getAgentById('provider_trial_revenue');
  }
  if (text.includes('whatsapp') || text.includes('message')) {
    return getAgentById('whatsapp_operations');
  }
  if (text.includes('outreach') || text.includes('partnership') || text.includes('hospital') || text.includes('organization')) {
    return getAgentById('growth_partnership');
  }
  if (text.includes('compliance') || text.includes('privacy') || text.includes('prescription') || text.includes('phi')) {
    return getAgentById('compliance_review');
  }
  if (text.includes('route') || text.includes('cta') || text.includes('login') || text.includes('vaporware') || text.includes('qa')) {
    return getAgentById('qa_anti_vaporware');
  }

  return getAgentById('qa_anti_vaporware');
}

module.exports = {
  AGENT_REGISTRY,
  getAgentById,
  classifyTask,
};
