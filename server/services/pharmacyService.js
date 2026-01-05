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
  async findNearbyPharmacies(latitude, longitude, radiusMeters = 5000) {
    try {
      // First check our local database
      const localPharmacies = await this._findLocalPharmacies(latitude, longitude, radiusMeters);
      
      if (localPharmacies.length >= 5) {
        return localPharmacies;
      }
      
      // Fall back to Overpass API for real-time data
      const osmPharmacies = await this._queryOverpassAPI(latitude, longitude, radiusMeters);
      
      // Merge results, preferring local data
      const merged = this._mergePharmacyResults(localPharmacies, osmPharmacies);
      
      return merged.slice(0, 20);
    } catch (error) {
      logger.error('Find nearby pharmacies error:', error);
      // Return fallback pharmacies if all else fails
      return this._getFallbackPharmacies();
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
      latitude || null,
      longitude || null,
      limit
    ]);
    
    return rows.map(r => this._formatPharmacy(keysToCamel(r)));
  }
  
  /**
   * Get patient's preferred pharmacies
   */
  async getPatientPharmacies(patientId) {
    const { rows } = await db.query(`
      SELECT * FROM pharmacy_preferences
      WHERE patient_id = $1
      ORDER BY is_preferred DESC, created_at DESC
    `, [patientId]);
    
    return rows.map(r => keysToCamel(r));
  }
  
  /**
   * Add pharmacy to patient preferences
   */
  async addPatientPharmacy(patientId, pharmacyData) {
    const {
      pharmacyName,
      pharmacyAddress,
      pharmacyPhone,
      pharmacyNpi,
      latitude,
      longitude,
      distanceMiles,
      isPreferred,
      source
    } = pharmacyData;
    
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // If setting as preferred, unset other preferred
      if (isPreferred) {
        await client.query(`
          UPDATE pharmacy_preferences
          SET is_preferred = false
          WHERE patient_id = $1 AND is_preferred = true
        `, [patientId]);
      }
      
      // Insert or update
      const { rows } = await client.query(`
        INSERT INTO pharmacy_preferences (
          patient_id, pharmacy_name, pharmacy_address, pharmacy_phone,
          pharmacy_npi, latitude, longitude, distance_miles,
          is_preferred, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (patient_id, pharmacy_npi)
        DO UPDATE SET
          pharmacy_name = EXCLUDED.pharmacy_name,
          pharmacy_address = EXCLUDED.pharmacy_address,
          pharmacy_phone = EXCLUDED.pharmacy_phone,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          distance_miles = EXCLUDED.distance_miles,
          is_preferred = EXCLUDED.is_preferred,
          source = EXCLUDED.source,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        patientId, pharmacyName, pharmacyAddress, pharmacyPhone,
        pharmacyNpi || null, latitude || null, longitude || null,
        distanceMiles || null, isPreferred || false, source || 'patient_selected'
      ]);
      
      await client.query('COMMIT');
      
      return keysToCamel(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Set pharmacy as preferred
   */
  async setPreferredPharmacy(patientId, pharmacyId) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Unset current preferred
      await client.query(`
        UPDATE pharmacy_preferences
        SET is_preferred = false
        WHERE patient_id = $1 AND is_preferred = true
      `, [patientId]);
      
      // Set new preferred
      const { rows } = await client.query(`
        UPDATE pharmacy_preferences
        SET is_preferred = true, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND patient_id = $1
        RETURNING *
      `, [patientId, pharmacyId]);
      
      await client.query('COMMIT');
      
      return rows.length > 0 ? keysToCamel(rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Remove pharmacy from preferences
   */
  async removePatientPharmacy(patientId, pharmacyId) {
    const { rowCount } = await db.query(`
      DELETE FROM pharmacy_preferences
      WHERE id = $2 AND patient_id = $1
    `, [patientId, pharmacyId]);
    
    return rowCount > 0;
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
  
  async _queryOverpassAPI(latitude, longitude, radiusMeters) {
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
        body: query
      });
      
      if (!response.ok) {
        throw new Error('Overpass API error');
      }
      
      const data = await response.json();
      
      return data.elements.slice(0, 15).map(element => {
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
          isPreferred: ['CVS', 'Walgreens', 'Rite Aid', 'Walmart'].some(
            chain => (tags.name || tags.brand || '').includes(chain)
          ),
          source: 'openstreetmap',
          acceptsEprescriptions: true,
          has24Hour: (tags.opening_hours || '').includes('24/7'),
          hasDelivery: tags['delivery'] === 'yes'
        };
      });
    } catch (error) {
      logger.warn('Overpass API query failed:', error.message);
      return [];
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
      return (a.distanceKm || 999) - (b.distanceKm || 999);
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
      distanceKm: pharmacy.distanceKm || pharmacy.distance_km,
      distanceMiles: pharmacy.distanceMiles || (pharmacy.distanceKm ? Math.round(pharmacy.distanceKm * 0.621371 * 10) / 10 : null),
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
    if (!openingHours) return true; // Assume open if unknown
    if (openingHours.includes('24/7')) return true;
    
    // Simple check - in production, use a proper library
    const now = new Date();
    const hour = now.getHours();
    
    // Most pharmacies are open 9am-9pm
    return hour >= 9 && hour < 21;
  }
  
  _getFallbackPharmacies() {
    return [
      {
        id: 'fallback-1',
        name: 'CVS Pharmacy',
        chainName: 'CVS',
        address: 'Use pharmacy finder to locate nearest CVS',
        isPreferred: true,
        acceptsEprescriptions: true,
        source: 'fallback'
      },
      {
        id: 'fallback-2',
        name: 'Walgreens',
        chainName: 'Walgreens',
        address: 'Use pharmacy finder to locate nearest Walgreens',
        isPreferred: true,
        acceptsEprescriptions: true,
        source: 'fallback'
      },
      {
        id: 'fallback-3',
        name: 'Walmart Pharmacy',
        chainName: 'Walmart',
        address: 'Use pharmacy finder to locate nearest Walmart',
        isPreferred: false,
        acceptsEprescriptions: true,
        source: 'fallback'
      },
      {
        id: 'fallback-4',
        name: 'Rite Aid',
        chainName: 'Rite Aid',
        address: 'Use pharmacy finder to locate nearest Rite Aid',
        isPreferred: false,
        acceptsEprescriptions: true,
        source: 'fallback'
      }
    ];
  }
}

module.exports = new PharmacyService();

