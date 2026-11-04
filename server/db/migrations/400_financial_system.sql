-- ═══════════════════════════════════════════════════════════════
--  MIGRATION 400: DoctaRx Corporate Financial System
--  Simulated Bank + Double-Entry Accounting + ROI Engine
--  "Every dollar accounted for. Every cent has a purpose."
-- ═══════════════════════════════════════════════════════════════

-- ═══ CHART OF ACCOUNTS (COA) ═══
-- The backbone of double-entry accounting
CREATE TABLE IF NOT EXISTS fin_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number VARCHAR(10) NOT NULL UNIQUE,
  account_name VARCHAR(255) NOT NULL,
  account_type VARCHAR(30) NOT NULL
    CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'contra_asset', 'contra_revenue')),
  sub_type VARCHAR(50),
  parent_account VARCHAR(10) REFERENCES fin_chart_of_accounts(account_number),
  description TEXT,
  normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,
  currency VARCHAR(3) DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ FISCAL PERIODS ═══
CREATE TABLE IF NOT EXISTS fin_fiscal_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_name VARCHAR(100) NOT NULL,
  period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('month', 'quarter', 'year')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_closed BOOLEAN DEFAULT false,
  closed_at TIMESTAMP,
  closed_by VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ JOURNAL ENTRIES (The Heart of Double-Entry) ═══
CREATE TABLE IF NOT EXISTS fin_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number SERIAL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  reference_type VARCHAR(50),
  reference_id VARCHAR(255),
  source VARCHAR(50) DEFAULT 'manual'
    CHECK (source IN ('manual', 'stripe_sync', 'enrollment', 'payroll', 'agent_auto', 'system', 'adjustment')),
  posted_by VARCHAR(100),
  is_posted BOOLEAN DEFAULT false,
  is_reversed BOOLEAN DEFAULT false,
  reversal_of UUID REFERENCES fin_journal_entries(id),
  fiscal_period_id UUID REFERENCES fin_fiscal_periods(id),
  memo TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  posted_at TIMESTAMP
);

-- ═══ JOURNAL LINES (Debits & Credits) ═══
CREATE TABLE IF NOT EXISTS fin_journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES fin_journal_entries(id) ON DELETE CASCADE,
  account_number VARCHAR(10) NOT NULL REFERENCES fin_chart_of_accounts(account_number),
  debit NUMERIC(15,2) DEFAULT 0.00,
  credit NUMERIC(15,2) DEFAULT 0.00,
  memo TEXT,
  line_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT check_debit_or_credit CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);

-- ═══ SIMULATED BANK ACCOUNTS ═══
CREATE TABLE IF NOT EXISTS fin_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_name VARCHAR(255) NOT NULL,
  account_number VARCHAR(20) NOT NULL UNIQUE,
  routing_number VARCHAR(9) DEFAULT '021000021',
  account_type VARCHAR(30) NOT NULL
    CHECK (account_type IN ('checking', 'savings', 'money_market', 'reserve', 'escrow', 'payroll', 'tax')),
  coa_account VARCHAR(10) REFERENCES fin_chart_of_accounts(account_number),
  current_balance NUMERIC(15,2) DEFAULT 0.00,
  available_balance NUMERIC(15,2) DEFAULT 0.00,
  pending_balance NUMERIC(15,2) DEFAULT 0.00,
  currency VARCHAR(3) DEFAULT 'USD',
  stripe_connected BOOLEAN DEFAULT false,
  stripe_account_id VARCHAR(100),
  daily_limit NUMERIC(15,2) DEFAULT 50000.00,
  is_active BOOLEAN DEFAULT true,
  opened_at TIMESTAMP DEFAULT NOW(),
  last_reconciled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ BANK TRANSACTIONS ═══
CREATE TABLE IF NOT EXISTS fin_bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES fin_bank_accounts(id),
  transaction_type VARCHAR(30) NOT NULL
    CHECK (transaction_type IN ('deposit', 'withdrawal', 'transfer', 'fee', 'interest', 'stripe_payout', 'stripe_charge', 'refund', 'payroll', 'tax_payment', 'vendor_payment')),
  amount NUMERIC(15,2) NOT NULL,
  running_balance NUMERIC(15,2),
  description TEXT NOT NULL,
  reference_number VARCHAR(50),
  counterparty VARCHAR(255),
  journal_entry_id UUID REFERENCES fin_journal_entries(id),
  stripe_payment_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'completed'
    CHECK (status IN ('pending', 'completed', 'failed', 'reversed', 'held')),
  posted_date DATE DEFAULT CURRENT_DATE,
  value_date DATE DEFAULT CURRENT_DATE,
  category VARCHAR(50),
  memo TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ ACCOUNTS RECEIVABLE ═══
CREATE TABLE IF NOT EXISTS fin_accounts_receivable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  customer_type VARCHAR(30) NOT NULL CHECK (customer_type IN ('patient', 'provider', 'insurance', 'partner', 'investor')),
  customer_id UUID,
  customer_name VARCHAR(255) NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  amount_paid NUMERIC(15,2) DEFAULT 0.00,
  balance_due NUMERIC(15,2) GENERATED ALWAYS AS (amount - amount_paid) STORED,
  due_date DATE NOT NULL,
  issued_date DATE DEFAULT CURRENT_DATE,
  status VARCHAR(20) DEFAULT 'outstanding'
    CHECK (status IN ('draft', 'outstanding', 'partial', 'paid', 'overdue', 'written_off', 'disputed')),
  terms VARCHAR(20) DEFAULT 'net_30',
  payment_method VARCHAR(30),
  stripe_invoice_id VARCHAR(255),
  journal_entry_id UUID REFERENCES fin_journal_entries(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

-- ═══ ACCOUNTS PAYABLE ═══
CREATE TABLE IF NOT EXISTS fin_accounts_payable (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number VARCHAR(50) NOT NULL,
  vendor_name VARCHAR(255) NOT NULL,
  vendor_type VARCHAR(30) CHECK (vendor_type IN ('cloud_hosting', 'api_service', 'insurance', 'legal', 'marketing', 'payroll', 'tax', 'license', 'office', 'other')),
  amount NUMERIC(15,2) NOT NULL,
  amount_paid NUMERIC(15,2) DEFAULT 0.00,
  balance_due NUMERIC(15,2) GENERATED ALWAYS AS (amount - amount_paid) STORED,
  due_date DATE NOT NULL,
  received_date DATE DEFAULT CURRENT_DATE,
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'approved', 'partial', 'paid', 'overdue', 'disputed')),
  terms VARCHAR(20) DEFAULT 'net_30',
  recurring BOOLEAN DEFAULT false,
  recurrence_interval VARCHAR(20),
  journal_entry_id UUID REFERENCES fin_journal_entries(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);

-- ═══ BUDGETS ═══
CREATE TABLE IF NOT EXISTS fin_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_name VARCHAR(255) NOT NULL,
  account_number VARCHAR(10) REFERENCES fin_chart_of_accounts(account_number),
  fiscal_period_id UUID REFERENCES fin_fiscal_periods(id),
  budgeted_amount NUMERIC(15,2) NOT NULL,
  actual_amount NUMERIC(15,2) DEFAULT 0.00,
  variance NUMERIC(15,2) GENERATED ALWAYS AS (budgeted_amount - actual_amount) STORED,
  variance_pct NUMERIC(8,2),
  department VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══ REVENUE RECOGNITION ═══
CREATE TABLE IF NOT EXISTS fin_revenue_recognition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_source VARCHAR(50) NOT NULL
    CHECK (revenue_source IN ('subscription_patient', 'subscription_provider', 'consultation_fee', 'credentialing_fee', 'insurance_claim', 'marketplace', 'api_access', 'white_label', 'other')),
  gross_amount NUMERIC(15,2) NOT NULL,
  deferred_amount NUMERIC(15,2) DEFAULT 0.00,
  recognized_amount NUMERIC(15,2) DEFAULT 0.00,
  recognition_start DATE NOT NULL,
  recognition_end DATE,
  recognition_method VARCHAR(20) DEFAULT 'straight_line'
    CHECK (recognition_method IN ('straight_line', 'milestone', 'immediate', 'percentage_completion')),
  stripe_subscription_id VARCHAR(255),
  customer_id UUID,
  customer_name VARCHAR(255),
  journal_entry_id UUID REFERENCES fin_journal_entries(id),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'paused')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ ROI TRACKING ═══
CREATE TABLE IF NOT EXISTS fin_roi_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL
    CHECK (category IN ('marketing', 'product', 'hiring', 'infrastructure', 'partnerships', 'r_and_d', 'agent_operations', 'crm_outreach')),
  investment_amount NUMERIC(15,2) NOT NULL,
  revenue_generated NUMERIC(15,2) DEFAULT 0.00,
  cost_savings NUMERIC(15,2) DEFAULT 0.00,
  roi_percentage NUMERIC(8,2),
  payback_months NUMERIC(8,2),
  time_period VARCHAR(20),
  start_date DATE,
  end_date DATE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  kpis JSONB DEFAULT '{}',
  agent_managed BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══ FINANCIAL SNAPSHOTS (Cached Reports) ═══
CREATE TABLE IF NOT EXISTS fin_financial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type VARCHAR(30) NOT NULL
    CHECK (report_type IN ('balance_sheet', 'income_statement', 'cash_flow', 'trial_balance', 'ar_aging', 'ap_aging', 'roi_summary', 'burn_rate', 'runway')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  report_data JSONB NOT NULL,
  generated_by VARCHAR(100) DEFAULT 'system',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ STRIPE REVENUE BRIDGE (Translates simulated → real) ═══
CREATE TABLE IF NOT EXISTS fin_stripe_bridge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sim_bank_account_id UUID REFERENCES fin_bank_accounts(id),
  stripe_payment_intent_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  enrollment_type VARCHAR(50)
    CHECK (enrollment_type IN ('patient_subscription', 'provider_subscription', 'consultation', 'credentialing', 'one_time')),
  sim_amount NUMERIC(15,2) NOT NULL,
  real_amount NUMERIC(15,2) NOT NULL,
  fee_amount NUMERIC(15,2) DEFAULT 0.00,
  net_amount NUMERIC(15,2),
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  reconciled BOOLEAN DEFAULT false,
  reconciled_at TIMESTAMP,
  journal_entry_id UUID REFERENCES fin_journal_entries(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ INVESTOR RELATIONS ═══
CREATE TABLE IF NOT EXISTS fin_investor_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_name VARCHAR(255),
  investor_type VARCHAR(30) CHECK (investor_type IN ('angel', 'vc', 'pe', 'strategic', 'crowdfund', 'family_office')),
  round_name VARCHAR(50),
  committed_amount NUMERIC(15,2) DEFAULT 0.00,
  received_amount NUMERIC(15,2) DEFAULT 0.00,
  equity_percentage NUMERIC(6,3) DEFAULT 0.000,
  valuation_at_entry NUMERIC(15,2),
  status VARCHAR(20) DEFAULT 'prospect'
    CHECK (status IN ('prospect', 'contacted', 'pitch_sent', 'due_diligence', 'term_sheet', 'committed', 'funded', 'declined')),
  contact_email VARCHAR(255),
  last_contacted_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ PAYROLL LEDGER ═══
CREATE TABLE IF NOT EXISTS fin_payroll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_name VARCHAR(255) NOT NULL,
  employee_type VARCHAR(30) CHECK (employee_type IN ('w2', 'contractor', 'advisor', 'founder')),
  department VARCHAR(100),
  gross_pay NUMERIC(15,2) NOT NULL,
  tax_withholding NUMERIC(15,2) DEFAULT 0.00,
  benefits_deduction NUMERIC(15,2) DEFAULT 0.00,
  net_pay NUMERIC(15,2),
  pay_period_start DATE,
  pay_period_end DATE,
  pay_date DATE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'voided')),
  journal_entry_id UUID REFERENCES fin_journal_entries(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ TAX OBLIGATIONS ═══
CREATE TABLE IF NOT EXISTS fin_tax_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_type VARCHAR(50) NOT NULL CHECK (tax_type IN ('federal_income', 'state_income', 'payroll_fica', 'payroll_medicare', 'sales_tax', 'franchise_tax', 'estimated_quarterly')),
  jurisdiction VARCHAR(100),
  period_start DATE,
  period_end DATE,
  amount_owed NUMERIC(15,2) NOT NULL,
  amount_paid NUMERIC(15,2) DEFAULT 0.00,
  due_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'accrued' CHECK (status IN ('accrued', 'filed', 'paid', 'overdue', 'disputed')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══ INDEXES ═══
CREATE INDEX IF NOT EXISTS idx_fin_coa_type ON fin_chart_of_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_fin_coa_number ON fin_chart_of_accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_fin_je_date ON fin_journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_fin_je_posted ON fin_journal_entries(is_posted);
CREATE INDEX IF NOT EXISTS idx_fin_je_source ON fin_journal_entries(source);
CREATE INDEX IF NOT EXISTS idx_fin_jl_entry ON fin_journal_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_fin_jl_account ON fin_journal_lines(account_number);
CREATE INDEX IF NOT EXISTS idx_fin_bank_txn_account ON fin_bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_fin_bank_txn_date ON fin_bank_transactions(posted_date);
CREATE INDEX IF NOT EXISTS idx_fin_ar_status ON fin_accounts_receivable(status);
CREATE INDEX IF NOT EXISTS idx_fin_ar_due ON fin_accounts_receivable(due_date);
CREATE INDEX IF NOT EXISTS idx_fin_ap_status ON fin_accounts_payable(status);
CREATE INDEX IF NOT EXISTS idx_fin_ap_due ON fin_accounts_payable(due_date);
CREATE INDEX IF NOT EXISTS idx_fin_roi_category ON fin_roi_tracking(category);
CREATE INDEX IF NOT EXISTS idx_fin_stripe_bridge_status ON fin_stripe_bridge(status);
CREATE INDEX IF NOT EXISTS idx_fin_revenue_rec_source ON fin_revenue_recognition(revenue_source);

-- ═══════════════════════════════════════════════════════════════
--  SEED DATA: Chart of Accounts (Standard Corporate COA)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO fin_chart_of_accounts (account_number, account_name, account_type, sub_type, normal_balance, description, is_system) VALUES
-- ASSETS (1000s)
('1000', 'Cash & Cash Equivalents', 'asset', 'current', 'debit', 'Total cash position', true),
('1010', 'Operating Checking Account', 'asset', 'current', 'debit', 'Primary operating bank account', true),
('1020', 'Payroll Account', 'asset', 'current', 'debit', 'Dedicated payroll bank account', true),
('1030', 'Reserve Savings', 'asset', 'current', 'debit', 'Emergency reserve fund', true),
('1040', 'Tax Escrow Account', 'asset', 'current', 'debit', 'Taxes held in escrow', true),
('1050', 'Stripe Settlement Account', 'asset', 'current', 'debit', 'Funds pending from Stripe', true),
('1100', 'Accounts Receivable', 'asset', 'current', 'debit', 'Money owed by customers', true),
('1110', 'AR - Patient Subscriptions', 'asset', 'current', 'debit', 'Receivables from patient subscriptions', false),
('1120', 'AR - Provider Subscriptions', 'asset', 'current', 'debit', 'Receivables from provider fees', false),
('1130', 'AR - Insurance Claims', 'asset', 'current', 'debit', 'Receivables from insurance claims', false),
('1140', 'AR - Credentialing Fees', 'asset', 'current', 'debit', 'Receivables from credentialing', false),
('1200', 'Prepaid Expenses', 'asset', 'current', 'debit', 'Prepaid software, hosting, etc.', false),
('1300', 'Equipment & Hardware', 'asset', 'fixed', 'debit', 'Computers, servers, medical devices', false),
('1310', 'Software & IP', 'asset', 'intangible', 'debit', 'Proprietary software, patents', false),
('1400', 'Accumulated Depreciation', 'contra_asset', 'fixed', 'credit', 'Depreciation on fixed assets', false),

-- LIABILITIES (2000s)
('2000', 'Accounts Payable', 'liability', 'current', 'credit', 'Money owed to vendors', true),
('2010', 'AP - Cloud Services (GCP/AWS)', 'liability', 'current', 'credit', 'Cloud hosting bills', false),
('2020', 'AP - API Services', 'liability', 'current', 'credit', 'Third-party API costs', false),
('2030', 'AP - Professional Services', 'liability', 'current', 'credit', 'Legal, accounting, consulting', false),
('2100', 'Accrued Expenses', 'liability', 'current', 'credit', 'Expenses incurred but not yet paid', false),
('2200', 'Deferred Revenue', 'liability', 'current', 'credit', 'Pre-collected subscription revenue', true),
('2210', 'Deferred Rev - Annual Subscriptions', 'liability', 'current', 'credit', 'Annual subs recognized monthly', false),
('2300', 'Payroll Liabilities', 'liability', 'current', 'credit', 'Wages, taxes, benefits owed', true),
('2310', 'Payroll Tax Payable', 'liability', 'current', 'credit', 'FICA, Medicare, FUTA', false),
('2400', 'Sales Tax Payable', 'liability', 'current', 'credit', 'Collected sales tax', false),
('2500', 'Notes Payable', 'liability', 'long_term', 'credit', 'Loans and notes payable', false),
('2600', 'Convertible Notes', 'liability', 'long_term', 'credit', 'Convertible notes from investors', false),

-- EQUITY (3000s)
('3000', 'Founders Equity', 'equity', 'owners_equity', 'credit', 'Capital contributed by founders', true),
('3100', 'Additional Paid-In Capital', 'equity', 'paid_in', 'credit', 'Investment capital above par value', false),
('3200', 'Retained Earnings', 'equity', 'retained', 'credit', 'Accumulated net income', true),
('3300', 'Treasury Stock', 'equity', 'treasury', 'debit', 'Repurchased shares', false),
('3400', 'Current Period Net Income', 'equity', 'net_income', 'credit', 'Net income for current period', true),

-- REVENUE (4000s)
('4000', 'Revenue', 'revenue', 'operating', 'credit', 'Total revenue', true),
('4010', 'Patient Subscription Revenue', 'revenue', 'recurring', 'credit', 'Monthly/annual patient subscriptions', true),
('4020', 'Provider Subscription Revenue', 'revenue', 'recurring', 'credit', 'Provider platform fees', true),
('4030', 'Consultation Revenue', 'revenue', 'transactional', 'credit', 'Per-visit consultation fees', true),
('4040', 'Credentialing Revenue', 'revenue', 'transactional', 'credit', 'Provider credentialing fees', false),
('4050', 'Insurance Claim Revenue', 'revenue', 'transactional', 'credit', 'Revenue from insurance reimbursements', false),
('4060', 'Marketplace Revenue', 'revenue', 'transactional', 'credit', 'Third-party marketplace commissions', false),
('4070', 'API & White-Label Revenue', 'revenue', 'recurring', 'credit', 'Enterprise API/white-label fees', false),
('4100', 'Interest Income', 'revenue', 'non_operating', 'credit', 'Interest earned on deposits', false),
('4200', 'Other Income', 'revenue', 'non_operating', 'credit', 'Miscellaneous income', false),
('4900', 'Stripe Processing Fees', 'contra_revenue', 'fees', 'debit', 'Payment processing fees (2.9% + $0.30)', true),

-- COST OF GOODS SOLD (5000s)
('5000', 'Cost of Revenue', 'expense', 'cogs', 'debit', 'Direct costs of delivering services', true),
('5010', 'Cloud Hosting (GCP)', 'expense', 'cogs', 'debit', 'Google Cloud Platform costs', true),
('5020', 'Third-Party API Costs', 'expense', 'cogs', 'debit', 'Stripe, Twilio, Gemini API, etc.', true),
('5030', 'Payment Processing Costs', 'expense', 'cogs', 'debit', 'Stripe fees on transactions', false),
('5040', 'eRx/Pharmacy Costs', 'expense', 'cogs', 'debit', 'E-prescribing integration costs', false),
('5050', 'FHIR/Interop Costs', 'expense', 'cogs', 'debit', 'Health data interoperability costs', false),

-- OPERATING EXPENSES (6000s)
('6000', 'Operating Expenses', 'expense', 'opex', 'debit', 'Total operating expenses', true),
('6010', 'Salaries & Wages', 'expense', 'payroll', 'debit', 'Employee compensation', true),
('6020', 'Benefits & Insurance', 'expense', 'payroll', 'debit', 'Health insurance, 401k, etc.', false),
('6030', 'Payroll Taxes', 'expense', 'payroll', 'debit', 'Employer payroll tax expense', false),
('6040', 'Contractor Payments', 'expense', 'payroll', 'debit', 'Independent contractor fees', false),
('6100', 'Marketing & Advertising', 'expense', 'marketing', 'debit', 'Digital ads, content, SEO', true),
('6110', 'CRM & Outreach Costs', 'expense', 'marketing', 'debit', 'Zoho Mail, outreach tools', false),
('6200', 'Software & Subscriptions', 'expense', 'technology', 'debit', 'SaaS tools, licenses', false),
('6210', 'AI/ML Costs (Gemini)', 'expense', 'technology', 'debit', 'Google Gemini API usage', true),
('6300', 'Legal & Compliance', 'expense', 'professional', 'debit', 'Legal fees, HIPAA compliance', false),
('6310', 'Accounting & Audit', 'expense', 'professional', 'debit', 'CPA, audit, bookkeeping', false),
('6400', 'Insurance (Business)', 'expense', 'insurance', 'debit', 'E&O, malpractice, cyber liability', false),
('6500', 'Office & Equipment', 'expense', 'general', 'debit', 'Rent, utilities, equipment', false),
('6600', 'Depreciation & Amortization', 'expense', 'non_cash', 'debit', 'Asset depreciation', false),
('6700', 'Travel & Entertainment', 'expense', 'general', 'debit', 'Business travel, meals', false),
('6800', 'Research & Development', 'expense', 'r_and_d', 'debit', 'R&D expenses', false),
('6900', 'Miscellaneous Expenses', 'expense', 'general', 'debit', 'Other operating costs', false),

-- TAXES (7000s)
('7000', 'Income Tax Expense', 'expense', 'tax', 'debit', 'Federal & state income tax', false),
('7010', 'Franchise Tax', 'expense', 'tax', 'debit', 'State franchise tax', false)

ON CONFLICT (account_number) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
--  SEED DATA: Bank Accounts
-- ═══════════════════════════════════════════════════════════════

INSERT INTO fin_bank_accounts (account_name, account_number, account_type, coa_account, current_balance, available_balance, stripe_connected) VALUES
('DoctaRx Operating', 'DCTA-OPS-001', 'checking', '1010', 0.00, 0.00, false),
('DoctaRx Payroll', 'DCTA-PAY-001', 'payroll', '1020', 0.00, 0.00, false),
('DoctaRx Reserve', 'DCTA-RES-001', 'savings', '1030', 0.00, 0.00, false),
('DoctaRx Tax Escrow', 'DCTA-TAX-001', 'escrow', '1040', 0.00, 0.00, false),
('Stripe Revenue Account', 'DCTA-STR-001', 'checking', '1050', 0.00, 0.00, true)
ON CONFLICT (account_number) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
--  SEED DATA: Current Fiscal Periods
-- ═══════════════════════════════════════════════════════════════

INSERT INTO fin_fiscal_periods (period_name, period_type, start_date, end_date) VALUES
('Q1 2026', 'quarter', '2026-01-01', '2026-03-31'),
('Q2 2026', 'quarter', '2026-04-01', '2026-06-30'),
('Q3 2026', 'quarter', '2026-07-01', '2026-09-30'),
('Q4 2026', 'quarter', '2026-10-01', '2026-12-31'),
('January 2026', 'month', '2026-01-01', '2026-01-31'),
('February 2026', 'month', '2026-02-01', '2026-02-28'),
('March 2026', 'month', '2026-03-01', '2026-03-31'),
('FY 2026', 'year', '2026-01-01', '2026-12-31')
ON CONFLICT DO NOTHING;
