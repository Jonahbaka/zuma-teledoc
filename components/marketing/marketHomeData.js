import {
  Activity,
  Banknote,
  Building2,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  Lock,
  MapPin,
  Package,
  Phone,
  Pill,
  Search,
  ShieldCheck,
  Stethoscope,
  Truck,
  User,
  Video,
} from 'lucide-react';

export const MARKET_HOME_DATA = {
  US: {
    code: 'US',
    name: 'United States',
    showCountrySelector: false,
    otherMarket: {
      href: '/ng',
      label: 'Nigeria Experience',
    },
    banner: {
      emergencyNumber: '911',
      emergencyLabel: 'Medical emergency? Call',
      emergencyTail: 'or go to the nearest emergency room immediately.',
    },
    navLinks: [
      { label: 'Features', href: '#features' },
      { label: 'How It Works', href: '#workflow' },
      { label: 'Plans', href: '#pricing' },
      { label: 'Security', href: '#security' },
    ],
    loginItems: [
      {
        label: 'Patient Portal',
        description: 'Visits, messages, prescriptions',
        href: '/patient/login',
        icon: User,
        tone: 'blue',
      },
      {
        label: 'Provider Portal',
        description: 'Schedules, charting, follow-up care',
        href: '/provider/login',
        icon: Stethoscope,
        tone: 'emerald',
      },
      {
        label: 'Pharmacy Portal',
        description: 'Prescription fulfillment and updates',
        href: '/pharmacy/login',
        icon: Pill,
        tone: 'violet',
      },
    ],
    getStartedItems: [
      {
        label: 'Patient',
        description: 'Start virtual care',
        href: '/patient/register',
        icon: User,
        tone: 'blue',
      },
      {
        label: 'Provider',
        description: 'Join the clinical network',
        href: '/provider/register',
        icon: Stethoscope,
        tone: 'emerald',
      },
      {
        label: 'Pharmacy',
        description: 'Connect prescription workflows',
        href: '/pharmacy/register',
        icon: Pill,
        tone: 'violet',
      },
    ],
    hero: {
      badge: 'United States telehealth',
      title: 'Telehealth built for modern care teams.',
      highlight: 'Secure visits, connected records, and prescription routing.',
      description:
        'Book virtual consultations, keep insurance information ready, message your care team, and move from intake to follow-up inside one polished care experience.',
      primaryCta: {
        label: 'Start as Patient',
        href: '/patient/register',
      },
      secondaryCta: {
        label: 'Provider Access',
        href: '/provider/login',
      },
      tertiaryCta: {
        label: 'View Plans',
        href: '#pricing',
      },
      trustItems: [
        { icon: ShieldCheck, text: 'HIPAA-ready workflows' },
        { icon: Video, text: 'Secure video visits' },
        { icon: Pill, text: 'E-prescribing' },
        { icon: Building2, text: 'Pharmacy coordination' },
      ],
      visualTone: 'blue',
      visual: {
        title: 'Connected Care Workspace',
        subtitle: 'Intake, appointments, prescriptions, and follow-up in one premium view.',
        chips: ['Secure video', 'Insurance ready', 'Rx routing'],
        metric: {
          value: 'Clinical-grade flow',
          label: 'One interface for patient intake, visit readiness, and post-visit action.',
        },
        tiles: [
          {
            title: 'Visit queue',
            body: 'Upcoming visits, device checks, and triage signals stay visible before the session begins.',
            tone: 'blue',
          },
          {
            title: 'Coverage details',
            body: 'Insurance information and self-pay options are prepared before booking completes.',
            tone: 'emerald',
          },
          {
            title: 'Prescription routing',
            body: 'Medication orders move directly into pharmacy workflows after the visit is signed.',
            tone: 'violet',
          },
        ],
        railTitle: 'Workflow highlights',
        railSummary: 'Secure visits, insurance readiness, and prescription routing stay visible from a single care workspace.',
        railItems: [
          'Insurance details captured before booking',
          'Secure messaging for follow-up questions',
          'Care plans, prescriptions, and reminders synced after each visit',
        ],
      },
    },
    stats: [
      { icon: ShieldCheck, value: 'HIPAA-ready', label: 'encryption and access controls' },
      { icon: CreditCard, value: 'Insurance + self-pay', label: 'billing paths already built in' },
      { icon: Video, value: 'Virtual visits', label: 'video and messaging care workflows' },
      { icon: Pill, value: 'Rx connected', label: 'prescription handoff to pharmacies' },
    ],
    featureSection: {
      badge: 'Care Platform',
      title: 'A premium US care experience without market leakage.',
      subtitle:
        'The homepage stays focused on the US telehealth product: virtual care, billing readiness, and prescription coordination with clean, market-specific copy.',
    },
    features: [
      {
        icon: Video,
        tone: 'blue',
        preview: 'dashboard',
        title: 'Visit readiness',
        description: 'Patients move from intake to secure video visits with cleaner scheduling and pre-visit preparation.',
        points: ['Pre-visit status', 'Secure audio and video'],
      },
      {
        icon: ShieldCheck,
        tone: 'emerald',
        preview: 'shield',
        title: 'Protected communication',
        description: 'Messaging, notes, and follow-up actions are presented with a compliance-first trust layer.',
        points: ['Encrypted workflow', 'Audit-friendly surfaces'],
      },
      {
        icon: Building2,
        tone: 'violet',
        preview: 'network',
        title: 'Connected care ops',
        description: 'Pharmacy routing, team coordination, and post-visit orchestration stay inside one experience.',
        points: ['Prescription routing', 'Care handoff visibility'],
      },
      {
        icon: CreditCard,
        tone: 'amber',
        preview: 'wallet',
        previewLabels: ['Insurance', 'Card', 'Self-Pay', 'Plan'],
        title: 'Payment flexibility',
        description: 'Insurance and subscription workflows stay visible without pushing the wrong currency or wrong market copy.',
        points: ['Plan-aware entry', 'Self-pay supported'],
      },
    ],
    workflowSection: {
      title: 'How care moves through the product',
      subtitle: 'The desktop, tablet, and mobile layouts stay aligned, but each breakpoint gets deliberate structure instead of a stretched mobile view.',
    },
    workflowSteps: [
      {
        icon: User,
        title: 'Create your account',
        description: 'Start as a patient, provider, or pharmacy partner with role-specific onboarding paths.',
      },
      {
        icon: Calendar,
        title: 'Book or prepare care',
        description: 'Patients schedule care, providers review readiness, and the platform keeps intake details in view.',
      },
      {
        icon: Video,
        title: 'Join secure care delivery',
        description: 'Visits, messaging, and clinical follow-up happen inside the same protected workflow.',
      },
      {
        icon: Pill,
        title: 'Route next steps',
        description: 'Prescriptions, reminders, and fulfillment coordination continue after the visit without context switching.',
      },
    ],
    audienceSection: {
      id: 'network',
      badge: 'Audience Paths',
      title: 'Built for patients, providers, and fulfillment teams.',
      subtitle: 'Each role gets a clear entry point and a premium interface without confusing cross-market language.',
    },
    audienceCards: [
      {
        icon: User,
        tone: 'blue',
        title: 'Patients',
        description: 'Register, book care, manage prescriptions, and keep coverage details ready for future visits.',
        bullets: ['Patient-first primary CTA', 'Visits, messaging, and prescriptions in one place'],
        ctaLabel: 'Create Patient Account',
        ctaHref: '/patient/register',
      },
      {
        icon: Stethoscope,
        tone: 'emerald',
        title: 'Providers',
        description: 'Access schedules, clinical workflows, and secure telehealth tools inside the provider workspace.',
        bullets: ['Clinical workflow access', 'Visit and follow-up continuity'],
        ctaLabel: 'Provider Access',
        ctaHref: '/provider/login',
      },
      {
        icon: Pill,
        tone: 'violet',
        title: 'Pharmacies and operations',
        description: 'Prescription routing and fulfillment visibility remain connected to the rest of the care journey.',
        bullets: ['Prescription queue visibility', 'Operational handoff support'],
        ctaLabel: 'Pharmacy Portal',
        ctaHref: '/pharmacy/login',
      },
    ],
    pricingSection: {
      title: 'Membership options already present in the product',
      subtitle: 'US pricing stays in dollars only, and the section reflects existing subscription tiers instead of placeholder values.',
      note: 'Pay-per-visit and insurance-supported scheduling remain available in the booking flow.',
    },
    plans: [
      {
        eyebrow: 'Docta Basic',
        title: '$19.99',
        period: '/month',
        description: 'Essentials for ongoing care and messaging.',
        tone: 'blue',
        featured: false,
        features: [
          'Unlimited messaging with providers',
          '2 telehealth consultations per month',
          'Prescription access',
          'Health records access',
        ],
        ctaLabel: 'Choose Basic',
        ctaHref: '/patient/register',
      },
      {
        eyebrow: 'Docta Gold',
        title: '$39.99',
        period: '/month',
        description: 'Unlimited consultations with priority access.',
        tone: 'emerald',
        featured: true,
        features: [
          'Unlimited video consultations',
          'Prescription access',
          'Priority support',
          '24/7 urgent care access',
        ],
        ctaLabel: 'Choose Gold',
        ctaHref: '/patient/register',
      },
      {
        eyebrow: 'Docta Platinum',
        title: '$79.99',
        period: '/month',
        description: 'Premium care coordination for ongoing support.',
        tone: 'violet',
        featured: false,
        features: [
          'All Gold features',
          'Dedicated care coordinator',
          'Family coverage for up to 4 members',
          'Premium membership card',
        ],
        ctaLabel: 'Choose Platinum',
        ctaHref: '/patient/register',
      },
    ],
    securitySection: {
      badge: 'Clinical Trust Layer',
      title: 'Security, continuity, and clean operational boundaries stay visible.',
      description:
        'The US homepage speaks only to protected care delivery, secure communication, and e-prescribing with clear operational boundaries across the product.',
      bullets: [
        'Encrypted messaging and data handling',
        'Protected visit and care coordination flows',
        'Prescription handoff visibility',
        'Role-aware operational access',
      ],
    },
    cta: {
      title: 'Start care without the waiting room.',
      description:
        'Patients can register in minutes. Providers can move directly into the clinical workspace with the same premium interface language across desktop, tablet, and mobile.',
      primary: {
        label: 'Get Started',
        href: '/patient/register',
      },
      secondary: {
        label: 'Provider Portal',
        href: '/provider/login',
      },
    },
    footer: {
      description:
        'Modern virtual care, secure messaging, prescriptions, and pharmacy coordination for the US telehealth experience.',
      email: 'info@doctarx.com',
      homeHref: '/',
      columns: [
        {
          title: 'Patients',
          links: [
            { label: 'Book Consultation', href: '/patient/register' },
            { label: 'How It Works', href: '/#workflow' },
            { label: 'Plans', href: '/#pricing' },
            { label: 'Patient Login', href: '/patient/login' },
          ],
        },
        {
          title: 'Providers',
          links: [
            { label: 'Join as Provider', href: '/provider/register' },
            { label: 'Provider Login', href: '/provider/login' },
            { label: 'Security', href: '/hipaa' },
          ],
        },
        {
          title: 'Operations',
          links: [
            { label: 'Pharmacy Portal', href: '/pharmacy/login' },
            { label: 'Contact', href: '/contact' },
          ],
        },
        {
          title: 'Legal',
          links: [
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms', href: '/terms' },
            { label: 'Accessibility', href: '/accessibility' },
            { label: 'FAQ', href: '/faq' },
          ],
        },
      ],
      badges: [
        { icon: ShieldCheck, label: 'Secure workflows' },
        { icon: Lock, label: 'Encrypted messaging' },
        { icon: Pill, label: 'E-prescribing' },
      ],
      copyright: 'DoctaRx',
    },
  },
  NG: {
    code: 'NG',
    name: 'Nigeria',
    showCountrySelector: false,
    otherMarket: {
      href: '/',
      label: 'US Experience',
    },
    banner: {
      emergencyNumber: '112',
      emergencyLabel: 'Medical emergency? Call',
      emergencyTail: 'or go to the nearest hospital immediately.',
    },
    navLinks: [
      { label: 'Care', href: '#features' },
      { label: 'Workflow', href: '#workflow' },
      { label: 'Access & Payment', href: '#pricing' },
      { label: 'Trust', href: '#security' },
    ],
    loginItems: [
      {
        label: 'Patient Portal',
        description: 'Consultations, prescriptions, and orders',
        href: '/ng/auth/login',
        icon: User,
        tone: 'emerald',
      },
      {
        label: 'Provider Portal',
        description: 'Clinical workspace and video visits',
        href: '/ng/provider/login',
        icon: Stethoscope,
        tone: 'blue',
      },
      {
        label: 'Pharmacy Onboarding',
        description: 'Join the prescription network',
        href: '/ng/pharmacy/onboarding',
        icon: Pill,
        tone: 'violet',
      },
    ],
    getStartedItems: [
      {
        label: 'Create Account',
        description: 'Start online doctor care',
        href: '/ng/auth/register',
        icon: User,
        tone: 'emerald',
      },
      {
        label: 'Search Medicines',
        description: 'Compare trusted pharmacy options',
        href: '/ng/patient/search',
        tone: 'blue',
        icon: Search,
      },
      {
        label: 'Provider',
        description: 'Join the telehealth network',
        href: '/ng/provider/register',
        icon: Stethoscope,
        tone: 'slate',
      },
      {
        label: 'Register Pharmacy',
        description: 'Grow your pharmacy network reach',
        href: '/ng/pharmacy/onboarding',
        icon: Pill,
        tone: 'violet',
      },
    ],
    hero: {
      badge: 'Nigeria telehealth and pharmacy access',
      title: 'See a doctor, manage prescriptions, and fill medicines in one Nigeria-ready platform.',
      highlight: 'Online consultations and pharmacy access that feel local from the first tap.',
      description:
        'Book online doctor consultations, upload prescriptions, compare pharmacy availability, and pay with trusted local rails without switching apps.',
      primaryCta: {
        label: 'Create Patient Account',
        href: '/ng/auth/register',
      },
      secondaryCta: {
        label: 'Search Medicines',
        href: '/ng/patient/search',
      },
      tertiaryCta: {
        label: 'Join as Provider',
        href: '/ng/provider/register',
      },
      trustItems: [
        { icon: Video, text: 'Online doctor consults' },
        { icon: Package, text: 'Prescription upload' },
        { icon: CreditCard, text: 'Naira payment rails' },
        { icon: ShieldCheck, text: 'NDPA-aware workflow' },
      ],
      visualTone: 'emerald',
      visual: {
        title: 'Nigeria care journey',
        subtitle: 'Consultations, prescriptions, payment, and pharmacy handoff stay clear on every device.',
        chips: ['Online doctor', 'Prescription upload', 'Transfer, card, USSD'],
        metric: {
          value: 'Care that feels local',
          label: 'Doctor review, prescription handling, and medicine access stay connected inside one trusted flow.',
        },
        tiles: [
          {
            title: 'Doctor consultation',
            body: 'Patients can start with an online consultation before moving straight into prescriptions and follow-up.',
            tone: 'emerald',
          },
          {
            title: 'Prescription review',
            body: 'Upload a prescription once and keep provider review, pharmacy confirmation, and status updates in view.',
            tone: 'blue',
          },
          {
            title: 'Pickup or delivery',
            body: 'Partner pharmacies confirm availability, pricing, and fulfillment without sending patients into a generic checkout.',
            tone: 'violet',
          },
        ],
        railTitle: 'Care and pharmacy checkpoints',
        railSummary: 'The experience stays fast on mobile while still feeling clinical, premium, and unmistakably Nigerian.',
        railItems: [
          'Consultation and prescription review stay in one patient journey',
          'Partner pharmacies confirm availability before payment',
          'Pickup or delivery updates remain visible after checkout',
        ],
      },
    },
    stats: [
      { icon: Video, value: 'Doctor consults', label: 'start care from the same platform' },
      { icon: Search, value: 'Medicine search', label: 'check partner pharmacy availability' },
      { icon: CreditCard, value: 'Local payment', label: 'transfer, card, and USSD support' },
      { icon: Truck, value: 'Fulfillment updates', label: 'pickup or delivery stays visible' },
    ],
    featureSection: {
      badge: 'Regional Experience',
      title: 'A premium Nigeria experience built for real care delivery.',
      subtitle:
        'The product stays visually polished while speaking clearly to online doctor consultations, prescriptions, pharmacy confirmation, and local payment behavior.',
    },
    features: [
      {
        icon: Video,
        tone: 'emerald',
        preview: 'checkout',
        title: 'Online doctor consultations',
        description: 'Patients can begin with a consultation and move into prescription follow-up without leaving the Nigeria experience.',
        points: ['Provider-ready flow', 'Secure telehealth path'],
      },
      {
        icon: Package,
        tone: 'blue',
        preview: 'pharmacy',
        title: 'Prescription review and upload',
        description: 'Medication requests, uploaded prescriptions, and provider recommendations stay readable instead of becoming a wall of copy.',
        points: ['Upload once', 'Provider and pharmacy review'],
      },
      {
        icon: Building2,
        tone: 'violet',
        preview: 'delivery',
        title: 'Verified pharmacy coordination',
        description: 'Partner pharmacies confirm stock, substitutions, and pricing inside a workflow designed for Nigeria operations.',
        points: ['Availability checks', 'Trusted handoff'],
      },
      {
        icon: CreditCard,
        tone: 'amber',
        preview: 'wallet',
        previewLabels: ['Card', 'Transfer', 'USSD', 'Pickup'],
        title: 'Local payment rails',
        description: 'Payment language stays local, while pickup and delivery updates remain clear after checkout.',
        points: ['Transfer, card, and USSD', 'Pickup or delivery updates'],
      },
    ],
    workflowSection: {
      title: 'How care moves through DoctaRx Nigeria',
      subtitle: 'The path is simpler to scan: start care, confirm the prescription, pay locally, and keep fulfillment visible on mobile.',
    },
    workflowSteps: [
      {
        icon: Video,
        title: 'Start with care',
        description: 'Create an account, join an online consultation, or begin with a medicine search from the same homepage.',
      },
      {
        icon: Package,
        title: 'Share the prescription',
        description: 'Prescriptions, provider review, and medication requests stay connected instead of splitting across separate portals.',
      },
      {
        icon: Building2,
        title: 'Confirm the pharmacy',
        description: 'Partner pharmacies verify stock, pricing, and substitutions before the order moves forward.',
      },
      {
        icon: CreditCard,
        title: 'Pay and follow delivery',
        description: 'Transfer, card, and USSD checkout stays readable, with pickup or delivery status visible after payment.',
      },
    ],
    audienceSection: {
      id: 'network',
      badge: 'Nigeria Network',
      title: 'Built for patients, clinicians, and pharmacy teams.',
      subtitle: 'Each path feels local, trusted, and ready for real healthcare delivery.',
    },
    audienceCards: [
      {
        icon: User,
        tone: 'emerald',
        title: 'Patients',
        description: 'Start with an online doctor consultation, search medicines, upload prescriptions, and keep status updates visible in one account.',
        bullets: ['Consult, search, and upload', 'Track prescriptions and medicine access'],
        ctaLabel: 'Create Patient Account',
        ctaHref: '/ng/auth/register',
      },
      {
        icon: Pill,
        tone: 'violet',
        title: 'Pharmacies',
        description: 'Receive verified prescription demand, confirm stock, publish pricing, and manage fulfillment from a network built for Nigeria.',
        bullets: ['Availability and pricing', 'Pickup and delivery coordination'],
        ctaLabel: 'Register Pharmacy',
        ctaHref: '/ng/pharmacy/onboarding',
      },
      {
        icon: Stethoscope,
        tone: 'blue',
        title: 'Clinicians',
        description: 'Providers can review consultations, support prescription decisions, and stay connected to the pharmacy handoff without losing context.',
        bullets: ['Nigeria provider onboarding', 'Telehealth and prescription continuity'],
        ctaLabel: 'Join as Provider',
        ctaHref: '/ng/provider/register',
      },
    ],
    pricingSection: {
      mode: 'access',
      tabLabel: 'Access',
      title: 'How access and payment work in the Nigeria flow',
      subtitle:
        'Consultation fees, prescription pricing, and delivery charges are confirmed inside the real workflow. The homepage no longer publishes invented public package pricing.',
      note: 'Patients see confirmed pricing before checkout, while clinicians and pharmacies move through their existing live onboarding paths.',
      cards: [
        {
          eyebrow: 'Patient access',
          title: 'Create an account and start care',
          description: 'Register once, join an online consultation, and keep prescriptions and medicine requests in one patient journey.',
          tone: 'emerald',
          features: [
            'Online consultation entry',
            'Prescription and medicine follow-up in one account',
            'Mobile-first care flow',
          ],
          ctaLabel: 'Create Patient Account',
          ctaHref: '/ng/auth/register',
        },
        {
          eyebrow: 'Payment clarity',
          title: 'Review pricing before checkout',
          description: 'Medicine availability, substitutions, and payment options stay visible before the patient confirms the order.',
          tone: 'blue',
          features: [
            'Transfer, card, and USSD support',
            'Availability confirmed before payment',
            'Pickup or delivery updates after checkout',
          ],
          ctaLabel: 'Search Medicines',
          ctaHref: '/ng/patient/search',
        },
        {
          eyebrow: 'Partner network',
          title: 'Join the pharmacy network',
          description: 'Pharmacy partners receive prescription demand, publish pricing, and coordinate fulfillment in the existing Nigeria workflow.',
          tone: 'violet',
          features: [
            'Prescription intake and pricing',
            'Order readiness and fulfillment status',
            'Provider and patient handoff visibility',
          ],
          ctaLabel: 'Register Pharmacy',
          ctaHref: '/ng/pharmacy/onboarding',
        },
      ],
      sideTitle: 'What stays visible to patients',
      sideDescription: 'The commercial story is now about clarity, not made-up package math.',
      sideNotes: [
        'Consultation and prescription context stay connected',
        'Partner pharmacies confirm stock before payment',
        'Pickup or delivery status remains visible after checkout',
      ],
    },
    plans: [],
    securitySection: {
      badge: 'Compliance and Trust',
      title: 'Clinical trust and local payment clarity stay visible.',
      description:
        'DoctaRx Nigeria combines online consultations, prescription verification, NDPA-aware handling, and trusted pharmacy coordination without generic Western-only messaging.',
      bullets: [
        'NDPA-aware data handling',
        'Prescription verification and provider review',
        'Transfer, card, and USSD payment language',
        'Order and delivery status visibility',
      ],
    },
    cta: {
      title: 'Start care or medicine access without switching platforms.',
      description:
        'Patients can create an account, talk to a doctor, search medicines, and keep pharmacy follow-through visible in one premium Nigeria experience.',
      primary: {
        label: 'Create Patient Account',
        href: '/ng/auth/register',
      },
      secondary: {
        label: 'Search Medicines',
        href: '/ng/patient/search',
      },
    },
    footer: {
      description:
        'DoctaRx Nigeria connects online doctor care, prescriptions, pharmacy coordination, and medicine fulfillment in one trusted platform.',
      email: 'hello@doctarx.ng',
      homeHref: '/ng',
      columns: [
        {
          title: 'Patients',
          links: [
            { label: 'Create Account', href: '/ng/auth/register' },
            { label: 'Search Medicines', href: '/ng/patient/search' },
            { label: 'Sign In', href: '/ng/auth/login' },
          ],
        },
        {
          title: 'Pharmacies',
          links: [
            { label: 'Register Pharmacy', href: '/ng/pharmacy/onboarding' },
            { label: 'Network View', href: '/ng#network' },
            { label: 'Access & Payment', href: '/ng#pricing' },
          ],
        },
        {
          title: 'Compliance',
          links: [
            { label: 'Trust', href: '/ng#security' },
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms', href: '/terms' },
          ],
        },
        {
          title: 'Operations',
          links: [
            { label: 'Provider Login', href: '/ng/provider/login' },
            { label: 'Provider Registration', href: '/ng/provider/register' },
            { label: 'Contact', href: '/contact' },
            { label: 'US Experience', href: '/' },
          ],
        },
      ],
      badges: [
        { icon: ShieldCheck, label: 'Secure workflows' },
        { icon: CreditCard, label: 'Local payment rails' },
        { icon: Video, label: 'Online consultations' },
      ],
      copyright: 'DoctaRx Nigeria',
    },
  },
};
