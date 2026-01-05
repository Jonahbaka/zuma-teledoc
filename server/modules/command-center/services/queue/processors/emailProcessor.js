/**
 * Email Job Processor
 * Handles email sending jobs from the queue
 * @module command-center/services/queue/processors/emailProcessor
 */

const emailService = require('../../email');
const db = require('../../../../../db');
const logger = require('../../../../../middleware/logger');
const { encrypt } = require('../../../../../lib/encryption');

/**
 * Process email send job
 * @param {Object} job - BullMQ job
 * @returns {Promise<Object>}
 */
async function processEmailJob(job) {
  const { 
    messageId, 
    campaignId, 
    recipientId, 
    emailOptions,
    trackingId 
  } = job.data;

  logger.debug('Processing email job', { 
    jobId: job.id, 
    messageId, 
    campaignId,
    to: emailOptions?.to 
  });

  try {
    // Update recipient status to 'sending' if tracking
    if (recipientId) {
      await db.query(
        `UPDATE campaign_recipients 
         SET status = 'sending', updated_at = NOW() 
         WHERE id = $1`,
        [recipientId]
      );
    }

    // Add tracking if enabled and trackingId provided
    let finalEmailOptions = { ...emailOptions };
    
    if (trackingId && emailOptions.html) {
      const { html, links } = emailService.addTracking(emailOptions.html, trackingId);
      finalEmailOptions.html = html;
      
      // Store link mapping for click tracking
      if (links.length > 0 && messageId) {
        await db.query(
          `UPDATE email_messages 
           SET link_mapping = $1, updated_at = NOW() 
           WHERE id = $2`,
          [JSON.stringify(links), messageId]
        );
      }
    }

    // Send the email
    const result = await emailService.send(finalEmailOptions);

    if (result.success) {
      // Update message status
      if (messageId) {
        await db.query(
          `UPDATE email_messages 
           SET status = 'sent', 
               external_message_id = $1, 
               sent_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [result.messageId, messageId]
        );
      }

      // Update recipient status
      if (recipientId) {
        await db.query(
          `UPDATE campaign_recipients 
           SET status = 'sent', 
               external_message_id = $1, 
               sent_at = NOW(),
               updated_at = NOW()
           WHERE id = $2`,
          [result.messageId, recipientId]
        );
      }

      // Update campaign sent count
      if (campaignId) {
        await db.query(
          `UPDATE campaigns 
           SET sent_count = sent_count + 1, updated_at = NOW()
           WHERE id = $1`,
          [campaignId]
        );
      }

      logger.info('Email sent successfully', {
        jobId: job.id,
        messageId,
        externalId: result.messageId,
        to: emailOptions.to
      });

      return {
        success: true,
        messageId: result.messageId
      };
    } else {
      throw new Error(result.error || 'Email send failed');
    }
  } catch (error) {
    logger.error('Email job failed', {
      jobId: job.id,
      messageId,
      error: error.message
    });

    // Update status to failed
    if (messageId) {
      await db.query(
        `UPDATE email_messages 
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [messageId]
      ).catch(() => {}); // Don't throw on update failure
    }

    if (recipientId) {
      await db.query(
        `UPDATE campaign_recipients 
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [recipientId]
      ).catch(() => {});
    }

    throw error; // Re-throw for BullMQ retry handling
  }
}

/**
 * Process batch email job
 * @param {Object} job - BullMQ job
 * @returns {Promise<Object>}
 */
async function processBatchEmailJob(job) {
  const { campaignId, batchNumber, emails } = job.data;

  logger.info('Processing email batch', {
    jobId: job.id,
    campaignId,
    batchNumber,
    count: emails.length
  });

  const results = {
    sent: 0,
    failed: 0,
    errors: []
  };

  // Process emails in smaller chunks for rate limiting
  const chunkSize = 10;
  const limits = await emailService.getSendingLimits();
  const delayBetweenChunks = Math.ceil(1000 / limits.ratePerSecond) * chunkSize;

  for (let i = 0; i < emails.length; i += chunkSize) {
    const chunk = emails.slice(i, i + chunkSize);
    
    const batchResults = await emailService.sendBatch(chunk);
    
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const email = chunk[j];

      if (result.success) {
        results.sent++;
        
        // Update recipient status
        if (email.recipientId) {
          await db.query(
            `UPDATE campaign_recipients 
             SET status = 'sent', 
                 external_message_id = $1, 
                 sent_at = NOW()
             WHERE id = $2`,
            [result.messageId, email.recipientId]
          ).catch(() => {});
        }
      } else {
        results.failed++;
        results.errors.push({
          to: email.to,
          error: result.error
        });

        if (email.recipientId) {
          await db.query(
            `UPDATE campaign_recipients 
             SET status = 'failed'
             WHERE id = $1`,
            [email.recipientId]
          ).catch(() => {});
        }
      }
    }

    // Progress update
    await job.updateProgress(Math.round(((i + chunkSize) / emails.length) * 100));

    // Rate limit delay
    if (i + chunkSize < emails.length) {
      await new Promise(resolve => setTimeout(resolve, delayBetweenChunks));
    }
  }

  // Update campaign stats
  await db.query(
    `UPDATE campaigns 
     SET sent_count = sent_count + $1,
         updated_at = NOW()
     WHERE id = $2`,
    [results.sent, campaignId]
  );

  logger.info('Email batch completed', {
    jobId: job.id,
    campaignId,
    batchNumber,
    sent: results.sent,
    failed: results.failed
  });

  return results;
}

/**
 * Register the email processor with the queue service
 * @param {Object} queueService - Queue service instance
 */
async function register(queueService) {
  await queueService.registerWorker('email', async (job) => {
    switch (job.name) {
      case 'send_email':
        return processEmailJob(job);
      case 'send_batch':
        return processBatchEmailJob(job);
      default:
        throw new Error(`Unknown email job type: ${job.name}`);
    }
  });
}

module.exports = {
  processEmailJob,
  processBatchEmailJob,
  register
};

