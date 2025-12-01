/**
 * Triage API Routes
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const triageService = require('../services/triageService');
const db = require('../db');
const logger = require('../middleware/logger');

// Store patient triage results
router.post('/', authenticate, auditMiddleware('create', 'triage'), async (req, res) => {
  try {
    const { appointmentId, symptoms, triageResult } = req.body;
    
    // 1. Validate Payload
    if (!appointmentId || !symptoms || !triageResult) {
      logger.error('[Triage API] Missing fields:', { appointmentId, hasSymptoms: !!symptoms, hasResult: !!triageResult });
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    // 2. Validate Appointment Ownership safely
    const { rows } = await db.query(
      'SELECT id, patient_id FROM appointments WHERE id = $1',
      [appointmentId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }
    
    if (rows[0].patient_id !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        error: 'Unauthorized: Appointment does not belong to this patient' 
      });
    }
    
    // 3. Store Data
    const result = await triageService.storeTriage(
      req.user.id,
      appointmentId,
      symptoms,
      triageResult
    );
    
    logger.info(`[Triage API] Saved successfully for Appointment ${appointmentId}`);
    res.status(201).json({ success: true, appointment: result });
  } catch (error) {
    logger.error('[Triage API] Error saving triage:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get triage for appointment
router.get('/appointment/:appointmentId', authenticate, async (req, res) => {
  try {
    const triageData = await triageService.getTriageForAppointment(req.params.appointmentId);
    
    if (!triageData) {
      return res.status(404).json({ success: false, error: 'Triage data not found' });
    }
    
    res.json({ success: true, triage: triageData });
  } catch (error) {
    logger.error('Error fetching triage:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch triage data' });
  }
});

// Get all appointments with triage (for provider)
router.get('/provider/appointments', authenticate, async (req, res) => {
  try {
    // Check role
    if (!['provider', 'admin', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Only providers can access this' });
    }
    
    // Get appointments
    const appointments = await triageService.getAppointmentsWithTriage(req.user.id);
    
    res.json({ success: true, appointments: appointments || [] });
  } catch (error) {
    logger.error('[Triage API] Error fetching provider appointments:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;

