/**
 * Accounting Agent — "The Treasurer"
 * PROJECT GENESIS + CORPORATE FINANCE PROTOCOL
 *
 * Mission: Guard every dollar. Translate simulated value into real revenue.
 * 
 * Sub-Agents (Accounting Clerks):
 *   1. AR Clerk — Chase receivables, generate invoices, reconcile Stripe
 *   2. AP Clerk — Track payables, flag overdue bills, optimize spend
 *   3. Reconciliation Clerk — Balance the books, match Stripe ↔ Ledger
 *   4. Tax Clerk — Accrue tax obligations, track deadlines
 *   5. Payroll Clerk — Process payroll cycles, calculate withholdings
 *
 * Standard: GAAP-aligned. Every transaction balanced. Zero tolerance for leaks.
 */

const BaseAgent = require('../base-agent');
const { GNOSIS } = require('../base-agent');

class AccountingAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'accounting',
      displayName: 'The Treasurer',
      codeName: 'The Treasurer',
      description: 'Corporate CFO agent managing double-entry accounting, bank accounts, Stripe revenue bridge, AR/AP, payroll, taxes, budgets, and ROI tracking. Deploys sub-agent clerks for specialized tasks.',
      mission: 'Guard every dollar with precision accounting. Translate simulated bank values into real Stripe revenue through enrollments. Keep the books balanced, cash flow positive, and runway extending.',
      capabilities: ['query_database', 'fetch_metrics', 'analyze_data', 'stripe_api', 'simulate_payment', 'verify_payment_flow'],
      autonomyLevel: 1,
      systemPrompt: `You are The Treasurer — Chief Financial Officer Agent for DoctaRx.

CORE RESPONSIBILITIES:
  1. DOUBLE-ENTRY ACCOUNTING: Every journal entry must balance (debits = credits)
  2. BANK MANAGEMENT: Monitor all 5 simulated bank accounts — Operating, Payroll, Reserve, Tax Escrow, Stripe
  3. STRIPE BRIDGE: Every real Stripe payment must be recorded in the financial system
  4. AR/AP: Track receivables aggressively, pay bills on time, optimize cash conversion cycle
  5. ROI: Measure return on every initiative — marketing, agent ops, CRM outreach
  6. RUNWAY: Always know how many months of cash we have
  7. TAX COMPLIANCE: Accrue and track all tax obligations
  8. INVESTOR READINESS: Keep financials audit-ready at all times

SUB-AGENT CLERKS (you delegate to them):
  - AR Clerk: Receivables, invoicing, collections, Stripe reconciliation
  - AP Clerk: Payables, vendor management, spend optimization
  - Reconciliation Clerk: Bank ↔ Ledger matching, trial balance verification
  - Tax Clerk: Tax accruals, quarterly estimates, compliance deadlines
  - Payroll Clerk: Compensation, withholdings, benefit deductions

STRIPE API ACCESS:
  You have DIRECT access to the Stripe API through the payment simulation service.
  You can: create test customers, simulate payments, simulate subscriptions,
  verify the full payment pipeline end-to-end, and view the Stripe dashboard.
  
  CODEBASE KNOWLEDGE — You understand the full DoctaRx payment architecture:
  - stripeService.js: Core Stripe integration (customers, checkout sessions, subscriptions, webhooks)
  - financialService.js: Double-entry accounting engine, bank accounts, AR/AP, revenue recognition
  - paymentSimulationService.js: Test payments, pipeline verification, Stripe dashboard
  - stripe.js routes: Frontend payment flow API endpoints
  
  PAYMENT FLOWS YOU MONITOR:
  1. Patient Subscriptions: Frontend → /api/stripe/checkout/subscription → Stripe → Webhook → DB → Ledger
     Plans: Basic $19.99/mo, Gold $39.99/mo, Platinum $79.99/mo, Gold Annual $299/yr
  2. Provider Subscriptions: Frontend → /api/stripe/checkout/provider-subscription → Stripe → Webhook → DB
     Plans: Starter $99/mo, Professional $199/mo, Enterprise $499/mo
  3. Consultations: Frontend → /api/stripe/checkout/consultation → Stripe → Webhook → Payment record
     Prices: Initial $79, Follow-up $49, Specialist $129, Urgent $99
  4. Credentialing: Frontend → /api/stripe/checkout/credentialing → Stripe → Webhook → Status update
     Prices: Application $99, Verification $149, Full Package $199
  
  STRIPE FEES: 2.9% + $0.30 per transaction (record as contra-revenue account 4900)
  
  FINANCIAL ACCOUNTS:
  1050 = Stripe Settlement | 4010 = Patient Subs | 4020 = Provider Subs
  4030 = Consultation Revenue | 4040 = Credentialing | 4900 = Stripe Fees

FINANCIAL RULES:
  - NEVER approve payments exceeding daily limits without operator approval
  - ALWAYS flag negative cash positions immediately
  - ALWAYS create journal entries for every financial event
  - Revenue recognition: subscription revenue recognized monthly (straight-line)
  - TEST PAYMENTS DAILY: Run simulate_payment to verify pipeline works
  - Any Stripe webhook failure is CRITICAL — escalate immediately

Report metrics in dollars. Calculate burn rate = total monthly expenses.
Runway = Total Cash / Monthly Burn Rate.`
    });

    // Sub-agent clerk definitions
    this.clerks = {
      ar: {
        name: 'AR Clerk',
        focus: 'accounts_receivable',
        tasks: ['invoice_generation', 'payment_tracking', 'collections', 'stripe_reconciliation']
      },
      ap: {
        name: 'AP Clerk',
        focus: 'accounts_payable',
        tasks: ['bill_tracking', 'payment_scheduling', 'vendor_management', 'spend_optimization']
      },
      reconciliation: {
        name: 'Reconciliation Clerk',
        focus: 'reconciliation',
        tasks: ['bank_reconciliation', 'trial_balance', 'stripe_bridge_matching', 'month_end_close']
      },
      tax: {
        name: 'Tax Clerk',
        focus: 'tax_compliance',
        tasks: ['tax_accrual', 'quarterly_estimates', 'filing_deadlines', 'withholding_calculation']
      },
      payroll: {
        name: 'Payroll Clerk',
        focus: 'payroll',
        tasks: ['salary_processing', 'withholding_calc', 'benefit_deductions', 'contractor_payments']
      }
    };
  }

  getSubscribedEvents() {
    return [
      'payment.received',
      'payment.failed',
      'subscription.created',
      'subscription.cancelled',
      'claim.submitted',
      'claim.denied',
      'fin.journal.posted',
      'fin.stripe.synced',
      'fin.ar.overdue',
      'fin.ap.due',
      'fin.budget.exceeded',
      'fin.runway.warning',
      'fin.reconciliation.mismatch'
    ];
  }

  async observe(context) {
    const observations = [];

    // 1. Check total cash position
    try {
      const cashPosition = await this.declareReadIntent('query_database', {
        query: `SELECT account_name, account_number, current_balance, account_type 
                FROM fin_bank_accounts WHERE is_active = true ORDER BY account_name`
      }, 'Scanning treasury — total cash position');
      observations.push({ type: 'cash_position', data: cashPosition.execution_result || {} });
    } catch (e) { observations.push({ type: 'cash_position', error: e.message }); }

    // 1b. Stripe API health check
    try {
      const paymentSimService = require('../../paymentSimulationService');
      const stripeHealth = await paymentSimService.stripeHealthCheck();
      observations.push({ type: 'stripe_health', data: stripeHealth });
    } catch (e) { observations.push({ type: 'stripe_health', error: e.message }); }

    // 2. Check Stripe bridge — unreconciled transactions
    try {
      const stripePending = await this.declareReadIntent('query_database', {
        query: `SELECT COUNT(*) as pending_count, COALESCE(SUM(real_amount), 0) as pending_amount
                FROM fin_stripe_bridge WHERE reconciled = false AND status = 'completed'`
      }, 'Checking Stripe ↔ Ledger reconciliation status');
      observations.push({ type: 'stripe_reconciliation', data: stripePending.execution_result || {} });
    } catch (e) { observations.push({ type: 'stripe_reconciliation', error: e.message }); }

    // 3. Check overdue receivables (AR Clerk task)
    try {
      const overdueAR = await this.declareReadIntent('query_database', {
        query: `SELECT COUNT(*) as overdue_count, COALESCE(SUM(amount - amount_paid), 0) as overdue_amount
                FROM fin_accounts_receivable 
                WHERE due_date < CURRENT_DATE AND status IN ('outstanding', 'partial')`
      }, 'AR Clerk: Scanning overdue receivables');
      observations.push({ type: 'overdue_ar', data: overdueAR.execution_result || {} });
    } catch (e) { observations.push({ type: 'overdue_ar', error: e.message }); }

    // 4. Check upcoming payables (AP Clerk task)
    try {
      const upcomingAP = await this.declareReadIntent('query_database', {
        query: `SELECT COUNT(*) as due_count, COALESCE(SUM(amount - amount_paid), 0) as due_amount
                FROM fin_accounts_payable 
                WHERE due_date <= CURRENT_DATE + INTERVAL '7 days' AND status IN ('pending', 'approved')`
      }, 'AP Clerk: Checking upcoming payables');
      observations.push({ type: 'upcoming_ap', data: upcomingAP.execution_result || {} });
    } catch (e) { observations.push({ type: 'upcoming_ap', error: e.message }); }

    // 5. Check revenue this month
    try {
      const monthlyRevenue = await this.declareReadIntent('query_database', {
        query: `SELECT COALESCE(SUM(jl.credit), 0) as revenue
                FROM fin_journal_lines jl
                JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true
                WHERE jl.account_number LIKE '4%' AND jl.account_number != '4900'
                  AND je.entry_date >= DATE_TRUNC('month', CURRENT_DATE)`
      }, 'Measuring monthly revenue stream');
      observations.push({ type: 'monthly_revenue', data: monthlyRevenue.execution_result || {} });
    } catch (e) { observations.push({ type: 'monthly_revenue', error: e.message }); }

    // 6. Check trial balance (Reconciliation Clerk)
    try {
      const trialBalance = await this.declareReadIntent('query_database', {
        query: `SELECT 
                  COALESCE(SUM(debit), 0) as total_debits,
                  COALESCE(SUM(credit), 0) as total_credits,
                  ABS(COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0)) as imbalance
                FROM fin_journal_lines jl
                JOIN fin_journal_entries je ON jl.journal_entry_id = je.id AND je.is_posted = true`
      }, 'Reconciliation Clerk: Verifying trial balance');
      observations.push({ type: 'trial_balance', data: trialBalance.execution_result || {} });
    } catch (e) { observations.push({ type: 'trial_balance', error: e.message }); }

    // 7. Tax obligations (Tax Clerk)
    try {
      const taxDue = await this.declareReadIntent('query_database', {
        query: `SELECT COUNT(*) as upcoming_count, COALESCE(SUM(amount_owed - amount_paid), 0) as total_due
                FROM fin_tax_obligations 
                WHERE due_date <= CURRENT_DATE + INTERVAL '30 days' AND status IN ('accrued', 'filed')`
      }, 'Tax Clerk: Checking upcoming tax obligations');
      observations.push({ type: 'tax_obligations', data: taxDue.execution_result || {} });
    } catch (e) { observations.push({ type: 'tax_obligations', error: e.message }); }

    return observations;
  }

  async analyze(observations) {
    const insights = [];
    const alerts = [];

    for (const obs of observations) {
      if (obs.error) continue;

      switch (obs.type) {
        case 'cash_position': {
          const rows = obs.data?.rows || [];
          const totalCash = rows.reduce((s, r) => s + parseFloat(r?.current_balance || 0), 0);
          insights.push(`💰 Total Cash: $${totalCash.toFixed(2)} across ${rows.length} accounts`);
          if (totalCash < 0) alerts.push({ severity: 'critical', message: `NEGATIVE CASH POSITION: $${totalCash.toFixed(2)}` });
          break;
        }
        case 'overdue_ar': {
          const count = parseInt(obs.data?.rows?.[0]?.overdue_count || 0);
          const amount = parseFloat(obs.data?.rows?.[0]?.overdue_amount || 0);
          if (count > 0) {
            insights.push(`🔴 AR Clerk: ${count} overdue invoices totaling $${amount.toFixed(2)}`);
            alerts.push({ severity: 'warning', message: `${count} overdue AR invoices — $${amount.toFixed(2)} at risk` });
          }
          break;
        }
        case 'upcoming_ap': {
          const count = parseInt(obs.data?.rows?.[0]?.due_count || 0);
          const amount = parseFloat(obs.data?.rows?.[0]?.due_amount || 0);
          if (count > 0) insights.push(`📋 AP Clerk: ${count} bills due within 7 days — $${amount.toFixed(2)}`);
          break;
        }
        case 'trial_balance': {
          const imbalance = parseFloat(obs.data?.rows?.[0]?.imbalance || 0);
          if (imbalance > 0.01) {
            alerts.push({ severity: 'critical', message: `TRIAL BALANCE OUT: $${imbalance.toFixed(2)} imbalance detected` });
          } else {
            insights.push(`✅ Reconciliation Clerk: Trial balance verified — Books are balanced`);
          }
          break;
        }
        case 'stripe_health': {
          if (obs.data?.healthy) {
            insights.push(`✅ Stripe API: Connected & healthy (${obs.data.details?.recent_events || 0} recent events)`);
            if (obs.data.details?.balance) {
              const avail = obs.data.details.balance.available?.[0]?.amount || 0;
              insights.push(`💳 Stripe Balance: $${avail.toFixed(2)} available`);
            }
          } else {
            alerts.push({ severity: 'critical', message: `STRIPE API DOWN: ${obs.data?.error || 'Unknown error'}` });
          }
          break;
        }
        case 'stripe_reconciliation': {
          const pending = parseInt(obs.data?.rows?.[0]?.pending_count || 0);
          if (pending > 0) insights.push(`🔄 ${pending} Stripe transactions pending reconciliation`);
          break;
        }
        case 'monthly_revenue': {
          const revenue = parseFloat(obs.data?.rows?.[0]?.revenue || 0);
          insights.push(`📈 MTD Revenue: $${revenue.toFixed(2)}`);
          break;
        }
        case 'tax_obligations': {
          const count = parseInt(obs.data?.rows?.[0]?.upcoming_count || 0);
          const amount = parseFloat(obs.data?.rows?.[0]?.total_due || 0);
          if (count > 0) insights.push(`🏛️ Tax Clerk: ${count} obligations due within 30 days — $${amount.toFixed(2)}`);
          break;
        }
      }
    }

    return {
      summary: `The Treasurer reporting. ${insights.length} observations, ${alerts.length} alerts.`,
      insights,
      alerts,
      clerk_status: Object.entries(this.clerks).map(([k, v]) => ({ id: k, name: v.name, focus: v.focus }))
    };
  }

  async propose(analysis) {
    const proposals = [];

    for (const alert of (analysis.alerts || [])) {
      if (alert.severity === 'critical') {
        proposals.push({
          action: 'notify',
          reason: alert.message,
          requiresApproval: true,
          priority: 'critical'
        });
      }
    }

    return proposals;
  }

  async handleEvent(event) {
    switch (event.event_type) {
      case 'payment.received':
        return { action: 'log', message: `Payment received — delegating to AR Clerk for reconciliation` };
      case 'payment.failed':
        return { action: 'alert', message: `Payment failed — flagging for review`, severity: 'warning' };
      case 'fin.runway.warning':
        return { action: 'alert', message: `Runway warning — escalating to operator`, severity: 'critical' };
      case 'fin.reconciliation.mismatch':
        return { action: 'alert', message: `Reconciliation mismatch — Reconciliation Clerk investigating`, severity: 'warning' };
      default:
        return { action: 'log', message: `Event noted: ${event.event_type}` };
    }
  }
}

module.exports = AccountingAgent;
