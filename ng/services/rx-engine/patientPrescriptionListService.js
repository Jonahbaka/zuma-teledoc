'use strict';

// The existing combined list is authenticated self-access, regardless of role or
// market. Keep that scope while retaining current authentication eligibility and
// owned prescription rows through mandatory read audits and commit.
function fail() { return Object.assign(new Error('Prescription access denied.'), { status: 403 }); }
async function audit(client, userId, type, rows) {
  const metadata = { recordCount: rows.length, records: rows.map(row => ({ id: row.id })) };
  await client.query(`INSERT INTO audit_logs(user_id,action,resource_type,resource_id,patient_id,phi_accessed,success,description,new_values)
    VALUES($1,'read',$2,NULL,$1,true,true,'Account viewed own prescription list',$3::jsonb)`,
  [userId, type, JSON.stringify(metadata)]);
}
async function list(pool, actor, query = {}) {
  if (!actor?.id) throw fail();
  const client = await pool.connect();
  let rollbackError;
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT id,role,is_active,provider_status,must_change_password FROM users WHERE id=$1 FOR SHARE', [actor.id])).rows[0];
    // These conditions mirror the mounted authentication middleware, not a new
    // patient-only, market, account-status or prescription-status restriction.
    const role = String(current?.role || '').trim().toLowerCase();
    if (!current?.is_active || current.role === 'provider' && current.provider_status !== 'approved'
      || ['provider', 'pharmacy'].includes(role) && current.must_change_password === true) throw fail();
    const limit = parseInt(query.limit) || 20;
    const offset = ((parseInt(query.page) || 1) - 1) * limit;
    const uploaded = await client.query(
      `SELECT id, status, created_at, items, prescriber_name, ocr_confidence,
              is_controlled_substance, expires_at
       FROM ng_prescriptions WHERE patient_user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3 FOR SHARE`,
      [current.id, limit, offset]
    );
    const digital = await client.query(
      `SELECT rx.id,
              rx.status,
              rx.dispense_status,
              rx.pharmacy_response_status,
              rx.created_at,
              rx.items,
              rx.prescription_number,
              rx.expires_at,
              provider.full_name AS prescriber_name,
              pharmacy.name AS pharmacy_name,
              pharmacy.phone AS pharmacy_phone,
              pharmacy.whatsapp_business_number,
              rx.fulfillment_preference,
              rx.confirmed_price_ngn,
              rx.pharmacy_notes
         FROM ng_digital_prescriptions rx
         JOIN ng_providers provider ON provider.id = rx.provider_id
         LEFT JOIN ng_pharmacies pharmacy
           ON pharmacy.id = COALESCE(rx.routed_pharmacy_id, rx.preferred_pharmacy_id, rx.dispensed_by_pharmacy_id)
        WHERE rx.patient_user_id = $1
        ORDER BY rx.created_at DESC
        LIMIT $2 OFFSET $3 FOR SHARE OF rx`,
      [current.id, limit, offset]
    );

    const rows = [
      ...digital.rows.map(row => ({ ...row, source_type: 'provider_digital_prescription' })),
      ...uploaded.rows.map(row => ({ ...row, source_type: 'patient_uploaded_prescription' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    await audit(client, current.id, 'prescription_submission', uploaded.rows);
    await audit(client, current.id, 'digital_prescription', digital.rows);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (failure) { rollbackError = failure; }
    throw error;
  } finally { client.release(rollbackError); }
}

module.exports = { list };
