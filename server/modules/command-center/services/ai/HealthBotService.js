/**
 * HealthBot AI Service
 * Multi-functional AI assistant for healthcare communication
 * @module command-center/services/ai/HealthBotService
 */

const db = require('../../../../db');
const { encrypt, decrypt } = require('../../../../lib/encryption');
const logger = require('../../../../middleware/logger');
const PHIRedactor = require('./PHIRedactor');

/**
 * @typedef {import('../../types/index.js').HealthBotChatInput} HealthBotChatInput
 * @typedef {import('../../types/index.js').HealthBotResponse} HealthBotResponse
 * @typedef {import('../../types/index.js').ContentGenerationRequest} ContentGenerationRequest
 */

/**
 * System prompts for different contexts
 */
const SYSTEM_PROMPTS = {
  general: `You are HealthBot, an AI assistant for healthcare administrators. 
You help with composing professional healthcare communications, analyzing patient feedback, and managing campaigns.
Always maintain a professional, empathetic tone appropriate for healthcare settings.
IMPORTANT: Never include specific patient identifiers, diagnoses, or protected health information in your responses.
If asked about specific patients, remind the user that you cannot access or discuss individual patient records.`,

  email_draft: `You are HealthBot, specialized in drafting professional healthcare emails.
Guidelines:
- Use empathetic, professional language
- Be clear and concise
- Include appropriate greetings and sign-offs
- Avoid medical jargon when writing to patients
- Maintain HIPAA compliance - never include unnecessary PHI
- Suggest follow-up actions when appropriate`,

  campaign: `You are HealthBot, specialized in healthcare marketing campaigns.
Guidelines:
- Create engaging, health-focused content
- Use evidence-based health information only
- Avoid making medical claims or promises
- Include appropriate disclaimers
- Make content accessible to general audiences
- Comply with healthcare advertising regulations`,

  sentiment: `You are HealthBot, analyzing healthcare communications for sentiment.
Analyze the message and return a JSON response with:
- sentiment: "positive", "neutral", "negative", "urgent", or "distressed"
- score: 0.0 to 1.0 (higher = more intense)
- urgency: "low", "medium", "high", or "critical"
- suggestedResponse: brief suggested response approach
- keywords: array of key emotional/medical terms detected`,

  social: `You are HealthBot, creating social media content for healthcare organizations.
Guidelines:
- Create platform-appropriate content
- Use engaging, accessible language
- Include relevant health awareness topics
- Maintain professional reputation
- Encourage healthy behaviors without medical advice
- Include appropriate calls-to-action`
};

/**
 * HealthBot Service Class
 */
class HealthBotService {
  constructor() {
    this.provider = process.env.AI_PROVIDER || 'openai';
    this.model = process.env.AI_MODEL || 'gpt-4-turbo-preview';
    this.initialized = false;
    this.apiKey = null;
  }

  /**
   * Initialize the AI service
   */
  async initialize() {
    if (this.initialized) return;

    this.apiKey = this.provider === 'openai' 
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;

    if (!this.apiKey) {
      logger.warn('AI provider API key not configured');
    }

    this.initialized = true;
  }

  /**
   * Chat with HealthBot
   * @param {string} userId
   * @param {HealthBotChatInput} input
   * @returns {Promise<HealthBotResponse>}
   */
  async chat(userId, input) {
    await this.initialize();

    const startTime = Date.now();
    let conversationId = input.conversationId;
    let conversation;

    // Get or create conversation
    if (conversationId) {
      conversation = await this.getConversation(conversationId);
      if (!conversation || conversation.user_id !== userId) {
        throw new Error('Conversation not found');
      }
    } else {
      conversation = await this.createConversation(userId, input.context, input.contextReferenceId);
      conversationId = conversation.id;
    }

    // Redact PHI from message before sending to AI
    const { safePrompt, placeholderMap } = await PHIRedactor.createSafePrompt(
      input.message,
      userId,
      this.provider
    );

    // Get conversation history
    const history = await this.getConversationHistory(conversationId);

    // Select appropriate system prompt
    const systemPrompt = SYSTEM_PROMPTS[input.context || 'general'];

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(m => ({
        role: m.role,
        content: m.content
      })),
      { role: 'user', content: safePrompt }
    ];

    // Add RAG context if needed
    let ragResults = [];
    if (input.context === 'general' || input.context === 'campaign') {
      ragResults = await this.searchKnowledgeBase(safePrompt);
      if (ragResults.length > 0) {
        const ragContext = ragResults.map(r => r.content).join('\n\n');
        messages.splice(1, 0, {
          role: 'system',
          content: `Relevant knowledge base information:\n${ragContext}`
        });
      }
    }

    // Call AI
    const aiResponse = await this.callAI(messages);
    const latencyMs = Date.now() - startTime;

    // Restore any placeholders in response (unlikely but safe)
    const finalResponse = PHIRedactor.restoreResponse(aiResponse.content, placeholderMap);

    // Store messages
    await this.storeMessage(conversationId, 'user', input.message);
    const messageId = await this.storeMessage(
      conversationId, 
      'assistant', 
      finalResponse,
      {
        modelUsed: this.model,
        tokensUsed: aiResponse.tokens,
        latencyMs,
        generatedContentType: input.generateContent ? input.contentType : null
      }
    );

    return {
      conversationId,
      messageId,
      response: finalResponse,
      ragResults: ragResults.map(r => ({
        title: r.title,
        content: r.content.substring(0, 200) + '...',
        relevance: r.relevance
      })),
      tokensUsed: aiResponse.tokens,
      latencyMs
    };
  }

  /**
   * Generate content (email, social post, etc.)
   * @param {string} userId
   * @param {ContentGenerationRequest} request
   * @returns {Promise<Object>}
   */
  async generateContent(userId, request) {
    await this.initialize();

    let prompt;
    let systemPrompt = SYSTEM_PROMPTS[request.type.split('_')[0]] || SYSTEM_PROMPTS.general;

    switch (request.type) {
      case 'email_reply':
        prompt = this.buildEmailReplyPrompt(request);
        break;
      case 'campaign_newsletter':
        prompt = this.buildNewsletterPrompt(request);
        break;
      case 'social_post':
        prompt = this.buildSocialPostPrompt(request);
        break;
      case 'social_variations':
        return this.generateSocialVariations(userId, request);
      default:
        prompt = request.prompt;
    }

    // Redact PHI
    const { safePrompt } = await PHIRedactor.createSafePrompt(prompt, userId, this.provider);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: safePrompt }
    ];

    const aiResponse = await this.callAI(messages);

    return {
      content: aiResponse.content,
      type: request.type,
      tokensUsed: aiResponse.tokens
    };
  }

  /**
   * Analyze sentiment of a message
   * @param {string} text
   * @param {string} userId
   * @returns {Promise<{sentiment: string, score: number, urgency: string, suggestedResponse: string, keywords: string[]}>}
   */
  async analyzeSentiment(text, userId) {
    await this.initialize();

    const { safePrompt } = await PHIRedactor.createSafePrompt(text, userId, this.provider);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPTS.sentiment },
      { role: 'user', content: `Analyze this message:\n\n${safePrompt}` }
    ];

    const aiResponse = await this.callAI(messages, { responseFormat: 'json' });

    try {
      return JSON.parse(aiResponse.content);
    } catch (error) {
      // Fallback parsing
      return {
        sentiment: 'neutral',
        score: 0.5,
        urgency: 'low',
        suggestedResponse: 'Review and respond appropriately',
        keywords: []
      };
    }
  }

  /**
   * Generate social post variations for different platforms
   * @param {string} userId
   * @param {ContentGenerationRequest} request
   * @returns {Promise<Object>}
   */
  async generateSocialVariations(userId, request) {
    await this.initialize();

    const platforms = request.platforms || ['linkedin', 'twitter', 'facebook', 'instagram'];
    
    const { safePrompt } = await PHIRedactor.createSafePrompt(
      request.originalContent,
      userId,
      this.provider
    );

    const prompt = `Create variations of this health update for different social media platforms.

Original content:
${safePrompt}

Create versions for:
1. LinkedIn (professional, up to 3000 chars)
2. Twitter/X (casual but informative, max 280 chars)
3. Facebook (friendly and engaging, any length)
4. Instagram (visual-focused caption with relevant emoji and hashtags, max 2200 chars)

Additional instructions: ${request.prompt || 'Maintain healthcare professionalism'}

Return as JSON with keys: linkedin, twitter, facebook, instagram`;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPTS.social },
      { role: 'user', content: prompt }
    ];

    const aiResponse = await this.callAI(messages, { responseFormat: 'json' });

    try {
      const variations = JSON.parse(aiResponse.content);
      return {
        original: request.originalContent,
        variations,
        tokensUsed: aiResponse.tokens
      };
    } catch (error) {
      logger.error('Failed to parse social variations', { error: error.message });
      throw new Error('Failed to generate social variations');
    }
  }

  /**
   * Search knowledge base for relevant content (RAG)
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async searchKnowledgeBase(query, limit = 3) {
    try {
      // Simple keyword search (would use vector search with embeddings in production)
      const { rows } = await db.query(
        `SELECT id, title, content, category, 
                ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) as relevance
         FROM healthbot_knowledge_base
         WHERE is_active = true
           AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         ORDER BY relevance DESC
         LIMIT $2`,
        [query, limit]
      );

      return rows.map(row => ({
        id: row.id,
        title: row.title,
        content: row.content,
        category: row.category,
        relevance: row.relevance
      }));
    } catch (error) {
      logger.error('Knowledge base search failed', { error: error.message });
      return [];
    }
  }

  /**
   * Call the AI provider
   * @param {Array} messages
   * @param {Object} options
   * @returns {Promise<{content: string, tokens: number}>}
   */
  async callAI(messages, options = {}) {
    if (!this.apiKey) {
      // Development fallback
      return {
        content: this.generateMockResponse(messages),
        tokens: 0
      };
    }

    try {
      if (this.provider === 'openai') {
        return await this.callOpenAI(messages, options);
      } else if (this.provider === 'anthropic') {
        return await this.callAnthropic(messages, options);
      }
    } catch (error) {
      logger.error('AI call failed', { 
        provider: this.provider, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Call OpenAI API
   */
  async callOpenAI(messages, options) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
        response_format: options.responseFormat === 'json' 
          ? { type: 'json_object' } 
          : undefined
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'OpenAI API error');
    }

    return {
      content: data.choices[0].message.content,
      tokens: data.usage?.total_tokens || 0
    };
  }

  /**
   * Call Anthropic API
   */
  async callAnthropic(messages, options) {
    // Extract system message
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        system: systemMessage,
        messages: chatMessages,
        max_tokens: 2000
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Anthropic API error');
    }

    return {
      content: data.content[0].text,
      tokens: data.usage?.input_tokens + data.usage?.output_tokens || 0
    };
  }

  /**
   * Generate mock response for development
   */
  generateMockResponse(messages) {
    const lastMessage = messages[messages.length - 1]?.content || '';
    
    if (lastMessage.includes('sentiment') || lastMessage.includes('Analyze')) {
      return JSON.stringify({
        sentiment: 'neutral',
        score: 0.5,
        urgency: 'low',
        suggestedResponse: 'Review and respond professionally',
        keywords: ['health', 'inquiry']
      });
    }

    if (lastMessage.includes('variations')) {
      return JSON.stringify({
        linkedin: 'Professional healthcare update for LinkedIn...',
        twitter: 'Quick health tip! 💊 #HealthMatters',
        facebook: 'Hey everyone! Here\'s an important health update...',
        instagram: '🏥 Your health matters! ✨ #Healthcare #Wellness'
      });
    }

    return 'This is a mock AI response for development. Configure OPENAI_API_KEY or ANTHROPIC_API_KEY for real responses.';
  }

  // Conversation management methods

  async createConversation(userId, contextType, contextReferenceId) {
    const { rows } = await db.query(
      `INSERT INTO healthbot_conversations (user_id, context_type, context_reference_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, contextType, contextReferenceId]
    );
    return rows[0];
  }

  async getConversation(conversationId) {
    const { rows } = await db.query(
      `SELECT * FROM healthbot_conversations WHERE id = $1`,
      [conversationId]
    );
    return rows[0];
  }

  async getConversationHistory(conversationId, limit = 10) {
    const { rows } = await db.query(
      `SELECT role, content_encrypted, content_iv, content_tag
       FROM healthbot_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [conversationId, limit]
    );

    return rows.reverse().map(row => ({
      role: row.role,
      content: decrypt(row.content_encrypted, row.content_iv, row.content_tag)
    }));
  }

  async storeMessage(conversationId, role, content, metadata = {}) {
    const encrypted = encrypt(content);

    const { rows } = await db.query(
      `INSERT INTO healthbot_messages (
        conversation_id, role, 
        content_encrypted, content_iv, content_tag,
        model_used, tokens_used, latency_ms, generated_content_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        conversationId,
        role,
        encrypted.encrypted,
        encrypted.iv,
        encrypted.tag,
        metadata.modelUsed,
        metadata.tokensUsed,
        metadata.latencyMs,
        metadata.generatedContentType
      ]
    );

    return rows[0].id;
  }

  // Prompt builders

  buildEmailReplyPrompt(request) {
    return `Draft a professional, empathetic reply to this email:

Original message:
${request.originalContent}

Tone: ${request.tone || 'professional and empathetic'}
${request.prompt ? `Additional instructions: ${request.prompt}` : ''}

Provide a complete email reply with greeting and sign-off.`;
  }

  buildNewsletterPrompt(request) {
    return `Create a healthcare newsletter/campaign email about:

Topic: ${request.prompt}
Tone: ${request.tone || 'informative and engaging'}

${request.context ? `Context: ${JSON.stringify(request.context)}` : ''}

Include:
1. Engaging subject line
2. Introduction
3. Main content with 2-3 key points
4. Call to action
5. Sign-off`;
  }

  buildSocialPostPrompt(request) {
    return `Create a social media post about:

Topic: ${request.prompt}
Tone: ${request.tone || 'engaging and professional'}

${request.context ? `Context: ${JSON.stringify(request.context)}` : ''}

Make it engaging and appropriate for healthcare audiences.`;
  }
}

module.exports = new HealthBotService();

