/**
 * Prescription Parser
 * Parses uploaded prescription images using OCR and AI
 * Extracts: prescriber info, drug names, dosages, quantities
 */

const { getPool } = require('../../../server/db');

class PrescriptionParser {
  /**
   * Parse a prescription image
   * @param {string} imageUrl - URL of the uploaded prescription image
   * @param {string} patientUserId - Patient user ID
   * @returns {Object} Parsed prescription data
   */
  async parseFromImage(imageUrl, patientUserId) {
    const pool = getPool();

    // Create prescription record
    const prescriptionResult = await pool.query(
      `INSERT INTO ng_prescriptions (patient_user_id, image_url, status)
       VALUES ($1, $2, 'parsing')
       RETURNING id`,
      [patientUserId, imageUrl]
    );
    const prescriptionId = prescriptionResult.rows[0].id;

    try {
      // Step 1: OCR the image (use existing ocrService if available, or AI)
      const ocrText = await this.performOcr(imageUrl);

      // Step 2: AI-powered structured extraction
      const parsed = await this.extractPrescriptionData(ocrText);

      // Step 3: Match drugs to catalog
      const matchedItems = await this.matchDrugsToCatalog(parsed.items);

      // Step 4: Update prescription record
      await pool.query(
        `UPDATE ng_prescriptions SET
          ocr_raw_text = $1,
          ocr_confidence = $2,
          prescriber_name = $3,
          prescriber_license = $4,
          prescriber_facility = $5,
          prescription_date = $6,
          items = $7,
          status = 'parsed',
          is_controlled_substance = $8,
          updated_at = NOW()
        WHERE id = $9`,
        [
          ocrText,
          parsed.confidence,
          parsed.prescriber?.name,
          parsed.prescriber?.license,
          parsed.prescriber?.facility,
          parsed.prescriptionDate,
          JSON.stringify(matchedItems),
          matchedItems.some(i => i.isControlled),
          prescriptionId,
        ]
      );

      return {
        prescriptionId,
        prescriber: parsed.prescriber,
        items: matchedItems,
        confidence: parsed.confidence,
        requiresVerification: parsed.confidence < 0.8 || matchedItems.some(i => i.isControlled),
        status: 'parsed',
      };
    } catch (error) {
      await pool.query(
        `UPDATE ng_prescriptions SET status = 'rejected', rejection_reason = $1 WHERE id = $2`,
        [error.message, prescriptionId]
      );
      throw error;
    }
  }

  /**
   * Parse prescription from manual text input
   */
  async parseFromText(text, patientUserId) {
    const pool = getPool();

    const prescriptionResult = await pool.query(
      `INSERT INTO ng_prescriptions (patient_user_id, ocr_raw_text, status)
       VALUES ($1, $2, 'parsing')
       RETURNING id`,
      [patientUserId, text]
    );
    const prescriptionId = prescriptionResult.rows[0].id;

    const parsed = await this.extractPrescriptionData(text);
    const matchedItems = await this.matchDrugsToCatalog(parsed.items);

    await pool.query(
      `UPDATE ng_prescriptions SET
        items = $1, status = 'parsed',
        prescriber_name = $2, prescriber_license = $3,
        prescription_date = $4, ocr_confidence = $5,
        is_controlled_substance = $6, updated_at = NOW()
      WHERE id = $7`,
      [
        JSON.stringify(matchedItems),
        parsed.prescriber?.name,
        parsed.prescriber?.license,
        parsed.prescriptionDate,
        parsed.confidence,
        matchedItems.some(i => i.isControlled),
        prescriptionId,
      ]
    );

    return { prescriptionId, items: matchedItems, confidence: parsed.confidence };
  }

  /**
   * Perform OCR on prescription image
   * Uses the existing ocrService or falls back to AI vision
   */
  async performOcr(imageUrl) {
    try {
      // Try to use existing OCR service
      const ocrService = require('../../../server/services/ocrService');
      if (ocrService && ocrService.extractText) {
        return await ocrService.extractText(imageUrl);
      }
    } catch (e) {
      // Fallback: use Anthropic Claude Vision API
    }

    // Anthropic Claude Vision for prescription OCR
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('OCR service unavailable: No ANTHROPIC_API_KEY configured');
    }

    const https = require('https');
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: imageUrl },
            },
            {
              type: 'text',
              text: `Extract ALL text from this prescription image. Include:
- Doctor/prescriber name and license number
- Hospital/clinic name
- Date
- Patient name
- Every medication listed with dosage, frequency, duration, and quantity
Return the raw text exactly as written.`,
            },
          ],
        }],
      });

      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.content?.[0]?.text || '');
          } catch (e) {
            reject(new Error('Failed to parse OCR response'));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * Use AI to extract structured prescription data from raw text
   */
  async extractPrescriptionData(rawText) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      // Fallback: basic regex parsing
      return this.regexParsePrescription(rawText);
    }

    const https = require('https');
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Parse this Nigerian prescription text and return ONLY valid JSON:

${rawText}

Return JSON in this exact format:
{
  "prescriber": {
    "name": "Dr. Name",
    "license": "license number if found",
    "facility": "hospital/clinic name if found"
  },
  "prescriptionDate": "YYYY-MM-DD or null",
  "items": [
    {
      "drug_name": "exact drug name as written",
      "generic_name": "generic equivalent if identifiable",
      "dosage": "e.g., 500mg",
      "frequency": "e.g., twice daily",
      "duration": "e.g., 7 days",
      "quantity": number,
      "notes": "any special instructions"
    }
  ],
  "confidence": 0.0 to 1.0
}`,
        }],
      });

      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            const text = response.content?.[0]?.text || '';
            // Extract JSON from the response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              resolve(JSON.parse(jsonMatch[0]));
            } else {
              resolve(this.regexParsePrescription(rawText));
            }
          } catch (e) {
            resolve(this.regexParsePrescription(rawText));
          }
        });
      });

      req.on('error', () => resolve(this.regexParsePrescription(rawText)));
      req.write(body);
      req.end();
    });
  }

  /**
   * Fallback regex-based prescription parsing
   */
  regexParsePrescription(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const items = [];

    // Common Nigerian drug patterns
    const drugPattern = /(\d+\.?\s*)?([A-Za-z]+(?:\s+[A-Za-z]+)*)\s*(\d+\s*(?:mg|g|ml|mcg|iu))?/gi;

    for (const line of lines) {
      const match = drugPattern.exec(line);
      if (match) {
        const name = match[2]?.trim();
        if (name && name.length > 2 && !['the', 'and', 'for', 'with', 'take'].includes(name.toLowerCase())) {
          items.push({
            drug_name: name,
            generic_name: null,
            dosage: match[3] || null,
            frequency: null,
            duration: null,
            quantity: 1,
            notes: line.trim(),
          });
        }
      }
    }

    return {
      prescriber: { name: null, license: null, facility: null },
      prescriptionDate: null,
      items,
      confidence: 0.3,
    };
  }

  /**
   * Match parsed drug names to the drug catalog
   */
  async matchDrugsToCatalog(items) {
    const pool = getPool();
    const matched = [];

    for (const item of items) {
      const result = await pool.query(
        `SELECT id, name, generic_name, brand_name, category, requires_prescription,
                schedule, dosage_form, strength, substitution_group, is_generic
         FROM ng_drug_catalog
         WHERE is_active = true AND (
           LOWER(name) = LOWER($1)
           OR LOWER(generic_name) = LOWER($1)
           OR LOWER(brand_name) = LOWER($1)
           OR similarity(LOWER(name), LOWER($1)) > 0.3
         )
         ORDER BY similarity(LOWER(name), LOWER($1)) DESC
         LIMIT 3`,
        [item.drug_name]
      ).catch(() => ({ rows: [] })); // If pg_trgm not installed, fallback

      const catalogMatch = result.rows[0] || null;

      matched.push({
        ...item,
        catalogMatch,
        catalogDrugId: catalogMatch?.id || null,
        requiresPrescription: catalogMatch?.requires_prescription || true,
        isControlled: catalogMatch?.schedule ? true : false,
        matchConfidence: catalogMatch ? 0.9 : 0.3,
      });
    }

    return matched;
  }

  /**
   * Pharmacist verifies/rejects a parsed prescription
   */
  async verifyPrescription(prescriptionId, pharmacistUserId, approved, rejectionReason = null) {
    const pool = getPool();

    if (approved) {
      await pool.query(
        `UPDATE ng_prescriptions SET
          status = 'verified',
          verified_by_pharmacist = $1,
          verified_at = NOW(),
          updated_at = NOW()
        WHERE id = $2`,
        [pharmacistUserId, prescriptionId]
      );
    } else {
      await pool.query(
        `UPDATE ng_prescriptions SET
          status = 'rejected',
          verified_by_pharmacist = $1,
          verified_at = NOW(),
          rejection_reason = $2,
          updated_at = NOW()
        WHERE id = $3`,
        [pharmacistUserId, rejectionReason, prescriptionId]
      );
    }

    return { prescriptionId, status: approved ? 'verified' : 'rejected' };
  }
}

module.exports = new PrescriptionParser();
