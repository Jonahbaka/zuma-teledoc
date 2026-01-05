/**
 * Email Provider - Abstract Base Class
 * Defines the interface for all email provider implementations
 * @module command-center/services/email/EmailProvider
 */

const logger = require('../../../../middleware/logger');

/**
 * @typedef {import('../../types/index.js').SendEmailOptions} SendEmailOptions
 * @typedef {import('../../types/index.js').SendEmailResult} SendEmailResult
 * @typedef {import('../../types/index.js').EmailProviderConfig} EmailProviderConfig
 */

/**
 * Abstract base class for email providers
 * All email provider implementations must extend this class
 */
class EmailProvider {
  /**
   * @param {EmailProviderConfig} config
   */
  constructor(config) {
    if (new.target === EmailProvider) {
      throw new Error('EmailProvider is an abstract class and cannot be instantiated directly');
    }
    
    this.config = config;
    this.providerName = 'base';
    this.isInitialized = false;
  }

  /**
   * Initialize the provider (connect, validate credentials, etc.)
   * @returns {Promise<boolean>}
   */
  async initialize() {
    throw new Error('Method initialize() must be implemented');
  }

  /**
   * Send a single email
   * @param {SendEmailOptions} options
   * @returns {Promise<SendEmailResult>}
   */
  async send(options) {
    throw new Error('Method send() must be implemented');
  }

  /**
   * Send multiple emails in batch
   * @param {SendEmailOptions[]} emails
   * @returns {Promise<SendEmailResult[]>}
   */
  async sendBatch(emails) {
    // Default implementation: send sequentially
    // Providers can override for optimized batch sending
    const results = [];
    for (const email of emails) {
      try {
        const result = await this.send(email);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          error: error.message
        });
      }
    }
    return results;
  }

  /**
   * Verify email configuration and credentials
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async verifyCredentials() {
    throw new Error('Method verifyCredentials() must be implemented');
  }

  /**
   * Get provider-specific sending limits
   * @returns {Promise<{ratePerSecond: number, ratePerDay: number, maxRecipients: number}>}
   */
  async getSendingLimits() {
    return {
      ratePerSecond: 10,
      ratePerDay: 10000,
      maxRecipients: 50
    };
  }

  /**
   * Process incoming webhook from provider
   * @param {Object} payload - Raw webhook payload
   * @param {Object} headers - Request headers
   * @returns {Promise<{eventType: string, messageId: string, data: Object}>}
   */
  async processWebhook(payload, headers) {
    throw new Error('Method processWebhook() must be implemented');
  }

  /**
   * Verify webhook signature
   * @param {Object} payload
   * @param {Object} headers
   * @returns {boolean}
   */
  verifyWebhookSignature(payload, headers) {
    throw new Error('Method verifyWebhookSignature() must be implemented');
  }

  /**
   * Get delivery status for a message
   * @param {string} messageId - Provider's message ID
   * @returns {Promise<{status: string, events: Object[]}>}
   */
  async getMessageStatus(messageId) {
    throw new Error('Method getMessageStatus() must be implemented');
  }

  /**
   * Add tracking pixel to HTML content
   * @param {string} html - Original HTML
   * @param {string} trackingId - Unique tracking ID
   * @param {string} trackingDomain - Domain for tracking pixel
   * @returns {string} - HTML with tracking pixel
   */
  addTrackingPixel(html, trackingId, trackingDomain) {
    const pixelUrl = `https://${trackingDomain}/track/open/${trackingId}`;
    const pixel = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;
    
    // Insert before closing body tag, or at the end
    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixel}</body>`);
    }
    return html + pixel;
  }

  /**
   * Wrap links for click tracking
   * @param {string} html - Original HTML
   * @param {string} trackingId - Unique tracking ID
   * @param {string} trackingDomain - Domain for tracking
   * @returns {{html: string, links: Array<{index: number, originalUrl: string}>}}
   */
  wrapLinksForTracking(html, trackingId, trackingDomain) {
    const links = [];
    let linkIndex = 0;
    
    const wrappedHtml = html.replace(
      /href=["']([^"']+)["']/gi,
      (match, url) => {
        // Skip mailto, tel, and anchor links
        if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('#')) {
          return match;
        }
        
        links.push({ index: linkIndex, originalUrl: url });
        const trackingUrl = `https://${trackingDomain}/track/click/${trackingId}/${linkIndex}`;
        linkIndex++;
        
        return `href="${trackingUrl}"`;
      }
    );
    
    return { html: wrappedHtml, links };
  }

  /**
   * Validate email options before sending
   * @param {SendEmailOptions} options
   * @throws {Error} If validation fails
   */
  validateOptions(options) {
    if (!options.to) {
      throw new Error('Recipient (to) is required');
    }
    
    if (!options.subject) {
      throw new Error('Subject is required');
    }
    
    if (!options.html && !options.text) {
      throw new Error('Either html or text content is required');
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = [options.to, ...(options.cc || []), ...(options.bcc || [])];
    
    for (const email of recipients) {
      if (!emailRegex.test(email)) {
        throw new Error(`Invalid email format: ${email}`);
      }
    }
    
    return true;
  }

  /**
   * Log email sending attempt
   * @param {SendEmailOptions} options
   * @param {SendEmailResult} result
   */
  logSendAttempt(options, result) {
    const logData = {
      provider: this.providerName,
      to: options.to,
      subject: options.subject?.substring(0, 50),
      success: result.success,
      messageId: result.messageId
    };
    
    if (result.success) {
      logger.info('Email sent successfully', logData);
    } else {
      logger.error('Email send failed', { ...logData, error: result.error });
    }
  }

  /**
   * Get the from address with fallback
   * @param {string} [customFrom]
   * @returns {string}
   */
  getFromAddress(customFrom) {
    if (customFrom) return customFrom;
    
    const fromEmail = this.config.fromEmail || process.env.SMTP_FROM || 'noreply@doctarx.com';
    const fromName = this.config.fromName || process.env.SMTP_FROM_NAME || 'Docta';
    
    return `${fromName} <${fromEmail}>`;
  }
}

module.exports = EmailProvider;

