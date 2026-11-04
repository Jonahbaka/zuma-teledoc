/**
 * ng/routes/soap.js
 * Read-only SOAP template API.
 *   GET /templates
 *   GET /templates/:key
 *   GET /templates?q=…   — alias for search
 */

const express = require('express');
const router = express.Router();
const tpl = require('../../lib/ng/soapTemplates');

router.get('/templates', (req, res) => {
  try {
    const q = req.query.q || '';
    res.json({ ok: true, templates: q ? tpl.searchTemplates(q) : tpl.listTemplates() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/templates/:key', (req, res) => {
  const t = tpl.getTemplate(req.params.key);
  if (!t) return res.status(404).json({ ok: false, error: 'Template not found' });
  res.json({ ok: true, template: t, applied: tpl.applyTemplate(t) });
});

module.exports = router;
