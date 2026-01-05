/**
 * Campaign Routes
 * Campaign management API endpoints
 * @module command-center/routes/campaign
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../../../db');
const { encrypt, decrypt } = require('../../../lib/encryption');
const logger = require('../../../middleware/logger');
const { authenticate, requireRole } = require('../../../middleware/auth');
const { createAuditLog } = require('../../../middleware/audit');
const queueService = require('../services/queue/QueueService');

const router = express.Router();

/**
 * GET /api/command-center/campaigns
 * Get all campaigns
 */
router.get('/', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT c.*, u.first_name || ' ' || u.last_name as created_by_name
      FROM campaigns c
      JOIN users u ON u.id = c.created_by
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND c.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (type) {
      query += ` AND c.campaign_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    query += ` ORDER BY c.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    const { rows } = await db.query(query, params);

    // Get total count
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM campaigns`
    );

    res.json({
      success: true,
      campaigns: rows.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description,
        campaignType: c.campaign_type,
        channels: c.channels,
        status: c.status,
        scheduledAt: c.scheduled_at,
        recipientCount: c.recipient_count,
        sentCount: c.sent_count,
        openedCount: c.opened_count,
        clickedCount: c.clicked_count,
        bouncedCount: c.bounced_count,
        createdBy: c.created_by_name,
        createdAt: c.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countRows[0].count)
      }
    });
  } catch (error) {
    logger.error('Get campaigns error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get campaigns' });
  }
});

/**
 * GET /api/command-center/campaigns/:id
 * Get campaign details
 */
router.get('/:id', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const { rows: campaignRows } = await db.query(
      `SELECT c.*, s.name as segment_name, s.criteria as segment_criteria
       FROM campaigns c
       LEFT JOIN campaign_segments s ON s.id = c.segment_id
       WHERE c.id = $1`,
      [id]
    );

    if (campaignRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const campaign = campaignRows[0];

    // Decrypt content if present
    let content = null;
    if (campaign.content_encrypted) {
      content = decrypt(campaign.content_encrypted, campaign.content_iv, campaign.content_tag);
    }

    res.json({
      success: true,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description,
        campaignType: campaign.campaign_type,
        channels: campaign.channels,
        templateId: campaign.template_id,
        subjectLine: campaign.subject_line,
        content,
        segment: campaign.segment_id ? {
          id: campaign.segment_id,
          name: campaign.segment_name,
          criteria: campaign.segment_criteria
        } : null,
        recipientCount: campaign.recipient_count,
        status: campaign.status,
        scheduledAt: campaign.scheduled_at,
        startedAt: campaign.started_at,
        completedAt: campaign.completed_at,
        sendRatePerHour: campaign.send_rate_per_hour,
        batchSize: campaign.batch_size,
        sentCount: campaign.sent_count,
        deliveredCount: campaign.delivered_count,
        openedCount: campaign.opened_count,
        clickedCount: campaign.clicked_count,
        bouncedCount: campaign.bounced_count,
        unsubscribedCount: campaign.unsubscribed_count,
        isAbTest: campaign.is_ab_test,
        abTestConfig: campaign.ab_test_config,
        createdAt: campaign.created_at
      }
    });
  } catch (error) {
    logger.error('Get campaign error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get campaign' });
  }
});

/**
 * POST /api/command-center/campaigns
 * Create a new campaign
 */
router.post('/', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const {
      name, description, campaignType, channels, templateId,
      subjectLine, content, segmentId, scheduledAt,
      sendRatePerHour, batchSize, abTestConfig
    } = req.body;

    if (!name || !campaignType) {
      return res.status(400).json({
        success: false,
        error: 'Name and campaign type are required'
      });
    }

    // Encrypt content
    let contentEncrypted = null;
    if (content) {
      contentEncrypted = encrypt(content);
    }

    // Get recipient count if segment provided
    let recipientCount = 0;
    if (segmentId) {
      const { rows: segmentRows } = await db.query(
        `SELECT estimated_count FROM campaign_segments WHERE id = $1`,
        [segmentId]
      );
      if (segmentRows.length > 0) {
        recipientCount = segmentRows[0].estimated_count;
      }
    }

    const { rows } = await db.query(
      `INSERT INTO campaigns (
        name, description, campaign_type, channels, template_id,
        subject_line, content_encrypted, content_iv, content_tag,
        segment_id, recipient_count, scheduled_at,
        send_rate_per_hour, batch_size, is_ab_test, ab_test_config,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING id`,
      [
        name,
        description,
        campaignType,
        channels || ['email'],
        templateId,
        subjectLine,
        contentEncrypted?.encrypted,
        contentEncrypted?.iv,
        contentEncrypted?.tag,
        segmentId,
        recipientCount,
        scheduledAt,
        sendRatePerHour || 1000,
        batchSize || 100,
        abTestConfig?.enabled || false,
        abTestConfig ? JSON.stringify(abTestConfig) : null,
        req.user.id
      ]
    );

    await createAuditLog(req, 'campaign_created', 'campaigns', rows[0].id);

    res.status(201).json({
      success: true,
      id: rows[0].id
    });
  } catch (error) {
    logger.error('Create campaign error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create campaign' });
  }
});

/**
 * PUT /api/command-center/campaigns/:id
 * Update a campaign
 */
router.put('/:id', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Check campaign status - can only update draft campaigns
    const { rows: existing } = await db.query(
      `SELECT status FROM campaigns WHERE id = $1`,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    if (existing[0].status !== 'draft') {
      return res.status(400).json({
        success: false,
        error: 'Can only update draft campaigns'
      });
    }

    const allowedFields = [
      'name', 'description', 'subject_line', 'template_id',
      'segment_id', 'scheduled_at', 'send_rate_per_hour', 'batch_size'
    ];

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(snakeKey)) {
        setClauses.push(`${snakeKey} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    // Handle content encryption separately
    if (updates.content) {
      const encrypted = encrypt(updates.content);
      setClauses.push(
        `content_encrypted = $${paramIndex}`,
        `content_iv = $${paramIndex + 1}`,
        `content_tag = $${paramIndex + 2}`
      );
      values.push(encrypted.encrypted, encrypted.iv, encrypted.tag);
      paramIndex += 3;
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    await db.query(
      `UPDATE campaigns SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Update campaign error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update campaign' });
  }
});

/**
 * POST /api/command-center/campaigns/:id/schedule
 * Schedule a campaign for sending
 */
router.post('/:id/schedule', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduledAt } = req.body;

    if (!scheduledAt) {
      return res.status(400).json({ success: false, error: 'Scheduled time is required' });
    }

    const scheduledTime = new Date(scheduledAt);
    if (scheduledTime < new Date()) {
      return res.status(400).json({ success: false, error: 'Scheduled time must be in the future' });
    }

    await db.query(
      `UPDATE campaigns SET 
        status = 'scheduled',
        scheduled_at = $1,
        updated_at = NOW()
       WHERE id = $2 AND status = 'draft'`,
      [scheduledTime, id]
    );

    await createAuditLog(req, 'campaign_scheduled', 'campaigns', id);

    res.json({ success: true });
  } catch (error) {
    logger.error('Schedule campaign error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to schedule campaign' });
  }
});

/**
 * POST /api/command-center/campaigns/:id/send
 * Start sending a campaign immediately
 */
router.post('/:id/send', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Get campaign
    const { rows: campaignRows } = await db.query(
      `SELECT * FROM campaigns WHERE id = $1`,
      [id]
    );

    if (campaignRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const campaign = campaignRows[0];

    if (!['draft', 'scheduled'].includes(campaign.status)) {
      return res.status(400).json({
        success: false,
        error: `Cannot send campaign with status: ${campaign.status}`
      });
    }

    // Update status to sending
    await db.query(
      `UPDATE campaigns SET 
        status = 'sending',
        started_at = NOW(),
        updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    // Get recipients from segment
    if (campaign.segment_id) {
      const { rows: segmentRows } = await db.query(
        `SELECT criteria FROM campaign_segments WHERE id = $1`,
        [campaign.segment_id]
      );

      if (segmentRows.length > 0) {
        // Build recipient query based on segment criteria
        // This is simplified - real implementation would parse criteria JSON
        const { rows: recipients } = await db.query(
          `SELECT id, email FROM users WHERE role = 'patient' AND is_active = true LIMIT 1000`
        );

        // Create recipient records and queue jobs in batches
        const batchSize = campaign.batch_size || 100;
        
        for (let i = 0; i < recipients.length; i += batchSize) {
          const batch = recipients.slice(i, i + batchSize);
          
          // Create recipient records
          for (const recipient of batch) {
            const emailEncrypted = encrypt(recipient.email);
            await db.query(
              `INSERT INTO campaign_recipients (
                campaign_id, user_id, email_encrypted, email_iv, email_tag
              ) VALUES ($1, $2, $3, $4, $5)`,
              [id, recipient.id, emailEncrypted.encrypted, emailEncrypted.iv, emailEncrypted.tag]
            );
          }

          // Queue batch job
          await queueService.addCampaignBatchJob({
            campaignId: id,
            batchNumber: Math.floor(i / batchSize),
            recipientIds: batch.map(r => r.id)
          });
        }
      }
    }

    await createAuditLog(req, 'campaign_started', 'campaigns', id);

    res.json({
      success: true,
      message: 'Campaign sending started'
    });
  } catch (error) {
    logger.error('Send campaign error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to start campaign' });
  }
});

/**
 * POST /api/command-center/campaigns/:id/pause
 * Pause a sending campaign
 */
router.post('/:id/pause', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `UPDATE campaigns SET status = 'paused', updated_at = NOW()
       WHERE id = $1 AND status = 'sending'`,
      [id]
    );

    await createAuditLog(req, 'campaign_paused', 'campaigns', id);

    res.json({ success: true });
  } catch (error) {
    logger.error('Pause campaign error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to pause campaign' });
  }
});

/**
 * GET /api/command-center/campaigns/:id/analytics
 * Get campaign analytics
 */
router.get('/:id/analytics', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Get campaign stats
    const { rows: campaignRows } = await db.query(
      `SELECT * FROM campaigns WHERE id = $1`,
      [id]
    );

    if (campaignRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const campaign = campaignRows[0];

    // Get detailed recipient stats
    const { rows: statusStats } = await db.query(
      `SELECT status, COUNT(*) as count
       FROM campaign_recipients
       WHERE campaign_id = $1
       GROUP BY status`,
      [id]
    );

    // Get opens over time
    const { rows: opensOverTime } = await db.query(
      `SELECT 
         DATE_TRUNC('hour', opened_at) as hour,
         COUNT(*) as opens
       FROM campaign_recipients
       WHERE campaign_id = $1 AND opened_at IS NOT NULL
       GROUP BY hour
       ORDER BY hour`,
      [id]
    );

    // Calculate rates
    const total = campaign.recipient_count || 1;
    const openRate = (campaign.opened_count / total * 100).toFixed(2);
    const clickRate = (campaign.clicked_count / total * 100).toFixed(2);
    const bounceRate = (campaign.bounced_count / total * 100).toFixed(2);
    const unsubscribeRate = (campaign.unsubscribed_count / total * 100).toFixed(2);

    res.json({
      success: true,
      analytics: {
        summary: {
          totalRecipients: campaign.recipient_count,
          sent: campaign.sent_count,
          delivered: campaign.delivered_count,
          opened: campaign.opened_count,
          clicked: campaign.clicked_count,
          bounced: campaign.bounced_count,
          unsubscribed: campaign.unsubscribed_count
        },
        rates: {
          openRate: parseFloat(openRate),
          clickRate: parseFloat(clickRate),
          bounceRate: parseFloat(bounceRate),
          unsubscribeRate: parseFloat(unsubscribeRate)
        },
        statusBreakdown: statusStats.reduce((acc, s) => {
          acc[s.status] = parseInt(s.count);
          return acc;
        }, {}),
        opensOverTime
      }
    });
  } catch (error) {
    logger.error('Get campaign analytics error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get analytics' });
  }
});

/**
 * GET /api/command-center/segments
 * Get all segments
 */
router.get('/segments', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM campaign_segments WHERE is_active = true ORDER BY is_system DESC, name ASC`
    );

    res.json({
      success: true,
      segments: rows.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        criteria: s.criteria,
        estimatedCount: s.estimated_count,
        isSystem: s.is_system
      }))
    });
  } catch (error) {
    logger.error('Get segments error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to get segments' });
  }
});

/**
 * POST /api/command-center/segments
 * Create a new segment
 */
router.post('/segments', authenticate, requireRole('admin', 'super_admin'), async (req, res) => {
  try {
    const { name, description, criteria } = req.body;

    if (!name || !criteria) {
      return res.status(400).json({
        success: false,
        error: 'Name and criteria are required'
      });
    }

    // Estimate count based on criteria
    // Simplified - real implementation would build dynamic query from criteria
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*) FROM users WHERE role = 'patient' AND is_active = true`
    );

    const { rows } = await db.query(
      `INSERT INTO campaign_segments (name, description, criteria, estimated_count, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [name, description, JSON.stringify(criteria), parseInt(countRows[0].count), req.user.id]
    );

    res.status(201).json({
      success: true,
      id: rows[0].id
    });
  } catch (error) {
    logger.error('Create segment error', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to create segment' });
  }
});

module.exports = router;

