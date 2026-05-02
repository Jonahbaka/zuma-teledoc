// Nigeria-specific utility functions and constants

export const NG_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT - Abuja', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

export const ORG_TYPES = [
  { value: 'company', label: 'Company / Business' },
  { value: 'ngo', label: 'NGO / Non-profit' },
  { value: 'church', label: 'Church / Religious Organisation' },
  { value: 'mosque', label: 'Mosque / Islamic Organisation' },
  { value: 'school', label: 'School / Educational Institution' },
  { value: 'government', label: 'Government Body / Agency' },
  { value: 'association', label: 'Association / Union' },
  { value: 'hospital', label: 'Hospital / Healthcare Facility' },
  { value: 'cooperative', label: 'Cooperative / Community Group' },
];

export const FACILITY_TYPES = [
  'General Hospital', 'Teaching Hospital', 'Specialist Hospital',
  'Private Clinic', 'Primary Healthcare Centre (PHC)', 'Medical Centre',
  'Maternity Home', 'Diagnostic Centre', 'Rehabilitation Centre',
];

export const SUBSCRIPTION_PLANS = {
  patient: [
    {
      id: 'patient_free_access',
      name: 'Free Patient Access',
      price: 0,
      interval: 'free',
      features: [
        'Free DoctaRx Nigeria patient account',
        'Book and pay per consultation',
        'Medication search and pharmacy request tracking',
        'Prescription and care record access',
        'Organisation coverage when assigned',
      ],
      consultations: 0,
      cta: 'Book Consultation',
      highlight: true,
    },
  ],
  organization: [
    {
      id: 'starter',
      name: 'Starter',
      price: 40000,
      interval: 'month',
      members: 25,
      perMember: null,
      features: [
        'Up to 25 members',
        'Organization admin dashboard',
        'Member management',
        'Basic health access',
        'Usage summaries',
        'Billing management',
      ],
      highlight: false,
    },
    {
      id: 'growth',
      name: 'Growth',
      price: 120000,
      interval: 'month',
      members: 100,
      perMember: null,
      features: [
        'Up to 100 members',
        'Full organization dashboard',
        'Bulk member upload (CSV)',
        'Role management',
        'Care access groups',
        'Priority doctor access (+₦500/member)',
        'Invoice generation',
      ],
      highlight: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: null,
      interval: 'month',
      members: null,
      perMember: null,
      features: [
        'Unlimited members',
        'Custom pricing & contracts',
        'Dedicated account manager',
        'Custom SLA',
        'AI health analytics dashboard',
        'On-site health campaigns',
        'Annual billing option',
        'HMO/NHIA compatibility',
      ],
      highlight: false,
    },
  ],
  provider: [
    {
      id: 'provider_basic',
      name: 'Provider Basic',
      price: 10000,
      interval: 'month',
      features: [
        'Provider dashboard access',
        'Appointment management',
        'Digital prescription writing',
        'Patient records access',
        'Basic earnings tracking',
      ],
    },
    {
      id: 'provider_pro',
      name: 'Provider Pro',
      price: 30000,
      interval: 'month',
      features: [
        'Everything in Basic',
        'Featured provider listing',
        'Priority patient routing',
        'Advanced analytics',
        'Commission: 10% (reduced)',
        'AI clinical notes assistance',
        'Payout within T+1',
      ],
    },
  ],
  pharmacy: [
    {
      id: 'pharmacy_starter',
      name: 'Pharmacy Starter',
      price: 10000,
      interval: 'month',
      features: [
        'Pharmacy dashboard',
        'Prescription queue',
        'Basic inventory management',
        'Bank settlement (T+5)',
        'Up to 50 orders/month',
      ],
    },
    {
      id: 'pharmacy_growth',
      name: 'Pharmacy Growth',
      price: 30000,
      interval: 'month',
      features: [
        'Everything in Starter',
        'Unlimited orders',
        'WhatsApp dispense flow (when available)',
        'Featured placement',
        'Advanced analytics',
        'Settlement T+3',
        'Delivery partner integration',
      ],
    },
    {
      id: 'pharmacy_enterprise',
      name: 'Pharmacy Enterprise',
      price: 50000,
      interval: 'month',
      features: [
        'Everything in Growth',
        'API access',
        'Custom sub-accounts',
        'Settlement T+1',
        'Priority support',
        'Branded patient notifications',
        'Bulk dispensing tools',
      ],
    },
  ],
};

export const CONSULT_PRICES = {
  general: { min: 2000, max: 5000, label: 'General Consultation' },
  specialist: { min: 5000, max: 15000, label: 'Specialist Consultation' },
};

export const formatNaira = (amount) => {
  if (amount == null) return 'Custom';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export const formatPhone = (phone) => {
  const cleaned = phone?.replace(/\D/g, '') || '';
  if (cleaned.startsWith('234')) return '+' + cleaned;
  if (cleaned.startsWith('0')) return '+234' + cleaned.slice(1);
  return '+234' + cleaned;
};

export const NG_ROLE_LABELS = {
  patient: 'Patient',
  provider: 'Healthcare Provider',
  pharmacy: 'Pharmacy',
  organization: 'Organisation',
  hospital: 'Hospital / Clinic',
  admin: 'Administrator',
};
