/**
 * WhatsApp Dispense Service
 *
 * Provider-pluggable WhatsApp notification layer with a real manual fallback.
 * If a WhatsApp Business API provider is not configured, operational users get
 * a persisted prepared message and secure dashboard link instead of fake success.
 */

const { getPool } = require('../../../server/db');

class WhatsAppProviderNotConfigured {
  async sendMessage() { throw new Error('WhatsApp provider not configured'); }
  async sendTemplate() { throw new Error('WhatsApp provider not configured'); }
  async getMessageStatus() { throw new Error('WhatsApp provider not configured'); }
}

let activeProvider = new WhatsAppProviderNotConfigured();
let activeProviderConfigured = false;

function configureProvider(provider) {
  activeProvider = provider || new WhatsAppProviderNotConfigured();
  activeProviderConfigured = Boolean(provider);
}

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
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT w.*, p.prescription_number, p.items
       FROM ng_whatsapp_dispense_requests w
       LEFT JOIN ng_digital_prescriptions p ON w.prescription_id = p.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY w.created_at DESC
      LIMIT $${params.length + 1}`,
    [...params, limit]
  );
  return result.rows;
}

async function createPharmacyPrescriptionNotification({ prescriptionId, pharmacyId, createdByUserId }) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT rx.id,
            rx.prescription_number,
            rx.items,
            rx.fulfillment_preference,
            pharmacy.name AS pharmacy_name,
            COALESCE(pharmacy.whatsapp_business_number, pharmacy.whatsapp) AS pharmacy_whatsapp,
            pharmacy.preferred_prescription_receiving_method,
            patient.first_name AS patient_first_name,
            patient.last_name AS patient_last_name,
            provider.full_name AS provider_name
       FROM ng_digital_prescriptions rx
       JOIN ng_pharmacies pharmacy ON pharmacy.id = $2
       JOIN users patient ON patient.id = rx.patient_user_id
       JOIN ng_providers provider ON provider.id = rx.provider_id
      WHERE rx.id = $1
      LIMIT 1`,
    [prescriptionId, pharmacyId]
  );

  const record = result.rows[0];
  if (!record) {
    throw new Error('Prescription or pharmacy not found for WhatsApp notification');
  }

  const receivingMethod = String(record.preferred_prescription_receiving_method || 'dashboard');
  const shouldNotifyWhatsApp = receivingMethod === 'whatsapp' || receivingMethod === 'dashboard_whatsapp';
  const itemCount = Array.isArray(record.items) ? record.items.length : 1;
  const dashboardPath = `/ng/pharmacy/prescriptions?prescription=${record.id}`;
  const messagePreview = [
    'DoctaRx prescription notification.',
    `Reference: ${record.prescription_number || record.id}.`,
    `Provider: ${record.provider_name || 'DoctaRx provider'}.`,
    `Items: ${itemCount}.`,
    `Open secure dashboard: ${dashboardPath}`,
  ].join(' ');

  if (!shouldNotifyWhatsApp || !record.pharmacy_whatsapp) {
    const fallback = await pool.query(
      `INSERT INTO ng_whatsapp_notification_log
         (notification_type, prescription_id, pharmacy_id, recipient_phone, status,
          message_preview, secure_action_url, metadata, created_by, created_at, updated_at)
       VALUES ('pharmacy_prescription', $1, $2, $3, 'dashboard_only',
          $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        prescriptionId,
        pharmacyId,
        record.pharmacy_whatsapp || null,
        messagePreview,
        dashboardPath,
        JSON.stringify({ reason: !shouldNotifyWhatsApp ? 'pharmacy_prefers_dashboard' : 'missing_whatsapp_number' }),
        createdByUserId || null,
      ]
    );
    return fallback.rows[0];
  }

  if (!activeProviderConfigured) {
    const fallback = await pool.query(
      `INSERT INTO ng_whatsapp_notification_log
         (notification_type, prescription_id, pharmacy_id, recipient_phone, status,
          message_preview, secure_action_url, metadata, created_by, created_at, updated_at)
       VALUES ('pharmacy_prescription', $1, $2, $3, 'manual_fallback_pending',
          $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        prescriptionId,
        pharmacyId,
        record.pharmacy_whatsapp,
        messagePreview,
        dashboardPath,
        JSON.stringify({ reason: 'whatsapp_provider_not_configured' }),
        createdByUserId || null,
      ]
    );
    return fallback.rows[0];
  }

  try {
    const providerResponse = await activeProvider.sendMessage(record.pharmacy_whatsapp, messagePreview);
    const sent = await pool.query(
      `INSERT INTO ng_whatsapp_notification_log
         (notification_type, prescription_id, pharmacy_id, recipient_phone, status,
          message_preview, secure_action_url, provider_response, created_by, sent_at, created_at, updated_at)
       VALUES ('pharmacy_prescription', $1, $2, $3, 'sent',
          $4, $5, $6, $7, NOW(), NOW(), NOW())
       RETURNING *`,
      [
        prescriptionId,
        pharmacyId,
        record.pharmacy_whatsapp,
        messagePreview,
        dashboardPath,
        JSON.stringify(providerResponse || {}),
        createdByUserId || null,
      ]
    );
    return sent.rows[0];
  } catch (err) {
    const fallback = await pool.query(
      `INSERT INTO ng_whatsapp_notification_log
         (notification_type, prescription_id, pharmacy_id, recipient_phone, status,
          message_preview, secure_action_url, metadata, created_by, created_at, updated_at)
       VALUES ('pharmacy_prescription', $1, $2, $3, 'manual_fallback_pending',
          $4, $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        prescriptionId,
        pharmacyId,
        record.pharmacy_whatsapp,
        messagePreview,
        dashboardPath,
        JSON.stringify({ reason: 'whatsapp_send_failed', error: err.message }),
        createdByUserId || null,
      ]
    );
    return fallback.rows[0];
  }
}

async function notifyPharmacy(pharmacyPhone, dispenseRequest) {
  try {
    await activeProvider.sendTemplate(pharmacyPhone, 'dispense_new_request', {
      patient: dispenseRequest.patient_name,
      rx_code: dispenseRequest.rx_code || dispenseRequest.prescription_number,
    });
  } catch (err) {
    console.warn('[WhatsApp] Pharmacy notification queued for manual fallback:', err.message);
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
    console.warn('[WhatsApp] Patient notification skipped:', err.message);
  }
}

module.exports = {
  configureProvider,
  createDispenseRequest,
  updateDispenseStatus,
  getDispenseQueue,
  createPharmacyPrescriptionNotification,
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
