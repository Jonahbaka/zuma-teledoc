/**
 * Wallet & Settlement Service
 * Manages pharmacy earnings, settlements, and financial reporting
 */

const { getPool } = require('../../../server/db');
const paymentOrchestrator = require('../payments/paymentOrchestrator');

class WalletService {
  /**
   * Get wallet balance and summary
   */
  async getWallet(pharmacyId) {
    const pool = getPool();

    const wallet = await pool.query(
      'SELECT * FROM ng_pharmacy_wallets WHERE pharmacy_id = $1',
      [pharmacyId]
    );

    if (!wallet.rows.length) throw new Error('Wallet not found');

    // Get recent transactions
    const transactions = await pool.query(
      `SELECT * FROM ng_wallet_transactions
       WHERE pharmacy_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [pharmacyId]
    );

    // Get today's earnings
    const todayEarnings = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM ng_wallet_transactions
       WHERE pharmacy_id = $1 AND type = 'credit' AND created_at::date = CURRENT_DATE`,
      [pharmacyId]
    );

    // Get this month's earnings
    const monthEarnings = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM ng_wallet_transactions
       WHERE pharmacy_id = $1 AND type = 'credit'
         AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [pharmacyId]
    );

    return {
      ...wallet.rows[0],
      todayEarnings: parseFloat(todayEarnings.rows[0].total),
      monthEarnings: parseFloat(monthEarnings.rows[0].total),
      recentTransactions: transactions.rows,
    };
  }

  /**
   * Process settlement (move pending to available, then transfer to bank)
   */
  async processSettlement(pharmacyId) {
    const pool = getPool();

    const wallet = await pool.query(
      'SELECT * FROM ng_pharmacy_wallets WHERE pharmacy_id = $1', [pharmacyId]
    );

    if (!wallet.rows.length) throw new Error('Wallet not found');
    const w = wallet.rows[0];

    if (parseFloat(w.pending_balance) <= 0) {
      throw new Error('No pending balance to settle');
    }

    const amount = parseFloat(w.pending_balance);

    // Move from pending to available
    await pool.query(
      `UPDATE ng_pharmacy_wallets SET
        balance = balance + pending_balance,
        pending_balance = 0,
        last_settlement_at = NOW(),
        updated_at = NOW()
      WHERE pharmacy_id = $1`,
      [pharmacyId]
    );

    // Initiate bank transfer
    try {
      const settlement = await paymentOrchestrator.settlePharmacy({
        pharmacyId,
        amount,
        orderId: null,
        provider: 'paystack',
      });

      // Record settlement transaction
      await pool.query(
        `INSERT INTO ng_wallet_transactions (
          wallet_id, pharmacy_id, type, amount, balance_after,
          description, reference, payment_provider
        ) VALUES ($1, $2, 'settlement', $3, $4, $5, $6, $7)`,
        [
          w.id, pharmacyId, amount,
          parseFloat(w.balance) + amount - amount, // Balance after withdrawal
          `Settlement to bank account`,
          settlement.reference, 'paystack',
        ]
      );

      // Deduct from balance
      await pool.query(
        `UPDATE ng_pharmacy_wallets SET
          balance = balance - $1,
          total_withdrawn = total_withdrawn + $1,
          updated_at = NOW()
        WHERE pharmacy_id = $2`,
        [amount, pharmacyId]
      );

      return { amount, reference: settlement.reference, status: 'processing' };
    } catch (err) {
      // Rollback: move back to pending
      await pool.query(
        `UPDATE ng_pharmacy_wallets SET
          balance = balance - $1,
          pending_balance = pending_balance + $1,
          updated_at = NOW()
        WHERE pharmacy_id = $2`,
        [amount, pharmacyId]
      );
      throw err;
    }
  }

  /**
   * Get transaction history
   */
  async getTransactions(pharmacyId, { page = 1, limit = 50, type = null, startDate = null, endDate = null } = {}) {
    const pool = getPool();
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM ng_wallet_transactions WHERE pharmacy_id = $1';
    const params = [pharmacyId];

    if (type) {
      params.push(type);
      sql += ` AND type = $${params.length}`;
    }
    if (startDate) {
      params.push(startDate);
      sql += ` AND created_at >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      sql += ` AND created_at <= $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(sql, params);
    return result.rows;
  }

  /**
   * Deduct subscription fee from wallet
   */
  async deductSubscription(pharmacyId, tier) {
    const pool = getPool();
    const tierPrices = { basic: 20000, standard: 50000, premium: 100000 };
    const amount = tierPrices[tier] || tierPrices.basic;

    const wallet = await pool.query(
      'SELECT * FROM ng_pharmacy_wallets WHERE pharmacy_id = $1', [pharmacyId]
    );
    if (!wallet.rows.length) throw new Error('Wallet not found');

    const balance = parseFloat(wallet.rows[0].balance);
    if (balance < amount) {
      throw new Error(`Insufficient wallet balance. Required: ₦${amount}, Available: ₦${balance}`);
    }

    await pool.query(
      `UPDATE ng_pharmacy_wallets SET
        balance = balance - $1,
        updated_at = NOW()
      WHERE pharmacy_id = $2`,
      [amount, pharmacyId]
    );

    await pool.query(
      `INSERT INTO ng_wallet_transactions (
        wallet_id, pharmacy_id, type, amount, balance_after,
        description, reference
      ) VALUES ($1, $2, 'subscription', $3, $4, $5, $6)`,
      [
        wallet.rows[0].id, pharmacyId, amount,
        balance - amount,
        `Monthly ${tier} subscription fee`,
        `SUB-${Date.now()}`,
      ]
    );

    return { amount, newBalance: balance - amount };
  }
}

module.exports = new WalletService();
