/**
 * SendGrid Email Provider
 * Implementation for sending emails via SendGrid
 * @module command-center/services/email/providers/SendGridProvider
 */

const EmailProvider = require('../EmailProvider');
const logger = require('../../../../../middleware/logger');

/**
 * SendGrid Provider Implementation
 * @extends EmailProvider
 */
class SendGridProvider extends EmailProvider {
  constructor(config) {
    super(config);
    this.providerName = 'sendgrid';
    this.apiKey = null;
    this.baseUrl = 'https://api.sendgrid.com/v3';
  }

  /**
   * Initialize SendGrid client
   * @returns {Promise<boolean>}
   */
  async initialize() {
    try {
      this.apiKey = this.config.credentials?.apiKey || process.env.SENDGRID_API_KEY;
      
      if (!this.apiKey) {
        throw new Error('SendGrid API key is required');
      }

      this.isInitialized = true;
      logger.info('SendGrid provider initialized');
      return true;
    } catch (error) {
      logger.error('Failed to initialize SendGrid provider', { error: error.message });
      throw error;
    }
  }

  /**
   * Make API request to SendGrid
   * @param {string} endpoint
   * @param {string} method
   * @param {Object} body
   * @returns {Promise<Object>}
   */
  async makeRequest(endpoint, method = 'POST', body = null) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      const error = responseText ? JSON.parse(responseText) : { message: 'Unknown error' };
      throw new Error(error.errors?.[0]?.message || error.message || 'SendGrid API error');
    }

    return responseText ? JSON.parse(responseText) : { success: true };
  }

  /**
   * Send email via SendGrid
   * @param {import('../../../types/index.js').SendEmailOptions} options
   * @returns {Promise<import('../../../types/index.js').SendEmailResult>}
   */
  async send(options) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      this.validateOptions(options);

      const payload = {
        personalizations: [{
          to: [{ email: Array.isArray(options.to) ? options.to[0] : options.to }],
          cc: options.cc?.map(email => ({ email })),
          bcc: options.bcc?.map(email => ({ email }))
        }],
        from: this.parseFromAddress(options.from),
        reply_to: options.replyTo ? { email: options.replyTo } : undefined,
        subject: options.subject,
        content: []
      };

      // Add text content
      if (options.text) {
        payload.content.push({
          type: 'text/plain',
          value: options.text
        });
      }

      // Add HTML content
      if (options.html) {
        payload.content.push({
          type: 'text/html',
          value: options.html
        });
      }

      // Add attachments
      if (options.attachments?.length) {
        payload.attachments = options.attachments.map(att => ({
          content: att.content.toString('base64'),
          filename: att.filename,
          type: att.contentType,
          disposition: 'attachment'
        }));
      }

      // Add custom headers
      if (options.headers) {
        payload.headers = options.headers;
      }

      // Tracking settings
      if (options.trackingOptions !== false) {
        payload.tracking_settings = {
          click_tracking: { enable: true },
          open_tracking: { enable: true }
        };
      }

      const response = await fetch(`${this.baseUrl}/mail/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      // SendGrid returns 202 for accepted
      if (response.status === 202) {
        const messageId = response.headers.get('x-message-id');
        
        const result = {
          success: true,
          messageId,
          providerResponse: { status: response.status }
        };

        this.logSendAttempt(options, result);
        return result;
      }

      const errorBody = await response.text();
      const error = errorBody ? JSON.parse(errorBody) : { message: 'Unknown error' };
      
      throw new Error(error.errors?.[0]?.message || 'SendGrid send failed');
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
   * Send batch emails via SendGrid
   * @param {import('../../../types/index.js').SendEmailOptions[]} emails
   * @returns {Promise<import('../../../types/index.js').SendEmailResult[]>}
   */
  async sendBatch(emails) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // SendGrid supports up to 1000 personalizations per request
    const batchSize = 1000;
    const results = [];

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      // Group by subject to maximize efficiency
      const bySubject = {};
      for (const email of batch) {
        const key = email.subject;
        if (!bySubject[key]) {
          bySubject[key] = [];
        }
        bySubject[key].push(email);
      }

      for (const [subject, subjectEmails] of Object.entries(bySubject)) {
        try {
          const payload = {
            personalizations: subjectEmails.map(email => ({
              to: [{ email: email.to }],
              substitutions: email.substitutions || {}
            })),
            from: this.parseFromAddress(subjectEmails[0].from),
            subject,
            content: []
          };

          if (subjectEmails[0].html) {
            payload.content.push({ type: 'text/html', value: subjectEmails[0].html });
          }
          if (subjectEmails[0].text) {
            payload.content.push({ type: 'text/plain', value: subjectEmails[0].text });
          }

          const response = await fetch(`${this.baseUrl}/mail/send`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          const success = response.status === 202;
          const messageId = response.headers.get('x-message-id');

          // Add result for each email in this batch
          for (const email of subjectEmails) {
            results.push({
              success,
              messageId,
              to: email.to
            });
          }
        } catch (error) {
          // Mark all in this subject batch as failed
          for (const email of subjectEmails) {
            results.push({
              success: false,
              error: error.message,
              to: email.to
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Parse from address string into SendGrid format
   * @param {string} from
   * @returns {{email: string, name?: string}}
   */
  parseFromAddress(from) {
    const fullFrom = this.getFromAddress(from);
    const match = fullFrom.match(/^(.+)\s*<(.+)>$/);
    
    if (match) {
      return { name: match[1].trim(), email: match[2].trim() };
    }
    
    return { email: fullFrom };
  }

  /**
   * Verify SendGrid credentials
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async verifyCredentials() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Test by getting API key scopes
      const response = await fetch(`${this.baseUrl}/scopes`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      if (response.ok) {
        return { valid: true };
      }

      return { valid: false, error: 'Invalid API key' };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Get SendGrid sending limits
   * @returns {Promise<{ratePerSecond: number, ratePerDay: number, maxRecipients: number}>}
   */
  async getSendingLimits() {
    // SendGrid limits vary by plan
    // These are conservative defaults
    return {
      ratePerSecond: 100,
      ratePerDay: 100000,
      maxRecipients: 1000
    };
  }

  /**
   * Process SendGrid webhook
   * @param {Object} payload
   * @param {Object} headers
   * @returns {Promise<{eventType: string, messageId: string, data: Object}>}
   */
  async processWebhook(payload, headers) {
    // SendGrid sends an array of events
    const events = Array.isArray(payload) ? payload : [payload];
    
    return events.map(event => {
      let eventType = 'unknown';
      
      switch (event.event) {
        case 'delivered':
          eventType = 'delivered';
          break;
        case 'open':
          eventType = 'open';
          break;
        case 'click':
          eventType = 'click';
          break;
        case 'bounce':
          eventType = 'bounce';
          break;
        case 'dropped':
          eventType = 'failed';
          break;
        case 'spamreport':
          eventType = 'complaint';
          break;
        case 'unsubscribe':
          eventType = 'unsubscribe';
          break;
      }

      return {
        eventType,
        messageId: event.sg_message_id?.split('.')[0],
        data: {
          email: event.email,
          timestamp: event.timestamp,
          url: event.url, // For click events
          reason: event.reason, // For bounces
          userAgent: event.useragent,
          ip: event.ip
        }
      };
    });
  }

  /**
   * Verify SendGrid webhook signature
   * @param {Object} payload
   * @param {Object} headers
   * @returns {boolean}
   */
  verifyWebhookSignature(payload, headers) {
    const crypto = require('crypto');
    
    const signature = headers['x-twilio-email-event-webhook-signature'];
    const timestamp = headers['x-twilio-email-event-webhook-timestamp'];
    const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;

    if (!signature || !timestamp || !verificationKey) {
      return false;
    }

    try {
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const timestampPayload = timestamp + payloadString;
      
      // SendGrid uses ECDSA with SHA256
      const verify = crypto.createVerify('SHA256');
      verify.update(timestampPayload);
      
      return verify.verify(verificationKey, signature, 'base64');
    } catch (error) {
      logger.error('SendGrid webhook signature verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Get message status from SendGrid
   * @param {string} messageId
   * @returns {Promise<{status: string, events: Object[]}>}
   */
  async getMessageStatus(messageId) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Query email activity API
      const response = await fetch(
        `${this.baseUrl}/messages?query=msg_id="${messageId}"&limit=1`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const message = data.messages?.[0];
        
        if (message) {
          return {
            status: message.status,
            events: message.events || []
          };
        }
      }

      return { status: 'unknown', events: [] };
    } catch (error) {
      logger.error('Failed to get SendGrid message status', { error: error.message, messageId });
      return { status: 'unknown', events: [] };
    }
  }
}

module.exports = SendGridProvider;

