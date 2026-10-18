'use strict';
const router=require('express').Router();
const {getPool}=require('../../server/db');
const service=require('../services/interop/medicationFhirService');
router.use((req,res,next)=>{
  res.set('Cache-Control','private, no-store');res.type('application/fhir+json');res.vary('Accept');
  if(!service.supportsJson(req.query._format,req.get('Accept')))return res.status(406).json({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-supported',diagnostics:'This interface supports FHIR R4 JSON only.'}]});
  next();
});
router.get('/metadata',(_req,res)=>res.json(service.capability()));
const read=async(req,res)=>{
  try {
    if(Object.keys(req.query).some(key=>!['order','_format'].includes(key)))throw Object.assign(new Error('Unsupported medication search parameter.'),{status:400});
    const type=req.params.type;const id=req.params.id || null;
    const result=await service.read(getPool(),req.user,type==='Bundle'?id:req.query.order,{type,id:type==='Bundle'?null:id});
    res.json(result);
  } catch(error){res.status(error.status || 503).json({resourceType:'OperationOutcome',issue:[{severity:'error',code:error.status===404?'not-found':error.status===403?'forbidden':error.status===400?'invalid':'processing',diagnostics:error.status?error.message:'Medication exchange is temporarily unavailable.'}]});}
};
router.get('/:type/:id',read);router.get('/:type',read);
router.all('*',(_req,res)=>res.status(405).set('Allow','GET').json({resourceType:'OperationOutcome',issue:[{severity:'error',code:'not-supported',diagnostics:'Medication FHIR is a read interface. Changes require the verified prescription and pharmacy workflow.'}]}));
module.exports=router;
