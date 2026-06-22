/*
 * DoctaRx Abuja Pilot — Presentation Demo Data
 * -------------------------------------------------------------
 * SYNTHETIC / FICTIONAL DATA FOR PRESENTATION PURPOSES ONLY.
 * No real patient data. No real medical records. No real diagnosis.
 * All names, facilities and figures are illustrative samples used
 * to show how the DoctaRx pilot dashboard would look when active.
 */
window.DOCTARX_DEMO = {
  label: 'Sample Pilot Data — Fictional Data for Presentation',

  // Headline pilot metrics (Demo Dashboard)
  metrics: {
    patientRequests: 128,
    completedConsultations: 86,
    videoConsultations: 42,
    referralsCreated: 34,
    referralsCompleted: 21,
    prescriptionsIssued: 52,
    followUpVisibility: 74, // %
    avgResponseTimeMinutes: 18,
    phcsRepresented: 5,
    reportingCompleteness: 91, // %
  },

  // Top symptom categories (aggregate, non-identifiable)
  symptomCategories: [
    { label: 'Fever', value: 31 },
    { label: 'Malaria-like symptoms', value: 27 },
    { label: 'Hypertension follow-up', value: 22 },
    { label: 'Maternal health inquiry', value: 16 },
    { label: 'Respiratory symptoms', value: 14 },
  ],

  // Facility activity by PHC / hospital
  facilities: [
    { name: 'Demo PHC Garki', type: 'PHC', requests: 38, consults: 27, referrals: 9, responseMin: 14 },
    { name: 'Demo PHC Wuse', type: 'PHC', requests: 31, consults: 22, referrals: 7, responseMin: 16 },
    { name: 'Demo PHC Lugbe', type: 'PHC', requests: 24, consults: 15, referrals: 6, responseMin: 21 },
    { name: 'Demo General Hospital Maitama', type: 'Hospital', requests: 21, consults: 14, referrals: 8, responseMin: 19 },
    { name: 'Demo General Hospital Asokoro', type: 'Hospital', requests: 14, consults: 8, referrals: 4, responseMin: 22 },
  ],

  // Forecasting / trend preview (6-month sample, rainy season uptick)
  forecast: {
    months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    feverMalaria: [12, 14, 19, 26, 33, 41],
    note: 'Sample trend: fever / malaria-like symptom volume rising into the rainy season. Forecasting support helps facilities and the Ministry plan stock and staffing ahead of demand.',
  },

  // Demo people (characters used across the demo + video)
  actors: [
    { name: 'Amina Yusuf', role: 'Patient', detail: 'Hypertension follow-up' },
    { name: 'Nurse Grace', role: 'PHC officer', detail: 'Demo PHC Garki — intake & assist' },
    { name: 'Dr. Musa Ibrahim', role: 'Remote doctor', detail: 'Family medicine, video consult' },
    { name: 'Pharmacist Ada', role: 'Pharmacy partner', detail: 'Prescription visibility' },
    { name: 'Mr. Bello', role: 'Referral officer', detail: 'Demo General Hospital Maitama' },
    { name: 'Ministry official', role: 'Oversight dashboard', detail: 'Aggregate pilot indicators' },
  ],

  // Demo consultations feed (includes video consultations)
  consultations: [
    { id: 'C-1042', patient: 'Amina Yusuf', facility: 'Demo PHC Garki', doctor: 'Dr. Musa Ibrahim', mode: 'Video', reason: 'Hypertension follow-up', status: 'Completed' },
    { id: 'C-1043', patient: 'Chinedu Okoro', facility: 'Demo PHC Wuse', doctor: 'Dr. Musa Ibrahim', mode: 'Video', reason: 'Malaria-like symptoms', status: 'Completed' },
    { id: 'C-1044', patient: 'Hauwa Bello', facility: 'Demo PHC Lugbe', doctor: 'Dr. Grace Okafor', mode: 'Assisted', reason: 'Maternal health inquiry', status: 'Referred' },
    { id: 'C-1045', patient: 'Ifeoma Nwosu', facility: 'Demo G.H. Maitama', doctor: 'Dr. Grace Okafor', mode: 'Video', reason: 'Respiratory symptoms', status: 'In review' },
    { id: 'C-1046', patient: 'Samuel Adeoye', facility: 'Demo PHC Garki', doctor: 'Dr. Musa Ibrahim', mode: 'Assisted', reason: 'Fever', status: 'Completed' },
  ],

  // Demo prescriptions (pharmacy visibility workflow)
  prescriptions: [
    { id: 'RX-401', patient: 'Amina Yusuf', medication: 'Amlodipine 5mg', pharmacy: 'Demo Garki Pharmacy', status: 'Dispensed' },
    { id: 'RX-402', patient: 'Samuel Adeoye', medication: 'Paracetamol 500mg + ORS', pharmacy: 'Demo Wuse Pharmacy', status: 'Received' },
    { id: 'RX-403', patient: 'Chinedu Okoro', medication: 'Artemether-Lumefantrine', pharmacy: 'Demo Lugbe Pharmacy', status: 'Pending' },
    { id: 'RX-404', patient: 'Ifeoma Nwosu', medication: 'Salbutamol inhaler', pharmacy: 'Demo Maitama Pharmacy', status: 'Follow-up required' },
  ],

  // Demo referrals (referral tracking workflow)
  referrals: [
    { id: 'REF-301', patient: 'Hauwa Bello', from: 'Demo PHC Lugbe', to: 'Demo G.H. Maitama (Antenatal)', priority: 'Urgent', status: 'Accepted' },
    { id: 'REF-302', patient: 'Amina Yusuf', from: 'Demo PHC Garki', to: 'Demo G.H. Maitama (Cardiology)', priority: 'Routine', status: 'Scheduled' },
    { id: 'REF-303', patient: 'Ifeoma Nwosu', from: 'Demo G.H. Maitama', to: 'Demo G.H. Asokoro (Pulmonology)', priority: 'Routine', status: 'Pending' },
    { id: 'REF-304', patient: 'Chinedu Okoro', from: 'Demo PHC Wuse', to: 'Demo G.H. Asokoro (Lab)', priority: 'Routine', status: 'Completed' },
  ],

  // DHIS2 / NHMIS reporting-readiness preview (aggregate, facility-level)
  reporting: [
    { indicator: 'OPD attendance (teleconsult-supported)', period: 'Month 1', value: 86, ready: true },
    { indicator: 'Referrals out / completed', period: 'Month 1', value: '34 / 21', ready: true },
    { indicator: 'Antenatal inquiries logged', period: 'Month 1', value: 16, ready: true },
    { indicator: 'Suspected malaria cases (symptom-based)', period: 'Month 1', value: 27, ready: true },
    { indicator: 'Medicine demand summary', period: 'Month 1', value: '52 Rx', ready: true },
  ],
};
