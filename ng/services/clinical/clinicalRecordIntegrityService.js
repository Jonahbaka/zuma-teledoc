'use strict';

/**
 * ng/services/clinical/clinicalRecordIntegrityService.js
 *
 * Clinical record integrity for the Nigeria provider/patient clinical API:
 *   - encounter ownership for note writes (owner, or audited covering clinician)
 *   - encounter sign-off / finalization with author attribution and digest
 *   - append-only note amendments (the signed text is never overwritten)
 *   - append-only referral status history with validated transitions
 *
 * The decision helpers are exported separately from the database work so the
 * authorization rules can be tested without a database.
 */

const crypto = require('crypto');

const REFERRAL_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'completed', 'cancelled'];

// Mirrors the ng_referrals.status CHECK constraint in 017_ng_clinical_records.sql.
const REFERRAL_TRANSITIONS = {
  draft: ['sent', 'cancelled'],
  sent: ['accepted', 'declined', 'cancelled'],
  accepted: ['completed', 'cancelled'],
  declined: ['cancelled'],
  completed: [],
  cancelled: [],
};

// Mirrors the ng_clinical_encounters.status CHECK constraint in 017_ng_clinical_records.sql.
const ENCOUNTER_SIGNABLE_STATUSES = ['draft', 'in_progress'];
const ENCOUNTER_TERMINAL_STATUSES = ['signed', 'amended', 'cancelled'];

const SOAP_TEXT_FIELDS = ['subjective', 'objective', 'assessment', 'plan', 'provider_attestation'];
const MIN_COVERING_REASON_LENGTH = 10;
const MIN_AMENDMENT_REASON_LENGTH = 10;

// Roles allowed to list clinical data at all. Other roles are denied explicitly
// instead of silently receiving an empty, unscoped result set.
const CLINICAL_LIST_ROLES = new Set([
  'patient', 'provider', 'doctor', 'consultant', 'physician', 'specialist',
]);
const CLINICAL_ADMIN_ROLES = new Set([
  'admin', 'super_admin', 'administrator', 'platform_admin',
]);

/**
 * @param {string} role canonical role
 * @returns {string} the canonical role when clinical listing is permitted
 */
function assertClinicalListRole(role) {
  const canonical = String(role || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (CLINICAL_LIST_ROLES.has(canonical)) return canonical;
  if (CLINICAL_ADMIN_ROLES.has(canonical)) {
    throw integrityError(
      403,
      'Administrative clinical reads require a per-patient break-glass reason '
        + '(x-break-glass-reason header) on the encounter endpoint.',
      'BREAK_GLASS_REQUIRED_FOR_LIST'
    );
  }
  throw integrityError(403, 'Clinical record access denied.', 'CLINICAL_ACCESS_DENIED');
}

/** Documented shift cover, from the request header or the request body. */
function coveringReasonFrom(req) {
  return req?.headers?.['x-covering-clinician-reason']
    || req?.body?.coveringReason
    || req?.body?.covering_reason
    || null;
}

function integrityError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

/** Stable digest of a clinical note so later amendments can prove what changed. */
function noteContentHash(note) {
  const payload = SOAP_TEXT_FIELDS.map((field) => `${field}=${normalizeText(note?.[field])}`).join('\n');
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function noteSnapshot(note) {
  const snapshot = {};
  for (const field of SOAP_TEXT_FIELDS) snapshot[field] = normalizeText(note?.[field]);
  return snapshot;
}

/**
 * A clinician may only write into an encounter they own. Shift cover by a
 * second clinician is allowed, but only with a recorded reason so the
 * handover is visible in the record rather than silently shared.
 */
function assertEncounterWriteOwnership({ encounter, actorUserId, coveringReason, isAdminOverride = false } = {}) {
  if (!encounter) {
    throw integrityError(404, 'Encounter not found.', 'ENCOUNTER_NOT_FOUND');
  }

  const owner = encounter.provider_user_id ? String(encounter.provider_user_id) : null;
  const actor = actorUserId ? String(actorUserId) : null;

  if (isAdminOverride) {
    return { owner: false, covering: false, adminOverride: true, encounterOwnerUserId: owner };
  }

  if (!actor) {
    throw integrityError(401, 'Authentication required.', 'AUTHENTICATION_REQUIRED');
  }

  if (owner && owner === actor) {
    return { owner: true, covering: false, adminOverride: false, encounterOwnerUserId: owner };
  }

  if (typeof coveringReason !== 'string' || coveringReason.trim().length < MIN_COVERING_REASON_LENGTH) {
    throw integrityError(
      403,
      'This encounter belongs to another clinician. Record a covering-clinician reason of at least '
        + `${MIN_COVERING_REASON_LENGTH} characters to document the handover.`,
      'ENCOUNTER_OWNERSHIP_REQUIRED'
    );
  }

  return {
    owner: false,
    covering: true,
    adminOverride: false,
    encounterOwnerUserId: owner,
    coveringReason: coveringReason.trim(),
  };
}

/** Reject status changes the record cannot legally make. */
function validateReferralTransition(fromStatus, toStatus) {
  const from = String(fromStatus || '').trim().toLowerCase();
  const to = String(toStatus || '').trim().toLowerCase();

  if (!REFERRAL_STATUSES.includes(to)) {
    throw integrityError(400, 'Unsupported referral status.', 'REFERRAL_STATUS_INVALID');
  }
  if (!REFERRAL_STATUSES.includes(from)) {
    throw integrityError(409, 'Referral is in an unknown state and needs manual review.', 'REFERRAL_STATUS_UNKNOWN');
  }
  if (from === to) {
    throw integrityError(409, `Referral is already ${to}.`, 'REFERRAL_STATUS_UNCHANGED');
  }
  if (!REFERRAL_TRANSITIONS[from].includes(to)) {
    throw integrityError(409, `Referral cannot move from ${from} to ${to}.`, 'REFERRAL_TRANSITION_NOT_ALLOWED');
  }

  return { from, to };
}

function assertSignableEncounter(encounter) {
  if (!encounter) {
    throw integrityError(404, 'Encounter not found.', 'ENCOUNTER_NOT_FOUND');
  }
  const status = String(encounter.status || '').toLowerCase();
  if (ENCOUNTER_TERMINAL_STATUSES.includes(status)) {
    throw integrityError(
      409,
      `Encounter is already ${encounter.status} and cannot be signed again.`,
      'ENCOUNTER_ALREADY_FINAL'
    );
  }
  if (!ENCOUNTER_SIGNABLE_STATUSES.includes(status)) {
    throw integrityError(409, `Encounter status ${encounter.status || 'unknown'} is not signable.`, 'ENCOUNTER_NOT_SIGNABLE');
  }
  return encounter;
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[clinical-integrity] rollback failed:', rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

function auditContext(req) {
  return {
    ip: req?.ip || null,
    userAgent: req?.get?.('user-agent') || req?.headers?.['user-agent'] || null,
  };
}

/** Every covering-clinician access, sign-off, and amendment is auditable. */
async function writeIntegrityAudit(client, {
  actorUserId,
  action,
  resourceType,
  resourceId,
  patientUserId = null,
  request,
  metadata = {},
}) {
  const { ip, userAgent } = auditContext(request);
  await client.query(
    `INSERT INTO ng_audit_lineage
       (actor_user_id, action, resource_type, resource_id, data_class,
        ip_address, user_agent, metadata_json)
     VALUES ($1,$2,$3,$4,'sensitive',$5,$6,$7::JSONB)`,
    [actorUserId, action, resourceType, resourceId, ip, userAgent, JSON.stringify(metadata)]
  );
}

/**
 * Sign an encounter: stamp the clinician's notes, finalize the encounter, and
 * keep the pre-sign digest so a later amendment can be compared against it.
 */
async function signEncounter(pool, req, { encounter, noteIds = [], attestation, actorUserId }) {
  const signable = assertSignableEncounter(encounter);
  const encounterId = signable.id;
  const patientUserId = signable.patient_user_id;
  const at = new Date().toISOString();

  return withTransaction(pool, async (client) => {
    if (noteIds.length) {
      const pending = await client.query(
        `SELECT id, subjective, objective, assessment, plan, provider_attestation
           FROM ng_soap_notes
          WHERE id = ANY($1::UUID[])
            AND encounter_id = $2
            AND patient_user_id = $3
            AND signed_at IS NULL
          FOR UPDATE`,
        [noteIds, encounterId, patientUserId]
      );
      if (pending.rows.length !== noteIds.length) {
        throw integrityError(
          409,
          'One or more notes are already signed or do not belong to this encounter.',
          'SOAP_NOTE_NOT_SIGNABLE'
        );
      }

      for (const note of pending.rows) {
        const contentHash = noteContentHash(note);
        await client.query(
          `UPDATE ng_soap_notes
              SET provider_attestation = COALESCE($1, provider_attestation),
                  signed_at = $2,
                  content_hash = $3,
                  updated_at = NOW()
            WHERE id = $4`,
          [attestation || null, at, contentHash, note.id]
        );
      }
    }

    const finalized = await client.query(
      `UPDATE ng_clinical_encounters
          SET status = 'signed',
              signed_at = $1,
              record_version = COALESCE(record_version, 1) + 1,
              updated_at = NOW()
        WHERE id = $2
          AND patient_user_id = $3
          AND status = ANY($4::TEXT[])
      RETURNING *`,
      [at, encounterId, patientUserId, ENCOUNTER_SIGNABLE_STATUSES]
    );
    if (!finalized.rows.length) {
      throw integrityError(409, 'Encounter changed before it could be signed.', 'ENCOUNTER_CONFLICT');
    }

    await writeIntegrityAudit(client, {
      actorUserId,
      action: 'encounter_signed',
      resourceType: 'clinical_encounter',
      resourceId: encounterId,
      patientUserId,
      request: req,
      metadata: { noteIds, signedAt: at, attestationProvided: Boolean(attestation) },
    });

    return finalized.rows[0];
  });
}

/**
 * Amend an existing note. The original row is left byte-for-byte intact and
 * marked not-current; the correction is a new signed-off row that references it.
 */
async function amendNote(pool, req, {
  encounterId,
  originalNote,
  replacement,
  reason,
  actorUserId,
  providerId = null,
  coveringUserId = null,
}) {
  if (typeof reason !== 'string' || reason.trim().length < MIN_AMENDMENT_REASON_LENGTH) {
    throw integrityError(
      400,
      `An amendment reason of at least ${MIN_AMENDMENT_REASON_LENGTH} characters is required.`,
      'AMENDMENT_REASON_REQUIRED'
    );
  }
  if (!originalNote) {
    throw integrityError(404, 'Note not found.', 'SOAP_NOTE_NOT_FOUND');
  }
  if (originalNote.amends_note_id) {
    throw integrityError(409, 'An amendment cannot itself be amended.', 'AMENDMENT_NOT_AMENDABLE');
  }

  const originalHash = originalNote.content_hash || noteContentHash(originalNote);
  const patientUserId = originalNote.patient_user_id;
  const at = new Date().toISOString();

  return withTransaction(pool, async (client) => {
    const created = await client.query(
      `INSERT INTO ng_soap_notes
         (encounter_id, patient_user_id, provider_user_id, subjective, objective,
          assessment, plan, provider_attestation, signed_at, amends_note_id,
          amendment_reason, is_current, content_hash, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$9,NOW())
       RETURNING *`,
      [
        encounterId,
        patientUserId,
        actorUserId,
        replacement.subjective || null,
        replacement.objective || null,
        replacement.assessment || null,
        replacement.plan || null,
        replacement.provider_attestation || null,
        at,
        originalNote.id,
        reason.trim(),
        noteContentHash(replacement),
      ]
    );
    const amendmentNote = created.rows[0];

    // Retire, never rewrite, the superseded note.
    const superseded = await client.query(
      `UPDATE ng_soap_notes
          SET is_current = FALSE, updated_at = NOW()
        WHERE id = $1 AND is_current = TRUE
      RETURNING id`,
      [originalNote.id]
    );
    if (!superseded.rows.length) {
      throw integrityError(409, 'Note was already superseded by another amendment.', 'AMENDMENT_CONFLICT');
    }

    await client.query(
      `UPDATE ng_clinical_encounters
          SET status = 'amended',
              record_version = COALESCE(record_version, 1) + 1,
              updated_at = NOW()
        WHERE id = $1`,
      [encounterId]
    );

    await client.query(
      `INSERT INTO ng_clinical_record_amendments
         (encounter_id, record_type, original_record_id, amendment_record_id,
          reason, author_user_id, author_provider_id, covering_user_id,
          original_snapshot, original_content_hash, amended_content_hash, metadata_json)
       VALUES ($1,'soap_note',$2,$3,$4,$5,$6,$7,$8::JSONB,$9,$10,$11::JSONB)`,
      [
        encounterId,
        originalNote.id,
        amendmentNote.id,
        reason.trim(),
        actorUserId,
        providerId,
        coveringUserId,
        JSON.stringify(noteSnapshot(originalNote)),
        originalHash,
        amendmentNote.content_hash,
        JSON.stringify({ amendedAt: at }),
      ]
    );

    await writeIntegrityAudit(client, {
      actorUserId,
      action: 'soap_note_amended',
      resourceType: 'clinical_record_amendment',
      resourceId: amendmentNote.id,
      patientUserId,
      request: req,
      metadata: {
        encounterId,
        supersededNoteId: originalNote.id,
        coveringUserId: coveringUserId || null,
        originalContentHash: originalHash,
      },
    });

    return { amendment: amendmentNote, supersededNoteId: originalNote.id, originalContentHash: originalHash };
  });
}

/** Append-only referral status history; never overwrites the prior transition. */
async function appendReferralStatusEvent(client, {
  referralId,
  fromStatus,
  toStatus,
  reason = null,
  actorUserId,
  actorRole = null,
  request,
  metadata = {},
}) {
  const { ip, userAgent } = auditContext(request);
  const { rows } = await client.query(
    `INSERT INTO ng_referral_status_events
       (referral_id, from_status, to_status, reason, actor_user_id, actor_role,
        ip_address, user_agent, metadata_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::JSONB)
     RETURNING *`,
    [
      referralId,
      fromStatus || null,
      toStatus,
      reason || null,
      actorUserId,
      actorRole,
      ip,
      userAgent,
      JSON.stringify(metadata),
    ]
  );
  return rows[0];
}

module.exports = {
  amendNote,
  appendReferralStatusEvent,
  assertClinicalListRole,
  assertEncounterWriteOwnership,
  assertSignableEncounter,
  coveringReasonFrom,
  noteContentHash,
  noteSnapshot,
  signEncounter,
  validateReferralTransition,
  writeIntegrityAudit,
  _test: {
    ENCOUNTER_SIGNABLE_STATUSES,
    ENCOUNTER_TERMINAL_STATUSES,
    MIN_AMENDMENT_REASON_LENGTH,
    MIN_COVERING_REASON_LENGTH,
    REFERRAL_STATUSES,
    REFERRAL_TRANSITIONS,
    SOAP_TEXT_FIELDS,
  },
};

