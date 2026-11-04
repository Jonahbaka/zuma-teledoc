'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const referralRouter = require('../routes/referralNetwork');

const originalAuthorization = process.env.NG_MEDICAL_IMAGING_AUTHORIZED;

afterEach(() => {
  if (originalAuthorization === undefined) delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED;
  else process.env.NG_MEDICAL_IMAGING_AUTHORIZED = originalAuthorization;
});

test('Nigeria referral APIs hide imaging specialties unless explicitly authorized', () => {
  delete process.env.NG_MEDICAL_IMAGING_AUTHORIZED;
  const { imagingVisible, isMedicalImaging } = referralRouter._test;

  assert.equal(isMedicalImaging('imaging_mri'), true);
  assert.equal(isMedicalImaging({ specialty: 'imaging_ct', service_kind: 'consultation' }), true);
  assert.equal(isMedicalImaging({ specialty: 'lab_general', service_kind: 'imaging' }), true);
  assert.equal(imagingVisible({ specialty: 'imaging_mri', service_kind: 'imaging' }), false);
  assert.equal(imagingVisible({ specialty: 'lab_general', service_kind: 'lab' }), true);
});

test('Nigeria imaging visibility requires the explicit server authorization flag', () => {
  process.env.NG_MEDICAL_IMAGING_AUTHORIZED = 'true';
  assert.equal(referralRouter._test.imagingVisible({ specialty: 'imaging_mri', service_kind: 'imaging' }), true);
});
