'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function signingSecret() {
  const seed = process.env.JWT_SECRET || process.env.JWT_DERIVATION_SEED || process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY;
  const accessSecret = process.env.JWT_ACCESS_SECRET || (seed ? crypto.createHmac('sha256', seed).update('doctarx.jwt.access.v1').digest('hex') : global.__JWT_ACCESS_SECRET);
  return accessSecret ? crypto.createHmac('sha256', accessSecret).update('doctarx.mfa.attestation.v1').digest('hex') : null;
}

function requestAccessToken(req) {
  const header = req.headers?.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.accessToken;
}

function issueMfaAttestation(userId, accessToken, { expiresAt = Math.floor(Date.now() / 1000) + 900, authTime = Math.floor(Date.now() / 1000) } = {}) {
  const secret = signingSecret();
  if (!secret || !userId || !accessToken) throw new Error('MFA attestation cannot be issued');
  return jwt.sign({ tokenHash: crypto.createHash('sha256').update(accessToken).digest('hex'), authTime, exp: expiresAt }, secret,
    { algorithm: 'HS256', subject: String(userId), issuer: 'doctarx.mfa', audience: 'sensitive-access' });
}

function verifiedPayload(value, userId, accessToken) {
  try {
    const secret = signingSecret();
    if (!secret || !value || !userId || !accessToken) return null;
    const payload = jwt.verify(value, secret, { algorithms: ['HS256'], issuer: 'doctarx.mfa', audience: 'sensitive-access' });
    if (payload.sub !== String(userId) || !/^[a-f\d]{64}$/.test(payload.tokenHash || '')) return null;
    const actual = crypto.createHash('sha256').update(accessToken).digest();
    return crypto.timingSafeEqual(actual, Buffer.from(payload.tokenHash, 'hex')) ? payload : null;
  } catch { return null; }
}

function hasVerifiedMfa(req) {
  return Boolean(verifiedPayload(req.cookies?.mfaVerified, req.user?.id || req.user?.userId, requestAccessToken(req)));
}

function rotateMfaAttestation(req, userId, newAccessToken) {
  const payload = verifiedPayload(req.cookies?.mfaVerified, userId, requestAccessToken(req));
  if (!payload) return null;
  const maxAge = Math.max(0, payload.exp * 1000 - Date.now());
  return { value: issueMfaAttestation(userId, newAccessToken, { expiresAt: payload.exp, authTime: payload.authTime }), maxAge };
}
module.exports = { issueMfaAttestation, hasVerifiedMfa, rotateMfaAttestation };
