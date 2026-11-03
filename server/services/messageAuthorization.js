const crypto = require('crypto');

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

function getConversationId(userId1, userId2) {
  const sortedIds = [String(userId1), String(userId2)].sort();
  const hash = crypto.createHash('sha1').update(`${sortedIds[0]}_${sortedIds[1]}`).digest();

  return [
    hash.slice(0, 4).toString('hex'),
    hash.slice(4, 6).toString('hex'),
    ((hash[6] & 0x0f) | 0x50).toString(16) + hash.slice(7, 8).toString('hex'),
    ((hash[8] & 0x3f) | 0x80).toString(16) + hash.slice(9, 10).toString('hex'),
    hash.slice(10, 16).toString('hex')
  ].join('-');
}

function normalizeMarket(user) {
  const explicit = String(user.market_scope || '').trim().toUpperCase();
  if (explicit === 'NG' || explicit === 'US') return explicit;
  return ['NG', 'NIGERIA'].includes(String(user.country || '').trim().toUpperCase()) ? 'NG' : 'US';
}

function sanitizeMessageContent(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\0/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

function forbidden(message = 'Messaging relationship is not authorized') {
  const error = new Error(message);
  error.status = 403;
  error.code = 'MESSAGING_RELATIONSHIP_FORBIDDEN';
  return error;
}

async function loadUsers(db, userId, recipientId, lock = false) {
  const { rows } = await db.query(
    `SELECT id, role, first_name, last_name, email, is_active, country, market_scope
       FROM users
      WHERE id = ANY($1::uuid[]) ORDER BY id${lock ? ' FOR SHARE' : ''}`,
    [[userId, recipientId]]
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return {
    sender: byId.get(String(userId)),
    recipient: byId.get(String(recipientId))
  };
}

async function hasPatientProviderRelationship(db, patientId, providerId, lock = false) {
  if (lock) {
    // Lock the actual row granting access, not an aggregate/UNION result.
    const appointment = await db.query('SELECT id FROM appointments WHERE patient_id=$1 AND provider_id=$2 ORDER BY id LIMIT 1 FOR SHARE', [patientId, providerId]);
    if (appointment.rows.length) return true;
    const relationship = await db.query('SELECT id FROM provider_patient_relationships WHERE patient_id=$1 AND provider_id=$2 AND is_active=true ORDER BY id LIMIT 1 FOR SHARE', [patientId, providerId]);
    return relationship.rows.length > 0;
  }
  const { rows } = await db.query(
    `SELECT 1
       FROM (
         SELECT 1
           FROM appointments
          WHERE patient_id = $1 AND provider_id = $2
         UNION ALL
         SELECT 1
           FROM provider_patient_relationships
          WHERE patient_id = $1 AND provider_id = $2 AND is_active = true
       ) relationship
      LIMIT 1`,
    [patientId, providerId]
  );
  return rows.length > 0;
}

async function hasPharmacyRelationship(db, pharmacyId, otherUser, lock = false) {
  const userColumn = otherUser.role === 'patient' ? 'patient_id' : 'provider_id';
  const { rows } = await db.query(
    `SELECT 1
       FROM prescriptions
      WHERE pharmacy_id = $1 AND ${userColumn} = $2
      ORDER BY id LIMIT 1${lock ? ' FOR SHARE' : ''}`,
    [pharmacyId, otherUser.id]
  );
  return rows.length > 0;
}

async function assertMessagingRelationship(db, userId, recipientId, { lock = false } = {}) {
  if (!userId || !recipientId || String(userId) === String(recipientId)) {
    throw forbidden('A conversation requires two distinct active accounts');
  }

  const { sender, recipient } = await loadUsers(db, userId, recipientId, lock);
  if (!sender || !recipient || !sender.is_active || !recipient.is_active) {
    throw forbidden('Recipient is unavailable');
  }

  const senderRole = String(sender.role || '').toLowerCase();
  const recipientRole = String(recipient.role || '').toLowerCase();
  const senderMarket = normalizeMarket(sender);
  const recipientMarket = normalizeMarket(recipient);

  if (!ADMIN_ROLES.has(senderRole) && !ADMIN_ROLES.has(recipientRole) && senderMarket !== recipientMarket) {
    throw forbidden('Cross-market conversations are not permitted');
  }

  let allowed = ADMIN_ROLES.has(senderRole) || ADMIN_ROLES.has(recipientRole);

  if (!allowed && new Set([senderRole, recipientRole]).has('patient') && new Set([senderRole, recipientRole]).has('provider')) {
    const patient = senderRole === 'patient' ? sender : recipient;
    const provider = senderRole === 'provider' ? sender : recipient;
    allowed = await hasPatientProviderRelationship(db, patient.id, provider.id, lock);
  }

  if (!allowed && senderRole === 'provider' && recipientRole === 'provider') {
    allowed = senderMarket === recipientMarket;
  }

  if (!allowed && [senderRole, recipientRole].includes('pharmacy')) {
    const pharmacy = senderRole === 'pharmacy' ? sender : recipient;
    const other = senderRole === 'pharmacy' ? recipient : sender;
    const otherRole = String(other.role || '').toLowerCase();
    if (otherRole === 'patient' || otherRole === 'provider') {
      other.role = otherRole;
      allowed = await hasPharmacyRelationship(db, pharmacy.id, other, lock);
    }
  }

  if (!allowed) throw forbidden();

  return {
    conversationId: getConversationId(sender.id, recipient.id),
    sender,
    recipient
  };
}

module.exports = {
  assertMessagingRelationship,
  getConversationId,
  normalizeMarket,
  sanitizeMessageContent
};
