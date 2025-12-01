/**
 * Real-Time Benefit Check (RTBC) API Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const rtbcService = require('../services/rtbcService');

// Get RTBC for medication
router.get('/check', authenticate, async (req, res) => {
  try {
    const { medicationName, ndcCode, insuranceId } = req.query;
    
    if (!medicationName) {
      return res.status(400).json({ success: false, error: 'medicationName is required' });
    }
    
    const rtbc = await rtbcService.getRTBC(
      req.user.id,
      medicationName,
      ndcCode || null,
      insuranceId || null
    );
    
    res.json({ success: true, rtbc });
  } catch (error) {
    console.error('Error getting RTBC:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Compare prices
router.post('/compare', authenticate, async (req, res) => {
  try {
    const { medicationName, ndcCode, hasGoldCard } = req.body;
    
    if (!medicationName) {
      return res.status(400).json({ success: false, error: 'medicationName is required' });
    }
    
    // Check if user has gold card
    const db = require('../db');
    const userResult = await db.pool.query(
      'SELECT access_level FROM users WHERE id = $1',
      [req.user.id]
    );
    const userHasGoldCard = userResult.rows[0]?.access_level === 'gold_monthly' || 
                           userResult.rows[0]?.access_level === 'gold_yearly';
    
    const comparison = await rtbcService.comparePrices(
      req.user.id,
      medicationName,
      ndcCode || null,
      hasGoldCard || userHasGoldCard
    );
    
    res.json({ success: true, ...comparison });
  } catch (error) {
    console.error('Error comparing prices:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

