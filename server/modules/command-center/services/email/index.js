/**
 * Email Service Factory
 * Creates and manages email provider instances
 * @module command-center/services/email
 */

const AWSSESProvider = require('./providers/AWSSESProvider');
const SendGridProvider = require('./providers/SendGridProvider');
const MailgunProvider = require('./providers/MailgunProvider');
const logger = require('../../../../middleware/logger');

/**
 * @typedef {import('../../types/index.js').EmailProviderType} EmailProviderType
 * @typedef {import('../../types/index.js').EmailProviderConfig} EmailProviderConfig
 * @typedef {import('./EmailProvider')} EmailProvider
 */

/**
 * Email Service - Singleton factory for email providers
 */
class EmailService {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = null;
    this.initialized = false;
  }

  /**
   * Initialize the email service with configured providers
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    const providerType = process.env.EMAIL_PROVIDER || 'smtp';
    
    try {
      switch (providerType) {
        case 'ses':
          await this.registerProvider('ses', new AWSSESProvider({
            type: 'ses',
            region: process.env.AWS_SES_REGION,
            credentials: {
              accessKeyId: process.env.AWS_SES_ACCESS_KEY,
              secretAccessKey: process.env.AWS_SES_SECRET_KEY
            },
            fromEmail: process.env.SMTP_FROM,
            fromName: process.env.SMTP_FROM_NAME
          }));
          this.defaultProvider = 'ses';
          break;

        case 'sendgrid':
          await this.registerProvider('sendgrid', new SendGridProvider({
            type: 'sendgrid',
            credentials: {
              apiKey: process.env.SENDGRID_API_KEY
            },
            fromEmail: process.env.SMTP_FROM,
            fromName: process.env.SMTP_FROM_NAME
          }));
          this.defaultProvider = 'sendgrid';
          break;

        case 'mailgun':
          await this.registerProvider('mailgun', new MailgunProvider({
            type: 'mailgun',
            domain: process.env.MAILGUN_DOMAIN,
            region: process.env.MAILGUN_REGION,
            credentials: {
              apiKey: process.env.MAILGUN_API_KEY
            },
            fromEmail: process.env.SMTP_FROM,
            fromName: process.env.SMTP_FROM_NAME
          }));
          this.defaultProvider = 'mailgun';
          break;

        default:
          // Fall back to nodemailer SMTP (using existing email service)
          logger.warn('No email provider configured, using development mode');
          this.defaultProvider = null;
      }

      this.initialized = true;
      logger.info('Email service initialized', { provider: this.defaultProvider });
    } catch (error) {
      logger.error('Failed to initialize email service', { error: error.message });
      throw error;
    }
  }

  /**
   * Register an email provider
   * @param {string} name - Provider name
   * @param {EmailProvider} provider - Provider instance
   * @returns {Promise<void>}
   */
  async registerProvider(name, provider) {
    await provider.initialize();
    this.providers.set(name, provider);
    logger.info(`Email provider registered: ${name}`);
  }

  /**
   * Get a provider by name
   * @param {string} [name] - Provider name, uses default if not specified
   * @returns {EmailProvider}
   */
  getProvider(name) {
    const providerName = name || this.defaultProvider;
    
    if (!providerName) {
      throw new Error('No email provider configured');
    }

    const provider = this.providers.get(providerName);
    
    if (!provider) {
      throw new Error(`Email provider not found: ${providerName}`);
    }

    return provider;
  }

  /**
   * Send an email using the default provider
   * @param {import('../../types/index.js').SendEmailOptions} options
   * @returns {Promise<import('../../types/index.js').SendEmailResult>}
   */
  async send(options) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.defaultProvider) {
      // Development mode - log instead of sending
      logger.info('Email would be sent (development mode)', {
        to: options.to,
        subject: options.subject
      });
      return {
        success: true,
        messageId: `dev-${Date.now()}`
      };
    }

    const provider = this.getProvider();
    return provider.send(options);
  }

  /**
   * Send batch emails
   * @param {import('../../types/index.js').SendEmailOptions[]} emails
   * @param {string} [providerName]
   * @returns {Promise<import('../../types/index.js').SendEmailResult[]>}
   */
  async sendBatch(emails, providerName) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.defaultProvider) {
      return emails.map(email => ({
        success: true,
        messageId: `dev-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      }));
    }

    const provider = this.getProvider(providerName);
    return provider.sendBatch(emails);
  }

  /**
   * Get sending limits for the default provider
   * @returns {Promise<{ratePerSecond: number, ratePerDay: number, maxRecipients: number}>}
   */
  async getSendingLimits() {
    if (!this.initialized || !this.defaultProvider) {
      return {
        ratePerSecond: 10,
        ratePerDay: 10000,
        maxRecipients: 50
      };
    }

    const provider = this.getProvider();
    return provider.getSendingLimits();
  }

  /**
   * Process incoming webhook
   * @param {string} providerName
   * @param {Object} payload
   * @param {Object} headers
   * @returns {Promise<Object>}
   */
  async processWebhook(providerName, payload, headers) {
    const provider = this.getProvider(providerName);
    
    // Verify signature first
    if (!provider.verifyWebhookSignature(payload, headers)) {
      throw new Error('Invalid webhook signature');
    }

    return provider.processWebhook(payload, headers);
  }

  /**
   * Verify credentials for a provider
   * @param {string} [providerName]
   * @returns {Promise<{valid: boolean, error?: string}>}
   */
  async verifyCredentials(providerName) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.defaultProvider) {
      return { valid: true, error: 'Development mode - no provider' };
    }

    const provider = this.getProvider(providerName);
    return provider.verifyCredentials();
  }

  /**
   * Add tracking to an email
   * @param {string} html - HTML content
   * @param {string} trackingId - Unique tracking ID
   * @returns {{html: string, links: Array<{index: number, originalUrl: string}>}}
   */
  addTracking(html, trackingId) {
    const trackingDomain = process.env.TRACKING_DOMAIN || 'doctarx.com';
    
    // Get a provider (any will do, tracking is implemented in base class)
    const provider = this.providers.values().next().value;
    
    if (provider) {
      const htmlWithPixel = provider.addTrackingPixel(html, trackingId, trackingDomain);
      const { html: trackedHtml, links } = provider.wrapLinksForTracking(htmlWithPixel, trackingId, trackingDomain);
      return { html: trackedHtml, links };
    }

    return { html, links: [] };
  }
}

// Export singleton instance
module.exports = new EmailService();

