'use strict';
const { z } = require('zod');
const uuid = z.string().uuid();
const cleanText = maximum => z.string().trim().max(maximum).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)).nullable().optional();
const schema = z.object({ verified: z.boolean(), availabilitySource: cleanText(250), availabilityNotes: cleanText(4000) }).strict();
function fail(status, message) { return Object.assign(new Error(message), { status, code: 'INVENTORY_VERIFICATION_REJECTED' }); }
async function update(pool, actor, inventoryId, input) {
  const actorId = actor?.id || actor?.userId || actor?.sub;
  if (!uuid.safeParse(actorId).success) throw fail(403, 'Current super-administrator authority is required.');
  const parsed = schema.safeParse(input);
  if (!uuid.safeParse(inventoryId).success || !parsed.success) throw fail(400, 'Provide a valid inventory identifier, explicit verification choice and bounded source or notes.');
  const data = parsed.data; const nextStatus = data.verified ? 'verified' : 'unverified';
  const source = data.availabilitySource || 'admin_confirmation'; const notes = data.availabilityNotes || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = (await client.query("SELECT id FROM users WHERE id=$1 AND role='super_admin' AND is_active=TRUE AND account_status='active' FOR SHARE", [actorId])).rows[0];
    if (!current) throw fail(403, 'Current super-administrator authority is required.');
    const previous = (await client.query('SELECT id,availability_verification_status FROM ng_pharmacy_inventory WHERE id=$1 FOR UPDATE', [inventoryId])).rows[0];
    if (!previous) throw fail(404, 'Pharmacy inventory record not found.');
    const result = await client.query(`UPDATE ng_pharmacy_inventory SET
      availability_verification_status=$2,
      availability_verified_at=CASE WHEN $3::boolean THEN NOW() ELSE NULL END,
      availability_verified_by=CASE WHEN $3::boolean THEN $4::uuid ELSE NULL END,
      availability_source=$5,availability_notes=$6,updated_at=NOW()
      WHERE id=$1 RETURNING *`, [inventoryId, nextStatus, data.verified, current.id, source, notes]);
    if (!result.rows[0]) throw fail(409, 'Inventory verification changed. Reload before responding.');
    await client.query(`INSERT INTO ng_medication_source_audit_log
      (inventory_id,actor_user_id,action,from_status,to_status,details)
      VALUES($1,$2,'pharmacy_availability_verification_updated',$3,$4,$5)`,
    [inventoryId, current.id, previous.availability_verification_status, nextStatus, JSON.stringify({ availabilitySource: source, availabilityNotes: notes })]);
    await client.query('COMMIT');
    return { inventory: result.rows[0] };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function sendError(res, error) {
  const safe = error.code === 'INVENTORY_VERIFICATION_REJECTED' && [400,403,404,409].includes(error.status);
  return res.status(safe ? error.status : 503).json({ error: safe ? error.message : 'Inventory verification could not be confirmed. Refresh the record before trying again.' });
}
module.exports = { update, sendError };
