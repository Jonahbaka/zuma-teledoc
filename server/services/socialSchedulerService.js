/**
 * Social publishing availability boundary.
 * No provider adapter or genuine receipt contract is implemented. Preserve
 * queued records and fail closed instead of inventing successful publications.
 */

const MAX_RETRIES = 3;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class SocialSchedulerService {
  constructor() {
    this.isRunning = false;
    this.timer = null;
    this.db = null;
  }

  // Lazy-load db to avoid circular require issues at startup
  getDb() {
    if (!this.db) this.db = require('../db');
    return this.db;
  }

  start() {
    // The historical publishers only fabricated URLs. Until a reviewed provider
    // adapter and receipt contract exists, preserve queued posts without polling
    // or marking them as attempted/published. No flag can enable placeholder IO.
    this.isRunning = false;
    return this.getStatus();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.isRunning = false;
    console.log('⏸️  Social Scheduler stopped');
  }

  async checkQueue() {
    return this.getStatus();
  }

  async publishPost() {
    throw this.publisherUnavailable();
  }

  async callPlatformPublisher() {
    throw this.publisherUnavailable();
  }

  publisherUnavailable() {
    return Object.assign(new Error('Social publishing is unavailable until a verified provider adapter is configured.'), {
      code: 'SOCIAL_PUBLISHING_UNAVAILABLE',
      status: 503,
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      publishingAvailable: false,
      reason: 'verified_provider_adapter_required',
      checkIntervalMs: CHECK_INTERVAL_MS,
      nextCheckAt: this.isRunning ? new Date(Date.now() + CHECK_INTERVAL_MS).toISOString() : null,
      maxRetries: MAX_RETRIES,
    };
  }
}

module.exports = new SocialSchedulerService();
