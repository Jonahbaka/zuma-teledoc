/**
 * Pharmacy Onboarding Service
 * Handles the full lifecycle: Register → Upload License → Verify → Add Inventory → Go Live
 */

const { getPool } = require('../../../server/db');
const complianceService = require('../compliance/complianceService');

class PharmacyOnboardingService {
  /**
   * Step 1: Register pharmacy (basic info)
   */
  async registerPharmacy(ownerUserId, data) {
    const pool = getPool();

    // Validate required fields
    const required = ['name', 'pcnLicenseNumber', 'superintendentName',
      'superintendentPcnNumber', 'superintendentPhone',
      'addressLine1', 'city', 'state', 'phone', 'email'];

    for (const field of required) {
      if (!data[field]) throw new Error(`Missing required field: ${field}`);
    }

    // Check for duplicate PCN license
    const existing = await pool.query(
      'SELECT id FROM ng_pharmacies WHERE pcn_license_number = $1',
      [data.pcnLicenseNumber]
    );
    if (existing.rows.length) throw new Error('A pharmacy with this PCN license number already exists');

    // Generate slug
    const slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + Math.random().toString(36).substring(2, 6);

    const receivingMethod = ['dashboard', 'whatsapp', 'dashboard_whatsapp'].includes(data.preferredPrescriptionReceivingMethod)
      ? data.preferredPrescriptionReceivingMethod
      : 'dashboard';
    const notificationPreferences = {
      dashboard: receivingMethod === 'dashboard' || receivingMethod === 'dashboard_whatsapp',
      whatsapp: receivingMethod === 'whatsapp' || receivingMethod === 'dashboard_whatsapp',
    };

    const result = await pool.query(
      `INSERT INTO ng_pharmacies (
        owner_user_id, name, slug, pcn_license_number, pcn_license_expiry,
        superintendent_name, superintendent_pcn_number, superintendent_phone,
        superintendent_email, address_line1, address_line2, city, state, lga,
        postal_code, latitude, longitude, phone, whatsapp, email, website,
        bank_name, bank_account_number, bank_account_name, bank_code,
        whatsapp_business_number, preferred_prescription_receiving_method,
        notification_preferences, accepts_bank_transfer, accepts_pos, accepts_cash,
        status, account_status, onboarding_status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,'pending_review','pending_onboarding','profile_submitted'
      )
      RETURNING *`,
      [
        ownerUserId, data.name, slug, data.pcnLicenseNumber,
        data.pcnLicenseExpiry || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        data.superintendentName, data.superintendentPcnNumber,
        data.superintendentPhone, data.superintendentEmail,
        data.addressLine1, data.addressLine2 || null, data.city, data.state,
        data.lga || null, data.postalCode || null,
        data.latitude || null, data.longitude || null,
        data.phone, data.whatsapp || null, data.email, data.website || null,
        data.bankName || null, data.bankAccountNumber || null,
        data.bankAccountName || null, data.bankCode || null,
        data.whatsappBusinessNumber || data.whatsapp || null,
        receivingMethod,
        JSON.stringify(notificationPreferences),
        data.acceptsBankTransfer !== false,
        data.acceptsPos !== false,
        data.acceptsCash !== false,
      ]
    );

    const pharmacy = result.rows[0];

    await pool.query(
      `UPDATE users
          SET region = 'NG',
              market_scope = 'NG',
              account_status = COALESCE(account_status, 'active'),
              updated_at = NOW()
        WHERE id = $1`,
      [ownerUserId]
    ).catch(() => null);

    // Create wallet
    await pool.query(
      'INSERT INTO ng_pharmacy_wallets (pharmacy_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [pharmacy.id]
    );

    // Log compliance event
    await complianceService.logAction({
      actorUserId: ownerUserId,
      actorType: 'pharmacist',
      action: 'pharmacy.registered',
      resourceType: 'pharmacy',
      resourceId: pharmacy.id,
      details: { name: data.name, pcnLicense: data.pcnLicenseNumber, state: data.state },
      pharmacyId: pharmacy.id,
    });

    return {
      pharmacy,
      nextStep: 'upload_documents',
      message: 'Pharmacy registered. Please upload your PCN license and superintendent pharmacist credentials.',
    };
  }

  /**
   * Step 2: Upload documents (PCN license, pharmacist credentials)
   */
  async uploadDocuments(pharmacyId, ownerUserId, documents) {
    const pool = getPool();

    const updates = {};
    if (documents.pcnLicenseUrl) updates.pcn_license_document_url = documents.pcnLicenseUrl;
    if (documents.superintendentLicenseUrl) updates.superintendent_license_url = documents.superintendentLicenseUrl;
    if (documents.nafdacRegistrationNumber) updates.nafdac_registration_number = documents.nafdacRegistrationNumber;

    const setClauses = Object.entries(updates)
      .map(([key, _], i) => `${key} = $${i + 1}`)
      .join(', ');
    const values = Object.values(updates);

    if (setClauses) {
      await pool.query(
        `UPDATE ng_pharmacies SET ${setClauses}, status = 'documents_submitted', updated_at = NOW()
         WHERE id = $${values.length + 1} AND owner_user_id = $${values.length + 2}`,
        [...values, pharmacyId, ownerUserId]
      );
    }

    await complianceService.logAction({
      actorUserId: ownerUserId,
      actorType: 'pharmacist',
      action: 'pharmacy.documents_uploaded',
      resourceType: 'pharmacy',
      resourceId: pharmacyId,
      details: { documentTypes: Object.keys(documents) },
      pharmacyId,
    });

    return {
      nextStep: 'verification',
      message: 'Documents uploaded. Your pharmacy is now under review.',
    };
  }

  /**
   * Step 3: Admin verifies pharmacy (PCN license + superintendent)
   */
  async verifyPharmacy(pharmacyId, adminUserId, approved, rejectionReason = null) {
    const pool = getPool();

    if (approved) {
      await pool.query(
        `UPDATE ng_pharmacies SET
          status = 'approved',
          account_status = 'active',
          onboarding_status = 'approved',
          verified_at = NOW(),
          verified_by = $1,
          updated_at = NOW()
        WHERE id = $2`,
        [adminUserId, pharmacyId]
      );

      // Create Paystack subaccount for split payments
      const pharmacy = await pool.query(
        'SELECT * FROM ng_pharmacies WHERE id = $1', [pharmacyId]
      );

      if (pharmacy.rows[0]?.bank_code && pharmacy.rows[0]?.bank_account_number) {
        try {
          const paystackService = require('../payments/paystackService');
          const p = pharmacy.rows[0];
          const subaccount = await paystackService.createSubaccount({
            businessName: p.name,
            bankCode: p.bank_code,
            accountNumber: p.bank_account_number,
            description: `DoctaRx Nigeria Pharmacy: ${p.name}`,
            primaryContactEmail: p.email,
            primaryContactPhone: p.phone,
          });

          await pool.query(
            'UPDATE ng_pharmacies SET paystack_subaccount_code = $1 WHERE id = $2',
            [subaccount.data.subaccount_code, pharmacyId]
          );
        } catch (err) {
          console.error('Failed to create Paystack subaccount:', err.message);
        }
      }

      await complianceService.logAction({
        actorUserId: adminUserId,
        actorType: 'admin',
        action: 'pharmacy.approved',
        resourceType: 'pharmacy',
        resourceId: pharmacyId,
        details: { approvedBy: adminUserId },
        complianceFlags: ['PCN'],
        severity: 'info',
        pharmacyId,
      });

      return { status: 'approved', message: 'Pharmacy approved. They can now add inventory and go live.' };
    }

    await pool.query(
      `UPDATE ng_pharmacies SET
        status = 'rejected',
        account_status = 'rejected',
        onboarding_status = 'rejected',
        updated_at = NOW()
      WHERE id = $1`,
      [pharmacyId]
    );

    await complianceService.logAction({
      actorUserId: adminUserId,
      actorType: 'admin',
      action: 'pharmacy.rejected',
      resourceType: 'pharmacy',
      resourceId: pharmacyId,
      details: { reason: rejectionReason },
      complianceFlags: ['PCN'],
      severity: 'warning',
      pharmacyId,
    });

    return { status: 'rejected', reason: rejectionReason };
  }

  /**
   * Step 4: Add inventory (drugs available)
   */
  async addInventory(pharmacyId, ownerUserId, items) {
    const pool = getPool();

    // Verify pharmacy is approved
    const pharmacy = await pool.query(
      'SELECT status FROM ng_pharmacies WHERE id = $1 AND owner_user_id = $2',
      [pharmacyId, ownerUserId]
    );

    if (!pharmacy.rows.length) throw new Error('Pharmacy not found');
    if (pharmacy.rows[0].status !== 'approved') {
      throw new Error('Pharmacy must be approved before adding inventory');
    }

    const added = [];

    for (const item of items) {
      // Validate drug exists in catalog
      const drug = await pool.query(
        'SELECT id, name, category FROM ng_drug_catalog WHERE id = $1',
        [item.drugId]
      );

      if (!drug.rows.length) {
        added.push({ drugId: item.drugId, error: 'Drug not found in catalog' });
        continue;
      }

      // Upsert inventory
      const result = await pool.query(
        `INSERT INTO ng_pharmacy_inventory (
          pharmacy_id, drug_id, quantity_available, cost_price, selling_price,
          markup_percent, batch_number, expiry_date, reorder_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (pharmacy_id, drug_id, batch_number)
        DO UPDATE SET
          quantity_available = ng_pharmacy_inventory.quantity_available + EXCLUDED.quantity_available,
          selling_price = EXCLUDED.selling_price,
          cost_price = EXCLUDED.cost_price,
          updated_at = NOW()
        RETURNING *`,
        [
          pharmacyId, item.drugId, item.quantity,
          item.costPrice, item.sellingPrice,
          item.markupPercent || ((item.sellingPrice - item.costPrice) / item.costPrice * 100).toFixed(2),
          item.batchNumber || 'DEFAULT',
          item.expiryDate || null,
          item.reorderLevel || 10,
        ]
      );

      added.push({ drugId: item.drugId, drugName: drug.rows[0].name, inventory: result.rows[0] });
    }

    return { added, nextStep: 'go_live', message: 'Inventory added. Set operating hours to go live.' };
  }

  /**
   * Step 5: Go live (set operating hours, enable delivery)
   */
  async goLive(pharmacyId, ownerUserId, settings) {
    const pool = getPool();

    // Verify pharmacy has inventory
    const inventoryCount = await pool.query(
      'SELECT COUNT(*) as count FROM ng_pharmacy_inventory WHERE pharmacy_id = $1 AND is_available = true',
      [pharmacyId]
    );

    if (parseInt(inventoryCount.rows[0].count) === 0) {
      throw new Error('Cannot go live without inventory. Add at least one item first.');
    }

    const updates = {
      operating_hours: JSON.stringify(settings.operatingHours || {
        monday: { open: '08:00', close: '21:00' },
        tuesday: { open: '08:00', close: '21:00' },
        wednesday: { open: '08:00', close: '21:00' },
        thursday: { open: '08:00', close: '21:00' },
        friday: { open: '08:00', close: '21:00' },
        saturday: { open: '09:00', close: '18:00' },
        sunday: { open: '10:00', close: '16:00' },
      }),
      delivery_enabled: settings.deliveryEnabled !== false,
      delivery_radius_km: settings.deliveryRadiusKm || 10,
      minimum_order_amount: settings.minimumOrderAmount || 500,
    };

    await pool.query(
      `UPDATE ng_pharmacies SET
        operating_hours = $1, delivery_enabled = $2,
        delivery_radius_km = $3, minimum_order_amount = $4,
        updated_at = NOW()
      WHERE id = $5 AND owner_user_id = $6`,
      [updates.operating_hours, updates.delivery_enabled,
       updates.delivery_radius_km, updates.minimum_order_amount,
       pharmacyId, ownerUserId]
    );

    await complianceService.logAction({
      actorUserId: ownerUserId,
      actorType: 'pharmacist',
      action: 'pharmacy.went_live',
      resourceType: 'pharmacy',
      resourceId: pharmacyId,
      details: updates,
      pharmacyId,
    });

    return {
      status: 'live',
      message: 'Pharmacy is now live and accepting orders!',
    };
  }

  /**
   * Get onboarding status for a pharmacy
   */
  async getOnboardingStatus(pharmacyId) {
    const pool = getPool();

    const pharmacy = await pool.query(
      `SELECT p.*, w.balance, w.total_earned,
        (SELECT COUNT(*) FROM ng_pharmacy_inventory WHERE pharmacy_id = p.id) as inventory_count,
        (SELECT COUNT(*) FROM ng_orders WHERE pharmacy_id = p.id) as order_count
       FROM ng_pharmacies p
       LEFT JOIN ng_pharmacy_wallets w ON w.pharmacy_id = p.id
       WHERE p.id = $1`,
      [pharmacyId]
    );

    if (!pharmacy.rows.length) throw new Error('Pharmacy not found');

    const p = pharmacy.rows[0];
    const steps = [
      { step: 1, name: 'Register', status: 'completed' },
      {
        step: 2, name: 'Upload Documents',
        status: p.pcn_license_document_url ? 'completed' : 'pending',
      },
      {
        step: 3, name: 'Verification',
        status: p.status === 'approved' ? 'completed'
          : p.status === 'rejected' ? 'rejected'
          : p.status === 'under_verification' ? 'in_progress'
          : 'pending',
      },
      {
        step: 4, name: 'Add Inventory',
        status: parseInt(p.inventory_count) > 0 ? 'completed' : 'pending',
      },
      {
        step: 5, name: 'Go Live',
        status: p.operating_hours && Object.keys(p.operating_hours).length > 0 ? 'completed' : 'pending',
      },
    ];

    const currentStep = steps.find(s => s.status === 'pending' || s.status === 'in_progress');

    return {
      pharmacy: p,
      steps,
      currentStep: currentStep?.step || 5,
      isLive: p.status === 'approved' && parseInt(p.inventory_count) > 0,
    };
  }

  /**
   * List all pharmacies pending approval (admin)
   */
  async listPendingPharmacies(page = 1, limit = 20) {
    const pool = getPool();
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `SELECT p.*, u.email as owner_email, u.first_name as owner_first_name,
              u.last_name as owner_last_name
       FROM ng_pharmacies p
       LEFT JOIN users u ON u.id = p.owner_user_id
       WHERE p.status IN ('pending_review', 'documents_submitted', 'under_verification')
       ORDER BY p.created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM ng_pharmacies WHERE status IN ('pending_review', 'documents_submitted', 'under_verification')`
    );

    return {
      pharmacies: result.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    };
  }
}

module.exports = new PharmacyOnboardingService();
