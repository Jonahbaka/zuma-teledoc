'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {portalReturnPath}=require('../../lib/portalSignIn.cjs');
test('sign-in resumes only a page in the selected role and market portal',()=>{
  assert.equal(portalReturnPath('/ng/admin/pharmacy-integrations?tab=review','/ng/admin'),'/ng/admin/pharmacy-integrations?tab=review');
  assert.equal(portalReturnPath('/patient/records#documents','/patient'),'/patient/records#documents');
  for(const value of ['https://outside.invalid/path','//outside.invalid','/provider/dashboard','/ng/admin/../../patient/records','/ng/admin/%2e%2e/%2e%2e/patient','/ng/admin/%2f..%2f..%2fpatient','/ng/admin/\\outside.invalid','/ng/admin/%5c%5coutside.invalid','/ng/admin/%00private','/ng/admin/%invalid'])assert.equal(portalReturnPath(value,'/ng/admin'),null,value);
});
