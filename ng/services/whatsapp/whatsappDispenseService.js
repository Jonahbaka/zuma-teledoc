/**
 * WhatsApp Dispense Service — Architecture Layer
 *
 * This module provides the service interface for WhatsApp-assisted
 * prescription dispensing. The actual WhatsApp Business API integration
 * is pending — this layer is designed for easy provider plug-in.
 *
 * Status: PENDING — no live WhatsApp integration.
 * When ready, implement a WhatsAppProvider that satisfies IWhatsAppProvider.
 */

const { getPool } = require('../../../server/db');

// ─── Provider Interface (implement when WhatsApp Business API is ready) ───────

class WhatsAppProviderNotConfigured {
  async sendMessage() { throw new Error('WhatsApp provider not configured'); }
  async sendTemplate() { throw new Error('WhatsApp provider not configured'); }
  async getMessageStatus() { throw new Error('WhatsApp provider not configured'); }
}

// Swap this with a real provider (e.g., Twilio, Meta Cloud API, Termii) when ready
let activeProvider = new WhatsAppProviderNotConfigured();

function configureProvider(provider) {
  activeProvider = provider;
}

// ─── Dispense Request Lifecycle ───────────────────────────────────────────────

async function createDispenseRequest({ prescriptionId, pharmacyId, patientPhone, patientName }) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO ng_whatsapp_dispense_requests
       (prescription_id, pharmacy_id, patient_phone, patient_name, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING *`,
    [prescriptionId, pharmacyId, patientPhone, patientName]
  );
  return result.rows[0];
}

async function updateDispenseStatus(requestId, status, notes = '') {
  const pool = getPool();
  await pool.query(
    `UPDATE ng_whatsapp_dispense_requests
     SET status = $1, notes = $2, updated_at = NOW()
     WHERE id = $3`,
    [status, notes, requestId]
  );
}

async function getDispenseQueue(pharmacyId, { limit = 20, status } = {}) {
  const pool = getPool();
  const conditions = ['pharmacy_id = $1'];
  const params = [pharmacyId];
  if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
  const result = await pool.query(
    `SELECT w.*, p.rx_code, p.patient_name as rx_patient_name
     FROM ng_whatsapp_dispense_requests w
     LEFT JOIN ng_digital_prescriptions p ON w.prescription_id = p.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY w.created_at DESC
     LIMIT $${params.length + 1}`,
    [...params, limit]
  );
  return result.rows;
}

// ─── Notification Helpers (no-op until provider configured) ──────────────────

async function notifyPharmacy(pharmacyPhone, dispenseRequest) {
  try {
    await activeProvider.sendTemplate(pharmacyPhone, 'dispense_new_request', {
      patient: dispenseRequest.patient_name,
      rx_code: dispenseRequest.rx_code,
    });
  } catch (err) {
    console.warn('[WhatsApp] Pharmacy notification skipped — provider not configured:', err.message);
  }
}

async function notifyPatient(patientPhone, status, pharmacyName) {
  try {
    const templates = {
      confirmed: 'dispense_confirmed',
      ready: 'dispense_ready_for_pickup',
      dispensed: 'dispense_completed',
    };
    if (templates[status]) {
      await activeProvider.sendTemplate(patientPhone, templates[status], { pharmacy: pharmacyName });
    }
  } catch (err) {
    console.warn('[WhatsApp] Patient notification skipped — provider not configured:', err.message);
  }
}

module.exports = {
  configureProvider,
  createDispenseRequest,
  updateDispenseStatus,
  getDispenseQueue,
  notifyPharmacy,
  notifyPatient,
  STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    READY: 'ready_for_pickup',
    DISPENSED: 'dispensed',
    REJECTED: 'rejected',
    EXPIRED: 'expired',
  },
};
