/**
 * Nigeria Provider Routes
 * Registration, verification, appointments, earnings
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../../server/db');
const { authenticate, requireRole } = require('../../server/middleware/auth');
const {
  ensureProviderAccessForUser,
  recordProviderUsage,
  requireActiveProviderToolAccess,
} = require('../services/providers/providerAccessService');
const whatsappDispenseService = require('../services/whatsapp/whatsappDispenseService');

const SPECIALTY_MAP = {
  'family medicine': 'general_practice',
  'general practice': 'general_practice',
  'general_practice': 'general_practice',
  'primary care': 'general_practice',
  'internal medicine': 'internal_medicine',
  'internal_medicine': 'internal_medicine',
  pediatrics: 'pediatrics',
  paediatrics: 'pediatrics',
  obgyn: 'obstetrics_gynecology',
  'ob/gyn': 'obstetrics_gynecology',
  'obstetrics and gynecology': 'obstetrics_gynecology',
  'obstetrics & gynecology': 'obstetrics_gynecology',
  cardiology: 'cardiology',
  dermatology: 'dermatology',
  psychiatry: 'psychiatry',
  orthopedics: 'orthopedics',
  orthopaedics: 'orthopedics',
  ophthalmology: 'ophthalmology',
  ent: 'ent',
  urology: 'urology',
  neurology: 'neurology',
  oncology: 'oncology',
  radiology: 'radiology',
  surgery: 'surgery',
};

function normalizeSpecialty(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-_]+/g, ' ');
  return SPECIALTY_MAP[normalized] || 'other';
}

function buildPrescriptionNumber() {
  return `DTRX-NG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

function isAdmin(user) {
  return ADMIN_ROLES.has(String(user?.role || '').toLowerCase());
}

async function requireProviderOwnerOrAdmin(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT id, user_id FROM ng_providers WHERE id = $1',
      [req.params.providerId]
    );
    const provider = result.rows[0];
    if (!provider) return res.status(404).json({ error: 'Provider not found' });
    if (isAdmin(req.user) || provider.user_id === req.user.id) {
      req.ngProvider = provider;
      return next();
    }
    return res.status(403).json({ error: 'Provider access denied' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// --- PROVIDER REGISTRATION ---

router.post('/register', authenticate, requireRole(['provider']), async (req, res) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const {
      full_name, email, phone, gender, mdcn_number,
      specialty, sub_specialty, years_experience, qualifications,
      practice_name, practice_address, practice_city, practice_state,
      consult_fee_general, consult_fee_specialist, bio, languages,
    } = req.body;
    const user_id = req.user.id;

    if (!full_name || !email || !phone || !mdcn_number || !specialty) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM ng_providers WHERE mdcn_number = $1 OR email = $2',
      [mdcn_number, email]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Provider already registered with this MDCN number or email' });
    }

    const result = await client.query(`
      INSERT INTO ng_providers (
        user_id, full_name, email, phone, gender, mdcn_number,
        specialty, sub_specialty, years_experience, qualifications,
        practice_name, practice_address, practice_city, practice_state,
        consult_fee_general, consult_fee_specialist, bio, languages,
        status, trial_status, subscription_status, access_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending','not_started','inactive','pending_approval')
      RETURNING id, status
    `, [
      user_id, full_name, email, phone, gender, mdcn_number,
      normalizeSpecialty(specialty), sub_specialty || null, years_experience || 0,
      JSON.stringify(qualifications || []),
      practice_name, practice_address, practice_city, practice_state,
      consult_fee_general || 3000, consult_fee_specialist || 8000,
      bio || null, languages || [],
    ]);

    await client.query(
      `UPDATE users
          SET region = 'NG',
              market_scope = 'NG',
              provider_status = COALESCE(provider_status, 'pending'),
              updated_at = NOW()
        WHERE id = $1`,
      [user_id]
    );

    await client.query('COMMIT');
    res.status(201).json({ provider: result.rows[0], message: 'Registration submitted. Verification pending.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/me/access', authenticate, requireRole(['provider']), async (req, res) => {
  try {
    const access = await ensureProviderAccessForUser(req.user.id, { startTrialIfEligible: true });
    res.json({ providerAccess: access });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/pharmacies', authenticate, requireRole(['provider', 'admin']), async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(
      `SELECT id, name, city, state, phone, whatsapp, whatsapp_business_number,
              preferred_prescription_receiving_method, delivery_enabled,
              status, account_status
         FROM ng_pharmacies
        WHERE status = 'approved'
           OR owner_user_id = $1
        ORDER BY is_featured DESC, name ASC
        LIMIT 100`,
      [req.user.id]
    );
    res.json({ pharmacies: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/prescriptions', authenticate, requireRole(['provider']), async (req, res) => {
  const pool = getPool();
  try {
    const provider = await pool.query('SELECT id FROM ng_providers WHERE user_id = $1 LIMIT 1', [req.user.id]);
    if (!provider.rows.length) {
      return res.json({ prescriptions: [] });
    }

    const result = await pool.query(
      `SELECT rx.*,
              patient.first_name AS patient_first_name,
              patient.last_name AS patient_last_name,
              patient.email AS patient_email,
              pharmacy.name AS pharmacy_name,
              pharmacy.phone AS pharmacy_phone,
              pharmacy.whatsapp_business_number
         FROM ng_digital_prescriptions rx
         JOIN users patient ON patient.id = rx.patient_user_id
         LEFT JOIN ng_pharmacies pharmacy ON pharmacy.id = COALESCE(rx.routed_pharmacy_id, rx.preferred_pharmacy_id, rx.dispensed_by_pharmacy_id)
        WHERE rx.provider_id = $1
        ORDER BY rx.created_at DESC
        LIMIT 100`,
      [provider.rows[0].id]
    );
    res.json({ prescriptions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/prescriptions',
  authenticate,
  requireRole(['provider']),
  requireActiveProviderToolAccess,
  async (req, res) => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      const {
        patientUserId,
        appointmentId,
        items,
        preferredPharmacyId,
        routedPharmacyId,
        diagnosis,
        notes,
        fulfillmentPreference,
      } = req.body;

      if (!patientUserId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Patient and at least one medication item are required.' });
      }

      await client.query('BEGIN');

      const provider = await client.query('SELECT id FROM ng_providers WHERE user_id = $1 LIMIT 1', [req.user.id]);
      if (!provider.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Nigeria provider profile is not completed.' });
      }

      const pharmacyId = routedPharmacyId || preferredPharmacyId || null;
      if (pharmacyId) {
        const pharmacy = await client.query('SELECT id FROM ng_pharmacies WHERE id = $1 LIMIT 1', [pharmacyId]);
        if (!pharmacy.rows.length) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Selected pharmacy was not found.' });
        }
      }

      const prescriptionResult = await client.query(
        `INSERT INTO ng_digital_prescriptions (
           provider_id, patient_user_id, appointment_id, prescription_number,
           items, preferred_pharmacy_id, routed_pharmacy_id, routed_at,
           status, dispense_status, pharmacy_response_status,
           diagnosis, notes, fulfillment_preference, is_controlled
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,CASE WHEN $7 IS NOT NULL THEN NOW() ELSE NULL END,
           $8,'pending','pending_pharmacy_confirmation',
           $9,$10,$11,$12
         )
         RETURNING *`,
        [
          provider.rows[0].id,
          patientUserId,
          appointmentId || null,
          buildPrescriptionNumber(),
          JSON.stringify(items),
          preferredPharmacyId || null,
          routedPharmacyId || preferredPharmacyId || null,
          pharmacyId ? 'routed' : 'active',
          diagnosis || null,
          notes || null,
          fulfillmentPreference || 'pickup_or_delivery',
          items.some((item) => item.isControlled === true || item.controlledOrSpecialHandling === true),
        ]
      );

      await client.query('COMMIT');
      await recordProviderUsage(req.user.id, 'prescription_issued', {
        metadata: { prescriptionId: prescriptionResult.rows[0].id, routed: Boolean(pharmacyId) },
      }).catch(() => null);

      let whatsappNotification = null;
      if (pharmacyId) {
        whatsappNotification = await whatsappDispenseService
          .createPharmacyPrescriptionNotification({
            prescriptionId: prescriptionResult.rows[0].id,
            pharmacyId,
            createdByUserId: req.user.id,
          })
          .catch(() => null);
      }

      res.status(201).json({
        prescription: prescriptionResult.rows[0],
        whatsappNotification,
        message: pharmacyId
          ? 'Prescription routed to the selected pharmacy for confirmation.'
          : 'Prescription created. Select a pharmacy to route fulfillment.',
      });
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        // no-op
      }
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

// --- PROVIDER PROFILE ---

router.get('/profile/:providerId', authenticate, requireProviderOwnerOrAdmin, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(
      'SELECT * FROM ng_providers WHERE id = $1',
      [req.params.providerId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Provider not found' });
    res.json({ provider: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/profile/:providerId', authenticate, requireProviderOwnerOrAdmin, async (req, res) => {
  const pool = getPool();
  try {
    const allowed = [
      'bio', 'languages', 'consult_fee_general', 'consult_fee_specialist',
      'availability_schedule', 'is_available', 'bank_name',
      'bank_account_number', 'bank_account_name', 'bank_code',
      'practice_name', 'practice_address', 'practice_city', 'practice_state',
    ];
    const updates = Object.keys(req.body)
      .filter(k => allowed.includes(k))
      .map((k, i) => `${k} = $${i + 2}`);
    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    const values = allowed.filter(k => req.body[k] !== undefined).map(k => req.body[k]);
    await pool.query(
      `UPDATE ng_providers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [req.params.providerId, ...values]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PROVIDER EARNINGS ---

router.get('/:providerId/earnings', authenticate, requireProviderOwnerOrAdmin, async (req, res) => {
  const pool = getPool();
  try {
    const summary = await pool.query(
      'SELECT total_earned, total_paid_out, pending_payout, total_consultations FROM ng_providers WHERE id = $1',
      [req.params.providerId]
    );
    const ledger = await pool.query(
      'SELECT * FROM ng_provider_earnings WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.params.providerId]
    );
    res.json({ summary: summary.rows[0] || {}, ledger: ledger.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PROVIDER APPOINTMENTS ---

router.get('/:providerId/appointments', authenticate, requireProviderOwnerOrAdmin, async (req, res) => {
  const pool = getPool();
  try {
    const { status, limit = 20, offset = 0 } = req.query;
    const where = ['a.provider_id = $1'];
    const params = [req.params.providerId];
    if (status) { where.push(`a.status = $${params.length + 1}`); params.push(status); }

    const result = await pool.query(`
      SELECT a.*, u.email as patient_email,
        COALESCE(u.full_name, u.email) as patient_name
      FROM ng_appointments a
      JOIN users u ON a.patient_user_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.scheduled_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    res.json({ appointments: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PROVIDER PATIENTS ---

router.get('/:providerId/patients', authenticate, requireProviderOwnerOrAdmin, async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT DISTINCT u.id, u.email,
        COALESCE(u.full_name, u.email) as full_name,
        u.phone_number,
        COUNT(a.id) as total_visits,
        MAX(a.scheduled_at) as last_visit
      FROM ng_appointments a
      JOIN users u ON a.patient_user_id = u.id
      WHERE a.provider_id = $1 AND a.status = 'completed'
      GROUP BY u.id, u.email, u.phone_number
      ORDER BY last_visit DESC
      LIMIT 100
    `, [req.params.providerId]);
    res.json({ patients: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN: LIST & VERIFY PROVIDERS ---

router.get('/', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { status, specialty, limit = 50, offset = 0 } = req.query;
    const where = ['1=1'];
    const params = [];
    if (status) { where.push(`p.status = $${params.length + 1}`); params.push(status); }
    if (specialty) { where.push(`p.specialty = $${params.length + 1}`); params.push(specialty); }

    const result = await pool.query(`
      SELECT p.*, u.email as user_email
      FROM ng_providers p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), parseInt(offset)]);

    const count = await pool.query(
      `SELECT COUNT(*) FROM ng_providers p WHERE ${where.join(' AND ')}`,
      params
    );
    res.json({ providers: result.rows, total: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:providerId/verify', authenticate, requireRole(['admin']), async (req, res) => {
  const pool = getPool();
  try {
    const { action, reason } = req.body;
    if (!['approve', 'reject', 'suspend'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const statusMap = { approve: 'verified', reject: 'rejected', suspend: 'suspended' };
    await pool.query(`
      UPDATE ng_providers SET
        status = $1,
        rejection_reason = $2,
        verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END,
        verified_by = $3,
        access_status = CASE
          WHEN $1 = 'verified' THEN 'trial_not_started'
          WHEN $1 = 'suspended' THEN 'suspended'
          WHEN $1 = 'rejected' THEN 'rejected'
          ELSE access_status
        END,
        updated_at = NOW()
      WHERE id = $4
    `, [statusMap[action], reason || null, req.user.id, req.params.providerId]);
    await pool.query(
      `UPDATE users u
          SET provider_status = CASE
                WHEN $1 = 'verified' THEN 'approved'
                WHEN $1 = 'suspended' THEN 'suspended'
                WHEN $1 = 'rejected' THEN 'rejected'
                ELSE provider_status
              END,
              updated_at = NOW()
         FROM ng_providers p
        WHERE p.user_id = u.id
          AND p.id = $2`,
      [statusMap[action], req.params.providerId]
    );
    res.json({ success: true, status: statusMap[action] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FEATURED PROVIDERS ---

router.get('/featured', async (req, res) => {
  const pool = getPool();
  try {
    const result = await pool.query(`
      SELECT p.id, p.full_name, p.specialty, p.photo_url,
        p.practice_city, p.practice_state,
        p.consult_fee_general, p.consult_fee_specialist,
        p.years_experience, p.total_consultations, p.bio
      FROM ng_providers p
      WHERE p.status = 'verified' AND p.is_available = true
        AND (p.is_featured = true OR p.featured_expires_at > NOW())
      ORDER BY p.is_featured DESC, p.total_consultations DESC
      LIMIT 12
    `);
    res.json({ providers: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
