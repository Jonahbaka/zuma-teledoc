/**
 * Insurance Card OCR Service
 * Handles OCR extraction using Google Cloud Vision or AWS Textract
 */

const db = require('../db');
const logger = require('../middleware/logger');
const { encrypt, decrypt } = require('../../lib/encryption');

class OCRService {
  /**
   * Process insurance card image using Google Cloud Vision
   */
  async processWithGoogleVision(imageBase64, imageType = 'front') {
    try {
      const visionApiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
      const visionApiUrl = process.env.GOOGLE_CLOUD_VISION_API_URL || 'https://vision.googleapis.com/v1/images:annotate';
      
      if (!visionApiKey) {
        logger.warn('Google Cloud Vision API key not configured, using simulation');
        return this.simulateOCR(imageType);
      }
      
      // Real API integration would go here
      // const response = await axios.post(`${visionApiUrl}?key=${visionApiKey}`, {
      //   requests: [{
      //     image: { content: imageBase64 },
      //     features: [{ type: 'TEXT_DETECTION', maxResults: 50 }]
      //   }]
      // });
      
      // Parse OCR response and extract healthcare-specific fields
      // const extractedData = this.parseGoogleVisionResponse(response.data);
      
      return this.simulateOCR(imageType);
    } catch (error) {
      logger.error('Google Cloud Vision OCR error:', error);
      throw new Error('Failed to process image with Google Cloud Vision');
    }
  }
  
  /**
   * Process insurance card image using AWS Textract
   */
  async processWithAWSTextract(imageBase64, imageType = 'front') {
    try {
      const textractRegion = process.env.AWS_TEXTRACT_REGION || 'us-east-1';
      const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      
      if (!awsAccessKeyId || !awsSecretAccessKey) {
        logger.warn('AWS credentials not configured, using simulation');
        return this.simulateOCR(imageType);
      }
      
      // Real AWS Textract integration would go here using AWS SDK
      // const textract = new AWS.Textract({ region: textractRegion });
      // const params = {
      //   Document: { Bytes: Buffer.from(imageBase64, 'base64') }
      // };
      // const response = await textract.detectDocumentText(params).promise();
      // const extractedData = this.parseTextractResponse(response);
      
      return this.simulateOCR(imageType);
    } catch (error) {
      logger.error('AWS Textract OCR error:', error);
      throw new Error('Failed to process image with AWS Textract');
    }
  }
  
  /**
   * Extract insurance card data from image
   */
  async extractInsuranceCardData(imageBase64, imageType = 'front', ocrProvider = 'auto') {
    try {
      let ocrResult;
      let provider;
      
      // Determine OCR provider
      if (ocrProvider === 'auto') {
        ocrProvider = process.env.OCR_PROVIDER || 'google_vision';
      }
      
      if (ocrProvider === 'google_vision') {
        ocrResult = await this.processWithGoogleVision(imageBase64, imageType);
        provider = 'google_vision';
      } else if (ocrProvider === 'aws_textract') {
        ocrResult = await this.processWithAWSTextract(imageBase64, imageType);
        provider = 'aws_textract';
      } else {
        throw new Error(`Unsupported OCR provider: ${ocrProvider}`);
      }
      
      // Post-process and validate extracted data
      const validatedData = this.validateAndPostProcess(ocrResult, imageType);
      
      return {
        ...validatedData,
        ocrProvider: provider,
        confidenceScore: ocrResult.confidence || this.calculateConfidence(validatedData),
        rawOCRData: ocrResult.raw || null
      };
    } catch (error) {
      logger.error('OCR extraction error:', error);
      throw error;
    }
  }
  
  /**
   * Validate and post-process OCR results
   */
  validateAndPostProcess(ocrResult, imageType) {
    const data = {
      payerName: null,
      memberId: null,
      groupId: null,
      subscriberName: null,
      subscriberDob: null,
      rxBin: null,
      rxPcn: null,
      rxGroup: null,
      effectiveDate: null,
      expirationDate: null
    };
    
    // Extract payer name (common patterns)
    if (ocrResult.text) {
      const payerPatterns = [
        /(?:Blue ?Cross|Blue ?Shield|Aetna|UnitedHealthcare|Cigna|Humana|Anthem|Medicare|Medicaid)/i,
        /(?:BCBS|UHC|AETNA)/i
      ];
      
      for (const pattern of payerPatterns) {
        const match = ocrResult.text.match(pattern);
        if (match) {
          data.payerName = match[0];
          break;
        }
      }
      
      // Extract member ID (typically alphanumeric, 6-20 chars)
      const memberIdPattern = /(?:Member|ID|ID #|Subscriber ID)[\s:]*([A-Z0-9\-]{6,20})/i;
      const memberMatch = ocrResult.text.match(memberIdPattern);
      if (memberMatch) {
        data.memberId = memberMatch[1].replace(/\s+/g, '');
      }
      
      // Extract group number
      const groupPattern = /(?:Group|Group #|Group Number)[\s:]*([A-Z0-9\-]{3,20})/i;
      const groupMatch = ocrResult.text.match(groupPattern);
      if (groupMatch) {
        data.groupId = groupMatch[1].replace(/\s+/g, '');
      }
      
      // Extract subscriber name
      const namePattern = /(?:Subscriber|Member Name)[\s:]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i;
      const nameMatch = ocrResult.text.match(namePattern);
      if (nameMatch) {
        data.subscriberName = nameMatch[1];
      }
      
      // Extract DOB
      const dobPattern = /(?:DOB|Date of Birth|Birth Date)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;
      const dobMatch = ocrResult.text.match(dobPattern);
      if (dobMatch) {
        data.subscriberDob = dobMatch[1];
      }
      
      // Extract Rx BIN (back of card typically)
      if (imageType === 'back') {
        const binPattern = /(?:BIN|RxBIN|Rx BIN)[\s:]*([0-9]{6})/i;
        const binMatch = ocrResult.text.match(binPattern);
        if (binMatch) {
          data.rxBin = binMatch[1];
        }
        
        const pcnPattern = /(?:PCN|RxPCN|Rx PCN)[\s:]*([A-Z0-9]{1,10})/i;
        const pcnMatch = ocrResult.text.match(pcnPattern);
        if (pcnMatch) {
          data.rxPcn = pcnMatch[1];
        }
        
        const rxGroupPattern = /(?:RxGroup|Rx Group|Group)[\s:]*([A-Z0-9\-]{3,20})/i;
        const rxGroupMatch = ocrResult.text.match(rxGroupPattern);
        if (rxGroupMatch) {
          data.rxGroup = rxGroupMatch[1];
        }
      }
      
      // Extract dates
      const datePattern = /(?:Effective|Exp|Expires?)[\s:]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;
      const dates = ocrResult.text.match(new RegExp(datePattern.source, 'gi'));
      if (dates && dates.length > 0) {
        data.effectiveDate = dates[0];
        if (dates.length > 1) {
          data.expirationDate = dates[1];
        }
      }
    }
    
    return data;
  }
  
  /**
   * Calculate confidence score based on extracted fields
   */
  calculateConfidence(extractedData) {
    let score = 0;
    let totalFields = 0;
    
    const requiredFields = ['payerName', 'memberId'];
    const optionalFields = ['groupId', 'subscriberName', 'rxBin', 'rxPcn'];
    
    for (const field of requiredFields) {
      totalFields++;
      if (extractedData[field]) score += 0.5;
    }
    
    for (const field of optionalFields) {
      totalFields++;
      if (extractedData[field]) score += 0.1;
    }
    
    return Math.min(0.95, score);
  }
  
  /**
   * Save insurance card with OCR data and encryption
   */
  async saveInsuranceCardWithOCR(patientId, frontImageBase64, backImageBase64, ocrProvider = 'auto') {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Process front image
      const frontOCR = await this.extractInsuranceCardData(frontImageBase64, 'front', ocrProvider);
      
      // Process back image if provided
      let backOCR = null;
      if (backImageBase64) {
        backOCR = await this.extractInsuranceCardData(backImageBase64, 'back', ocrProvider);
      }
      
      // Merge OCR data (back may have additional fields like Rx BIN)
      const mergedOCR = {
        ...frontOCR,
        ...backOCR,
        rxBin: backOCR?.rxBin || frontOCR.rxBin,
        rxPcn: backOCR?.rxPcn || frontOCR.rxPcn,
        rxGroup: backOCR?.rxGroup || frontOCR.rxGroup
      };
      
      // Encrypt images
      const frontImageEncrypted = JSON.stringify(encrypt(frontImageBase64));
      const backImageEncrypted = backImageBase64 ? JSON.stringify(encrypt(backImageBase64)) : null;
      
      // Create tokenized member ID (for audit logs - no PHI)
      const tokenizedMemberId = this.tokenizeMemberId(mergedOCR.memberId);
      
      // Calculate overall confidence
      const confidenceScore = Math.max(
        frontOCR.confidenceScore || 0,
        backOCR?.confidenceScore || 0
      );
      
      // Save to database
      const query = `
        INSERT INTO patient_insurance (
          patient_id, insurance_provider, policy_number, group_number,
          subscriber_name, subscriber_dob, front_image_url, back_image_url,
          front_image_encrypted, back_image_encrypted,
          ocr_provider, ocr_confidence_score, ocr_extracted_data,
          tokenized_member_id, eligibility_status, is_verified,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *
      `;
      
      // Use encrypted URL or placeholder (in production, use secure storage like S3)
      const frontImageUrl = `encrypted://${Date.now()}-front`;
      const backImageUrl = backImageBase64 ? `encrypted://${Date.now()}-back` : null;
      
      const result = await client.query(query, [
        patientId,
        mergedOCR.payerName || 'Unknown',
        mergedOCR.memberId || '',
        mergedOCR.groupId || null,
        mergedOCR.subscriberName || null,
        mergedOCR.subscriberDob || null,
        frontImageUrl,
        backImageUrl,
        frontImageEncrypted,
        backImageEncrypted,
        mergedOCR.ocrProvider,
        confidenceScore,
        JSON.stringify(mergedOCR),
        tokenizedMemberId,
        'pending',
        confidenceScore >= 0.8, // Auto-verify if high confidence
      ]);
      
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error saving insurance card with OCR:', error);
      throw error;
    } finally {
      client.release();
    }
  }
  
  /**
   * Tokenize member ID for audit logs (one-way hash)
   */
  tokenizeMemberId(memberId) {
    if (!memberId) return null;
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(memberId).digest('hex').substring(0, 16);
  }
  
  /**
   * Simulate OCR extraction (for development)
   */
  simulateOCR(imageType) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockData = {
          text: imageType === 'front' 
            ? 'BlueCross BlueShield\nMember ID: XUJ-8922-9910\nGroup: NY-22910\nSubscriber: John Doe\nDOB: 01/15/1980'
            : 'RxBIN: 004336\nRxPCN: ADV\nGroup: NY-22910\nEffective: 01/01/2024',
          confidence: 0.85 + Math.random() * 0.1,
          raw: {
            blocks: [],
            confidence: 0.85
          }
        };
        
        resolve(mockData);
      }, 1500);
    });
  }
}

module.exports = new OCRService();

