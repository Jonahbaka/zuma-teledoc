'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { jsPDF } = require('jspdf');
const { getPool } = require('../../../server/db');

const MAX_ROWS = 10_000;
const TARGET_FIELDS = new Set([
  'recordKey', 'title', 'facilityName', 'areaCouncil', 'programme',
  'indicatorKey', 'observedValue', 'unit', 'observationDate',
  'approvalStatus', 'referralStatus', 'dataQualityStatus', 'sourceRecordId',
]);
const DIRECT_IDENTIFIER_KEYS = new Set([
  'patientname', 'firstname', 'lastname', 'email', 'phone', 'phonenumber', 'nin', 'nationalid',
]);

class RequestError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function actorId(actor) {
  return actor?.id || actor?.userId || null;
}

function cleanText(value, max = 500) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else if (char !== '\r') value += char;
  }
  row.push(value);
  if (row.some((cell) => cell !== '') || rows.length === 0) rows.push(row);
  const headers = (rows.shift() || []).map((header, index) => cleanText(header, 120) || `column_${index + 1}`);
  return rows.filter((cells) => cells.some((cell) => cleanText(cell) !== null)).map((cells) => (
    Object.fromEntries(headers.map((header, index) => [header, cleanText(cells[index], 10_000)]))
  ));
}

function excelCellValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return value.text;
  }
  return value;
}

async function parseFile(buffer, filename, mediaType) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new RequestError(422, 'Select a non-empty source file.');
  const extension = String(filename || '').toLowerCase().split('.').pop();
  let rows;
  let sourceType;
  if (extension === 'csv' || mediaType === 'text/csv') {
    sourceType = 'csv';
    rows = csvRows(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  } else if (extension === 'json' || String(mediaType).includes('json')) {
    sourceType = 'json';
    let parsed;
    try { parsed = JSON.parse(buffer.toString('utf8')); }
    catch { throw new RequestError(422, 'The JSON file is not valid JSON.'); }
    rows = Array.isArray(parsed) ? parsed : parsed?.records;
  } else if (extension === 'xlsx' || String(mediaType).includes('spreadsheetml')) {
    sourceType = 'xlsx';
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new RequestError(422, 'The workbook does not contain a worksheet.');
    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
      headers[column - 1] = cleanText(excelCellValue(cell), 120) || `column_${column}`;
    });
    rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record = {};
      headers.forEach((header, index) => { record[header] = excelCellValue(row.getCell(index + 1)); });
      if (Object.values(record).some((item) => cleanText(item) !== null)) rows.push(record);
    });
  } else {
    throw new RequestError(415, 'Use a CSV, XLSX, or JSON source file.');
  }
  if (!Array.isArray(rows)) throw new RequestError(422, 'JSON intake requires an array or a records array.');
  if (!rows.length) throw new RequestError(422, 'The source contains no data rows.');
  if (rows.length > MAX_ROWS) throw new RequestError(413, `A single import may contain at most ${MAX_ROWS} rows.`);
  if (rows.some((row) => !row || Array.isArray(row) || typeof row !== 'object')) {
    throw new RequestError(422, 'Every source row must be an object with named fields.');
  }
  return { sourceType, rows };
}

function defaultMappedRow(row) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ''), value]));
  const pick = (...keys) => keys.map((key) => normalized[key]).find((value) => value !== undefined);
  return {
    recordKey: pick('recordkey', 'recordid', 'id', 'sourcerecordid'),
    title: pick('title', 'label', 'name', 'indicatorname'),
    facilityName: pick('facilityname', 'facility'),
    areaCouncil: pick('areacouncil', 'lga'),
    programme: pick('programme', 'program', 'programmearea'),
    indicatorKey: pick('indicatorkey', 'indicator', 'dataelement'),
    observedValue: pick('observedvalue', 'value', 'count', 'total'),
    unit: pick('unit'),
    observationDate: pick('observationdate', 'date'),
    referralStatus: pick('referralstatus'),
    dataQualityStatus: pick('dataqualitystatus'),
    sourceRecordId: pick('sourcerecordid', 'recordid', 'id'),
  };
}

function applyMapping(row, fieldMap = {}) {
  if (!fieldMap || !Object.keys(fieldMap).length) return defaultMappedRow(row);
  const mapped = {};
  for (const [target, source] of Object.entries(fieldMap)) {
    if (!TARGET_FIELDS.has(target)) continue;
    mapped[target] = typeof source === 'string' ? row[source] : null;
  }
  return mapped;
}

async function registerSource(input, actor) {
  const name = cleanText(input.name, 160);
  if (!name || !['csv', 'xlsx', 'json', 'api', 'dhis2'].includes(input.sourceType)) {
    throw new RequestError(422, 'Source name and a supported source type are required.');
  }
  if (!input.jurisdictionId) throw new RequestError(422, 'Select a jurisdiction for this source.');
  const result = await getPool().query(
    `INSERT INTO ng_government_data_sources
       (name, source_type, description, jurisdiction_id, facility_id, programme_area, configuration_json, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
    [name, input.sourceType, cleanText(input.description, 2_000), input.jurisdictionId,
      input.facilityId || null, cleanText(input.programmeArea, 120), JSON.stringify(input.configuration || {}), actorId(actor)]
  );
  return result.rows[0];
}

async function listSources({ accessibleJurisdictionIds, status = 'active' } = {}) {
  const params = [status];
  const scope = Array.isArray(accessibleJurisdictionIds)
    ? ` AND s.jurisdiction_id = ANY($${params.push(accessibleJurisdictionIds)}::uuid[])`
    : '';
  const result = await getPool().query(
    `SELECT s.*, j.name AS jurisdiction_name, f.name AS facility_name
       FROM ng_government_data_sources s
       JOIN ng_jurisdictions j ON j.id=s.jurisdiction_id
       LEFT JOIN public_health_facilities f ON f.id=s.facility_id
      WHERE s.status=$1${scope} ORDER BY s.name`, params
  );
  return result.rows;
}

async function saveMapping(sourceId, input, actor) {
  const fieldMap = input.fieldMap || {};
  const invalidTargets = Object.keys(fieldMap).filter((field) => !TARGET_FIELDS.has(field));
  if (invalidTargets.length) throw new RequestError(422, `Unsupported target fields: ${invalidTargets.join(', ')}`);
  const result = await getPool().query(
    `INSERT INTO ng_government_data_mappings (source_id,name,version,field_map_json,transformations_json,created_by)
     SELECT $1,$2,COALESCE(MAX(version),0)+1,$3::jsonb,$4::jsonb,$5
       FROM ng_government_data_mappings WHERE source_id=$1 RETURNING *`,
    [sourceId, cleanText(input.name, 160) || 'Mapping', JSON.stringify(fieldMap),
      JSON.stringify(input.transformations || {}), actorId(actor)]
  );
  return result.rows[0];
}

async function createImport(input, actor) {
  const rows = input.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) {
    throw new RequestError(422, `Provide between 1 and ${MAX_ROWS} structured records.`);
  }
  if (!input.sourceId || !input.jurisdictionId || !cleanText(input.programmeArea) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.reportingPeriod || '')) {
    throw new RequestError(422, 'Source, jurisdiction, programme, and a YYYY-MM reporting period are required.');
  }
  const payload = input.rawBuffer || Buffer.from(canonicalJson(rows));
  const digest = sha256(payload);
  const idempotencyKey = cleanText(input.idempotencyKey, 300) || sha256([
    digest, input.sourceId, input.jurisdictionId, input.facilityId || '', input.programmeArea, input.reportingPeriod,
  ].join(':'));
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceResult = await client.query('SELECT * FROM ng_government_data_sources WHERE id=$1 AND status=$2 FOR SHARE', [input.sourceId, 'active']);
    const source = sourceResult.rows[0];
    if (!source) throw new RequestError(404, 'The selected source is unavailable.');
    if (String(source.jurisdiction_id) !== String(input.jurisdictionId)) throw new RequestError(422, 'The selected source belongs to a different jurisdiction.');
    if (source.facility_id && String(source.facility_id) !== String(input.facilityId || '')) throw new RequestError(422, 'The selected source belongs to a different facility.');
    if (source.programme_area && source.programme_area !== input.programmeArea) throw new RequestError(422, 'The selected source belongs to a different programme.');
    if (input.mappingId) {
      const mapping = await client.query(
        'SELECT id FROM ng_government_data_mappings WHERE id=$1 AND source_id=$2 AND retired_at IS NULL FOR SHARE',
        [input.mappingId, input.sourceId]
      );
      if (!mapping.rows[0]) throw new RequestError(422, 'The selected mapping does not belong to this active source.');
    }

    let sourceFileId = null;
    if (input.filename) {
      const file = await client.query(
        `INSERT INTO ng_government_source_files
           (source_id,original_filename,media_type,byte_size,sha256_checksum,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (source_id,sha256_checksum) DO UPDATE SET original_filename=EXCLUDED.original_filename
         RETURNING id`,
        [input.sourceId, cleanText(input.filename, 255), cleanText(input.mediaType, 160) || 'application/octet-stream',
          payload.length, digest, actorId(actor)]
      );
      sourceFileId = file.rows[0].id;
    }
    const inserted = await client.query(
      `INSERT INTO ng_government_import_batches
         (source_id,source_file_id,mapping_id,idempotency_key,sha256_checksum,jurisdiction_id,
          facility_id,programme_area,reporting_period,status,row_count,imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'previewed',$10,$11)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [input.sourceId, sourceFileId, input.mappingId || null, idempotencyKey, digest,
        input.jurisdictionId, input.facilityId || null, input.programmeArea,
        input.reportingPeriod, rows.length, actorId(actor)]
    );
    if (!inserted.rows[0]) {
      const existing = await client.query('SELECT * FROM ng_government_import_batches WHERE idempotency_key=$1', [idempotencyKey]);
      await client.query('COMMIT');
      return { batch: existing.rows[0], created: false, duplicateUpload: true };
    }
    const batch = inserted.rows[0];
    for (let index = 0; index < rows.length; index += 1) {
      const rowDigest = sha256(canonicalJson(rows[index]));
      const staged = await client.query(
        `INSERT INTO ng_government_import_rows
           (batch_id,source_row_number,source_payload_json,row_checksum)
         VALUES ($1,$2,$3::jsonb,$4) RETURNING id`,
        [batch.id, index + 1, JSON.stringify(rows[index]), rowDigest]
      );
      await client.query(
        `INSERT INTO ng_government_import_lineage
           (batch_id,import_row_id,source_file_id,mapping_id,importing_user_id,event_type)
         VALUES ($1,$2,$3,$4,$5,'staged')`,
        [batch.id, staged.rows[0].id, sourceFileId, input.mappingId || null, actorId(actor)]
      );
    }
    await client.query('COMMIT');
    return { batch, created: true, duplicateUpload: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function validateBatch(batchId, actor) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batchResult = await client.query('SELECT * FROM ng_government_import_batches WHERE id=$1 FOR UPDATE', [batchId]);
    const batch = batchResult.rows[0];
    if (!batch) throw new RequestError(404, 'Import batch not found.');
    if (!['draft', 'previewed', 'validated'].includes(batch.status)) throw new RequestError(409, `A ${batch.status} batch cannot be validated.`);
    const mappingResult = batch.mapping_id
      ? await client.query('SELECT field_map_json FROM ng_government_data_mappings WHERE id=$1', [batch.mapping_id])
      : { rows: [{ field_map_json: {} }] };
    const fieldMap = mappingResult.rows[0]?.field_map_json || {};
    const indicatorRows = await client.query('SELECT id,internal_key,display_name FROM public_health_indicators WHERE active=TRUE');
    const indicators = new Map(indicatorRows.rows.map((row) => [String(row.internal_key).toLowerCase(), row]));
    const officialRows = await client.query(
      `SELECT id,record_key FROM ng_government_records
        WHERE jurisdiction_id=$1 AND facility_id IS NOT DISTINCT FROM $2::uuid
          AND programme_area=$3 AND reporting_period=$4 AND rolled_back_at IS NULL`,
      [batch.jurisdiction_id, batch.facility_id, batch.programme_area, batch.reporting_period]
    );
    const official = new Map(officialRows.rows.map((row) => [row.record_key, row.id]));
    const rows = await client.query('SELECT * FROM ng_government_import_rows WHERE batch_id=$1 ORDER BY source_row_number', [batchId]);
    await client.query('DELETE FROM ng_government_quarantined_records WHERE batch_id=$1', [batchId]);
    await client.query('DELETE FROM ng_data_quality_findings WHERE batch_id=$1', [batchId]);
    const seen = new Map();
    let valid = 0; let duplicate = 0; let quarantined = 0; let missing = 0; let numericTotal = 0; let numericCount = 0;
    for (const row of rows.rows) {
      const mapped = applyMapping(row.source_payload_json, fieldMap);
      mapped.recordKey = cleanText(mapped.recordKey || mapped.sourceRecordId, 240) || row.row_checksum;
      mapped.title = cleanText(mapped.title, 300) || cleanText(mapped.indicatorKey, 160) || `Government record ${row.source_row_number}`;
      mapped.indicatorKey = cleanText(mapped.indicatorKey, 160);
      mapped.observedValue = nullableNumber(mapped.observedValue);
      mapped.unit = cleanText(mapped.unit, 80);
      mapped.observationDate = cleanText(mapped.observationDate, 40);
      mapped.referralStatus = cleanText(mapped.referralStatus, 80);
      const errors = [];
      const warnings = [];
      const identifierFields = Object.keys(row.source_payload_json).filter((key) => DIRECT_IDENTIFIER_KEYS.has(key.toLowerCase().replace(/[\s_-]/g, '')));
      if (identifierFields.length) errors.push(['DIRECT_IDENTIFIER', null, 'The row contains direct patient identifiers.', 'Remove patient names, contact details, and national identifiers; government intake accepts aggregate or operational records only.']);
      if (Number.isNaN(mapped.observedValue)) errors.push(['INVALID_NUMBER', 'observedValue', 'Observed value is not numeric.', 'Enter a number or leave the observation blank when it is unavailable.']);
      if (mapped.observedValue === null) { missing += 1; warnings.push(['MISSING_OBSERVATION', 'observedValue', 'Observation is missing.', 'No observation was supplied. It will remain missing and will not be counted as zero.']); }
      else { numericTotal += mapped.observedValue; numericCount += 1; }
      if (mapped.observationDate && !/^\d{4}-\d{2}-\d{2}$/.test(mapped.observationDate)) errors.push(['INVALID_DATE', 'observationDate', 'Observation date is not ISO formatted.', 'Use a date in YYYY-MM-DD format.']);
      if (mapped.indicatorKey && !indicators.has(mapped.indicatorKey.toLowerCase())) errors.push(['UNKNOWN_INDICATOR', 'indicatorKey', 'Indicator key is not registered.', 'Choose an active indicator from the indicator list.']);
      const existingId = official.get(mapped.recordKey);
      const withinBatch = seen.get(mapped.recordKey);
      let status = 'valid';
      if (existingId || withinBatch) status = 'duplicate';
      else if (errors.length) status = 'invalid';
      if (status === 'valid') { valid += 1; seen.set(mapped.recordKey, row.id); }
      if (status === 'duplicate') duplicate += 1;
      if (status === 'invalid') quarantined += 1;
      await client.query(
        `UPDATE ng_government_import_rows
            SET mapped_payload_json=$2::jsonb,validation_status=$3,
                duplicate_of_row_id=$4,duplicate_of_record_id=$5
          WHERE id=$1`,
        [row.id, JSON.stringify(mapped), status, withinBatch || null, existingId || null]
      );
      for (const [code, field, technical, plain] of [...errors, ...warnings]) {
        await client.query(
          `INSERT INTO ng_data_quality_findings
             (batch_id,import_row_id,finding_code,severity,field_name,technical_message,plain_language_message)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [batchId, row.id, code, errors.some((item) => item[0] === code) ? 'error' : 'warning', field, technical, plain]
        );
      }
      if (status === 'invalid') {
        await client.query(
          `INSERT INTO ng_government_quarantined_records (batch_id,import_row_id,reason_codes,payload_json)
           VALUES ($1,$2,$3,$4::jsonb)`, [batchId, row.id, errors.map((item) => item[0]), JSON.stringify(row.source_payload_json)]
        );
      }
      await client.query(
        `INSERT INTO ng_government_import_lineage
           (batch_id,import_row_id,source_file_id,mapping_id,importing_user_id,event_type,detail_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [batchId, row.id, batch.source_file_id, batch.mapping_id, actorId(actor),
          status === 'invalid' ? 'quarantined' : 'validated', JSON.stringify({ status })]
      );
    }
    const reconciled = valid + duplicate + quarantined === rows.rows.length;
    await client.query(
      `UPDATE ng_government_import_batches
          SET status='validated',valid_count=$2,duplicate_count=$3,quarantined_count=$4,updated_at=NOW()
        WHERE id=$1`, [batchId, valid, duplicate, quarantined]
    );
    const reconciliation = await client.query(
      `INSERT INTO ng_government_import_reconciliations
         (batch_id,stage,source_row_count,valid_row_count,duplicate_row_count,quarantined_row_count,
          missing_value_count,observed_numeric_total,reconciled,detail_json,created_by)
       VALUES ($1,'validation',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,
      [batchId, rows.rows.length, valid, duplicate, quarantined, missing,
        numericCount ? numericTotal : null, reconciled, JSON.stringify({ numericObservationCount: numericCount }), actorId(actor)]
    );
    await client.query('COMMIT');
    return { batchId, valid, duplicate, quarantined, missing, reconciled, reconciliation: reconciliation.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function decideBatch(batchId, decision, actor, notes) {
  if (!['submit', 'approve', 'reject'].includes(decision)) throw new RequestError(422, 'Unsupported import decision.');
  const userId = actorId(actor);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM ng_government_import_batches WHERE id=$1 FOR UPDATE', [batchId]);
    const batch = found.rows[0];
    if (!batch) throw new RequestError(404, 'Import batch not found.');
    if (decision === 'submit' && batch.status !== 'validated') throw new RequestError(409, 'Validate and reconcile this batch before submitting it.');
    if (['approve', 'reject'].includes(decision) && batch.status !== 'submitted') throw new RequestError(409, 'Only a submitted batch can be approved or rejected.');
    if (decision === 'approve' && userId && String(batch.imported_by) === String(userId)) {
      throw new RequestError(409, 'Maker-checker control requires a different user to approve this import.');
    }
    if (decision === 'submit') {
      await client.query(`UPDATE ng_government_import_batches SET status='submitted',submitted_at=NOW(),updated_at=NOW() WHERE id=$1`, [batchId]);
    } else if (decision === 'approve') {
      await client.query(`UPDATE ng_government_import_batches SET status='approved',approved_by=$2,approved_at=NOW(),decision_notes=$3,updated_at=NOW() WHERE id=$1`, [batchId, userId, cleanText(notes, 2_000)]);
    } else {
      await client.query(`UPDATE ng_government_import_batches SET status='rejected',rejected_by=$2,rejected_at=NOW(),decision_notes=$3,updated_at=NOW() WHERE id=$1`, [batchId, userId, cleanText(notes, 2_000)]);
    }
    await client.query('INSERT INTO ng_government_import_decisions (batch_id,decision,actor_user_id,notes) VALUES ($1,$2,$3,$4)', [batchId, decision, userId, cleanText(notes, 2_000)]);
    await client.query('COMMIT');
    return { batchId, status: decision === 'submit' ? 'submitted' : decision === 'approve' ? 'approved' : 'rejected' };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function commitBatch(batchId, actor) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM ng_government_import_batches WHERE id=$1 FOR UPDATE', [batchId]);
    const batch = found.rows[0];
    if (!batch) throw new RequestError(404, 'Import batch not found.');
    if (batch.status === 'committed') { await client.query('COMMIT'); return { batchId, status: 'committed', idempotent: true }; }
    if (batch.status !== 'approved') throw new RequestError(409, 'An independent approver must approve this batch before commit.');
    const rows = await client.query(
      `SELECT r.*,i.id AS indicator_id,i.display_name AS indicator_name
         FROM ng_government_import_rows r
         LEFT JOIN public_health_indicators i
           ON LOWER(i.internal_key)=LOWER(r.mapped_payload_json->>'indicatorKey')
        WHERE r.batch_id=$1 AND r.validation_status='valid' ORDER BY r.source_row_number FOR UPDATE OF r`, [batchId]
    );
    let committed = 0;
    for (const row of rows.rows) {
      const mapped = row.mapped_payload_json;
      const record = await client.query(
        `INSERT INTO ng_government_records
           (batch_id,import_row_id,source_id,mapping_id,jurisdiction_id,facility_id,programme_area,
            indicator_id,reporting_period,observation_date,record_key,title,observed_value,unit,
            approval_status,referral_status,data_quality_status,data_json,approved_by,approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'approved',$15,$16,$17::jsonb,$18,NOW())
         RETURNING id`,
        [batch.id, row.id, batch.source_id, batch.mapping_id, batch.jurisdiction_id, batch.facility_id,
          batch.programme_area, row.indicator_id, batch.reporting_period, mapped.observationDate || null,
          mapped.recordKey, mapped.title || row.indicator_name, mapped.observedValue, mapped.unit || null,
          mapped.referralStatus || null, mapped.dataQualityStatus || 'valid', JSON.stringify(mapped),
          batch.approved_by]
      );
      const recordId = record.rows[0].id;
      await client.query('UPDATE ng_government_import_rows SET committed_record_id=$2 WHERE id=$1', [row.id, recordId]);
      if (row.indicator_id) {
        await client.query(
          `INSERT INTO ng_indicator_observations
             (government_record_id,indicator_id,jurisdiction_id,facility_id,programme_area,reporting_period,
              observed_value,unit,source_batch_id,validation_status,approved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'valid',NOW())`,
          [recordId, row.indicator_id, batch.jurisdiction_id, batch.facility_id, batch.programme_area,
            batch.reporting_period, mapped.observedValue, mapped.unit || null, batch.id]
        );
      }
      await client.query(
        `INSERT INTO ng_government_import_lineage
           (batch_id,import_row_id,government_record_id,source_file_id,mapping_id,importing_user_id,
            approving_user_id,event_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'committed')`,
        [batch.id, row.id, recordId, batch.source_file_id, batch.mapping_id, batch.imported_by, batch.approved_by]
      );
      committed += 1;
    }
    await client.query(`UPDATE ng_government_import_batches SET status='committed',committed_at=NOW(),updated_at=NOW() WHERE id=$1`, [batchId]);
    await client.query(
      `INSERT INTO ng_government_import_reconciliations
         (batch_id,stage,source_row_count,valid_row_count,duplicate_row_count,quarantined_row_count,
          missing_value_count,observed_numeric_total,reconciled,detail_json,created_by)
       SELECT b.id,'commit',b.row_count,$2,b.duplicate_count,b.quarantined_count,
              (SELECT COUNT(*) FROM ng_government_import_rows r WHERE r.batch_id=b.id AND r.validation_status='valid' AND r.mapped_payload_json->>'observedValue' IS NULL),
              (SELECT SUM((r.mapped_payload_json->>'observedValue')::numeric) FROM ng_government_import_rows r WHERE r.batch_id=b.id AND r.validation_status='valid' AND r.mapped_payload_json->>'observedValue' IS NOT NULL),
              $2=b.valid_count,$3::jsonb,$4 FROM ng_government_import_batches b WHERE b.id=$1`,
      [batchId, committed, JSON.stringify({ committed }), actorId(actor)]
    );
    await client.query('COMMIT');
    return { batchId, status: 'committed', committed, idempotent: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function rollbackBatch(batchId, actor, reason) {
  const explanation = cleanText(reason, 2_000);
  if (!explanation) throw new RequestError(422, 'A rollback reason is required.');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM ng_government_import_batches WHERE id=$1 FOR UPDATE', [batchId]);
    const batch = found.rows[0];
    if (!batch) throw new RequestError(404, 'Import batch not found.');
    if (batch.status === 'rolled_back') { await client.query('COMMIT'); return { batchId, status: 'rolled_back', idempotent: true }; }
    if (batch.status !== 'committed') throw new RequestError(409, 'Only a committed batch can be rolled back.');
    const userId = actorId(actor);
    const records = await client.query(
      `UPDATE ng_government_records SET rolled_back_at=NOW(),rolled_back_by=$2,rollback_reason=$3
        WHERE batch_id=$1 AND rolled_back_at IS NULL RETURNING id`, [batchId, userId, explanation]
    );
    await client.query('UPDATE ng_indicator_observations SET rolled_back_at=NOW() WHERE source_batch_id=$1 AND rolled_back_at IS NULL', [batchId]);
    await client.query(`UPDATE ng_government_import_batches SET status='rolled_back',rolled_back_at=NOW(),rolled_back_by=$2,rollback_reason=$3,updated_at=NOW() WHERE id=$1`, [batchId, userId, explanation]);
    await client.query(`INSERT INTO ng_government_import_decisions (batch_id,decision,actor_user_id,notes) VALUES ($1,'rollback',$2,$3)`, [batchId, userId, explanation]);
    for (const record of records.rows) {
      await client.query(`INSERT INTO ng_government_import_lineage (batch_id,government_record_id,importing_user_id,approving_user_id,event_type,detail_json) VALUES ($1,$2,$3,$4,'rolled_back',$5::jsonb)`, [batchId, record.id, batch.imported_by, userId, JSON.stringify({ reason: explanation })]);
    }
    await client.query('COMMIT');
    return { batchId, status: 'rolled_back', rolledBack: records.rowCount, idempotent: false };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function getBatchReport(batchId) {
  const pool = getPool();
  const [batch, rows, findings, reconciliations, decisions] = await Promise.all([
    pool.query(`SELECT b.*,s.name AS source_name,s.source_type,j.name AS jurisdiction_name,f.name AS facility_name,m.version AS mapping_version FROM ng_government_import_batches b JOIN ng_government_data_sources s ON s.id=b.source_id JOIN ng_jurisdictions j ON j.id=b.jurisdiction_id LEFT JOIN public_health_facilities f ON f.id=b.facility_id LEFT JOIN ng_government_data_mappings m ON m.id=b.mapping_id WHERE b.id=$1`, [batchId]),
    pool.query('SELECT * FROM ng_government_import_rows WHERE batch_id=$1 ORDER BY source_row_number', [batchId]),
    pool.query('SELECT * FROM ng_data_quality_findings WHERE batch_id=$1 ORDER BY created_at,id', [batchId]),
    pool.query('SELECT * FROM ng_government_import_reconciliations WHERE batch_id=$1 ORDER BY created_at', [batchId]),
    pool.query('SELECT * FROM ng_government_import_decisions WHERE batch_id=$1 ORDER BY created_at', [batchId]),
  ]);
  if (!batch.rows[0]) throw new RequestError(404, 'Import batch not found.');
  return { batch: batch.rows[0], rows: rows.rows, findings: findings.rows, reconciliations: reconciliations.rows, decisions: decisions.rows };
}

function addFilter(filters, params, sql, value, transform = (item) => item) {
  if (value === undefined || value === null || value === '') return;
  params.push(transform(value));
  filters.push(sql.replace('?', `$${params.length}`));
}

async function searchRecords(input, actor, accessibleJurisdictionIds) {
  const filters = ['r.rolled_back_at IS NULL'];
  const params = [];
  let queryParameter = null;
  addFilter(filters, params, `r.approval_status=?`, input.approvalStatus || 'approved');
  if (Array.isArray(accessibleJurisdictionIds)) {
    if (!accessibleJurisdictionIds.length) return { records: [], total: 0, page: 1, pageSize: 25 };
    addFilter(filters, params, 'r.jurisdiction_id=ANY(?::uuid[])', accessibleJurisdictionIds);
  }
  if (input.q) {
    params.push(cleanText(input.q, 200));
    queryParameter = params.length;
    filters.push(`(r.search_vector @@ websearch_to_tsquery('simple',$${params.length}) OR r.title ILIKE '%'||$${params.length}||'%' OR r.record_key ILIKE '%'||$${params.length}||'%')`);
  }
  addFilter(filters, params, 'r.facility_id=?::uuid', input.facilityId);
  addFilter(filters, params, 'r.jurisdiction_id=?::uuid', input.jurisdictionId || input.areaCouncilId);
  addFilter(filters, params, 'r.programme_area=?', input.programmeArea);
  addFilter(filters, params, 'r.indicator_id=?::uuid', input.indicatorId);
  addFilter(filters, params, 'r.reporting_period>=?', input.periodFrom);
  addFilter(filters, params, 'r.reporting_period<=?', input.periodTo);
  addFilter(filters, params, 'r.observation_date>=?::date', input.dateFrom);
  addFilter(filters, params, 'r.observation_date<=?::date', input.dateTo);
  addFilter(filters, params, 'r.referral_status=?', input.referralStatus);
  addFilter(filters, params, 'r.data_quality_status=?', input.dataQualityStatus);
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 25, 1), 5_000);
  const page = Math.max(Number(input.page) || 1, 1);
  const ordering = queryParameter
    ? `ts_rank_cd(r.search_vector,websearch_to_tsquery('simple',$${queryParameter})) DESC,r.created_at DESC`
    : 'r.created_at DESC';
  params.push(pageSize, (page - 1) * pageSize);
  const result = await getPool().query(
    `SELECT r.id,r.record_key,r.title,r.programme_area,r.reporting_period,r.observation_date,
            r.observed_value,r.unit,r.approval_status,r.referral_status,r.data_quality_status,
            r.created_at,f.name AS facility_name,j.name AS area_council,i.display_name AS indicator_name,
            s.name AS source_name,COUNT(*) OVER()::int AS total_count
       FROM ng_government_records r
       JOIN ng_jurisdictions j ON j.id=r.jurisdiction_id
       JOIN ng_government_data_sources s ON s.id=r.source_id
       LEFT JOIN public_health_facilities f ON f.id=r.facility_id
      LEFT JOIN public_health_indicators i ON i.id=r.indicator_id
      WHERE ${filters.join(' AND ')}
      ORDER BY ${ordering}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = result.rows[0]?.total_count || 0;
  if (actorId(actor) && cleanText(input.q)) {
    await getPool().query(
      `INSERT INTO ng_government_recent_searches (user_id,query_text,filters_json,result_count)
       VALUES ($1,$2,$3::jsonb,$4)`, [actorId(actor), cleanText(input.q, 200), JSON.stringify(input), total]
    );
  }
  return { records: result.rows.map(({ total_count, ...row }) => row), total, page, pageSize };
}

async function autocomplete(q, accessibleJurisdictionIds) {
  const params = [cleanText(q, 120) || ''];
  let scope = '';
  if (Array.isArray(accessibleJurisdictionIds)) {
    if (!accessibleJurisdictionIds.length) return [];
    params.push(accessibleJurisdictionIds);
    scope = ` AND jurisdiction_id=ANY($2::uuid[])`;
  }
  const result = await getPool().query(
    `SELECT DISTINCT title FROM ng_government_records
      WHERE rolled_back_at IS NULL AND approval_status='approved' AND title ILIKE $1||'%'${scope}
      ORDER BY title LIMIT 10`, params
  );
  return result.rows.map((row) => row.title);
}

async function recentSearches(userId) {
  const result = await getPool().query(
    `SELECT id,query_text,filters_json,result_count,searched_at FROM ng_government_recent_searches
      WHERE user_id=$1 ORDER BY searched_at DESC LIMIT 10`, [userId]
  );
  return result.rows;
}

async function saveView(userId, input) {
  const name = cleanText(input.name, 120);
  if (!name) throw new RequestError(422, 'A saved-view name is required.');
  const result = await getPool().query(
    `INSERT INTO ng_government_saved_views (user_id,name,filters_json)
     VALUES ($1,$2,$3::jsonb) ON CONFLICT (user_id,name)
     DO UPDATE SET filters_json=EXCLUDED.filters_json,updated_at=NOW() RETURNING *`,
    [userId, name, JSON.stringify(input.filters || {})]
  );
  return result.rows[0];
}

async function listViews(userId) {
  return (await getPool().query('SELECT * FROM ng_government_saved_views WHERE user_id=$1 ORDER BY name', [userId])).rows;
}

function safeSpreadsheetValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvEscape(value) {
  const text = safeSpreadsheetValue(value).replace(/"/g, '""');
  return `"${text}"`;
}

const EXPORT_COLUMNS = [
  ['title', 'Record'], ['facility_name', 'Facility'], ['area_council', 'Area Council'],
  ['programme_area', 'Programme'], ['indicator_name', 'Indicator'], ['reporting_period', 'Reporting period'],
  ['observation_date', 'Observation date'], ['observed_value', 'Observed value'], ['unit', 'Unit'],
  ['approval_status', 'Approval status'], ['referral_status', 'Referral status'],
  ['data_quality_status', 'Data-quality status'], ['source_name', 'Source'],
];

async function exportSearch(format, input, actor, accessibleJurisdictionIds) {
  const result = await searchRecords({ ...input, page: 1, pageSize: 5_000 }, null, accessibleJurisdictionIds);
  if (format === 'csv') {
    return { contentType: 'text/csv; charset=utf-8', extension: 'csv', body: [
      EXPORT_COLUMNS.map(([, label]) => csvEscape(label)).join(','),
      ...result.records.map((row) => EXPORT_COLUMNS.map(([key]) => csvEscape(row[key])).join(',')),
    ].join('\r\n') };
  }
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DoctaRx Zuma TeleDoc';
    const sheet = workbook.addWorksheet('Approved government records');
    sheet.columns = EXPORT_COLUMNS.map(([key, header]) => ({ key, header, width: Math.min(Math.max(header.length + 4, 16), 32) }));
    result.records.forEach((record) => sheet.addRow(Object.fromEntries(EXPORT_COLUMNS.map(([key]) => [key, safeSpreadsheetValue(record[key])]))));
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + EXPORT_COLUMNS.length)}1` };
    return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx', body: Buffer.from(await workbook.xlsx.writeBuffer()) };
  }
  if (format === 'pdf') {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(15); doc.text('DoctaRx approved government records', 36, 36);
    doc.setFontSize(8);
    let y = 56;
    for (const row of result.records) {
      const line = `${row.reporting_period || '—'} | ${row.facility_name || 'All facilities'} | ${row.programme_area} | ${row.title} | ${row.observed_value ?? 'Missing'} ${row.unit || ''}`;
      const lines = doc.splitTextToSize(line, 760);
      if (y + lines.length * 10 > 560) { doc.addPage(); y = 36; }
      doc.text(lines, 36, y); y += lines.length * 10 + 3;
    }
    return { contentType: 'application/pdf', extension: 'pdf', body: Buffer.from(doc.output('arraybuffer')) };
  }
  throw new RequestError(422, 'Export format must be csv, xlsx, or pdf.');
}

async function dhis2Export(batchId) {
  const result = await getPool().query(
    `SELECT b.reporting_period,f.dhis2_org_unit_id,i.dhis2_data_element_id,
            i.dhis2_category_option_combo_id,r.observed_value,r.record_key
       FROM ng_government_records r
       JOIN ng_government_import_batches b ON b.id=r.batch_id
       LEFT JOIN public_health_facilities f ON f.id=r.facility_id
       LEFT JOIN public_health_indicators i ON i.id=r.indicator_id
      WHERE r.batch_id=$1 AND r.rolled_back_at IS NULL AND r.approval_status='approved'`, [batchId]
  );
  const omissions = [];
  const dataValues = [];
  for (const row of result.rows) {
    if (row.observed_value === null) { omissions.push({ recordKey: row.record_key, reason: 'missing_observation' }); continue; }
    if (!row.dhis2_org_unit_id || !row.dhis2_data_element_id) { omissions.push({ recordKey: row.record_key, reason: 'missing_dhis2_mapping' }); continue; }
    dataValues.push({
      dataElement: row.dhis2_data_element_id,
      categoryOptionCombo: row.dhis2_category_option_combo_id || undefined,
      orgUnit: row.dhis2_org_unit_id,
      period: row.reporting_period.replace('-', ''),
      value: String(row.observed_value),
    });
  }
  return { completeDate: new Date().toISOString().slice(0, 10), dataValues, omissions, dryRunOnly: true };
}

async function createGovernmentInvitation(input, actor) {
  const email = cleanText(input.email, 255)?.toLowerCase();
  const allowedRoles = new Set(['provider', 'facility_admin', 'analyst', 'reviewer', 'approver', 'programme_admin', 'executive_read_only', 'platform_admin']);
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !input.jurisdictionId || !allowedRoles.has(input.role)) {
    throw new RequestError(422, 'Email, jurisdiction, and a supported least-privilege role are required.');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresHours = Math.min(Math.max(Number(input.expiresHours) || 72, 1), 168);
  const dataClass = input.role === 'executive_read_only' ? 'aggregate' : (input.dataClassLevel || 'aggregate');
  const result = await getPool().query(
    `INSERT INTO ng_government_account_invitations
       (email,token_hash,jurisdiction_id,facility_id,programme_area,government_role,
        can_export,can_approve,data_class_level,invited_by,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+($11::text||' hours')::interval)
     RETURNING id,email,jurisdiction_id,facility_id,programme_area,government_role,
               can_export,can_approve,data_class_level,invited_at,expires_at`,
    [email, sha256(token), input.jurisdictionId, input.facilityId || null,
      cleanText(input.programmeArea, 120), input.role, input.canExport === true,
      input.canApprove === true, dataClass, actorId(actor), expiresHours]
  );
  return { invitation: result.rows[0], token };
}

async function acceptGovernmentInvitation(input) {
  const token = cleanText(input.token, 500);
  const password = String(input.password || '');
  if (!token || password.length < 12) throw new RequestError(422, 'A valid invitation and a password of at least 12 characters are required.');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT * FROM ng_government_account_invitations
        WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW()
        FOR UPDATE`, [sha256(token)]
    );
    const invitation = found.rows[0];
    if (!invitation) throw new RequestError(404, 'This government invitation is invalid, expired, used, or revoked.');
    const existing = await client.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [invitation.email]);
    if (existing.rows.length) throw new RequestError(409, 'An account already uses this email. A platform administrator must grant its government scope directly.');
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await client.query(
      `INSERT INTO users (email,password_hash,role,first_name,last_name,is_active)
       VALUES ($1,$2,'patient',$3,$4,TRUE) RETURNING id,email`,
      [invitation.email, passwordHash, cleanText(input.firstName, 100), cleanText(input.lastName, 100)]
    );
    const user = created.rows[0];
    await client.query(
      `INSERT INTO ng_user_jurisdiction_roles
         (user_id,jurisdiction_id,role,facility_id,programme_area,can_export,can_approve,
          can_view_aggregate,data_class_level,granted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9)`,
      [user.id, invitation.jurisdiction_id, invitation.government_role, invitation.facility_id,
        invitation.programme_area, invitation.can_export, invitation.can_approve,
        invitation.government_role === 'executive_read_only' ? 'aggregate' : invitation.data_class_level,
        invitation.invited_by]
    );
    await client.query('UPDATE ng_government_account_invitations SET accepted_by=$2,accepted_at=NOW() WHERE id=$1', [invitation.id, user.id]);
    await client.query('COMMIT');
    return { user, requiresMfaEnrollment: true, loginRole: 'patient' };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function revokeInvitation(invitationId, actor) {
  const result = await getPool().query(
    `UPDATE ng_government_account_invitations SET revoked_at=NOW(),revoked_by=$2
      WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [invitationId, actorId(actor)]
  );
  if (!result.rows[0]) throw new RequestError(404, 'Active invitation not found.');
  return { revoked: true };
}

async function revokeGovernmentAccount(targetUserId, actor) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roles = await client.query(
      `UPDATE ng_user_jurisdiction_roles SET active=FALSE,updated_at=NOW()
        WHERE user_id=$1 AND active=TRUE RETURNING id`, [targetUserId]
    );
    if (!roles.rowCount) throw new RequestError(404, 'No active government account scope was found.');
    await client.query('UPDATE users SET is_active=FALSE,updated_at=NOW() WHERE id=$1', [targetUserId]);
    await client.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [targetUserId]);
    await client.query(
      `INSERT INTO ng_audit_lineage (actor_user_id,action,resource_type,metadata_json)
       VALUES ($1,'permission_revoke','government_account',$2::jsonb)`,
      [actorId(actor), JSON.stringify({ targetUserId, revokedScopes: roles.rowCount })]
    );
    await client.query('COMMIT');
    return { revoked: true, revokedScopes: roles.rowCount };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

module.exports = {
  RequestError,
  parseFile,
  registerSource,
  listSources,
  saveMapping,
  createImport,
  validateBatch,
  decideBatch,
  commitBatch,
  rollbackBatch,
  getBatchReport,
  searchRecords,
  autocomplete,
  recentSearches,
  saveView,
  listViews,
  exportSearch,
  dhis2Export,
  createGovernmentInvitation,
  acceptGovernmentInvitation,
  revokeInvitation,
  revokeGovernmentAccount,
  applyMapping,
  csvRows,
  canonicalJson,
};
