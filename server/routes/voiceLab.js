'use strict';
const express = require('express');
const { createSyntheticVoiceSessionService } = require('../services/voice/syntheticVoiceSessionService');

function createVoiceLabRouter({ authenticate, service = createSyntheticVoiceSessionService() }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(authenticate);
  router.use((req, res, next) => {
    if (!['provider', 'admin', 'super_admin'].includes(req.user?.role)) return res.status(403).json({ success: false, code: 'VOICE_ACCESS_DENIED', error: 'Clinician or administrator access is required.' });
    next();
  });
  const respond = handler => (req, res) => {
    try { res.json({ success: true, ...handler(req) }); }
    catch (error) {
      // Do not log request payloads or include untrusted error strings.
      const known = /^VOICE_[A-Z_]+$/.test(error.code || '');
      res.status(known ? error.statusCode : 503).json({ success: false, code: known ? error.code : 'VOICE_UNAVAILABLE',
        error: known ? error.message : 'The synthetic voice lab is unavailable.' });
    }
  };
  router.get('/capabilities', respond(() => ({ capabilities: service.capabilities() })));
  router.post('/sessions', respond(req => ({ session: service.create(req.user, req.body) })));
  router.get('/sessions/:sessionId', respond(req => ({ session: service.read(req.user, req.params.sessionId) })));
  router.post('/sessions/:sessionId/commands', respond(req => ({ session: service.execute(req.user, req.params.sessionId, req.body) })));
  return router;
}
// Retain the normal authenticated-session middleware on the production mount.
const router = createVoiceLabRouter({ authenticate: require('../middleware/auth').authenticate });
module.exports = router;
module.exports.createVoiceLabRouter = createVoiceLabRouter;
