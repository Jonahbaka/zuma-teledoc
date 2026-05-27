'use strict';

/**
 * lib/ng/soapTemplates.js
 * Nigerian clinical SOAP scaffolds — usable both client and server side.
 *
 * Each template is a JSON-safe object so it can be applied to a SOAP
 * composer state or returned by an API. Drug suggestions reference
 * generic names that resolve through the v2 medication search.
 *
 * Templates are *scaffolds*, not protocols. The doctor edits everything.
 * Drug suggestions are clinical convenience, not auto-prescriptions.
 */

const TEMPLATES = [
  // ─── MALARIA ──────────────────────────────────────────────────────────────
  {
    key: 'malaria_adult_uncomplicated',
    label: 'Adult uncomplicated malaria',
    chief_complaint: 'Fever, body aches, headache',
    age_group: 'adult',
    typical_setting: 'PHC / outpatient',
    subjective: {
      ask: [
        'Duration of fever?',
        'Pattern — continuous / intermittent / rigors?',
        'Recent travel within Nigeria or endemic area?',
        'Use of any antimalarials in the last 2 weeks?',
        'Other symptoms: headache, body pain, nausea, anorexia?',
        'Pregnancy status (if female of reproductive age)?',
      ],
      narrative: 'Patient presents with {duration}-day history of fever associated with rigors, headache, body aches and anorexia. No recent antimalarial use. No travel outside FCT.',
    },
    objective: {
      vitals: ['temp', 'pulse', 'bp', 'rr', 'spo2'],
      exam: [
        'General: febrile, no pallor / no jaundice',
        'CVS: normal heart sounds, no murmurs',
        'Resp: clear breath sounds bilaterally',
        'Abdomen: soft, no organomegaly',
        'CNS: alert, GCS 15',
      ],
    },
    assessment: {
      primary: 'Uncomplicated Plasmodium falciparum malaria (clinical)',
      icd10: 'B54',
      differentials: ['Typhoid fever', 'Viral URTI', 'UTI', 'Dengue (if rash)'],
    },
    plan: {
      investigations: ['mRDT for malaria', 'FBC if available', 'Urinalysis if UTI suspected'],
      medications: [
        { generic: 'artemether-lumefantrine', dose: '80/480 mg', frequency: 'BD x 3 days', notes: 'Take with fatty food. Coartem / Lonart / Amatem brands available.' },
        { generic: 'paracetamol',             dose: '1 g',        frequency: 'QDS PRN',     notes: 'Max 4 g/day' },
      ],
      patient_education: [
        'Complete the full antimalarial course even if you feel better',
        'Adequate hydration; small frequent meals',
        'Return if vomiting, altered consciousness, jaundice, or no improvement at 48h',
      ],
      follow_up: 'Review in 48–72 hours. Earlier if any danger signs.',
      referral: null,
    },
  },

  {
    key: 'malaria_pediatric',
    label: 'Pediatric malaria (≥5 kg)',
    chief_complaint: 'Fever in child',
    age_group: 'pediatric',
    typical_setting: 'PHC / outpatient',
    subjective: {
      ask: [
        'Age and weight of the child?',
        'Duration and pattern of fever?',
        'Feeding adequately? Vomiting? Diarrhea?',
        'Convulsions, altered consciousness, lethargy, inability to drink (DANGER signs)?',
        'Immunisation status up to date?',
        'Any recent antimalarial use?',
      ],
      narrative: 'Child aged {age}m / {weight}kg presented with {duration} of fever. Feeding {feeding_status}. No danger signs reported.',
    },
    objective: {
      vitals: ['weight', 'temp', 'pulse', 'rr', 'spo2'],
      exam: [
        'General: alert, active. No pallor / no jaundice / no dehydration',
        'Chest: clear, no respiratory distress',
        'Abdomen: soft, no hepatosplenomegaly',
        'CNS: appropriate tone, no neck stiffness',
      ],
    },
    assessment: {
      primary: 'Uncomplicated childhood malaria',
      icd10: 'B54',
      differentials: ['Otitis media', 'URTI', 'UTI', 'Septicemia (if unwell)'],
    },
    plan: {
      investigations: ['mRDT for malaria', 'FBC if pale'],
      medications: [
        { generic: 'artemether-lumefantrine', dose: 'weight-banded', frequency: 'BD x 3 days', notes: '5–14kg: 1 tab; 15–24kg: 2 tabs; 25–34kg: 3 tabs (per WHO)' },
        { generic: 'paracetamol',             dose: '15 mg/kg',      frequency: 'QDS PRN',     notes: 'syrup form for children' },
      ],
      patient_education: [
        'Encourage frequent breastfeeding / fluids',
        'Tepid sponging if temp > 38.5°C',
        'Return immediately if convulsions, inability to drink, persistent vomiting, lethargy, fast breathing',
      ],
      follow_up: 'Review at 48h; immediate review for danger signs.',
      referral: { specialty: 'pediatrics', urgency: 'routine', condition: 'severe malaria / unable to retain orals' },
    },
  },

  // ─── HYPERTENSION ─────────────────────────────────────────────────────────
  {
    key: 'hypertension_followup',
    label: 'Hypertension follow-up visit',
    chief_complaint: 'Routine hypertension review',
    age_group: 'adult',
    typical_setting: 'GP clinic',
    subjective: {
      ask: [
        'BP readings since last visit (home monitoring log)?',
        'Adherence to medications? Any missed doses?',
        'Side effects: dizziness, dry cough (ACE-I), ankle swelling (CCB)?',
        'Salt intake, alcohol use, physical activity?',
        'Symptoms of target-organ damage: chest pain, dyspnoea, headache, visual changes, weakness?',
      ],
      narrative: 'Known hypertensive on {current_meds} since {duration}. Average home BP {bp_log}. {adherence_status}. No new symptoms of TOD.',
    },
    objective: {
      vitals: ['bp_seated', 'bp_standing', 'pulse', 'weight', 'bmi'],
      exam: [
        'CVS: normal heart sounds, no murmurs. JVP not raised. No peripheral oedema.',
        'Fundoscopy: arteriovenous nicking grade {n}',
        'Abdomen: no bruits',
        'Neuro: no focal deficit',
      ],
    },
    assessment: {
      primary: 'Essential hypertension — {controlled|partially controlled|uncontrolled}',
      icd10: 'I10',
      differentials: ['Secondary HTN (if young/refractory)', 'White-coat HTN'],
    },
    plan: {
      investigations: ['U+E+Cr (annual)', 'Urinalysis (annual)', 'Fasting lipid (annual)', 'ECG if not done in last year'],
      medications: [
        { generic: 'amlodipine',  dose: '5–10 mg',  frequency: 'OD', notes: 'first-line CCB; ankle swelling possible' },
        { generic: 'losartan',    dose: '50 mg',    frequency: 'OD', notes: 'add if BP not at target on monotherapy' },
      ],
      patient_education: [
        'DASH-style diet, salt < 5 g/day',
        '30 min walking 5 days/week',
        'Weight reduction if BMI ≥ 25',
        'Avoid NSAIDs',
      ],
      follow_up: 'Review in 4 weeks (uncontrolled) or 3 months (controlled).',
      referral: { specialty: 'cardiology', urgency: 'routine', condition: 'BP > 160/100 despite 3-drug regimen, or any TOD' },
    },
  },

  // ─── ANTENATAL ───────────────────────────────────────────────────────────
  {
    key: 'antenatal_first_visit',
    label: 'Antenatal first booking visit',
    chief_complaint: 'Pregnancy registration',
    age_group: 'adult',
    typical_setting: 'PHC / maternity clinic',
    subjective: {
      ask: [
        'LMP and EDD?',
        'Parity (gravida/para/abortions/living)?',
        'Past obstetric history (mode of delivery, complications)?',
        'Past medical history: HTN, DM, sickle cell, asthma, epilepsy?',
        'Allergies and current medications?',
        'HIV / HBV / VDRL status if known?',
      ],
      narrative: 'G{gravida}P{para} at {ga_weeks} weeks by LMP. Booked for antenatal care. No bleeding, no leakage, fetal movements not yet appreciated / present.',
    },
    objective: {
      vitals: ['bp', 'weight', 'height', 'bmi'],
      exam: [
        'General: no pallor / no oedema',
        'Abdomen: fundal height {fh} cm; fetal heart {fhr} bpm by Doppler',
        'Pelvic: deferred',
      ],
    },
    assessment: {
      primary: 'Singleton pregnancy at {ga} weeks — booking visit',
      icd10: 'Z34.0',
      differentials: [],
    },
    plan: {
      investigations: ['FBC, GXM, blood group + Rh', 'HIV / HBsAg / VDRL', 'FBS', 'Urinalysis', 'Pelvic USS for dating'],
      medications: [
        { generic: 'folic acid',                dose: '5 mg',       frequency: 'OD',          notes: 'until 12 weeks' },
        { generic: 'ferrous sulfate',           dose: '200 mg',     frequency: 'BD',          notes: 'with vitamin C; start after first trimester nausea' },
        { generic: 'sulfadoxine-pyrimethamine', dose: '3 tabs',     frequency: 'one dose',    notes: 'IPTp from 13 weeks, monthly to 36 weeks' },
        { generic: 'calcium carbonate',         dose: '1 g',        frequency: 'OD',          notes: 'pre-eclampsia prophylaxis from 14 weeks' },
      ],
      patient_education: [
        'Insecticide-treated bed net every night',
        'Birth preparedness & danger signs (bleeding, severe headache, blurred vision, reduced fetal movement, leaking, persistent vomiting)',
        'Skilled birth attendance at delivery',
      ],
      follow_up: 'Antenatal review every 4 weeks until 28w, then 2-weekly to 36w, then weekly.',
      referral: null,
    },
  },

  // ─── DIABETES ────────────────────────────────────────────────────────────
  {
    key: 'diabetes_followup',
    label: 'Type 2 diabetes follow-up',
    chief_complaint: 'Routine diabetes review',
    age_group: 'adult',
    typical_setting: 'GP / endocrine clinic',
    subjective: {
      ask: [
        'Home blood-glucose log? FBS / random readings?',
        'Polyuria, polydipsia, weight change?',
        'Hypoglycaemia episodes? Any unawareness?',
        'Foot problems: numbness, ulcers, infections?',
        'Adherence and side effects of current medications?',
      ],
      narrative: 'Known T2DM on {current_meds}. Average FBS {fbs}, RBS {rbs}. {symptoms}.',
    },
    objective: {
      vitals: ['weight', 'bmi', 'bp', 'pulse'],
      exam: [
        'Feet: skin intact, distal pulses present, monofilament sensation intact',
        'Fundoscopy: no retinopathy / background retinopathy',
        'No ulcers, no infection',
      ],
    },
    assessment: {
      primary: 'Type 2 diabetes mellitus — {well controlled / suboptimal control}',
      icd10: 'E11.9',
      differentials: ['LADA if atypical', 'Steroid-induced hyperglycaemia'],
    },
    plan: {
      investigations: ['FBS', 'HbA1c (3-monthly)', 'U+E+Cr (annual)', 'Lipid (annual)', 'Spot urine ACR (annual)'],
      medications: [
        { generic: 'metformin', dose: '500–1000 mg', frequency: 'BD', notes: 'first-line; take with food' },
        { generic: 'amlodipine', dose: '5 mg', frequency: 'OD', notes: 'if HTN present (target BP < 130/80)' },
      ],
      patient_education: [
        'Carbohydrate-aware diet; avoid sugary drinks',
        'Daily foot inspection; well-fitting shoes',
        'Recognise and treat hypos (≥ 15 g rapid carb)',
        'Annual eye review',
      ],
      follow_up: 'Review in 3 months with HbA1c.',
      referral: { specialty: 'endocrinology', urgency: 'routine', condition: 'HbA1c > 9% despite 2-agent therapy, or insulin initiation' },
    },
  },

  // ─── URTI ────────────────────────────────────────────────────────────────
  {
    key: 'urti_adult',
    label: 'Adult URTI / common cold',
    chief_complaint: 'Sore throat, runny nose, cough',
    age_group: 'adult',
    typical_setting: 'GP clinic',
    subjective: {
      ask: [
        'Duration of symptoms?',
        'Fever? Rigors?',
        'Cough — dry / productive? Sputum colour?',
        'Sore throat severity? Difficulty swallowing?',
        'Sick contacts?',
      ],
      narrative: 'Patient presents with {duration}-day history of sore throat, rhinorrhoea and dry cough. No high fever, no difficulty breathing.',
    },
    objective: {
      vitals: ['temp', 'pulse', 'rr', 'spo2'],
      exam: [
        'ENT: erythematous pharynx, no tonsillar exudate, no cervical lymphadenopathy',
        'Chest: clear, no added sounds',
      ],
    },
    assessment: {
      primary: 'Viral upper respiratory tract infection',
      icd10: 'J06.9',
      differentials: ['Streptococcal pharyngitis (Centor ≥3)', 'Influenza', 'Early COVID-19'],
    },
    plan: {
      investigations: ['Usually none. Throat swab if Centor ≥ 3', 'COVID antigen if at-risk contact'],
      medications: [
        { generic: 'paracetamol', dose: '1 g',  frequency: 'QDS PRN', notes: 'analgesia + antipyretic' },
        { generic: 'ibuprofen',   dose: '400 mg', frequency: 'TDS PRN', notes: 'if no GI / cardiac contraindication; take with food' },
      ],
      patient_education: [
        'Rest, oral fluids, warm salt-water gargles',
        'No antibiotics — viral illness self-resolves in 7–10 days',
        'Return if difficulty breathing, persistent high fever > 3 days, or worsening at day 7',
      ],
      follow_up: 'PRN; safety-net advice given.',
      referral: null,
    },
  },

  // ─── DIARRHEA / ORS ──────────────────────────────────────────────────────
  {
    key: 'diarrhea_pediatric_ors',
    label: 'Pediatric acute diarrhea — ORS + Zinc',
    chief_complaint: 'Loose stools in a child',
    age_group: 'pediatric',
    typical_setting: 'PHC',
    subjective: {
      ask: [
        'Number of stools / day? Consistency? Blood / mucus?',
        'Vomiting frequency?',
        'Wet nappies / urine output (proxy for hydration)?',
        'Feeding — breast / formula / solids? Recent food exposure?',
        'Sunken eyes, lethargy, irritability?',
      ],
      narrative: 'Child {age}m presents with {duration} of {frequency} loose stools, {with/without} vomiting. Drinking {eagerly/poorly}.',
    },
    objective: {
      vitals: ['weight', 'temp', 'pulse', 'rr'],
      exam: [
        'Hydration: {no / some / severe} dehydration per WHO',
        'Skin pinch returns {immediately / slowly / very slowly}',
        'Eyes: normal / sunken',
        'Mucous membranes moist / dry',
        'Abdomen: soft, non-distended',
      ],
    },
    assessment: {
      primary: 'Acute gastroenteritis with {no/some/severe} dehydration',
      icd10: 'A09',
      differentials: ['Dysentery (if blood)', 'Cholera (if rice-water stool)', 'Surgical abdomen (if peritonism)'],
    },
    plan: {
      investigations: ['Usually clinical. Stool MCS if bloody/persistent; rotavirus antigen if available'],
      medications: [
        { generic: 'oral rehydration salts', dose: 'low-osmolarity', frequency: 'after each loose stool', notes: '<2y: 50–100 ml; 2–10y: 100–200 ml; ≥10y: ad lib' },
        { generic: 'zinc sulfate',           dose: '10 mg (<6m) / 20 mg (≥6m)', frequency: 'OD x 10–14 days', notes: 'reduces duration and recurrence' },
      ],
      patient_education: [
        'Continue breastfeeding / age-appropriate feeding',
        'Hand hygiene; safe water and food handling',
        'Return immediately if: blood in stool, repeated vomiting, sunken eyes, decreased urine output, lethargy',
      ],
      follow_up: 'Review in 24–48h or sooner with danger signs.',
      referral: { specialty: 'pediatrics', urgency: 'urgent', condition: 'severe dehydration, persistent vomiting, or inability to drink' },
    },
  },

  // ─── MENTAL HEALTH ───────────────────────────────────────────────────────
  {
    key: 'mental_health_intake',
    label: 'Mental health intake (anxiety / mood)',
    chief_complaint: 'Mood disturbance / low energy',
    age_group: 'adult',
    typical_setting: 'GP / mental-health clinic',
    subjective: {
      ask: [
        'How have you been feeling over the past two weeks?',
        'Sleep, appetite, energy, concentration?',
        'Any thoughts of self-harm or suicide? (must ask)',
        'Substance use: alcohol, cannabis, prescription medications?',
        'Stressors at home / work / school?',
        'Past psychiatric history, family history?',
      ],
      narrative: 'Patient describes {duration} of low mood with associated reduced energy, poor sleep and decreased interest. {No / passive / active} suicidal ideation. No prior psychiatric contact.',
    },
    objective: {
      vitals: ['bp', 'pulse'],
      exam: [
        'Mental status: kempt, cooperative; speech normal rate and tone; mood low, affect congruent; no psychotic features; insight + judgement preserved',
        'Risk assessment: low / moderate / high to self, others, property',
        'PHQ-9 = {score}; GAD-7 = {score}',
      ],
    },
    assessment: {
      primary: 'Moderate major depressive episode (provisional)',
      icd10: 'F32.1',
      differentials: ['Generalised anxiety disorder', 'Adjustment disorder', 'Hypothyroidism', 'Anaemia / chronic illness fatigue'],
    },
    plan: {
      investigations: ['FBC, TSH, FBS, U+E to exclude organic causes'],
      medications: [
        { generic: 'sertraline', dose: '50 mg', frequency: 'OD', notes: 'first-line SSRI; counsel re. 2-week delay to benefit and possible initial worsening' },
      ],
      patient_education: [
        'Psychoeducation: depression is treatable; recovery often takes weeks',
        'Sleep hygiene, daily structure, gentle exercise, social contact',
        'Safety plan — agreed contacts and crisis steps',
      ],
      follow_up: 'Review in 2 weeks; sooner if worsening or any self-harm thoughts.',
      referral: { specialty: 'mental_health', urgency: 'urgent', condition: 'active suicidal ideation, psychosis, or no improvement at 4–6 weeks' },
    },
  },
];

function listTemplates() {
  return TEMPLATES.map(t => ({
    key: t.key,
    label: t.label,
    chief_complaint: t.chief_complaint,
    age_group: t.age_group,
  }));
}

function getTemplate(key) {
  return TEMPLATES.find(t => t.key === key) || null;
}

function searchTemplates(q) {
  const needle = String(q || '').toLowerCase().trim();
  if (!needle) return listTemplates();
  return TEMPLATES
    .filter(t =>
      t.key.includes(needle) ||
      t.label.toLowerCase().includes(needle) ||
      t.chief_complaint.toLowerCase().includes(needle) ||
      t.assessment.primary.toLowerCase().includes(needle)
    )
    .map(t => ({ key: t.key, label: t.label, chief_complaint: t.chief_complaint, age_group: t.age_group }));
}

/**
 * Apply a template to an empty SOAP state, returning fresh editable text.
 * Caller is free to mutate before saving.
 */
function applyTemplate(t) {
  if (!t) return null;
  return {
    template_key: t.key,
    chief_complaint: t.chief_complaint,
    subjective: {
      narrative: t.subjective.narrative,
      questions: t.subjective.ask,
    },
    objective: {
      vitals: Object.fromEntries(t.objective.vitals.map(k => [k, ''])),
      exam_findings: t.objective.exam.join('\n'),
    },
    assessment: {
      primary_diagnosis: t.assessment.primary,
      icd10: t.assessment.icd10,
      differentials: t.assessment.differentials,
    },
    plan: {
      investigations: t.plan.investigations,
      medications: t.plan.medications,
      patient_education: t.plan.patient_education,
      follow_up: t.plan.follow_up,
      referral: t.plan.referral,
    },
  };
}

module.exports = {
  TEMPLATES,
  listTemplates,
  getTemplate,
  searchTemplates,
  applyTemplate,
};
