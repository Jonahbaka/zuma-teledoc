'use strict';

const express = require('express');
const { authenticate } = require('../middleware/auth');
const records = require('../services/medicalRecordService');
const logger = require('../middleware/logger');
const router = express.Router();

// Service transactions recheck current account/care/market and retain audit
// before returning plaintext. A technical or government title is not care access.
router.use((_req,res,next)=>{res.set('Cache-Control','private, no-store');next();},authenticate);
const handle = (operation) => async(req,res)=>{
  try { await operation(req,res); }
  catch(error) {
    const status=[400,403,404,409,503].includes(error.statusCode)?error.statusCode:503;
    logger.error('Medical document operation failed',{code:error.code || 'MEDICAL_RECORD_UNAVAILABLE',status});
    res.status(status).json({success:false,code:status<500?error.code:'MEDICAL_RECORD_UNAVAILABLE',
      error:status<500?error.message:'Medical documents are temporarily unavailable. No change has been confirmed.'});
  }
};
router.post('/',handle(async(req,res)=>res.status(201).json({success:true,message:'Medical document recorded',record:await records.create(req.user,req.body)})));
router.get('/patient/:patientId',handle(async(req,res)=>res.json({success:true,...await records.list(req.user,req.params.patientId,req.query)})));
router.get('/export/:patientId',handle(async(req,res)=>res.json({success:true,...await records.exportRecords(req.user,req.params.patientId)})));
router.get('/:id/history',handle(async(req,res)=>res.json({success:true,revisions:await records.history(req.user,req.params.id)})));
router.get('/:id',handle(async(req,res)=>res.json({success:true,record:await records.read(req.user,req.params.id)})));
router.put('/:id',handle(async(req,res)=>res.json({success:true,message:'Medical document revision recorded',record:await records.update(req.user,req.params.id,req.body)})));
router.delete('/:id',handle(async(req,res)=>res.json({success:true,message:'Medical document withdrawn; its recorded revisions are retained',record:await records.withdraw(req.user,req.params.id,req.body)})));
module.exports=router;
