/**
 * Nigeria Compliance Service
 * Handles PCN, NDPA, and NAFDAC compliance requirements
 * Immutable audit logging for all regulated actions
 */

const { getPool } = require('../../../server/db');

class ComplianceService {
  /**
   * Log a compliance-relevant action (immutable)
   */
  async logAction({
    actorUserId, actorType, action, resourceType, resourceId,
    details = {}, complianceFlags = [], severity = 'info',
    pharmacyId = null, actorIp = null,
  }) {
    const pool = getPool();

    await pool.query(
      `INSERT INTO ng_compliance_audit_log (
        actor_user_id, actor_type, actor_ip, action, resource_type, resource_id,
        details, compliance_flags, severity, pharmacy_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        actorUserId, actorType, actorIp, action, resourceType, resourceId,
        JSON.stringify(details), complianceFlags, severity, pharmacyId,
      ]
    );
  }

  /**
   * Validate pharmacy PCN compliance
   * PCN (Pharmacists Council of Nigeria) requires:
   * - Valid PCN registration
   * - Superintendent pharmacist on premises
   * - Proper drug storage and handling
   */
  async validatePharmacyCompliance(pharmacyId) {
    const pool = getPool();

    const pharmacy = await pool.query(
      'SELECT * FROM ng_pharmacies WHERE id = $1', [pharmacyId]
    );

    if (!pharmacy.rows.length) throw new Error('Pharmacy not found');
    const p = pharmacy.rows[0];

    const issues = [];

    // PCN License checks
    if (!p.pcn_license_number) {
      issues.push({ field: 'pcn_license_number', severity: 'critical', message: 'PCN license number is required' });
    }
    if (!p.pcn_license_document_url) {
      issues.push({ field: 'pcn_license_document', severity: 'critical', message: 'PCN license document must be uploaded' });
    }
    if (p.pcn_license_expiry && new Date(p.pcn_license_expiry) < new Date()) {
      issues.push({ field: 'pcn_license_expiry', severity: 'critical', message: 'PCN license has expired' });
    }
    if (p.pcn_license_expiry) {
      const daysUntilExpiry = Math.floor((new Date(p.pcn_license_expiry) - new Date()) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
        issues.push({ field: 'pcn_license_expiry', severity: 'warning', message: `PCN license expires in ${daysUntilExpiry} days` });
      }
    }

    // Superintendent Pharmacist checks
    if (!p.superintendent_name) {
      issues.push({ field: 'superintendent_name', severity: 'critical', message: 'Superintendent pharmacist name is required' });
    }
    if (!p.superintendent_pcn_number) {
      issues.push({ field: 'superintendent_pcn_number', severity: 'critical', message: 'Superintendent pharmacist PCN number is required' });
    }
    if (!p.superintendent_phone) {
      issues.push({ field: 'superintendent_phone', severity: 'critical', message: 'Superintendent pharmacist phone is required' });
    }

    // Location checks
    if (!p.latitude || !p.longitude) {
      issues.push({ field: 'location', severity: 'warning', message: 'Pharmacy coordinates not set (required for delivery routing)' });
    }

    // Bank details for settlement
    if (!p.bank_account_number || !p.bank_code) {
      issues.push({ field: 'bank_details', severity: 'warning', message: 'Bank details required for payment settlement' });
    }

    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const isCompliant = criticalIssues.length === 0;

    return {
      pharmacyId,
      isCompliant,
      issues,
      criticalCount: criticalIssues.length,
      warningCount: issues.filter(i => i.severity === 'warning').length,
    };
  }

  /**
   * Validate a prescription dispensing action
   * Ensures controlled substances are properly tracked
   */
  async validateDispensing(prescriptionId, pharmacyId, pharmacistUserId) {
    const pool = getPool();

    const prescription = await pool.query(
      'SELECT * FROM ng_prescriptions WHERE id = $1', [prescriptionId]
    );

    if (!prescription.rows.length) throw new Error('Prescription not found');
    const rx = prescription.rows[0];

    const issues = [];

    // Check prescription is verified
    if (rx.status !== 'verified' && rx.status !== 'matched') {
      issues.push({ severity: 'critical', message: 'Prescription must be verified before dispensing' });
    }

    // Check expiry
    if (rx.expires_at && new Date(rx.expires_at) < new Date()) {
      issues.push({ severity: 'critical', message: 'Prescription has expired' });
    }

    // Controlled substance checks
    if (rx.is_controlled_substance) {
      if (rx.requires_id_verification) {
        issues.push({ severity: 'warning', message: 'ID verification required for controlled substance' });
      }

      // Log controlled substance dispensing
      await this.logAction({
        actorUserId: pharmacistUserId,
        actorType: 'pharmacist',
        action: 'controlled_substance.dispensed',
        resourceType: 'prescription',
        resourceId: prescriptionId,
        details: { items: rx.items, pharmacyId },
        complianceFlags: ['PCN', 'NAFDAC'],
        severity: 'warning',
        pharmacyId,
      });
    }

    return {
      canDispense: issues.filter(i => i.severity === 'critical').length === 0,
      issues,
    };
  }

  /**
   * NDPA (Nigeria Data Protection Act) compliance check
   * Ensures patient data handling meets NDPA requirements
   */
  async ndpaCheck(action, dataCategories = []) {
    const sensitiveCategories = ['health', 'biometric', 'genetic', 'financial'];
    const isSensitive = dataCategories.some(c => sensitiveCategories.includes(c));

    return {
      requiresConsent: isSensitive,
      requiresEncryption: isSensitive,
      retentionPeriod: isSensitive ? '7 years' : '3 years',
      canTransferAbroad: false, // Must stay within Nigeria unless adequacy decision
      dataProtectionOfficerRequired: true,
      lawfulBasis: 'consent', // or 'legitimate_interest', 'legal_obligation'
    };
  }

  /**
   * Check if a drug can be sold without prescription
   */
  async canSellWithoutPrescription(drugId) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT category, requires_prescription, schedule FROM ng_drug_catalog WHERE id = $1',
      [drugId]
    );

    if (!result.rows.length) return { allowed: false, reason: 'Drug not found' };

    const drug = result.rows[0];

    if (drug.requires_prescription) {
      return { allowed: false, reason: 'This drug requires a valid prescription' };
    }

    if (drug.schedule) {
      return { allowed: false, reason: `This is a Schedule ${drug.schedule} controlled substance` };
    }

    if (drug.category === 'controlled') {
      return { allowed: false, reason: 'Controlled substances require a prescription' };
    }

    return { allowed: true };
  }

  /**
   * Get audit log for a pharmacy
   */
  async getAuditLog(pharmacyId, { page = 1, limit = 50, action = null, severity = null } = {}) {
    const pool = getPool();
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM ng_compliance_audit_log WHERE pharmacy_id = $1`;
    const params = [pharmacyId];

    if (action) {
      params.push(action);
      sql += ` AND action = $${params.length}`;
    }
    if (severity) {
      params.push(severity);
      sql += ` AND severity = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(sql, params);
    return result.rows;
  }

  /**
   * Check inventory for expired drugs (scheduled job)
   */
  async checkExpiredInventory() {
    const pool = getPool();

    // Find items expiring within 90 days
    const expiring = await pool.query(
      `SELECT i.*, p.name as pharmacy_name, p.email as pharmacy_email,
              d.name as drug_name
       FROM ng_pharmacy_inventory i
       JOIN ng_pharmacies p ON p.id = i.pharmacy_id
       JOIN ng_drug_catalog d ON d.id = i.drug_id
       WHERE i.expiry_date IS NOT NULL
         AND i.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
         AND i.is_available = true
       ORDER BY i.expiry_date ASC`
    );

    // Deactivate already expired items
    const expired = await pool.query(
      `UPDATE ng_pharmacy_inventory
       SET is_available = false, updated_at = NOW()
       WHERE expiry_date <= CURRENT_DATE AND is_available = true
       RETURNING *`
    );

    if (expired.rows.length > 0) {
      for (const item of expired.rows) {
        await this.logAction({
          actorUserId: null,
          actorType: 'system',
          action: 'inventory.expired_deactivated',
          resourceType: 'inventory',
          resourceId: item.id,
          details: { drugId: item.drug_id, expiryDate: item.expiry_date },
          complianceFlags: ['NAFDAC'],
          severity: 'warning',
          pharmacyId: item.pharmacy_id,
        });
      }
    }

    return {
      expiringWithin90Days: expiring.rows.length,
      deactivated: expired.rows.length,
    };
  }
}

module.exports = new ComplianceService();
