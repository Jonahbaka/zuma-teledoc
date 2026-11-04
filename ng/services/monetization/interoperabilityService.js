const crypto = require('crypto');
const { getPool } = require('../../../server/db');
const { getInteroperabilityCapabilities } = require('./pricingService');

const SMART_TOKEN_PREFIX = 'smart_ng_';

const FHIR_R4_RESOURCE_BLUEPRINTS = {
  Patient: {
    resourceType: 'Patient',
    requiredFields: ['resourceType', 'identifier', 'name'],
    localSources: ['users', 'ng_emr_records'],
    exchangeDirections: ['inbound', 'outbound'],
  },
  Practitioner: {
    resourceType: 'Practitioner',
    requiredFields: ['resourceType', 'identifier', 'name'],
    localSources: ['users', 'provider_profiles', 'ng_hospital_staff'],
    exchangeDirections: ['inbound', 'outbound'],
  },
  Organization: {
    resourceType: 'Organization',
    requiredFields: ['resourceType', 'identifier', 'name'],
    localSources: ['ng_organizations', 'ng_hospitals', 'ng_pharmacies'],
    exchangeDirections: ['inbound', 'outbound'],
  },
  Encounter: {
    resourceType: 'Encounter',
    requiredFields: ['resourceType', 'status', 'subject'],
    localSources: ['appointments', 'visits', 'ng_clinical_encounters'],
    exchangeDirections: ['inbound', 'outbound'],
  },
  MedicationRequest: {
    resourceType: 'MedicationRequest',
    requiredFields: ['resourceType', 'status', 'intent', 'subject', 'medicationCodeableConcept'],
    localSources: ['ng_digital_prescriptions', 'ng_digital_prescription_items'],
    exchangeDirections: ['inbound', 'outbound'],
  },
  Observation: {
    resourceType: 'Observation',
    requiredFields: ['resourceType', 'status', 'code', 'subject'],
    localSources: ['ng_lab_results', 'patient_vitals'],
    exchangeDirections: ['inbound', 'outbound'],
  },
  DiagnosticReport: {
    resourceType: 'DiagnosticReport',
    requiredFields: ['resourceType', 'status', 'code', 'subject'],
    localSources: ['ng_lab_results', 'ng_clinical_documents'],
    exchangeDirections: ['inbound', 'outbound'],
  },
  ReferralRequest: {
    resourceType: 'ServiceRequest',
    requiredFields: ['resourceType', 'status', 'intent', 'subject'],
    localSources: ['referrals', 'ng_referrals'],
    exchangeDirections: ['outbound', 'inbound'],
    note: 'FHIR R4 represents many referral flows as ServiceRequest.',
  },
};

const FHIR_RESOURCE_ALIASES = {
  ServiceRequest: 'ReferralRequest',
};

const SMART_AUTH_ARCHITECTURE = {
  protocol: 'SMART on FHIR style OAuth 2.0',
  responseType: 'code',
  tokenHandling: 'authorization_code_exchange_required',
  liveAuthenticationClaimed: false,
  requiredConfiguration: [
    'authorization_endpoint',
    'token_endpoint',
    'smart_client_id',
    'redirect_uri',
    'scopes',
  ],
  defaultScopes: [
    'launch/patient',
    'openid',
    'fhirUser',
    'patient/*.read',
    'patient/MedicationRequest.write',
    'patient/ServiceRequest.write',
  ],
};

function getFhirArchitecture() {
  return {
    protocol: 'HL7 FHIR R4',
    productionConnectionClaimed: false,
    resources: FHIR_R4_RESOURCE_BLUEPRINTS,
    smartOnFhir: SMART_AUTH_ARCHITECTURE,
    bidirectionalExchange: getInteroperabilityCapabilities().bidirectionalExchange,
    connectionStatuses: ['active', 'pending', 'sandbox', 'unavailable', 'configured', 'error'],
    integrationTypes: ['manual', 'api', 'fhir_r4', 'whatsapp_assisted', 'pending'],
  };
}

function normalizeBlueprintKey(resourceType) {
  const requested = String(resourceType || '').trim();
  return FHIR_R4_RESOURCE_BLUEPRINTS[requested]
    ? requested
    : FHIR_RESOURCE_ALIASES[requested] || requested;
}

function validateFhirResourceShape({ resourceType, resource = {} } = {}) {
  const blueprintKey = normalizeBlueprintKey(resourceType || resource.resourceType);
  const blueprint = FHIR_R4_RESOURCE_BLUEPRINTS[blueprintKey];
  if (!blueprint) {
    return {
      valid: false,
      persisted: false,
      error: 'Unsupported FHIR R4 resource type for Nigeria integration architecture.',
      supportedResourceTypes: Object.keys(FHIR_R4_RESOURCE_BLUEPRINTS),
    };
  }

  const missingFields = blueprint.requiredFields.filter((field) => {
    if (field === 'resourceType') return resource.resourceType !== blueprint.resourceType;
    return resource[field] === undefined || resource[field] === null || resource[field] === '';
  });

  return {
    valid: missingFields.length === 0,
    persisted: false,
      resourceType: blueprint.resourceType,
      requestedResourceType: blueprintKey,
      missingFields,
      requiredFields: blueprint.requiredFields,
  };
}

function createFhirLogicalId(resourceType, localId) {
  const prefix = String(resourceType || 'Resource').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `${prefix}-${localId || crypto.randomUUID()}`;
}

function compactText(value, fallback = 'Not recorded') {
  const text = String(value || '').trim();
  return text || fallback;
}

function patientReference(patientId) {
  return {
    reference: `Patient/${patientId}`,
    display: 'DoctaRx Nigeria patient',
  };
}

function practitionerReference(providerId) {
  return providerId ? {
    reference: `Practitioner/${providerId}`,
    display: 'DoctaRx Nigeria provider',
  } : undefined;
}

function buildFhirResource({ resourceType, patientId, providerId, encounterId, localId, data = {} }) {
  const blueprintKey = normalizeBlueprintKey(resourceType);
  const blueprint = FHIR_R4_RESOURCE_BLUEPRINTS[blueprintKey];
  if (!blueprint) {
    const error = new Error('Unsupported FHIR R4 resource type for Nigeria.');
    error.statusCode = 400;
    throw error;
  }

  const id = createFhirLogicalId(blueprint.resourceType, localId);
  const authoredOn = new Date().toISOString();

  if (blueprintKey === 'Patient') {
    return {
      resourceType: 'Patient',
      id,
      identifier: [{ system: 'https://doctarx.com/ng/patient-id', value: String(patientId || data.patientUserId || localId) }],
      name: [{ text: compactText(data.patientName, 'DoctaRx Nigeria patient') }],
      telecom: data.phone || data.email ? [
        data.phone ? { system: 'phone', value: data.phone } : null,
        data.email ? { system: 'email', value: data.email } : null,
      ].filter(Boolean) : [],
    };
  }

  if (blueprintKey === 'Practitioner') {
    return {
      resourceType: 'Practitioner',
      id,
      identifier: [{ system: 'https://doctarx.com/ng/provider-id', value: String(providerId || data.providerUserId || localId) }],
      name: [{ text: compactText(data.providerName, 'DoctaRx Nigeria provider') }],
    };
  }

  if (blueprintKey === 'Organization') {
    return {
      resourceType: 'Organization',
      id,
      identifier: [{ system: 'https://doctarx.com/ng/organization-id', value: String(data.organizationId || localId) }],
      name: compactText(data.organizationName || data.targetName, 'DoctaRx Nigeria connected organization'),
      type: data.organizationType ? [{ text: data.organizationType }] : [],
    };
  }

  if (blueprintKey === 'Encounter') {
    return {
      resourceType: 'Encounter',
      id,
      status: data.status === 'signed' ? 'finished' : data.status === 'cancelled' ? 'cancelled' : 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: data.encounterType === 'facility' ? 'AMB' : 'VR' },
      subject: patientReference(patientId),
      participant: providerId ? [{ individual: practitionerReference(providerId) }] : [],
      period: { start: data.startedAt || data.started_at || authoredOn, end: data.endedAt || data.ended_at || undefined },
      reasonCode: data.reasonForVisit || data.chiefComplaint ? [{ text: compactText(data.reasonForVisit || data.chiefComplaint) }] : [],
      serviceProvider: data.hospitalId ? { reference: `Organization/${data.hospitalId}` } : undefined,
    };
  }

  if (blueprintKey === 'MedicationRequest') {
    const medicationText = compactText(data.medicationName || data.medications || data.items?.map((item) => item.medicationName || item.medication_name).filter(Boolean).join(', '), 'Medication order');
    return {
      resourceType: 'MedicationRequest',
      id,
      status: ['cancelled', 'expired'].includes(data.lifecycleStatus || data.lifecycle_status) ? 'stopped' : 'active',
      intent: 'order',
      subject: patientReference(patientId),
      encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
      authoredOn,
      requester: practitionerReference(providerId),
      medicationCodeableConcept: { text: medicationText },
      dosageInstruction: [{
        text: [data.dosage, data.frequency, data.duration].filter(Boolean).join(' | ') || data.patientInstructions || 'Directions recorded in prescription items',
      }],
      note: data.pharmacyNotes ? [{ text: data.pharmacyNotes }] : [],
    };
  }

  if (blueprintKey === 'Observation') {
    return {
      resourceType: 'Observation',
      id,
      status: data.status || 'final',
      code: { text: compactText(data.testName || data.test_name, 'Clinical observation') },
      subject: patientReference(patientId),
      encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
      effectiveDateTime: data.resultedAt || data.resulted_at || authoredOn,
      valueString: data.resultValue || data.result_value || data.resultSummary || data.result_summary || 'Result recorded',
    };
  }

  if (blueprintKey === 'DiagnosticReport') {
    return {
      resourceType: 'DiagnosticReport',
      id,
      status: data.status || 'final',
      code: { text: compactText(data.testName || data.documentTitle || data.title, 'Diagnostic report') },
      subject: patientReference(patientId),
      encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
      effectiveDateTime: data.resultedAt || data.resulted_at || authoredOn,
      conclusion: data.resultValue || data.result_summary || data.clinicalNotes || data.clinical_notes || undefined,
    };
  }

  return {
    resourceType: 'ServiceRequest',
    id,
    status: data.status === 'cancelled' ? 'revoked' : 'active',
    intent: 'order',
    subject: patientReference(patientId),
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    requester: practitionerReference(providerId),
    authoredOn,
    priority: data.priority || 'routine',
    code: { text: compactText(data.referralType || data.referral_type || data.specialty, 'Referral request') },
    reasonCode: [{ text: compactText(data.reason || data.reasonForReferral, 'Referral requested') }],
    note: data.clinicalNotes || data.clinical_notes ? [{ text: data.clinicalNotes || data.clinical_notes }] : [],
  };
}

async function persistFhirResource({
  resourceType,
  patientId,
  providerId,
  encounterId,
  localTable,
  localId,
  resource,
  data = {},
  direction = 'outbound',
  status = 'current',
  actorUserId,
} = {}) {
  const fhirResource = resource || buildFhirResource({
    resourceType,
    patientId,
    providerId,
    encounterId,
    localId,
    data,
  });
  const validation = validateFhirResourceShape({ resourceType, resource: fhirResource });
  if (!validation.valid) {
    const error = new Error(`FHIR resource is missing required fields: ${validation.missingFields.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const pool = getPool();
  const resourceId = fhirResource.id || createFhirLogicalId(fhirResource.resourceType, localId);
  fhirResource.id = resourceId;

  const versionResult = await pool.query(
    `SELECT COALESCE(MAX(resource_version), 0) + 1 AS next_version
     FROM ng_fhir_resources
     WHERE resource_type = $1 AND resource_id = $2`,
    [fhirResource.resourceType, resourceId]
  );
  const nextVersion = Number(versionResult.rows[0]?.next_version || 1);

  if (nextVersion > 1) {
    await pool.query(
      `UPDATE ng_fhir_resources
       SET status = 'superseded', updated_at = NOW(), updated_by = $3
       WHERE resource_type = $1 AND resource_id = $2 AND status = 'current'`,
      [fhirResource.resourceType, resourceId, actorUserId || null]
    );
  }

  const result = await pool.query(
    `INSERT INTO ng_fhir_resources (
       patient_user_id, encounter_id, resource_type, resource_id, resource_version,
       local_table, local_id, direction, status, resource, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     RETURNING *`,
    [
      patientId || null,
      encounterId || null,
      fhirResource.resourceType,
      resourceId,
      nextVersion,
      localTable || null,
      localId || null,
      direction,
      status,
      fhirResource,
      actorUserId || null,
    ]
  );

  if (localTable && localId) {
    await pool.query(
      `INSERT INTO ng_fhir_resource_mappings (
         resource_type, local_table, local_id, external_resource_id, sync_direction,
         sync_status, last_synced_at, metadata
       ) VALUES ($1,$2,$3,$4,$5,'synced',NOW(),$6)`,
      [
        fhirResource.resourceType,
        localTable,
        localId,
        resourceId,
        direction === 'internal' ? 'bidirectional' : direction,
        { ngFhirResourceId: result.rows[0].id },
      ]
    );
  }

  return result.rows[0];
}

async function listFhirResources({ patientId, resourceType, actorUserId, actorRole, limit = 50 } = {}) {
  const params = [];
  const clauses = ['1=1'];

  if (patientId) {
    params.push(patientId);
    clauses.push(`patient_user_id = $${params.length}`);
  }

  if (resourceType) {
    params.push(normalizeBlueprintKey(resourceType) === 'ReferralRequest' ? 'ServiceRequest' : resourceType);
    clauses.push(`resource_type = $${params.length}`);
  }

  if (!['admin', 'super_admin'].includes(actorRole || '') && actorUserId) {
    params.push(actorUserId);
    clauses.push(`(created_by = $${params.length} OR updated_by = $${params.length})`);
  }

  params.push(Number(limit || 50));

  const result = await getPool().query(
    `SELECT *
     FROM ng_fhir_resources
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows;
}

async function recordExchangeMessage({
  patientId,
  encounterId,
  referralId,
  integrationId,
  exchangeType,
  direction = 'internal',
  status = 'created',
  payload = {},
  responsePayload = {},
  createdBy,
  receivedBy,
} = {}) {
  const result = await getPool().query(
    `INSERT INTO ng_exchange_messages (
       patient_user_id, encounter_id, referral_id, integration_id, exchange_type,
       direction, status, payload, response_payload, created_by, received_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      patientId || null,
      encounterId || null,
      referralId || null,
      integrationId || null,
      exchangeType,
      direction,
      status,
      payload,
      responsePayload,
      createdBy || null,
      receivedBy || null,
    ]
  );
  return result.rows[0];
}

async function listExchangeMessages({ patientId, actorUserId, actorRole, limit = 50 } = {}) {
  const params = [];
  const clauses = ['1=1'];

  if (patientId) {
    params.push(patientId);
    clauses.push(`patient_user_id = $${params.length}`);
  }

  if (actorRole === 'provider' && actorUserId) {
    params.push(actorUserId);
    clauses.push(`(created_by = $${params.length} OR received_by = $${params.length})`);
  } else if (actorRole === 'patient' && actorUserId) {
    params.push(actorUserId);
    clauses.push(`patient_user_id = $${params.length}`);
  }

  params.push(Number(limit || 50));
  const result = await getPool().query(
    `SELECT e.*, r.reason AS referral_reason, r.target_name
     FROM ng_exchange_messages e
     LEFT JOIN ng_referrals r ON r.id = e.referral_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY e.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return result.rows;
}

async function createSmartAccessToken({ actorUserId, actorRole, scopes, metadata = {}, expiresInMinutes = 60 } = {}) {
  const token = `${SMART_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const resolvedScopes = Array.isArray(scopes) && scopes.length ? scopes : SMART_AUTH_ARCHITECTURE.defaultScopes;
  const result = await getPool().query(
    `INSERT INTO ng_smart_access_tokens (
       token_hash, actor_user_id, actor_role, scopes, expires_at, metadata
     ) VALUES ($1,$2,$3,$4,NOW() + ($5::text || ' minutes')::interval,$6)
     RETURNING id, actor_user_id, actor_role, scopes, status, expires_at, created_at`,
    [
      tokenHash,
      actorUserId || null,
      actorRole || null,
      resolvedScopes,
      String(Number(expiresInMinutes || 60)),
      metadata,
    ]
  );

  return {
    accessToken: token,
    tokenType: 'Bearer',
    expiresIn: Number(expiresInMinutes || 60) * 60,
    smartAccess: result.rows[0],
  };
}

async function verifySmartAccessToken(rawToken) {
  const token = String(rawToken || '').replace(/^Bearer\s+/i, '').trim();
  if (!token.startsWith(SMART_TOKEN_PREFIX)) {
    const error = new Error('SMART bearer token is required.');
    error.statusCode = 401;
    throw error;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await getPool().query(
    `UPDATE ng_smart_access_tokens
     SET last_used_at = NOW(),
         status = CASE WHEN expires_at <= NOW() THEN 'expired' ELSE status END,
         updated_at = NOW()
     WHERE token_hash = $1
     RETURNING id, actor_user_id, actor_role, scopes, status, expires_at`,
    [tokenHash]
  );

  const smartAccess = result.rows[0];
  if (!smartAccess || smartAccess.status !== 'active' || new Date(smartAccess.expires_at) <= new Date()) {
    const error = new Error('SMART bearer token is invalid or expired.');
    error.statusCode = 401;
    throw error;
  }

  return smartAccess;
}

async function logSmartAccess({ tokenId, actorUserId, method, path, responseStatus, requestPayload = {}, responsePayload = {} }) {
  await getPool().query(
    `INSERT INTO ng_smart_access_logs (
       token_id, actor_user_id, request_method, request_path, response_status,
       request_payload, response_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      tokenId || null,
      actorUserId || null,
      method || null,
      path || null,
      responseStatus || null,
      requestPayload,
      responsePayload,
    ]
  );
}

async function listConnectedOrganizations({ limit = 50 } = {}) {
  const pool = getPool();
  const result = await pool.query(
    `SELECT i.*, o.name AS organization_name, h.name AS hospital_name, p.name AS pharmacy_name,
            latest_log.status AS latest_log_status,
            latest_log.message AS latest_log_message,
            latest_log.created_at AS latest_log_at
     FROM ng_integrations i
     LEFT JOIN ng_organizations o ON o.id = i.organization_id
     LEFT JOIN ng_hospitals h ON h.id = i.hospital_id
     LEFT JOIN ng_pharmacies p ON p.id = i.pharmacy_id
     LEFT JOIN LATERAL (
       SELECT status, message, created_at
       FROM ng_integration_logs l
       WHERE l.integration_id = i.id
       ORDER BY l.created_at DESC
       LIMIT 1
     ) latest_log ON true
     ORDER BY i.updated_at DESC
     LIMIT $1`,
    [Number(limit || 50)]
  );

  return {
    integrations: result.rows,
    capabilities: getInteroperabilityCapabilities(),
    architecture: getFhirArchitecture(),
  };
}

async function createIntegration({
  organizationId,
  hospitalId,
  pharmacyId,
  integrationName,
  organizationType,
  integrationType,
  supportedCapabilities,
  adminNotes,
  fhirBaseUrl,
  smartClientId,
  smartScopes,
  authorizationEndpoint,
  tokenEndpoint,
  actorUserId,
}) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO ng_integrations (
       organization_id, hospital_id, pharmacy_id, integration_name, organization_type,
       integration_type, connection_status, supported_capabilities, admin_notes,
       fhir_base_url, smart_client_id, smart_scopes, authorization_endpoint, token_endpoint
     ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      organizationId || null,
      hospitalId || null,
      pharmacyId || null,
      integrationName,
      organizationType || 'other',
      integrationType || 'pending',
      supportedCapabilities || [],
      adminNotes || null,
      fhirBaseUrl || null,
      smartClientId || null,
      smartScopes || SMART_AUTH_ARCHITECTURE.defaultScopes,
      authorizationEndpoint || null,
      tokenEndpoint || null,
    ]
  );
  const integration = result.rows[0];
  await persistFhirResource({
    resourceType: 'Organization',
    localTable: 'ng_integrations',
    localId: integration.id,
    data: {
      organizationId: organizationId || hospitalId || pharmacyId || integration.id,
      organizationName: integrationName,
      organizationType: organizationType || 'other',
      targetName: integrationName,
    },
    actorUserId: actorUserId || null,
    direction: 'outbound',
  }).catch(() => {});
  return integration;
}

async function testConnection(integrationId, actorUserId) {
  const pool = getPool();
  const integration = await pool.query('SELECT * FROM ng_integrations WHERE id = $1', [integrationId]);
  if (!integration.rows.length) {
    const error = new Error('Integration not found');
    error.statusCode = 404;
    throw error;
  }

  const row = integration.rows[0];
  const isTestable = ['api', 'fhir_r4'].includes(row.integration_type) && row.connection_status === 'configured';
  const missingConfiguration = [];
  if (row.integration_type === 'fhir_r4' && !row.fhir_base_url) missingConfiguration.push('fhir_base_url');
  if (row.integration_type === 'api' && !row.fhir_base_url) missingConfiguration.push('api_base_url');

  const status = isTestable && missingConfiguration.length === 0 ? 'sandbox' : 'unavailable';
  const message = status === 'sandbox'
    ? 'Connection is configured for sandbox testing. Production sync is not claimed.'
    : `No configured endpoint is available for this integration.${missingConfiguration.length ? ` Missing: ${missingConfiguration.join(', ')}` : ''}`;

  await pool.query(
    `INSERT INTO ng_integration_logs (integration_id, event_type, status, message, payload)
     VALUES ($1, 'test_connection', $2, $3, $4)`,
    [
      integrationId,
      status,
      message,
      {
        actorUserId,
        integrationType: row.integration_type,
        connectionStatus: row.connection_status,
        missingConfiguration,
        productionConnected: false,
      },
    ]
  );

  await pool.query(
    `UPDATE ng_integrations
     SET last_tested_at = NOW(), last_error = $2, updated_at = NOW()
     WHERE id = $1`,
    [integrationId, status === 'sandbox' ? null : message]
  );

  return { status, message, productionConnected: false, missingConfiguration };
}

async function listIntegrationLogs(integrationId, { limit = 50 } = {}) {
  const result = await getPool().query(
    `SELECT *
     FROM ng_integration_logs
     WHERE integration_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [integrationId, Number(limit || 50)]
  );

  return result.rows;
}

async function buildSmartAuthorizationStart({ integrationId, actorUserId, redirectUri }) {
  const pool = getPool();
  const result = await pool.query('SELECT * FROM ng_integrations WHERE id = $1', [integrationId]);
  const integration = result.rows[0];
  if (!integration) {
    const error = new Error('Integration not found');
    error.statusCode = 404;
    throw error;
  }

  const missingConfiguration = [];
  if (!integration.authorization_endpoint) missingConfiguration.push('authorization_endpoint');
  if (!integration.token_endpoint) missingConfiguration.push('token_endpoint');
  if (!integration.smart_client_id) missingConfiguration.push('smart_client_id');
  if (!redirectUri) missingConfiguration.push('redirect_uri');

  if (missingConfiguration.length) {
    const message = `SMART on FHIR authorization cannot start. Missing: ${missingConfiguration.join(', ')}`;
    await pool.query(
      `INSERT INTO ng_integration_logs (integration_id, event_type, status, message, payload)
       VALUES ($1, 'smart_authorization_start', 'unavailable', $2, $3)`,
      [integrationId, message, { actorUserId, missingConfiguration, productionConnected: false }]
    );
    return {
      status: 'unavailable',
      authorizationUrl: null,
      message,
      productionConnected: false,
      missingConfiguration,
    };
  }

  const state = crypto.randomBytes(24).toString('hex');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const scopes = integration.smart_scopes?.length ? integration.smart_scopes : SMART_AUTH_ARCHITECTURE.defaultScopes;

  await pool.query(
    `INSERT INTO ng_smart_auth_sessions (
       integration_id, actor_user_id, state_hash, scopes, status, expires_at, metadata
     ) VALUES ($1,$2,$3,$4,'created',NOW() + INTERVAL '10 minutes',$5)`,
    [
      integrationId,
      actorUserId || null,
      stateHash,
      scopes,
      {
        redirectUri,
        authMode: 'smart_on_fhir_oauth2',
        productionConnected: false,
      },
    ]
  );

  const authorizationUrl = new URL(integration.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', integration.smart_client_id);
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', scopes.join(' '));
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('aud', integration.fhir_base_url || '');

  return {
    status: 'created',
    authorizationUrl: authorizationUrl.toString(),
    stateExpiresInSeconds: 600,
    productionConnected: false,
    message: 'SMART on FHIR authorization URL prepared. Token exchange must be completed by a configured integration callback.',
  };
}

module.exports = {
  buildSmartAuthorizationStart,
  buildFhirResource,
  createSmartAccessToken,
  createIntegration,
  getFhirArchitecture,
  listConnectedOrganizations,
  listExchangeMessages,
  listFhirResources,
  listIntegrationLogs,
  logSmartAccess,
  persistFhirResource,
  recordExchangeMessage,
  testConnection,
  validateFhirResourceShape,
  verifySmartAccessToken,
};
