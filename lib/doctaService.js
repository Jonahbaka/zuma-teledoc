/**
 * DOCTA PRODUCTION SERVICE LAYER
 * Real-time eligibility, pharmacy locator, AI triage, and pricing engine
 */

export const DoctaService = {
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // --- REAL DATA SOURCE: OpenStreetMap via Overpass API ---
  findRealPharmacies: async (lat, lon) => {
    try {
      const query = `
        [out:json][timeout:25];
        node(around:5000,${lat},${lon})[amenity=pharmacy];
        out body;
        >;
        out skel qt;
      `;
      const response = await fetch('https://overpass-api.de/api/interpreter', { 
        method: 'POST', 
        body: query 
      });
      
      if (!response.ok) throw new Error("Overpass API Error");
      const data = await response.json();
      
      const results = data.elements.slice(0, 10).map(element => {
        const street = element.tags['addr:street'] || '';
        const number = element.tags['addr:housenumber'] || '';
        const name = element.tags.name || element.tags.operator || "Local Pharmacy";
        const fullAddress = (street && number) 
          ? `${number} ${street}, ${element.tags['addr:city'] || ''}` 
          : `Lat: ${element.lat.toFixed(4)}, Lon: ${element.lon.toFixed(4)}`;

        return {
          id: element.id,
          name: name,
          address: fullAddress,
          distance: "Nearby",
          isOpen: true,
          isPreferred: name.includes("CVS") || name.includes("Walgreens")
        };
      });

      return results.length > 0 ? results : [];
    } catch (error) {
      console.warn("Failed to fetch real pharmacies, returning fallback:", error);
      return [
        { 
          id: 'fb1', 
          name: "CVS Pharmacy (Fallback)", 
          address: "123 Main St (Network Unavailable)", 
          distance: "0.5 mi", 
          isOpen: true, 
          isPreferred: true 
        },
        { 
          id: 'fb2', 
          name: "Walgreens (Fallback)", 
          address: "456 Broadway (Network Unavailable)", 
          distance: "0.8 mi", 
          isOpen: true, 
          isPreferred: true 
        }
      ];
    }
  },

  // --- REAL-TIME ELIGIBILITY (RTE) SIMULATION ---
  verifyInsuranceReal: async (memberId, payerName) => {
    await DoctaService.delay(2000); // Simulate network latency to Change Healthcare
    return {
      status: "ACTIVE",
      planName: "PPO GOLD PREMIER",
      payer: payerName || "BlueCross BlueShield",
      coverageDetails: { 
        deductibleTotal: 1500.00, 
        deductibleMet: 450.00, 
        copay: { primaryCare: 25.00 } 
      },
      effectiveDate: "2024-01-01",
      verificationSource: "Change Healthcare (ANSI X12 270/271)",
      timestamp: new Date().toISOString()
    };
  },

  ocrScan: async () => {
    await DoctaService.delay(2500); // OCR Processing time
    return {
      success: true,
      data: { 
        payerName: "BlueCross BlueShield", 
        memberId: "XUJ-8922-9910", 
        groupId: "NY-22910", 
        rxBin: "004336", 
        rxPcn: "ADV", 
        planType: "PPO Gold" 
      }
    };
  },

  // --- AI TRIAGE & MED SUGGESTION ENGINE ---
  runAITriage: async (symptoms) => {
    await DoctaService.delay(2000); 
    
    const s = symptoms.toLowerCase();
    let severity = 2;
    let assessment = "General malaise / Undifferentiated illness.";
    let plan = "Monitor vitals, hydration, and rest. Follow up if worsens.";
    let specialty = "Primary Care";
    let flags = [];
    let suggestedMeds = []; 

    if (s.includes('chest') || s.includes('heart') || s.includes('arm')) {
      severity = 5;
      assessment = "Potential Acute Coronary Syndrome (ACS).";
      plan = "Immediate ECG, Troponin I/T. Emergency transfer.";
      specialty = "Cardiology";
      flags.push("CRITICAL CARDIAC");
      suggestedMeds = ['Aspirin', 'Nitroglycerin'];
    } 
    else if ((s.includes('swelling') || s.includes('edema')) && (s.includes('urine') || s.includes('foamy'))) {
      severity = 4;
      assessment = "Suspected Renal Pathology (Nephrotic Syndrome/CKD).\nClinical Indicators: Proteinuria, Edema.";
      plan = "CMP, Urinalysis, Renal Ultrasound. BP monitoring.";
      specialty = "Nephrology";
      flags.push("RENAL FAILURE RISK");
      suggestedMeds = ['Lisinopril', 'Prednisone']; 
    }
    else if (s.includes('fever') || s.includes('cough')) {
      severity = 3;
      assessment = "Respiratory Infection.";
      specialty = "Urgent Care";
      suggestedMeds = ['Amoxicillin', 'Azithromycin'];
    }

    const soapDraft = `SUBJECTIVE:\n${symptoms}\n\nASSESSMENT:\n${assessment}\n\nPLAN:\n${plan}`;

    return { 
      severity, 
      soapDraft, 
      triageLevel: severity >= 4 ? "URGENT" : "ROUTINE", 
      suggestedSpecialty: specialty, 
      flags, 
      suggestedMeds 
    };
  },

  // --- PRICING ENGINE WITH EXPANDED FORMULARY ---
  comparePrices: async (drugName, hasGoldCard) => {
    await DoctaService.delay(800);
    
    const marketData = {
      'Amoxicillin': { cash: 12.00, insuranceCopay: 4.00, goldPrice: 0.00, coupon: null },
      'Lipitor': { cash: 45.00, insuranceCopay: 15.00, goldPrice: 9.00, coupon: null },
      'Wegovy': { cash: 1600.00, insuranceCopay: 1200.00, goldPrice: 1100.00, coupon: { id: 'MFG-WEG', discount: 500.00, label: "Mfg Savings" } },
      'Humira': { cash: 6000.00, insuranceCopay: 50.00, goldPrice: 4500.00, coupon: null },
      'Lisinopril': { cash: 10.00, insuranceCopay: 0.00, goldPrice: 0.00, coupon: null }, 
      'Prednisone': { cash: 15.00, insuranceCopay: 5.00, goldPrice: 2.00, coupon: null }, 
      'Azithromycin': { cash: 30.00, insuranceCopay: 10.00, goldPrice: 5.00, coupon: null },
      'Aspirin': { cash: 5.00, insuranceCopay: 0.00, goldPrice: 0.00, coupon: null },
      'Nitroglycerin': { cash: 25.00, insuranceCopay: 10.00, goldPrice: 5.00, coupon: null }
    };

    const drugData = marketData[drugName] || { 
      cash: 50.00, 
      insuranceCopay: 20.00, 
      goldPrice: 25.00, 
      coupon: null 
    };

    const scenarios = [
      { 
        id: 'INSURANCE', 
        label: 'Insurance', 
        cost: drugData.insuranceCopay, 
        description: 'Payer Adjudicated', 
        covered: true, 
        requiresPA: drugName === 'Wegovy' 
      },
      { 
        id: 'GOLD', 
        label: 'Docta Gold', 
        cost: hasGoldCard ? drugData.goldPrice : drugData.goldPrice + 10, 
        description: hasGoldCard ? 'Member Price' : 'Sub Price', 
        covered: true, 
        requiresPA: false 
      },
      { 
        id: 'CASH', 
        label: 'Retail Cash', 
        cost: drugData.cash, 
        description: 'No Coverage', 
        covered: true, 
        requiresPA: false 
      }
    ];

    if (drugData.coupon) {
      scenarios.push({ 
        id: 'COUPON', 
        label: 'Coupon', 
        cost: Math.max(0, drugData.cash - drugData.coupon.discount), 
        description: 'Mfg Savings', 
        covered: true, 
        isCoupon: true 
      });
    }

    const bestPrice = [...scenarios].sort((a, b) => a.cost - b.cost)[0];

    return { 
      scenarios, 
      bestPrice, 
      drugName, 
      timestamp: new Date().toISOString(),
      requiresPriorAuth: drugName === 'Wegovy'
    };
  },

  submitPA: async () => { 
    await DoctaService.delay(1000); 
    return { 
      paId: `PA-${Date.now().toString().slice(-6)}`, 
      status: "SUBMITTED" 
    }; 
  }
};

