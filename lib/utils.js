/**
 * Utility Functions
 */

const { clsx } = require('clsx');
const { twMerge } = require('tailwind-merge');

/**
 * Merge Tailwind CSS classes
 * @param  {...any} inputs - Class names to merge
 * @returns {string} Merged class string
 */
function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Format date for display
 * @param {Date|string} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
 */
function formatDate(date, options = {}) {
  if (!date) return 'N/A';
  
  const defaultOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };
  
  try {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    return new Intl.DateTimeFormat('en-US', { ...defaultOptions, ...options })
      .format(dateObj);
  } catch (e) {
    return 'Invalid Date';
  }
}

/**
 * Format date and time for display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date and time string
 */
function formatDateTime(date) {
  if (!date) return 'N/A';
  
  try {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    return formatDate(date, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return 'Invalid Date';
  }
}

/**
 * Format time for display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted time string
 */
function formatTime(date) {
  if (!date) return 'N/A';
  
  try {
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return 'Invalid Time';
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(dateObj);
  } catch (e) {
    return 'Invalid Time';
  }
}

/**
 * Format relative time (e.g., "2 hours ago")
 * @param {Date|string} date - Date to format
 * @returns {string} Relative time string
 */
function formatRelativeTime(date) {
  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  
  return formatDate(date, { month: 'short', day: 'numeric' });
}

/**
 * Format currency
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency
  }).format(amount / 100);
}

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Convert snake_case to camelCase
 * @param {string} str - Snake case string
 * @returns {string} Camel case string
 */
function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case
 * @param {string} str - Camel case string
 * @returns {string} Snake case string
 */
function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Convert object keys from snake_case to camelCase
 * @param {Object} obj - Object with snake_case keys
 * @returns {Object} Object with camelCase keys
 */
function keysToCamel(obj) {
  if (Array.isArray(obj)) {
    return obj.map(keysToCamel);
  }
  
  // Handle Date objects - return as-is (they'll be serialized by JSON.stringify)
  if (obj instanceof Date) {
    return obj;
  }
  
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = snakeToCamel(key);
      result[camelKey] = keysToCamel(obj[key]);
      return result;
    }, {});
  }
  
  return obj;
}

/**
 * Convert object keys from camelCase to snake_case
 * @param {Object} obj - Object with camelCase keys
 * @returns {Object} Object with snake_case keys
 */
function keysToSnake(obj) {
  if (Array.isArray(obj)) {
    return obj.map(keysToSnake);
  }
  
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((result, key) => {
      const snakeKey = camelToSnake(key);
      result[snakeKey] = keysToSnake(obj[key]);
      return result;
    }, {});
  }
  
  return obj;
}

/**
 * Generate initials from name
 * @param {string} firstName - First name
 * @param {string} lastName - Last name
 * @returns {string} Initials
 */
function getInitials(firstName, lastName) {
  const first = firstName ? firstName.charAt(0).toUpperCase() : '';
  const last = lastName ? lastName.charAt(0).toUpperCase() : '';
  return `${first}${last}`;
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Truncate string with ellipsis
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated string
 */
function truncate(str, maxLength = 100) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Generate a unique room ID for video calls
 * @returns {string} Room ID
 */
function generateRoomId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `zuma-${timestamp}-${random}`;
}

/**
 * Parse query string parameters
 * @param {Object} query - Query object
 * @param {Object} defaults - Default values
 * @returns {Object} Parsed query parameters
 */
function parseQueryParams(query, defaults = {}) {
  return {
    page: parseInt(query.page) || defaults.page || 1,
    limit: Math.min(parseInt(query.limit) || defaults.limit || 20, 100),
    sortBy: query.sortBy || defaults.sortBy || 'created_at',
    sortOrder: query.sortOrder === 'asc' ? 'ASC' : 'DESC'
  };
}

/**
 * Calculate pagination metadata
 * @param {number} total - Total items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} Pagination metadata
 */
function getPaginationMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  
  return {
    total,
    page,
    limit,
    totalPages,
    hasMore: page < totalPages,
    hasPrevious: page > 1
  };
}

/**
 * Mask sensitive data (e.g., email, phone)
 * @param {string} value - Value to mask
 * @param {string} type - Type of data (email, phone, ssn)
 * @returns {string} Masked value
 */
function maskSensitiveData(value, type = 'email') {
  if (!value) return '';
  
  switch (type) {
    case 'email': {
      const [local, domain] = value.split('@');
      if (!domain) return value;
      const maskedLocal = local.charAt(0) + '*'.repeat(Math.max(local.length - 2, 1)) + local.slice(-1);
      return `${maskedLocal}@${domain}`;
    }
    case 'phone': {
      const digits = value.replace(/\D/g, '');
      if (digits.length < 4) return value;
      return `***-***-${digits.slice(-4)}`;
    }
    case 'ssn': {
      return `***-**-${value.slice(-4)}`;
    }
    default:
      return value;
  }
}

module.exports = {
  cn,
  formatDate,
  formatDateTime,
  formatTime,
  formatRelativeTime,
  formatCurrency,
  capitalize,
  snakeToCamel,
  camelToSnake,
  keysToCamel,
  keysToSnake,
  getInitials,
  sleep,
  truncate,
  generateRoomId,
  parseQueryParams,
  getPaginationMeta,
  maskSensitiveData
};

