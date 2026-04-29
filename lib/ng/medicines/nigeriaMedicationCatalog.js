const SOURCE_LABEL = 'DoctaRx Nigeria Starter Medication Catalog';
const UNKNOWN_AVAILABILITY_MESSAGE = 'Availability will be confirmed by partner pharmacies.';
const UNKNOWN_PRICE_MESSAGE = 'Price will be confirmed by the selected pharmacy.';

const CATEGORY_DEFAULTS = {
  'Pain relief and fever': {
    commonUses: ['Fever', 'Headache', 'Body pain', 'Pain relief'],
    symptoms: ['fever', 'headache', 'pain', 'body pain'],
    imageKey: 'painFever',
  },
  Antibiotics: {
    commonUses: ['Bacterial infection support after clinician review'],
    symptoms: ['infection', 'wound infection', 'throat infection', 'urinary infection'],
    imageKey: 'antibiotics',
  },
  Antimalarials: {
    commonUses: ['Malaria treatment support after appropriate review'],
    symptoms: ['malaria', 'fever', 'chills', 'body pain'],
    imageKey: 'antimalarial',
  },
  'Blood pressure and cardiovascular': {
    commonUses: ['Blood pressure and heart medicine support'],
    symptoms: ['blood pressure', 'hypertension', 'heart', 'cholesterol'],
    imageKey: 'bloodPressure',
  },
  'Diabetes medications': {
    commonUses: ['Diabetes and blood sugar medicine support'],
    symptoms: ['diabetes', 'blood sugar', 'high sugar'],
    imageKey: 'diabetes',
  },
  'Allergy medications': {
    commonUses: ['Allergy symptom support'],
    symptoms: ['allergy', 'itching', 'sneezing', 'catarrh'],
    imageKey: 'allergy',
  },
  'Cough, cold, and respiratory': {
    commonUses: ['Cough, cold, breathing, and respiratory medicine support'],
    symptoms: ['cough', 'cold', 'catarrh', 'wheezing', 'asthma'],
    imageKey: 'coughRespiratory',
  },
  'Stomach, ulcer, and digestion': {
    commonUses: ['Ulcer, reflux, diarrhea, nausea, and digestion support'],
    symptoms: ['ulcer', 'stomach', 'heartburn', 'diarrhea', 'vomiting', 'nausea'],
    imageKey: 'ulcerStomach',
  },
  'Vitamins and supplements': {
    commonUses: ['Vitamins, minerals, and supplement support'],
    symptoms: ['vitamin', 'supplement', 'iron', 'zinc', 'weakness'],
    imageKey: 'vitamins',
  },
  "Women's health": {
    commonUses: ['Women’s health medicine support'],
    symptoms: ['period pain', 'vaginal infection', 'contraception', 'heavy bleeding'],
    imageKey: 'womensHealth',
  },
  'Pediatric common medications': {
    commonUses: ['Common children’s medicine support'],
    symptoms: ['child fever', 'children cough', 'baby medicine', 'pediatric'],
    imageKey: 'pediatric',
  },
  'Eye, ear, and ENT': {
    commonUses: ['Eye, ear, nose, and throat medicine support'],
    symptoms: ['eye', 'ear', 'sore throat', 'blocked ear', 'eye irritation'],
    imageKey: 'eyeEar',
  },
  'Skin and dermatology': {
    commonUses: ['Skin, rash, fungal, and wound medicine support'],
    symptoms: ['skin', 'rash', 'fungal', 'itching', 'eczema', 'acne'],
    imageKey: 'skin',
  },
  'Mental health and neurological common medicines': {
    commonUses: ['Neurology and mental health medicine support after clinician review'],
    symptoms: ['seizure', 'nerve pain', 'migraine', 'mental health', 'depression'],
    imageKey: 'neurology',
  },
  'Common hospital and clinic medications': {
    commonUses: ['Hospital and clinic medicine support'],
    symptoms: ['injection', 'iv fluid', 'clinic medicine', 'hospital medicine'],
    imageKey: 'hospitalClinic',
  },
};

const splitList = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
};

const slugify = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

function makeMedication(input) {
  const categoryDefaults = CATEGORY_DEFAULTS[input.category] || {};
  return {
    id: `starter-${slugify(input.medicationName)}`,
    medicationName: input.medicationName,
    genericName: input.genericName || input.medicationName,
    brandNames: splitList(input.brandNames),
    category: input.category,
    commonUses: [...(categoryDefaults.commonUses || []), ...splitList(input.commonUses)],
    symptoms: [...(categoryDefaults.symptoms || []), ...splitList(input.symptoms)],
    aliases: splitList(input.aliases),
    dosageForms: splitList(input.dosageForms),
    commonStrengths: splitList(input.commonStrengths),
    prescriptionRequired: Boolean(input.prescriptionRequired),
    requiresReview: Boolean(input.requiresReview),
    controlledOrSpecialHandling: Boolean(input.controlledOrSpecialHandling),
    sourceLabel: SOURCE_LABEL,
    availabilityStatus: 'requires_pharmacy_confirmation',
    pricingStatus: 'requires_pharmacy_confirmation',
    pharmacyConfirmationRequired: true,
    imageKey: input.imageKey || categoryDefaults.imageKey || 'hero',
  };
}

const starterMedicationInputs = [
  // Pain relief and fever
  { medicationName: 'Paracetamol', genericName: 'Paracetamol', category: 'Pain relief and fever', dosageForms: 'tablet|caplet|syrup|suppository', commonStrengths: '500 mg|120 mg/5 mL|125 mg/5 mL', aliases: 'acetaminophen|paracetemol|paracitamol|fever medicine', brandNames: 'Panadol|Emzor Paracetamol' },
  { medicationName: 'Paracetamol syrup', genericName: 'Paracetamol', category: 'Pain relief and fever', dosageForms: 'syrup', commonStrengths: '120 mg/5 mL|125 mg/5 mL|250 mg/5 mL', aliases: 'children paracetamol|baby paracetamol|fever syrup' },
  { medicationName: 'Ibuprofen', genericName: 'Ibuprofen', category: 'Pain relief and fever', dosageForms: 'tablet|capsule|suspension', commonStrengths: '200 mg|400 mg|100 mg/5 mL', aliases: 'ibuprufen|brufen|pain medicine', requiresReview: true },
  { medicationName: 'Ibuprofen suspension', genericName: 'Ibuprofen', category: 'Pain relief and fever', dosageForms: 'suspension', commonStrengths: '100 mg/5 mL', aliases: 'children ibuprofen|fever suspension', requiresReview: true },
  { medicationName: 'Diclofenac', genericName: 'Diclofenac', category: 'Pain relief and fever', dosageForms: 'tablet|gel|injection|suppository', commonStrengths: '25 mg|50 mg|75 mg/3 mL', aliases: 'diclofenac sodium|voltaren', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Diclofenac gel', genericName: 'Diclofenac', category: 'Pain relief and fever', dosageForms: 'gel', commonStrengths: '1% gel', aliases: 'pain gel|muscle pain gel', requiresReview: true },
  { medicationName: 'Naproxen', genericName: 'Naproxen', category: 'Pain relief and fever', dosageForms: 'tablet', commonStrengths: '250 mg|500 mg', aliases: 'naprosyn|period pain', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Aspirin', genericName: 'Acetylsalicylic acid', category: 'Pain relief and fever', dosageForms: 'tablet|dispersible tablet', commonStrengths: '75 mg|300 mg', aliases: 'asa|low dose aspirin|cardio aspirin', requiresReview: true },
  { medicationName: 'Mefenamic acid', genericName: 'Mefenamic acid', category: 'Pain relief and fever', dosageForms: 'tablet|capsule', commonStrengths: '250 mg|500 mg', aliases: 'period pain|menstrual pain', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Celecoxib', genericName: 'Celecoxib', category: 'Pain relief and fever', dosageForms: 'capsule', commonStrengths: '100 mg|200 mg', aliases: 'joint pain|arthritis pain', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Tramadol', genericName: 'Tramadol', category: 'Pain relief and fever', dosageForms: 'capsule|tablet|injection', commonStrengths: '50 mg|100 mg/2 mL', aliases: 'strong pain medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },

  // Antibiotics
  { medicationName: 'Amoxicillin', genericName: 'Amoxicillin', category: 'Antibiotics', dosageForms: 'capsule|tablet|suspension', commonStrengths: '250 mg|500 mg|125 mg/5 mL', aliases: 'amoxil|amoxycillin|amoxillin', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Amoxicillin/clavulanate', genericName: 'Amoxicillin + clavulanic acid', category: 'Antibiotics', dosageForms: 'tablet|suspension', commonStrengths: '625 mg|1 g|228.5 mg/5 mL', aliases: 'augmentin|co-amoxiclav|amoxiclav', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Azithromycin', genericName: 'Azithromycin', category: 'Antibiotics', dosageForms: 'tablet|capsule|suspension', commonStrengths: '250 mg|500 mg|200 mg/5 mL', aliases: 'zithromax|azithro|aztromycin', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Ciprofloxacin', genericName: 'Ciprofloxacin', category: 'Antibiotics', dosageForms: 'tablet|infusion|eye/ear drops', commonStrengths: '250 mg|500 mg|0.3% drops', aliases: 'cipro|ciprofloxacine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Cefuroxime', genericName: 'Cefuroxime', category: 'Antibiotics', dosageForms: 'tablet|suspension|injection', commonStrengths: '250 mg|500 mg|125 mg/5 mL', aliases: 'zinnat|cefuroxim', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Cefixime', genericName: 'Cefixime', category: 'Antibiotics', dosageForms: 'tablet|capsule|suspension', commonStrengths: '200 mg|400 mg|100 mg/5 mL', aliases: 'cefixim', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Doxycycline', genericName: 'Doxycycline', category: 'Antibiotics', dosageForms: 'capsule|tablet', commonStrengths: '100 mg', aliases: 'doxy|doxicycline', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Metronidazole', genericName: 'Metronidazole', category: 'Antibiotics', dosageForms: 'tablet|suspension|infusion|vaginal tablet', commonStrengths: '200 mg|400 mg|500 mg|125 mg/5 mL', aliases: 'flagyl|metronidazol|infection', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Erythromycin', genericName: 'Erythromycin', category: 'Antibiotics', dosageForms: 'tablet|suspension', commonStrengths: '250 mg|500 mg|125 mg/5 mL', aliases: 'erythro', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Clarithromycin', genericName: 'Clarithromycin', category: 'Antibiotics', dosageForms: 'tablet|suspension', commonStrengths: '250 mg|500 mg', aliases: 'clarithro', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Ceftriaxone', genericName: 'Ceftriaxone', category: 'Antibiotics', dosageForms: 'injection vial', commonStrengths: '500 mg|1 g', aliases: 'ceftriazone|rocephin', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Cephalexin', genericName: 'Cephalexin', category: 'Antibiotics', dosageForms: 'capsule|suspension', commonStrengths: '250 mg|500 mg|125 mg/5 mL', aliases: 'cefalexin', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Clindamycin', genericName: 'Clindamycin', category: 'Antibiotics', dosageForms: 'capsule|injection|gel', commonStrengths: '150 mg|300 mg|1% gel', aliases: 'clinda', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Nitrofurantoin', genericName: 'Nitrofurantoin', category: 'Antibiotics', dosageForms: 'capsule|tablet', commonStrengths: '50 mg|100 mg', aliases: 'uti medicine|urine infection', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Gentamicin', genericName: 'Gentamicin', category: 'Antibiotics', dosageForms: 'injection|eye drops', commonStrengths: '40 mg/mL|0.3% drops', aliases: 'gentamycin', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Fluconazole', genericName: 'Fluconazole', category: 'Antibiotics', dosageForms: 'capsule|suspension|infusion', commonStrengths: '50 mg|150 mg|200 mg', aliases: 'fungal infection|yeast infection|diflucan', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Griseofulvin', genericName: 'Griseofulvin', category: 'Antibiotics', dosageForms: 'tablet|suspension', commonStrengths: '125 mg|250 mg|500 mg', aliases: 'ringworm medicine|fungal medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Co-trimoxazole', genericName: 'Sulfamethoxazole + trimethoprim', category: 'Antibiotics', dosageForms: 'tablet|suspension', commonStrengths: '480 mg|960 mg|240 mg/5 mL', aliases: 'septrin|cotrimoxazole', prescriptionRequired: true, requiresReview: true },

  // Antimalarials
  { medicationName: 'Artemether/lumefantrine', genericName: 'Artemether + lumefantrine', category: 'Antimalarials', dosageForms: 'tablet|dispersible tablet|suspension', commonStrengths: '20/120 mg|40/240 mg|80/480 mg', aliases: 'coartem|lumartem|artemeter lumefantrine|malaria medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Artesunate/amodiaquine', genericName: 'Artesunate + amodiaquine', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '25/67.5 mg|50/135 mg|100/270 mg', aliases: 'asaq|malaria', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Dihydroartemisinin/piperaquine', genericName: 'Dihydroartemisinin + piperaquine', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '40/320 mg|20/160 mg', aliases: 'dha piperaquine|p-alaxin|malaria', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Quinine', genericName: 'Quinine', category: 'Antimalarials', dosageForms: 'tablet|injection', commonStrengths: '300 mg|600 mg/2 mL', aliases: 'quinine sulphate|severe malaria', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Sulfadoxine/pyrimethamine', genericName: 'Sulfadoxine + pyrimethamine', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '500/25 mg', aliases: 'sp|fansidar', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Artesunate injection', genericName: 'Artesunate', category: 'Antimalarials', dosageForms: 'injection vial', commonStrengths: '60 mg|120 mg', aliases: 'injectable artesunate|severe malaria', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Artesunate tablets', genericName: 'Artesunate', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '50 mg|100 mg', aliases: 'artesunate', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Amodiaquine', genericName: 'Amodiaquine', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '150 mg|200 mg', aliases: 'amodiaquin', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Chloroquine', genericName: 'Chloroquine', category: 'Antimalarials', dosageForms: 'tablet|syrup|injection', commonStrengths: '250 mg|50 mg/5 mL', aliases: 'chloroquin', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Primaquine', genericName: 'Primaquine', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '7.5 mg|15 mg', aliases: 'relapsing malaria', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Atovaquone/proguanil', genericName: 'Atovaquone + proguanil', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '250/100 mg|62.5/25 mg', aliases: 'malarone|malaria prevention', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Proguanil', genericName: 'Proguanil', category: 'Antimalarials', dosageForms: 'tablet', commonStrengths: '100 mg', aliases: 'paludrine|malaria prophylaxis', prescriptionRequired: true, requiresReview: true },

  // Cardiovascular
  { medicationName: 'Amlodipine', genericName: 'Amlodipine', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '5 mg|10 mg', aliases: 'amlodepine|blood pressure medicine|bp medicine', brandNames: 'Norvasc', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Losartan', genericName: 'Losartan', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '25 mg|50 mg|100 mg', aliases: 'losartan potassium|bp medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Lisinopril', genericName: 'Lisinopril', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '5 mg|10 mg|20 mg', aliases: 'lisinopril bp', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Enalapril', genericName: 'Enalapril', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '5 mg|10 mg|20 mg', aliases: 'enalapril maleate', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Hydrochlorothiazide', genericName: 'Hydrochlorothiazide', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '12.5 mg|25 mg|50 mg', aliases: 'hctz|water tablet', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Atenolol', genericName: 'Atenolol', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '25 mg|50 mg|100 mg', aliases: 'atenolol bp', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Bisoprolol', genericName: 'Bisoprolol', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '2.5 mg|5 mg|10 mg', aliases: 'bisoprolol fumarate', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Nifedipine', genericName: 'Nifedipine', category: 'Blood pressure and cardiovascular', dosageForms: 'capsule|modified release tablet', commonStrengths: '10 mg|20 mg|30 mg', aliases: 'nifecard|adalat', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Furosemide', genericName: 'Furosemide', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet|injection', commonStrengths: '20 mg|40 mg|10 mg/mL', aliases: 'frusemide|water tablet|lasix', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Atorvastatin', genericName: 'Atorvastatin', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '10 mg|20 mg|40 mg|80 mg', aliases: 'cholesterol medicine|lipitor', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Rosuvastatin', genericName: 'Rosuvastatin', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '5 mg|10 mg|20 mg|40 mg', aliases: 'cholesterol medicine|crestor', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Simvastatin', genericName: 'Simvastatin', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '10 mg|20 mg|40 mg', aliases: 'cholesterol medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Clopidogrel', genericName: 'Clopidogrel', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '75 mg', aliases: 'blood thinner|plavix', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Warfarin', genericName: 'Warfarin', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '1 mg|3 mg|5 mg', aliases: 'blood thinner', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Carvedilol', genericName: 'Carvedilol', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '3.125 mg|6.25 mg|12.5 mg|25 mg', aliases: 'heart failure medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Methyldopa', genericName: 'Methyldopa', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '250 mg|500 mg', aliases: 'pregnancy bp medicine|aldomet', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Spironolactone', genericName: 'Spironolactone', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '25 mg|50 mg|100 mg', aliases: 'water tablet|aldactone', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Valsartan', genericName: 'Valsartan', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '40 mg|80 mg|160 mg', aliases: 'bp medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Telmisartan', genericName: 'Telmisartan', category: 'Blood pressure and cardiovascular', dosageForms: 'tablet', commonStrengths: '40 mg|80 mg', aliases: 'bp medicine', prescriptionRequired: true, requiresReview: true },

  // Diabetes
  { medicationName: 'Metformin', genericName: 'Metformin', category: 'Diabetes medications', dosageForms: 'tablet|extended release tablet', commonStrengths: '500 mg|850 mg|1000 mg', aliases: 'glucophage|metfomin|blood sugar medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Glibenclamide', genericName: 'Glibenclamide', category: 'Diabetes medications', dosageForms: 'tablet', commonStrengths: '2.5 mg|5 mg', aliases: 'glyburide|blood sugar medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Gliclazide', genericName: 'Gliclazide', category: 'Diabetes medications', dosageForms: 'tablet|modified release tablet', commonStrengths: '30 mg MR|60 mg MR|80 mg', aliases: 'diamicron', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Glimepiride', genericName: 'Glimepiride', category: 'Diabetes medications', dosageForms: 'tablet', commonStrengths: '1 mg|2 mg|4 mg', aliases: 'amaryl', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Sitagliptin', genericName: 'Sitagliptin', category: 'Diabetes medications', dosageForms: 'tablet', commonStrengths: '25 mg|50 mg|100 mg', aliases: 'januvia', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Vildagliptin', genericName: 'Vildagliptin', category: 'Diabetes medications', dosageForms: 'tablet', commonStrengths: '50 mg', aliases: 'galvus', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Pioglitazone', genericName: 'Pioglitazone', category: 'Diabetes medications', dosageForms: 'tablet', commonStrengths: '15 mg|30 mg', aliases: 'actos', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Empagliflozin', genericName: 'Empagliflozin', category: 'Diabetes medications', dosageForms: 'tablet', commonStrengths: '10 mg|25 mg', aliases: 'jardiance', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Insulin regular', genericName: 'Human regular insulin', category: 'Diabetes medications', dosageForms: 'injection vial|cartridge', commonStrengths: '100 IU/mL', aliases: 'actrapid|short acting insulin', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Insulin glargine', genericName: 'Insulin glargine', category: 'Diabetes medications', dosageForms: 'injection pen|vial', commonStrengths: '100 IU/mL', aliases: 'lantus|long acting insulin', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Insulin NPH', genericName: 'Isophane insulin', category: 'Diabetes medications', dosageForms: 'injection vial|cartridge', commonStrengths: '100 IU/mL', aliases: 'intermediate insulin', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Insulin lispro', genericName: 'Insulin lispro', category: 'Diabetes medications', dosageForms: 'injection pen|vial', commonStrengths: '100 IU/mL', aliases: 'rapid insulin', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Metformin/sitagliptin', genericName: 'Metformin + sitagliptin', category: 'Diabetes medications', dosageForms: 'tablet', commonStrengths: '500/50 mg|1000/50 mg', aliases: 'janumet', prescriptionRequired: true, requiresReview: true },

  // Allergy
  { medicationName: 'Cetirizine', genericName: 'Cetirizine', category: 'Allergy medications', dosageForms: 'tablet|syrup|drops', commonStrengths: '10 mg|5 mg/5 mL', aliases: 'cetrizine|zyrtec|allergy medicine' },
  { medicationName: 'Loratadine', genericName: 'Loratadine', category: 'Allergy medications', dosageForms: 'tablet|syrup', commonStrengths: '10 mg|5 mg/5 mL', aliases: 'claritin|loratidine|allergy' },
  { medicationName: 'Fexofenadine', genericName: 'Fexofenadine', category: 'Allergy medications', dosageForms: 'tablet|suspension', commonStrengths: '60 mg|120 mg|180 mg', aliases: 'telfast|fexofenadin' },
  { medicationName: 'Chlorpheniramine', genericName: 'Chlorpheniramine', category: 'Allergy medications', dosageForms: 'tablet|syrup|injection', commonStrengths: '4 mg|2 mg/5 mL|10 mg/mL', aliases: 'piriton|chlorphenamine|allergy syrup', requiresReview: true },
  { medicationName: 'Promethazine', genericName: 'Promethazine', category: 'Allergy medications', dosageForms: 'tablet|syrup|injection', commonStrengths: '10 mg|25 mg|5 mg/5 mL', aliases: 'phenergan|prometazine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Desloratadine', genericName: 'Desloratadine', category: 'Allergy medications', dosageForms: 'tablet|syrup', commonStrengths: '5 mg|2.5 mg/5 mL', aliases: 'aerius' },
  { medicationName: 'Levocetirizine', genericName: 'Levocetirizine', category: 'Allergy medications', dosageForms: 'tablet|syrup', commonStrengths: '5 mg|2.5 mg/5 mL', aliases: 'xyzal|levo cetirizine' },
  { medicationName: 'Hydroxyzine', genericName: 'Hydroxyzine', category: 'Allergy medications', dosageForms: 'tablet|syrup', commonStrengths: '10 mg|25 mg|2 mg/mL', aliases: 'itching medicine', prescriptionRequired: true, requiresReview: true },

  // Respiratory
  { medicationName: 'Salbutamol inhaler', genericName: 'Salbutamol', category: 'Cough, cold, and respiratory', dosageForms: 'metered dose inhaler|nebule|syrup|tablet', commonStrengths: '100 mcg/dose|2 mg/5 mL|2.5 mg/2.5 mL', aliases: 'albuterol|ventolin|asthma inhaler|wheezing', prescriptionRequired: true, requiresReview: true, imageKey: 'asthma' },
  { medicationName: 'Beclomethasone inhaler', genericName: 'Beclomethasone', category: 'Cough, cold, and respiratory', dosageForms: 'inhaler', commonStrengths: '50 mcg|100 mcg|200 mcg', aliases: 'preventer inhaler', prescriptionRequired: true, requiresReview: true, imageKey: 'asthma' },
  { medicationName: 'Budesonide inhaler', genericName: 'Budesonide', category: 'Cough, cold, and respiratory', dosageForms: 'inhaler|nebule', commonStrengths: '100 mcg|200 mcg|0.5 mg/2 mL', aliases: 'pulmicort|preventer inhaler', prescriptionRequired: true, requiresReview: true, imageKey: 'asthma' },
  { medicationName: 'Montelukast', genericName: 'Montelukast', category: 'Cough, cold, and respiratory', dosageForms: 'tablet|chewable tablet|granules', commonStrengths: '4 mg|5 mg|10 mg', aliases: 'singulair|asthma allergy', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Guaifenesin', genericName: 'Guaifenesin', category: 'Cough, cold, and respiratory', dosageForms: 'syrup|tablet', commonStrengths: '100 mg/5 mL|200 mg', aliases: 'expectorant|cough syrup' },
  { medicationName: 'Dextromethorphan', genericName: 'Dextromethorphan', category: 'Cough, cold, and respiratory', dosageForms: 'syrup|lozenge|capsule', commonStrengths: '10 mg/5 mL|15 mg', aliases: 'dry cough syrup|dm cough', requiresReview: true },
  { medicationName: 'Menthol lozenges', genericName: 'Menthol', category: 'Cough, cold, and respiratory', dosageForms: 'lozenge', commonStrengths: 'varies', aliases: 'throat lozenge|sore throat sweet' },
  { medicationName: 'Bromhexine', genericName: 'Bromhexine', category: 'Cough, cold, and respiratory', dosageForms: 'tablet|syrup', commonStrengths: '8 mg|4 mg/5 mL', aliases: 'mucolytic|chesty cough' },
  { medicationName: 'Ambroxol', genericName: 'Ambroxol', category: 'Cough, cold, and respiratory', dosageForms: 'tablet|syrup', commonStrengths: '30 mg|15 mg/5 mL', aliases: 'mucolytic|chesty cough' },
  { medicationName: 'Loratadine/pseudoephedrine', genericName: 'Loratadine + pseudoephedrine', category: 'Cough, cold, and respiratory', dosageForms: 'tablet', commonStrengths: '5/120 mg', aliases: 'cold allergy', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Fluticasone nasal spray', genericName: 'Fluticasone', category: 'Cough, cold, and respiratory', dosageForms: 'nasal spray', commonStrengths: '50 mcg/spray', aliases: 'allergic rhinitis|blocked nose', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Xylometazoline nasal drops', genericName: 'Xylometazoline', category: 'Cough, cold, and respiratory', dosageForms: 'nasal drops|nasal spray', commonStrengths: '0.05%|0.1%', aliases: 'blocked nose drops|nasal decongestant', requiresReview: true },
  { medicationName: 'Ipratropium bromide inhaler', genericName: 'Ipratropium', category: 'Cough, cold, and respiratory', dosageForms: 'inhaler|nebule', commonStrengths: '20 mcg/dose|250 mcg/mL', aliases: 'atrovent|breathing medicine', prescriptionRequired: true, requiresReview: true, imageKey: 'asthma' },
  { medicationName: 'Prednisolone', genericName: 'Prednisolone', category: 'Cough, cold, and respiratory', dosageForms: 'tablet|syrup', commonStrengths: '5 mg|25 mg|15 mg/5 mL', aliases: 'steroid|asthma flare medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },

  // Stomach and digestion
  { medicationName: 'Omeprazole', genericName: 'Omeprazole', category: 'Stomach, ulcer, and digestion', dosageForms: 'capsule|tablet', commonStrengths: '20 mg|40 mg', aliases: 'ulcer medicine|omeprazol|prilosec', requiresReview: true },
  { medicationName: 'Esomeprazole', genericName: 'Esomeprazole', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|capsule', commonStrengths: '20 mg|40 mg', aliases: 'nexium|ulcer medicine', requiresReview: true },
  { medicationName: 'Pantoprazole', genericName: 'Pantoprazole', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|injection', commonStrengths: '20 mg|40 mg', aliases: 'pantoprazol|ulcer medicine', requiresReview: true },
  { medicationName: 'Lansoprazole', genericName: 'Lansoprazole', category: 'Stomach, ulcer, and digestion', dosageForms: 'capsule|orodispersible tablet', commonStrengths: '15 mg|30 mg', aliases: 'ulcer medicine', requiresReview: true },
  { medicationName: 'Antacid suspension', genericName: 'Aluminium hydroxide + magnesium hydroxide', category: 'Stomach, ulcer, and digestion', dosageForms: 'suspension|chewable tablet', commonStrengths: 'varies', aliases: 'mist mag|heartburn|acid reflux|stomach upset' },
  { medicationName: 'Gaviscon-type alginate antacid', genericName: 'Sodium alginate + antacid', category: 'Stomach, ulcer, and digestion', dosageForms: 'suspension|sachet|tablet', commonStrengths: 'varies', aliases: 'reflux medicine|heartburn medicine' },
  { medicationName: 'Loperamide', genericName: 'Loperamide', category: 'Stomach, ulcer, and digestion', dosageForms: 'capsule|tablet', commonStrengths: '2 mg', aliases: 'imodium|diarrhea medicine', requiresReview: true },
  { medicationName: 'Oral rehydration salts', genericName: 'Oral rehydration salts', category: 'Stomach, ulcer, and digestion', dosageForms: 'sachet|solution', commonStrengths: 'WHO low-osmolarity ORS sachet', aliases: 'ors|rehydration salt|diarrhea' },
  { medicationName: 'Domperidone', genericName: 'Domperidone', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|suspension', commonStrengths: '10 mg|1 mg/mL', aliases: 'vomiting medicine|motilium', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Metoclopramide', genericName: 'Metoclopramide', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|syrup|injection', commonStrengths: '10 mg|5 mg/5 mL|5 mg/mL', aliases: 'maxolon|vomiting medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Hyoscine butylbromide', genericName: 'Hyoscine butylbromide', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|injection', commonStrengths: '10 mg|20 mg/mL', aliases: 'buscopan|stomach cramps', requiresReview: true },
  { medicationName: 'Activated charcoal', genericName: 'Activated charcoal', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|capsule|suspension', commonStrengths: '250 mg|500 mg', aliases: 'charcoal tablets|stomach gas', requiresReview: true },
  { medicationName: 'Bisacodyl', genericName: 'Bisacodyl', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|suppository', commonStrengths: '5 mg|10 mg', aliases: 'constipation medicine|dulcolax', requiresReview: true },
  { medicationName: 'Lactulose', genericName: 'Lactulose', category: 'Stomach, ulcer, and digestion', dosageForms: 'solution', commonStrengths: '3.35 g/5 mL', aliases: 'constipation syrup', requiresReview: true },
  { medicationName: 'Ranitidine', genericName: 'Ranitidine', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|injection', commonStrengths: '150 mg|300 mg|50 mg/2 mL', aliases: 'zantac|old ulcer medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Sucralfate', genericName: 'Sucralfate', category: 'Stomach, ulcer, and digestion', dosageForms: 'tablet|suspension', commonStrengths: '1 g|1 g/10 mL', aliases: 'ulcer coating medicine', prescriptionRequired: true, requiresReview: true },

  // Vitamins and supplements
  { medicationName: 'Folic acid', genericName: 'Folic acid', category: 'Vitamins and supplements', dosageForms: 'tablet', commonStrengths: '400 mcg|5 mg', aliases: 'folate|pregnancy vitamin|blood tonic' },
  { medicationName: 'Vitamin C', genericName: 'Ascorbic acid', category: 'Vitamins and supplements', dosageForms: 'tablet|chewable tablet|syrup', commonStrengths: '100 mg|500 mg|1000 mg', aliases: 'ascorbic acid|vit c' },
  { medicationName: 'Vitamin D3', genericName: 'Cholecalciferol', category: 'Vitamins and supplements', dosageForms: 'capsule|tablet|drops', commonStrengths: '1000 IU|2000 IU|50000 IU', aliases: 'vit d|cholecalciferol', requiresReview: true },
  { medicationName: 'Multivitamin', genericName: 'Multivitamin preparation', category: 'Vitamins and supplements', dosageForms: 'tablet|capsule|syrup|drops', commonStrengths: 'varies', aliases: 'multi vitamin|wellness supplement' },
  { medicationName: 'Ferrous sulfate', genericName: 'Ferrous sulfate', category: 'Vitamins and supplements', dosageForms: 'tablet|syrup', commonStrengths: '200 mg|125 mg/5 mL', aliases: 'iron tablet|blood tonic|anaemia', requiresReview: true },
  { medicationName: 'Ferrous fumarate', genericName: 'Ferrous fumarate', category: 'Vitamins and supplements', dosageForms: 'tablet|capsule|syrup', commonStrengths: '200 mg|305 mg', aliases: 'iron supplement|blood tonic', requiresReview: true },
  { medicationName: 'Zinc', genericName: 'Zinc sulfate', category: 'Vitamins and supplements', dosageForms: 'tablet|dispersible tablet|syrup', commonStrengths: '10 mg|20 mg', aliases: 'zinc tablet|diarrhea support' },
  { medicationName: 'Calcium', genericName: 'Calcium carbonate', category: 'Vitamins and supplements', dosageForms: 'tablet|chewable tablet|syrup', commonStrengths: '500 mg|600 mg', aliases: 'calcium supplement' },
  { medicationName: 'Magnesium', genericName: 'Magnesium supplement', category: 'Vitamins and supplements', dosageForms: 'tablet|capsule|sachet', commonStrengths: '250 mg|400 mg', aliases: 'magnesium supplement' },
  { medicationName: 'Omega-3', genericName: 'Omega-3 fatty acids', category: 'Vitamins and supplements', dosageForms: 'softgel capsule', commonStrengths: '500 mg|1000 mg', aliases: 'fish oil|omega three' },
  { medicationName: 'Vitamin B complex', genericName: 'Vitamin B complex', category: 'Vitamins and supplements', dosageForms: 'tablet|syrup|injection', commonStrengths: 'varies', aliases: 'b complex|neurovitamin', requiresReview: true },
  { medicationName: 'Pregnancy multivitamin', genericName: 'Prenatal multivitamin', category: 'Vitamins and supplements', dosageForms: 'tablet|capsule', commonStrengths: 'varies', aliases: 'prenatal vitamin|antenatal vitamin', requiresReview: true },
  { medicationName: 'Potassium chloride', genericName: 'Potassium chloride', category: 'Vitamins and supplements', dosageForms: 'tablet|syrup|injection', commonStrengths: '600 mg|10% syrup', aliases: 'potassium supplement', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Probiotic capsules', genericName: 'Probiotic preparation', category: 'Vitamins and supplements', dosageForms: 'capsule|sachet', commonStrengths: 'varies', aliases: 'probiotic|gut health supplement' },

  // Women's health
  { medicationName: 'Clotrimazole vaginal pessary', genericName: 'Clotrimazole', category: "Women's health", dosageForms: 'vaginal pessary|vaginal cream', commonStrengths: '100 mg|200 mg|500 mg|1% cream', aliases: 'yeast infection|vaginal thrush|canesten', requiresReview: true },
  { medicationName: 'Metronidazole vaginal tablet', genericName: 'Metronidazole', category: "Women's health", dosageForms: 'vaginal tablet|gel', commonStrengths: '500 mg|0.75% gel', aliases: 'vaginal infection|bv medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Combined oral contraceptive', genericName: 'Ethinylestradiol + progestin', category: "Women's health", dosageForms: 'tablet pack', commonStrengths: 'varies', aliases: 'family planning pills|contraceptive pills', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Levonorgestrel emergency contraception', genericName: 'Levonorgestrel', category: "Women's health", dosageForms: 'tablet', commonStrengths: '1.5 mg|0.75 mg', aliases: 'emergency pill|postinor|morning after pill', requiresReview: true },
  { medicationName: 'Tranexamic acid', genericName: 'Tranexamic acid', category: "Women's health", dosageForms: 'tablet|injection', commonStrengths: '500 mg|100 mg/mL', aliases: 'heavy period medicine|bleeding medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Mefenamic acid for period pain', genericName: 'Mefenamic acid', category: "Women's health", dosageForms: 'tablet|capsule', commonStrengths: '250 mg|500 mg', aliases: 'period pain|menstrual cramps', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Ferrous sulfate with folic acid', genericName: 'Iron + folic acid', category: "Women's health", dosageForms: 'tablet', commonStrengths: 'varies', aliases: 'antenatal iron|blood tonic pregnancy', requiresReview: true },
  { medicationName: 'Norethisterone', genericName: 'Norethisterone', category: "Women's health", dosageForms: 'tablet', commonStrengths: '5 mg', aliases: 'period delay|menstrual medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Misoprostol', genericName: 'Misoprostol', category: "Women's health", dosageForms: 'tablet', commonStrengths: '200 mcg', aliases: 'obstetric medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Methylergometrine', genericName: 'Methylergometrine', category: "Women's health", dosageForms: 'tablet|injection', commonStrengths: '125 mcg|200 mcg/mL', aliases: 'obstetric medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Clomifene', genericName: 'Clomifene citrate', category: "Women's health", dosageForms: 'tablet', commonStrengths: '50 mg', aliases: 'clomid|fertility medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Medroxyprogesterone injection', genericName: 'Medroxyprogesterone acetate', category: "Women's health", dosageForms: 'injection', commonStrengths: '150 mg/mL', aliases: 'depo injection|family planning injection', prescriptionRequired: true, requiresReview: true },

  // Pediatric
  { medicationName: 'Paracetamol pediatric drops', genericName: 'Paracetamol', category: 'Pediatric common medications', dosageForms: 'drops|syrup', commonStrengths: '100 mg/mL|120 mg/5 mL', aliases: 'baby fever drops|children fever medicine' },
  { medicationName: 'Ibuprofen pediatric suspension', genericName: 'Ibuprofen', category: 'Pediatric common medications', dosageForms: 'suspension', commonStrengths: '100 mg/5 mL', aliases: 'children fever suspension', requiresReview: true },
  { medicationName: 'Oral rehydration salts pediatric', genericName: 'Oral rehydration salts', category: 'Pediatric common medications', dosageForms: 'sachet|solution', commonStrengths: 'WHO low-osmolarity ORS sachet', aliases: 'children diarrhea|ors' },
  { medicationName: 'Zinc dispersible tablets', genericName: 'Zinc sulfate', category: 'Pediatric common medications', dosageForms: 'dispersible tablet|syrup', commonStrengths: '10 mg|20 mg', aliases: 'children zinc|diarrhea zinc' },
  { medicationName: 'Amoxicillin suspension', genericName: 'Amoxicillin', category: 'Pediatric common medications', dosageForms: 'suspension', commonStrengths: '125 mg/5 mL|250 mg/5 mL', aliases: 'children antibiotic', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Artemether/lumefantrine dispersible', genericName: 'Artemether + lumefantrine', category: 'Pediatric common medications', dosageForms: 'dispersible tablet|suspension', commonStrengths: '20/120 mg', aliases: 'children malaria medicine|coartem dispersible', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Cetirizine syrup', genericName: 'Cetirizine', category: 'Pediatric common medications', dosageForms: 'syrup|drops', commonStrengths: '5 mg/5 mL|1 mg/mL', aliases: 'children allergy syrup' },
  { medicationName: 'Salbutamol nebulizer solution', genericName: 'Salbutamol', category: 'Pediatric common medications', dosageForms: 'nebule|solution', commonStrengths: '2.5 mg/2.5 mL|5 mg/2.5 mL', aliases: 'children wheezing|nebulizer', prescriptionRequired: true, requiresReview: true, imageKey: 'asthma' },
  { medicationName: 'Chlorpheniramine syrup', genericName: 'Chlorpheniramine', category: 'Pediatric common medications', dosageForms: 'syrup', commonStrengths: '2 mg/5 mL', aliases: 'children allergy syrup|piriton syrup', requiresReview: true },
  { medicationName: 'Multivitamin pediatric syrup', genericName: 'Multivitamin preparation', category: 'Pediatric common medications', dosageForms: 'syrup|drops', commonStrengths: 'varies', aliases: 'children multivitamin' },
  { medicationName: 'Ferrous syrup pediatric', genericName: 'Iron preparation', category: 'Pediatric common medications', dosageForms: 'syrup|drops', commonStrengths: 'varies', aliases: 'children blood tonic|iron syrup', requiresReview: true },
  { medicationName: 'Nystatin oral suspension', genericName: 'Nystatin', category: 'Pediatric common medications', dosageForms: 'oral suspension|drops', commonStrengths: '100,000 IU/mL', aliases: 'oral thrush|mouth infection', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Albendazole suspension', genericName: 'Albendazole', category: 'Pediatric common medications', dosageForms: 'suspension|tablet', commonStrengths: '200 mg/5 mL|400 mg', aliases: 'worm medicine|deworming', requiresReview: true },

  // Eye, ear, and ENT
  { medicationName: 'Chloramphenicol eye drops', genericName: 'Chloramphenicol', category: 'Eye, ear, and ENT', dosageForms: 'eye drops|eye ointment', commonStrengths: '0.5% drops|1% ointment', aliases: 'eye infection drops', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Ciprofloxacin eye/ear drops', genericName: 'Ciprofloxacin', category: 'Eye, ear, and ENT', dosageForms: 'eye drops|ear drops', commonStrengths: '0.3%', aliases: 'cipro eye drops|ear infection drops', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Gentamicin eye drops', genericName: 'Gentamicin', category: 'Eye, ear, and ENT', dosageForms: 'eye drops', commonStrengths: '0.3%', aliases: 'gentamycin eye drops', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Artificial tears', genericName: 'Lubricating eye drops', category: 'Eye, ear, and ENT', dosageForms: 'eye drops|gel', commonStrengths: 'varies', aliases: 'dry eyes|lubricant eye drops' },
  { medicationName: 'Ear wax drops', genericName: 'Olive oil or carbamide peroxide ear drops', category: 'Eye, ear, and ENT', dosageForms: 'ear drops', commonStrengths: 'varies', aliases: 'ear wax|blocked ear drops', requiresReview: true },
  { medicationName: 'Ofloxacin eye drops', genericName: 'Ofloxacin', category: 'Eye, ear, and ENT', dosageForms: 'eye drops|ear drops', commonStrengths: '0.3%', aliases: 'ofloxacin drops', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Tobramycin eye drops', genericName: 'Tobramycin', category: 'Eye, ear, and ENT', dosageForms: 'eye drops', commonStrengths: '0.3%', aliases: 'tobrex', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Dexamethasone eye drops', genericName: 'Dexamethasone', category: 'Eye, ear, and ENT', dosageForms: 'eye drops', commonStrengths: '0.1%', aliases: 'steroid eye drops', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Oxymetazoline nasal spray', genericName: 'Oxymetazoline', category: 'Eye, ear, and ENT', dosageForms: 'nasal spray|drops', commonStrengths: '0.05%', aliases: 'blocked nose spray', requiresReview: true },
  { medicationName: 'Saline nasal drops', genericName: 'Sodium chloride nasal solution', category: 'Eye, ear, and ENT', dosageForms: 'nasal drops|spray', commonStrengths: '0.65%|0.9%', aliases: 'baby nasal drops|blocked nose' },
  { medicationName: 'Betahistine', genericName: 'Betahistine', category: 'Eye, ear, and ENT', dosageForms: 'tablet', commonStrengths: '8 mg|16 mg|24 mg', aliases: 'vertigo medicine|dizziness medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Lidocaine throat spray', genericName: 'Lidocaine', category: 'Eye, ear, and ENT', dosageForms: 'spray|lozenge', commonStrengths: 'varies', aliases: 'sore throat spray', requiresReview: true },
  { medicationName: 'Povidone iodine gargle', genericName: 'Povidone iodine', category: 'Eye, ear, and ENT', dosageForms: 'gargle|mouthwash', commonStrengths: '1%', aliases: 'sore throat gargle', requiresReview: true },
  { medicationName: 'Sodium bicarbonate ear drops', genericName: 'Sodium bicarbonate', category: 'Eye, ear, and ENT', dosageForms: 'ear drops', commonStrengths: '5%', aliases: 'ear wax softener', requiresReview: true },

  // Skin and dermatology
  { medicationName: 'Hydrocortisone cream', genericName: 'Hydrocortisone', category: 'Skin and dermatology', dosageForms: 'cream|ointment', commonStrengths: '1%', aliases: 'eczema cream|itching cream', requiresReview: true },
  { medicationName: 'Clotrimazole cream', genericName: 'Clotrimazole', category: 'Skin and dermatology', dosageForms: 'cream|solution', commonStrengths: '1%', aliases: 'fungal cream|ringworm cream|athlete foot', requiresReview: true },
  { medicationName: 'Ketoconazole cream', genericName: 'Ketoconazole', category: 'Skin and dermatology', dosageForms: 'cream', commonStrengths: '2%', aliases: 'fungal cream', requiresReview: true },
  { medicationName: 'Ketoconazole shampoo', genericName: 'Ketoconazole', category: 'Skin and dermatology', dosageForms: 'shampoo', commonStrengths: '2%', aliases: 'dandruff shampoo|fungal scalp', requiresReview: true },
  { medicationName: 'Mupirocin ointment', genericName: 'Mupirocin', category: 'Skin and dermatology', dosageForms: 'ointment|cream', commonStrengths: '2%', aliases: 'skin infection ointment', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Silver sulfadiazine cream', genericName: 'Silver sulfadiazine', category: 'Skin and dermatology', dosageForms: 'cream', commonStrengths: '1%', aliases: 'burn cream', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Benzoyl peroxide', genericName: 'Benzoyl peroxide', category: 'Skin and dermatology', dosageForms: 'gel|cream|wash', commonStrengths: '2.5%|5%|10%', aliases: 'acne medicine|acne gel', requiresReview: true },
  { medicationName: 'Permethrin cream', genericName: 'Permethrin', category: 'Skin and dermatology', dosageForms: 'cream|lotion', commonStrengths: '5%', aliases: 'scabies cream', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Acyclovir cream', genericName: 'Acyclovir', category: 'Skin and dermatology', dosageForms: 'cream|tablet', commonStrengths: '5% cream|200 mg tablet', aliases: 'cold sore cream|herpes medicine', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Calamine lotion', genericName: 'Calamine', category: 'Skin and dermatology', dosageForms: 'lotion', commonStrengths: 'varies', aliases: 'itching lotion|skin rash' },
  { medicationName: 'Betamethasone cream', genericName: 'Betamethasone', category: 'Skin and dermatology', dosageForms: 'cream|ointment', commonStrengths: '0.05%|0.1%', aliases: 'steroid cream', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Fusidic acid cream', genericName: 'Fusidic acid', category: 'Skin and dermatology', dosageForms: 'cream|ointment', commonStrengths: '2%', aliases: 'skin antibiotic cream', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Terbinafine cream', genericName: 'Terbinafine', category: 'Skin and dermatology', dosageForms: 'cream|tablet', commonStrengths: '1% cream|250 mg tablet', aliases: 'fungal medicine|lamisil', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Whitfield ointment', genericName: 'Benzoic acid + salicylic acid', category: 'Skin and dermatology', dosageForms: 'ointment', commonStrengths: 'varies', aliases: 'fungal ointment', requiresReview: true },
  { medicationName: 'Zinc oxide cream', genericName: 'Zinc oxide', category: 'Skin and dermatology', dosageForms: 'cream|ointment', commonStrengths: 'varies', aliases: 'diaper rash cream|barrier cream' },
  { medicationName: 'Povidone iodine solution', genericName: 'Povidone iodine', category: 'Skin and dermatology', dosageForms: 'solution|ointment', commonStrengths: '10%', aliases: 'wound antiseptic|betadine', requiresReview: true },

  // Mental health and neurological
  { medicationName: 'Amitriptyline', genericName: 'Amitriptyline', category: 'Mental health and neurological common medicines', dosageForms: 'tablet', commonStrengths: '10 mg|25 mg|50 mg', aliases: 'nerve pain medicine|migraine prevention', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Fluoxetine', genericName: 'Fluoxetine', category: 'Mental health and neurological common medicines', dosageForms: 'capsule|tablet', commonStrengths: '20 mg', aliases: 'prozac|depression medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Sertraline', genericName: 'Sertraline', category: 'Mental health and neurological common medicines', dosageForms: 'tablet', commonStrengths: '25 mg|50 mg|100 mg', aliases: 'zoloft|depression anxiety medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Carbamazepine', genericName: 'Carbamazepine', category: 'Mental health and neurological common medicines', dosageForms: 'tablet|syrup', commonStrengths: '100 mg|200 mg|400 mg|100 mg/5 mL', aliases: 'tegretol|seizure medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Sodium valproate', genericName: 'Sodium valproate', category: 'Mental health and neurological common medicines', dosageForms: 'tablet|syrup|chrono tablet', commonStrengths: '200 mg|500 mg|200 mg/5 mL', aliases: 'epilim|valproate|seizure medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Levetiracetam', genericName: 'Levetiracetam', category: 'Mental health and neurological common medicines', dosageForms: 'tablet|solution|injection', commonStrengths: '250 mg|500 mg|1000 mg|100 mg/mL', aliases: 'keppra|seizure medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Gabapentin', genericName: 'Gabapentin', category: 'Mental health and neurological common medicines', dosageForms: 'capsule|tablet', commonStrengths: '100 mg|300 mg|400 mg', aliases: 'nerve pain|neuropathy medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Pregabalin', genericName: 'Pregabalin', category: 'Mental health and neurological common medicines', dosageForms: 'capsule', commonStrengths: '25 mg|75 mg|150 mg', aliases: 'lyrica|nerve pain medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Topiramate', genericName: 'Topiramate', category: 'Mental health and neurological common medicines', dosageForms: 'tablet', commonStrengths: '25 mg|50 mg|100 mg', aliases: 'migraine prevention|seizure medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Risperidone', genericName: 'Risperidone', category: 'Mental health and neurological common medicines', dosageForms: 'tablet|solution', commonStrengths: '1 mg|2 mg|4 mg', aliases: 'mental health medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Olanzapine', genericName: 'Olanzapine', category: 'Mental health and neurological common medicines', dosageForms: 'tablet|orodispersible tablet', commonStrengths: '5 mg|10 mg', aliases: 'mental health medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Diazepam', genericName: 'Diazepam', category: 'Mental health and neurological common medicines', dosageForms: 'tablet|injection|rectal tube', commonStrengths: '2 mg|5 mg|10 mg|5 mg/mL', aliases: 'valium|seizure emergency medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Phenobarbital', genericName: 'Phenobarbital', category: 'Mental health and neurological common medicines', dosageForms: 'tablet|elixir|injection', commonStrengths: '30 mg|60 mg|15 mg/5 mL', aliases: 'phenobarbitone|seizure medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },

  // Hospital and clinic medicines
  { medicationName: 'Normal saline', genericName: 'Sodium chloride 0.9%', category: 'Common hospital and clinic medications', dosageForms: 'IV fluid bag|infusion bottle', commonStrengths: '0.9% 500 mL|0.9% 1 L', aliases: 'normal saline drip|iv fluid', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Dextrose saline', genericName: 'Dextrose + sodium chloride', category: 'Common hospital and clinic medications', dosageForms: 'IV fluid bag|infusion bottle', commonStrengths: '5% dextrose in saline 500 mL|1 L', aliases: 'dextrose saline drip|iv fluid', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Dextrose 5% infusion', genericName: 'Dextrose 5%', category: 'Common hospital and clinic medications', dosageForms: 'IV fluid bag|infusion bottle', commonStrengths: '5% 500 mL|5% 1 L', aliases: 'd5w|glucose drip', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Ringer lactate', genericName: 'Lactated Ringer solution', category: 'Common hospital and clinic medications', dosageForms: 'IV fluid bag|infusion bottle', commonStrengths: '500 mL|1 L', aliases: 'hartmann solution|iv fluid', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Ceftriaxone injection', genericName: 'Ceftriaxone', category: 'Common hospital and clinic medications', dosageForms: 'injection vial', commonStrengths: '500 mg|1 g', aliases: 'injectable antibiotic', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Gentamicin injection', genericName: 'Gentamicin', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule', commonStrengths: '40 mg/mL|80 mg/2 mL', aliases: 'injectable antibiotic', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Diclofenac injection', genericName: 'Diclofenac', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule', commonStrengths: '75 mg/3 mL', aliases: 'pain injection', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Vitamin B complex injection', genericName: 'Vitamin B complex', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule', commonStrengths: 'varies', aliases: 'b complex injection', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Hydrocortisone injection', genericName: 'Hydrocortisone sodium succinate', category: 'Common hospital and clinic medications', dosageForms: 'injection vial', commonStrengths: '100 mg|500 mg', aliases: 'steroid injection', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Adrenaline injection', genericName: 'Epinephrine', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule|auto-injector', commonStrengths: '1 mg/mL|1:1000', aliases: 'emergency injection|epinephrine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Atropine injection', genericName: 'Atropine', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule', commonStrengths: '0.6 mg/mL|1 mg/mL', aliases: 'emergency clinic medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Ondansetron injection', genericName: 'Ondansetron', category: 'Common hospital and clinic medications', dosageForms: 'injection|tablet', commonStrengths: '4 mg/2 mL|8 mg/4 mL|4 mg tablet', aliases: 'vomiting injection|zofran', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Magnesium sulfate injection', genericName: 'Magnesium sulfate', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule', commonStrengths: '50% w/v', aliases: 'obstetric emergency medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Oxytocin injection', genericName: 'Oxytocin', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule', commonStrengths: '5 IU/mL|10 IU/mL', aliases: 'obstetric medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Lidocaine injection', genericName: 'Lidocaine', category: 'Common hospital and clinic medications', dosageForms: 'injection vial', commonStrengths: '1%|2%', aliases: 'local anaesthetic|xylocaine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
  { medicationName: 'Water for injection', genericName: 'Sterile water for injection', category: 'Common hospital and clinic medications', dosageForms: 'ampoule|vial', commonStrengths: '5 mL|10 mL', aliases: 'diluent|injection water', prescriptionRequired: true, requiresReview: true },
  { medicationName: 'Sodium bicarbonate injection', genericName: 'Sodium bicarbonate', category: 'Common hospital and clinic medications', dosageForms: 'injection ampoule', commonStrengths: '8.4%', aliases: 'clinic emergency medicine', prescriptionRequired: true, requiresReview: true, controlledOrSpecialHandling: true },
];

export const NIGERIA_MEDICATION_STARTER_CATALOG = starterMedicationInputs.map(makeMedication);
export const NIGERIA_MEDICATION_STARTER_CATALOG_COUNT = NIGERIA_MEDICATION_STARTER_CATALOG.length;

export const MEDICINE_SEARCH_SYNONYMS = {
  malaria: ['antimalarial', 'artemether', 'lumefantrine', 'fever', 'chills'],
  fever: ['temperature', 'hot body', 'paracetamol', 'ibuprofen', 'pain relief'],
  cough: ['catarrh', 'cold', 'sore throat', 'respiratory', 'guaifenesin'],
  'blood pressure': ['bp', 'hypertension', 'amlodipine', 'losartan', 'heart'],
  bp: ['blood pressure', 'hypertension'],
  diabetes: ['blood sugar', 'sugar', 'metformin', 'insulin'],
  ulcer: ['stomach', 'heartburn', 'reflux', 'omeprazole', 'antacid'],
  asthma: ['wheezing', 'inhaler', 'salbutamol', 'breathing'],
  allergy: ['itching', 'sneezing', 'cetirizine', 'loratadine'],
  infection: ['antibiotic', 'amoxicillin', 'azithromycin', 'metronidazole'],
  'eye drops': ['eye', 'chloramphenicol', 'ciprofloxacin drops', 'artificial tears'],
  'ear drops': ['ear', 'ear wax', 'ciprofloxacin drops'],
  children: ['pediatric', 'syrup', 'baby', 'child'],
  child: ['pediatric', 'children', 'syrup'],
  pregnancy: ['folic acid', 'prenatal', 'antenatal', 'iron'],
  'skin rash': ['skin', 'rash', 'cream', 'clotrimazole', 'hydrocortisone'],
};

const GENERIC_SEARCH_TOKENS = new Set([
  'drug',
  'drugs',
  'med',
  'meds',
  'medication',
  'medications',
  'medicine',
  'medicines',
  'name',
  'unknown',
]);

export function normalizeMedicineSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+/.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchText(record) {
  return normalizeMedicineSearchText([
    record.medicationName,
    record.genericName,
    record.category,
    ...record.brandNames,
    ...record.commonUses,
    ...record.symptoms,
    ...record.aliases,
    ...record.dosageForms,
    ...record.commonStrengths,
  ].join(' '));
}

function expandQuery(query) {
  const normalized = normalizeMedicineSearchText(query);
  const expansions = new Set([normalized]);
  const direct = MEDICINE_SEARCH_SYNONYMS[normalized] || [];
  direct.forEach((item) => expansions.add(normalizeMedicineSearchText(item)));

  for (const [key, values] of Object.entries(MEDICINE_SEARCH_SYNONYMS)) {
    if (normalized.includes(key)) {
      values.forEach((item) => expansions.add(normalizeMedicineSearchText(item)));
    }
  }

  return [...expansions].filter(Boolean);
}

function meaningfulQueryTokens(query) {
  return normalizeMedicineSearchText(query)
    .split(' ')
    .filter((part) => part.length >= 3 && !GENERIC_SEARCH_TOKENS.has(part));
}

function scoreMedicine(record, query) {
  const normalized = normalizeMedicineSearchText(query);
  const expanded = expandQuery(query);
  const haystack = compactSearchText(record);
  const name = normalizeMedicineSearchText(record.medicationName);
  const generic = normalizeMedicineSearchText(record.genericName);
  const category = normalizeMedicineSearchText(record.category);
  const aliases = normalizeMedicineSearchText([...record.aliases, ...record.brandNames].join(' '));
  const symptoms = normalizeMedicineSearchText([...record.symptoms, ...record.commonUses].join(' '));
  let score = 0;

  for (const term of expanded) {
    if (!term) continue;
    if (name === term) score += 140;
    if (generic === term) score += 125;
    if (name.startsWith(term) || generic.startsWith(term)) score += 95;
    if (name.includes(term) || generic.includes(term)) score += 80;
    if (aliases.includes(term)) score += 70;
    if (category.includes(term)) score += 55;
    if (symptoms.includes(term)) score += 50;
    if (haystack.includes(term)) score += 35;
  }

  for (const token of meaningfulQueryTokens(normalized)) {
    if (name.includes(token)) score += 28;
    if (generic.includes(token)) score += 24;
    if (aliases.includes(token)) score += 20;
    if (category.includes(token) || symptoms.includes(token)) score += 16;
    if (haystack.includes(token)) score += 8;
  }

  return score;
}

export function toStarterMedicineResult(record, score = 0) {
  return {
    id: record.id,
    starterCatalogId: record.id,
    name: record.medicationName,
    medicationName: record.medicationName,
    genericName: record.genericName,
    brandNames: record.brandNames,
    dosageForm: record.dosageForms.join(', '),
    dosageForms: record.dosageForms,
    strength: record.commonStrengths.slice(0, 4).join(', '),
    commonStrengths: record.commonStrengths,
    therapeuticClass: record.category,
    featuredCategory: record.category,
    category: record.category,
    commonUses: record.commonUses,
    symptoms: record.symptoms,
    aliases: record.aliases,
    requiresPrescription: record.prescriptionRequired,
    requiresReview: record.requiresReview,
    controlled: record.controlledOrSpecialHandling,
    controlledOrSpecialHandling: record.controlledOrSpecialHandling,
    nhiaListed: false,
    priceNgn: null,
    priceNotes: null,
    source: 'starter_catalog',
    sourceName: record.sourceLabel,
    sourceLabel: record.sourceLabel,
    sourceQualityStatus: 'starter_catalog',
    availabilityStatus: record.availabilityStatus,
    pricingStatus: record.pricingStatus,
    pharmacyConfirmationRequired: record.pharmacyConfirmationRequired,
    availabilityMessage: UNKNOWN_AVAILABILITY_MESSAGE,
    pricingMessage: UNKNOWN_PRICE_MESSAGE,
    productLogicNote: 'Catalog reference only. Submit a request so partner pharmacies can confirm availability and price.',
    catalogOnly: true,
    verifiedPharmacyCount: 0,
    verifiedInventory: [],
    liveAvailabilityClaimed: false,
    imageKey: record.imageKey,
    searchScore: score,
    sourceRank: 2,
  };
}

export function normalizeApiMedicineResult(medicine) {
  const verified = medicine?.availabilityStatus === 'verified_partner_stock' || Number(medicine?.verifiedPharmacyCount || 0) > 0;
  return {
    ...medicine,
    name: medicine.name || medicine.medicationName,
    medicationName: medicine.medicationName || medicine.name,
    category: medicine.category || medicine.featuredCategory || medicine.therapeuticClass || 'Medication reference',
    sourceName: medicine.sourceName || medicine.sourceLabel || medicine.source || 'Verified database medication reference',
    availabilityMessage: verified ? medicine.availabilityMessage : UNKNOWN_AVAILABILITY_MESSAGE,
    pricingMessage: verified && medicine.pricingMessage ? medicine.pricingMessage : UNKNOWN_PRICE_MESSAGE,
    pharmacyConfirmationRequired: !verified,
    catalogOnly: !verified,
    liveAvailabilityClaimed: verified,
    sourceRank: verified ? 0 : 1,
  };
}

function dedupeKey(medicine) {
  return normalizeMedicineSearchText(`${medicine.genericName || medicine.name || ''}|${medicine.name || ''}`)
    .replace(/\b(tablet|capsule|syrup|injection|cream|drops)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchNigeriaMedicationCatalog(query, options = {}) {
  const limit = options.limit || 24;
  const normalized = normalizeMedicineSearchText(query);

  if (!normalized) {
    return NIGERIA_MEDICATION_STARTER_CATALOG
      .slice(0, limit)
      .map((record, index) => toStarterMedicineResult(record, 100 - index));
  }

  const tokens = meaningfulQueryTokens(normalized);

  if (!tokens.length && !MEDICINE_SEARCH_SYNONYMS[normalized]) {
    return [];
  }

  return NIGERIA_MEDICATION_STARTER_CATALOG
    .map((record) => ({ record, score: scoreMedicine(record, normalized) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.record.medicationName.localeCompare(b.record.medicationName))
    .slice(0, limit)
    .map((item) => toStarterMedicineResult(item.record, item.score));
}

export function mergeMedicineSearchResults(apiMedicines = [], starterMedicines = [], limit = 32) {
  const merged = new Map();

  [...apiMedicines.map(normalizeApiMedicineResult), ...starterMedicines].forEach((medicine) => {
    const key = dedupeKey(medicine);
    const existing = merged.get(key);
    if (!existing || medicine.sourceRank < existing.sourceRank || (medicine.searchScore || 0) > (existing.searchScore || 0)) {
      merged.set(key, medicine);
    }
  });

  return [...merged.values()]
    .sort((a, b) => (a.sourceRank - b.sourceRank) || ((b.searchScore || 0) - (a.searchScore || 0)) || String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

export function findStarterMedicineById(id) {
  return NIGERIA_MEDICATION_STARTER_CATALOG.find((record) => record.id === id) || null;
}

export { SOURCE_LABEL as NIGERIA_MEDICATION_STARTER_SOURCE_LABEL };
