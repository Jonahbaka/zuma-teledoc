'use strict';

const { integrationUnavailable } = require('../utils/integrationReadiness');

/**
 * No operational insurance-card OCR adapter is installed. API keys alone are
 * not an activation signal; never send card images or persist invented fields.
 */
class OCRService {
  assertAvailable() {
    throw integrationUnavailable('Insurance card scanning');
  }

  async processWithGoogleVision() { this.assertAvailable(); }
  async processWithAWSTextract() { this.assertAvailable(); }
  async extractInsuranceCardData() { this.assertAvailable(); }
  async saveInsuranceCardWithOCR() { this.assertAvailable(); }
}

module.exports = new OCRService();

