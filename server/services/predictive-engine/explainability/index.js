/**
 * Explainability Layer - Making AI Predictions Transparent
 * 
 * Generates human-readable explanations for every prediction,
 * suitable for clinicians, administrators, and patients.
 * Implements SHAP-inspired feature attribution and clinical narrative generation.
 */

const db = require('../../../db');

class ExplainabilityEngine {
  
  // =========================================================================
  // SHAP-INSPIRED FEATURE ATTRIBUTION
  // =========================================================================

  /**
   * Compute Shapley-inspired feature contributions
   * Uses the marginal contribution approach for interpretability
   */
  computeFeatureContributions(model, features, prediction) {
    const featureNames = model.feature_names || [];
    const weights = model.model_weights || {};
    const contributions = [];

    // Base rate (intercept/prior)
    const baseRate = 1 / (1 + Math.exp(-(weights.intercept || 0)));

    for (const name of featureNames) {
      const value = features[name] || 0;
      const weight = weights[name] || 0;
      
      // Marginal contribution: prediction WITH this feature minus prediction WITHOUT
      const withFeature = this.predictWithout(model, features, featureNames, null);
      const withoutFeature = this.predictWithout(model, features, featureNames, name);
      const marginalContribution = withFeature - withoutFeature;

      contributions.push({
        feature: name,
        value: Math.round(value * 1000) / 1000,
        shapValue: Math.round(marginalContribution * 10000) / 10000,
        absoluteImpact: Math.round(Math.abs(marginalContribution) * 10000) / 10000,
        direction: marginalContribution > 0.001 ? 'risk_increasing' : marginalContribution < -0.001 ? 'risk_decreasing' : 'neutral',
        percentageContribution: prediction > 0 
          ? Math.round((Math.abs(marginalContribution) / prediction) * 100) 
          : 0,
        humanLabel: this.getHumanLabel(name),
        humanValue: this.getHumanValue(name, value),
        clinicalSignificance: this.getClinicalSignificance(name, value, marginalContribution)
      });
    }

    // Sort by absolute impact
    contributions.sort((a, b) => b.absoluteImpact - a.absoluteImpact);

    return {
      baseRate: Math.round(baseRate * 10000) / 10000,
      finalPrediction: Math.round(prediction * 10000) / 10000,
      contributions,
      topContributors: contributions.slice(0, 5),
      protectiveFactors: contributions.filter(c => c.direction === 'risk_decreasing').slice(0, 3),
      riskFactors: contributions.filter(c => c.direction === 'risk_increasing').slice(0, 5)
    };
  }

  predictWithout(model, features, featureNames, excludeFeature) {
    const weights = model.model_weights || {};
    let z = weights.intercept || 0;
    
    for (const name of featureNames) {
      if (name === excludeFeature) continue;
      z += (features[name] || 0) * (weights[name] || 0);
    }
    
    return 1 / (1 + Math.exp(-z));
  }

  // =========================================================================
  // CLINICAL NARRATIVE GENERATION
  // =========================================================================

  /**
   * Generate a clinical-grade narrative explanation
   * Suitable for medical professionals and EHR integration
   */
  generateClinicalNarrative(predictionType, prediction, features, contributions) {
    const riskScore = Math.round(prediction * 100);
    const riskLevel = this.getRiskLevel(prediction);
    const topRisk = contributions.riskFactors.slice(0, 3);
    const topProtective = contributions.protectiveFactors.slice(0, 2);

    let narrative = '';

    // Opening assessment
    narrative += this.getOpeningStatement(predictionType, riskScore, riskLevel);

    // Risk factors
    if (topRisk.length > 0) {
      narrative += '\n\nPrimary Risk Factors:\n';
      topRisk.forEach((factor, i) => {
        narrative += `${i + 1}. ${factor.humanLabel}: ${factor.humanValue}`;
        narrative += ` (contributes ${factor.percentageContribution}% to risk score)`;
        if (factor.clinicalSignificance) {
          narrative += ` — ${factor.clinicalSignificance}`;
        }
        narrative += '\n';
      });
    }

    // Protective factors
    if (topProtective.length > 0) {
      narrative += '\nProtective Factors:\n';
      topProtective.forEach((factor, i) => {
        narrative += `• ${factor.humanLabel}: ${factor.humanValue}\n`;
      });
    }

    // Clinical recommendation
    narrative += '\n' + this.getClinicalRecommendation(predictionType, riskLevel, features);

    // Confidence note
    const dataCompleteness = contributions.contributions.filter(c => c.value !== 0).length / contributions.contributions.length;
    if (dataCompleteness < 0.5) {
      narrative += '\n\nNote: Limited data available for this patient. Prediction confidence is reduced. Additional clinical assessment recommended.';
    }

    return narrative;
  }

  /**
   * Generate a patient-friendly explanation
   * Uses simple language suitable for patient portals
   */
  generatePatientNarrative(predictionType, prediction, contributions) {
    const riskScore = Math.round(prediction * 100);
    const riskLevel = this.getRiskLevel(prediction);

    const typeDescriptions = {
      readmission_risk: 'needing to return to the hospital within 30 days',
      claims_denial: 'your insurance claim being denied',
      no_show: 'missing your upcoming appointment',
      sepsis_warning: 'developing a serious infection',
      disease_progression: 'your condition getting worse',
      cost_forecast: 'higher than average healthcare costs',
      quality_measures: 'having gaps in your preventive care'
    };

    const description = typeDescriptions[predictionType] || 'health concerns';
    let narrative = '';

    if (riskLevel === 'critical' || riskLevel === 'high') {
      narrative += `Based on your health information, our analysis shows a ${riskLevel} chance (${riskScore}%) of ${description}. `;
      narrative += 'Your care team has been notified and will work with you on a plan.';
    } else if (riskLevel === 'moderate') {
      narrative += `Our analysis shows a moderate chance (${riskScore}%) of ${description}. `;
      narrative += 'We recommend discussing this with your provider at your next visit.';
    } else {
      narrative += `Good news — your risk of ${description} is ${riskLevel} (${riskScore}%). `;
      narrative += 'Keep up the good work with your health routine!';
    }

    // Simple tips
    const tips = this.getPatientTips(predictionType, riskLevel, contributions);
    if (tips.length > 0) {
      narrative += '\n\nThings you can do:\n';
      tips.forEach(tip => { narrative += `• ${tip}\n`; });
    }

    return narrative;
  }

  /**
   * Generate an executive summary for administrators/insurers
   */
  generateExecutiveSummary(predictionType, populationResults) {
    const total = populationResults.total || 0;
    const summary = populationResults.summary || {};

    let narrative = `## ${this.getTypeDisplayName(predictionType)} — Population Risk Summary\n\n`;
    narrative += `**Population Size:** ${total.toLocaleString()} patients\n\n`;
    
    narrative += `### Risk Distribution\n`;
    narrative += `| Risk Level | Count | Percentage |\n`;
    narrative += `|------------|-------|------------|\n`;
    
    for (const level of ['critical', 'high', 'moderate', 'low', 'minimal']) {
      const count = summary[level] || 0;
      const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
      narrative += `| ${level.charAt(0).toUpperCase() + level.slice(1)} | ${count.toLocaleString()} | ${pct}% |\n`;
    }

    const actionable = (summary.critical || 0) + (summary.high || 0);
    narrative += `\n**Actionable Cases:** ${actionable.toLocaleString()} patients require intervention\n`;

    const estimatedSavings = this.estimateCostSavings(predictionType, summary);
    if (estimatedSavings > 0) {
      narrative += `**Estimated Savings from Intervention:** $${estimatedSavings.toLocaleString()}/year\n`;
    }

    return narrative;
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  getOpeningStatement(predictionType, riskScore, riskLevel) {
    const statements = {
      readmission_risk: `READMISSION RISK ASSESSMENT: Patient has a ${riskScore}% predicted probability of 30-day readmission (${riskLevel.toUpperCase()} risk).`,
      claims_denial: `CLAIMS DENIAL PREDICTION: This claim has a ${riskScore}% probability of denial (${riskLevel.toUpperCase()} risk).`,
      no_show: `NO-SHOW PREDICTION: Patient has a ${riskScore}% probability of missing their appointment (${riskLevel.toUpperCase()} risk).`,
      sepsis_warning: `SEPSIS EARLY WARNING: Patient has a ${riskScore}% predicted risk of sepsis (${riskLevel.toUpperCase()} alert).`,
      disease_progression: `DISEASE PROGRESSION RISK: ${riskScore}% probability of disease progression in next 90 days (${riskLevel.toUpperCase()} risk).`,
      cost_forecast: `COST TRAJECTORY: Patient is in the ${riskScore}th percentile for projected healthcare costs (${riskLevel.toUpperCase()} cost risk).`,
      quality_measures: `QUALITY GAP ANALYSIS: ${riskScore}% probability of care quality gaps (${riskLevel.toUpperCase()} risk).`
    };
    return statements[predictionType] || `RISK ASSESSMENT: ${riskScore}% risk score (${riskLevel.toUpperCase()}).`;
  }

  getClinicalRecommendation(predictionType, riskLevel, features) {
    if (riskLevel === 'minimal' || riskLevel === 'low') {
      return 'Recommendation: Continue standard care protocols. No additional intervention required.';
    }

    const recs = {
      readmission_risk: 'Recommendation: Initiate transitional care management (TCM). Schedule 48-hour post-discharge follow-up. Consider home health referral.',
      claims_denial: 'Recommendation: Review documentation for medical necessity. Verify diagnosis codes. Confirm prior authorization before submission.',
      no_show: 'Recommendation: Initiate proactive outreach protocol. Send multi-channel reminders (SMS, email, phone). Offer telehealth alternative.',
      sepsis_warning: 'Recommendation: Initiate sepsis screening protocol. Order blood cultures, lactate, CBC with differential. Consider broad-spectrum antibiotics.',
      disease_progression: 'Recommendation: Escalate to specialist. Review and intensify current treatment plan. Increase monitoring frequency.',
      cost_forecast: 'Recommendation: Enroll in care management program. Review for care coordination opportunities. Evaluate ED diversion strategies.',
      quality_measures: 'Recommendation: Schedule preventive care visit. Review care gap checklist. Coordinate with quality team for outreach.'
    };

    return recs[predictionType] || 'Recommendation: Clinical review recommended.';
  }

  getPatientTips(predictionType, riskLevel, contributions) {
    const tips = {
      readmission_risk: [
        'Take all medications as prescribed',
        'Attend all follow-up appointments',
        'Call your doctor if symptoms worsen',
        'Keep a list of your medications handy'
      ],
      no_show: [
        'Set a reminder on your phone for your appointment',
        'If you need to cancel, call us 24 hours ahead',
        'Ask about telehealth options if transportation is a challenge'
      ],
      disease_progression: [
        'Follow your treatment plan consistently',
        'Track your symptoms and share with your doctor',
        'Stay active and maintain a healthy diet',
        'Attend all scheduled check-ups'
      ],
      quality_measures: [
        'Schedule your annual wellness visit',
        'Stay up to date on recommended screenings',
        'Ask your doctor about any recommended vaccinations'
      ]
    };

    return (tips[predictionType] || []).slice(0, riskLevel === 'critical' || riskLevel === 'high' ? 4 : 2);
  }

  getRiskLevel(score) {
    if (score >= 0.85) return 'critical';
    if (score >= 0.65) return 'high';
    if (score >= 0.40) return 'moderate';
    if (score >= 0.20) return 'low';
    return 'minimal';
  }

  getTypeDisplayName(type) {
    const names = {
      readmission_risk: 'Hospital Readmission Risk',
      claims_denial: 'Claims Denial Prediction',
      no_show: 'Appointment No-Show',
      sepsis_warning: 'Sepsis Early Warning',
      disease_progression: 'Disease Progression',
      cost_forecast: 'Cost of Care Forecast',
      quality_measures: 'Quality Measure Gaps'
    };
    return names[type] || type;
  }

  getHumanLabel(featureName) {
    const labels = {
      age: 'Patient Age',
      is_elderly: 'Elderly Status (65+)',
      gender_male: 'Male Gender',
      gender_female: 'Female Gender',
      encounters_30d: 'Recent Encounters (30 days)',
      encounters_90d: 'Encounters (90 days)',
      er_visits_90d: 'ER Visits (90 days)',
      encounter_acceleration: 'Visit Frequency Trend',
      active_medications: 'Active Medications',
      polypharmacy_flag: 'Polypharmacy (5+ meds)',
      has_high_risk_med: 'High-Risk Medication',
      charlson_comorbidity_index: 'Comorbidity Burden',
      mews_score: 'Early Warning Score (MEWS)',
      clinical_complexity_score: 'Clinical Complexity',
      sdoh_risk_score: 'Social Risk Score',
      no_show_rate: 'Historical No-Show Rate',
      denial_rate: 'Historical Denial Rate',
      days_since_last_encounter: 'Days Since Last Visit',
      total_billed: 'Total Amount Billed',
      avg_claim_amount: 'Average Claim Amount',
      bp_systolic: 'Blood Pressure (Systolic)',
      heart_rate: 'Heart Rate',
      temperature: 'Body Temperature',
      oxygen_saturation: 'Oxygen Saturation',
      respiratory_rate: 'Respiratory Rate',
      active_problems: 'Active Health Problems',
      severe_problems: 'Severe Conditions',
      is_medicaid: 'Medicaid Coverage',
      is_uninsured: 'Uninsured Status',
      lab_abnormality_rate: 'Abnormal Lab Rate'
    };
    return labels[featureName] || featureName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  getHumanValue(featureName, value) {
    const formatters = {
      age: v => `${Math.round(v)} years`,
      bp_systolic: v => `${Math.round(v)} mmHg`,
      heart_rate: v => `${Math.round(v)} bpm`,
      temperature: v => `${v.toFixed(1)}°F`,
      oxygen_saturation: v => `${Math.round(v)}%`,
      respiratory_rate: v => `${Math.round(v)}/min`,
      total_billed: v => `$${Math.round(v).toLocaleString()}`,
      avg_claim_amount: v => `$${Math.round(v).toLocaleString()}`,
      no_show_rate: v => `${Math.round(v * 100)}%`,
      denial_rate: v => `${Math.round(v * 100)}%`,
      sdoh_risk_score: v => `${Math.round(v * 100)}%`,
      clinical_complexity_score: v => `${Math.round(v * 100)}%`,
      lab_abnormality_rate: v => `${Math.round(v * 100)}%`,
      days_since_last_encounter: v => `${Math.round(v)} days`
    };

    const booleanFeatures = ['is_elderly', 'gender_male', 'gender_female', 'polypharmacy_flag', 
      'has_high_risk_med', 'is_medicaid', 'is_uninsured'];
    if (booleanFeatures.includes(featureName)) {
      return value ? 'Yes' : 'No';
    }

    const formatter = formatters[featureName];
    return formatter ? formatter(value) : String(Math.round(value * 100) / 100);
  }

  getClinicalSignificance(featureName, value, contribution) {
    if (Math.abs(contribution) < 0.01) return null;

    const significanceMap = {
      mews_score: value >= 5 ? 'MEWS >= 5 indicates potential clinical deterioration' : null,
      er_visits_90d: value >= 2 ? 'Frequent ER utilization is a strong readmission predictor' : null,
      polypharmacy_flag: value ? 'Polypharmacy increases drug interaction and adverse event risk' : null,
      charlson_comorbidity_index: value >= 5 ? 'High comorbidity burden significantly impacts prognosis' : null,
      oxygen_saturation: value < 92 ? 'Hypoxemia requires immediate attention' : null,
      bp_systolic: value < 90 ? 'Hypotension may indicate hemodynamic instability' : value > 180 ? 'Hypertensive crisis risk' : null,
      sdoh_risk_score: value > 0.5 ? 'Social determinants significantly impact health outcomes and adherence' : null
    };

    return significanceMap[featureName] || null;
  }

  estimateCostSavings(predictionType, summary) {
    // Evidence-based cost savings estimates
    const savingsPerIntervention = {
      readmission_risk: 15000, // Average cost of prevented readmission
      sepsis_warning: 25000,   // Early sepsis detection savings
      no_show: 200,            // Revenue recovery per prevented no-show
      claims_denial: 1500,     // Average recovered claim amount
      cost_forecast: 5000,     // Per high-cost patient managed
      quality_measures: 3000   // Per quality gap closed
    };

    const perCase = savingsPerIntervention[predictionType] || 0;
    const actionable = (summary.critical || 0) + (summary.high || 0);
    const interventionRate = 0.6; // Assume 60% intervention success

    return Math.round(actionable * perCase * interventionRate);
  }
}

module.exports = new ExplainabilityEngine();
