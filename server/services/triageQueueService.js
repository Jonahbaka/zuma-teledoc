/**
 * Triage Queue Service
 * Manages patient triage queue with priority scoring and real-time updates
 */

const db = require('../db');
const logger = require('../middleware/logger');
const notificationService = require('./notifications');
const aiTriageEngine = require('./aiTriageEngine');
const { keysToCamel } = require('../../lib/utils');

class TriageQueueService {
  /**
   * Create a new triage session and add to queue
   */
  async createTriageSession(patientId, triageData) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      const {
        chiefComplaint,
        symptoms,
        symptomDuration,
        symptomOnset,
        symptomSeverity,
        vitals,
        appointmentId
      } = triageData;
      
      // Run AI triage analysis
      const aiAnalysis = await aiTriageEngine.runTriage(
        `${chiefComplaint}. ${symptoms}`,
        vitals
      );
      
      // Insert triage session
      const { rows: sessionRows } = await client.query(`
        INSERT INTO triage_sessions (
          patient_id, appointment_id,
          chief_complaint, symptoms, symptom_duration, symptom_onset, symptom_severity,
          temperature, heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
          respiratory_rate, oxygen_saturation, pain_level,
          ai_severity, ai_triage_level, ai_recommended_specialty, ai_soap_draft,
          ai_suggested_medications, ai_clinical_flags, ai_differential_diagnosis,
          ai_recommended_tests, ai_confidence_score,
          affected_body_systems,
          is_emergency, emergency_flags, requires_immediate_attention,
          queue_priority, disposition
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
        RETURNING *
      `, [
        patientId,
        appointmentId || null,
        chiefComplaint,
        symptoms,
        symptomDuration || null,
        symptomOnset || null,
        symptomSeverity || null,
        vitals?.temperature || null,
        vitals?.heartRate || null,
        vitals?.systolic || null,
        vitals?.diastolic || null,
        vitals?.respiratoryRate || null,
        vitals?.oxygenSaturation || null,
        vitals?.painLevel || null,
        aiAnalysis.severity,
        aiAnalysis.triageLevel,
        aiAnalysis.suggestedSpecialty,
        aiAnalysis.soapDraft,
        JSON.stringify(aiAnalysis.suggestedMedications),
        JSON.stringify(aiAnalysis.clinicalFlags),
        JSON.stringify(aiAnalysis.differentialDiagnosis),
        JSON.stringify(aiAnalysis.recommendedTests),
        aiAnalysis.confidenceScore,
        JSON.stringify(aiAnalysis.affectedBodySystems),
        aiAnalysis.isEmergency,
        JSON.stringify(aiAnalysis.emergencyFlags),
        aiAnalysis.requiresImmediateAttention,
        aiAnalysis.priorityScore,
        'pending'
      ]);
      
      const session = keysToCamel(sessionRows[0]);
      
      // Get next queue number
      const { rows: queueCount } = await client.query(
        "SELECT COALESCE(MAX(queue_number), 0) + 1 as next_number FROM triage_queue WHERE DATE(created_at) = CURRENT_DATE"
      );
      const queueNumber = queueCount[0].next_number;
      
      // Add to queue
      const { rows: queueRows } = await client.query(`
        INSERT INTO triage_queue (
          triage_session_id, patient_id, queue_number, priority_score,
          triage_level, severity, status, estimated_wait_minutes
        ) VALUES ($1, $2, $3, $4, $5, $6, 'waiting', $7)
        RETURNING *
      `, [
        session.id,
        patientId,
        queueNumber,
        aiAnalysis.priorityScore,
        aiAnalysis.triageLevel,
        aiAnalysis.severity,
        this._calculateEstimatedWait(aiAnalysis.triageLevel)
      ]);
      
      const queueEntry = keysToCamel(queueRows[0]);
      
      // If emergency, notify providers immediately
      if (aiAnalysis.isEmergency) {
        await this._notifyProvidersOfEmergency(client, patientId, session);
      }
      
      // Auto-route if high severity
      if (aiAnalysis.routing?.autoRoute) {
        await this._autoRouteToProvider(client, session, queueEntry, aiAnalysis);
      }
      
      await client.query('COMMIT');
      
      logger.info('Triage session created', {
        sessionId: session.id,
        patientId,
        severity: aiAnalysis.severity,
        triageLevel: aiAnalysis.triageLevel,
        queueNumber
      });
      
      return {
        session,
        queueEntry,
        aiAnalysis
      };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Create triage session error:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get triage queue for providers
   */
  async getTriageQueue(providerId, options = {}) {
    const { status = 'waiting', specialty, limit = 50 } = options;
    
    let query = `
      SELECT 
        tq.*,
        ts.chief_complaint,
        ts.symptoms,
        ts.ai_severity,
        ts.ai_triage_level,
        ts.ai_recommended_specialty,
        ts.ai_clinical_flags,
        ts.is_emergency,
        ts.emergency_flags,
        ts.created_at as session_created_at,
        p.first_name as patient_first_name,
        p.last_name as patient_last_name,
        p.date_of_birth as patient_dob,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - tq.entered_queue_at)) / 60 as wait_minutes
      FROM triage_queue tq
      JOIN triage_sessions ts ON ts.id = tq.triage_session_id
      JOIN users p ON p.id = tq.patient_id
      WHERE tq.status = $1
    `;
    
    const params = [status];
    let paramIndex = 2;
    
    // Filter by specialty if provided
    if (specialty) {
      query += ` AND ts.ai_recommended_specialty = $${paramIndex}`;
      params.push(specialty);
      paramIndex++;
    }
    
    // Filter by assigned provider if not showing all
    if (!options.showAll && providerId) {
      query += ` AND (tq.assigned_provider_id IS NULL OR tq.assigned_provider_id = $${paramIndex})`;
      params.push(providerId);
      paramIndex++;
    }
    
    // Order by priority (emergencies first, then by priority score)
    query += `
      ORDER BY 
        ts.is_emergency DESC,
        tq.priority_score DESC,
        tq.entered_queue_at ASC
      LIMIT $${paramIndex}
    `;
    params.push(limit);
    
    const { rows } = await db.query(query, params);
    
    return rows.map(row => ({
      ...keysToCamel(row),
      aiClinicalFlags: row.ai_clinical_flags || [],
      emergencyFlags: row.emergency_flags || [],
      waitMinutes: Math.round(row.wait_minutes || 0)
    }));
  }
  
  /**
   * Claim/assign a triage case
   */
  async claimTriageCase(queueId, providerId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update queue entry
      const { rows } = await client.query(`
        UPDATE triage_queue
        SET assigned_provider_id = $2,
            status = 'called',
            called_at = CURRENT_TIMESTAMP,
            actual_wait_minutes = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - entered_queue_at)) / 60
        WHERE id = $1 AND (assigned_provider_id IS NULL OR assigned_provider_id = $2)
        AND status = 'waiting'
        RETURNING *
      `, [queueId, providerId]);
      
      if (rows.length === 0) {
        throw new Error('Triage case not found or already claimed');
      }
      
      // Update triage session
      await client.query(`
        UPDATE triage_sessions
        SET routed_to_provider_id = $2,
            queue_exited_at = CURRENT_TIMESTAMP,
            wait_time_minutes = $3
        WHERE id = $1
      `, [rows[0].triage_session_id, providerId, rows[0].actual_wait_minutes]);
      
      // Notify patient
      await notificationService.createNotification({
        userId: rows[0].patient_id,
        type: 'triage',
        title: 'Provider Ready',
        message: 'A provider is ready to see you. Please proceed.',
        referenceType: 'triage_queue',
        referenceId: queueId,
        actionUrl: '/patient/triage/status',
        actionText: 'View Status'
      });
      
      await client.query('COMMIT');
      
      return keysToCamel(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Start triage consultation
   */
  async startConsultation(queueId, providerId) {
    const { rows } = await db.query(`
      UPDATE triage_queue
      SET status = 'in_progress',
          started_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND assigned_provider_id = $2
      RETURNING *
    `, [queueId, providerId]);
    
    if (rows.length === 0) {
      throw new Error('Triage case not found or not assigned to you');
    }
    
    return keysToCamel(rows[0]);
  }
  
  /**
   * Complete triage consultation
   */
  async completeConsultation(queueId, providerId, disposition, notes = null) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Update queue
      const { rows } = await client.query(`
        UPDATE triage_queue
        SET status = 'completed',
            completed_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND assigned_provider_id = $2
        RETURNING *
      `, [queueId, providerId]);
      
      if (rows.length === 0) {
        throw new Error('Triage case not found or not assigned to you');
      }
      
      // Update session
      await client.query(`
        UPDATE triage_sessions
        SET disposition = $2,
            disposition_notes = $3,
            reviewed_by = $4,
            reviewed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [rows[0].triage_session_id, disposition, notes, providerId]);
      
      await client.query('COMMIT');
      
      return keysToCamel(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get queue statistics
   */
  async getQueueStats(providerId = null) {
    const stats = {};
    
    // Total waiting
    const { rows: waiting } = await db.query(
      "SELECT COUNT(*) as count FROM triage_queue WHERE status = 'waiting'"
    );
    stats.totalWaiting = parseInt(waiting[0].count);
    
    // By triage level
    const { rows: byLevel } = await db.query(`
      SELECT triage_level, COUNT(*) as count
      FROM triage_queue
      WHERE status = 'waiting'
      GROUP BY triage_level
    `);
    stats.byTriageLevel = byLevel.reduce((acc, row) => {
      acc[row.triage_level] = parseInt(row.count);
      return acc;
    }, {});
    
    // Emergencies
    const { rows: emergencies } = await db.query(`
      SELECT COUNT(*) as count
      FROM triage_queue tq
      JOIN triage_sessions ts ON ts.id = tq.triage_session_id
      WHERE tq.status = 'waiting' AND ts.is_emergency = true
    `);
    stats.emergencies = parseInt(emergencies[0].count);
    
    // Average wait time
    const { rows: avgWait } = await db.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - entered_queue_at)) / 60) as avg_wait
      FROM triage_queue
      WHERE status = 'waiting'
    `);
    stats.averageWaitMinutes = Math.round(avgWait[0].avg_wait || 0);
    
    // In progress
    const { rows: inProgress } = await db.query(
      "SELECT COUNT(*) as count FROM triage_queue WHERE status = 'in_progress'"
    );
    stats.inProgress = parseInt(inProgress[0].count);
    
    // Today's completed
    const { rows: completed } = await db.query(`
      SELECT COUNT(*) as count
      FROM triage_queue
      WHERE status = 'completed'
      AND DATE(completed_at) = CURRENT_DATE
    `);
    stats.completedToday = parseInt(completed[0].count);
    
    return stats;
  }
  
  /**
   * Get patient's triage history
   */
  async getPatientTriageHistory(patientId, limit = 20) {
    const { rows } = await db.query(`
      SELECT ts.*,
             tq.queue_number,
             tq.actual_wait_minutes,
             tq.status as queue_status,
             p.first_name as provider_first_name,
             p.last_name as provider_last_name
      FROM triage_sessions ts
      LEFT JOIN triage_queue tq ON tq.triage_session_id = ts.id
      LEFT JOIN users p ON p.id = ts.reviewed_by
      WHERE ts.patient_id = $1
      ORDER BY ts.created_at DESC
      LIMIT $2
    `, [patientId, limit]);
    
    return rows.map(r => keysToCamel(r));
  }
  
  /**
   * Get triage session by ID
   */
  async getTriageSession(sessionId, userId, userRole) {
    let query = `
      SELECT ts.*,
             tq.queue_number,
             tq.status as queue_status,
             tq.entered_queue_at,
             tq.estimated_wait_minutes,
             tq.actual_wait_minutes,
             p.first_name as patient_first_name,
             p.last_name as patient_last_name,
             prov.first_name as provider_first_name,
             prov.last_name as provider_last_name
      FROM triage_sessions ts
      LEFT JOIN triage_queue tq ON tq.triage_session_id = ts.id
      JOIN users p ON p.id = ts.patient_id
      LEFT JOIN users prov ON prov.id = ts.reviewed_by
      WHERE ts.id = $1
    `;
    
    const params = [sessionId];
    
    // Access control
    if (userRole === 'patient') {
      query += ' AND ts.patient_id = $2';
      params.push(userId);
    }
    
    const { rows } = await db.query(query, params);
    return rows.length > 0 ? keysToCamel(rows[0]) : null;
  }
  
  // Private methods
  
  _calculateEstimatedWait(triageLevel) {
    const levelInfo = aiTriageEngine.getTriageLevelInfo(triageLevel);
    return levelInfo.maxWaitMinutes;
  }
  
  async _notifyProvidersOfEmergency(client, patientId, session) {
    // Get available providers
    const { rows: providers } = await client.query(`
      SELECT id FROM users
      WHERE role = 'provider'
      AND provider_status = 'approved'
      AND is_active = true
      LIMIT 10
    `);
    
    // Send emergency notifications
    for (const provider of providers) {
      await notificationService.createNotification({
        userId: provider.id,
        type: 'triage',
        title: '🚨 EMERGENCY TRIAGE',
        message: `Emergency patient requires immediate attention. Flags: ${session.emergencyFlags?.join(', ') || 'Multiple emergency indicators'}`,
        referenceType: 'triage_session',
        referenceId: session.id,
        actionUrl: '/provider/triage',
        actionText: 'View Emergency'
      });
    }
    
    logger.warn('Emergency triage notification sent', {
      sessionId: session.id,
      patientId,
      providerCount: providers.length
    });
  }
  
  async _autoRouteToProvider(client, session, queueEntry, aiAnalysis) {
    // Find available provider with matching specialty
    const { rows: providers } = await client.query(`
      SELECT u.id, u.specialty
      FROM users u
      WHERE u.role = 'provider'
      AND u.provider_status = 'approved'
      AND u.is_active = true
      AND ($1 IS NULL OR u.specialty = $1)
      AND u.id NOT IN (
        SELECT assigned_provider_id FROM triage_queue
        WHERE status = 'in_progress'
        AND assigned_provider_id IS NOT NULL
      )
      ORDER BY
        CASE WHEN u.specialty = $1 THEN 0 ELSE 1 END,
        (SELECT COUNT(*) FROM triage_queue
         WHERE assigned_provider_id = u.id
         AND DATE(created_at) = CURRENT_DATE) ASC
      LIMIT 1
    `, [aiAnalysis.suggestedSpecialty]);
    
    if (providers.length > 0) {
      const provider = providers[0];
      
      // Assign to provider
      await client.query(`
        UPDATE triage_queue
        SET assigned_provider_id = $2,
            assigned_specialty = $3
        WHERE id = $1
      `, [queueEntry.id, provider.id, provider.specialty || aiAnalysis.suggestedSpecialty]);
      
      await client.query(`
        UPDATE triage_sessions
        SET auto_routed = true,
            routed_to_provider_id = $2,
            routed_to_specialty = $3,
            routing_reason = $4
        WHERE id = $1
      `, [session.id, provider.id, provider.specialty || aiAnalysis.suggestedSpecialty, aiAnalysis.routing.reason]);
      
      // Notify provider
      await notificationService.createNotification({
        userId: provider.id,
        type: 'triage',
        title: 'New Triage Assignment',
        message: `A ${aiAnalysis.triageLevel} priority patient has been assigned to you.`,
        referenceType: 'triage_session',
        referenceId: session.id,
        actionUrl: '/provider/triage',
        actionText: 'View Patient'
      });
      
      logger.info('Auto-routed triage case', {
        sessionId: session.id,
        providerId: provider.id,
        specialty: provider.specialty
      });
    }
  }
}

module.exports = new TriageQueueService();

