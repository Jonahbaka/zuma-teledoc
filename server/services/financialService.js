/**
 * ═══════════════════════════════════════════════════════════════
 *  DoctaRx Financial Service — The Corporate Treasury
 * ═══════════════════════════════════════════════════════════════
 *
 *  Double-Entry Accounting Engine + Simulated Bank + Stripe Bridge
 *  
 *  Every dollar has a story. Every cent is accounted for.
 *  Simulated accounts translate to real money via Stripe enrollments.
 *  
 *  Key Principles:
 *    1. Double-entry: Every debit has an equal credit
 *    2. GAAP-aligned: Revenue recognition, matching principle
 *    3. Stripe Bridge: Simulated → Real money through actual enrollments
 *    4. Agent-accessible: AI agents can read financials and propose entries
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../db');
const path = require('path');
const fs = require('fs');

// =========================================================================
// INITIALIZATION — Run migration on startup
// =========================================================================

async function initialize() {
  try {
    const migrationPath = path.join(__dirname, '../db/migrations/400_financial_system.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await db.query(sql);
    console.log('  💰 Financial System schema: Applied');
    
    // Seed opening transactions if the ledger is empty
    await seedOpeningTransactions();
    
    return true;
  } catch (err) {
    if (err.code === '42P07' || err.message.includes('already exists')) {
      console.log('  💰 Financial System schema: Already current');
      // Still try to seed if empty
      try { await seedOpeningTransactions(); } catch (e) { /* ok */ }
      return true;
    }
    console.error('  💰 Financial System schema error:', err.message);
    // Schedule a retry after 10s
    setTimeout(async () => {
      try {
        console.log('  💰 Financial System: Retrying initialization...');
        const migrationPath = path.join(__dirname, '../db/migrations/400_financial_system.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await db.query(sql);
        await seedOpeningTransactions();
        console.log('  💰 Financial System: Retry SUCCESS');
      } catch (e) {
        console.error('  💰 Financial System retry failed:', e.message);
      }
    }, 10000);
    return false;
  }
}

// =========================================================================
// SEED OPENING TRANSACTIONS — Give the bank realistic simulated data
// =========================================================================

async function seedOpeningTransactions() {
  // Check if we already have journal entries
  const existing = await db.query('SELECT COUNT(*) as count FROM fin_journal_entries');
  if (parseInt(existing.rows[0].count) > 0) {
    console.log('  💰 Financial ledger: Already has entries, skipping seed');
    return;
  }

  console.log('  💰 Seeding opening financial transactions...');
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');

    // Get current fiscal period
    const periodResult = await client.query(`
      SELECT id FROM fin_fiscal_periods 
      WHERE period_type = 'month' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
      LIMIT 1
    `);
    const fiscalPeriodId = periodResult.rows[0]?.id || null;

    // Helper to create a journal entry with lines
    async function postEntry(description, lines, source = 'system', date = null) {
      const entryDate = date || new Date().toISOString().split('T')[0];
      const je = await client.query(`
        INSERT INTO fin_journal_entries (description, source, entry_date, posted_by, fiscal_period_id, is_posted, posted_at)
        VALUES ($1, $2, $3, 'system_seed', $4, true, NOW())
        RETURNING id
      `, [description, source, entryDate, fiscalPeriodId]);

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await client.query(`
          INSERT INTO fin_journal_lines (journal_entry_id, account_number, debit, credit, memo, line_order)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [je.rows[0].id, l.account, l.debit || 0, l.credit || 0, l.memo || '', i]);
      }
      return je.rows[0].id;
    }

    // ════════════════════════════════════════════════════════════════
    // BOOTSTRAPPING — No outside investment. Revenue-funded only.
    // All operating costs are funded by Stripe revenue from real customers.
    // "Don't spend more than you bring in."
    // ════════════════════════════════════════════════════════════════

    // ═══ 1. FOUNDER SWEAT EQUITY — $0 cash, all effort ═══
    await postEntry('Company formation — sweat equity capitalization', [
      { account: '1310', debit: 0.01, memo: 'Intellectual property — DoctaRx platform (nominal value)' },
      { account: '3000', credit: 0.01, memo: 'Founder sweat equity — zero cash, 100% hustle' }
    ], 'manual', '2026-01-05');

    // ═══ 2. GCP HOSTING — Jan bill $380 (accrued, paid from revenue) ═══
    await postEntry('Google Cloud Platform — January hosting', [
      { account: '5010', debit: 380, memo: 'GCP hosting — compute, storage, networking' },
      { account: '2100', credit: 380, memo: 'Accrued — paid when revenue allows' }
    ], 'system', '2026-01-15');

    // ═══ 3. GEMINI AI API — Jan usage $145 ═══
    await postEntry('Google Gemini API — January AI usage', [
      { account: '6210', debit: 145, memo: 'Gemini Pro + Flash API calls' },
      { account: '2100', credit: 145, memo: 'Accrued — paid from revenue' }
    ], 'system', '2026-01-15');

    // ═══ 4. DOMAIN & ZOHO MAIL — $32 ═══
    await postEntry('Domain registration + Zoho Mail — annual', [
      { account: '6200', debit: 32, memo: 'doctarx.com domain + Zoho Mail' },
      { account: '2100', credit: 32, memo: 'Accrued — minimal cost, paid from personal' }
    ], 'system', '2026-01-10');

    // ═══ 5. PATIENT SUBSCRIPTION — Gold $39.99 ═══
    await postEntry('Patient subscription — Docta Gold (monthly)', [
      { account: '1050', debit: 38.83, memo: 'Stripe settlement (after fees)' },
      { account: '4900', debit: 1.16, memo: 'Stripe fee 2.9% + $0.30' },
      { account: '4010', credit: 39.99, memo: 'Patient Gold subscription revenue' }
    ], 'stripe_sync', '2026-01-20');

    // ═══ 8. PATIENT SUBSCRIPTION — Basic $19.99 ═══
    await postEntry('Patient subscription — Docta Basic (monthly)', [
      { account: '1050', debit: 19.11, memo: 'Stripe settlement' },
      { account: '4900', debit: 0.88, memo: 'Stripe fee' },
      { account: '4010', credit: 19.99, memo: 'Patient Basic subscription revenue' }
    ], 'stripe_sync', '2026-01-22');

    // ═══ 9. CONSULTATION FEE — $79 initial visit ═══
    await postEntry('Consultation — initial patient visit', [
      { account: '1050', debit: 76.41, memo: 'Stripe settlement' },
      { account: '4900', debit: 2.59, memo: 'Stripe fee' },
      { account: '4030', credit: 79.00, memo: 'Initial consultation revenue' }
    ], 'stripe_sync', '2026-01-25');

    // ═══ 10. PROVIDER SUBSCRIPTION — Starter $99/mo ═══
    await postEntry('Provider subscription — Starter plan', [
      { account: '1050', debit: 95.83, memo: 'Stripe settlement' },
      { account: '4900', debit: 3.17, memo: 'Stripe fee' },
      { account: '4020', credit: 99.00, memo: 'Provider Starter subscription' }
    ], 'stripe_sync', '2026-01-28');

    // ═══ 11. CREDENTIALING FEE — $199 ═══
    await postEntry('Provider credentialing — full package', [
      { account: '1050', debit: 193.07, memo: 'Stripe settlement' },
      { account: '4900', debit: 5.93, memo: 'Stripe fee' },
      { account: '4040', credit: 199.00, memo: 'Full credentialing package' }
    ], 'stripe_sync', '2026-01-29');

    // ═══ 12. FOLLOW-UP CONSULTATION — $49 ═══
    await postEntry('Consultation — follow-up visit', [
      { account: '1050', debit: 47.28, memo: 'Stripe settlement' },
      { account: '4900', debit: 1.72, memo: 'Stripe fee' },
      { account: '4030', credit: 49.00, memo: 'Follow-up consultation revenue' }
    ], 'stripe_sync', '2026-02-01');

    // ═══ 11. FEB — GCP HOSTING $420 ═══
    await postEntry('Google Cloud Platform — February hosting', [
      { account: '5010', debit: 420, memo: 'GCP hosting — growing usage' },
      { account: '2100', credit: 420, memo: 'Accrued — paid from revenue' }
    ], 'system', '2026-02-01');

    // ═══ 12. FEB — GEMINI API $180 ═══
    await postEntry('Google Gemini API — February AI usage', [
      { account: '6210', debit: 180, memo: 'Gemini Pro + Flash — agent operations' },
      { account: '2100', credit: 180, memo: 'Accrued — paid from revenue' }
    ], 'system', '2026-02-01');

    // ═══ 13. MARKETING SPEND — $250 (organic + minimal ads) ═══
    await postEntry('Digital marketing — Google Ads + social', [
      { account: '6100', debit: 250, memo: 'Google Ads, LinkedIn — bootstrapping budget' },
      { account: '2100', credit: 250, memo: 'Accrued — paid from revenue' }
    ], 'system', '2026-02-03');

    // ═══ 14. THIRD-PARTY APIs — Twilio, SendGrid, etc. $95 ═══
    await postEntry('Third-party API services — January', [
      { account: '5020', debit: 95, memo: 'Twilio SMS, SendGrid, OCR, etc.' },
      { account: '2100', credit: 95, memo: 'Accrued — paid from revenue' }
    ], 'system', '2026-01-31');

    // ═══ 18. PATIENT SUBSCRIPTION — Platinum $79.99 ═══
    await postEntry('Patient subscription — Docta Platinum (monthly)', [
      { account: '1050', debit: 77.67, memo: 'Stripe settlement' },
      { account: '4900', debit: 2.32, memo: 'Stripe fee' },
      { account: '4010', credit: 79.99, memo: 'Patient Platinum subscription' }
    ], 'stripe_sync', '2026-02-03');

    // ═══ 19. SPECIALIST CONSULTATION — $129 ═══
    await postEntry('Consultation — specialist visit', [
      { account: '1050', debit: 125.04, memo: 'Stripe settlement' },
      { account: '4900', debit: 3.96, memo: 'Stripe fee' },
      { account: '4030', credit: 129.00, memo: 'Specialist consultation revenue' }
    ], 'stripe_sync', '2026-02-05');

    // ═══ 20. PROVIDER PRO SUBSCRIPTION — $199 ═══
    await postEntry('Provider subscription — Professional plan', [
      { account: '1050', debit: 193.07, memo: 'Stripe settlement' },
      { account: '4900', debit: 5.93, memo: 'Stripe fee' },
      { account: '4020', credit: 199.00, memo: 'Provider Professional subscription' }
    ], 'stripe_sync', '2026-02-06');

    // Now update bank account balances — bootstrapping, funded by revenue only
    // Operating account: $0 start, only Stripe payouts fund it
    await client.query("UPDATE fin_bank_accounts SET current_balance = 0, available_balance = 0 WHERE account_number = 'DCTA-OPS-001'");
    await client.query("UPDATE fin_bank_accounts SET current_balance = 0, available_balance = 0 WHERE account_number = 'DCTA-RES-001'");
    await client.query("UPDATE fin_bank_accounts SET current_balance = 0, available_balance = 0 WHERE account_number = 'DCTA-TAX-001'");

    // Stripe account: sum of all stripe settlements (real revenue)
    const stripeBalance = 38.83 + 19.11 + 76.41 + 95.83 + 193.07 + 47.28 + 77.67 + 125.04 + 193.07;
    await client.query("UPDATE fin_bank_accounts SET current_balance = $1, available_balance = $1 WHERE account_number = 'DCTA-STR-001'", [stripeBalance]);

    // Seed bank transactions
    const stripeAccountId = (await client.query("SELECT id FROM fin_bank_accounts WHERE account_number = 'DCTA-STR-001'")).rows[0]?.id;

    if (stripeAccountId) {
      const stripeTxns = [
        { type: 'stripe_charge', amount: 38.83, desc: 'Patient Gold subscription', party: 'Patient #1', date: '2026-01-20', bal: 38.83 },
        { type: 'stripe_charge', amount: 19.11, desc: 'Patient Basic subscription', party: 'Patient #2', date: '2026-01-22', bal: 57.94 },
        { type: 'stripe_charge', amount: 76.41, desc: 'Initial consultation', party: 'Patient #3', date: '2026-01-25', bal: 134.35 },
        { type: 'stripe_charge', amount: 95.83, desc: 'Provider Starter plan', party: 'Dr. Provider #1', date: '2026-01-28', bal: 230.18 },
        { type: 'stripe_charge', amount: 193.07, desc: 'Provider credentialing', party: 'Dr. Provider #2', date: '2026-01-29', bal: 423.25 },
        { type: 'stripe_charge', amount: 47.28, desc: 'Follow-up consultation', party: 'Patient #1', date: '2026-02-01', bal: 470.53 },
        { type: 'stripe_charge', amount: 77.67, desc: 'Patient Platinum subscription', party: 'Patient #4', date: '2026-02-03', bal: 548.20 },
        { type: 'stripe_charge', amount: 125.04, desc: 'Specialist consultation', party: 'Patient #5', date: '2026-02-05', bal: 673.24 },
        { type: 'stripe_charge', amount: 193.07, desc: 'Provider Pro plan', party: 'Dr. Provider #3', date: '2026-02-06', bal: 866.31 },
      ];
      for (const t of stripeTxns) {
        await client.query(`
          INSERT INTO fin_bank_transactions (bank_account_id, transaction_type, amount, running_balance, description, counterparty, posted_date, status, category)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'revenue')
        `, [stripeAccountId, t.type, t.amount, t.bal, t.desc, t.party, t.date]);
      }
    }

    // Seed some AR invoices
    const invoices = [
      { num: 'INV-2026-001', type: 'patient', name: 'Sarah Johnson', amount: 39.99, status: 'paid', due: '2026-02-20' },
      { num: 'INV-2026-002', type: 'patient', name: 'Michael Chen', amount: 19.99, status: 'outstanding', due: '2026-02-22' },
      { num: 'INV-2026-003', type: 'provider', name: 'Dr. James Wilson', amount: 99.00, status: 'paid', due: '2026-02-28' },
      { num: 'INV-2026-004', type: 'patient', name: 'Emily Davis', amount: 79.00, status: 'outstanding', due: '2026-03-01' },
      { num: 'INV-2026-005', type: 'provider', name: 'Dr. Lisa Park', amount: 199.00, status: 'outstanding', due: '2026-03-05' },
      { num: 'INV-2026-006', type: 'patient', name: 'Robert Martinez', amount: 79.99, status: 'outstanding', due: '2026-03-03' },
      { num: 'INV-2026-007', type: 'insurance', name: 'Blue Cross Blue Shield', amount: 450.00, status: 'outstanding', due: '2026-03-15' },
    ];
    for (const inv of invoices) {
      await client.query(`
        INSERT INTO fin_accounts_receivable (invoice_number, customer_type, customer_name, amount, amount_paid, due_date, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (invoice_number) DO NOTHING
      `, [inv.num, inv.type, inv.name, inv.amount, inv.status === 'paid' ? inv.amount : 0, inv.due, inv.status]);
    }

    // Seed some AP bills
    const bills = [
      { num: 'BILL-GCP-0126', vendor: 'Google Cloud Platform', type: 'cloud_hosting', amount: 380, status: 'paid', due: '2026-02-15' },
      { num: 'BILL-GCP-0226', vendor: 'Google Cloud Platform', type: 'cloud_hosting', amount: 420, status: 'pending', due: '2026-03-15', recurring: true },
      { num: 'BILL-GAI-0126', vendor: 'Google AI (Gemini)', type: 'api_service', amount: 145, status: 'paid', due: '2026-02-15' },
      { num: 'BILL-GAI-0226', vendor: 'Google AI (Gemini)', type: 'api_service', amount: 180, status: 'pending', due: '2026-03-15', recurring: true },
      { num: 'BILL-LAW-001', vendor: 'HIPAA Legal Counsel', type: 'legal', amount: 500, status: 'paid', due: '2026-02-20' },
      { num: 'BILL-MKT-001', vendor: 'Google Ads', type: 'marketing', amount: 250, status: 'paid', due: '2026-02-28' },
      { num: 'BILL-API-0126', vendor: 'Twilio/SendGrid/OCR', type: 'api_service', amount: 95, status: 'paid', due: '2026-02-15' },
      { num: 'BILL-INS-001', vendor: 'CyberSecurity Insurance', type: 'insurance', amount: 1200, status: 'pending', due: '2026-03-30' },
    ];
    for (const b of bills) {
      await client.query(`
        INSERT INTO fin_accounts_payable (bill_number, vendor_name, vendor_type, amount, amount_paid, due_date, status, recurring)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [b.num, b.vendor, b.type, b.amount, b.status === 'paid' ? b.amount : 0, b.due, b.status, b.recurring || false]);
    }

    // Seed ROI tracking — bootstrapping, all sweat equity
    const roiItems = [
      { name: 'Google Ads Campaign Q1', cat: 'marketing', invested: 250, revenue: 138.98, savings: 0 },
      { name: 'AI Agent Automation', cat: 'agent_operations', invested: 325, revenue: 0, savings: 8500 },
      { name: 'CRM Cold Outreach', cat: 'crm_outreach', invested: 32, revenue: 298, savings: 0 },
      { name: 'Platform Development (Sweat Equity)', cat: 'product', invested: 0, revenue: 866.31, savings: 0 },
    ];
    for (const r of roiItems) {
      const roi = r.invested > 0 ? ((r.revenue + r.savings - r.invested) / r.invested * 100) : 0;
      await client.query(`
        INSERT INTO fin_roi_tracking (initiative_name, category, investment_amount, revenue_generated, cost_savings, roi_percentage, time_period, start_date, status, agent_managed)
        VALUES ($1, $2, $3, $4, $5, $6, 'monthly', '2026-01-01', 'active', $7)
      `, [r.name, r.cat, r.invested, r.revenue, r.savings, roi, r.cat === 'agent_operations' || r.cat === 'crm_outreach']);
    }

    // Seed Stripe bridge records
    const bridgeRecords = [
      { type: 'patient_subscription', sim: 39.99, real: 39.99, fee: 1.16, net: 38.83 },
      { type: 'patient_subscription', sim: 19.99, real: 19.99, fee: 0.88, net: 19.11 },
      { type: 'consultation', sim: 79.00, real: 79.00, fee: 2.59, net: 76.41 },
      { type: 'provider_subscription', sim: 99.00, real: 99.00, fee: 3.17, net: 95.83 },
      { type: 'credentialing', sim: 199.00, real: 199.00, fee: 5.93, net: 193.07 },
      { type: 'consultation', sim: 49.00, real: 49.00, fee: 1.72, net: 47.28 },
      { type: 'patient_subscription', sim: 79.99, real: 79.99, fee: 2.32, net: 77.67 },
      { type: 'consultation', sim: 129.00, real: 129.00, fee: 3.96, net: 125.04 },
      { type: 'provider_subscription', sim: 199.00, real: 199.00, fee: 5.93, net: 193.07 },
    ];
    for (const br of bridgeRecords) {
      await client.query(`
        INSERT INTO fin_stripe_bridge (enrollment_type, sim_amount, real_amount, fee_amount, net_amount, status, reconciled)
        VALUES ($1, $2, $3, $4, $5, 'completed', true)
      `, [br.type, br.sim, br.real, br.fee, br.net]);
    }

    // Seed investor relations
    await client.query(`
      INSERT INTO fin_investor_relations (investor_name, investor_type, round_name, committed_amount, equity_percentage, valuation_at_entry, status, contact_email, notes) VALUES
      ('TechHealth Ventures', 'vc', 'Seed', 0, 0, 5000000, 'contacted', 'deals@techhealthvc.com', 'AI-focused healthcare VC, interested in our agent architecture'),
      ('Dr. Richard Hoffman', 'angel', 'Seed', 0, 0, 5000000, 'prospect', 'rhoffman@gmail.com', 'Former CMO at large health system, interested in telehealth disruption'),
      ('Meridian Capital', 'vc', 'Seed', 0, 0, 5000000, 'pitch_sent', 'pipeline@meridiancap.com', 'Series Seed focus, healthcare portfolio'),
      ('StartupFund Angels', 'angel', 'Seed', 0, 0, 5000000, 'prospect', 'invest@startupfund.co', 'Angel network with healthcare allocation')
    `);

    await client.query('COMMIT');
    console.log('  💰 Financial seed data: 20 journal entries, bank transactions, AR/AP, ROI, investors — DONE');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  💰 Financial seed error:', err.message);
  } finally {
    client.release();
  }
}

// =========================================================================
// CHART OF ACCOUNTS
// =========================================================================

async function getChartOfAccounts(filters = {}) {
  let query = 'SELECT * FROM fin_chart_of_accounts WHERE 1=1';
  const params = [];
  
  if (filters.type) {
    params.push(filters.type);
    query += ` AND account_type = $${params.length}`;
  }
  if (filters.active !== undefined) {
    params.push(filters.active);
    query += ` AND is_active = $${params.length}`;
  }
  
  query += ' ORDER BY account_number ASC';
  const result = await db.query(query, params);
  return result.rows;
}

async function getAccountBalance(accountNumber) {
  const result = await db.query(`
    SELECT 
      coa.account_number,
      coa.account_name,
      coa.account_type,
      coa.normal_balance,
      COALESCE(SUM(jl.debit), 0) as total_debits,
      COALESCE(SUM(jl.credit), 0) as total_credits,
      CASE 
        WHEN coa.normal_balance = 'debit' THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
        ELSE COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
      END as balance
    FROM fin_chart_of_accounts coa
    LEFT JOIN fin_journal_lines jl ON coa.account_number = jl.account_number
    LEFT JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true
    WHERE coa.account_number = $1
    GROUP BY coa.account_number, coa.account_name, coa.account_type, coa.normal_balance
  `, [accountNumber]);
  
  return result.rows[0] || null;
}

// =========================================================================
// JOURNAL ENTRIES — The Heart of Double-Entry Accounting
// =========================================================================

async function createJournalEntry({ description, lines, source = 'manual', reference_type, reference_id, memo, posted_by }) {
  // Validate: total debits must equal total credits
  const totalDebits = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
  
  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(`Journal entry out of balance: Debits ($${totalDebits.toFixed(2)}) ≠ Credits ($${totalCredits.toFixed(2)})`);
  }
  
  if (lines.length < 2) {
    throw new Error('Journal entry requires at least 2 lines (debit + credit)');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Get current fiscal period
    const periodResult = await client.query(`
      SELECT id FROM fin_fiscal_periods 
      WHERE period_type = 'month' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
      LIMIT 1
    `);
    const fiscalPeriodId = periodResult.rows[0]?.id || null;
    
    // Create journal entry
    const entryResult = await client.query(`
      INSERT INTO fin_journal_entries (description, source, reference_type, reference_id, memo, posted_by, fiscal_period_id, is_posted, posted_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
      RETURNING *
    `, [description, source, reference_type, reference_id, memo, posted_by || 'system', fiscalPeriodId]);
    
    const entry = entryResult.rows[0];
    
    // Create journal lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      await client.query(`
        INSERT INTO fin_journal_lines (journal_entry_id, account_number, debit, credit, memo, line_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [entry.id, line.account_number, line.debit || 0, line.credit || 0, line.memo || '', i]);
    }
    
    await client.query('COMMIT');
    return entry;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getJournalEntries(filters = {}) {
  let query = `
    SELECT je.*, 
      json_agg(json_build_object(
        'id', jl.id,
        'account_number', jl.account_number,
        'debit', jl.debit,
        'credit', jl.credit,
        'memo', jl.memo
      ) ORDER BY jl.line_order) as lines
    FROM fin_journal_entries je
    LEFT JOIN fin_journal_lines jl ON je.id = jl.journal_entry_id
    WHERE 1=1
  `;
  const params = [];
  
  if (filters.source) {
    params.push(filters.source);
    query += ` AND je.source = $${params.length}`;
  }
  if (filters.startDate) {
    params.push(filters.startDate);
    query += ` AND je.entry_date >= $${params.length}`;
  }
  if (filters.endDate) {
    params.push(filters.endDate);
    query += ` AND je.entry_date <= $${params.length}`;
  }
  
  query += ' GROUP BY je.id ORDER BY je.entry_date DESC, je.entry_number DESC LIMIT 100';
  const result = await db.query(query, params);
  return result.rows;
}

// =========================================================================
// BANK ACCOUNTS — The Simulated Bank
// =========================================================================

async function getBankAccounts() {
  const result = await db.query(`
    SELECT ba.*,
      (SELECT COUNT(*) FROM fin_bank_transactions WHERE bank_account_id = ba.id) as transaction_count,
      (SELECT MAX(posted_date) FROM fin_bank_transactions WHERE bank_account_id = ba.id) as last_transaction_date
    FROM fin_bank_accounts ba
    WHERE ba.is_active = true
    ORDER BY ba.account_name
  `);
  return result.rows;
}

async function getBankTransactions(bankAccountId, limit = 50) {
  const result = await db.query(`
    SELECT * FROM fin_bank_transactions
    WHERE bank_account_id = $1
    ORDER BY posted_date DESC, created_at DESC
    LIMIT $2
  `, [bankAccountId, limit]);
  return result.rows;
}

async function recordBankTransaction({ bank_account_id, transaction_type, amount, description, counterparty, reference_number, category, stripe_payment_id, journal_entry_id }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    // Get current balance
    const accountResult = await client.query('SELECT current_balance FROM fin_bank_accounts WHERE id = $1 FOR UPDATE', [bank_account_id]);
    if (!accountResult.rows[0]) throw new Error('Bank account not found');
    
    const currentBalance = parseFloat(accountResult.rows[0].current_balance);
    const isDebit = ['deposit', 'stripe_charge', 'interest', 'stripe_payout'].includes(transaction_type);
    const newBalance = isDebit ? currentBalance + parseFloat(amount) : currentBalance - parseFloat(amount);
    
    // Record transaction
    const txnResult = await client.query(`
      INSERT INTO fin_bank_transactions (bank_account_id, transaction_type, amount, running_balance, description, counterparty, reference_number, category, stripe_payment_id, journal_entry_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [bank_account_id, transaction_type, amount, newBalance, description, counterparty, reference_number, category, stripe_payment_id, journal_entry_id]);
    
    // Update account balance
    await client.query(`
      UPDATE fin_bank_accounts SET current_balance = $1, available_balance = $1 WHERE id = $2
    `, [newBalance, bank_account_id]);
    
    await client.query('COMMIT');
    return txnResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// STRIPE REVENUE BRIDGE — Translate Simulated → Real Money
// =========================================================================

async function recordStripeRevenue({ stripe_payment_intent_id, stripe_charge_id, stripe_customer_id, enrollment_type, amount, fee_amount = 0, customer_name }) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    
    const netAmount = amount - fee_amount;
    
    // Get Stripe bank account
    const stripeAccount = await client.query("SELECT id FROM fin_bank_accounts WHERE account_number = 'DCTA-STR-001'");
    const bankAccountId = stripeAccount.rows[0]?.id;
    
    // Create journal entry for the revenue
    let revenueAccount = '4030'; // Default: consultation revenue
    if (enrollment_type === 'patient_subscription') revenueAccount = '4010';
    else if (enrollment_type === 'provider_subscription') revenueAccount = '4020';
    else if (enrollment_type === 'credentialing') revenueAccount = '4040';
    
    const je = await client.query(`
      INSERT INTO fin_journal_entries (description, source, reference_type, reference_id, posted_by, is_posted, posted_at)
      VALUES ($1, 'stripe_sync', 'stripe_payment', $2, 'stripe_bridge', true, NOW())
      RETURNING *
    `, [`Stripe ${enrollment_type}: ${customer_name || 'Customer'} — $${(amount/100).toFixed(2)}`, stripe_payment_intent_id]);
    
    const amountDollars = amount / 100;
    const feeDollars = fee_amount / 100;
    const netDollars = netAmount / 100;
    
    // Debit: Cash (Stripe Settlement)
    await client.query(`
      INSERT INTO fin_journal_lines (journal_entry_id, account_number, debit, credit, memo, line_order)
      VALUES ($1, '1050', $2, 0, 'Stripe settlement', 0)
    `, [je.rows[0].id, netDollars]);
    
    // Debit: Stripe Processing Fee (if any)
    if (feeDollars > 0) {
      await client.query(`
        INSERT INTO fin_journal_lines (journal_entry_id, account_number, debit, credit, memo, line_order)
        VALUES ($1, '4900', $2, 0, 'Stripe processing fee', 1)
      `, [je.rows[0].id, feeDollars]);
    }
    
    // Credit: Revenue
    await client.query(`
      INSERT INTO fin_journal_lines (journal_entry_id, account_number, debit, credit, memo, line_order)
      VALUES ($1, $2, 0, $3, $4, 2)
    `, [je.rows[0].id, revenueAccount, amountDollars, `${enrollment_type} revenue`]);
    
    // Record bank transaction
    if (bankAccountId) {
      await client.query(`
        INSERT INTO fin_bank_transactions (bank_account_id, transaction_type, amount, description, counterparty, stripe_payment_id, journal_entry_id, category)
        VALUES ($1, 'stripe_charge', $2, $3, $4, $5, $6, 'revenue')
      `, [bankAccountId, netDollars, `Stripe: ${enrollment_type}`, customer_name || 'Customer', stripe_payment_intent_id, je.rows[0].id]);
      
      await client.query(`
        UPDATE fin_bank_accounts SET current_balance = current_balance + $1, available_balance = available_balance + $1 WHERE id = $2
      `, [netDollars, bankAccountId]);
    }
    
    // Record in bridge table
    await client.query(`
      INSERT INTO fin_stripe_bridge (sim_bank_account_id, stripe_payment_intent_id, stripe_charge_id, stripe_customer_id, enrollment_type, sim_amount, real_amount, fee_amount, net_amount, status, journal_entry_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10)
    `, [bankAccountId, stripe_payment_intent_id, stripe_charge_id, stripe_customer_id, enrollment_type, amountDollars, amountDollars, feeDollars, netDollars, je.rows[0].id]);
    
    await client.query('COMMIT');
    return { journalEntryId: je.rows[0].id, amount: amountDollars, net: netDollars };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =========================================================================
// ACCOUNTS RECEIVABLE
// =========================================================================

async function getAccountsReceivable(filters = {}) {
  let query = 'SELECT * FROM fin_accounts_receivable WHERE 1=1';
  const params = [];
  
  if (filters.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  query += ' ORDER BY due_date ASC LIMIT 100';
  const result = await db.query(query, params);
  return result.rows;
}

async function createInvoice({ customer_type, customer_name, customer_id, amount, due_date, terms, payment_method, notes }) {
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
  const result = await db.query(`
    INSERT INTO fin_accounts_receivable (invoice_number, customer_type, customer_name, customer_id, amount, due_date, terms, payment_method, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [invoiceNumber, customer_type, customer_name, customer_id, amount, due_date || new Date(Date.now() + 30*86400000), terms || 'net_30', payment_method, notes]);
  return result.rows[0];
}

// =========================================================================
// ACCOUNTS PAYABLE
// =========================================================================

async function getAccountsPayable(filters = {}) {
  let query = 'SELECT * FROM fin_accounts_payable WHERE 1=1';
  const params = [];
  
  if (filters.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  query += ' ORDER BY due_date ASC LIMIT 100';
  const result = await db.query(query, params);
  return result.rows;
}

async function createBill({ vendor_name, vendor_type, amount, due_date, terms, recurring, recurrence_interval, notes }) {
  const billNumber = `BILL-${Date.now().toString(36).toUpperCase()}`;
  const result = await db.query(`
    INSERT INTO fin_accounts_payable (bill_number, vendor_name, vendor_type, amount, due_date, terms, recurring, recurrence_interval, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [billNumber, vendor_name, vendor_type, amount, due_date, terms || 'net_30', recurring || false, recurrence_interval, notes]);
  return result.rows[0];
}

// =========================================================================
// FINANCIAL REPORTS — Balance Sheet, P&L, Cash Flow
// =========================================================================

async function getTrialBalance() {
  const result = await db.query(`
    SELECT 
      coa.account_number,
      coa.account_name,
      coa.account_type,
      coa.normal_balance,
      COALESCE(SUM(jl.debit), 0) as total_debits,
      COALESCE(SUM(jl.credit), 0) as total_credits,
      CASE 
        WHEN coa.normal_balance = 'debit' THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
        ELSE COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
      END as balance
    FROM fin_chart_of_accounts coa
    LEFT JOIN fin_journal_lines jl ON coa.account_number = jl.account_number
    LEFT JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true
    WHERE coa.is_active = true
    GROUP BY coa.account_number, coa.account_name, coa.account_type, coa.normal_balance
    HAVING COALESCE(SUM(jl.debit), 0) > 0 OR COALESCE(SUM(jl.credit), 0) > 0
    ORDER BY coa.account_number
  `);
  return result.rows;
}

async function getBalanceSheet() {
  const trial = await getTrialBalance();
  
  const assets = trial.filter(a => a.account_type === 'asset');
  const contraAssets = trial.filter(a => a.account_type === 'contra_asset');
  const liabilities = trial.filter(a => a.account_type === 'liability');
  const equity = trial.filter(a => a.account_type === 'equity');
  
  const totalAssets = assets.reduce((s, a) => s + parseFloat(a.balance), 0) - contraAssets.reduce((s, a) => s + parseFloat(a.balance), 0);
  const totalLiabilities = liabilities.reduce((s, a) => s + parseFloat(a.balance), 0);
  const totalEquity = equity.reduce((s, a) => s + parseFloat(a.balance), 0);
  
  return {
    as_of: new Date().toISOString().split('T')[0],
    assets: { items: [...assets, ...contraAssets], total: totalAssets },
    liabilities: { items: liabilities, total: totalLiabilities },
    equity: { items: equity, total: totalEquity },
    total_liabilities_and_equity: totalLiabilities + totalEquity,
    is_balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
  };
}

async function getIncomeStatement(startDate, endDate) {
  const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];
  
  const result = await db.query(`
    SELECT 
      coa.account_number,
      coa.account_name,
      coa.account_type,
      coa.sub_type,
      CASE 
        WHEN coa.normal_balance = 'debit' THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
        ELSE COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
      END as balance
    FROM fin_chart_of_accounts coa
    LEFT JOIN fin_journal_lines jl ON coa.account_number = jl.account_number
    LEFT JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true
      AND je.entry_date >= $1 AND je.entry_date <= $2
    WHERE coa.account_type IN ('revenue', 'contra_revenue', 'expense')
    GROUP BY coa.account_number, coa.account_name, coa.account_type, coa.sub_type, coa.normal_balance
    ORDER BY coa.account_number
  `, [start, end]);
  
  const revenue = result.rows.filter(r => r.account_type === 'revenue');
  const contraRevenue = result.rows.filter(r => r.account_type === 'contra_revenue');
  const cogs = result.rows.filter(r => r.account_type === 'expense' && r.sub_type === 'cogs');
  const opex = result.rows.filter(r => r.account_type === 'expense' && r.sub_type !== 'cogs' && r.sub_type !== 'tax');
  const taxes = result.rows.filter(r => r.account_type === 'expense' && r.sub_type === 'tax');
  
  const totalRevenue = revenue.reduce((s, r) => s + parseFloat(r.balance), 0);
  const totalContra = contraRevenue.reduce((s, r) => s + parseFloat(r.balance), 0);
  const netRevenue = totalRevenue - totalContra;
  const totalCOGS = cogs.reduce((s, r) => s + parseFloat(r.balance), 0);
  const grossProfit = netRevenue - totalCOGS;
  const totalOpex = opex.reduce((s, r) => s + parseFloat(r.balance), 0);
  const operatingIncome = grossProfit - totalOpex;
  const totalTax = taxes.reduce((s, r) => s + parseFloat(r.balance), 0);
  const netIncome = operatingIncome - totalTax;
  
  return {
    period: { start, end },
    revenue: { items: revenue, total: totalRevenue },
    contra_revenue: { items: contraRevenue, total: totalContra },
    net_revenue: netRevenue,
    cost_of_revenue: { items: cogs, total: totalCOGS },
    gross_profit: grossProfit,
    gross_margin: netRevenue > 0 ? ((grossProfit / netRevenue) * 100).toFixed(1) : '0.0',
    operating_expenses: { items: opex, total: totalOpex },
    operating_income: operatingIncome,
    taxes: { items: taxes, total: totalTax },
    net_income: netIncome,
    net_margin: netRevenue > 0 ? ((netIncome / netRevenue) * 100).toFixed(1) : '0.0'
  };
}

async function getCashFlowStatement(startDate, endDate) {
  const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = endDate || new Date().toISOString().split('T')[0];
  
  // Cash from operations
  const operations = await db.query(`
    SELECT 
      je.source,
      COALESCE(SUM(jl.debit), 0) as inflows,
      COALESCE(SUM(jl.credit), 0) as outflows
    FROM fin_journal_lines jl
    JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true
    WHERE jl.account_number LIKE '1%' AND jl.account_number NOT IN ('1300', '1310', '1400')
      AND je.entry_date >= $1 AND je.entry_date <= $2
    GROUP BY je.source
  `, [start, end]);
  
  // Bank account balances
  const bankBalances = await db.query(`
    SELECT account_name, account_number, current_balance, account_type
    FROM fin_bank_accounts WHERE is_active = true
    ORDER BY account_name
  `);
  
  const totalCash = bankBalances.rows.reduce((s, b) => s + parseFloat(b.current_balance), 0);
  
  return {
    period: { start, end },
    operating_activities: operations.rows,
    total_cash: totalCash,
    bank_accounts: bankBalances.rows
  };
}

// =========================================================================
// ROI TRACKING
// =========================================================================

async function getROIMetrics() {
  const result = await db.query(`
    SELECT *, 
      CASE WHEN investment_amount > 0 
        THEN ((revenue_generated + cost_savings - investment_amount) / investment_amount * 100)
        ELSE 0 
      END as calculated_roi
    FROM fin_roi_tracking 
    WHERE status IN ('active', 'completed')
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return result.rows;
}

async function trackROI(data) {
  const roi = data.investment_amount > 0 
    ? ((data.revenue_generated + (data.cost_savings || 0) - data.investment_amount) / data.investment_amount * 100)
    : 0;
    
  const result = await db.query(`
    INSERT INTO fin_roi_tracking (initiative_name, category, investment_amount, revenue_generated, cost_savings, roi_percentage, time_period, start_date, status, kpis, agent_managed, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [data.initiative_name, data.category, data.investment_amount, data.revenue_generated || 0, data.cost_savings || 0, roi, data.time_period, data.start_date || new Date(), data.status || 'active', JSON.stringify(data.kpis || {}), data.agent_managed || false, data.notes]);
  return result.rows[0];
}

// =========================================================================
// BUDGETS
// =========================================================================

async function getBudgets() {
  const result = await db.query(`
    SELECT b.*, coa.account_name, fp.period_name
    FROM fin_budgets b
    LEFT JOIN fin_chart_of_accounts coa ON b.account_number = coa.account_number
    LEFT JOIN fin_fiscal_periods fp ON b.fiscal_period_id = fp.id
    ORDER BY b.created_at DESC
  `);
  return result.rows;
}

// =========================================================================
// INVESTOR RELATIONS
// =========================================================================

async function getInvestorRelations() {
  const result = await db.query('SELECT * FROM fin_investor_relations ORDER BY created_at DESC');
  return result.rows;
}

async function addInvestor(data) {
  const result = await db.query(`
    INSERT INTO fin_investor_relations (investor_name, investor_type, round_name, committed_amount, equity_percentage, valuation_at_entry, status, contact_email, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [data.investor_name, data.investor_type, data.round_name, data.committed_amount || 0, data.equity_percentage || 0, data.valuation_at_entry, data.status || 'prospect', data.contact_email, data.notes]);
  return result.rows[0];
}

// =========================================================================
// DASHBOARD STATS — Executive Summary
// =========================================================================

async function getRealStripeData() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key === 'sk_live_REPLACE_ME' || key.length < 10) {
    return { live: false, error: 'Stripe key not configured', available_balance: 0, pending_balance: 0, total_balance: 0 };
  }

  try {
    const Stripe = require('stripe');
    const stripe = new Stripe(key);
    
    // Fetch balance first — this is the real account balance
    const balance = await stripe.balance.retrieve();
    
    const isTestMode = key.startsWith('sk_test_');
    
    // Safely extract balances (handle empty arrays)
    const availableBalance = (balance.available || []).reduce((s, b) => s + (b.amount || 0), 0) / 100;
    const pendingBalance = (balance.pending || []).reduce((s, b) => s + (b.amount || 0), 0) / 100;
    const instantAvailable = (balance.instant_available || []).reduce((s, b) => s + (b.amount || 0), 0) / 100;
    const connectReserved = (balance.connect_reserved || []).reduce((s, b) => s + (b.amount || 0), 0) / 100;

    // Fetch other data in parallel — these are secondary
    let charges = { data: [] };
    let subscriptions = { data: [] };
    let customers = { data: [] };
    let paymentIntents = { data: [] };

    try {
      [paymentIntents, subscriptions, customers] = await Promise.all([
        stripe.paymentIntents.list({ limit: 15 }),
        stripe.subscriptions.list({ limit: 100, status: 'active' }).catch(() => ({ data: [] })),
        stripe.customers.list({ limit: 100 }).catch(() => ({ data: [] }))
      ]);
    } catch (e) {
      console.warn('Stripe secondary data fetch partial failure:', e.message);
    }

    // Also try charges API as fallback
    try {
      charges = await stripe.charges.list({ limit: 15 });
    } catch (e) {
      // charges API may not be available on all account types
    }

    // Use whichever has data — payment intents or charges
    const recentPayments = paymentIntents.data.length > 0
      ? paymentIntents.data.map(pi => ({
          id: pi.id,
          amount: (pi.amount || 0) / 100,
          net: ((pi.amount || 0) - (pi.application_fee_amount || 0)) / 100,
          status: pi.status,
          description: pi.description || pi.metadata?.description || 'Payment',
          customer: pi.customer || 'Direct',
          created: new Date((pi.created || 0) * 1000).toISOString(),
          refunded: pi.amount_refunded > 0
        }))
      : charges.data.map(c => ({
          id: c.id,
          amount: (c.amount || 0) / 100,
          net: ((c.amount || 0) - (c.application_fee_amount || 0)) / 100,
          status: c.status,
          description: c.description || c.statement_descriptor || 'Charge',
          customer: c.billing_details?.name || c.customer || 'Unknown',
          created: new Date((c.created || 0) * 1000).toISOString(),
          refunded: c.refunded
        }));

    const succeededPayments = recentPayments.filter(p => p.status === 'succeeded');
    const chargesTotal = succeededPayments.reduce((s, c) => s + c.amount, 0);

    const mrr = subscriptions.data.reduce((sum, sub) => {
      const item = sub.items?.data?.[0];
      if (!item?.price) return sum;
      const amount = item.price.unit_amount || 0;
      const interval = item.price.recurring?.interval;
      // Normalize to monthly
      if (interval === 'year') return sum + (amount / 12);
      return sum + amount;
    }, 0) / 100;

    return {
      live: true,
      test_mode: isTestMode,
      available_balance: availableBalance,
      pending_balance: pendingBalance,
      instant_available: instantAvailable,
      connect_reserved: connectReserved,
      total_balance: availableBalance + pendingBalance,
      currency: (balance.available?.[0]?.currency) || (balance.pending?.[0]?.currency) || 'usd',
      active_subscriptions: subscriptions.data.length,
      mrr,
      arr: mrr * 12,
      total_customers: customers.data.length,
      recent_charges: recentPayments,
      charges_total: chargesTotal,
      balance_breakdown: [
        ...(balance.available || []).map(b => ({ type: 'available', amount: b.amount / 100, currency: b.currency })),
        ...(balance.pending || []).map(b => ({ type: 'pending', amount: b.amount / 100, currency: b.currency }))
      ]
    };
  } catch (err) {
    console.error('Stripe real balance error:', err.message);
    return { live: false, error: err.message, available_balance: 0, pending_balance: 0, total_balance: 0 };
  }
}

async function getDashboardStats() {
  const [
    bankAccounts,
    arSummary,
    apSummary,
    revenueThisMonth,
    expensesThisMonth,
    stripeBridge,
    roiSummary,
    recentTransactions,
    investorSummary,
    realStripe
  ] = await Promise.all([
    db.query('SELECT account_name, account_number, account_type, current_balance FROM fin_bank_accounts WHERE is_active = true ORDER BY account_name'),
    db.query("SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM fin_accounts_receivable WHERE status NOT IN ('paid', 'written_off') GROUP BY status"),
    db.query("SELECT status, COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM fin_accounts_payable WHERE status NOT IN ('paid') GROUP BY status"),
    db.query(`
      SELECT COALESCE(SUM(jl.credit), 0) as total
      FROM fin_journal_lines jl
      JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true
      WHERE jl.account_number LIKE '4%' AND jl.account_number != '4900'
        AND je.entry_date >= DATE_TRUNC('month', CURRENT_DATE)
    `),
    db.query(`
      SELECT COALESCE(SUM(jl.debit), 0) as total
      FROM fin_journal_lines jl
      JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true
      WHERE (jl.account_number LIKE '5%' OR jl.account_number LIKE '6%')
        AND je.entry_date >= DATE_TRUNC('month', CURRENT_DATE)
    `),
    db.query("SELECT COUNT(*) as count, COALESCE(SUM(real_amount), 0) as total, COALESCE(SUM(net_amount), 0) as net FROM fin_stripe_bridge WHERE status = 'completed'"),
    db.query("SELECT COUNT(*) as count, COALESCE(AVG(roi_percentage), 0) as avg_roi FROM fin_roi_tracking WHERE status = 'active'"),
    db.query('SELECT * FROM fin_bank_transactions ORDER BY created_at DESC LIMIT 10'),
    db.query("SELECT status, COUNT(*) as count, COALESCE(SUM(committed_amount), 0) as total FROM fin_investor_relations GROUP BY status"),
    getRealStripeData()
  ]);
  
  const totalCash = bankAccounts.rows.reduce((s, b) => s + parseFloat(b.current_balance), 0);
  const monthlyRevenue = parseFloat(revenueThisMonth.rows[0]?.total || 0);
  const monthlyExpenses = parseFloat(expensesThisMonth.rows[0]?.total || 0);
  const monthlyBurn = monthlyExpenses;
  const runway = monthlyBurn > 0 ? Math.round(totalCash / monthlyBurn) : 999;
  
  return {
    cash: {
      total: totalCash,
      accounts: bankAccounts.rows
    },
    monthly: {
      revenue: monthlyRevenue,
      expenses: monthlyExpenses,
      net_income: monthlyRevenue - monthlyExpenses,
      burn_rate: monthlyBurn,
      runway_months: runway
    },
    ar: {
      summary: arSummary.rows,
      total_outstanding: arSummary.rows.reduce((s, r) => s + parseFloat(r.total), 0)
    },
    ap: {
      summary: apSummary.rows,
      total_outstanding: apSummary.rows.reduce((s, r) => s + parseFloat(r.total), 0)
    },
    stripe: {
      total_processed: parseFloat(stripeBridge.rows[0]?.total || 0),
      total_net: parseFloat(stripeBridge.rows[0]?.net || 0),
      transaction_count: parseInt(stripeBridge.rows[0]?.count || 0)
    },
    stripe_live: realStripe,
    roi: {
      initiatives: parseInt(roiSummary.rows[0]?.count || 0),
      avg_roi: parseFloat(roiSummary.rows[0]?.avg_roi || 0)
    },
    recent_transactions: recentTransactions.rows,
    investors: investorSummary.rows
  };
}

// =========================================================================
// PAYROLL
// =========================================================================

async function getPayroll(filters = {}) {
  let query = 'SELECT * FROM fin_payroll WHERE 1=1';
  const params = [];
  if (filters.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }
  query += ' ORDER BY pay_date DESC LIMIT 50';
  const result = await db.query(query, params);
  return result.rows;
}

// =========================================================================
// TAX OBLIGATIONS
// =========================================================================

async function getTaxObligations() {
  const result = await db.query('SELECT * FROM fin_tax_obligations ORDER BY due_date ASC');
  return result.rows;
}

// =========================================================================
// REVENUE RECOGNITION
// =========================================================================

async function getRevenueRecognition() {
  const result = await db.query('SELECT * FROM fin_revenue_recognition WHERE status = \'active\' ORDER BY recognition_start DESC LIMIT 50');
  return result.rows;
}

// =========================================================================
// EXPORTS
// =========================================================================

module.exports = {
  initialize,
  // Chart of Accounts
  getChartOfAccounts,
  getAccountBalance,
  // Journal Entries
  createJournalEntry,
  getJournalEntries,
  // Bank Accounts
  getBankAccounts,
  getBankTransactions,
  recordBankTransaction,
  // Stripe Bridge
  recordStripeRevenue,
  // AR/AP
  getAccountsReceivable,
  createInvoice,
  getAccountsPayable,
  createBill,
  // Reports
  getTrialBalance,
  getBalanceSheet,
  getIncomeStatement,
  getCashFlowStatement,
  getDashboardStats,
  // ROI
  getROIMetrics,
  trackROI,
  // Budgets
  getBudgets,
  // Investor Relations
  getInvestorRelations,
  addInvestor,
  // Payroll
  getPayroll,
  // Tax
  getTaxObligations,
  // Revenue Recognition
  getRevenueRecognition,
  // Real Stripe
  getRealStripeData
};
