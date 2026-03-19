/**
 * RX Routing Engine
 * Core prescription routing: matches drugs → finds pharmacies → optimizes selection
 * Routes by: nearest, cheapest, fastest, or best-match
 */

const { getPool } = require('../../../server/db');

class RxRouter {
  /**
   * Route a prescription to the best pharmacy
   * @param {Object} params
   * @param {Array} params.items - Prescription items [{drug_name, generic_name, quantity}]
   * @param {number} params.latitude - Patient latitude
   * @param {number} params.longitude - Patient longitude
   * @param {string} params.strategy - 'nearest' | 'cheapest' | 'fastest' | 'best_match'
   * @param {number} params.maxRadiusKm - Max search radius
   * @param {boolean} params.allowSubstitution - Allow generic substitution
   */
  async routePrescription({
    items, latitude, longitude, strategy = 'best_match',
    maxRadiusKm = 25, allowSubstitution = true,
  }) {
    const pool = getPool();

    // Step 1: Resolve all drug items to catalog IDs
    const resolvedItems = await this.resolveDrugs(items, allowSubstitution);

    // Step 2: Find pharmacies with availability within radius
    const pharmacies = await this.findPharmaciesWithStock(
      resolvedItems, latitude, longitude, maxRadiusKm
    );

    if (!pharmacies.length) {
      return {
        success: false,
        message: 'No pharmacies found with all requested medications in your area',
        partialMatches: await this.findPartialMatches(resolvedItems, latitude, longitude, maxRadiusKm),
      };
    }

    // Step 3: Score and rank pharmacies
    const ranked = this.rankPharmacies(pharmacies, strategy, latitude, longitude);

    // Step 4: Return top results with pricing
    return {
      success: true,
      results: ranked.slice(0, 10),
      totalFound: pharmacies.length,
      strategy,
      resolvedItems,
    };
  }

  /**
   * Resolve drug names to catalog entries with substitution logic
   */
  async resolveDrugs(items, allowSubstitution = true) {
    const pool = getPool();
    const resolved = [];

    for (const item of items) {
      // Try exact match first
      let result = await pool.query(
        `SELECT id, name, generic_name, brand_name, category, requires_prescription,
                substitution_group, is_generic, dosage_form, strength, pack_size,
                reference_price
         FROM ng_drug_catalog
         WHERE is_active = true AND (
           LOWER(name) = LOWER($1)
           OR LOWER(brand_name) = LOWER($1)
           OR LOWER(generic_name) = LOWER($1)
         )
         LIMIT 5`,
        [item.drug_name]
      );

      if (!result.rows.length) {
        // Full-text search fallback
        result = await pool.query(
          `SELECT id, name, generic_name, brand_name, category, requires_prescription,
                  substitution_group, is_generic, dosage_form, strength, pack_size,
                  reference_price
           FROM ng_drug_catalog
           WHERE is_active = true AND
             to_tsvector('english', name || ' ' || COALESCE(generic_name, '') || ' ' || COALESCE(brand_name, ''))
             @@ plainto_tsquery('english', $1)
           ORDER BY ts_rank(
             to_tsvector('english', name || ' ' || COALESCE(generic_name, '') || ' ' || COALESCE(brand_name, '')),
             plainto_tsquery('english', $1)
           ) DESC
           LIMIT 5`,
          [item.drug_name]
        );
      }

      const matches = result.rows;
      let substitutes = [];

      // Find substitutes if allowed
      if (allowSubstitution && matches.length > 0 && matches[0].substitution_group) {
        const subResult = await pool.query(
          `SELECT id, name, generic_name, brand_name, is_generic, strength,
                  pack_size, reference_price
           FROM ng_drug_catalog
           WHERE substitution_group = $1 AND id != $2 AND is_active = true
           ORDER BY is_generic DESC, reference_price ASC
           LIMIT 5`,
          [matches[0].substitution_group, matches[0].id]
        );
        substitutes = subResult.rows;
      }

      resolved.push({
        original: item,
        matches,
        substitutes,
        resolved: matches[0] || null,
        hasSubstitutes: substitutes.length > 0,
        requiresPrescription: matches[0]?.requires_prescription || false,
        quantity: item.quantity || 1,
      });
    }

    return resolved;
  }

  /**
   * Find pharmacies that have ALL requested drugs in stock within radius
   */
  async findPharmaciesWithStock(resolvedItems, lat, lng, radiusKm) {
    const pool = getPool();

    // Get all drug IDs (including substitutes)
    const drugIds = [];
    const drugIdSets = []; // For each item, the set of acceptable drug IDs

    for (const item of resolvedItems) {
      const acceptableIds = [];
      if (item.resolved) {
        acceptableIds.push(item.resolved.id);
        item.substitutes.forEach(s => acceptableIds.push(s.id));
      }
      drugIdSets.push(acceptableIds);
      drugIds.push(...acceptableIds);
    }

    if (!drugIds.length) return [];

    // Find pharmacies within radius that are approved and active
    const pharmacyResult = await pool.query(
      `SELECT p.id, p.name, p.slug, p.address_line1, p.city, p.state,
              p.latitude, p.longitude, p.phone, p.delivery_enabled,
              p.delivery_radius_km, p.minimum_order_amount, p.rating,
              p.total_orders, p.subscription_tier, p.operating_hours,
              (
                6371 * acos(
                  cos(radians($1)) * cos(radians(p.latitude))
                  * cos(radians(p.longitude) - radians($2))
                  + sin(radians($1)) * sin(radians(p.latitude))
                )
              ) AS distance_km
       FROM ng_pharmacies p
       WHERE p.status = 'approved'
         AND p.latitude IS NOT NULL
         AND p.longitude IS NOT NULL
         AND (
           6371 * acos(
             cos(radians($1)) * cos(radians(p.latitude))
             * cos(radians(p.longitude) - radians($2))
             + sin(radians($1)) * sin(radians(p.latitude))
           )
         ) <= $3
       ORDER BY distance_km ASC`,
      [lat, lng, radiusKm]
    );

    const pharmacies = pharmacyResult.rows;
    const results = [];

    // For each pharmacy, check if they have all drugs
    for (const pharmacy of pharmacies) {
      const inventoryResult = await pool.query(
        `SELECT i.drug_id, i.quantity_available, i.selling_price, i.discount_percent,
                i.expiry_date, i.batch_number,
                d.name as drug_name, d.generic_name, d.brand_name, d.is_generic,
                d.strength, d.pack_size
         FROM ng_pharmacy_inventory i
         JOIN ng_drug_catalog d ON d.id = i.drug_id
         WHERE i.pharmacy_id = $1
           AND i.drug_id = ANY($2::uuid[])
           AND i.is_available = true
           AND i.quantity_available > 0
           AND (i.expiry_date IS NULL OR i.expiry_date > CURRENT_DATE + INTERVAL '30 days')`,
        [pharmacy.id, drugIds]
      );

      const availableInventory = inventoryResult.rows;
      const matchedItems = [];
      let allMatched = true;
      let totalPrice = 0;

      // Check if each requested item can be fulfilled
      for (let i = 0; i < resolvedItems.length; i++) {
        const acceptableIds = drugIdSets[i];
        const available = availableInventory.filter(inv =>
          acceptableIds.includes(inv.drug_id) && inv.quantity_available >= (resolvedItems[i].quantity || 1)
        );

        if (available.length > 0) {
          // Pick cheapest available option
          const best = available.sort((a, b) => a.selling_price - b.selling_price)[0];
          const qty = resolvedItems[i].quantity || 1;
          const effectivePrice = best.discount_percent
            ? best.selling_price * (1 - best.discount_percent / 100)
            : best.selling_price;

          matchedItems.push({
            requestedDrug: resolvedItems[i].original.drug_name,
            fulfilledBy: {
              drugId: best.drug_id,
              drugName: best.drug_name,
              genericName: best.generic_name,
              isGeneric: best.is_generic,
              strength: best.strength,
              packSize: best.pack_size,
            },
            unitPrice: effectivePrice,
            quantity: qty,
            totalPrice: Math.round(effectivePrice * qty),
            isSubstitution: best.drug_id !== resolvedItems[i].resolved?.id,
            expiryDate: best.expiry_date,
          });

          totalPrice += Math.round(effectivePrice * qty);
        } else {
          allMatched = false;
          break;
        }
      }

      if (allMatched) {
        results.push({
          pharmacy: {
            id: pharmacy.id,
            name: pharmacy.name,
            slug: pharmacy.slug,
            address: pharmacy.address_line1,
            city: pharmacy.city,
            state: pharmacy.state,
            phone: pharmacy.phone,
            rating: parseFloat(pharmacy.rating) || 0,
            totalOrders: pharmacy.total_orders,
            deliveryEnabled: pharmacy.delivery_enabled,
            deliveryRadius: parseFloat(pharmacy.delivery_radius_km),
            minimumOrder: parseFloat(pharmacy.minimum_order_amount),
            subscriptionTier: pharmacy.subscription_tier,
            operatingHours: pharmacy.operating_hours,
          },
          distance: parseFloat(pharmacy.distance_km).toFixed(2),
          items: matchedItems,
          subtotal: totalPrice,
          canDeliver: pharmacy.delivery_enabled && parseFloat(pharmacy.distance_km) <= parseFloat(pharmacy.delivery_radius_km),
        });
      }
    }

    return results;
  }

  /**
   * Find partial matches when no pharmacy has everything
   */
  async findPartialMatches(resolvedItems, lat, lng, radiusKm) {
    // Simplified: just find pharmacies that have at least one item
    const pool = getPool();
    const allDrugIds = resolvedItems
      .filter(r => r.resolved)
      .map(r => r.resolved.id);

    if (!allDrugIds.length) return [];

    const result = await pool.query(
      `SELECT DISTINCT p.id, p.name, p.city, p.state,
              COUNT(DISTINCT i.drug_id) as items_available,
              (6371 * acos(cos(radians($1)) * cos(radians(p.latitude))
                * cos(radians(p.longitude) - radians($2))
                + sin(radians($1)) * sin(radians(p.latitude)))) AS distance_km
       FROM ng_pharmacies p
       JOIN ng_pharmacy_inventory i ON i.pharmacy_id = p.id
       WHERE p.status = 'approved'
         AND i.drug_id = ANY($3::uuid[])
         AND i.is_available = true
         AND i.quantity_available > 0
         AND (6371 * acos(cos(radians($1)) * cos(radians(p.latitude))
           * cos(radians(p.longitude) - radians($2))
           + sin(radians($1)) * sin(radians(p.latitude)))) <= $4
       GROUP BY p.id, p.name, p.city, p.state, p.latitude, p.longitude
       ORDER BY items_available DESC, distance_km ASC
       LIMIT 5`,
      [lat, lng, allDrugIds, radiusKm]
    );

    return result.rows.map(r => ({
      pharmacyId: r.id,
      name: r.name,
      city: r.city,
      state: r.state,
      itemsAvailable: parseInt(r.items_available),
      totalRequested: resolvedItems.length,
      distance: parseFloat(r.distance_km).toFixed(2),
    }));
  }

  /**
   * Rank pharmacies by strategy
   */
  rankPharmacies(pharmacies, strategy, patientLat, patientLng) {
    return pharmacies.sort((a, b) => {
      switch (strategy) {
        case 'nearest':
          return parseFloat(a.distance) - parseFloat(b.distance);

        case 'cheapest':
          return a.subtotal - b.subtotal;

        case 'fastest':
          // Prefer pharmacies that can deliver and are close
          const aScore = a.canDeliver ? parseFloat(a.distance) : parseFloat(a.distance) + 100;
          const bScore = b.canDeliver ? parseFloat(b.distance) : parseFloat(b.distance) + 100;
          return aScore - bScore;

        case 'best_match':
        default:
          // Composite score: 40% price, 30% distance, 20% rating, 10% order volume
          const maxPrice = Math.max(...pharmacies.map(p => p.subtotal));
          const maxDist = Math.max(...pharmacies.map(p => parseFloat(p.distance)));
          const maxRating = 5;
          const maxOrders = Math.max(...pharmacies.map(p => p.pharmacy.totalOrders), 1);

          const scoreA =
            0.4 * (1 - a.subtotal / (maxPrice || 1)) +
            0.3 * (1 - parseFloat(a.distance) / (maxDist || 1)) +
            0.2 * (a.pharmacy.rating / maxRating) +
            0.1 * (a.pharmacy.totalOrders / maxOrders);

          const scoreB =
            0.4 * (1 - b.subtotal / (maxPrice || 1)) +
            0.3 * (1 - parseFloat(b.distance) / (maxDist || 1)) +
            0.2 * (b.pharmacy.rating / maxRating) +
            0.1 * (b.pharmacy.totalOrders / maxOrders);

          return scoreB - scoreA; // Higher score = better
      }
    });
  }

  /**
   * Check drug availability at a specific pharmacy
   */
  async checkAvailability(pharmacyId, drugId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT i.quantity_available, i.selling_price, i.discount_percent, i.expiry_date,
              d.name, d.generic_name, d.requires_prescription
       FROM ng_pharmacy_inventory i
       JOIN ng_drug_catalog d ON d.id = i.drug_id
       WHERE i.pharmacy_id = $1 AND i.drug_id = $2 AND i.is_available = true`,
      [pharmacyId, drugId]
    );
    return result.rows[0] || null;
  }

  /**
   * Search drugs in catalog
   */
  async searchDrugs(query, category = null, limit = 20) {
    const pool = getPool();
    let sql = `
      SELECT id, name, generic_name, brand_name, category, dosage_form,
             strength, pack_size, requires_prescription, is_generic,
             reference_price, manufacturer
      FROM ng_drug_catalog
      WHERE is_active = true AND (
        to_tsvector('english', name || ' ' || COALESCE(generic_name, '') || ' ' || COALESCE(brand_name, ''))
        @@ plainto_tsquery('english', $1)
        OR LOWER(name) LIKE LOWER($2)
        OR LOWER(generic_name) LIKE LOWER($2)
      )`;

    const params = [query, `%${query}%`];

    if (category) {
      sql += ` AND category = $3`;
      params.push(category);
    }

    sql += ` ORDER BY ts_rank(
      to_tsvector('english', name || ' ' || COALESCE(generic_name, '') || ' ' || COALESCE(brand_name, '')),
      plainto_tsquery('english', $1)
    ) DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(sql, params);
    return result.rows;
  }
}

module.exports = new RxRouter();
