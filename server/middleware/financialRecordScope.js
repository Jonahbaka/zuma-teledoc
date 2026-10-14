'use strict';

const db = require('../db');
const { normalizeMarketScope } = require('../utils/marketScope');

const patientMarketSql = (alias) => `CASE WHEN UPPER(COALESCE(${alias}.market_scope, ${alias}.region::text, ${alias}.country, '')) IN ('NG', 'NIGERIA') THEN 'NG' ELSE 'US' END`;
const actorMarket = (user) => normalizeMarketScope(user.marketScope || user.region || user.country, 'US');

async function patientFinancialAccess(user, patientId) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(patientId || ''))) return false;
  if (!['patient', 'provider', 'admin', 'super_admin'].includes(user?.role)) return false;
  if (user.role === 'patient' && String(user.id) !== String(patientId)) return false;
  const result = await db.query(
    `SELECT 1 FROM users p WHERE p.id = $1 AND p.role = 'patient'
       AND ${patientMarketSql('p')} = $2
       AND ($3 <> 'provider' OR EXISTS (
         SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.provider_id = $4
       ))`,
    [patientId, actorMarket(user), user.role, user.id]
  );
  return result.rows.length > 0;
}

function scopedFinancialRecord(table, property) {
  if (!['claims', 'patient_insurance'].includes(table)) throw new Error('Unsupported financial table');
  return async (req, res, next) => {
    try {
      if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(req.params.id || ''))) {
        return res.status(400).json({ success: false, error: 'Invalid record identifier' });
      }
      const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
      const record = rows[0];
      const patientId = table === 'patient_insurance' ? record?.user_id || record?.patient_id : record?.patient_id;
      const allowed = record && await patientFinancialAccess(req.user, patientId) &&
        (table !== 'claims' || req.user.role !== 'provider' || String(record.provider_id) === String(req.user.id));
      if (!allowed) return res.status(404).json({ success: false, error: 'Record not found' });
      req[property] = record;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { patientMarketSql, actorMarket, patientFinancialAccess, scopedFinancialRecord };
