'use strict';

const express = require('express');
const { z } = require('zod');
const { getPool } = require('../../server/db');
const { requireProgrammeScope } = require('../middleware/programmeScope');
const { recordProgrammeAudit } = require('../services/phc/programmeScopeService');
const { requireGovernmentMfa } = require('../middleware/rbac');
const router = express.Router();
const roles = ['facility_admin', 'programme_admin'];
const partnerSchema = z.object({
  partnerKey: z.string().trim().regex(/^[a-z0-9_-]{2,80}$/),
  displayName: z.string().trim().min(2).max(160),
  onboardingStatus: z.enum(['prospect', 'review', 'contracted', 'sandbox', 'suspended', 'ended']).default('review'),
  submissionChannel: z.enum(['unconfirmed', 'manual', 'batch', 'api', 'fhir']).default('unconfirmed'),
  contractReference: z.string().trim().max(200).nullable().optional(),
});

router.use(requireProgrammeScope({ allowedRoles: roles }));
router.use((req, res, next) => req.programmeContext.programmeRole === 'programme_admin' ? requireGovernmentMfa(req, res, next) : next());
router.get('/partners', async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, partner_key, display_name, onboarding_status, submission_channel,
              contract_reference, version, updated_at FROM ng_insurance_partners
        WHERE programme_id = $1 ORDER BY display_name`, [req.programmeContext.programme_id]
    );
    res.json({ ok: true, partners: rows, liveAdaptersAvailable: false });
  } catch (error) {
    res.status(['42P01', '42703'].includes(error.code) ? 503 : 500).json({ error: 'Partner registry is unavailable. Verify the funding migration.' });
  }
});
router.post('/partners', async (req, res) => {
  const input = partnerSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Partner details are invalid.' });
  try {
    const data = input.data;
    const context = req.programmeContext;
    const { rows } = await getPool().query(
      `INSERT INTO ng_insurance_partners
        (programme_id, partner_key, display_name, onboarding_status, submission_channel, contract_reference, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id, display_name, onboarding_status, version`,
      [context.programme_id, data.partnerKey, data.displayName, data.onboardingStatus, data.submissionChannel, data.contractReference || null, context.userId]
    );
    await recordProgrammeAudit(getPool(), req, context, { action: 'funding.partner_created', resourceType: 'insurance_partner', resourceId: rows[0].id, metadata: { status: data.onboardingStatus } });
    res.status(201).json({ ok: true, partner: rows[0] });
  } catch (error) {
    res.status(error.code === '23505' ? 409 : ['42P01', '42703'].includes(error.code) ? 503 : 500).json({ error: error.code === '23505' ? 'This partner is already registered for the programme.' : 'Partner could not be saved.' });
  }
});
module.exports = router;
