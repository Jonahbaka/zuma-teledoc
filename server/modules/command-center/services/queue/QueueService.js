/**
 * Queue Service
 * BullMQ-based job queue for campaign processing and email sending
 * @module command-center/services/queue/QueueService
 */

const logger = require('../../../../middleware/logger');

/**
 * @typedef {import('../../types/index.js').JobType} JobType
 * @typedef {import('../../types/index.js').QueueJob} QueueJob
 * @typedef {import('../../types/index.js').EmailJobData} EmailJobData
 * @typedef {import('../../types/index.js').SocialPublishJobData} SocialPublishJobData
 * @typedef {import('../../types/index.js').CampaignBatchJobData} CampaignBatchJobData
 */

/**
 * Queue Service - Manages BullMQ queues for async job processing
 */
class QueueService {
  constructor() {
    this.queues = new Map();
    this.workers = new Map();
    this.connection = null;
    this.initialized = false;
    this.Bull = null;
  }

  /**
   * Initialize Redis connection and queues
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Dynamically import BullMQ
      const { Queue, Worker, QueueEvents } = await import('bullmq');
      this.Bull = { Queue, Worker, QueueEvents };

      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      
      // Parse Redis URL for connection options
      const url = new URL(redisUrl);
      this.connection = {
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        password: url.password || undefined,
        username: url.username || undefined,
        tls: url.protocol === 'rediss:' ? {} : undefined
      };

      // Create queues
      await this.createQueue('email', {
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 }
        }
      });

      await this.createQueue('social', {
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 1000 }
        }
      });

      await this.createQueue('campaign', {
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 10000
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 }
        }
      });

      await this.createQueue('analytics', {
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'fixed',
            delay: 60000
          },
          removeOnComplete: { count: 100 }
        }
      });

      this.initialized = true;
      logger.info('Queue service initialized', { 
        host: this.connection.host,
        port: this.connection.port 
      });
    } catch (error) {
      logger.error('Failed to initialize queue service', { error: error.message });
      // Don't throw - allow graceful degradation
      this.initialized = false;
    }
  }

  /**
   * Create a new queue
   * @param {string} name - Queue name
   * @param {Object} options - Queue options
   * @returns {Promise<void>}
   */
  async createQueue(name, options = {}) {
    if (!this.Bull) {
      throw new Error('BullMQ not initialized');
    }

    const queue = new this.Bull.Queue(name, {
      connection: this.connection,
      ...options
    });

    this.queues.set(name, queue);
    logger.info(`Queue created: ${name}`);
  }

  /**
   * Get a queue by name
   * @param {string} name
   * @returns {Object} BullMQ Queue instance
   */
  getQueue(name) {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Queue not found: ${name}`);
    }
    return queue;
  }

  /**
   * Add a job to a queue
   * @param {string} queueName - Queue name
   * @param {string} jobName - Job name/type
   * @param {Object} data - Job data
   * @param {Object} [options] - Job options
   * @returns {Promise<Object>} Job instance
   */
  async addJob(queueName, jobName, data, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      // Fallback: process synchronously if queue not available
      logger.warn('Queue not available, processing synchronously', { queueName, jobName });
      return { id: `sync-${Date.now()}`, data };
    }

    const queue = this.getQueue(queueName);
    
    const job = await queue.add(jobName, data, {
      ...options,
      timestamp: Date.now()
    });

    logger.debug('Job added to queue', {
      queueName,
      jobName,
      jobId: job.id
    });

    return job;
  }

  /**
   * Add multiple jobs to a queue
   * @param {string} queueName
   * @param {Array<{name: string, data: Object, opts?: Object}>} jobs
   * @returns {Promise<Object[]>}
   */
  async addBulk(queueName, jobs) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      return jobs.map((job, i) => ({ id: `sync-${Date.now()}-${i}`, data: job.data }));
    }

    const queue = this.getQueue(queueName);
    return queue.addBulk(jobs);
  }

  /**
   * Add an email send job
   * @param {EmailJobData} data
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async addEmailJob(data, options = {}) {
    return this.addJob('email', 'send_email', data, {
      priority: data.priority || 5,
      ...options
    });
  }

  /**
   * Add a social media publish job
   * @param {SocialPublishJobData} data
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async addSocialJob(data, options = {}) {
    return this.addJob('social', 'publish_post', data, {
      delay: data.scheduledFor ? new Date(data.scheduledFor).getTime() - Date.now() : 0,
      ...options
    });
  }

  /**
   * Add a campaign batch job
   * @param {CampaignBatchJobData} data
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async addCampaignBatchJob(data, options = {}) {
    return this.addJob('campaign', 'process_batch', data, {
      priority: 3,
      ...options
    });
  }

  /**
   * Register a worker for a queue
   * @param {string} queueName
   * @param {Function} processor - Job processor function
   * @param {Object} [options]
   * @returns {Promise<void>}
   */
  async registerWorker(queueName, processor, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized || !this.Bull) {
      logger.warn(`Cannot register worker for ${queueName} - queue not initialized`);
      return;
    }

    const concurrency = parseInt(process.env.QUEUE_CONCURRENCY) || 5;

    const worker = new this.Bull.Worker(queueName, processor, {
      connection: this.connection,
      concurrency,
      ...options
    });

    // Event handlers
    worker.on('completed', (job, result) => {
      logger.debug('Job completed', {
        queueName,
        jobId: job.id,
        jobName: job.name
      });
    });

    worker.on('failed', (job, error) => {
      logger.error('Job failed', {
        queueName,
        jobId: job?.id,
        jobName: job?.name,
        error: error.message,
        attempts: job?.attemptsMade
      });
    });

    worker.on('error', (error) => {
      logger.error('Worker error', {
        queueName,
        error: error.message
      });
    });

    this.workers.set(queueName, worker);
    logger.info(`Worker registered for queue: ${queueName}`, { concurrency });
  }

  /**
   * Get queue statistics
   * @param {string} queueName
   * @returns {Promise<Object>}
   */
  async getQueueStats(queueName) {
    if (!this.initialized) {
      return { waiting: 0, active: 0, completed: 0, failed: 0 };
    }

    const queue = this.getQueue(queueName);
    
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount()
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get all queues statistics
   * @returns {Promise<Object>}
   */
  async getAllStats() {
    const stats = {};
    
    for (const [name] of this.queues) {
      stats[name] = await this.getQueueStats(name);
    }

    return stats;
  }

  /**
   * Pause a queue
   * @param {string} queueName
   * @returns {Promise<void>}
   */
  async pauseQueue(queueName) {
    const queue = this.getQueue(queueName);
    await queue.pause();
    logger.info(`Queue paused: ${queueName}`);
  }

  /**
   * Resume a queue
   * @param {string} queueName
   * @returns {Promise<void>}
   */
  async resumeQueue(queueName) {
    const queue = this.getQueue(queueName);
    await queue.resume();
    logger.info(`Queue resumed: ${queueName}`);
  }

  /**
   * Get jobs from a queue
   * @param {string} queueName
   * @param {string} status - 'waiting', 'active', 'completed', 'failed', 'delayed'
   * @param {number} start
   * @param {number} end
   * @returns {Promise<Object[]>}
   */
  async getJobs(queueName, status, start = 0, end = 100) {
    if (!this.initialized) {
      return [];
    }

    const queue = this.getQueue(queueName);
    return queue.getJobs([status], start, end);
  }

  /**
   * Retry failed jobs
   * @param {string} queueName
   * @param {number} count - Number of jobs to retry
   * @returns {Promise<number>} Number of jobs retried
   */
  async retryFailedJobs(queueName, count = 100) {
    if (!this.initialized) {
      return 0;
    }

    const queue = this.getQueue(queueName);
    const failedJobs = await queue.getJobs(['failed'], 0, count);
    
    let retried = 0;
    for (const job of failedJobs) {
      await job.retry();
      retried++;
    }

    logger.info(`Retried ${retried} failed jobs in ${queueName}`);
    return retried;
  }

  /**
   * Clean old jobs from queue
   * @param {string} queueName
   * @param {number} gracePeriod - Milliseconds to keep jobs
   * @returns {Promise<void>}
   */
  async cleanQueue(queueName, gracePeriod = 24 * 60 * 60 * 1000) {
    if (!this.initialized) {
      return;
    }

    const queue = this.getQueue(queueName);
    
    await Promise.all([
      queue.clean(gracePeriod, 1000, 'completed'),
      queue.clean(gracePeriod * 7, 1000, 'failed')
    ]);

    logger.info(`Queue cleaned: ${queueName}`);
  }

  /**
   * Schedule a recurring job
   * @param {string} queueName
   * @param {string} jobName
   * @param {Object} data
   * @param {string} pattern - Cron pattern
   * @returns {Promise<void>}
   */
  async scheduleRecurring(queueName, jobName, data, pattern) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.initialized) {
      logger.warn('Cannot schedule recurring job - queue not initialized');
      return;
    }

    const queue = this.getQueue(queueName);
    
    await queue.add(jobName, data, {
      repeat: { pattern },
      jobId: `recurring-${jobName}`
    });

    logger.info(`Recurring job scheduled: ${jobName}`, { pattern });
  }

  /**
   * Remove a recurring job
   * @param {string} queueName
   * @param {string} jobName
   * @returns {Promise<void>}
   */
  async removeRecurring(queueName, jobName) {
    if (!this.initialized) {
      return;
    }

    const queue = this.getQueue(queueName);
    await queue.removeRepeatableByKey(`recurring-${jobName}`);
    logger.info(`Recurring job removed: ${jobName}`);
  }

  /**
   * Gracefully shutdown all queues and workers
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('Shutting down queue service...');

    // Close workers first
    for (const [name, worker] of this.workers) {
      await worker.close();
      logger.debug(`Worker closed: ${name}`);
    }

    // Then close queues
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.debug(`Queue closed: ${name}`);
    }

    this.workers.clear();
    this.queues.clear();
    this.initialized = false;

    logger.info('Queue service shutdown complete');
  }
}

// Export singleton instance
module.exports = new QueueService();

