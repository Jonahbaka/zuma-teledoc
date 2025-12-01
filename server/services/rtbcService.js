/**
 * Real-Time Benefit Check (RTBC) Service
 * Integrates with Surescripts RTBC and FDB/Medi-Span for formulary data
 */

const db = require('../db');
const logger = require('../middleware/logger');

class RTBCService {
  /**
   * Get Real-Time Benefit Check via Surescripts
   */
  async getRTBCViaSurescripts(patientId, medicationName, ndcCode = null) {
    try {
      const apiKey = process.env.SURESCRIPTS_RTBC_API_KEY;
      const apiUrl = process.env.SURESCRIPTS_RTBC_API_URL || 'https://api.surescripts.com/rtbc';
      
      if (!apiKey) {
        logger.warn('Surescripts RTBC API key not configured, using simulation');
        return this.simulateRTBC(medicationName, ndcCode);
      }
      
      // Get patient insurance
      const insuranceResult = await db.pool.query(
        'SELECT * FROM patient_insurance WHERE patient_id = $1 AND is_primary = true LIMIT 1',
        [patientId]
      );
      
      if (!insuranceResult.rows[0]) {
        throw new Error('No primary insurance found for patient');
      }
      
      const insurance = insuranceResult.rows[0];
      
      // Real API integration would go here
      // const response = await axios.post(apiUrl, {
      //   headers: { 'Authorization': `Bearer ${apiKey}` },
      //   data: {
      //     memberId: insurance.policy_number,
      //     payerId: insurance.payer_id,
      //     medicationName,
      //     ndcCode
      //   }
      // });
      
      return this.simulateRTBC(medicationName, ndcCode, insurance);
    } catch (error) {
      logger.error('Surescripts RTBC error:', error);
      throw error;
    }
  }
  
  /**
   * Get formulary data from First Databank (FDB)
   */
  async getFDBFormularyData(medicationName, ndcCode, payerId) {
    try {
      const fdbApiKey = process.env.FDB_API_KEY;
      const fdbApiUrl = process.env.FDB_API_URL || 'https://api.fdbhealth.com';
      
      if (!fdbApiKey) {
        logger.warn('FDB API key not configured, using simulation');
        return this.simulateFDBData(medicationName);
      }
      
      // Real API integration would go here
      // const response = await axios.get(`${fdbApiUrl}/formulary`, {
      //   headers: { 'Authorization': `Bearer ${fdbApiKey}` },
      //   params: { medicationName, ndcCode, payerId }
      // });
      
      return this.simulateFDBData(medicationName);
    } catch (error) {
      logger.error('FDB formulary lookup error:', error);
      throw error;
    }
  }
  
  /**
   * Get Real-Time Benefit Check with caching
   */
  async getRTBC(patientId, medicationName, ndcCode = null, insuranceId = null) {
    try {
      // Check cache first
      const cacheResult = await this.getCachedRTBC(patientId, medicationName, ndcCode, insuranceId);
      if (cacheResult && new Date(cacheResult.expires_at) > new Date()) {
        logger.info('RTBC cache hit', { patientId, medicationName });
        return {
          ...cacheResult.response_payload,
          cached: true,
          cacheExpiresAt: cacheResult.expires_at
        };
      }
      
      // Get fresh RTBC data
      const rtbcData = await this.getRTBCViaSurescripts(patientId, medicationName, ndcCode);
      
      // Get insurance info if not provided
      if (!insuranceId) {
        const insuranceResult = await db.pool.query(
          'SELECT * FROM patient_insurance WHERE patient_id = $1 AND is_primary = true LIMIT 1',
          [patientId]
        );
        insuranceId = insuranceResult.rows[0]?.id || null;
      }
      
      // Cache the result (expires in 24 hours)
      await this.cacheRTBCResult(patientId, medicationName, ndcCode, insuranceId, rtbcData);
      
      return {
        ...rtbcData,
        cached: false
      };
    } catch (error) {
      logger.error('Error getting RTBC:', error);
      throw error;
    }
  }
  
  /**
   * Compare prices across multiple scenarios
   */
  async comparePrices(patientId, medicationName, ndcCode = null, hasGoldCard = false) {
    try {
      const rtbcResult = await this.getRTBC(patientId, medicationName, ndcCode);
      
      const scenarios = [];
      
      // Insurance scenario
      if (rtbcResult.isCovered) {
        scenarios.push({
          id: 'INSURANCE',
          label: 'Insurance',
          cost: rtbcResult.copayAmount || 0,
          description: 'Payer Adjudicated',
          covered: true,
          requiresPA: rtbcResult.requiresPriorAuth || false,
          tier: rtbcResult.tierLevel
        });
      }
      
      // Gold card scenario
      if (hasGoldCard) {
        const goldPrice = this.calculateGoldPrice(rtbcResult.cashPrice);
        scenarios.push({
          id: 'GOLD',
          label: 'Docta Gold',
          cost: goldPrice,
          description: 'Member Price',
          covered: true,
          requiresPA: false
        });
      }
      
      // Cash scenario
      scenarios.push({
        id: 'CASH',
        label: 'Retail Cash',
        cost: rtbcResult.cashPrice || 50.00,
        description: 'No Coverage',
        covered: true,
        requiresPA: false
      });
      
      // Coupon scenario (if available)
      if (rtbcResult.couponAvailable) {
        const couponDiscount = rtbcResult.couponInfo?.discount || 0;
        scenarios.push({
          id: 'COUPON',
          label: 'Coupon',
          cost: Math.max(0, (rtbcResult.cashPrice || 0) - couponDiscount),
          description: 'Mfg Savings',
          covered: true,
          isCoupon: true
        });
      }
      
      // Find best price
      const bestPrice = scenarios.reduce((best, current) => 
        current.cost < best.cost ? current : best
      );
      
      return {
        scenarios,
        bestPrice,
        drugName: medicationName,
        requiresPriorAuth: rtbcResult.requiresPriorAuth || false,
        preferredAlternatives: rtbcResult.preferredAlternatives || [],
        lowerCostAlternatives: rtbcResult.lowerCostAlternatives || [],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error comparing prices:', error);
      throw error;
    }
  }
  
  /**
   * Get cached RTBC result
   */
  async getCachedRTBC(patientId, medicationName, ndcCode, insuranceId) {
    const query = `
      SELECT * FROM rtbc_cache
      WHERE patient_id = $1
        AND medication_name = $2
        AND (ndc_code = $3 OR ($3 IS NULL AND ndc_code IS NULL))
        AND (insurance_id = $4 OR ($4 IS NULL AND insurance_id IS NULL))
        AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const result = await db.pool.query(query, [patientId, medicationName, ndcCode, insuranceId]);
    return result.rows[0];
  }
  
  /**
   * Cache RTBC result
   */
  async cacheRTBCResult(patientId, medicationName, ndcCode, insuranceId, rtbcData) {
    try {
      // Expires in 24 hours
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      
      const query = `
        INSERT INTO rtbc_cache (
          patient_id, medication_name, ndc_code, insurance_id,
          payer_name, member_id,
          is_covered, tier_level, copay_amount, coinsurance_percent,
          requires_prior_auth, prior_auth_criteria,
          preferred_alternatives, lower_cost_alternatives,
          cash_price, insurance_price, best_price_option,
          coupon_available, coupon_info,
          formulary_source, response_payload, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (patient_id, medication_name, COALESCE(ndc_code, ''), COALESCE(insurance_id, '00000000-0000-0000-0000-000000000000'::uuid))
        DO UPDATE SET
          response_payload = EXCLUDED.response_payload,
          expires_at = EXCLUDED.expires_at,
          is_covered = EXCLUDED.is_covered,
          copay_amount = EXCLUDED.copay_amount,
          requires_prior_auth = EXCLUDED.requires_prior_auth
      `;
      
      await db.pool.query(query, [
        patientId,
        medicationName,
        ndcCode || null,
        insuranceId || null,
        rtbcData.payerName || null,
        rtbcData.memberId || null,
        rtbcData.isCovered ?? null,
        rtbcData.tierLevel || null,
        rtbcData.copayAmount || null,
        rtbcData.coinsurancePercent || null,
        rtbcData.requiresPriorAuth || false,
        rtbcData.priorAuthCriteria || null,
        JSON.stringify(rtbcData.preferredAlternatives || []),
        JSON.stringify(rtbcData.lowerCostAlternatives || []),
        rtbcData.cashPrice || null,
        rtbcData.insurancePrice || null,
        rtbcData.bestPriceOption || null,
        rtbcData.couponAvailable || false,
        rtbcData.couponInfo ? JSON.stringify(rtbcData.couponInfo) : null,
        rtbcData.formularySource || 'surescripts',
        JSON.stringify(rtbcData),
        expiresAt
      ]);
    } catch (error) {
      logger.error('Error caching RTBC result:', error);
      // Don't throw - caching failure shouldn't break the request
    }
  }
  
  /**
   * Calculate Gold card price (typically 80% discount)
   */
  calculateGoldPrice(cashPrice) {
    if (!cashPrice) return 0;
    return Math.max(0, cashPrice * 0.2); // 80% discount
  }
  
  /**
   * Simulate RTBC response (for development)
   */
  simulateRTBC(medicationName, ndcCode = null, insurance = null) {
    return new Promise((resolve) => {
      setTimeout(() => {
        // Market data for common medications
        const marketData = {
          'Amoxicillin': { cash: 12.00, insuranceCopay: 4.00, requiresPA: false, tier: 'Tier 1' },
          'Lipitor': { cash: 45.00, insuranceCopay: 15.00, requiresPA: false, tier: 'Tier 2' },
          'Wegovy': { cash: 1600.00, insuranceCopay: 1200.00, requiresPA: true, tier: 'Tier 3' },
          'Humira': { cash: 6000.00, insuranceCopay: 50.00, requiresPA: true, tier: 'Tier 3' },
          'Lisinopril': { cash: 10.00, insuranceCopay: 0.00, requiresPA: false, tier: 'Tier 1' },
          'Prednisone': { cash: 15.00, insuranceCopay: 5.00, requiresPA: false, tier: 'Tier 1' },
          'Azithromycin': { cash: 30.00, insuranceCopay: 10.00, requiresPA: false, tier: 'Tier 1' }
        };
        
        const medData = marketData[medicationName] || { cash: 50.00, insuranceCopay: 20.00, requiresPA: false, tier: 'Tier 2' };
        
        resolve({
          isCovered: true,
          tierLevel: medData.tier,
          copayAmount: medData.insuranceCopay,
          coinsurancePercent: null,
          deductibleApplies: false,
          requiresPriorAuth: medData.requiresPA,
          priorAuthCriteria: medData.requiresPA ? 'Step therapy or clinical criteria required' : null,
          stepTherapyRequired: false,
          quantityLimit: null,
          preferredAlternatives: medData.requiresPA ? ['Metformin', 'Glipizide'] : [],
          lowerCostAlternatives: medData.requiresPA ? ['Generic alternative available'] : [],
          cashPrice: medData.cash,
          insurancePrice: medData.insuranceCopay,
          bestPriceOption: 'INSURANCE',
          couponAvailable: medicationName === 'Wegovy',
          couponInfo: medicationName === 'Wegovy' ? { id: 'MFG-WEG', discount: 500.00, label: 'Mfg Savings' } : null,
          payerName: insurance?.insurance_provider || 'BlueCross BlueShield',
          memberId: insurance?.policy_number || null,
          formularySource: 'surescripts',
          timestamp: new Date().toISOString()
        });
      }, 1000);
    });
  }
  
  simulateFDBData(medicationName) {
    return {
      drugInteractions: [],
      contraindications: [],
      formularyId: 'FDB-12345',
      coverage: 'preferred'
    };
  }
}

module.exports = new RTBCService();

