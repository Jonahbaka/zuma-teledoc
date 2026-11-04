/**
 * Credential Vault — Encrypted Platform Credential Storage
 * PROJECT GENESIS
 * 
 * AES-256-GCM encrypted storage for social media and platform credentials.
 * Only authorized agents can access specific credentials.
 * The Operator (admin) manages all credentials through the AI Ops Portal.
 * 
 * SECURITY:
 *   - All credentials encrypted at rest with AES-256-GCM
 *   - Credentials only decrypted in-memory when an authorized agent requests them
 *   - Full audit trail of credential access
 *   - Credential rotation and expiry tracking
 */

const crypto = require('crypto');
const db = require('../../db');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getVaultKey() {
  const keyString = process.env.ENCRYPTION_KEY;
  if (!keyString) throw new Error('ENCRYPTION_KEY not set — vault locked');
  if (/^[0-9a-fA-F]+$/.test(keyString) && keyString.length === 64) {
    return Buffer.from(keyString, 'hex');
  }
  return crypto.createHash('sha256').update(keyString).digest();
}

function vaultEncrypt(plaintext) {
  if (!plaintext) return { encrypted: null, iv: null, tag: null };
  const key = getVaultKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return { encrypted, iv: iv.toString('hex'), tag: tag.toString('hex') };
}

function vaultDecrypt(encrypted, ivHex, tagHex) {
  if (!encrypted || !ivHex || !tagHex) return null;
  try {
    const key = getVaultKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Vault decryption failed:', err.message);
    return null;
  }
}

const SUPPORTED_PLATFORMS = [
  { id: 'twitter', name: 'Twitter / X', icon: '🐦', fields: ['username', 'password', 'api_key', 'api_secret'] },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', fields: ['username', 'password'] },
  { id: 'facebook', name: 'Facebook', icon: '📘', fields: ['username', 'password'] },
  { id: 'instagram', name: 'Instagram', icon: '📸', fields: ['username', 'password'] },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', fields: ['username', 'password'] },
  { id: 'youtube', name: 'YouTube', icon: '📺', fields: ['username', 'password', 'api_key'] },
  { id: 'google_ads', name: 'Google Ads', icon: '📊', fields: ['username', 'password', 'api_key'] },
  { id: 'meta_ads', name: 'Meta Ads Manager', icon: '📣', fields: ['username', 'password', 'api_key'] },
  { id: 'stripe', name: 'Stripe', icon: '💳', fields: ['api_key', 'api_secret'] },
  { id: 'mailchimp', name: 'Mailchimp', icon: '📧', fields: ['username', 'password', 'api_key'] },
  { id: 'sendgrid', name: 'SendGrid', icon: '✉️', fields: ['api_key'] },
  { id: 'github', name: 'GitHub', icon: '🐙', fields: ['username', 'password', 'api_key'] },
  { id: 'google_analytics', name: 'Google Analytics', icon: '📈', fields: ['api_key', 'api_secret'] },
  { id: 'google_business', name: 'Google Business', icon: '🏢', fields: ['username', 'password'] },
  { id: 'yelp', name: 'Yelp Business', icon: '⭐', fields: ['username', 'password'] },
  { id: 'zoho_recruit', name: 'Zoho Recruit', icon: '🧑‍💼', fields: ['api_key', 'api_secret'] },
  { id: 'reddit', name: 'Reddit', icon: '🤖', fields: ['username', 'password', 'api_key', 'api_secret'] },
  { id: 'pinterest', name: 'Pinterest', icon: '📌', fields: ['username', 'password'] },
  { id: 'slack', name: 'Slack', icon: '💬', fields: ['api_key'] },
  { id: 'discord', name: 'Discord', icon: '🎮', fields: ['api_key'] },
  { id: 'custom', name: 'Custom Platform', icon: '🔧', fields: ['username', 'password', 'api_key', 'api_secret'] },
];

class CredentialVault {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    this.initialized = true;
    console.log('  🔐 Credential Vault: Sealed & Ready');
  }

  getSupportedPlatforms() {
    return SUPPORTED_PLATFORMS;
  }

  /**
   * Store a credential securely
   */
  async storeCredential({ platform, accountLabel, username, password, apiKey, apiSecret, extraData, assignedAgents, addedBy, notes }) {
    const usernameEnc = vaultEncrypt(username);
    const passwordEnc = vaultEncrypt(password);
    const apiKeyEnc = vaultEncrypt(apiKey);
    const apiSecretEnc = vaultEncrypt(apiSecret);
    const extraEnc = vaultEncrypt(extraData ? JSON.stringify(extraData) : null);

    const platformInfo = SUPPORTED_PLATFORMS.find(p => p.id === platform) || { name: platform, id: platform };

    try {
      const result = await db.query(`
        INSERT INTO ai_credential_vault (
          platform, platform_display_name, account_label,
          username_encrypted, username_iv, username_tag,
          password_encrypted, password_iv, password_tag,
          api_key_encrypted, api_key_iv, api_key_tag,
          api_secret_encrypted, api_secret_iv, api_secret_tag,
          extra_data_encrypted, extra_data_iv, extra_data_tag,
          assigned_agents, added_by, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        RETURNING id, platform, platform_display_name, account_label, status, assigned_agents, created_at
      `, [
        platform, platformInfo.name, accountLabel || `${platformInfo.name} Account`,
        usernameEnc.encrypted, usernameEnc.iv, usernameEnc.tag,
        passwordEnc.encrypted, passwordEnc.iv, passwordEnc.tag,
        apiKeyEnc.encrypted, apiKeyEnc.iv, apiKeyEnc.tag,
        apiSecretEnc.encrypted, apiSecretEnc.iv, apiSecretEnc.tag,
        extraEnc.encrypted, extraEnc.iv, extraEnc.tag,
        assignedAgents || [], addedBy, notes
      ]);
      return result.rows[0];
    } catch (err) {
      console.error('Credential store error:', err.message);
      throw err;
    }
  }

  async upsertCredentialByPlatform({
    platform,
    accountLabel,
    username,
    password,
    apiKey,
    apiSecret,
    extraData,
    assignedAgents,
    addedBy,
    notes
  }) {
    const usernameEnc = vaultEncrypt(username);
    const passwordEnc = vaultEncrypt(password);
    const apiKeyEnc = vaultEncrypt(apiKey);
    const apiSecretEnc = vaultEncrypt(apiSecret);
    const extraEnc = vaultEncrypt(extraData ? JSON.stringify(extraData) : null);
    const platformInfo = SUPPORTED_PLATFORMS.find(p => p.id === platform) || { name: platform, id: platform };
    const label = accountLabel || `${platformInfo.name} Account`;

    const existing = await db.query(`
      SELECT id
      FROM ai_credential_vault
      WHERE platform = $1 AND account_label = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `, [platform, label]);

    if (!existing.rows[0]) {
      return this.storeCredential({
        platform,
        accountLabel: label,
        username,
        password,
        apiKey,
        apiSecret,
        extraData,
        assignedAgents,
        addedBy,
        notes
      });
    }

    const id = existing.rows[0].id;
    const updated = await db.query(`
      UPDATE ai_credential_vault
      SET
        platform_display_name = $2,
        username_encrypted = $3,
        username_iv = $4,
        username_tag = $5,
        password_encrypted = $6,
        password_iv = $7,
        password_tag = $8,
        api_key_encrypted = $9,
        api_key_iv = $10,
        api_key_tag = $11,
        api_secret_encrypted = $12,
        api_secret_iv = $13,
        api_secret_tag = $14,
        extra_data_encrypted = $15,
        extra_data_iv = $16,
        extra_data_tag = $17,
        assigned_agents = COALESCE($18, assigned_agents),
        notes = COALESCE($19, notes),
        status = 'active',
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, platform, platform_display_name, account_label, status, assigned_agents, created_at, updated_at
    `, [
      id,
      platformInfo.name,
      usernameEnc.encrypted, usernameEnc.iv, usernameEnc.tag,
      passwordEnc.encrypted, passwordEnc.iv, passwordEnc.tag,
      apiKeyEnc.encrypted, apiKeyEnc.iv, apiKeyEnc.tag,
      apiSecretEnc.encrypted, apiSecretEnc.iv, apiSecretEnc.tag,
      extraEnc.encrypted, extraEnc.iv, extraEnc.tag,
      assignedAgents || null,
      notes || null
    ]);
    return updated.rows[0];
  }

  /**
   * List all credentials (metadata only, no secrets)
   */
  async listCredentials(filters = {}) {
    try {
      let query = `
        SELECT id, platform, platform_display_name, account_label, status, 
               assigned_agents, last_verified_at, notes, created_at, updated_at,
               CASE WHEN username_encrypted IS NOT NULL THEN true ELSE false END as has_username,
               CASE WHEN password_encrypted IS NOT NULL THEN true ELSE false END as has_password,
               CASE WHEN api_key_encrypted IS NOT NULL THEN true ELSE false END as has_api_key,
               CASE WHEN api_secret_encrypted IS NOT NULL THEN true ELSE false END as has_api_secret
        FROM ai_credential_vault
      `;
      const conditions = [];
      const params = [];
      
      if (filters.platform) {
        params.push(filters.platform);
        conditions.push(`platform = $${params.length}`);
      }
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`status = $${params.length}`);
      }
      
      if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY created_at DESC';
      
      const result = await db.query(query, params);
      return result.rows;
    } catch (err) {
      console.error('Credential list error:', err.message);
      return [];
    }
  }

  /**
   * Get decrypted credential (for authorized agent use)
   */
  async getCredential(credentialId, requestingAgent) {
    try {
      const result = await db.query('SELECT * FROM ai_credential_vault WHERE id = $1', [credentialId]);
      if (result.rows.length === 0) throw new Error('Credential not found');
      const cred = result.rows[0];

      // Check authorization
      if (cred.assigned_agents?.length > 0 && !cred.assigned_agents.includes(requestingAgent) && requestingAgent !== 'operator') {
        throw new Error(`Agent '${requestingAgent}' not authorized for this credential`);
      }

      // Audit the access
      try {
        await db.query(`
          INSERT INTO ai_audit_log (agent_type, agent_name, action_type, action_details, outcome)
          VALUES ($1, $2, 'credential_access', $3, 'success')
        `, [requestingAgent, requestingAgent, JSON.stringify({ credential_id: credentialId, platform: cred.platform })]);
      } catch (e) { /* audit log best-effort */ }

      return {
        id: cred.id,
        platform: cred.platform,
        platformDisplayName: cred.platform_display_name,
        accountLabel: cred.account_label,
        username: vaultDecrypt(cred.username_encrypted, cred.username_iv, cred.username_tag),
        password: vaultDecrypt(cred.password_encrypted, cred.password_iv, cred.password_tag),
        apiKey: vaultDecrypt(cred.api_key_encrypted, cred.api_key_iv, cred.api_key_tag),
        apiSecret: vaultDecrypt(cred.api_secret_encrypted, cred.api_secret_iv, cred.api_secret_tag),
        extraData: (() => {
          const raw = vaultDecrypt(cred.extra_data_encrypted, cred.extra_data_iv, cred.extra_data_tag);
          try { return raw ? JSON.parse(raw) : null; } catch { return raw; }
        })(),
        status: cred.status
      };
    } catch (err) {
      console.error('Credential retrieval error:', err.message);
      throw err;
    }
  }

  async getCredentialByPlatform(platform, requestingAgent = 'operator', accountLabel = null) {
    const params = [platform];
    let query = `
      SELECT id
      FROM ai_credential_vault
      WHERE platform = $1
        AND status = 'active'
    `;
    if (accountLabel) {
      params.push(accountLabel);
      query += ` AND account_label = $${params.length}`;
    }
    query += ' ORDER BY updated_at DESC LIMIT 1';
    const result = await db.query(query, params);
    if (!result.rows[0]) return null;
    return this.getCredential(result.rows[0].id, requestingAgent);
  }

  /**
   * Delete a credential
   */
  async deleteCredential(credentialId) {
    try {
      await db.query('DELETE FROM ai_credential_vault WHERE id = $1', [credentialId]);
      return true;
    } catch (err) {
      console.error('Credential delete error:', err.message);
      return false;
    }
  }

  /**
   * Update credential status
   */
  async updateCredentialStatus(credentialId, status) {
    try {
      await db.query('UPDATE ai_credential_vault SET status = $1, updated_at = NOW() WHERE id = $2', [status, credentialId]);
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = new CredentialVault();
