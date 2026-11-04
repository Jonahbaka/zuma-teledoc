'use strict';

const express = require('express');
const { z } = require('zod');
const { getPool } = require('../../server/db');
const { requireProgrammeScope } = require('../middleware/programmeScope');
const rbac = require('../middleware/rbac');
const {
  listUserProgrammeContexts,
  recordProgrammeAudit,
} = require('../services/phc/programmeScopeService');
const workflow = require('../services/phc/phcWorkflowService');
const offlineSync = require('../services/phc/offlineSyncService');
const reporting = require('../services/phc/programmeReportingService');
const clinicalAi = require('../services/phc/clinicalAiService');
const devices = require('../services/phc/deviceGatewayService');

const router = express.Router();

const uuid = z.string().uuid();
const idempotencyKey = uuid;
const clinicalRoles = ['phc_nurse', 'remote_clinician', 'clinical_supervisor', 'on_call_clinician'];
const intakeRoles = ['phc_nurse', 'remote_clinician'];
const followUpRoles = ['phc_nurse', 'remote_clinician', 'referral_coordinator'];
const reportingRoles = [
  'facility_admin', 'programme_admin', 'government_analyst',
  'government_reviewer', 'government_approver', 'executive_read_only',
];

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Request validation failed.',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    req.validatedBody = parsed.data;
    next();
  };
}

function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!error.statusCode) console.error('[PHC]', error.message);
      res.status(error.statusCode || 500).json({
        error: error.statusCode ? error.message : 'PHC operation failed.',
        code: error.code || 'PHC_OPERATION_FAILED',
      });
    }
  };
}

function scoped(allowedRoles, options = {}) {
  return requireProgrammeScope({ allowedRoles, ...options });
}

function requireMfaForGovernmentProgrammeRole(req, res, next) {
  const role = req.programmeContext?.programmeRole;
  if (role?.startsWith('government_') || role === 'executive_read_only') {
    return rbac.requireGovernmentMfa(req, res, next);
  }
  next();
}

router.get('/contexts', asyncHandler(async (req, res) => {
  const contexts = await listUserProgrammeContexts(getPool(), req.user);
  res.json({ ok: true, contexts });
}));

router.get(
  '/configuration',
  scoped([
    'phc_nurse', 'remote_clinician', 'clinical_supervisor', 'on_call_clinician',
    'facility_coordinator', 'facility_admin', 'referral_coordinator', 'programme_admin',
    ...reportingRoles,
  ]),
  asyncHandler(async (req, res) => {
    const capabilities = await offlineSync.getProgrammeCapabilities(getPool(), req.programmeContext);
    res.json({ ok: true, capabilities });
  })
);

const deviceRegistrationSchema = z.object({
  devicePublicId: uuid,
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
  publicKeyJwk: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.object({
    platform: z.string().trim().max(80).optional(),
    browser: z.string().trim().max(120).optional(),
    appVersion: z.string().trim().max(40).optional(),
  }).optional().default({}),
});

router.post(
  '/sync/devices',
  scoped(['phc_nurse']),
  validate(deviceRegistrationSchema),
  asyncHandler(async (req, res) => {
    const device = await offlineSync.registerDevice(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, device });
  })
);

router.get(
  '/devices/capabilities',
  scoped(['phc_nurse', 'facility_admin', 'programme_admin']),
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, adapters: devices.ADAPTER_CAPABILITIES });
  })
);

router.get(
  '/devices',
  scoped(['phc_nurse', 'facility_admin', 'programme_admin']),
  asyncHandler(async (req, res) => {
    const registered = await devices.listDevices(getPool(), req.programmeContext);
    res.json({ ok: true, devices: registered, count: registered.length });
  })
);

const clinicalDeviceSchema = z.object({
  deviceType: z.string().trim().min(1).max(100),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serialNumber: z.string().trim().max(200).nullable().optional(),
  calibrationStatus: z.enum(['unknown', 'current', 'due', 'failed', 'not_required']).optional(),
  adapterKey: z.enum(['manual_entry', 'mock_device_v1']),
});

router.post(
  '/devices',
  scoped(['facility_admin', 'programme_admin']),
  validate(clinicalDeviceSchema),
  asyncHandler(async (req, res) => {
    const device = await devices.registerDevice(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, device });
  })
);

router.post(
  '/devices/mock-capture',
  scoped(['phc_nurse']),
  validate(z.object({
    deviceId: uuid,
    encounterId: uuid,
    fixtureName: z.enum(['blood_pressure', 'oxygen_saturation']),
    idempotencyKey,
  })),
  asyncHandler(async (req, res) => {
    const capture = await devices.captureMockFixture(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, ...capture });
  })
);

router.get(
  '/patients/search',
  scoped(['phc_nurse', 'remote_clinician', 'facility_coordinator', 'facility_admin', 'referral_coordinator']),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const patients = await workflow.searchPatients(pool, req.programmeContext, req.query.q, req.query.limit);
    await recordProgrammeAudit(pool, req, req.programmeContext, {
      action: 'patient_search',
      resourceType: 'programme_patient_enrollment',
      purpose: 'PHC patient identification',
      dataClass: 'sensitive',
      metadata: { queryHash: workflow.hashNormalized(req.query.q), resultCount: patients.length },
    });
    res.json({ ok: true, patients, count: patients.length });
  })
);

const enrollmentSchema = z.object({
  patientUserId: uuid,
  localPatientNumber: z.string().trim().min(1).max(80).nullable().optional(),
  consentStatus: z.enum(['granted', 'declined', 'revoked']),
  consentVersion: z.string().trim().min(1).max(80),
  signatureEvidence: z.record(z.string(), z.unknown()).optional().default({}),
});

router.post(
  '/enrollments',
  scoped(['phc_nurse', 'facility_coordinator', 'facility_admin', 'programme_admin']),
  validate(enrollmentSchema),
  asyncHandler(async (req, res) => {
    const enrollment = await workflow.enrollPatient(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, enrollment });
  })
);

const encounterSchema = z.object({
  patientUserId: uuid,
  encounterType: z.string().trim().min(1).max(100).optional(),
  chiefComplaint: z.string().trim().max(5000).nullable().optional(),
  reasonForVisit: z.string().trim().max(5000).nullable().optional(),
  identityVerified: z.boolean().optional(),
  identityVerificationMethod: z.string().trim().max(100).nullable().optional(),
  idempotencyKey,
});

router.post(
  '/encounters',
  scoped(intakeRoles),
  validate(encounterSchema),
  asyncHandler(async (req, res) => {
    const encounter = await workflow.createEncounter(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, encounter });
  })
);

router.get(
  '/encounters/:id',
  scoped(clinicalRoles),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const encounter = await workflow.getEncounter(pool, req.programmeContext, req.params.id);
    await recordProgrammeAudit(pool, req, req.programmeContext, {
      action: 'encounter_viewed',
      resourceType: 'clinical_encounter',
      resourceId: encounter.id,
      patientUserId: encounter.patient_user_id,
      purpose: 'PHC care delivery',
      dataClass: 'sensitive',
    });
    res.json({ ok: true, encounter });
  })
);

const observationSchema = z.object({
  encounterId: uuid,
  observationCode: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(255),
  valueType: z.enum(['numeric', 'text', 'coded', 'boolean', 'quantity_pair']),
  valueNumeric: z.number().finite().nullable().optional(),
  valueNumericSecondary: z.number().finite().nullable().optional(),
  valueText: z.string().trim().max(2000).nullable().optional(),
  valueCode: z.string().trim().max(100).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  method: z.enum(['manual', 'device']).optional().default('manual'),
  deviceId: uuid.nullable().optional(),
  observedAt: z.string().datetime(),
  idempotencyKey,
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
}).superRefine((value, ctx) => {
  if (value.valueType === 'numeric' && value.valueNumeric == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueNumeric'], message: 'Numeric value is required.' });
  }
  if (value.valueType === 'quantity_pair'
    && (value.valueNumeric == null || value.valueNumericSecondary == null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueNumericSecondary'], message: 'Both quantity values are required.' });
  }
  if (value.method === 'device' && !value.deviceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deviceId'], message: 'Device is required.' });
  }
});

router.post(
  '/observations',
  scoped(intakeRoles),
  validate(observationSchema),
  asyncHandler(async (req, res) => {
    const observation = await workflow.createObservation(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, observation });
  })
);

router.get(
  '/encounters/:id/observations',
  scoped(clinicalRoles),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const result = await workflow.listObservations(pool, req.programmeContext, req.params.id);
    await recordProgrammeAudit(pool, req, req.programmeContext, {
      action: 'observations_viewed',
      resourceType: 'clinical_observation',
      resourceId: result.encounter.id,
      patientUserId: result.encounter.patient_user_id,
      purpose: 'PHC care delivery',
      dataClass: 'sensitive',
      metadata: { count: result.observations.length },
    });
    res.json({ ok: true, observations: result.observations, count: result.observations.length });
  })
);

const enqueueSchema = z.object({
  encounterId: uuid,
  requestedSpecialty: z.string().trim().max(100).nullable().optional(),
  priority: z.enum(['emergency', 'urgent', 'priority', 'routine']).optional(),
  priorityScore: z.number().int().min(0).max(100).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  idempotencyKey,
});

const syncEncounterPayloadSchema = encounterSchema.omit({ idempotencyKey: true });
const syncObservationPayloadSchema = z.object({
  encounterId: uuid,
  observationCode: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(255),
  valueType: z.enum(['numeric', 'text', 'coded', 'boolean', 'quantity_pair']),
  valueNumeric: z.number().finite().nullable().optional(),
  valueNumericSecondary: z.number().finite().nullable().optional(),
  valueText: z.string().trim().max(2000).nullable().optional(),
  valueCode: z.string().trim().max(100).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(),
  method: z.literal('manual').default('manual'),
  observedAt: z.string().datetime(),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
}).superRefine((value, ctx) => {
  if (value.valueType === 'numeric' && value.valueNumeric == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueNumeric'], message: 'Numeric value is required.' });
  }
  if (value.valueType === 'quantity_pair'
    && (value.valueNumeric == null || value.valueNumericSecondary == null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['valueNumericSecondary'], message: 'Both quantity values are required.' });
  }
});
const syncQueuePayloadSchema = enqueueSchema.omit({ idempotencyKey: true });
const syncOperationBase = {
  operationId: uuid,
  operationType: z.literal('create'),
  entityId: uuid.nullable().optional(),
  clientRecordVersion: z.number().int().positive().nullable().optional(),
};
const syncBatchSchema = z.object({
  devicePublicId: uuid,
  operations: z.array(z.discriminatedUnion('entityType', [
    z.object({ ...syncOperationBase, entityType: z.literal('encounter_draft'), entityId: uuid, payload: syncEncounterPayloadSchema }),
    z.object({ ...syncOperationBase, entityType: z.literal('observation'), payload: syncObservationPayloadSchema }),
    z.object({ ...syncOperationBase, entityType: z.literal('queue_entry'), payload: syncQueuePayloadSchema }),
  ])).min(1).max(50),
});

router.post(
  '/sync',
  scoped(['phc_nurse']),
  validate(syncBatchSchema),
  asyncHandler(async (req, res) => {
    const result = await offlineSync.synchronizeBatch(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/queue',
  scoped(['phc_nurse']),
  validate(enqueueSchema),
  asyncHandler(async (req, res) => {
    const queueEntry = await workflow.enqueueEncounter(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, queueEntry });
  })
);

router.get(
  '/queue',
  scoped(clinicalRoles),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const entries = await workflow.listQueue(pool, req.programmeContext, req.query);
    await recordProgrammeAudit(pool, req, req.programmeContext, {
      action: 'queue_viewed',
      resourceType: 'phc_queue_entry',
      purpose: 'PHC care operations',
      dataClass: 'sensitive',
      metadata: { count: entries.length },
    });
    res.json({ ok: true, entries, count: entries.length });
  })
);

router.post(
  '/queue/claim',
  scoped(['remote_clinician']),
  validate(z.object({ queueEntryId: uuid.nullable().optional() })),
  asyncHandler(async (req, res) => {
    const queueEntry = await workflow.claimQueueEntry(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.json({ ok: true, queueEntry });
  })
);

const queueTransitionSchema = z.object({
  toStatus: z.enum([
    'waiting', 'claimed', 'called', 'in_consultation', 'on_hold',
    'completed', 'cancelled', 'no_show', 'left_without_being_seen',
  ]),
  reason: z.string().trim().max(2000).nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.toStatus === 'on_hold' && (!value.reason || value.reason.length < 3)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'A hold reason is required.' });
  }
});

router.patch(
  '/queue/:id/status',
  scoped(intakeRoles),
  validate(queueTransitionSchema),
  asyncHandler(async (req, res) => {
    const queueEntry = await workflow.transitionQueueEntry(
      getPool(), req, req.programmeContext,
      { queueEntryId: req.params.id, ...req.validatedBody }
    );
    res.json({ ok: true, queueEntry });
  })
);

const followUpSchema = z.object({
  patientUserId: uuid,
  encounterId: uuid.nullable().optional(),
  referralId: uuid.nullable().optional(),
  taskType: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(255),
  instructions: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(['urgent', 'priority', 'routine']).optional(),
  assignedRole: z.string().trim().max(100).nullable().optional(),
  assignedUserId: uuid.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  idempotencyKey,
});

router.post(
  '/follow-ups',
  scoped(followUpRoles),
  validate(followUpSchema),
  asyncHandler(async (req, res) => {
    const task = await workflow.createFollowUp(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, task });
  })
);

router.get(
  '/follow-ups',
  scoped(followUpRoles),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const tasks = await workflow.listFollowUps(pool, req.programmeContext, req.query);
    await recordProgrammeAudit(pool, req, req.programmeContext, {
      action: 'follow_up_worklist_viewed',
      resourceType: 'follow_up_task',
      purpose: 'Care continuity',
      dataClass: 'sensitive',
      metadata: { count: tasks.length },
    });
    res.json({ ok: true, tasks, count: tasks.length });
  })
);

const referralSchema = z.object({
  patientUserId: uuid,
  encounterId: uuid,
  targetOrganizationId: uuid.nullable().optional(),
  targetHospitalId: uuid.nullable().optional(),
  targetName: z.string().trim().max(255).nullable().optional(),
  destinationType: z.string().trim().min(1).max(80).optional(),
  referralType: z.string().trim().min(1).max(80).optional(),
  priority: z.enum(['routine', 'urgent', 'emergency']).optional(),
  reason: z.string().trim().min(1).max(5000),
  clinicalNotes: z.string().trim().max(10000).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  idempotencyKey,
});

router.post(
  '/referrals',
  scoped(['remote_clinician']),
  validate(referralSchema),
  asyncHandler(async (req, res) => {
    const referral = await workflow.createReferral(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, referral });
  })
);

router.get(
  '/referrals',
  scoped(['remote_clinician', 'referral_coordinator']),
  asyncHandler(async (req, res) => {
    const pool = getPool();
    const referrals = await workflow.listReferrals(pool, req.programmeContext, req.query);
    await recordProgrammeAudit(pool, req, req.programmeContext, {
      action: 'referral_worklist_viewed',
      resourceType: 'referral',
      purpose: 'Referral coordination and closure',
      dataClass: 'sensitive',
      metadata: { count: referrals.length },
    });
    res.json({ ok: true, referrals, count: referrals.length });
  })
);

const referralTransitionSchema = z.object({
  toStatus: z.enum(['sent', 'accepted', 'declined', 'completed', 'cancelled']),
  responseSummary: z.string().trim().max(5000).nullable().optional(),
});

router.patch(
  '/referrals/:id/status',
  scoped(['remote_clinician', 'referral_coordinator']),
  validate(referralTransitionSchema),
  asyncHandler(async (req, res) => {
    const referral = await workflow.transitionReferral(
      getPool(), req, req.programmeContext,
      { referralId: req.params.id, ...req.validatedBody }
    );
    res.json({ ok: true, referral });
  })
);

router.get(
  '/reports/preview',
  scoped(reportingRoles),
  requireMfaForGovernmentProgrammeRole,
  asyncHandler(async (req, res) => {
    const preview = await reporting.previewReport(
      getPool(), req.programmeContext, req.query.period
    );
    await recordProgrammeAudit(getPool(), req, req.programmeContext, {
      action: 'aggregate_report_previewed',
      resourceType: 'public_health_report_preview',
      purpose: 'Programme performance reporting',
      dataClass: 'aggregate',
      metadata: { period: preview.period, indicatorCount: preview.values.length },
    });
    res.json({ ok: true, preview });
  })
);

const reportGenerationSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  notes: z.string().trim().max(2000).nullable().optional(),
});

router.post(
  '/reports',
  scoped(['facility_admin', 'programme_admin', 'government_analyst']),
  requireMfaForGovernmentProgrammeRole,
  validate(reportGenerationSchema),
  asyncHandler(async (req, res) => {
    const report = await reporting.generateReport(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, ...report });
  })
);

router.get(
  '/reports',
  scoped(reportingRoles),
  requireMfaForGovernmentProgrammeRole,
  asyncHandler(async (req, res) => {
    const reports = await reporting.listReports(
      getPool(), req.programmeContext, req.query.limit
    );
    res.json({ ok: true, reports, count: reports.length });
  })
);

router.post(
  '/reports/:id/dhis2-preview',
  scoped(['programme_admin', 'government_analyst', 'government_reviewer', 'government_approver']),
  requireMfaForGovernmentProgrammeRole,
  asyncHandler(async (req, res) => {
    if (!req.programmeContext.canExport) {
      return res.status(403).json({ error: 'Programme export authority required.', code: 'PROGRAMME_EXPORT_AUTHORITY_REQUIRED' });
    }
    const preview = await reporting.buildDhis2DryRun(
      getPool(), req, req.programmeContext, req.params.id
    );
    res.json({ ok: true, preview });
  })
);

const aiSuggestionSchema = z.object({
  encounterId: uuid,
  suggestionType: z.enum([
    'encounter_summary', 'soap_draft', 'missing_information', 'follow_up_draft',
  ]),
});

router.post(
  '/ai/suggestions',
  scoped(['phc_nurse', 'remote_clinician']),
  validate(aiSuggestionSchema),
  asyncHandler(async (req, res) => {
    const suggestion = await clinicalAi.createSuggestion(
      getPool(), req, req.programmeContext, req.validatedBody
    );
    res.status(201).json({ ok: true, suggestion });
  })
);

router.get(
  '/ai/encounters/:encounterId/suggestions',
  scoped(clinicalRoles),
  asyncHandler(async (req, res) => {
    const suggestions = await clinicalAi.listSuggestions(
      getPool(), req.programmeContext, req.params.encounterId
    );
    res.json({ ok: true, suggestions, count: suggestions.length });
  })
);

router.get(
  '/ai/suggestions/:id',
  scoped(clinicalRoles),
  asyncHandler(async (req, res) => {
    const suggestion = await clinicalAi.getSuggestion(
      getPool(), req.programmeContext, req.params.id
    );
    await recordProgrammeAudit(getPool(), req, req.programmeContext, {
      action: 'clinical_ai_draft_viewed',
      resourceType: 'clinical_ai_suggestion',
      resourceId: suggestion.id,
      patientUserId: suggestion.patient_user_id,
      purpose: 'Clinical draft review',
      dataClass: 'sensitive',
    });
    res.json({ ok: true, suggestion });
  })
);

const aiReviewSchema = z.object({
  decision: z.enum(['accepted', 'accepted_with_edits', 'rejected']),
  editedOutput: clinicalAi.suggestionOutputSchema.nullable().optional(),
  rejectionReason: z.string().trim().max(2000).nullable().optional(),
});

router.post(
  '/ai/suggestions/:id/review',
  scoped(['remote_clinician']),
  validate(aiReviewSchema),
  asyncHandler(async (req, res) => {
    const review = await clinicalAi.reviewSuggestion(
      getPool(), req, req.programmeContext, req.params.id, req.validatedBody
    );
    res.json({ ok: true, review });
  })
);

module.exports = router;
