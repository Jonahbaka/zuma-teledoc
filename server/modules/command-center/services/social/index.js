/**
 * Social Media Service
 * Factory and orchestrator for social media providers
 * @module command-center/services/social
 */

const SocialProvider = require('./SocialProvider');
const ConnectionManager = require('./ConnectionManager');
const logger = require('../../../../middleware/logger');

/**
 * @typedef {import('../../types/index.js').SocialPlatform} SocialPlatform
 * @typedef {import('../../types/index.js').SocialPost} SocialPost
 */

/**
 * Platform-specific provider configurations
 */
const PLATFORM_CONFIGS = {
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    apiBase: 'https://api.linkedin.com/v2',
    scopes: ['r_liteprofile', 'w_member_social'],
    limits: { maxLength: 3000, maxMedia: 9, supportedMediaTypes: ['image/jpeg', 'image/png', 'image/gif'] }
  },
  twitter: {
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    apiBase: 'https://api.twitter.com/2',
    scopes: ['tweet.read', 'tweet.write', 'users.read'],
    limits: { maxLength: 280, maxMedia: 4, supportedMediaTypes: ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'] }
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    apiBase: 'https://graph.facebook.com/v18.0',
    scopes: ['pages_manage_posts', 'pages_read_engagement'],
    limits: { maxLength: 63206, maxMedia: 10, supportedMediaTypes: ['image/jpeg', 'image/png', 'image/gif', 'video/mp4'] }
  },
  instagram: {
    authUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    apiBase: 'https://graph.instagram.com',
    scopes: ['instagram_basic', 'instagram_content_publish'],
    limits: { maxLength: 2200, maxMedia: 10, supportedMediaTypes: ['image/jpeg', 'image/png', 'video/mp4'] }
  }
};

/**
 * Social Media Service
 */
class SocialMediaService {
  constructor() {
    this.connectionManager = ConnectionManager;
    this.initialized = false;
  }

  /**
   * Initialize the social media service
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;
    
    logger.info('Social media service initialized');
    this.initialized = true;
  }

  /**
   * Get OAuth authorization URL for a platform
   * @param {SocialPlatform} platform
   * @param {string} redirectUri
   * @param {string} state
   * @returns {string}
   */
  getAuthorizationUrl(platform, redirectUri, state) {
    const config = PLATFORM_CONFIGS[platform];
    if (!config) {
      throw new Error(`Unknown platform: ${platform}`);
    }

    const clientId = this.getClientId(platform);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state
    });

    // Platform-specific additions
    if (platform === 'twitter') {
      params.set('code_challenge', this.generateCodeChallenge());
      params.set('code_challenge_method', 'plain'); // or S256
    }

    return `${config.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   * @param {SocialPlatform} platform
   * @param {string} code
   * @param {string} redirectUri
   * @returns {Promise<Object>}
   */
  async exchangeCodeForTokens(platform, code, redirectUri) {
    const config = PLATFORM_CONFIGS[platform];
    const clientId = this.getClientId(platform);
    const clientSecret = this.getClientSecret(platform);

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error_description || data.error || 'Token exchange failed');
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scopes: data.scope?.split(' ') || config.scopes
    };
  }

  /**
   * Connect a social account for a user
   * @param {string} userId
   * @param {SocialPlatform} platform
   * @param {string} code
   * @param {string} redirectUri
   * @returns {Promise<Object>}
   */
  async connectAccount(userId, platform, code, redirectUri) {
    // Exchange code for tokens
    const tokenData = await this.exchangeCodeForTokens(platform, code, redirectUri);

    // Get user profile
    const profile = await this.getProfile(platform, tokenData.accessToken);

    // Store connection
    const connection = await this.connectionManager.createConnection(
      userId,
      platform,
      tokenData,
      profile
    );

    return connection;
  }

  /**
   * Disconnect a social account
   * @param {string} connectionId
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async disconnectAccount(connectionId, userId) {
    // Try to revoke token first
    try {
      const tokens = await this.connectionManager.getTokens(connectionId);
      if (tokens?.accessToken) {
        const connection = await this.connectionManager.getConnection(connectionId);
        await this.revokeToken(connection.platform, tokens.accessToken);
      }
    } catch (error) {
      logger.warn('Failed to revoke token during disconnect', { error: error.message });
    }

    return this.connectionManager.deleteConnection(connectionId, userId);
  }

  /**
   * Get user profile from platform
   * @param {SocialPlatform} platform
   * @param {string} accessToken
   * @returns {Promise<Object>}
   */
  async getProfile(platform, accessToken) {
    const config = PLATFORM_CONFIGS[platform];

    let endpoint, headers = { 'Authorization': `Bearer ${accessToken}` };
    let profileMapper;

    switch (platform) {
      case 'linkedin':
        endpoint = `${config.apiBase}/me`;
        profileMapper = (data) => ({
          id: data.id,
          username: data.vanityName || data.id,
          name: `${data.localizedFirstName} ${data.localizedLastName}`,
          data
        });
        break;

      case 'twitter':
        endpoint = `${config.apiBase}/users/me`;
        profileMapper = (data) => ({
          id: data.data.id,
          username: data.data.username,
          name: data.data.name,
          data: data.data
        });
        break;

      case 'facebook':
        endpoint = `${config.apiBase}/me?fields=id,name`;
        profileMapper = (data) => ({
          id: data.id,
          username: data.name,
          name: data.name,
          data
        });
        break;

      case 'instagram':
        endpoint = `${config.apiBase}/me?fields=id,username`;
        profileMapper = (data) => ({
          id: data.id,
          username: data.username,
          name: data.username,
          data
        });
        break;

      default:
        throw new Error(`Unknown platform: ${platform}`);
    }

    const response = await fetch(endpoint, { headers });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to fetch profile');
    }

    return profileMapper(data);
  }

  /**
   * Publish a post to a social platform
   * @param {string} connectionId
   * @param {Object} post
   * @param {string} post.content
   * @param {string[]} [post.mediaUrls]
   * @param {Object} [post.options]
   * @returns {Promise<{success: boolean, postId?: string, postUrl?: string, error?: string}>}
   */
  async publishPost(connectionId, post) {
    const connection = await this.connectionManager.getConnection(connectionId);
    if (!connection) {
      throw new Error('Connection not found');
    }

    // Check if token needs refresh
    if (await this.connectionManager.needsRefresh(connectionId)) {
      await this.refreshToken(connectionId);
    }

    const tokens = await this.connectionManager.getTokens(connectionId);
    const config = PLATFORM_CONFIGS[connection.platform];

    try {
      let result;

      switch (connection.platform) {
        case 'linkedin':
          result = await this.publishLinkedInPost(tokens.accessToken, connection, post);
          break;
        case 'twitter':
          result = await this.publishTwitterPost(tokens.accessToken, post);
          break;
        case 'facebook':
          result = await this.publishFacebookPost(tokens.accessToken, connection, post);
          break;
        case 'instagram':
          result = await this.publishInstagramPost(tokens.accessToken, connection, post);
          break;
        default:
          throw new Error(`Unsupported platform: ${connection.platform}`);
      }

      // Update last sync
      await this.connectionManager.updateLastSync(connectionId);

      return result;
    } catch (error) {
      // Check if error is auth-related
      if (error.status === 401 || error.status === 403) {
        await this.connectionManager.setConnectionError(connectionId, error.message, 'expired');
      }
      throw error;
    }
  }

  /**
   * Publish to LinkedIn
   */
  async publishLinkedInPost(accessToken, connection, post) {
    const config = PLATFORM_CONFIGS.linkedin;
    
    const body = {
      author: `urn:li:person:${connection.platformUserId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: post.content
          },
          shareMediaCategory: post.mediaUrls?.length ? 'IMAGE' : 'NONE'
        }
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    };

    const response = await fetch(`${config.apiBase}/ugcPosts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'LinkedIn post failed');
    }

    return {
      success: true,
      postId: data.id,
      postUrl: `https://www.linkedin.com/feed/update/${data.id}`
    };
  }

  /**
   * Publish to Twitter
   */
  async publishTwitterPost(accessToken, post) {
    const config = PLATFORM_CONFIGS.twitter;

    const response = await fetch(`${config.apiBase}/tweets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: post.content })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.title || 'Twitter post failed');
    }

    return {
      success: true,
      postId: data.data.id,
      postUrl: `https://twitter.com/i/status/${data.data.id}`
    };
  }

  /**
   * Publish to Facebook
   */
  async publishFacebookPost(accessToken, connection, post) {
    const config = PLATFORM_CONFIGS.facebook;
    
    // For pages, need page ID and page access token
    const pageId = post.options?.pageId || connection.platformUserId;

    const response = await fetch(`${config.apiBase}/${pageId}/feed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: post.content,
        access_token: accessToken
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || 'Facebook post failed');
    }

    return {
      success: true,
      postId: data.id,
      postUrl: `https://www.facebook.com/${data.id}`
    };
  }

  /**
   * Publish to Instagram (requires media)
   */
  async publishInstagramPost(accessToken, connection, post) {
    if (!post.mediaUrls?.length) {
      throw new Error('Instagram posts require media');
    }

    const config = PLATFORM_CONFIGS.instagram;
    const userId = connection.platformUserId;

    // Step 1: Create media container
    const containerResponse = await fetch(
      `${config.apiBase}/${userId}/media?image_url=${encodeURIComponent(post.mediaUrls[0])}&caption=${encodeURIComponent(post.content)}&access_token=${accessToken}`,
      { method: 'POST' }
    );

    const containerData = await containerResponse.json();

    if (!containerResponse.ok || containerData.error) {
      throw new Error(containerData.error?.message || 'Instagram container creation failed');
    }

    // Step 2: Publish the container
    const publishResponse = await fetch(
      `${config.apiBase}/${userId}/media_publish?creation_id=${containerData.id}&access_token=${accessToken}`,
      { method: 'POST' }
    );

    const publishData = await publishResponse.json();

    if (!publishResponse.ok || publishData.error) {
      throw new Error(publishData.error?.message || 'Instagram publish failed');
    }

    return {
      success: true,
      postId: publishData.id,
      postUrl: `https://www.instagram.com/p/${publishData.id}`
    };
  }

  /**
   * Refresh an expired token
   * @param {string} connectionId
   * @returns {Promise<void>}
   */
  async refreshToken(connectionId) {
    const connection = await this.connectionManager.getConnection(connectionId);
    const tokens = await this.connectionManager.getTokens(connectionId);

    if (!tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const config = PLATFORM_CONFIGS[connection.platform];
    const clientId = this.getClientId(connection.platform);
    const clientSecret = this.getClientSecret(connection.platform);

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token'
    });

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
      await this.connectionManager.setConnectionError(
        connectionId,
        data.error_description || 'Token refresh failed',
        'expired'
      );
      throw new Error(data.error_description || 'Token refresh failed');
    }

    await this.connectionManager.updateTokens(connectionId, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in
    });

    logger.info('Token refreshed', { connectionId });
  }

  /**
   * Revoke access token
   */
  async revokeToken(platform, accessToken) {
    // Platform-specific revocation
    // Most platforms don't have a revoke endpoint
    logger.debug('Token revoke requested', { platform });
  }

  /**
   * Get content limits for a platform
   * @param {SocialPlatform} platform
   * @returns {Object}
   */
  getContentLimits(platform) {
    return PLATFORM_CONFIGS[platform]?.limits || {
      maxLength: 500,
      maxMedia: 4,
      supportedMediaTypes: ['image/jpeg', 'image/png']
    };
  }

  /**
   * Get client ID for a platform
   */
  getClientId(platform) {
    const envKeys = {
      linkedin: 'LINKEDIN_CLIENT_ID',
      twitter: 'TWITTER_CLIENT_ID',
      facebook: 'FACEBOOK_APP_ID',
      instagram: 'INSTAGRAM_APP_ID'
    };
    return process.env[envKeys[platform]];
  }

  /**
   * Get client secret for a platform
   */
  getClientSecret(platform) {
    const envKeys = {
      linkedin: 'LINKEDIN_CLIENT_SECRET',
      twitter: 'TWITTER_CLIENT_SECRET',
      facebook: 'FACEBOOK_APP_SECRET',
      instagram: 'INSTAGRAM_APP_SECRET'
    };
    return process.env[envKeys[platform]];
  }

  /**
   * Generate code challenge for PKCE
   */
  generateCodeChallenge() {
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('base64url');
  }
}

module.exports = new SocialMediaService();

