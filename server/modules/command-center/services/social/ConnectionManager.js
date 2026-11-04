/**
 * Social Connection Manager
 * Manages OAuth tokens and social media account connections
 * @module command-center/services/social/ConnectionManager
 */

const db = require('../../../../db');
const { encrypt, decrypt } = require('../../../../lib/encryption');
const logger = require('../../../../middleware/logger');

/**
 * @typedef {import('../../types/index.js').SocialConnection} SocialConnection
 * @typedef {import('../../types/index.js').SocialPlatform} SocialPlatform
 */

/**
 * Connection Manager - Handles OAuth token storage and management
 */
class ConnectionManager {
  /**
   * Store a new social media connection
   * @param {string} userId
   * @param {SocialPlatform} platform
   * @param {Object} tokenData
   * @param {string} tokenData.accessToken
   * @param {string} [tokenData.refreshToken]
   * @param {number} [tokenData.expiresIn] - Seconds until expiry
   * @param {string[]} [tokenData.scopes]
   * @param {Object} profileData
   * @param {string} profileData.id - Platform user ID
   * @param {string} [profileData.username]
   * @param {Object} [profileData.data] - Additional profile data
   * @returns {Promise<SocialConnection>}
   */
  async createConnection(userId, platform, tokenData, profileData) {
    // Encrypt tokens
    const accessEncrypted = encrypt(tokenData.accessToken);
    let refreshEncrypted = { encrypted: null, iv: null, tag: null };
    
    if (tokenData.refreshToken) {
      refreshEncrypted = encrypt(tokenData.refreshToken);
    }

    // Calculate token expiry
    const tokenExpiresAt = tokenData.expiresIn 
      ? new Date(Date.now() + tokenData.expiresIn * 1000)
      : null;

    const { rows } = await db.query(
      `INSERT INTO social_connections (
        user_id, platform, platform_user_id, platform_username,
        access_token_encrypted, access_token_iv, access_token_tag,
        refresh_token_encrypted, refresh_token_iv, refresh_token_tag,
        token_expires_at, scopes, status, profile_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (user_id, platform, platform_user_id) 
      DO UPDATE SET
        access_token_encrypted = $5,
        access_token_iv = $6,
        access_token_tag = $7,
        refresh_token_encrypted = $8,
        refresh_token_iv = $9,
        refresh_token_tag = $10,
        token_expires_at = $11,
        scopes = $12,
        status = 'active',
        profile_data = $14,
        last_error = NULL,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        platform,
        profileData.id,
        profileData.username,
        accessEncrypted.encrypted,
        accessEncrypted.iv,
        accessEncrypted.tag,
        refreshEncrypted.encrypted,
        refreshEncrypted.iv,
        refreshEncrypted.tag,
        tokenExpiresAt,
        tokenData.scopes || [],
        'active',
        JSON.stringify(profileData.data || {})
      ]
    );

    logger.info('Social connection created/updated', {
      userId,
      platform,
      platformUserId: profileData.id
    });

    return this.formatConnection(rows[0]);
  }

  /**
   * Get a connection by ID
   * @param {string} connectionId
   * @param {boolean} [includeTokens=false]
   * @returns {Promise<SocialConnection|null>}
   */
  async getConnection(connectionId, includeTokens = false) {
    const { rows } = await db.query(
      `SELECT * FROM social_connections WHERE id = $1`,
      [connectionId]
    );

    if (rows.length === 0) {
      return null;
    }

    return this.formatConnection(rows[0], includeTokens);
  }

  /**
   * Get all connections for a user
   * @param {string} userId
   * @param {SocialPlatform} [platform]
   * @returns {Promise<SocialConnection[]>}
   */
  async getUserConnections(userId, platform) {
    let query = `SELECT * FROM social_connections WHERE user_id = $1`;
    const params = [userId];

    if (platform) {
      query += ` AND platform = $2`;
      params.push(platform);
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await db.query(query, params);
    return rows.map(row => this.formatConnection(row, false));
  }

  /**
   * Get decrypted access token for a connection
   * @param {string} connectionId
   * @returns {Promise<{accessToken: string, refreshToken?: string, expiresAt?: Date}|null>}
   */
  async getTokens(connectionId) {
    const { rows } = await db.query(
      `SELECT 
        access_token_encrypted, access_token_iv, access_token_tag,
        refresh_token_encrypted, refresh_token_iv, refresh_token_tag,
        token_expires_at, status
       FROM social_connections 
       WHERE id = $1`,
      [connectionId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];

    if (row.status !== 'active') {
      throw new Error(`Connection is ${row.status}`);
    }

    const accessToken = decrypt(
      row.access_token_encrypted,
      row.access_token_iv,
      row.access_token_tag
    );

    let refreshToken = null;
    if (row.refresh_token_encrypted) {
      refreshToken = decrypt(
        row.refresh_token_encrypted,
        row.refresh_token_iv,
        row.refresh_token_tag
      );
    }

    return {
      accessToken,
      refreshToken,
      expiresAt: row.token_expires_at
    };
  }

  /**
   * Update tokens after refresh
   * @param {string} connectionId
   * @param {Object} tokenData
   * @param {string} tokenData.accessToken
   * @param {string} [tokenData.refreshToken]
   * @param {number} [tokenData.expiresIn]
   * @returns {Promise<void>}
   */
  async updateTokens(connectionId, tokenData) {
    const accessEncrypted = encrypt(tokenData.accessToken);
    
    const tokenExpiresAt = tokenData.expiresIn
      ? new Date(Date.now() + tokenData.expiresIn * 1000)
      : null;

    let query = `
      UPDATE social_connections SET
        access_token_encrypted = $1,
        access_token_iv = $2,
        access_token_tag = $3,
        token_expires_at = $4,
        status = 'active',
        last_error = NULL,
        updated_at = NOW()
    `;
    
    const params = [
      accessEncrypted.encrypted,
      accessEncrypted.iv,
      accessEncrypted.tag,
      tokenExpiresAt
    ];

    if (tokenData.refreshToken) {
      const refreshEncrypted = encrypt(tokenData.refreshToken);
      query += `,
        refresh_token_encrypted = $5,
        refresh_token_iv = $6,
        refresh_token_tag = $7
      WHERE id = $8`;
      params.push(
        refreshEncrypted.encrypted,
        refreshEncrypted.iv,
        refreshEncrypted.tag,
        connectionId
      );
    } else {
      query += ` WHERE id = $5`;
      params.push(connectionId);
    }

    await db.query(query, params);

    logger.debug('Tokens updated for connection', { connectionId });
  }

  /**
   * Mark connection as having an error
   * @param {string} connectionId
   * @param {string} error
   * @param {'expired' | 'revoked' | 'error'} [status='error']
   * @returns {Promise<void>}
   */
  async setConnectionError(connectionId, error, status = 'error') {
    await db.query(
      `UPDATE social_connections SET
        status = $1,
        last_error = $2,
        updated_at = NOW()
       WHERE id = $3`,
      [status, error, connectionId]
    );

    logger.warn('Social connection error', { connectionId, status, error });
  }

  /**
   * Delete a connection
   * @param {string} connectionId
   * @param {string} userId - For authorization check
   * @returns {Promise<boolean>}
   */
  async deleteConnection(connectionId, userId) {
    const { rowCount } = await db.query(
      `DELETE FROM social_connections 
       WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );

    if (rowCount > 0) {
      logger.info('Social connection deleted', { connectionId, userId });
      return true;
    }

    return false;
  }

  /**
   * Update last sync timestamp
   * @param {string} connectionId
   * @returns {Promise<void>}
   */
  async updateLastSync(connectionId) {
    await db.query(
      `UPDATE social_connections SET
        last_sync_at = NOW(),
        updated_at = NOW()
       WHERE id = $1`,
      [connectionId]
    );
  }

  /**
   * Check if token needs refresh
   * @param {string} connectionId
   * @returns {Promise<boolean>}
   */
  async needsRefresh(connectionId) {
    const { rows } = await db.query(
      `SELECT token_expires_at, refresh_token_encrypted 
       FROM social_connections 
       WHERE id = $1`,
      [connectionId]
    );

    if (rows.length === 0) {
      return false;
    }

    const { token_expires_at, refresh_token_encrypted } = rows[0];

    // No expiry or no refresh token
    if (!token_expires_at || !refresh_token_encrypted) {
      return false;
    }

    // Refresh if expiring within 5 minutes
    const expiryBuffer = 5 * 60 * 1000;
    return new Date(token_expires_at).getTime() - Date.now() < expiryBuffer;
  }

  /**
   * Get connections that need token refresh
   * @returns {Promise<Array<{id: string, platform: SocialPlatform}>>}
   */
  async getConnectionsNeedingRefresh() {
    const expiryBuffer = '5 minutes';
    
    const { rows } = await db.query(
      `SELECT id, platform 
       FROM social_connections 
       WHERE status = 'active'
         AND refresh_token_encrypted IS NOT NULL
         AND token_expires_at IS NOT NULL
         AND token_expires_at < NOW() + INTERVAL '${expiryBuffer}'`
    );

    return rows;
  }

  /**
   * Format database row to connection object
   * @param {Object} row
   * @param {boolean} [includeTokens=false]
   * @returns {SocialConnection}
   */
  formatConnection(row, includeTokens = false) {
    const connection = {
      id: row.id,
      userId: row.user_id,
      platform: row.platform,
      platformUserId: row.platform_user_id,
      platformUsername: row.platform_username,
      tokenExpiresAt: row.token_expires_at,
      scopes: row.scopes,
      status: row.status,
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
      profileData: row.profile_data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };

    if (includeTokens && row.access_token_encrypted) {
      connection.accessToken = decrypt(
        row.access_token_encrypted,
        row.access_token_iv,
        row.access_token_tag
      );
      
      if (row.refresh_token_encrypted) {
        connection.refreshToken = decrypt(
          row.refresh_token_encrypted,
          row.refresh_token_iv,
          row.refresh_token_tag
        );
      }
    }

    return connection;
  }
}

module.exports = new ConnectionManager();

