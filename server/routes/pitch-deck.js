const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

router.get('/', (req, res) => {
  const filePath = path.join(process.cwd(), 'public', 'DoctaRx-Pitch-Deck.html');
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Pitch deck not found' });
  }
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(filePath);
});

module.exports = router;
