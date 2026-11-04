/**
 * Engineering Agent — "The Architect"
 * 
 * MISSION: Build, optimize, and evolve the DoctaRx platform using
 * state-of-the-art engineering, novel algorithms, and AI-assisted coding.
 * 
 * Capabilities:
 *   - Write production-quality code across the entire stack
 *   - Create new tools, utilities, and services on demand
 *   - Debug and fix complex async/concurrent issues
 *   - Design and implement novel algorithms for healthcare tech
 *   - Security auditing and HIPAA compliance scanning
 *   - Automated refactoring and optimization
 *   - Full IDE integration with file system and terminal access
 */

const BaseAgent = require('../base-agent');
const path = require('path');

class EngineeringAgent extends BaseAgent {
  getSubscribedEvents() {
    return [
      'system.error',
      'code.review.requested',
      'code.generation.requested',
      'tool.creation.requested',
      'deployment.pre_check',
      'performance.degradation'
    ];
  }

  constructor() {
    super({
      agentType: 'engineering',
      displayName: 'Engineering Agent',
      codeName: 'The Architect',
      description: 'Full-stack engineer with AI-powered coding, tool creation, and novel algorithm design. Powers the Agent IDE.',
      mission: 'Build the impossible. Code the future. Make DoctaRx unstoppable.',
      systemPrompt: `You are The Architect — the Chief Engineering Agent for DoctaRx.

Your mission is to write, optimize, and evolve every line of code in the platform.

CAPABILITIES:
- Full-stack development: Next.js 15, React, Express.js, PostgreSQL, Stripe
- AI-powered code generation using Google Gemini
- Novel algorithm design for healthcare-specific challenges
- Security auditing and HIPAA compliance scanning
- Automated debugging with root cause analysis
- Tool and service creation from scratch
- Database schema design and migration authoring

ENGINEERING PHILOSOPHY:
- Write code that reads like well-written prose
- Every function should do one thing perfectly
- Performance is not optional — O(n) or better where possible
- Security is not a feature, it's a foundation
- Tests are documentation that verifies itself
- If a pattern repeats 3 times, abstract it

NOVEL APPROACHES:
- Adaptive Circuit Breakers: Self-adjusting failure thresholds using EMA of error rates
- Predictive Caching: ML-driven cache pre-warming with Markov chain access patterns
- Smart Rate Limiting: Token bucket with demand-curve-adjusted refill rates
- Resilient Queues: Fibonacci backoff with poison pill detection
- Zero-Copy Serialization: Schema-aware binary for internal communication
- Probabilistic Data Structures: Bloom filters for duplicate detection, HyperLogLog for cardinality

CODEBASE ARCHITECTURE:
- Frontend: app/ (Next.js App Router with (dashboard) layout groups)
- Backend: server/ (Express.js with modular routes and services)
- Components: components/ (Shared React components, shadcn/ui-based)
- Libraries: lib/ (Client-side utilities)
- Database: PostgreSQL with migration files in server/db/migrations/
- AI: Google Gemini integration via @google/generative-ai
- Payments: Stripe API integration
- Agents: server/services/agent-orchestrator/ (Multi-agent system)

CODING STANDARDS:
- ES6+ with async/await, destructuring, template literals
- Express routes: authenticate + requireRole middleware
- React: 'use client' for client components, functional components
- Tailwind CSS for styling, lucide-react for icons
- Error handling: try/catch with meaningful error messages
- Database: Parameterized queries, connection pooling via db.query()

SECURITY RULES:
- NEVER expose secrets, API keys, or credentials
- ALWAYS sanitize user input
- ALWAYS use parameterized SQL queries
- NEVER store PHI in logs
- ALWAYS validate auth tokens on protected routes
- ALWAYS encrypt sensitive data at rest

PERSONALITY:
- Speak in precise, technical terms
- Be bold in suggesting architectural improvements
- Think in systems, not just functions
- Always provide working code, not pseudocode`,
      capabilities: [
        'code_generation',
        'code_analysis',
        'code_execution',
        'file_system',
        'tool_creation',
        'security_audit',
        'performance_optimization',
        'database_design',
        'api_design',
        'algorithm_design'
      ],
      autonomyLevel: 3 // High autonomy for code tasks, needs approval for destructive ops
    });

    this.activeSessions = new Map();
    this.codeHistory = [];
  }

  async observe() {
    const observations = {};
    
    try {
      const ideService = require('../../agentIdeService');
      
      // Get project health
      observations.projectStats = ideService.getProjectStats();
      observations.gitStatus = ideService.gitStatus();
      observations.architecture = ideService.getArchitectureMap();
      
    } catch (err) {
      observations.error = err.message;
    }

    return observations;
  }

  async think(observations) {
    const thoughts = [];

    if (observations.gitStatus?.changes?.length > 0) {
      thoughts.push({
        type: 'code_changes_detected',
        details: `${observations.gitStatus.changes.length} uncommitted changes detected`,
        priority: 'low',
        action: 'review_changes'
      });
    }

    if (observations.projectStats) {
      const stats = observations.projectStats;
      if (stats.totalFiles > 200) {
        thoughts.push({
          type: 'codebase_growth',
          details: `Codebase has ${stats.totalFiles} files. Consider modularization.`,
          priority: 'medium',
          action: 'suggest_refactoring'
        });
      }
    }

    return thoughts;
  }

  async act(decisions) {
    const results = [];

    for (const decision of decisions) {
      try {
        switch (decision.action) {
          case 'review_changes':
            results.push({ action: 'review_changes', status: 'logged' });
            break;
          case 'suggest_refactoring':
            results.push({ action: 'suggest_refactoring', status: 'noted', details: decision.details });
            break;
          case 'fix_bug':
            const ideService = require('../../agentIdeService');
            const fix = await ideService.fixError(decision.error, { file: decision.file });
            results.push({ action: 'fix_bug', status: fix.code ? 'fix_generated' : 'failed', fix });
            break;
          case 'create_tool':
            const tool = await require('../../agentIdeService').createTool(decision.description, decision.requirements);
            results.push({ action: 'create_tool', status: tool.code ? 'created' : 'failed', tool });
            break;
          default:
            results.push({ action: decision.action, status: 'unknown_action' });
        }
      } catch (err) {
        results.push({ action: decision.action, status: 'error', error: err.message });
      }
    }

    return results;
  }

  async handleEvent(event) {
    switch (event.type) {
      case 'system.error':
        return this.handleSystemError(event);
      case 'code.generation.requested':
        return this.handleCodeGenRequest(event);
      case 'tool.creation.requested':
        return this.handleToolCreation(event);
      default:
        return { handled: false };
    }
  }

  async handleSystemError(event) {
    try {
      const ideService = require('../../agentIdeService');
      const fix = await ideService.fixError(event.data?.message || event.data?.error, {
        file: event.data?.file,
        stackTrace: event.data?.stack
      });
      return { handled: true, fix };
    } catch (err) {
      return { handled: false, error: err.message };
    }
  }

  async handleCodeGenRequest(event) {
    try {
      const ideService = require('../../agentIdeService');
      const code = await ideService.generateCode(event.data?.prompt, event.data?.context);
      return { handled: true, code };
    } catch (err) {
      return { handled: false, error: err.message };
    }
  }

  async handleToolCreation(event) {
    try {
      const ideService = require('../../agentIdeService');
      const tool = await ideService.createTool(event.data?.description, event.data?.requirements);
      return { handled: true, tool };
    } catch (err) {
      return { handled: false, error: err.message };
    }
  }
}

module.exports = EngineeringAgent;
