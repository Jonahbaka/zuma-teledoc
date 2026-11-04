/**
 * Recorded legacy prescription access. New prescribing remains in the
 * encounter-authorized clinical intent workflow.
 */
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../middleware/audit');
const prescriptionService = require('../services/prescriptionService');
const logger = require('../middleware/logger');
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();});
router.param('id',(req,res,next)=>{
  if(!uuid.test(req.params.id))return res.status(400).json({success:false,code:'PRESCRIPTION_INPUT_INVALID',error:'Choose a valid prescription.'});
  return next();
});
function failure(res,error) {
  const status=[400,403,404,409,503].includes(error.statusCode)?error.statusCode:503;
  const code=error.statusCode&&String(error.code||'').match(/^(?:PRESCRIPTION_|INTEGRATION_NOT_ACTIVATED)/)?error.code:'PRESCRIPTION_UNAVAILABLE';
  logger.warn('Recorded prescription request failed',{status,code});
  return res.status(status).json({success:false,code,...(status===503?{status:'unavailable'}:{}),
    error:error.statusCode?error.message:'Prescription records could not be accessed. Try again later.'});
}

router.get('/',authenticate,async(req,res)=>{
  try {
    const prescriptions=req.user.role==='patient'
      ?await prescriptionService.getPatientPrescriptions(req.user.id,req.query,req.user)
      :await prescriptionService.getProviderPrescriptions(req.user.id,req.query,req.user);
    res.json({success:true,prescriptions});
  } catch(error){failure(res,error);}
});

router.get('/medications/search',authenticate,requireRole(['provider','admin','super_admin']),async(_req,res)=>{
  try {const medications=await prescriptionService.searchMedications();res.json({success:true,medications});}
  catch(error){failure(res,error);}
});
router.get('/:id',authenticate,auditMiddleware('read','prescription'),async(req,res)=>{
  try {const prescription=await prescriptionService.getPrescriptionById(req.params.id,req.user);res.json({success:true,prescription});}
  catch(error){failure(res,error);}
});
router.get('/:id/history',authenticate,async(req,res)=>{
  try {const history=await prescriptionService.getPrescriptionHistory(req.params.id,req.user);res.json({success:true,history});}
  catch(error){failure(res,error);}
});

// Each legacy mutation fails before storage or generated delivery/receipt state.
// No operational partner transport or refill-review adapter exists here.
router.post('/',authenticate,requireRole(['provider','admin','super_admin']),auditMiddleware('create','prescription'),async(_req,res)=>{
  try {await prescriptionService.createPrescription();}
  catch(error){failure(res,error);}
});
router.post('/:id/sign-and-send',authenticate,requireRole(['provider','admin','super_admin']),auditMiddleware('update','prescription'),async(_req,res)=>{
  try {await prescriptionService.signAndSend();}
  catch(error){failure(res,error);}
});
router.put('/:id/pharmacy',authenticate,requireRole(['provider','admin','super_admin']),auditMiddleware('update','prescription'),async(_req,res)=>{
  try {await prescriptionService.updatePharmacy();}
  catch(error){failure(res,error);}
});
router.post('/:id/cancel',authenticate,requireRole(['provider','admin','super_admin']),auditMiddleware('update','prescription'),async(_req,res)=>{
  try {await prescriptionService.cancelPrescription();}
  catch(error){failure(res,error);}
});
router.post('/:id/refill',authenticate,requireRole(['patient']),auditMiddleware('update','prescription'),async(_req,res)=>{
  try {await prescriptionService.requestRefill();}
  catch(error){failure(res,error);}
});

module.exports=router;
