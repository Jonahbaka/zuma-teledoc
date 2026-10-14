/**
 * Pharmacy Service
 * Handles pharmacy finder, preferences, and pharmacy network management
 */

const db = require('../db');
const logger = require('../middleware/logger');
const { keysToCamel } = require('../../lib/utils');

class PharmacyService {
  /**
   * Find pharmacies near a location using OpenStreetMap
   */
  async findNearbyPharmacies(latitude, longitude, radiusMeters = 5000, { signal } = {}) {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isInteger(radiusMeters) || radiusMeters < 1 || radiusMeters > 50000) {
      throw Object.assign(new Error('A valid location and search radius are required.'), { status: 400, code: 'PHARMACY_LOCATION_INVALID' });
    }
    try {
      signal?.throwIfAborted();
      // First check our local database
      const localPharmacies = await this._findLocalPharmacies(latitude, longitude, radiusMeters);
      signal?.throwIfAborted();
      
      if (localPharmacies.length >= 5) {
        return localPharmacies;
      }
      
      // Supplement known network entries with public directory data. Directory
      // presence does not establish inventory, opening status, or a contract.
      const osmPharmacies = await this._queryOverpassAPI(latitude, longitude, radiusMeters, signal);
      
      // Merge results, preferring local data
      const merged = this._mergePharmacyResults(localPharmacies, osmPharmacies);
      
      return merged.slice(0, 20);
    } catch (error) {
      logger.warn('Nearby pharmacy lookup is unavailable', { code: error.code || 'DIRECTORY_UNAVAILABLE' });
      throw Object.assign(new Error('Pharmacy lookup is temporarily unavailable. Try again or choose a pharmacy manually.'), { status: 503, code: 'PHARMACY_DIRECTORY_UNAVAILABLE' });
    }
  }
  
  /**
   * Search pharmacies by name or address
   */
  async searchPharmacies(query, options = {}) {
    const { latitude, longitude, limit = 20 } = options;
    
    let dbQuery = `
      SELECT *,
             CASE WHEN $2::numeric IS NOT NULL AND $3::numeric IS NOT NULL
               THEN (
                 6371 * acos(
                   cos(radians($2::numeric)) *
                   cos(radians(latitude)) *
                   cos(radians(longitude) - radians($3::numeric)) +
                   sin(radians($2::numeric)) *
                   sin(radians(latitude))
                 )
               )
               ELSE NULL
             END as distance_km
      FROM pharmacy_network
      WHERE is_active = true
      AND (
        name ILIKE $1
        OR chain_name ILIKE $1
        OR address_line1 ILIKE $1
        OR city ILIKE $1
        OR zip_code ILIKE $1
      )
      ORDER BY
        is_preferred DESC,
        distance_km NULLS LAST,
        name ASC
      LIMIT $4
    `;
    
    const { rows } = await db.query(dbQuery, [
      `%${query}%`,
      latitude ?? null,
      longitude ?? null,
      limit
    ]);
    
    return rows.map(r => this._formatPharmacy(keysToCamel(r)));
  }
  
  _preferenceError(status, code, message) {
    return Object.assign(new Error(message), { status, statusCode: status, code });
  }

  _preferenceRecord(row) {
    const numeric = (value) => value == null ? null : Number(value);
    return {
      id: row.id, patientId: row.patient_id, pharmacyName: row.pharmacy_name,
      pharmacyAddress: row.pharmacy_address, pharmacyPhone: row.pharmacy_phone || null,
      pharmacyNpi: row.pharmacy_npi || null, isPreferred: row.is_preferred === true,
      latitude: numeric(row.latitude), longitude: numeric(row.longitude), distanceMiles: numeric(row.distance_miles),
      isOpen: null, verificationStatus: 'details_not_verified', source: row.source || 'patient_selected',
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  async _withPreferenceContext(patientId, req, write, operation) {
    const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
    if (!uuid.test(String(patientId || '')) || !uuid.test(String(req?.user?.id || ''))) throw this._preferenceError(400, 'PHARMACY_PREFERENCE_INPUT_INVALID', 'Choose a valid patient account.');
    if (!['patient', 'provider', 'admin', 'super_admin'].includes(req.user.role)) throw this._preferenceError(403, 'PHARMACY_PREFERENCE_FORBIDDEN', 'Pharmacy preference access is unavailable for this account.');
    const { patientFinancialAccess, actorMarket, patientMarketSql } = require('../middleware/financialRecordScope');
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const lock = write ? 'FOR NO KEY UPDATE' : 'FOR SHARE';
      const actorRows = await client.query(`
        SELECT id,role,is_active,provider_status,market_scope,region,country
        FROM users WHERE id=$1 ${lock}`, [req.user.id]);
      const actor = actorRows.rows[0];
      const currentActor = actor && { id: actor.id, role: actor.role, marketScope: actor.market_scope, region: actor.region, country: actor.country };
      const knownMarket = (value) => ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA', 'NG', 'NIGERIA'].includes(String(value || '').trim().toUpperCase());
      if (!actor?.is_active || !knownMarket(actor.market_scope || actor.region || actor.country)
        || !knownMarket(req.user.marketScope || req.user.region || req.user.country)
        || actor.role !== req.user.role || actorMarket(currentActor) !== actorMarket(req.user)
        || actor.role === 'provider' && actor.provider_status !== 'approved') throw this._preferenceError(403, 'PHARMACY_PREFERENCE_FORBIDDEN', 'Your current account access could not be confirmed.');
      if (!await patientFinancialAccess(currentActor, patientId)) throw this._preferenceError(404, 'PHARMACY_PREFERENCE_NOT_FOUND', 'Patient pharmacy preferences were not found.');
      const patientRows = await client.query(`
        SELECT p.id,p.market_scope,p.region,p.country FROM users p WHERE p.id=$1 AND p.role='patient' AND p.is_active=TRUE
        AND ${patientMarketSql('p')}=$2 ${lock}`, [patientId, actorMarket(currentActor)]);
      const patient = patientRows.rows[0];
      if (!patient || !knownMarket(patient.market_scope || patient.region || patient.country)) throw this._preferenceError(404, 'PHARMACY_PREFERENCE_NOT_FOUND', 'Patient pharmacy preferences were not found.');
      if (actor.role === 'provider') {
        // Keep the relationship used by the existing financial-access policy
        // present for the full read/write transaction.
        const care = await client.query('SELECT id FROM appointments WHERE patient_id=$1 AND provider_id=$2 LIMIT 1 FOR SHARE', [patientId, actor.id]);
        if (!care.rows.length) throw this._preferenceError(404, 'PHARMACY_PREFERENCE_NOT_FOUND', 'Patient pharmacy preferences were not found.');
      }
      const result = await operation(client, currentActor);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async _auditPreference(client, actor, patientId, id, action) {
    await client.query(`
      INSERT INTO audit_logs (user_id,action,resource_type,resource_id,patient_id,description,phi_accessed,success)
      VALUES ($1,$2,'pharmacy_preference',$3,$4,'Patient pharmacy preferences accessed or changed',TRUE,TRUE)`,
    [actor.id, action, id || null, patientId]);
  }

  async getPatientPharmacies(patientId, req) {
    return this._withPreferenceContext(patientId, req, false, async (client, actor) => {
      const { rows } = await client.query('SELECT * FROM pharmacy_preferences WHERE patient_id=$1 ORDER BY is_preferred DESC,created_at DESC,id LIMIT 100', [patientId]);
      await this._auditPreference(client, actor, patientId, null, 'read');
      return rows.map((row) => this._preferenceRecord(row));
    });
  }

  async addPatientPharmacy(patientId, pharmacyData, req) {
    const { z } = require('zod');
    const text = (maximum, required = false) => z.string().trim().min(required ? 1 : 0).max(maximum)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
    const schema = z.object({
      patientId: z.string().uuid().optional(),
      pharmacyName: text(255, true), pharmacyAddress: text(1000, true),
      pharmacyPhone: text(50).nullish(), pharmacyNpi: text(20).nullish(),
      latitude: z.number().finite().min(-90).max(90).nullish(), longitude: z.number().finite().min(-180).max(180).nullish(),
      distanceMiles: z.number().finite().min(0).max(999.99).nullish(),
      isPreferred: z.boolean().nullish(), source: z.enum(['patient_selected', 'ocr_extracted', 'gps_located']).nullish(),
    }).strict().superRefine((value, context) => {
      if ((value.latitude != null) !== (value.longitude != null)) context.addIssue({ code: 'custom', message: 'Coordinates must be provided together.' });
    });
    const parsed = schema.safeParse(pharmacyData);
    if (!parsed.success || parsed.data.patientId && parsed.data.patientId !== patientId) throw this._preferenceError(400, 'PHARMACY_PREFERENCE_INPUT_INVALID', 'Enter valid pharmacy details within the supported field limits.');
    const data = parsed.data;
    const name = data.pharmacyName.replace(/\s+/g, ' ');
    const address = data.pharmacyAddress.replace(/\s+/g, ' ');
    const npi = data.pharmacyNpi || null;
    return this._withPreferenceContext(patientId, req, true, async (client, actor) => {
      // The patient-row lock serializes competing commands, including entries
      // without NPI. Repeated name/address selection returns one stable record.
      const previous = await client.query(`
        SELECT * FROM pharmacy_preferences WHERE patient_id=$1 AND
          (($2::text IS NOT NULL AND pharmacy_npi=$2) OR
           ($2::text IS NULL AND pharmacy_npi IS NULL
            AND LOWER(REGEXP_REPLACE(TRIM(pharmacy_name),'[[:space:]]+',' ','g'))=LOWER($3)
            AND LOWER(REGEXP_REPLACE(TRIM(pharmacy_address),'[[:space:]]+',' ','g'))=LOWER($4)))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE`, [patientId, npi, name, address]);
      const existing = previous.rows[0];
      const preferred = data.isPreferred ?? existing?.is_preferred ?? false;
      if (preferred) await client.query('UPDATE pharmacy_preferences SET is_preferred=FALSE WHERE patient_id=$1 AND is_preferred=TRUE AND id<>$2::uuid', [patientId, existing?.id || '00000000-0000-0000-0000-000000000000']);
      const fields = [patientId, name, address, data.pharmacyPhone || null, npi,
        data.latitude ?? null, data.longitude ?? null,
        data.distanceMiles == null ? null : Math.round(data.distanceMiles * 100) / 100,
        preferred, data.source || 'patient_selected'];
      const result = existing ? await client.query(`
        UPDATE pharmacy_preferences SET pharmacy_name=$2,pharmacy_address=$3,pharmacy_phone=$4,pharmacy_npi=$5,
          latitude=$6,longitude=$7,distance_miles=$8,is_preferred=$9,source=$10,is_open=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE patient_id=$1 AND id=$11 RETURNING *`, [...fields, existing.id])
        : await client.query(`
        INSERT INTO pharmacy_preferences (patient_id,pharmacy_name,pharmacy_address,pharmacy_phone,pharmacy_npi,
          latitude,longitude,distance_miles,is_preferred,source,is_open)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL) RETURNING *`, fields);
      const row = result.rows[0];
      if (!row) throw this._preferenceError(503, 'PHARMACY_PREFERENCE_STORAGE_UNAVAILABLE', 'The pharmacy preference could not be saved.');
      await this._auditPreference(client, actor, patientId, row.id, existing ? 'update' : 'create');
      return { pharmacy: this._preferenceRecord(row), created: !existing };
    });
  }

  async setPreferredPharmacy(patientId, pharmacyId, req) {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(pharmacyId || ''))) throw this._preferenceError(400, 'PHARMACY_PREFERENCE_INPUT_INVALID', 'Choose a valid pharmacy preference.');
    return this._withPreferenceContext(patientId, req, true, async (client, actor) => {
      const owned = await client.query('SELECT id FROM pharmacy_preferences WHERE patient_id=$1 AND id=$2 FOR UPDATE', [patientId, pharmacyId]);
      if (!owned.rows.length) throw this._preferenceError(404, 'PHARMACY_PREFERENCE_NOT_FOUND', 'Pharmacy preference not found.');
      await client.query('UPDATE pharmacy_preferences SET is_preferred=FALSE WHERE patient_id=$1 AND is_preferred=TRUE AND id<>$2', [patientId, pharmacyId]);
      const { rows } = await client.query('UPDATE pharmacy_preferences SET is_preferred=TRUE,updated_at=CURRENT_TIMESTAMP WHERE patient_id=$1 AND id=$2 RETURNING *', [patientId, pharmacyId]);
      await this._auditPreference(client, actor, patientId, pharmacyId, 'update');
      return this._preferenceRecord(rows[0]);
    });
  }

  async removePatientPharmacy(patientId, pharmacyId, req) {
    if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(pharmacyId || ''))) throw this._preferenceError(400, 'PHARMACY_PREFERENCE_INPUT_INVALID', 'Choose a valid pharmacy preference.');
    return this._withPreferenceContext(patientId, req, true, async (client, actor) => {
      const { rows } = await client.query('DELETE FROM pharmacy_preferences WHERE patient_id=$1 AND id=$2 RETURNING id', [patientId, pharmacyId]);
      if (!rows.length) throw this._preferenceError(404, 'PHARMACY_PREFERENCE_NOT_FOUND', 'Pharmacy preference not found.');
      await this._auditPreference(client, actor, patientId, pharmacyId, 'delete');
      return true;
    });
  }
  
  /**
   * Get pharmacy by NPI
   */
  async getPharmacyByNpi(npi) {
    const { rows } = await db.query(`
      SELECT * FROM pharmacy_network
      WHERE npi = $1 AND is_active = true
    `, [npi]);
    
    return rows.length > 0 ? this._formatPharmacy(keysToCamel(rows[0])) : null;
  }
  
  /**
   * Add/Update pharmacy in network
   */
  async upsertPharmacy(pharmacyData) {
    const {
      name, chainName, npi, ncpdpId,
      addressLine1, addressLine2, city, state, zipCode, country,
      phone, fax, email,
      latitude, longitude,
      hours,
      capabilities,
      isInNetwork, isPreferred
    } = pharmacyData;
    
    const { rows } = await db.query(`
      INSERT INTO pharmacy_network (
        name, chain_name, npi, ncpdp_id,
        address_line1, address_line2, city, state, zip_code, country,
        phone, fax, email,
        latitude, longitude,
        hours_monday, hours_tuesday, hours_wednesday, hours_thursday,
        hours_friday, hours_saturday, hours_sunday,
        accepts_eprescriptions, has_drive_thru, has_24_hour,
        has_delivery, has_compounding, accepts_controlled_substances,
        dea_number,
        is_in_network, is_preferred, is_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, true
      )
      ON CONFLICT (npi) WHERE npi IS NOT NULL
      DO UPDATE SET
        name = EXCLUDED.name,
        chain_name = EXCLUDED.chain_name,
        address_line1 = EXCLUDED.address_line1,
        address_line2 = EXCLUDED.address_line2,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip_code = EXCLUDED.zip_code,
        phone = EXCLUDED.phone,
        fax = EXCLUDED.fax,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      name, chainName || null, npi || null, ncpdpId || null,
      addressLine1, addressLine2 || null, city, state, zipCode, country || 'USA',
      phone || null, fax || null, email || null,
      latitude || null, longitude || null,
      hours?.monday || null, hours?.tuesday || null, hours?.wednesday || null,
      hours?.thursday || null, hours?.friday || null, hours?.saturday || null,
      hours?.sunday || null,
      capabilities?.acceptsEprescriptions ?? true,
      capabilities?.hasDriveThru ?? false,
      capabilities?.has24Hour ?? false,
      capabilities?.hasDelivery ?? false,
      capabilities?.hasCompounding ?? false,
      capabilities?.acceptsControlledSubstances ?? true,
      capabilities?.deaNumber || null,
      isInNetwork ?? true,
      isPreferred ?? false
    ]);
    
    return this._formatPharmacy(keysToCamel(rows[0]));
  }
  
  // Private methods
  
  async _findLocalPharmacies(latitude, longitude, radiusMeters) {
    const radiusKm = radiusMeters / 1000;
    
    const { rows } = await db.query(`
      SELECT *,
             (
               6371 * acos(
                 cos(radians($1)) *
                 cos(radians(latitude)) *
                 cos(radians(longitude) - radians($2)) +
                 sin(radians($1)) *
                 sin(radians(latitude))
               )
             ) as distance_km
      FROM pharmacy_network
      WHERE is_active = true
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND (
        6371 * acos(
          cos(radians($1)) *
          cos(radians(latitude)) *
          cos(radians(longitude) - radians($2)) +
          sin(radians($1)) *
          sin(radians(latitude))
        )
      ) <= $3
      ORDER BY is_preferred DESC, distance_km ASC
      LIMIT 20
    `, [latitude, longitude, radiusKm]);
    
    return rows.map(r => this._formatPharmacy(keysToCamel(r)));
  }
  
  async _queryOverpassAPI(latitude, longitude, radiusMeters, signal) {
    try {
      const query = `
        [out:json][timeout:25];
        node(around:${radiusMeters},${latitude},${longitude})[amenity=pharmacy];
        out body;
        >;
        out skel qt;
      `;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      
      if (!response.ok) {
        throw new Error('Overpass API error');
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data.elements)) throw new Error('Pharmacy directory response is invalid');
      return data.elements.filter((element) => Number.isFinite(element.lat) && Number.isFinite(element.lon) && element.lat >= -90 && element.lat <= 90 && element.lon >= -180 && element.lon <= 180).slice(0, 15).map(element => {
        const tags = element.tags || {};
        const street = tags['addr:street'] || '';
        const number = tags['addr:housenumber'] || '';
        const city = tags['addr:city'] || '';
        const state = tags['addr:state'] || '';
        const zip = tags['addr:postcode'] || '';
        
        const fullAddress = street && number
          ? `${number} ${street}, ${city}${state ? `, ${state}` : ''}${zip ? ` ${zip}` : ''}`
          : `${city}${state ? `, ${state}` : ''}`;
        
        // Calculate distance
        const distanceKm = this._calculateDistance(
          latitude, longitude,
          element.lat, element.lon
        );
        
        return {
          id: `osm-${element.id}`,
          name: tags.name || tags.operator || 'Local Pharmacy',
          chainName: tags.brand || null,
          address: fullAddress,
          addressLine1: `${number} ${street}`.trim() || null,
          city: city || null,
          state: state || null,
          zipCode: zip || null,
          phone: tags.phone || tags['contact:phone'] || null,
          latitude: element.lat,
          longitude: element.lon,
          distanceKm: Math.round(distanceKm * 10) / 10,
          distanceMiles: Math.round(distanceKm * 0.621371 * 10) / 10,
          isOpen: this._isPharmacyOpen(tags.opening_hours),
          isPreferred: false,
          source: 'openstreetmap',
          acceptsEprescriptions: null,
          has24Hour: tags.opening_hours === '24/7' ? true : null,
          hasDelivery: tags.delivery === 'yes' ? true : tags.delivery === 'no' ? false : null,
        };
      });
    } catch (error) {
      throw error;
    }
  }
  
  _mergePharmacyResults(localPharmacies, osmPharmacies) {
    const seen = new Set();
    const merged = [];
    
    // Add local pharmacies first
    for (const pharmacy of localPharmacies) {
      const key = pharmacy.npi || `${pharmacy.name}-${pharmacy.zipCode}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(pharmacy);
      }
    }
    
    // Add OSM pharmacies that aren't duplicates
    for (const pharmacy of osmPharmacies) {
      const key = `${pharmacy.name}-${pharmacy.zipCode}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(pharmacy);
      }
    }
    
    // Sort by distance
    return merged.sort((a, b) => {
      // Preferred first
      if (a.isPreferred && !b.isPreferred) return -1;
      if (!a.isPreferred && b.isPreferred) return 1;
      // Then by distance
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    });
  }
  
  _formatPharmacy(pharmacy) {
    return {
      id: pharmacy.id,
      name: pharmacy.name,
      chainName: pharmacy.chainName,
      npi: pharmacy.npi,
      ncpdpId: pharmacy.ncpdpId,
      address: pharmacy.address || `${pharmacy.addressLine1 || ''}, ${pharmacy.city || ''}, ${pharmacy.state || ''} ${pharmacy.zipCode || ''}`.trim(),
      addressLine1: pharmacy.addressLine1,
      addressLine2: pharmacy.addressLine2,
      city: pharmacy.city,
      state: pharmacy.state,
      zipCode: pharmacy.zipCode,
      phone: pharmacy.phone,
      fax: pharmacy.fax,
      email: pharmacy.email,
      latitude: pharmacy.latitude,
      longitude: pharmacy.longitude,
      distanceKm: pharmacy.distanceKm ?? pharmacy.distance_km ?? null,
      distanceMiles: pharmacy.distanceMiles ?? (pharmacy.distanceKm != null ? Math.round(pharmacy.distanceKm * 0.621371 * 10) / 10 : null),
      hours: {
        monday: pharmacy.hoursMonday,
        tuesday: pharmacy.hoursTuesday,
        wednesday: pharmacy.hoursWednesday,
        thursday: pharmacy.hoursThursday,
        friday: pharmacy.hoursFriday,
        saturday: pharmacy.hoursSaturday,
        sunday: pharmacy.hoursSunday
      },
      capabilities: {
        acceptsEprescriptions: pharmacy.acceptsEprescriptions,
        hasDriveThru: pharmacy.hasDriveThru,
        has24Hour: pharmacy.has24Hour,
        hasDelivery: pharmacy.hasDelivery,
        hasCompounding: pharmacy.hasCompounding,
        acceptsControlledSubstances: pharmacy.acceptsControlledSubstances,
        deaNumber: pharmacy.deaNumber
      },
      isInNetwork: pharmacy.isInNetwork,
      isPreferred: pharmacy.isPreferred,
      isOpen: pharmacy.isOpen,
      source: pharmacy.source || 'network'
    };
  }
  
  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this._deg2rad(lat2 - lat1);
    const dLon = this._deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this._deg2rad(lat1)) * Math.cos(this._deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  _deg2rad(deg) {
    return deg * (Math.PI / 180);
  }
  
  _isPharmacyOpen(openingHours) {
    if (openingHours === '24/7') return true;
    if (openingHours === 'closed') return false;
    // Other expressions require pharmacy-local timezone and a validated parser.
    return null;
  }
}

module.exports = new PharmacyService();

