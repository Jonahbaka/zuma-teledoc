/**
 * Read-only access to recorded legacy prescriptions.
 * New clinical intents use the guarded encounter workflow. This legacy service
 * has no pharmacy transport, refill-review workflow, or verified drug catalog.
 */
const db = require('../db');
const { keysToCamel } = require('../../lib/utils');
const { z } = require('zod');
const { integrationUnavailable } = require('../utils/integrationReadiness');
const { actorMarket, patientMarketSql } = require('../middleware/financialRecordScope');

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const knownMarket = (value) => ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA', 'NG', 'NIGERIA'].includes(String(value || '').trim().toUpperCase());
const marketValue = (actor) => actor?.marketScope || actor?.market_scope || actor?.region || actor?.country;
const inputError = () => Object.assign(new Error('Choose a valid prescription or supported record filter.'), { statusCode: 400, code: 'PRESCRIPTION_INPUT_INVALID' });
const missing = () => Object.assign(new Error('Prescription not found.'), { statusCode: 404, code: 'PRESCRIPTION_NOT_FOUND' });

class PrescriptionService {
  async createPrescription() { throw integrationUnavailable('Legacy prescription creation'); }
  async signAndSend() { throw integrationUnavailable('Legacy prescription delivery'); }
  async updatePharmacy() { throw integrationUnavailable('Legacy prescription pharmacy changes'); }
  async cancelPrescription() { throw integrationUnavailable('Legacy prescription cancellation'); }
  async requestRefill() { throw integrationUnavailable('Prescription refill review and delivery'); }
  async searchMedications() { throw integrationUnavailable('Verified medication catalog'); }

  _options(options = {}) {
    const result = z.object({
      status: z.string().trim().min(1).max(40).regex(/^[a-z_]+$/).optional(),
      patientId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    }).strict().safeParse(options);
    if (!result.success) throw inputError();
    return result.data;
  }

  async _withReader(session, operation) {
    if (!uuid.test(String(session?.id || ''))) throw inputError();
    if (!['patient', 'provider', 'admin', 'super_admin'].includes(session.role)) throw Object.assign(new Error('Prescription access is unavailable for this account.'), { statusCode: 403, code: 'PRESCRIPTION_ACCESS_DENIED' });
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT id,role,is_active,provider_status,market_scope,region,country FROM users WHERE id=$1 FOR SHARE', [session.id]);
      const current = result.rows[0];
      const actor = current && { ...current, marketScope: current.market_scope };
      if (!actor?.is_active || actor.role !== session.role || !knownMarket(marketValue(actor)) || !knownMarket(marketValue(session))
        || actorMarket(actor) !== actorMarket(session) || actor.role === 'provider' && actor.provider_status !== 'approved') {
        throw Object.assign(new Error('Your current prescription access could not be confirmed.'), { statusCode: 403, code: 'PRESCRIPTION_ACCESS_DENIED' });
      }
      const value = await operation(client, actor);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  _scope() {
    return `
      pat.role='patient' AND pat.is_active=TRUE
      AND UPPER(COALESCE(NULLIF(TRIM(pat.market_scope),''),NULLIF(TRIM(pat.region::text),''),NULLIF(TRIM(pat.country),''),'')) IN ('US','USA','UNITED STATES','UNITED STATES OF AMERICA','NG','NIGERIA')
      AND ${patientMarketSql('pat')}=$2
      AND ($3 IN ('admin','super_admin') OR $3='patient' AND p.patient_id=$4 OR $3='provider' AND p.provider_id=$4)
      AND ($3<>'provider' OR EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id=p.patient_id AND a.provider_id=$4))`;
  }

  async _audit(client, actor, prescriptionId, patientId) {
    await client.query(`
      INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,phi_accessed,success)
      VALUES ($1,'read','prescription',$2,$3,'Recorded prescription information accessed',TRUE,TRUE)`, [actor.id, prescriptionId || null, patientId || null]);
  }

  async _record(client, actor, id) {
    const { rows } = await client.query(`
      SELECT p.*, pat.first_name AS patient_first_name,pat.last_name AS patient_last_name,
             prov.first_name AS provider_first_name,prov.last_name AS provider_last_name,prov.specialty AS provider_specialty
      FROM prescriptions p JOIN users pat ON pat.id=p.patient_id JOIN users prov ON prov.id=p.provider_id
      WHERE p.id=$1 AND ${this._scope()} FOR SHARE OF p,pat`,
    [id, actorMarket(actor), actor.role, actor.id]);
    if (!rows.length) throw missing();
    return rows[0];
  }

  async getPrescriptionById(id, actor) {
    if (!uuid.test(String(id || ''))) throw inputError();
    return this._withReader(actor, async (client, current) => {
      const record = await this._record(client, current, id);
      await this._audit(client, current, id, record.patient_id);
      return keysToCamel(record);
    });
  }

  async getPrescriptionHistory(id, actor) {
    if (!uuid.test(String(id || ''))) throw inputError();
    return this._withReader(actor, async (client, current) => {
      const record = await this._record(client, current, id);
      const { rows } = await client.query('SELECT * FROM prescription_history WHERE prescription_id=$1 ORDER BY created_at DESC,id', [id]);
      await this._audit(client, current, id, record.patient_id);
      return rows.map(keysToCamel);
    });
  }

  async _list(userId, options, session, patientList) {
    if (!uuid.test(String(userId || '')) || String(userId) !== String(session?.id)) throw inputError();
    const filters = this._options(options);
    if (patientList && filters.patientId && filters.patientId !== userId) throw missing();
    return this._withReader(session, async (client, actor) => {
      if (patientList !== (actor.role === 'patient')) throw Object.assign(new Error('Prescription access is unavailable for this account.'), { statusCode: 403, code: 'PRESCRIPTION_ACCESS_DENIED' });
      const parameters = [userId, actorMarket(actor), actor.role, actor.id, filters.status || null, filters.patientId || null, filters.limit, filters.offset];
      const { rows } = await client.query(`
        SELECT p.*,pat.first_name AS patient_first_name,pat.last_name AS patient_last_name,
               prov.first_name AS provider_first_name,prov.last_name AS provider_last_name,prov.specialty AS provider_specialty
        FROM prescriptions p JOIN users pat ON pat.id=p.patient_id JOIN users prov ON prov.id=p.provider_id
        WHERE ${patientList ? 'p.patient_id' : 'p.provider_id'}=$1 AND ${this._scope()}
          AND ($5::text IS NULL OR p.status::text=$5) AND ($6::uuid IS NULL OR p.patient_id=$6)
        ORDER BY p.created_at DESC,p.id LIMIT $7 OFFSET $8 FOR SHARE OF p,pat`, parameters);
      await this._audit(client, actor, null, patientList ? userId : filters.patientId);
      return rows.map(keysToCamel);
    });
  }

  async getPatientPrescriptions(patientId, options = {}, actor) { return this._list(patientId, options, actor, true); }
  async getProviderPrescriptions(providerId, options = {}, actor) { return this._list(providerId, options, actor, false); }
}

module.exports = new PrescriptionService();
