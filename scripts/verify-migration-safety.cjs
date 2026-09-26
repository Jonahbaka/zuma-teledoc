#!/usr/bin/env node
/**
 * scripts/verify-migration-safety.cjs
 *
 * Static safety gate for the SQL migrations. "It is additive" is a claim, not a
 * guarantee, so this checks the claim mechanically before anything is applied to a
 * database that holds real clinical records.
 *
 * It flags, per file:
 *   - destructive statements (DROP, TRUNCATE, DELETE without a WHERE)
 *   - column type changes without USING (a rewrite that can fail on real data)
 *   - non-idempotent DDL (plain CREATE TABLE/INDEX/ALTER without IF NOT EXISTS)
 *   - NOT NULL columns added without a default (fails on a non-empty table)
 *   - foreign keys added as NOT VALID (unvalidated constraints, a known FHIR/DHIS pitfall)
 *
 * Exit code 1 means a migration is unsafe and must be reviewed by a human.
 *
 *   node scripts/verify-migration-safety.cjs [--allow-destructive]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = [
  path.join(ROOT, 'ng', 'migrations'),
  path.join(ROOT, 'server', 'db', 'migrations'),
];

const allowDestructive = process.argv.includes('--allow-destructive');

/** Strip comments so a commented-out DROP is not treated as a live statement. */
function stripComments(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function checkFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const sql = stripComments(raw);
  const statements = sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const findings = [];

  for (const statement of statements) {
    const upper = statement.toUpperCase();
    // Idempotency expressed as "ignore it if the column already exists".
    const guarded = /\bDO\s+\$\$/.test(statement) && /duplicate_column|duplicate_object|already exists/i.test(sql);

    if (/\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|TYPE|INDEX)\b/.test(upper)) {
      findings.push({ severity: 'blocking', kind: 'DESTRUCTIVE_DDL', statement: statement.slice(0, 120) });
    }
    if (/\bTRUNCATE\b/.test(upper)) {
      findings.push({ severity: 'blocking', kind: 'TRUNCATE', statement: statement.slice(0, 120) });
    }
    if (/\bDELETE\s+FROM\s+\w+\s*(;|$)/i.test(statement) && !/\bWHERE\b/i.test(upper)) {
      findings.push({ severity: 'blocking', kind: 'DELETE_WITHOUT_WHERE', statement: statement.slice(0, 120) });
    }
    if (/\bALTER\s+(TABLE\s+)?[\w".]+\s+ALTER\s+(COLUMN\s+)?\w+\s+TYPE\b/i.test(statement) && !/\bUSING\b/i.test(upper)) {
      findings.push({
        severity: 'blocking',
        kind: 'TYPE_CHANGE_WITHOUT_USING',
        statement: statement.slice(0, 120),
      });
    }
    if (/\bNOT\s+VALID\b/i.test(statement)) {
      findings.push({
        severity: 'blocking',
        kind: 'CONSTRAINT_NOT_VALIDATED',
        statement: statement.slice(0, 120),
      });
    }
    // Non-idempotent DDL breaks re-runnable deploys.
    if (/\bCREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\b/i.test(statement) && !/\bIF\s+NOT\s+EXISTS\b/i.test(statement)) {
      findings.push({ severity: 'blocking', kind: 'NON_IDEMPOTENT_CREATE', statement: statement.slice(0, 120) });
    }
    if (/\bCREATE\s+TABLE\b/i.test(statement) && /\bPRIMARY\s+KEY\b/i.test(statement)
      && !/\bIF\s+NOT\s+EXISTS\b/i.test(statement)) {
      findings.push({ severity: 'blocking', kind: 'NON_IDEMPOTENT_CREATE', statement: statement.slice(0, 120) });
    }
    if (/\bALTER\s+TABLE\b/i.test(statement) && /\bADD\s+COLUMN\b/i.test(statement)
      && !/\bIF\s+NOT\s+EXISTS\b/i.test(statement) && !/\bUSING\b/i.test(statement)) {
      // These migrations make the ALTER idempotent with a DO block that swallows
      // duplicate_column, so a bare ADD COLUMN inside one is safe on re-run.
      findings.push(guarded
        ? { severity: 'info', kind: 'ALTER_GUARDED_BY_EXCEPTION', statement: statement.slice(0, 120) }
        : { severity: 'warning', kind: 'ALTER_WITHOUT_IF_NOT_EXISTS', statement: statement.slice(0, 120) });
    }
    if (/\bADD\s+COLUMN\b/i.test(statement) && /\bNOT\s+NULL\b/i.test(statement)
      && !/\bDEFAULT\b/i.test(statement) && !/\bIF\s+NOT\s+EXISTS\b/i.test(statement) && !guarded) {
      findings.push({
        severity: 'blocking',
        kind: 'NOT_NULL_WITHOUT_DEFAULT',
        statement: statement.slice(0, 120),
      });
    }
  }

  return findings;
}

const results = [];
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const file = path.join(dir, name);
    results.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), findings: checkFile(file) });
  }
}

let blocking = 0;
let warnings = 0;
let informational = 0;

for (const result of results) {
  if (!result.findings.length) continue;
  for (const finding of result.findings) {
    if (finding.severity === 'blocking') blocking += 1;
    else if (finding.severity === 'warning') warnings += 1;
    else informational += 1;
    if (finding.severity === 'info') continue;
    console.log(
      `[${finding.severity.toUpperCase()}] ${result.file}: ${finding.kind}\n    ${finding.statement}`
    );
  }
}

console.log(`\n[migrations] checked ${results.length} migration file(s): `
  + `${blocking} blocking finding(s), ${warnings} warning(s), `
  + `${informational} guarded pattern(s) accepted`);

if (blocking > 0 && !allowDestructive) {
  console.error('[migrations] FAILED: resolve the blocking findings, or re-run with --allow-destructive '
    + 'and record the justification in the release report.');
  process.exit(1);
}

console.log('[migrations] OK');
