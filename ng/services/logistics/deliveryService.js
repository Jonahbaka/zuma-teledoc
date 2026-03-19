/**
 * Delivery / Logistics Service
 * Integrates with Gokada, Kwik, and MAX.ng for last-mile delivery
 * Handles dispatch, tracking, and proof of delivery
 */

const https = require('https');
const { getPool } = require('../../../server/db');
const ngConfig = require('../../config');

class DeliveryService {
  /**
   * Request delivery for an order
   * Routes to the best delivery partner based on availability and cost
   */
  async requestDelivery(orderId, { preferredPartner = null } = {}) {
    const pool = getPool();

    // Get order and pharmacy details
    const order = await pool.query(
      `SELECT o.*, p.name as pharmacy_name, p.address_line1 as pharmacy_address,
              p.latitude as pickup_lat, p.longitude as pickup_lng,
              p.phone as pharmacy_phone, p.city as pharmacy_city
       FROM ng_orders o
       JOIN ng_pharmacies p ON p.id = o.pharmacy_id
       WHERE o.id = $1`,
      [orderId]
    );

    if (!order.rows.length) throw new Error('Order not found');
    const o = order.rows[0];
    const deliveryAddr = o.delivery_address;

    if (!deliveryAddr?.latitude || !deliveryAddr?.longitude) {
      throw new Error('Delivery address must include coordinates');
    }

    // Calculate distance
    const distance = this.calculateDistance(
      o.pickup_lat, o.pickup_lng,
      deliveryAddr.latitude, deliveryAddr.longitude
    );

    if (distance > ngConfig.delivery.maxDistance) {
      throw new Error(`Delivery distance (${distance.toFixed(1)}km) exceeds maximum (${ngConfig.delivery.maxDistance}km)`);
    }

    // Calculate delivery fee
    const deliveryFee = this.calculateDeliveryFee(distance);

    // Select delivery partner
    const partner = preferredPartner || ngConfig.delivery.defaultProvider;

    // Create tracking record
    const tracking = await pool.query(
      `INSERT INTO ng_delivery_tracking (
        order_id, partner, pickup_location, dropoff_location,
        distance_km, cost, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *`,
      [
        orderId, partner,
        JSON.stringify({
          lat: o.pickup_lat, lng: o.pickup_lng,
          address: o.pharmacy_address, city: o.pharmacy_city,
        }),
        JSON.stringify({
          lat: deliveryAddr.latitude, lng: deliveryAddr.longitude,
          address: deliveryAddr.address, city: deliveryAddr.city,
        }),
        distance, deliveryFee,
      ]
    );

    // Dispatch to partner
    let dispatchResult;
    try {
      dispatchResult = await this.dispatchToPartner(partner, {
        trackingId: tracking.rows[0].id,
        pickup: {
          address: o.pharmacy_address,
          lat: o.pickup_lat,
          lng: o.pickup_lng,
          contactName: o.pharmacy_name,
          contactPhone: o.pharmacy_phone,
        },
        dropoff: {
          address: deliveryAddr.address,
          lat: deliveryAddr.latitude,
          lng: deliveryAddr.longitude,
          contactName: deliveryAddr.recipientName,
          contactPhone: deliveryAddr.recipientPhone,
        },
        packageDescription: 'Pharmaceutical products - handle with care',
        orderValue: o.total_amount,
      });
    } catch (err) {
      // Update tracking with error
      await pool.query(
        `UPDATE ng_delivery_tracking SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [tracking.rows[0].id]
      );
      throw new Error(`Delivery dispatch failed: ${err.message}`);
    }

    // Update tracking with partner info
    await pool.query(
      `UPDATE ng_delivery_tracking SET
        partner_tracking_id = $1,
        rider_name = $2,
        rider_phone = $3,
        estimated_pickup_at = $4,
        estimated_delivery_at = $5,
        status = 'assigned',
        updated_at = NOW()
      WHERE id = $6`,
      [
        dispatchResult.trackingId,
        dispatchResult.riderName,
        dispatchResult.riderPhone,
        dispatchResult.estimatedPickup,
        dispatchResult.estimatedDelivery,
        tracking.rows[0].id,
      ]
    );

    // Update order with delivery info
    await pool.query(
      `UPDATE ng_orders SET
        delivery_partner = $1,
        delivery_tracking_id = $2,
        delivery_rider_name = $3,
        delivery_rider_phone = $4,
        delivery_fee = $5,
        estimated_delivery_at = $6,
        status = 'dispatched',
        updated_at = NOW()
      WHERE id = $7`,
      [
        partner,
        dispatchResult.trackingId,
        dispatchResult.riderName,
        dispatchResult.riderPhone,
        deliveryFee,
        dispatchResult.estimatedDelivery,
        orderId,
      ]
    );

    return {
      trackingId: tracking.rows[0].id,
      partnerTrackingId: dispatchResult.trackingId,
      partner,
      rider: { name: dispatchResult.riderName, phone: dispatchResult.riderPhone },
      estimatedDelivery: dispatchResult.estimatedDelivery,
      deliveryFee,
      distance: distance.toFixed(2),
    };
  }

  /**
   * Dispatch to specific delivery partner
   */
  async dispatchToPartner(partner, params) {
    switch (partner) {
      case 'gokada':
        return this.dispatchGokada(params);
      case 'kwik':
        return this.dispatchKwik(params);
      case 'maxng':
        return this.dispatchMaxNG(params);
      default:
        throw new Error(`Unknown delivery partner: ${partner}`);
    }
  }

  /**
   * Gokada dispatch
   */
  async dispatchGokada(params) {
    const config = ngConfig.delivery.gokada;
    if (!config.apiKey) {
      // Simulation mode for development
      return this.simulateDispatch(params);
    }

    return this.makePartnerRequest(config.baseUrl, '/deliveries', config.apiKey, {
      pickup_address: params.pickup.address,
      pickup_latitude: params.pickup.lat,
      pickup_longitude: params.pickup.lng,
      pickup_name: params.pickup.contactName,
      pickup_phone: params.pickup.contactPhone,
      delivery_address: params.dropoff.address,
      delivery_latitude: params.dropoff.lat,
      delivery_longitude: params.dropoff.lng,
      delivery_name: params.dropoff.contactName,
      delivery_phone: params.dropoff.contactPhone,
      description: params.packageDescription,
    });
  }

  /**
   * Kwik dispatch
   */
  async dispatchKwik(params) {
    const config = ngConfig.delivery.kwik;
    if (!config.apiKey) return this.simulateDispatch(params);

    return this.makePartnerRequest(config.baseUrl, '/orders', config.apiKey, {
      pickup: {
        address: params.pickup.address,
        lat: params.pickup.lat,
        lng: params.pickup.lng,
        contact: { name: params.pickup.contactName, phone: params.pickup.contactPhone },
      },
      dropoff: {
        address: params.dropoff.address,
        lat: params.dropoff.lat,
        lng: params.dropoff.lng,
        contact: { name: params.dropoff.contactName, phone: params.dropoff.contactPhone },
      },
      package: { description: params.packageDescription, value: params.orderValue },
    });
  }

  /**
   * MAX.ng dispatch
   */
  async dispatchMaxNG(params) {
    const config = ngConfig.delivery.maxng;
    if (!config.apiKey) return this.simulateDispatch(params);

    return this.makePartnerRequest(config.baseUrl, '/deliveries', config.apiKey, {
      origin: {
        address: params.pickup.address,
        coordinates: { latitude: params.pickup.lat, longitude: params.pickup.lng },
        contact: { name: params.pickup.contactName, phone: params.pickup.contactPhone },
      },
      destination: {
        address: params.dropoff.address,
        coordinates: { latitude: params.dropoff.lat, longitude: params.dropoff.lng },
        contact: { name: params.dropoff.contactName, phone: params.dropoff.contactPhone },
      },
      description: params.packageDescription,
    });
  }

  /**
   * Generic partner HTTP request
   */
  async makePartnerRequest(baseUrl, path, apiKey, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve({
              trackingId: parsed.tracking_id || parsed.id || parsed.order_id,
              riderName: parsed.rider?.name || parsed.driver?.name || 'Assigned',
              riderPhone: parsed.rider?.phone || parsed.driver?.phone || null,
              estimatedPickup: parsed.estimated_pickup || new Date(Date.now() + 20 * 60000).toISOString(),
              estimatedDelivery: parsed.estimated_delivery || new Date(Date.now() + 60 * 60000).toISOString(),
            });
          } catch (e) {
            reject(new Error('Failed to parse delivery partner response'));
          }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * Simulation mode for development/testing
   */
  simulateDispatch(params) {
    const now = Date.now();
    return {
      trackingId: `SIM-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      riderName: 'Simulation Rider',
      riderPhone: '+2349000000000',
      estimatedPickup: new Date(now + 15 * 60000).toISOString(),
      estimatedDelivery: new Date(now + 45 * 60000).toISOString(),
    };
  }

  /**
   * Update delivery status (from partner webhook or polling)
   */
  async updateDeliveryStatus(trackingId, { status, riderLocation, proofUrl, recipientName }) {
    const pool = getPool();

    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];

    if (riderLocation) {
      params.push(JSON.stringify(riderLocation));
      updates.push(`current_location = $${params.length}`);
    }
    if (proofUrl) {
      params.push(proofUrl);
      updates.push(`delivery_proof_url = $${params.length}`);
    }
    if (recipientName) {
      params.push(recipientName);
      updates.push(`recipient_name = $${params.length}`);
    }

    if (status === 'picked_up') {
      updates.push('actual_pickup_at = NOW()');
    }
    if (status === 'delivered') {
      updates.push('actual_delivery_at = NOW()');
    }

    params.push(trackingId);
    await pool.query(
      `UPDATE ng_delivery_tracking SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params
    );

    // Also update order status
    if (status === 'delivered') {
      await pool.query(
        `UPDATE ng_orders SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
         WHERE id = (SELECT order_id FROM ng_delivery_tracking WHERE id = $1)`,
        [trackingId]
      );
    }

    return { trackingId, status };
  }

  /**
   * Get delivery tracking info
   */
  async getTracking(trackingId) {
    const pool = getPool();
    const result = await pool.query(
      `SELECT t.*, o.order_number, o.items, p.name as pharmacy_name
       FROM ng_delivery_tracking t
       JOIN ng_orders o ON o.id = t.order_id
       JOIN ng_pharmacies p ON p.id = o.pharmacy_id
       WHERE t.id = $1`,
      [trackingId]
    );
    return result.rows[0] || null;
  }

  /**
   * Calculate distance between two coordinates (Haversine)
   */
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Calculate delivery fee based on distance
   */
  calculateDeliveryFee(distanceKm) {
    const baseFee = ngConfig.delivery.baseFee;
    const perKmFee = ngConfig.delivery.perKmFee;
    return Math.round(baseFee + (distanceKm * perKmFee));
  }
}

module.exports = new DeliveryService();
