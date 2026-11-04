/**
 * Mailgun Email Provider
 * Implementation for sending emails via Mailgun
 * @module command-center/services/email/providers/MailgunProvider
 */

const EmailProvider = require('../EmailProvider');
const logger = require('../../../../../middleware/logger');

/**
 * Mailgun Provider Implementation
 * @extends EmailProvider
 */
class MailgunProvider extends EmailProvider {
  constructor(config) {
    super(config);
    this.providerName = 'mailgun';
    this.apiKey = null;
    this.domain = null;
    this.baseUrl = null;
  }

  /**
   * Initialize Mailgun client
   * @returns {Promise<boolean>}
   */
  async initialize() {
    try {
      this.apiKey = this.config.credentials?.apiKey || process.env.MAILGUN_API_KEY;
      this.domain = this.config.domain || process.env.MAILGUN_DOMAIN;
      
      if (!this.apiKey) {
        throw new Error('Mailgun API key is required');
      }
      
      if (!this.domain) {
        throw new Error('Mailgun domain is required');
      }

      // Use EU endpoint if configured
      const isEU = this.config.region === 'eu' || process.env.MAILGUN_REGION === 'eu';
      this.baseUrl = isEU 
        ? 'https://api.eu.mailgun.net/v3'
        : 'https://api.mailgun.net/v3';

      this.isInitialized = true;
      logger.info('Mailgun provider initialized', { domain: this.domain });
      return true;
    } catch (error) {
      logger.error('Failed to initialize Mailgun provider', { error: error.message });
      throw error;
    }
  }

  /**
   * Make API request to Mailgun
   * @param {string} endpoint
   * @param {string} method
   * @param {FormData|Object} body
   * @returns {Promise<Object>}
   */
  async makeRequest(endpoint, method = 'POST', body = null) {
    const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
    
    const options = {
      method,
      headers: {
        'Authorization': `Basic ${auth}`
      }
    };

    if (body) {
      if (body instanceof FormData) {
        options.body = body;
      } else {
        options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.body = new URLSearchParams(body).toString();
      }
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Mailgun API error');
    }

    return data;
  }

  /**
   * Send email via Mailgun
   * @param {import('../../../types/index.js').SendEmailOptions} options
   * @returns {Promise<import('../../../types/index.js').SendEmailResult>}
   */
  async send(options) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      this.validateOptions(options);

      const formData = new FormData();
      
      formData.append('from', this.getFromAddress(options.from));
      formData.append('to', Array.isArray(options.to) ? options.to.join(',') : options.to);
      
      if (options.cc?.length) {
        formData.append('cc', options.cc.join(','));
      }
      
      if (options.bcc?.length) {
        formData.append('bcc', options.bcc.join(','));
      }
      
      formData.append('subject', options.subject);
      
      if (options.text) {
        formData.append('text', options.text);
      }
      
      if (options.html) {
        formData.append('html', options.html);
      }
      
      if (options.replyTo) {
        formData.append('h:Reply-To', options.replyTo);
      }

      // Add custom headers
      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          formData.append(`h:${key}`, value);
        }
      }

      // Add attachments
      if (options.attachments?.length) {
        for (const attachment of options.attachments) {
          const blob = new Blob([attachment.content], { type: attachment.contentType });
          formData.append('attachment', blob, attachment.filename);
        }
      }

      // Tracking options
      if (options.trackingOptions !== false) {
        formData.append('o:tracking', 'yes');
        formData.append('o:tracking-clicks', 'yes');
        formData.append('o:tracking-opens', 'yes');
      }

      const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
      
      const response = await fetch(`${this.baseUrl}/${this.domain}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`
        },
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        const result = {
          success: true,
          messageId: data.id,
          providerResponse: data
        };

        this.logSendAttempt(options, result);
        return result;
      }

      throw new Error(data.message || 'Mailgun send failed');
    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        providerResponse: error
      };

      this.logSendAttempt(options, result);
      return result;
    }
  }

  /**
   * Send batch emails via Mailgun
   * @param {import('../../../types/index.js').SendEmailOptions[]} emails
   * @returns {Promise<import('../../../types/index.js').SendEmailResult[]>}
   */
  async sendBatch(emails) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Mailgun supports recipient variables for batch sending
    // Group emails by subject/content for efficiency
    const grouped = {};
    
    for (const email of emails) {
      const key = `${email.subject}|${email.html || email.text}`;
      if (!grouped[key]) {
        grouped[key] = {
          template: email,
          recipients: []
        };
      }
      grouped[key].recipients.push({
        email: email.to,
        variables: email.substitutions || {}
      });
    }

    const results = [];

    for (const group of Object.values(grouped)) {
      try {
        const formData = new FormData();
        
        formData.append('from', this.getFromAddress(group.template.from));
        formData.append('to', group.recipients.map(r => r.email).join(','));
        formData.append('subject', group.template.subject);
        
        if (group.template.html) {
          formData.append('html', group.template.html);
        }
        if (group.template.text) {
          formData.append('text', group.template.text);
        }

        // Add recipient variables
        formData.append('recipient-variables', JSON.stringify(
          group.recipients.reduce((acc, r) => {
            acc[r.email] = r.variables;
            return acc;
          }, {})
        ));

        const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
        
        const response = await fetch(`${this.baseUrl}/${this.domain}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`
          },
          body: formData
        });

        const data = await response.json();
        const success = response.ok;

        for (const recipient of group.recipients) {
          results.push({
            success,
            messageId: data.id,
            to: recipient.email,
            error: success ? undefined : data.message
          });
        }
      } catch (error) {
        for (const recipient of group.recipients) {
          results.push({
            success: false,
            to: recipient.email,
            error: error.message
          });
        }
      }
    }

    return results;
  }

  /**
   * Verify Mailgun credentials
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async verifyCredentials() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
      
      const response = await fetch(`${this.baseUrl}/domains/${this.domain}`, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      if (response.ok) {
        return { valid: true };
      }

      return { valid: false, error: 'Invalid credentials or domain' };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Get Mailgun sending limits
   * @returns {Promise<{ratePerSecond: number, ratePerDay: number, maxRecipients: number}>}
   */
  async getSendingLimits() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
      
      const response = await fetch(`${this.baseUrl}/domains/${this.domain}/limits`, {
        headers: {
          'Authorization': `Basic ${auth}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        return {
          ratePerSecond: data.sending?.limit || 100,
          ratePerDay: data.sending?.daily_limit || 100000,
          maxRecipients: 1000 // Mailgun batch limit
        };
      }

      return {
        ratePerSecond: 100,
        ratePerDay: 100000,
        maxRecipients: 1000
      };
    } catch (error) {
      return {
        ratePerSecond: 100,
        ratePerDay: 100000,
        maxRecipients: 1000
      };
    }
  }

  /**
   * Process Mailgun webhook
   * @param {Object} payload
   * @param {Object} headers
   * @returns {Promise<{eventType: string, messageId: string, data: Object}>}
   */
  async processWebhook(payload, headers) {
    const eventData = payload['event-data'] || payload;
    const event = eventData.event?.toLowerCase();

    let eventType = 'unknown';
    
    switch (event) {
      case 'delivered':
        eventType = 'delivered';
        break;
      case 'opened':
        eventType = 'open';
        break;
      case 'clicked':
        eventType = 'click';
        break;
      case 'bounced':
      case 'failed':
        eventType = 'bounce';
        break;
      case 'complained':
        eventType = 'complaint';
        break;
      case 'unsubscribed':
        eventType = 'unsubscribe';
        break;
    }

    return {
      eventType,
      messageId: eventData.message?.headers?.['message-id'] || eventData['message-id'],
      data: {
        email: eventData.recipient,
        timestamp: eventData.timestamp,
        url: eventData.url, // For click events
        severity: eventData.severity, // For bounces
        reason: eventData.reason || eventData['delivery-status']?.description,
        userAgent: eventData['client-info']?.['user-agent'],
        ip: eventData.ip,
        geolocation: eventData.geolocation
      }
    };
  }

  /**
   * Verify Mailgun webhook signature
   * @param {Object} payload
   * @param {Object} headers
   * @returns {boolean}
   */
  verifyWebhookSignature(payload, headers) {
    const crypto = require('crypto');
    
    const signature = payload.signature;
    if (!signature) return false;

    const { timestamp, token, signature: sig } = signature;
    const webhookKey = process.env.MAILGUN_WEBHOOK_KEY || this.apiKey;

    if (!timestamp || !token || !sig) {
      return false;
    }

    // Check timestamp is within 5 minutes
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
      return false;
    }

    // Verify signature
    const encodedToken = crypto
      .createHmac('sha256', webhookKey)
      .update(timestamp + token)
      .digest('hex');

    return encodedToken === sig;
  }

  /**
   * Get message status from Mailgun
   * @param {string} messageId
   * @returns {Promise<{status: string, events: Object[]}>}
   */
  async getMessageStatus(messageId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const auth = Buffer.from(`api:${this.apiKey}`).toString('base64');
      
      // Query events API
      const response = await fetch(
        `${this.baseUrl}/${this.domain}/events?message-id=${encodeURIComponent(messageId)}`,
        {
          headers: {
            'Authorization': `Basic ${auth}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const events = data.items || [];
        
        // Determine status from events
        let status = 'sent';
        for (const event of events) {
          if (event.event === 'delivered') status = 'delivered';
          else if (event.event === 'opened') status = 'opened';
          else if (event.event === 'failed' || event.event === 'bounced') status = 'bounced';
        }

        return {
          status,
          events: events.map(e => ({
            type: e.event,
            timestamp: e.timestamp,
            data: e
          }))
        };
      }

      return { status: 'unknown', events: [] };
    } catch (error) {
      logger.error('Failed to get Mailgun message status', { error: error.message, messageId });
      return { status: 'unknown', events: [] };
    }
  }
}

module.exports = MailgunProvider;

