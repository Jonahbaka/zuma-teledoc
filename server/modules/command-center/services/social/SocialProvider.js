/**
 * Social Media Provider - Abstract Base Class
 * Defines the interface for all social media provider implementations
 * @module command-center/services/social/SocialProvider
 */

const logger = require('../../../../middleware/logger');

/**
 * @typedef {import('../../types/index.js').SocialPlatform} SocialPlatform
 * @typedef {import('../../types/index.js').SocialPost} SocialPost
 * @typedef {import('../../types/index.js').PostType} PostType
 */

/**
 * Abstract base class for social media providers
 * All social media provider implementations must extend this class
 */
class SocialProvider {
  /**
   * @param {SocialPlatform} platform
   */
  constructor(platform) {
    if (new.target === SocialProvider) {
      throw new Error('SocialProvider is an abstract class and cannot be instantiated directly');
    }
    
    this.platform = platform;
    this.isInitialized = false;
  }

  /**
   * Get the OAuth2 authorization URL
   * @param {string} redirectUri - Callback URL
   * @param {string} state - State parameter for CSRF protection
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(redirectUri, state) {
    throw new Error('Method getAuthorizationUrl() must be implemented');
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} code - Authorization code
   * @param {string} redirectUri - Callback URL (must match auth request)
   * @returns {Promise<{accessToken: string, refreshToken?: string, expiresIn?: number, scopes?: string[]}>}
   */
  async exchangeCodeForTokens(code, redirectUri) {
    throw new Error('Method exchangeCodeForTokens() must be implemented');
  }

  /**
   * Refresh an expired access token
   * @param {string} refreshToken
   * @returns {Promise<{accessToken: string, refreshToken?: string, expiresIn?: number}>}
   */
  async refreshAccessToken(refreshToken) {
    throw new Error('Method refreshAccessToken() must be implemented');
  }

  /**
   * Revoke access token
   * @param {string} accessToken
   * @returns {Promise<boolean>}
   */
  async revokeToken(accessToken) {
    throw new Error('Method revokeToken() must be implemented');
  }

  /**
   * Get the authenticated user's profile
   * @param {string} accessToken
   * @returns {Promise<{id: string, username: string, name: string, profileUrl?: string, avatarUrl?: string}>}
   */
  async getProfile(accessToken) {
    throw new Error('Method getProfile() must be implemented');
  }

  /**
   * Publish a post to the platform
   * @param {string} accessToken
   * @param {Object} post
   * @param {string} post.content - Text content
   * @param {string[]} [post.mediaUrls] - Media URLs
   * @param {PostType} [post.postType]
   * @param {Object} [post.options] - Platform-specific options
   * @returns {Promise<{success: boolean, postId?: string, postUrl?: string, error?: string}>}
   */
  async publishPost(accessToken, post) {
    throw new Error('Method publishPost() must be implemented');
  }

  /**
   * Delete a published post
   * @param {string} accessToken
   * @param {string} postId - Platform's post ID
   * @returns {Promise<boolean>}
   */
  async deletePost(accessToken, postId) {
    throw new Error('Method deletePost() must be implemented');
  }

  /**
   * Get post analytics/engagement
   * @param {string} accessToken
   * @param {string} postId
   * @returns {Promise<{likes: number, comments: number, shares: number, impressions?: number, engagement?: number}>}
   */
  async getPostAnalytics(accessToken, postId) {
    throw new Error('Method getPostAnalytics() must be implemented');
  }

  /**
   * Upload media to the platform
   * @param {string} accessToken
   * @param {Buffer} media - Media file buffer
   * @param {string} contentType - MIME type
   * @param {string} [filename]
   * @returns {Promise<{mediaId: string, mediaUrl?: string}>}
   */
  async uploadMedia(accessToken, media, contentType, filename) {
    throw new Error('Method uploadMedia() must be implemented');
  }

  /**
   * Get platform-specific content limits
   * @returns {{maxLength: number, maxMedia: number, supportedMediaTypes: string[]}}
   */
  getContentLimits() {
    throw new Error('Method getContentLimits() must be implemented');
  }

  /**
   * Validate content before posting
   * @param {string} content
   * @param {string[]} [mediaUrls]
   * @returns {{valid: boolean, errors: string[]}}
   */
  validateContent(content, mediaUrls) {
    const limits = this.getContentLimits();
    const errors = [];

    if (content.length > limits.maxLength) {
      errors.push(`Content exceeds maximum length of ${limits.maxLength} characters`);
    }

    if (mediaUrls && mediaUrls.length > limits.maxMedia) {
      errors.push(`Too many media files. Maximum is ${limits.maxMedia}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Truncate content to fit platform limits
   * @param {string} content
   * @param {boolean} [addEllipsis=true]
   * @returns {string}
   */
  truncateContent(content, addEllipsis = true) {
    const limits = this.getContentLimits();
    
    if (content.length <= limits.maxLength) {
      return content;
    }

    const suffix = addEllipsis ? '...' : '';
    return content.substring(0, limits.maxLength - suffix.length) + suffix;
  }

  /**
   * Make an authenticated API request
   * @param {string} url
   * @param {string} accessToken
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async makeRequest(url, accessToken, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const data = await response.json();

    if (!response.ok) {
      const error = new Error(data.message || data.error || 'API request failed');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  /**
   * Log API interaction
   * @param {string} action
   * @param {Object} details
   */
  log(action, details) {
    logger.debug(`[${this.platform}] ${action}`, details);
  }
}

module.exports = SocialProvider;

