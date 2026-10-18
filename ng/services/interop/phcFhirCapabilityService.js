'use strict';

const crypto = require('node:crypto');
const { version } = require('../../../package.json');

// Describes only the active /api/ng/interop/fhir read interface.
// HL7 R4: https://hl7.org/fhir/R4/capabilitystatement.html
// GET metadata: https://hl7.org/fhir/R4/http.html#capabilities
const RESOURCE_PATHS = Object.freeze({ Patient: '/Patient/:id', Encounter: '/Encounter/:id', Observation: '/Observation', AllergyIntolerance:'/AllergyIntolerance', Condition:'/Condition', DiagnosticReport:'/DiagnosticReport' });
const JSON_FORMATS = new Set(['json', 'application/json', 'application/fhir+json']);

function supportsMetadataJson(format, accept) {
  // FHIR _format overrides HTTP content negotiation. Other representations
  // are not implemented by this interface.
  if (format !== undefined) return typeof format === 'string' && JSON_FORMATS.has(format.trim().toLowerCase());
  if (!accept) return true;
  if (typeof accept !== 'string' || accept.length > 4096) return false;
  return accept.split(',').some(alternative => {
    const [mediaType, ...parameters] = alternative.trim().toLowerCase().split(';').map(part => part.trim());
    if (!['application/fhir+json', 'application/json', 'application/*', '*/*'].includes(mediaType)) return false;
    const params = Object.fromEntries(parameters.map(part => {
      const separator = part.indexOf('=');
      return separator < 0 ? [part, ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim().replace(/^"|"$/g, '')];
    }));
    const quality = params.q === undefined ? 1 : Number(params.q);
    return Number.isFinite(quality) && quality > 0 && quality <= 1 &&
      (!params.fhirversion || ['4.0', '4.0.1'].includes(params.fhirversion));
  });
}

function getCapabilityStatement() {
  return {
    resourceType: 'CapabilityStatement',
    id: 'doctarx-phc-read-interface',
    name: 'DoctaRxPHCReadInterface',
    title: 'DoctaRx CareOps PHC FHIR read interface',
    status: 'active',
    date: '2026-10-18',
    kind: 'instance',
    publisher: 'DoctaRx',
    software: { name: 'DoctaRx CareOps', version },
    implementation: { description: 'DoctaRx scoped PHC read interface at /api/ng/interop/fhir.' },
    fhirVersion: '4.0.1',
    format: ['application/fhir+json'],
    description: 'An implementation-specific read subset. No partner profile, terminology service, external EHR connection, write, history, batch or transaction capability is declared.',
    rest: [{
      mode: 'server',
      documentation: 'Metadata always returns the full interface description. Read resources require programme enrollment and current granted consent. References may identify Practitioner or Organization records; those resource endpoints are not provided by this subset.',
      security: {
        description: 'DoctaRx Bearer JWT or authenticated accessToken session cookie is required. Supply programmeId and facilityId as query parameters or X-Programme-Id and X-Facility-Id headers. The current account, active programme/facility, programme membership and clinical role are checked on every request. Allowed programme roles are phc_nurse, remote_clinician, clinical_supervisor and on_call_clinician. This endpoint does not offer SMART launch or OAuth authorization.',
      },
      resource: [
        { type: 'Patient', interaction: [{ code: 'read', documentation: 'GET Patient/{id}; id is the enrolled patient user UUID. No Patient search is provided.' }] },
        { type: 'Encounter', interaction: [{ code: 'read', documentation: 'GET Encounter/{id}; id is the PHC encounter UUID in the selected programme and facility. Current representation only.' }] },
        {
          type: 'Observation', interaction: [{ code: 'search-type', documentation: 'GET Observation?encounter={uuid}; a single PHC encounter UUID is required. Returns a searchset Bundle. No individual Observation read endpoint is provided.' }],
          searchParam: [{
            name: 'encounter', type: 'reference', definition: 'http://hl7.org/fhir/SearchParameter/clinical-encounter',
            documentation: 'Required. Only a bare PHC encounter UUID is accepted; chains, modifiers and absolute reference searches are not implemented.',
          }],
          documentation: 'Pagination uses integer parsing for _count (default 50, maximum 200) and the local _offset control (default 0, negative values become 0). Follow the returned next link with the same authorization and scope. Other clinical search filters are not implemented.',
        },
        ...['AllergyIntolerance','Condition','DiagnosticReport'].map(type=>({type,interaction:[{code:'search-type'}],searchParam:[{name:'encounter',type:'reference',documentation:'Required authorized PHC encounter UUID. Current patient enrollment and consent are verified. Allergies and conditions return the enrolled patient longitudinal list; laboratory reports belong to the selected encounter.'}],documentation:'JSON searchset with _count (maximum 200) and local _offset pagination. No unscoped patient-wide or individual read is declared. No absence of records is interpreted as absence of clinical risk.'})),
      ],
    }],
  };
}

function metadataETag(statement) {
  return '"' + crypto.createHash('sha256').update(JSON.stringify(statement)).digest('hex') + '"';
}

module.exports = { RESOURCE_PATHS, getCapabilityStatement, supportsMetadataJson, metadataETag };
