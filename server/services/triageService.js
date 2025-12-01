/**
 * Triage Service
 * Handles patient triage data storage and retrieval
 */

const db = require('../db');
const logger = require('../middleware/logger');
const { keysToCamel } = require('../../lib/utils');

class TriageService {
  /**
   * Store patient triage results
   */
  async storeTriage(patientId, appointmentId, symptoms, triageResult) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Check if metadata column exists, create it if not
      const checkColumn = await client.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'appointments' AND column_name = 'metadata'`
      );
      
      if (checkColumn.rows.length === 0) {
        await client.query(`
          ALTER TABLE appointments ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb
        `);
      }
      
      // Verify appointment exists and belongs to patient
      const appointmentCheck = await client.query(
        'SELECT id, patient_id FROM appointments WHERE id = $1',
        [appointmentId]
      );
      
      if (appointmentCheck.rows.length === 0) {
        throw new Error('Appointment not found');
      }
      
      if (appointmentCheck.rows[0].patient_id !== patientId) {
        throw new Error('Appointment does not belong to this patient');
      }
      
      // Update appointment with triage data in metadata
      const updateQuery = `
        UPDATE appointments
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'triage', jsonb_build_object(
            'severity', $1::int,
            'soapDraft', $2::text,
            'triageLevel', $3::text,
            'suggestedSpecialty', $4::text,
            'flags', $5::jsonb,
            'suggestedMeds', $6::jsonb,
            'symptoms', $7::text,
            'timestamp', CURRENT_TIMESTAMP
          )
        )
        WHERE id = $8
        RETURNING *
      `;
      
      // SAFE SERIALIZATION: Ensure we never pass 'undefined' to JSON.stringify
      const flagsJson = JSON.stringify(Array.isArray(triageResult.flags) ? triageResult.flags : []);
      const medsJson = JSON.stringify(Array.isArray(triageResult.suggestedMeds) ? triageResult.suggestedMeds : []);
      
      const result = await client.query(updateQuery, [
        triageResult.severity || 0,
        triageResult.soapDraft || '',
        triageResult.triageLevel || (triageResult.severity >= 4 ? 'URGENT' : 'ROUTINE'),
        triageResult.suggestedSpecialty || 'Primary Care',
        flagsJson, // $5 passed as string, cast to ::jsonb in SQL
        medsJson,  // $6 passed as string, cast to ::jsonb in SQL
        symptoms,
        appointmentId
      ]);
      
      if (result.rows.length === 0) {
        throw new Error('Failed to update appointment with triage data');
      }
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error storing triage:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Get triage data for appointment
   */
  async getTriageForAppointment(appointmentId) {
    try {
      // Check if metadata column exists
      const checkColumn = await db.pool.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'appointments' AND column_name = 'metadata'`
      );
      
      if (checkColumn.rows.length === 0) {
        return null;
      }
      
      const result = await db.pool.query(
        `SELECT metadata->'triage' as triage_data
         FROM appointments
         WHERE id = $1`,
        [appointmentId]
      );
      
      if (result.rows.length === 0 || !result.rows[0].triage_data || result.rows[0].triage_data === null) {
        return null;
      }
      
      return result.rows[0].triage_data;
    } catch (error) {
      logger.error('Error fetching triage for appointment:', error);
      return null;
    }
  }
  
  /**
   * Get all appointments with triage data for provider
   */
  async getAppointmentsWithTriage(providerId) {
    try {
      // Check if metadata column exists, if not return empty array
      const checkColumn = await db.pool.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'appointments' AND column_name = 'metadata'`
      );
      
      if (checkColumn.rows.length === 0) {
        // Metadata column doesn't exist yet, return empty array
        return [];
      }
      
      // Query appointments
      // We strictly check jsonb_typeof to ensure we aren't pulling null JSON values
      const query = `
        SELECT a.*,
               p.first_name as patient_first_name,
               p.last_name as patient_last_name,
               p.email as patient_email,
               p.phone as patient_phone,
               p.date_of_birth as patient_dob,
               a.metadata->'triage' as triage_data
        FROM appointments a
        JOIN users p ON p.id = a.patient_id
        WHERE a.provider_id = $1
        AND a.metadata IS NOT NULL
        AND a.metadata ? 'triage'
        AND jsonb_typeof(a.metadata->'triage') = 'object'
        ORDER BY COALESCE((a.metadata->'triage'->>'severity')::int, 0) DESC, a.scheduled_at ASC
      `;
      const result = await db.pool.query(query, [providerId]);
      
      return result.rows.map(row => {
        const appointment = keysToCamel(row);
        // Ensure triageData is attached cleanly
        appointment.triageData = row.triage_data; 
        return appointment;
      });
    } catch (error) {
      logger.error('Error fetching appointments with triage:', error);
      return [];
    }
  }
}

module.exports = new TriageService();

