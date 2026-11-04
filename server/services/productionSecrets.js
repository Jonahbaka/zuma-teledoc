'use strict';

/**
 * server/services/productionSecrets.js
 *
 * Loads production secrets from the server vault (or fallback .env files)
 * and merges them into process.env.
 *
 * Search order (first found wins):
 *   1. /home/ec2-user/PromptPay/config/secure/secrets-vault.json
 *   2. config/secure/secrets-vault.json   (relative to CWD)
 *   3. .env.local
 *   4. .env
 *
 * Never logs secret values. Only logs which vault path was used and
 * which keys were loaded.
 */

const fs = require('fs');
const path = require('path');

const VAULT_PATHS = [
  '/home/ec2-user/PromptPay/config/secure/secrets-vault.json',
  path.resolve(process.cwd(), 'config', 'secure', 'secrets-vault.json'),
];

const DOTENV_PATHS = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
];

/**
 * Parse a .env file into key-value pairs (no eval, no shell expansion).
 */
function parseDotenv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const result = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

/**
 * bootstrapProductionSecrets({ requiredKeys })
 *
 * Loads secrets into process.env. Returns:
 *   { vaultPath, loadedKeys, source }
 *
 * Throws if any key in requiredKeys is still missing after load.
 */
function bootstrapProductionSecrets({ requiredKeys = [] } = {}) {
  let vaultPath = null;
  let source = 'none';
  let loaded = {};

  // 1. Try JSON vault files
  for (const vp of VAULT_PATHS) {
    try {
      const raw = fs.readFileSync(vp, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        loaded = parsed;
        vaultPath = vp;
        source = 'vault_json';
        break;
      }
    } catch {
      // not found or parse error — try next
    }
  }

  // 2. Fall back to .env files
  if (!vaultPath) {
    for (const ep of DOTENV_PATHS) {
      try {
        loaded = parseDotenv(ep);
        vaultPath = ep;
        source = 'dotenv';
        break;
      } catch {
        // not found — try next
      }
    }
  }

  // Merge into process.env (only set keys not already present)
  const loadedKeys = [];
  for (const [k, v] of Object.entries(loaded)) {
    if (typeof v === 'string') {
      if (!process.env[k]) {
        process.env[k] = v;
      }
      loadedKeys.push(k);
    }
  }

  // Check required keys
  const missing = requiredKeys.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `bootstrapProductionSecrets: required key(s) not found after loading from ${vaultPath || 'any source'}: ${missing.join(', ')}`
    );
  }

  return { vaultPath, loadedKeys, source };
}

module.exports = { bootstrapProductionSecrets };
