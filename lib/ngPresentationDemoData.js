const DEMO_PATIENT_ID = 'FCTA-DEMO-001';

export const PRESENTATION_DEMO_LABEL = 'Fictional Data for Presentation';

export function isPresentationDemoUser(user = {}) {
  const fields = [
    user?.email,
    user?.name,
    user?.first_name,
    user?.firstName,
    user?.last_name,
    user?.lastName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return fields.includes('.demo.') || fields.includes(' demo') || fields.includes('doctarx demo');
}

export function shouldShowPresentationDemoData(user = {}) {
  if (isPresentationDemoUser(user)) return true;

  if (typeof window === 'undefined') return false;

  return window.localStorage?.getItem('DOCTARX_PRESENTATION_DEMO') === 'true';
}

function inMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function buildPatientPortalDemoData() {
  return {
    appointments: [
      {
        id: 'DEMO-APT-1001',
        providerFirstName: 'Grace',
        providerLastName: 'Okafor',
        providerSpecialty: 'Family Medicine',
        scheduledAt: inMinutes(45),
        type: 'video',
        status: 'scheduled',
      },
      {
        id: 'DEMO-APT-1002',
        providerFirstName: 'Musa',
        providerLastName: 'Ibrahim',
        providerSpecialty: 'Cardiology Referral',
        scheduledAt: inMinutes(24 * 60 + 30),
        type: 'video',
        status: 'confirmed',
      },
    ],
    prescriptions: [
      {
        id: 'DEMO-RX-401',
        prescriber_name: 'Dr. Grace Okafor',
        created_at: daysAgo(1),
        status: 'provider reviewed',
        medication: 'Amlodipine 5mg',
      },
      {
        id: 'DEMO-RX-402',
        prescriber_name: 'Dr. Musa Ibrahim',
        created_at: daysAgo(4),
        status: 'routed to pharmacy',
        medication: 'Paracetamol 500mg',
      },
    ],
    orders: [
      {
        id: 'DEMO-ORD-701',
        order_number: 'FCTA-DEMO-ORD-701',
        pharmacy_name: 'Garki Community Pharmacy',
        status: 'preparing',
        payment_status: 'completed',
        total_amount: 18500,
        delivery_tracking_id: 'FCTA-DEMO-TRACK-701',
        items: [
          { drug_name: 'Amlodipine 5mg', quantity: 1, total_price: 6200 },
          { drug_name: 'Paracetamol 500mg', quantity: 2, total_price: 3600 },
          { drug_name: 'Oral Rehydration Salts', quantity: 3, total_price: 8700 },
        ],
      },
      {
        id: 'DEMO-ORD-702',
        order_number: 'FCTA-DEMO-ORD-702',
        pharmacy_name: 'Maitama HealthPlus Pharmacy',
        status: 'delivered',
        payment_status: 'completed',
        total_amount: 9300,
        delivery_tracking_id: 'FCTA-DEMO-TRACK-702',
        items: [
          { drug_name: 'Prenatal Vitamins', quantity: 1, total_price: 9300 },
        ],
      },
    ],
    conversations: [
      { id: 'DEMO-CONV-1', unreadCount: 2, subject: 'Care coordination follow-up' },
      { id: 'DEMO-CONV-2', unreadCount: 1, subject: 'Pharmacy delivery update' },
    ],
    documents: [
      {
        id: 'DEMO-DOC-1',
        title: 'FCTA pilot intake summary',
        recordType: 'Care plan',
        content: 'Synthetic patient profile: hypertension review, medication reconciliation, and pharmacy routing plan.',
      },
      {
        id: 'DEMO-DOC-2',
        title: 'Vitals and triage note',
        recordType: 'Clinical note',
        content: 'Blood pressure 138/88, pulse 78, symptoms stable. Follow-up booked with cardiology referral pathway.',
      },
    ],
    visits: [
      {
        id: 'DEMO-VISIT-1',
        reasonForVisit: 'Hypertension follow-up and medication review',
        scheduledAt: daysAgo(2),
        providerFirstName: 'Grace',
        providerLastName: 'Okafor',
      },
      {
        id: 'DEMO-VISIT-2',
        reasonForVisit: 'Pharmacy adherence check',
        scheduledAt: daysAgo(8),
        providerFirstName: 'Musa',
        providerLastName: 'Ibrahim',
      },
    ],
  };
}

export function buildProviderDemoData() {
  return {
    activePrescriptionCount: 6,
    patients: [
      {
        id: DEMO_PATIENT_ID,
        name: 'Amina Yusuf',
        age: 42,
        gender: 'F',
        risk: 64,
        diagnosis: 'Hypertension follow-up',
        lastVisit: 'Today',
        status: 'Monitoring',
        nextAction: 'Video review in 45 minutes',
        avatar: 'AY',
        currentAppointmentId: 'DEMO-APT-1001',
        email: 'amina.demo@example.com',
        phone: '+234 800 000 1001',
      },
      {
        id: 'FCTA-DEMO-002',
        name: 'Chinedu Okoro',
        age: 35,
        gender: 'M',
        risk: 38,
        diagnosis: 'Malaria symptom review',
        lastVisit: 'Yesterday',
        status: 'Stable',
        nextAction: 'Lab result follow-up',
        avatar: 'CO',
        currentAppointmentId: 'DEMO-APT-1003',
        email: 'chinedu.demo@example.com',
        phone: '+234 800 000 1002',
      },
      {
        id: 'FCTA-DEMO-003',
        name: 'Hauwa Bello',
        age: 29,
        gender: 'F',
        risk: 72,
        diagnosis: 'Antenatal triage referral',
        lastVisit: '2 days ago',
        status: 'Monitoring',
        nextAction: 'Referral confirmation',
        avatar: 'HB',
        currentAppointmentId: 'DEMO-APT-1004',
        email: 'hauwa.demo@example.com',
        phone: '+234 800 000 1003',
      },
      {
        id: 'FCTA-DEMO-004',
        name: 'Ifeoma Nwosu',
        age: 51,
        gender: 'F',
        risk: 81,
        diagnosis: 'Diabetes medication adherence',
        lastVisit: '3 days ago',
        status: 'Critical',
        nextAction: 'Provider escalation',
        avatar: 'IN',
        currentAppointmentId: 'DEMO-APT-1005',
        email: 'ifeoma.demo@example.com',
        phone: '+234 800 000 1004',
      },
    ],
    appointments: [
      {
        id: 'DEMO-APT-1001',
        patient_name: 'Amina Yusuf',
        patient_email: 'amina.demo@example.com',
        scheduled_at: inMinutes(45),
        appointment_type: 'video',
        status: 'scheduled',
        reason_for_visit: 'Hypertension medication review',
      },
      {
        id: 'DEMO-APT-1003',
        patient_name: 'Chinedu Okoro',
        patient_email: 'chinedu.demo@example.com',
        scheduled_at: inMinutes(120),
        appointment_type: 'video',
        status: 'confirmed',
        reason_for_visit: 'Malaria symptom review',
      },
      {
        id: 'DEMO-APT-1004',
        patient_name: 'Hauwa Bello',
        patient_email: 'hauwa.demo@example.com',
        scheduled_at: daysAgo(0),
        appointment_type: 'telehealth',
        status: 'completed',
        reason_for_visit: 'Antenatal triage referral',
      },
    ],
    pharmacies: [
      {
        id: 'DEMO-PHARM-901',
        name: 'Garki Community Pharmacy',
        city: 'Abuja',
        state: 'FCT',
      },
      {
        id: 'DEMO-PHARM-902',
        name: 'Maitama HealthPlus Pharmacy',
        city: 'Abuja',
        state: 'FCT',
      },
    ],
    prescriptions: [
      {
        id: 'DEMO-PROV-RX-601',
        prescription_number: 'FCTA-DEMO-RX-601',
        patient_first_name: 'Amina',
        patient_last_name: 'Yusuf',
        patient_email: 'amina.demo@example.com',
        pharmacy_name: 'Garki Community Pharmacy',
        pharmacy_response_status: 'accepted',
        dispense_status: 'preparing',
        status: 'routed',
      },
      {
        id: 'DEMO-PROV-RX-602',
        prescription_number: 'FCTA-DEMO-RX-602',
        patient_first_name: 'Chinedu',
        patient_last_name: 'Okoro',
        patient_email: 'chinedu.demo@example.com',
        pharmacy_name: 'Maitama HealthPlus Pharmacy',
        pharmacy_response_status: 'pending confirmation',
        dispense_status: 'pending',
        status: 'sent',
      },
    ],
    referrals: [
      {
        id: 'DEMO-REF-301',
        patient_first_name: 'Hauwa',
        patient_last_name: 'Bello',
        target_name: 'Maitama General Hospital antenatal clinic',
        referral_type: 'hospital',
        priority: 'urgent',
        status: 'accepted',
        reason: 'Elevated blood pressure during antenatal triage; specialist review requested.',
      },
      {
        id: 'DEMO-REF-302',
        patient_first_name: 'Amina',
        patient_last_name: 'Yusuf',
        target_name: 'Cardiology desk, FCTA pilot hub',
        referral_type: 'specialist',
        priority: 'routine',
        status: 'sent',
        reason: 'Hypertension medication review after pharmacy fulfillment.',
      },
    ],
  };
}
