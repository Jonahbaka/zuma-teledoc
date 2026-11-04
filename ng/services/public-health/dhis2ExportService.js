'use strict';

/**
 * ng/services/public-health/dhis2ExportService.js
 *
 * Deterministic DHIS2 / NHMIS export architecture for PHC programmes.
 *
 * Everything here is pure or explicitly injectable so the full path can be
 * exercised with a mock sandbox: payload construction, indicator mapping,
 * validation, patient-identifier leakage guards, idempotency and deduplication,
 * retry classification, dead-lettering, and reconciliation.
 *
 * Safety properties that are enforced, not assumed:
 *   - Only aggregate counts are exported. Anything that looks like a patient
 *     identifier fails the build before it can leave the platform.
 *   - Submissions are keyed so a retry cannot double-count a period.
 *   - Permanent failures are dead-lettered instead of retried forever.
 *
 * Live DHIS2 synchronization remains fail-closed and gated on FCT PHCB
 * authorization, credentials, approved mappings, and sign-off.
 */

const crypto = require('crypto');

const PERIOD_PATTERN = /^\d{4}-\d{2}$/;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function exportError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

/** "2026-09" -> "September 2026", the human label used in reports and printouts. */
function formatPeriod(period) {
  const value = String(period || '').trim();
  if (!PERIOD_PATTERN.test(value)) {
    throw exportError(400, `Invalid period: ${period}. Expected YYYY-MM.`, 'PERIOD_INVALID');
  }
  const [year, month] = value.split('-');
  const index = Number(month) - 1;
  if (index < 0 || index > 11) {
    throw exportError(400, `Invalid month in period: ${period}.`, 'PERIOD_INVALID');
  }
  return `${MONTHS[index]} ${year}`;
}

/**
 * "2026-09" -> "202609".
 *
 * The DHIS2 data API expects the period identifier (for example "202201"), not a
 * display label. A human label like "September 2026" is what appears in
 * dashboards and printouts, so both forms are produced deliberately: the ISO
 * form goes on the wire, the label stays for people.
 */
function apiPeriod(period) {
  const value = String(period || '').trim();
  if (!PERIOD_PATTERN.test(value)) {
    throw exportError(400, `Invalid period: ${period}. Expected YYYY-MM.`, 'PERIOD_INVALID');
  }
  const month = Number(value.split('-')[1]);
  if (month < 1 || month > 12) {
    throw exportError(400, `Invalid month in period: ${period}.`, 'PERIOD_INVALID');
  }
  return value.replace('-', '');
}

function requireNonEmpty(value, field, code) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw exportError(400, `${field} is required.`, code);
  return text;
}

/**
 * Mapping layer: DoctaRx indicator key -> DHIS2 data element + org unit type.
 * A mapping that is not approved is a hard stop, never a silent default.
 */
function resolveMapping({ indicatorKey, mappings = [] }) {
  const key = requireNonEmpty(indicatorKey, 'indicatorKey', 'INDICATOR_KEY_REQUIRED');
  const mapping = mappings.find((entry) => entry.indicatorKey === key);
  if (!mapping) {
    throw exportError(
      422,
      `No approved DHIS2 mapping for indicator "${key}".`,
      'INDICATOR_MAPPING_MISSING'
    );
  }
  if (mapping.approvalStatus !== 'approved') {
    throw exportError(
      422,
      `Mapping for "${key}" is ${mapping.approvalStatus || 'unknown'}, not approved.`,
      'INDICATOR_MAPPING_NOT_APPROVED'
    );
  }
  if (!mapping.dataElement) {
    throw exportError(422, `Mapping for "${key}" has no DHIS2 data element.`, 'INDICATOR_MAPPING_INCOMPLETE');
  }
  return mapping;
}

const PATIENT_IDENTIFIER_PATTERNS = [
  { name: 'phone', pattern: /(?:\+?234|0)[789][01]\d{8}/ },
  { name: 'email', pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { name: 'hmrc_like_id', pattern: /\b\d{6}-\d{4}-\d{4}\b/ },
  { name: 'bearer_token', pattern: /(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/ },
  { name: 'name_field', pattern: /"(?:patient_?name|first_?name|last_?name|full_?name|patient_?id|nhs_?number|hospital_?number)"\s*:/i },
];

/**
 * Aggregate-only guard. Runs over the serialised payload so a nested field
 * cannot smuggle an identifier through.
 */
function assertNoPatientIdentifiers(payload) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const findings = PATIENT_IDENTIFIER_PATTERNS
    .filter(({ pattern }) => pattern.test(serialized))
    .map(({ name }) => name);

  if (findings.length) {
    throw exportError(
      422,
      `Aggregate export rejected: payload contains possible patient identifiers (${findings.join(', ')}).`,
      'PATIENT_IDENTIFIER_DETECTED'
    );
  }
  return true;
}

/**
 * Builds one DHIS2 dataValueSet for a facility/period from aggregate values.
 * Values must be non-negative integers: counts, not measurements of individuals.
 */
function buildDataValueSet({ orgUnit, orgUnitName, period, values = [], mappings = [] }) {
  const unit = requireNonEmpty(orgUnit, 'orgUnit', 'ORG_UNIT_REQUIRED');
  const periodId = apiPeriod(period);

  const dataValues = values.map((entry) => {
    const mapping = resolveMapping({ indicatorKey: entry.indicatorKey, mappings });
    const raw = entry.value;
    const numeric = Number(raw);

    if (raw === null || raw === undefined || raw === '') {
      throw exportError(
        422,
        `Indicator "${entry.indicatorKey}" has no value. Use 0 explicitly for a true zero; omit unknown counts rather than guessing.`,
        'INDICATOR_VALUE_MISSING'
      );
    }
    if (!Number.isInteger(numeric) || numeric < 0) {
      throw exportError(
        422,
        `Indicator "${entry.indicatorKey}" must be a non-negative whole number of people, got ${raw}.`,
        'INDICATOR_VALUE_INVALID'
      );
    }

    return {
      dataElement: mapping.dataElement,
      orgUnit: unit,
      period: periodId,
      value: String(numeric),
      ...(entry.note ? { comment: String(entry.note).slice(0, 255) } : {}),
    };
  });

  const payload = {
    dataSet: values.length ? undefined : undefined,
    orgUnit: unit,
    period: periodId,
    periodLabel: formatPeriod(period),
    dataValues,
    ...(orgUnitName ? { orgUnitName: String(orgUnitName) } : {}),
  };
  delete payload.dataSet;

  // A dataset with no values must never be submitted: it would look like a
  // zero report for a facility that simply has not been counted yet.
  if (!dataValues.length) {
    throw exportError(422, 'No indicator values supplied for this facility and period.', 'NO_VALUES_SUPPLIED');
  }

  assertNoPatientIdentifiers(payload);
  return payload;
}

/** Stable submission key so the same report is never submitted twice. */
function computeSubmissionKey({ orgUnit, period, values = [] }) {
  const parts = values
    .map((entry) => `${entry.indicatorKey}:${entry.dataElement || ''}:${entry.value}`)
    .sort();
  return crypto
    .createHash('sha256')
    .update(`${orgUnit}|${apiPeriod(period)}|${parts.join('|')}`)
    .digest('hex');
}

/**
 * Queue item lifecycle: queued -> sending -> sent | retrying | dead_letter.
 * `nextAttemptAt` makes retries observable and lets a dry run stay inert.
 */
const MAX_ATTEMPTS = 5;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function classifyFailure({ statusCode, code, message } = {}) {
  if (RETRYABLE_STATUSES.has(Number(statusCode))) {
    return { retryable: true, reason: 'TRANSIENT_UPSTREAM' };
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN' || code === 'ENOTFOUND') {
    return { retryable: true, reason: 'NETWORK_TRANSIENT' };
  }
  if (Number(statusCode) >= 400 && Number(statusCode) < 500) {
    return { retryable: false, reason: 'PERMANENT_CLIENT_ERROR' };
  }
  if (statusCode === undefined && !code) {
    return { retryable: false, reason: 'UNKNOWN_FAILURE' };
  }
  return { retryable: true, reason: 'UNKNOWN_FAILURE' };
}

function retryDelayMs(attempt, { baseMs = 5000, maxMs = 300000 } = {}) {
  const safeAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(maxMs, baseMs * (2 ** (safeAttempt - 1)));
}

/** Applies a failure to a queue item, dead-lettering after the attempt budget. */
function applyFailure(item, failure, { now = new Date().toISOString() } = {}) {
  const attempt = (item.attempts || 0) + 1;
  const classification = classifyFailure(failure);
  const exhausted = attempt >= MAX_ATTEMPTS;

  if (!classification.retryable || exhausted) {
    return {
      ...item,
      attempts: attempt,
      status: 'dead_letter',
      deadLetterReason: exhausted ? 'MAX_ATTEMPTS_EXHAUSTED' : classification.reason,
      lastError: failure,
      nextAttemptAt: null,
      deadLetteredAt: now,
    };
  }

  return {
    ...item,
    attempts: attempt,
    status: 'retrying',
    lastError: failure,
    nextAttemptAt: new Date(Date.parse(now) + retryDelayMs(attempt)).toISOString(),
  };
}

/** Reconciliation: which queued submissions are confirmed, missing, or rejected. */
function reconcile({ items = [], responses = [] } = {}) {
  const byKey = new Map(responses.map((response) => [response.submissionKey, response]));
  const confirmed = [];
  const missing = [];
  const rejected = [];

  for (const item of items) {
    const response = byKey.get(item.submissionKey);
    if (!response) {
      missing.push({ submissionKey: item.submissionKey, orgUnit: item.orgUnit, period: item.period });
      continue;
    }
    if (response.accepted) {
      confirmed.push({ submissionKey: item.submissionKey, orgUnit: item.orgUnit, period: item.period, response });
    } else {
      rejected.push({
        submissionKey: item.submissionKey,
        orgUnit: item.orgUnit,
        period: item.period,
        reason: response.reason || 'REJECTED_UPSTREAM',
        errors: response.errors || [],
      });
    }
  }

  return {
    confirmed,
    missing,
    rejected,
    summary: {
      total: items.length,
      confirmed: confirmed.length,
      missing: missing.length,
      rejected: rejected.length,
      isReconciled: missing.length === 0 && rejected.length === 0,
    },
  };
}

module.exports = {
  applyFailure,
  apiPeriod,
  assertNoPatientIdentifiers,
  buildDataValueSet,
  classifyFailure,
  computeSubmissionKey,
  formatPeriod,
  reconcile,
  requireNonEmpty,
  resolveMapping,
  retryDelayMs,
  _test: { MAX_ATTEMPTS, RETRYABLE_STATUSES },
};
