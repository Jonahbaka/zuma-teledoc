/**
 * PHI Redactor Service
 * Identifies and redacts Protected Health Information before sending to LLMs
 * HIPAA-compliant AI processing
 * @module command-center/services/ai/PHIRedactor
 */

const db = require('../../../../db');
const { hash } = require('../../../../lib/encryption');
const logger = require('../../../../middleware/logger');

/**
 * @typedef {import('../../types/index.js').PHIData} PHIData
 * @typedef {import('../../types/index.js').RedactionResult} RedactionResult
 */

/**
 * PHI patterns for detection
 */
const PHI_PATTERNS = {
  // Names - common patterns
  name: {
    pattern: /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g,
    placeholder: '[NAME]'
  },
  
  // Email addresses
  email: {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    placeholder: '[EMAIL]'
  },
  
  // Phone numbers (various formats)
  phone: {
    pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    placeholder: '[PHONE]'
  },
  
  // Social Security Numbers
  ssn: {
    pattern: /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    placeholder: '[SSN]'
  },
  
  // Date of Birth patterns
  dob: {
    pattern: /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](19|20)\d{2}\b/g,
    placeholder: '[DOB]'
  },
  
  // Medical Record Numbers (MRN)
  mrn: {
    pattern: /\b(?:MRN|Medical Record)[#:\s]*([A-Z0-9]{6,12})\b/gi,
    placeholder: '[MRN]'
  },
  
  // Insurance IDs
  insuranceId: {
    pattern: /\b(?:Insurance|Policy|Member)[#:\s]*([A-Z0-9]{8,15})\b/gi,
    placeholder: '[INSURANCE_ID]'
  },
  
  // Street addresses
  address: {
    pattern: /\b\d{1,5}\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Circle|Cir|Place|Pl)\b\.?/gi,
    placeholder: '[ADDRESS]'
  },
  
  // ZIP codes
  zipCode: {
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
    placeholder: '[ZIP]'
  },
  
  // Credit card numbers
  creditCard: {
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    placeholder: '[CARD]'
  },
  
  // IP addresses
  ipAddress: {
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    placeholder: '[IP]'
  }
};

/**
 * Medical condition keywords to flag
 */
const MEDICAL_CONDITIONS = [
  'diabetes', 'cancer', 'hiv', 'aids', 'pregnancy', 'pregnant',
  'mental health', 'depression', 'anxiety', 'bipolar', 'schizophrenia',
  'substance abuse', 'addiction', 'alcoholism', 'overdose',
  'std', 'hepatitis', 'tuberculosis', 'covid'
];

/**
 * PHI Redactor Class
 */
class PHIRedactor {
  constructor() {
    this.customPatterns = [];
    this.initialized = false;
  }

  /**
   * Initialize with any custom patterns from database
   */
  async initialize() {
    if (this.initialized) return;
    
    // Could load custom organization-specific patterns from DB
    this.initialized = true;
  }

  /**
   * Redact PHI from text
   * @param {string} text - Text to redact
   * @param {Object} [options]
   * @param {boolean} [options.preserveMapping=true] - Store mapping for restoration
   * @param {string[]} [options.additionalPatterns] - Extra patterns to redact
   * @returns {RedactionResult}
   */
  redact(text, options = {}) {
    const { preserveMapping = true, additionalPatterns = [] } = options;
    
    let redactedText = text;
    const redactedFields = [];
    const placeholderMap = {};
    let placeholderIndex = 0;

    // Apply each PHI pattern
    for (const [fieldType, { pattern, placeholder }] of Object.entries(PHI_PATTERNS)) {
      redactedText = redactedText.replace(pattern, (match) => {
        redactedFields.push(fieldType);
        
        if (preserveMapping) {
          const indexedPlaceholder = `${placeholder.slice(0, -1)}_${placeholderIndex}]`;
          placeholderMap[indexedPlaceholder] = match;
          placeholderIndex++;
          return indexedPlaceholder;
        }
        
        return placeholder;
      });
    }

    // Apply additional custom patterns
    for (const customPattern of additionalPatterns) {
      const regex = new RegExp(customPattern, 'gi');
      redactedText = redactedText.replace(regex, (match) => {
        redactedFields.push('custom');
        
        if (preserveMapping) {
          const placeholder = `[CUSTOM_${placeholderIndex}]`;
          placeholderMap[placeholder] = match;
          placeholderIndex++;
          return placeholder;
        }
        
        return '[REDACTED]';
      });
    }

    return {
      redactedText,
      redactedFields: [...new Set(redactedFields)],
      placeholderMap
    };
  }

  /**
   * Restore redacted text using placeholder map
   * @param {string} redactedText
   * @param {Object.<string, string>} placeholderMap
   * @returns {string}
   */
  restore(redactedText, placeholderMap) {
    let restoredText = redactedText;
    
    for (const [placeholder, original] of Object.entries(placeholderMap)) {
      restoredText = restoredText.replace(placeholder, original);
    }
    
    return restoredText;
  }

  /**
   * Check if text contains PHI
   * @param {string} text
   * @returns {{containsPHI: boolean, types: string[]}}
   */
  containsPHI(text) {
    const types = [];
    
    for (const [fieldType, { pattern }] of Object.entries(PHI_PATTERNS)) {
      if (pattern.test(text)) {
        types.push(fieldType);
      }
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
    }
    
    return {
      containsPHI: types.length > 0,
      types
    };
  }

  /**
   * Check if text contains sensitive medical information
   * @param {string} text
   * @returns {{containsSensitive: boolean, conditions: string[]}}
   */
  containsSensitiveMedical(text) {
    const textLower = text.toLowerCase();
    const found = MEDICAL_CONDITIONS.filter(condition => 
      textLower.includes(condition)
    );
    
    return {
      containsSensitive: found.length > 0,
      conditions: found
    };
  }

  /**
   * Anonymize a patient record for RAG/training
   * @param {Object} record
   * @returns {Object}
   */
  anonymizeRecord(record) {
    const anonymized = {};
    
    // Keep only non-PHI fields
    const safeFields = [
      'ageRange', 'gender', 'symptoms', 'diagnosisCodes',
      'treatmentType', 'outcome', 'generalNotes'
    ];
    
    for (const field of safeFields) {
      if (record[field]) {
        anonymized[field] = record[field];
      }
    }
    
    // Convert specific age to range
    if (record.age) {
      anonymized.ageRange = this.ageToRange(record.age);
    }
    
    // Generalize location
    if (record.state) {
      anonymized.region = this.stateToRegion(record.state);
    }
    
    return anonymized;
  }

  /**
   * Convert age to range for anonymization
   * @param {number} age
   * @returns {string}
   */
  ageToRange(age) {
    if (age < 18) return '0-17';
    if (age < 30) return '18-29';
    if (age < 40) return '30-39';
    if (age < 50) return '40-49';
    if (age < 60) return '50-59';
    if (age < 70) return '60-69';
    return '70+';
  }

  /**
   * Convert state to region for anonymization
   * @param {string} state
   * @returns {string}
   */
  stateToRegion(state) {
    const regions = {
      northeast: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA'],
      midwest: ['IL', 'IN', 'MI', 'OH', 'WI', 'IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD'],
      south: ['DE', 'FL', 'GA', 'MD', 'NC', 'SC', 'VA', 'DC', 'WV', 'AL', 'KY', 'MS', 'TN', 'AR', 'LA', 'OK', 'TX'],
      west: ['AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'UT', 'WY', 'AK', 'CA', 'HI', 'OR', 'WA']
    };
    
    for (const [region, states] of Object.entries(regions)) {
      if (states.includes(state.toUpperCase())) {
        return region;
      }
    }
    
    return 'unknown';
  }

  /**
   * Log PHI redaction for audit compliance
   * @param {string} userId
   * @param {string} operationType
   * @param {string} originalText
   * @param {string[]} redactedFields
   * @param {string} destination
   * @returns {Promise<void>}
   */
  async logRedaction(userId, operationType, originalText, redactedFields, destination) {
    try {
      await db.query(
        `INSERT INTO phi_redaction_log (
          user_id, operation_type, original_hash, redacted_fields, destination
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          operationType,
          hash(originalText), // Only store hash, not original
          redactedFields,
          destination
        ]
      );
    } catch (error) {
      logger.error('Failed to log PHI redaction', { error: error.message });
      // Don't throw - logging failure shouldn't break operation
    }
  }

  /**
   * Create a safe prompt for AI by redacting PHI
   * @param {string} prompt
   * @param {string} userId
   * @param {string} destination - AI provider name
   * @returns {Promise<{safePrompt: string, placeholderMap: Object}>}
   */
  async createSafePrompt(prompt, userId, destination) {
    const { redactedText, redactedFields, placeholderMap } = this.redact(prompt);
    
    // Log for compliance
    await this.logRedaction(userId, 'ai_query', prompt, redactedFields, destination);
    
    return {
      safePrompt: redactedText,
      placeholderMap
    };
  }

  /**
   * Restore AI response with original values
   * @param {string} response
   * @param {Object} placeholderMap
   * @returns {string}
   */
  restoreResponse(response, placeholderMap) {
    return this.restore(response, placeholderMap);
  }
}

module.exports = new PHIRedactor();

