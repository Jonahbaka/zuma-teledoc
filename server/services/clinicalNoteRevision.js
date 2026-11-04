'use strict';

const { createHash } = require('node:crypto');

// Amendment version is lineage, not a draft-edit counter. This opaque witness
// binds a client to the stored clinical content it reviewed without exposing
// ciphertext or introducing a schema migration. Joined display names are not
// part of the note. Legacy plaintext representations are included when present.
const fields = [
  'id', 'encounter_id', 'patient_id', 'provider_id', 'note_type', 'version',
  'parent_note_id', 'is_amendment', 'is_signed', 'is_locked', 'signature_hash',
  'signed_at', 'locked_at', 'locked_reason', 'created_at', 'updated_at',
  'icd_codes', 'cpt_codes', 'follow_up_required', 'follow_up_interval',
  ...['subjective', 'objective', 'assessment', 'plan', 'vitals', 'physical_exam',
    'follow_up_notes', 'amendment_reason'].flatMap(field => [
    field, field + '_encrypted', field + '_iv', field + '_tag',
  ]),
];

function noteRevision(note) {
  return createHash('sha256').update(JSON.stringify([
    'clinical-note-revision-v1', fields.map(field => [field, note[field] ?? null]),
  ])).digest('hex');
}

function assertNoteRevision(note, expectedRevision) {
  // Existing service/API callers remain supported. The encounter editor always
  // supplies this witness for updates and signatures; it is not authorization.
  if (expectedRevision === undefined) return;
  if (typeof expectedRevision !== 'string' || !/^[a-f\d]{64}$/.test(expectedRevision)) {
    throw Object.assign(new Error('A valid clinical note revision is required.'), {
      statusCode: 400, code: 'CLINICAL_NOTE_REVISION_INVALID',
    });
  }
  if (expectedRevision !== noteRevision(note)) {
    throw Object.assign(new Error('The note changed after it was loaded. Review the current note before saving or signing.'), {
      statusCode: 409, code: 'CLINICAL_NOTE_REVISION_CONFLICT',
    });
  }
}

module.exports = { noteRevision, assertNoteRevision };
