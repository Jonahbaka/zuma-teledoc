'use strict';

/**
 * ng/services/rx-engine/medicationSearchV2.js
 *
 * Fuzzy + alias-aware medication search for the Nigerian market.
 *
 * Strategy (single round-trip):
 *   1. normalize the query (lowercase, strip punctuation, collapse whitespace)
 *   2. parse out any dosage hint  ('amox 500' → drug='amox', dose=500, unit='mg')
 *   3. UNION three candidate sources, each with its own relevance signal:
 *        a) exact / prefix match on name|generic|brand
 *        b) trigram similarity on name|generic|brand
 *        c) alias hit in ng_drug_brand_aliases (resolved to drug by generic_name)
 *   4. score each candidate, dedupe by drug_id, return top-N.
 *
 * Designed to be safe against a missing alias table (returns just catalog
 * hits) — so it works on day-zero before migration 014 lands.
 */

const { getPool } = require('../../../server/db');

const DEFAULT_LIMIT = 16;
const MAX_LIMIT     = 50;
const MIN_SIMILARITY = 0.25; // pg_trgm default is 0.3; we go slightly looser

function isMissingDbObject(err) {
  return ['42P01', '42703', '42883'].includes(err?.code);
}

// ─── Text normalization ──────────────────────────────────────────────────────

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s.\-/+]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Dosage parser ────────────────────────────────────────────────────────────

const DOSE_UNIT_RE = /(\d+(?:\.\d+)?)\s*(mg|g|mcg|µg|ug|ml|iu|units?)\b/i;

/**
 * Parse "Coartem 80/480" → { drugText: "coartem", dose: 80, unit: 'mg', second: 480 }
 *       "amoxicillin 500mg" → { drugText: "amoxicillin", dose: 500, unit: 'mg' }
 *       "ors" → { drugText: "ors" }
 */
function parseDose(rawQuery) {
  const q = normalize(rawQuery);
  if (!q) return { drugText: '', dose: null, unit: null, second: null };

  const m = q.match(DOSE_UNIT_RE);
  let dose = null, unit = null;
  if (m) { dose = Number(m[1]); unit = m[2].toLowerCase().replace('µg', 'mcg').replace('ug', 'mcg'); }

  // Detect "80/480" pattern (combo drugs like ART-LUM)
  const combo = q.match(/(\d+)\s*\/\s*(\d+)/);
  const second = combo ? Number(combo[2]) : null;
  if (combo && dose == null) dose = Number(combo[1]);

  // strip dose info to isolate the drug text
  const drugText = q
    .replace(DOSE_UNIT_RE, ' ')
    .replace(/\d+\s*\/\s*\d+/, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { drugText, dose, unit: unit || (dose ? 'mg' : null), second };
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * search({ q, limit, category, requiresPrescription })
 * → { medicines: [{ id, name, generic_name, brand_name, dosage_form, strength,
 *                   relevance, matched_via, matched_alias?, dose_hint? }], total, query }
 */
async function search(params = {}, pool = getPool()) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.limit) || DEFAULT_LIMIT));
  const parsed = parseDose(params.q || '');
  const text = parsed.drugText;

  if (!text) return { medicines: [], total: 0, query: parsed };

  const likeText = `%${text}%`;
  const aliasRows = await searchAliases(text, likeText, pool);
  const aliasGenerics = aliasRows.map(a => a.generic_name).filter(Boolean);

  const where = [];
  const values = [];
  let i = 0;
  const next = () => `$${++i}`;

  // Exact / prefix / substring on catalog
  const textParamIdx = next(); values.push(text);
  const likeParamIdx = next(); values.push(likeText);

  let aliasFilter = '';
  if (aliasGenerics.length) {
    aliasFilter = `OR LOWER(generic_name) = ANY(${next()})`;
    values.push(aliasGenerics.map(g => g.toLowerCase()));
  }

  where.push(`(
       LOWER(name) = ${textParamIdx}
    OR LOWER(generic_name) = ${textParamIdx}
    OR LOWER(brand_name) = ${textParamIdx}
    OR LOWER(name) LIKE ${likeParamIdx}
    OR LOWER(COALESCE(generic_name,'')) LIKE ${likeParamIdx}
    OR LOWER(COALESCE(brand_name,'')) LIKE ${likeParamIdx}
    OR similarity(LOWER(name), ${textParamIdx}) > ${MIN_SIMILARITY}
    OR similarity(LOWER(COALESCE(generic_name,'')), ${textParamIdx}) > ${MIN_SIMILARITY}
    OR similarity(LOWER(COALESCE(brand_name,'')), ${textParamIdx}) > ${MIN_SIMILARITY}
    ${aliasFilter}
  )`);

  if (params.category) {
    where.push(`featured_category = ${next()}`); values.push(params.category);
  }
  if (params.requiresPrescription === true || params.requiresPrescription === false) {
    where.push(`requires_prescription = ${next()}`); values.push(params.requiresPrescription);
  }

  const sql = `
    SELECT id, name, generic_name, brand_name, dosage_form, strength,
           therapeutic_class, requires_prescription, otc_candidate, controlled,
           featured_category, price_ngn, nhia_listed,
           GREATEST(
             CASE WHEN LOWER(name) = ${textParamIdx}                          THEN 1.0 ELSE 0 END,
             CASE WHEN LOWER(generic_name) = ${textParamIdx}                  THEN 0.95 ELSE 0 END,
             CASE WHEN LOWER(brand_name) = ${textParamIdx}                    THEN 0.95 ELSE 0 END,
             CASE WHEN LOWER(name) LIKE ${likeParamIdx}                       THEN 0.7 ELSE 0 END,
             CASE WHEN LOWER(COALESCE(generic_name,'')) LIKE ${likeParamIdx}  THEN 0.65 ELSE 0 END,
             CASE WHEN LOWER(COALESCE(brand_name,'')) LIKE ${likeParamIdx}    THEN 0.65 ELSE 0 END,
             similarity(LOWER(name), ${textParamIdx}),
             similarity(LOWER(COALESCE(generic_name,'')), ${textParamIdx}),
             similarity(LOWER(COALESCE(brand_name,'')), ${textParamIdx})
           ) AS relevance
      FROM ng_drug_catalog
     WHERE ${where.join(' AND ')}
     ORDER BY relevance DESC, requires_prescription ASC, name ASC
     LIMIT ${next()}
  `;
  values.push(limit);

  let rows = [];
  try {
    const r = await pool.query(sql, values);
    rows = r.rows;
  } catch (err) {
    if (!isMissingDbObject(err)) throw err;
  }

  const aliasIndex = indexByGenericLower(aliasRows);
  const out = rows.map(r => {
    const matchedAlias = aliasIndex.get(String(r.generic_name || '').toLowerCase());
    return {
      ...r,
      relevance: Number(r.relevance ?? 0).toFixed(3),
      matched_via:
        matchedAlias                                              ? 'alias' :
        Number(r.relevance) >= 0.95                                ? 'exact' :
        Number(r.relevance) >= 0.65                                ? 'prefix' :
                                                                     'fuzzy',
      matched_alias: matchedAlias?.alias_name || null,
      dose_hint: parsed.dose ? { dose: parsed.dose, unit: parsed.unit, second: parsed.second } : null,
    };
  });

  return { medicines: out, total: out.length, query: parsed };
}

function indexByGenericLower(aliases) {
  const m = new Map();
  for (const a of aliases) {
    if (!a.generic_name) continue;
    const key = String(a.generic_name).toLowerCase();
    if (!m.has(key)) m.set(key, a);
  }
  return m;
}

async function searchAliases(text, like, pool) {
  try {
    const r = await pool.query(
      `SELECT alias_name, generic_name, popularity,
              similarity(alias_normalized, $1) AS sim
         FROM ng_drug_brand_aliases
        WHERE is_active = TRUE
          AND (alias_normalized = $1
            OR alias_normalized LIKE $2
            OR similarity(alias_normalized, $1) > $3)
        ORDER BY (alias_normalized = $1) DESC, sim DESC, popularity DESC
        LIMIT 25`,
      [text, like, MIN_SIMILARITY]
    );
    return r.rows;
  } catch (err) {
    if (isMissingDbObject(err)) return [];
    throw err;
  }
}

// ─── Autocomplete (lightweight, alias-first) ─────────────────────────────────

async function autocomplete(qRaw, limit = 8, pool = getPool()) {
  const text = normalize(qRaw);
  if (!text) return [];
  try {
    const r = await pool.query(
      `WITH alias_hits AS (
         SELECT alias_name AS suggestion, generic_name AS resolves_to, 'alias' AS kind,
                CASE WHEN alias_normalized = $1 THEN 1.0
                     WHEN alias_normalized LIKE $1 || '%' THEN 0.85
                     ELSE similarity(alias_normalized, $1) END AS score
           FROM ng_drug_brand_aliases
          WHERE alias_normalized LIKE $1 || '%'
             OR similarity(alias_normalized, $1) > $2
       ),
       drug_hits AS (
         SELECT COALESCE(brand_name, name) AS suggestion,
                generic_name AS resolves_to, 'drug' AS kind,
                CASE WHEN LOWER(name) = $1 THEN 1.0
                     WHEN LOWER(name) LIKE $1 || '%' THEN 0.8
                     WHEN LOWER(COALESCE(brand_name,'')) LIKE $1 || '%' THEN 0.75
                     ELSE similarity(LOWER(name), $1) END AS score
           FROM ng_drug_catalog
          WHERE LOWER(name) LIKE $1 || '%'
             OR LOWER(COALESCE(brand_name,'')) LIKE $1 || '%'
             OR similarity(LOWER(name), $1) > $2
       )
       SELECT * FROM alias_hits
       UNION ALL
       SELECT * FROM drug_hits
       ORDER BY score DESC
       LIMIT $3`,
      [text, MIN_SIMILARITY, limit]
    );
    // de-dupe preserving order
    const seen = new Set();
    const out = [];
    for (const row of r.rows) {
      const k = (row.suggestion || '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    if (isMissingDbObject(err)) return [];
    throw err;
  }
}

// ─── Interactions ────────────────────────────────────────────────────────────

/**
 * checkInteractions(generics: string[]) → [{ a, b, severity, mechanism, ... }]
 */
async function checkInteractions(generics = [], pool = getPool()) {
  const lowered = (generics || [])
    .map(g => String(g || '').trim().toLowerCase())
    .filter(Boolean);
  if (lowered.length < 2) return [];
  try {
    const r = await pool.query(
      `SELECT drug_a_generic AS a, drug_b_generic AS b, severity, mechanism, effect, management
         FROM ng_drug_interactions
        WHERE LOWER(drug_a_generic) = ANY($1)
          AND LOWER(drug_b_generic) = ANY($1)`,
      [lowered]
    );
    // dedupe a↔b symmetric pairs (we seeded both directions for fast lookup)
    const seen = new Set();
    const out = [];
    for (const row of r.rows) {
      const k = [row.a.toLowerCase(), row.b.toLowerCase()].sort().join('||');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
    return out;
  } catch (err) {
    if (isMissingDbObject(err)) return [];
    throw err;
  }
}

module.exports = {
  search,
  autocomplete,
  checkInteractions,
  // exposed for tests
  normalize,
  parseDose,
};
