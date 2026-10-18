'use strict';

const express = require('express');
const { z } = require('zod');
const { getPool } = require('../../server/db');
const { requireProgrammeScope } = require('../middleware/programmeScope');
const { recordProgrammeAudit } = require('../services/phc/programmeScopeService');
const service = require('../services/interop/clinicalFhirService');
const capability = require('../services/interop/phcFhirCapabilityService');

const router = express.Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.use(requireProgrammeScope({ allowedRoles: ['phc_nurse', 'remote_clinician', 'clinical_supervisor', 'on_call_clinician'] }));

router.get('/metadata', (req, res) => {
  res.vary('Accept');
  res.set('Content-Type', 'application/fhir+json');
  if (!capability.supportsMetadataJson(req.query._format, req.get('Accept'))) {
    return res.status(406).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'This interface provides FHIR R4 JSON only.' }] });
  }
  const statement = capability.getCapabilityStatement();
  res.set('ETag', capability.metadataETag(statement));
  return res.json(statement);
});

function read(handler) {
  return async (req, res) => {
    try {
      const id = req.params.id || req.query.encounter;
      if (!z.string().uuid().safeParse(id).success) return res.status(400).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'invalid', diagnostics: 'A valid resource identifier is required.' }] });
      const resource = await handler(req, id);
      await recordProgrammeAudit(getPool(), req, req.programmeContext, {
        action: 'fhir_read', resourceType: resource.resourceType, resourceId: id,
        purpose: 'Clinical interoperability read', dataClass: 'sensitive',
      });
      res.set('Content-Type', 'application/fhir+json').json(resource);
    } catch (error) {
      res.status(error.statusCode || 500).json({ resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: error.statusCode === 404 ? 'not-found' : 'forbidden', diagnostics: error.statusCode ? error.message : 'Clinical interoperability read failed.' }] });
    }
  };
}

router.get(capability.RESOURCE_PATHS.Patient, read((req, id) => service.patient(getPool(), req.programmeContext, id)));
router.get(capability.RESOURCE_PATHS.Encounter, read((req, id) => service.encounter(getPool(), req.programmeContext, id)));
router.get(capability.RESOURCE_PATHS.Observation, read(async (req, id) => {
  const resources = await service.observations(getPool(), req.programmeContext, id);
  const count = Math.min(Math.max(Number.parseInt(req.query._count, 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(req.query._offset, 10) || 0, 0);
  const bundle = { resourceType: 'Bundle', type: 'searchset', total: resources.length, entry: resources.slice(offset, offset + count).map((resource) => ({ resource, search: { mode: 'match' } })) };
  if (offset + count < resources.length) {
    const params = new URLSearchParams({ encounter: id, programmeId: req.programmeContext.programme_id, facilityId: req.programmeContext.facility_id, _count: String(count), _offset: String(offset + count) });
    bundle.link = [{ relation: 'next', url: `/api/ng/interop/fhir/Observation?${params}` }];
  }
  return bundle;
}));

for(const [type,handler] of [['AllergyIntolerance',service.allergies],['Condition',service.conditions],['DiagnosticReport',service.diagnosticReports]]) {
  router.get(capability.RESOURCE_PATHS[type],read(async(req,id)=>{
    const resources=await handler(getPool(),req.programmeContext,id);
    const count=Math.min(Math.max(Number.parseInt(req.query._count,10)||50,1),200);
    const offset=Math.max(Number.parseInt(req.query._offset,10)||0,0);
    const bundle={resourceType:'Bundle',type:'searchset',total:resources.length,entry:resources.slice(offset,offset+count).map(resource=>({resource,search:{mode:'match'}}))};
    if(offset+count<resources.length){const params=new URLSearchParams({encounter:id,programmeId:req.programmeContext.programme_id,facilityId:req.programmeContext.facility_id,_count:String(count),_offset:String(offset+count)});bundle.link=[{relation:'next',url:`/api/ng/interop/fhir/${type}?${params}`}];}
    return bundle;
  }));
}
module.exports = router;
