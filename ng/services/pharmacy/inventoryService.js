/**
 * Inventory Management Service
 * Handles drug stock management, reorder alerts, and pricing engine
 */

const { getPool } = require('../../../server/db');

class InventoryService {
  /**
   * Get full inventory for a pharmacy
   */
  async getInventory(pharmacyId, { page = 1, limit = 50, search = '', category = null, lowStock = false } = {}) {
    const pool = getPool();
    const offset = (page - 1) * limit;

    let sql = `
      SELECT i.*, d.name as drug_name, d.generic_name, d.brand_name,
             d.category, d.dosage_form, d.strength, d.pack_size,
             d.manufacturer, d.requires_prescription, d.reference_price
      FROM ng_pharmacy_inventory i
      JOIN ng_drug_catalog d ON d.id = i.drug_id
      WHERE i.pharmacy_id = $1`;
    const params = [pharmacyId];

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (LOWER(d.name) LIKE LOWER($${params.length}) OR LOWER(d.generic_name) LIKE LOWER($${params.length}))`;
    }

    if (category) {
      params.push(category);
      sql += ` AND d.category = $${params.length}`;
    }

    if (lowStock) {
      sql += ` AND i.quantity_available <= i.reorder_level`;
    }

    const countSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as count FROM');

    sql += ` ORDER BY d.name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const [items, countResult] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, params.slice(0, -2)),
    ]);

    return {
      items: items.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    };
  }

  /**
   * Update inventory item (quantity, price)
   */
  async updateItem(pharmacyId, inventoryId, updates) {
    const pool = getPool();
    const allowedFields = {
      quantity_available: updates.quantityAvailable,
      selling_price: updates.sellingPrice,
      cost_price: updates.costPrice,
      discount_percent: updates.discountPercent,
      reorder_level: updates.reorderLevel,
      is_available: updates.isAvailable,
      expiry_date: updates.expiryDate,
    };

    const setClauses = [];
    const values = [];
    let i = 1;

    for (const [key, value] of Object.entries(allowedFields)) {
      if (value !== undefined) {
        setClauses.push(`${key} = $${i}`);
        values.push(value);
        i++;
      }
    }

    if (!setClauses.length) throw new Error('No fields to update');

    setClauses.push("availability_verification_status = 'unverified'");
    setClauses.push('availability_verified_at = NULL');
    setClauses.push('availability_verified_by = NULL');
    setClauses.push("availability_source = 'pharmacy_update_pending_admin_review'");
    setClauses.push('updated_at = NOW()');
    values.push(inventoryId, pharmacyId);

    const result = await pool.query(
      `UPDATE ng_pharmacy_inventory SET ${setClauses.join(', ')}
       WHERE id = $${values.length - 1} AND pharmacy_id = $${values.length}
       RETURNING *`,
      values
    );

    if (!result.rows.length) throw new Error('Inventory item not found');

    // Recalculate markup
    if (result.rows[0].cost_price && result.rows[0].selling_price) {
      const markup = ((result.rows[0].selling_price - result.rows[0].cost_price) / result.rows[0].cost_price * 100).toFixed(2);
      await pool.query(
        'UPDATE ng_pharmacy_inventory SET markup_percent = $1 WHERE id = $2',
        [markup, inventoryId]
      );
    }

    return result.rows[0];
  }

  /**
   * Bulk import inventory (CSV or array)
   */
  async bulkImport(pharmacyId, items) {
    const pool = getPool();
    const results = { imported: 0, skipped: 0, errors: [] };

    for (const item of items) {
      try {
        // Find or match drug in catalog
        let drugId = item.drugId;

        if (!drugId && item.drugName) {
          const drug = await pool.query(
            `SELECT id FROM ng_drug_catalog
             WHERE LOWER(name) = LOWER($1) OR LOWER(generic_name) = LOWER($1) OR LOWER(brand_name) = LOWER($1)
             LIMIT 1`,
            [item.drugName]
          );
          drugId = drug.rows[0]?.id;
        }

        if (!drugId) {
          results.errors.push({ item: item.drugName, error: 'Drug not found in catalog' });
          results.skipped++;
          continue;
        }

        await pool.query(
          `INSERT INTO ng_pharmacy_inventory (
            pharmacy_id, drug_id, quantity_available, cost_price, selling_price,
            batch_number, expiry_date, reorder_level
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (pharmacy_id, drug_id, batch_number)
          DO UPDATE SET
            quantity_available = EXCLUDED.quantity_available,
            cost_price = EXCLUDED.cost_price,
            selling_price = EXCLUDED.selling_price,
            expiry_date = EXCLUDED.expiry_date,
            availability_verification_status = 'unverified',
            availability_verified_at = NULL,
            availability_verified_by = NULL,
            availability_source = 'pharmacy_import_pending_admin_review',
            updated_at = NOW()`,
          [
            pharmacyId, drugId, item.quantity || 0,
            item.costPrice || 0, item.sellingPrice || 0,
            item.batchNumber || 'DEFAULT',
            item.expiryDate || null, item.reorderLevel || 10,
          ]
        );
        results.imported++;
      } catch (err) {
        results.errors.push({ item: item.drugName || item.drugId, error: err.message });
        results.skipped++;
      }
    }

    return results;
  }

  /**
   * Get low stock alerts
   */
  async getLowStockAlerts(pharmacyId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT i.*, d.name as drug_name, d.generic_name
       FROM ng_pharmacy_inventory i
       JOIN ng_drug_catalog d ON d.id = i.drug_id
       WHERE i.pharmacy_id = $1
         AND i.quantity_available <= i.reorder_level
         AND i.is_available = true
       ORDER BY i.quantity_available ASC`,
      [pharmacyId]
    );
    return result.rows;
  }

  /**
   * Dynamic pricing engine
   * Adjusts prices based on demand, competition, and margins
   */
  async suggestPricing(pharmacyId, drugId) {
    const pool = getPool();

    // Get drug info and reference price
    const drug = await pool.query(
      'SELECT * FROM ng_drug_catalog WHERE id = $1', [drugId]
    );
    if (!drug.rows.length) throw new Error('Drug not found');
    const d = drug.rows[0];

    // Get current pharmacy price
    const current = await pool.query(
      'SELECT * FROM ng_pharmacy_inventory WHERE pharmacy_id = $1 AND drug_id = $2',
      [pharmacyId, drugId]
    );

    // Get competitor prices in same state
    const pharmacy = await pool.query(
      'SELECT state FROM ng_pharmacies WHERE id = $1', [pharmacyId]
    );
    const competitors = await pool.query(
      `SELECT AVG(i.selling_price) as avg_price,
              MIN(i.selling_price) as min_price,
              MAX(i.selling_price) as max_price,
              COUNT(*) as pharmacy_count
       FROM ng_pharmacy_inventory i
       JOIN ng_pharmacies p ON p.id = i.pharmacy_id
       WHERE i.drug_id = $1
         AND p.state = $2
         AND p.id != $3
         AND i.is_available = true`,
      [drugId, pharmacy.rows[0]?.state, pharmacyId]
    );

    const comp = competitors.rows[0];
    const referencePrice = parseFloat(d.reference_price) || 0;
    const avgMarketPrice = parseFloat(comp.avg_price) || referencePrice;
    const currentPrice = current.rows[0] ? parseFloat(current.rows[0].selling_price) : 0;

    // Suggest competitive price
    const suggestedPrice = avgMarketPrice > 0
      ? Math.round(avgMarketPrice * 0.97) // 3% below market average
      : referencePrice > 0
        ? Math.round(referencePrice * 1.15) // 15% above reference
        : currentPrice;

    return {
      drugName: d.name,
      referencePrice,
      currentPrice,
      market: {
        average: Math.round(avgMarketPrice),
        min: Math.round(parseFloat(comp.min_price) || 0),
        max: Math.round(parseFloat(comp.max_price) || 0),
        pharmacyCount: parseInt(comp.pharmacy_count) || 0,
      },
      suggestedPrice,
      suggestedMarkup: currentPrice > 0 ? ((suggestedPrice - currentPrice) / currentPrice * 100).toFixed(1) : null,
    };
  }

  /**
   * Get inventory dashboard stats
   */
  async getDashboardStats(pharmacyId) {
    const pool = getPool();

    const [totalItems, lowStock, expiringSoon, totalValue] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM ng_pharmacy_inventory WHERE pharmacy_id = $1 AND is_available = true', [pharmacyId]),
      pool.query('SELECT COUNT(*) as count FROM ng_pharmacy_inventory WHERE pharmacy_id = $1 AND quantity_available <= reorder_level AND is_available = true', [pharmacyId]),
      pool.query(`SELECT COUNT(*) as count FROM ng_pharmacy_inventory WHERE pharmacy_id = $1 AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '90 days' AND is_available = true`, [pharmacyId]),
      pool.query('SELECT SUM(quantity_available * selling_price) as total FROM ng_pharmacy_inventory WHERE pharmacy_id = $1 AND is_available = true', [pharmacyId]),
    ]);

    return {
      totalItems: parseInt(totalItems.rows[0].count),
      lowStockItems: parseInt(lowStock.rows[0].count),
      expiringSoon: parseInt(expiringSoon.rows[0].count),
      totalStockValue: parseFloat(totalValue.rows[0].total) || 0,
    };
  }
}

module.exports = new InventoryService();
