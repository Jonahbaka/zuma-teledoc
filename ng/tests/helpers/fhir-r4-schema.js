'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const Ajv=require('ajv');
const bytes=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../fixtures/fhir-r4.schema.json.gz')));
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'2230406893b4cf002a4ee1e5e2bbeca22ac5d2d4931b3e9ef7b9594bbc376a01','Use the pinned, unmodified official HL7 R4 schema');
const ajv=new Ajv({schemaId:'auto',unknownFormats:'ignore',logger:false});
ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-06.json'));
ajv.addSchema(JSON.parse(bytes),'fhir-r4');
module.exports=function assertBaseR4(resource){
  const validate=ajv.getSchema(`fhir-r4#/definitions/${resource.resourceType}`);
  assert.ok(validate,'Official R4 schema must define '+resource.resourceType);
  assert.ok(validate(JSON.parse(JSON.stringify(resource))),JSON.stringify(validate.errors?.slice(0,8)));
};
