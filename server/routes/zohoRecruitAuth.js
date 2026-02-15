const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const zohoRecruitService = require('../services/zohoRecruitService');

const router = express.Router();
const adminOnly = [authenticate, requireRole('admin', 'super_admin')];

router.get('/authorize-url', ...adminOnly, async (req, res) => {
  try {
    const state = process.env.ZOHO_RECRUIT_OAUTH_STATE || '';
    const authorizeUrl = zohoRecruitService.buildAuthorizeUrl(state);
    return res.json({ success: true, data: { authorizeUrl } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/status', ...adminOnly, async (_req, res) => {
  const status = await zohoRecruitService.getConnectionStatus();
  return res.json({ success: true, data: status });
});

router.get('/callback', async (req, res) => {
  const code = String(req.query.code || '').trim();
  const state = String(req.query.state || '').trim();
  const error = String(req.query.error || '').trim();
  const errorDescription = String(req.query.error_description || '').trim();

  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Zoho authorization failed',
      details: errorDescription || error
    });
  }

  if (!code) {
    return res.status(400).json({
      success: false,
      error: 'Missing required query parameter: code'
    });
  }

  const expectedState = String(process.env.ZOHO_RECRUIT_OAUTH_STATE || '').trim();

  if (expectedState && state !== expectedState) {
    return res.status(400).json({
      success: false,
      error: 'Invalid state parameter'
    });
  }

  try {
    const payload = await zohoRecruitService.exchangeAuthorizationCode(code);

    return res.json({
      success: true,
      message: 'Zoho Recruit connected and tokens stored successfully',
      data: {
        connected: true,
        api_domain: payload.api_domain || null,
        token_type: payload.token_type || null,
        expires_in: payload.expires_in || null,
        scope: payload.scope || null,
        obtained_at: new Date().toISOString()
      }
    });
  } catch (exchangeError) {
    return res.status(500).json({
      success: false,
      error: 'Zoho token exchange failed',
      details: exchangeError.message
    });
  }
});

router.post('/jobs', ...adminOnly, async (req, res) => {
  try {
    const { jobOpening, publishToBoards = true, publishChannels = ['LinkedIn', 'Indeed'] } = req.body || {};
    if (!jobOpening || typeof jobOpening !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'jobOpening object is required'
      });
    }

    const created = await zohoRecruitService.createJobOpening(jobOpening, {
      publishToBoards,
      publishChannels
    });
    return res.json({ success: true, data: created });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/jobs/:jobOpeningId/publish', ...adminOnly, async (req, res) => {
  try {
    const { jobOpeningId } = req.params;
    const { publishChannels = ['LinkedIn', 'Indeed'] } = req.body || {};
    if (!jobOpeningId) {
      return res.status(400).json({ success: false, error: 'jobOpeningId is required' });
    }
    const result = await zohoRecruitService.publishToBoards(jobOpeningId, publishChannels);
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
