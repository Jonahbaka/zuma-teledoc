'use strict';
const express = require('express');
const { createLiveVoiceBroker } = require('../services/voice/liveVoiceBroker');
function createVoiceLiveRouter({ authenticate, broker = createLiveVoiceBroker() }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.use(authenticate);
  const actor = req => Object.freeze({ ...req.user, voiceAuth: req.authSessionContext });
  const run = (handler, { cleanup = false } = {}) => async (req, res) => {
    if (!req.user?.id || !cleanup && !['provider', 'admin', 'super_admin'].includes(req.user?.role)) return res.status(403).json({ code: 'VOICE_ACCESS_DENIED' });
    try { res.json({ success: true, ...await handler(req) }); }
    catch (error) { res.status(error.statusCode || 503).json({ success: false, code: /^VOICE_[A-Z_]+$/.test(error.code || '') ? error.code : 'VOICE_UNAVAILABLE', error: 'The live voice prototype is unavailable. No clinical action was performed.' }); }
  };
  router.get('/capabilities', run(() => ({ capabilities: broker.capabilities() })));
  router.post('/permits', run(req => broker.reserve(actor(req), req.body)));
  router.post('/permits/:permitId/connect', run(req => broker.connect(actor(req), req.params.permitId, req.body)));
  router.post('/permits/:permitId/stop', run(req => broker.stop(actor(req), req.params.permitId), { cleanup: true }));
  router.post('/permits/:permitId/lease', run(req => broker.lease(actor(req), req.params.permitId)));
  return router;
}
// No provider or approval implementation is installed at the shipped mount.
// An environment variable or client consent checkbox cannot turn this on.
module.exports = createVoiceLiveRouter({ authenticate: require('../middleware/auth').authenticate });
module.exports.createVoiceLiveRouter = createVoiceLiveRouter;
