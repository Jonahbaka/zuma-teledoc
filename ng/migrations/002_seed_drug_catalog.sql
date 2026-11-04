-- ============================================================
-- SEED: Nigerian Drug Catalog (NAFDAC-approved common drugs)
-- Covers the most commonly prescribed/sold medications in Nigeria
-- Reference pricing from EMDEX / market surveys
-- ============================================================

-- Enable pg_trgm for fuzzy matching if available
CREATE EXTENSION IF NOT EXISTS pg_trgm;

INSERT INTO ng_drug_catalog (name, generic_name, brand_name, manufacturer, category, atc_code, requires_prescription, dosage_form, strength, pack_size, reference_price, substitution_group, is_generic, description)
VALUES
-- ANALGESICS / ANTI-INFLAMMATORY
('Paracetamol 500mg', 'Paracetamol', 'Emzor Paracetamol', 'Emzor Pharmaceutical', 'otc', 'N02BE01', false, 'Tablet', '500mg', '96 tablets', 800, 'paracetamol-500', true, 'Pain relief and fever reducer'),
('Panadol Extra', 'Paracetamol + Caffeine', 'Panadol Extra', 'GlaxoSmithKline', 'otc', 'N02BE51', false, 'Tablet', '500mg/65mg', '48 tablets', 1500, 'paracetamol-500', false, 'Enhanced pain relief with caffeine'),
('Ibuprofen 400mg', 'Ibuprofen', 'Ibuprofen', 'Emzor Pharmaceutical', 'otc', 'M01AE01', false, 'Tablet', '400mg', '100 tablets', 1200, 'ibuprofen-400', true, 'Anti-inflammatory pain reliever'),
('Diclofenac 50mg', 'Diclofenac Sodium', 'Voltaren', 'Novartis', 'prescription', 'M01AB05', true, 'Tablet', '50mg', '30 tablets', 2500, 'diclofenac-50', false, 'NSAID for pain and inflammation'),

-- ANTIBIOTICS
('Amoxicillin 500mg', 'Amoxicillin', 'Amoxil', 'GlaxoSmithKline', 'prescription', 'J01CA04', true, 'Capsule', '500mg', '20 capsules', 2000, 'amoxicillin-500', true, 'Broad-spectrum antibiotic'),
('Amoxicillin-Clavulanate 625mg', 'Amoxicillin + Clavulanic Acid', 'Augmentin', 'GlaxoSmithKline', 'prescription', 'J01CR02', true, 'Tablet', '625mg', '14 tablets', 4500, 'augmentin-625', false, 'Enhanced antibiotic with beta-lactamase inhibitor'),
('Ciprofloxacin 500mg', 'Ciprofloxacin', 'Ciprotab', 'Fidson Healthcare', 'prescription', 'J01MA02', true, 'Tablet', '500mg', '10 tablets', 1500, 'ciprofloxacin-500', true, 'Fluoroquinolone antibiotic'),
('Azithromycin 500mg', 'Azithromycin', 'Zithromax', 'Pfizer', 'prescription', 'J01FA10', true, 'Tablet', '500mg', '3 tablets', 3000, 'azithromycin-500', false, 'Macrolide antibiotic'),
('Metronidazole 400mg', 'Metronidazole', 'Flagyl', 'Sanofi', 'prescription', 'J01XD01', true, 'Tablet', '400mg', '20 tablets', 1000, 'metronidazole-400', true, 'Antiprotozoal and antibacterial'),

-- ANTIMALARIALS
('Artemether-Lumefantrine', 'Artemether + Lumefantrine', 'Coartem', 'Novartis', 'prescription', 'P01BF01', true, 'Tablet', '20mg/120mg', '24 tablets', 2500, 'act-antimalarial', false, 'ACT antimalarial combination'),
('Artesunate-Amodiaquine', 'Artesunate + Amodiaquine', 'Camosunate', 'Getz Pharma', 'prescription', 'P01BF', true, 'Tablet', '100mg/270mg', '6 tablets', 1800, 'act-antimalarial', true, 'ACT antimalarial'),
('Sulfadoxine-Pyrimethamine', 'Sulfadoxine + Pyrimethamine', 'Fansidar', 'Roche', 'prescription', 'P01BD51', true, 'Tablet', '500mg/25mg', '3 tablets', 500, 'sp-antimalarial', false, 'Antimalarial for prevention'),

-- ANTIHYPERTENSIVES
('Amlodipine 5mg', 'Amlodipine', 'Norvasc', 'Pfizer', 'prescription', 'C08CA01', true, 'Tablet', '5mg', '30 tablets', 2000, 'amlodipine-5', false, 'Calcium channel blocker'),
('Lisinopril 10mg', 'Lisinopril', 'Zestril', 'AstraZeneca', 'prescription', 'C09AA03', true, 'Tablet', '10mg', '30 tablets', 2500, 'lisinopril-10', false, 'ACE inhibitor'),
('Losartan 50mg', 'Losartan', 'Cozaar', 'Merck', 'prescription', 'C09CA01', true, 'Tablet', '50mg', '30 tablets', 3000, 'losartan-50', false, 'ARB antihypertensive'),
('Hydrochlorothiazide 25mg', 'Hydrochlorothiazide', 'HCTZ', 'Various', 'prescription', 'C03AA03', true, 'Tablet', '25mg', '30 tablets', 500, 'hctz-25', true, 'Thiazide diuretic'),

-- ANTIDIABETICS
('Metformin 500mg', 'Metformin', 'Glucophage', 'Merck', 'prescription', 'A10BA02', true, 'Tablet', '500mg', '60 tablets', 2000, 'metformin-500', false, 'First-line type 2 diabetes treatment'),
('Glibenclamide 5mg', 'Glibenclamide', 'Daonil', 'Sanofi', 'prescription', 'A10BB01', true, 'Tablet', '5mg', '30 tablets', 1500, 'glibenclamide-5', false, 'Sulfonylurea for diabetes'),

-- GASTROINTESTINAL
('Omeprazole 20mg', 'Omeprazole', 'Losec', 'AstraZeneca', 'otc', 'A02BC01', false, 'Capsule', '20mg', '14 capsules', 1800, 'omeprazole-20', false, 'Proton pump inhibitor'),
('Loperamide 2mg', 'Loperamide', 'Imodium', 'Johnson & Johnson', 'otc', 'A07DA03', false, 'Capsule', '2mg', '8 capsules', 800, 'loperamide-2', false, 'Anti-diarrheal'),
('ORS (Oral Rehydration Salts)', 'Oral Rehydration Salts', 'ORS', 'Various', 'otc', 'A07CA', false, 'Sachet', 'Standard', '20 sachets', 500, 'ors', true, 'Rehydration for diarrhea'),

-- VITAMINS & SUPPLEMENTS
('Vitamin C 1000mg', 'Ascorbic Acid', 'Emvite-C', 'Emzor', 'otc', 'A11GA01', false, 'Tablet', '1000mg', '100 tablets', 1500, 'vitc-1000', true, 'Immune support'),
('Folic Acid 5mg', 'Folic Acid', 'Folic Acid', 'Various', 'otc', 'B03BB01', false, 'Tablet', '5mg', '100 tablets', 500, 'folicacid-5', true, 'Prenatal vitamin'),
('Ferrous Sulphate 200mg', 'Ferrous Sulphate', 'Fesol', 'Various', 'otc', 'B03AA07', false, 'Tablet', '200mg', '100 tablets', 800, 'iron-200', true, 'Iron supplement'),
('Multivitamin', 'Multivitamin Complex', 'Wellman/Wellwoman', 'Vitabiotics', 'otc', 'A11AA', false, 'Tablet', 'Complex', '30 tablets', 5000, 'multivitamin', false, 'Daily multivitamin'),

-- RESPIRATORY
('Salbutamol Inhaler', 'Salbutamol', 'Ventolin', 'GlaxoSmithKline', 'prescription', 'R03AC02', true, 'Inhaler', '100mcg', '200 doses', 3500, 'salbutamol-inhaler', false, 'Bronchodilator for asthma'),
('Cetirizine 10mg', 'Cetirizine', 'Zyrtec', 'UCB', 'otc', 'R06AE07', false, 'Tablet', '10mg', '30 tablets', 1500, 'cetirizine-10', false, 'Antihistamine for allergies'),
('Loratadine 10mg', 'Loratadine', 'Claritin', 'Bayer', 'otc', 'R06AX13', false, 'Tablet', '10mg', '30 tablets', 1800, 'loratadine-10', false, 'Non-drowsy antihistamine'),

-- DERMATOLOGICAL
('Clotrimazole Cream', 'Clotrimazole', 'Canesten', 'Bayer', 'otc', 'D01AC01', false, 'Cream', '1%', '20g', 1200, 'clotrimazole-cream', false, 'Antifungal cream'),
('Hydrocortisone Cream', 'Hydrocortisone', 'Hydrocortisone', 'Various', 'otc', 'D07AA02', false, 'Cream', '1%', '15g', 800, 'hydrocortisone-cream', true, 'Mild topical steroid'),

-- FAMILY PLANNING
('Levonorgestrel Emergency', 'Levonorgestrel', 'Postinor-2', 'Gedeon Richter', 'otc', 'G03AC03', false, 'Tablet', '0.75mg', '2 tablets', 1000, 'emergency-contraception', false, 'Emergency contraception'),

-- COMMON SYRUPS
('Cough Syrup (Benylin)', 'Diphenhydramine + Ammonium', 'Benylin', 'Johnson & Johnson', 'otc', 'R05DA', false, 'Syrup', '100ml', '100ml', 1500, 'cough-syrup', false, 'Cough suppressant'),
('Paracetamol Syrup (Pediatric)', 'Paracetamol', 'Calpol', 'GlaxoSmithKline', 'otc', 'N02BE01', false, 'Syrup', '120mg/5ml', '100ml', 800, 'paracetamol-syrup', false, 'Pediatric fever and pain relief')

ON CONFLICT DO NOTHING;
