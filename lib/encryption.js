/**
 * PHI Encryption Utilities
 * AES-256-GCM encryption for HIPAA-compliant data protection
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits authentication tag
const KEY_LENGTH = 32; // 256 bits

/**
 * Get encryption key from environment
 * @returns {Buffer} 32-byte encryption key
 */
let _cachedKey = null;
let _allKeys = null;

function deriveKey(seed) {
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function getEncryptionKey() {
  if (_cachedKey) return _cachedKey;

  const keyString = process.env.ENCRYPTION_KEY;
  
  if (keyString) {
    if (/^[0-9a-fA-F]+$/.test(keyString) && keyString.length === 64) {
      _cachedKey = Buffer.from(keyString, 'hex');
    } else {
      _cachedKey = deriveKey(keyString);
    }
    return _cachedKey;
  }
  
  const seed =
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.DATABASE_URL ||
    'doctarx-default-encryption-seed-change-me';
  _cachedKey = deriveKey(String(seed) + ':phi-encryption-v1');
  return _cachedKey;
}

function getAllDecryptionKeys() {
  if (_allKeys) return _allKeys;
  const primary = getEncryptionKey();
  const seen = new Set();
  const keys = [primary];
  seen.add(primary.toString('hex'));

  const candidates = [
    process.env.ENCRYPTION_KEY,
    process.env.SESSION_SECRET,
    process.env.JWT_SECRET,
    process.env.DATABASE_URL,
    'doctarx-default-encryption-seed-change-me'
  ].filter(Boolean);

  for (const c of candidates) {
    for (const seed of [c, c + ':phi-encryption-v1']) {
      const k = deriveKey(seed);
      const hex = k.toString('hex');
      if (!seen.has(hex)) { keys.push(k); seen.add(hex); }
    }
    if (/^[0-9a-fA-F]+$/.test(c) && c.length === 64) {
      const k = Buffer.from(c, 'hex');
      const hex = k.toString('hex');
      if (!seen.has(hex)) { keys.push(k); seen.add(hex); }
    }
  }

  _allKeys = keys;
  return _allKeys;
}

/**
 * Encrypt plaintext data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @returns {Object} Encrypted data with iv and tag
 */
function encrypt(plaintext) {
  if (!plaintext) {
    return { encrypted: null, iv: null, tag: null };
  }
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const tag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex')
  };
}

/**
 * Decrypt data encrypted with AES-256-GCM
 * @param {string} encrypted - Base64 encrypted data
 * @param {string} ivHex - Hex-encoded IV
 * @param {string} tagHex - Hex-encoded authentication tag
 * @returns {string|null} Decrypted plaintext or null if decryption fails
 */
function decryptWithKey(encrypted, iv, tag, key) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function decrypt(encrypted, ivHex, tagHex) {
  if (!encrypted || !ivHex || !tagHex) {
    return null;
  }
  
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  // Try primary key first
  try {
    return decryptWithKey(encrypted, iv, tag, getEncryptionKey());
  } catch (_primaryErr) {
    // Fall through to try alternative keys
  }

  // Try all candidate keys (covers key changes across deploys)
  const allKeys = getAllDecryptionKeys();
  for (let i = 1; i < allKeys.length; i++) {
    try {
      return decryptWithKey(encrypted, iv, tag, allKeys[i]);
    } catch (_) {
      // Try next key
    }
  }

  console.error('Decryption failed: no matching key found for message');
  return null;
}

/**
 * Encrypt an object's PHI fields
 * @param {Object} data - Object containing data to encrypt
 * @param {Array<string>} fields - Field names to encrypt
 * @returns {Object} Object with encrypted fields
 */
function encryptFields(data, fields) {
  const result = { ...data };
  
  for (const field of fields) {
    if (data[field] !== undefined && data[field] !== null) {
      const { encrypted, iv, tag } = encrypt(
        typeof data[field] === 'string' ? data[field] : JSON.stringify(data[field])
      );
      
      result[`${field}_encrypted`] = encrypted;
      result[`${field}_iv`] = iv;
      result[`${field}_tag`] = tag;
      delete result[field];
    }
  }
  
  return result;
}

/**
 * Decrypt an object's PHI fields
 * @param {Object} data - Object containing encrypted data
 * @param {Array<string>} fields - Original field names (without _encrypted suffix)
 * @returns {Object} Object with decrypted fields
 */
function decryptFields(data, fields) {
  const result = { ...data };
  
  for (const field of fields) {
    const encryptedField = `${field}_encrypted`;
    const ivField = `${field}_iv`;
    const tagField = `${field}_tag`;
    
    if (data[encryptedField] && data[ivField] && data[tagField]) {
      const decrypted = decrypt(data[encryptedField], data[ivField], data[tagField]);
      
      // Try to parse as JSON, otherwise return as string
      try {
        result[field] = JSON.parse(decrypted);
      } catch {
        result[field] = decrypted;
      }
      
      delete result[encryptedField];
      delete result[ivField];
      delete result[tagField];
    }
  }
  
  return result;
}

/**
 * Hash sensitive data for comparison (e.g., tokens)
 * @param {string} data - Data to hash
 * @returns {string} SHA-256 hash
 */
function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a secure random token
 * @param {number} length - Token length in bytes
 * @returns {string} Hex-encoded random token
 */
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a secure random string for codes
 * @param {number} length - Code length
 * @returns {string} Random alphanumeric code
 */
function generateCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  
  return result;
}

module.exports = {
  encrypt,
  decrypt,
  encryptFields,
  decryptFields,
  hash,
  generateToken,
  generateCode,
  ALGORITHM,
  IV_LENGTH,
  TAG_LENGTH,
  KEY_LENGTH
};

