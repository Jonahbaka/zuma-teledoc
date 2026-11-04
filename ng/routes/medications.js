/**
 * ng/routes/medications.js
 *
 * Medication search v2 API. Mounted at /api/ng/medications.
 *   GET  /search?q=…&limit=…
 *   GET  /autocomplete?q=…&limit=…
 *   POST /check-interactions   { generics: ["warfarin", "ibuprofen"] }
 *
 * All endpoints are public (no PHI). Heavy queries are limited at the
 * service layer (MAX_LIMIT=50).
 */

const express = require('express');
const router = express.Router();
const svc = require('../services/rx-engine/medicationSearchV2');

router.get('/search', async (req, res) => {
  try {
    const out = await svc.search({
      q: req.query.q || '',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      category: req.query.category || undefined,
      requiresPrescription:
        req.query.rx === 'true' ? true :
        req.query.rx === 'false' ? false : undefined,
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[NG/Meds] search', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/autocomplete', async (req, res) => {
  try {
    const out = await svc.autocomplete(
      req.query.q || '',
      Math.min(20, Number(req.query.limit) || 8)
    );
    res.json({ ok: true, suggestions: out });
  } catch (err) {
    console.error('[NG/Meds] autocomplete', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/check-interactions', express.json(), async (req, res) => {
  try {
    const generics = Array.isArray(req.body?.generics) ? req.body.generics : [];
    const out = await svc.checkInteractions(generics);
    res.json({ ok: true, interactions: out });
  } catch (err) {
    console.error('[NG/Meds] check-interactions', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
