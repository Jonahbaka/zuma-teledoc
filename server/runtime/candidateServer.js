'use strict';

// Dedicated read-only candidate process: no application routes, Next startup,
// telemetry, migrations, agent imports, upload directories or realtime handlers.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const EXECUTING_RELEASE_ROOT = path.resolve(__dirname, '../..');
const { verifyBundle } = require('../../scripts/release/manifest.cjs');
const { verifyMigrationHistory, createSchemaCheckPool } = require('../db/verifyMigrationHistory');

function startCandidateServer({ env = process.env, directory = EXECUTING_RELEASE_ROOT, port = Number(env.PORT) || 8080,
  verifyArtifact = verifyBundle, createPool = createSchemaCheckPool, verifyHistory = verifyMigrationHistory } = {}) {
  let pool;
  const state = { checkOnly: true, preflightComplete: false, artifactVerified: false, migrationHistoryVerified: false,
    applicationSchemaVerified: false, dataCompatibilityVerified: false, initialized: false, nextReady: false,
    servingReady: false, productionReady: false, failureCode: null };
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    let requestPath;
    try { requestPath = new URL(req.url, 'http://127.0.0.1').pathname; }
    catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid request.' })); return; }
    if (req.method !== 'GET' || !['/health', '/readyz', '/api/health', '/api/ng/health', '/api/release-check'].includes(requestPath)) {
      res.writeHead(503); res.end(JSON.stringify({ checkOnly: true, error: 'Deployment check only.' })); return;
    }
    if (requestPath === '/health') { res.writeHead(200); res.end(JSON.stringify({ status: 'listening', checkOnly: true, servingReady: false })); return; }
    // /readyz must not imply that a real API/Next serving process was initialized.
    const accepted = state.preflightComplete && requestPath !== '/readyz';
    res.writeHead(accepted ? 200 : 503);
    res.end(JSON.stringify({ status: state.preflightComplete ? 'checks_passed' : 'checks_unavailable', ...state }));
  });
  server.listen(port, '127.0.0.1');
  const verification = (async () => {
    let checksPassed = false;
    try {
      if (fs.realpathSync(directory) !== fs.realpathSync(EXECUTING_RELEASE_ROOT)) throw Object.assign(new Error('Mismatched release root'), { code: 'BUNDLE_EXECUTION_ROOT_MISMATCH' });
      const manifest = verifyArtifact(directory, env.DOCTARX_RELEASE_DIGEST, { matchRuntime: true });
      state.artifactVerified = true; state.releaseId = manifest.releaseId; state.buildId = manifest.buildId; state.sourceSha = manifest.source.sha;
      pool = createPool(env);
      const result = await verifyHistory(pool);
      if (result.migrationHistoryVerified !== true) throw Object.assign(new Error('Unverified history'), { code: 'MIGRATION_HISTORY_UNVERIFIED' });
      state.migrationHistoryVerified = true; state.manifestEvidence = { core: result.core, ng: result.ng };
      checksPassed = true;
    } catch (error) {
      state.failureCode = /^(?:MIGRATION_|SCHEMA_CHECK_|INVALID_|UNTRUSTED_|BUNDLE_|RUNTIME_)[A-Z_]*$/.test(error?.code || '') ? error.code : 'RELEASE_CHECK_FAILED';
    } finally {
      if (pool) { try { await pool.end(); } catch { state.failureCode = 'SCHEMA_CHECK_CLEANUP_FAILED'; } }
      state.preflightComplete = checksPassed && state.failureCode === null;
    }
  })();
  async function close() {
    await verification;
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
  return { server, verification, close, getState: () => ({ ...state }) };
}
module.exports = { startCandidateServer };
