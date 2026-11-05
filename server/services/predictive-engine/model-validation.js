'use strict';

const crypto = require('crypto');
const fail = (code, message) => Object.assign(new Error(message), { statusCode: 503, code });
const CONTRACT = 'explicit-numeric-features-v1';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

function artifactDigest(model) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical({
    id: model.id, type: model.model_type, version: model.model_version,
    algorithm: model.algorithm, weights: model.model_weights, features: model.feature_names,
    preprocessing: model.preprocessing_config || {}, hyperparameters: model.hyperparameters || {},
  }))).digest('hex');
}

// Deployment-owned evidence, never accepted from a request or training options.
// A manifest is an approval record, not a substitute for clinical validation.
function approvals(env = process.env) {
  try {
    const parsed = JSON.parse(env.PREDICTIVE_MODEL_APPROVALS_JSON || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function assertReviewedModel(model, market, { env = process.env, now = Date.now() } = {}) {
  const unavailable = () => fail('PREDICTIVE_MODEL_UNVALIDATED', 'No reviewed predictive model is available for this market.');
  if (!model || model.trained_by === 'system_default' || /_baseline$/.test(model.model_name || '') ||
      !['US', 'NG'].includes(market) || !['logistic_regression', 'linear_regression'].includes(model.algorithm)) throw unavailable();
  // Serving currently consumes raw explicit numeric inputs. An approved artifact
  // cannot enable a preprocessing transform that the scorer does not implement.
  const preprocessing = model.preprocessing_config;
  if (preprocessing != null && (typeof preprocessing !== 'object' || Array.isArray(preprocessing) ||
      Object.keys(preprocessing).length !== 0)) throw unavailable();
  const names = model.feature_names;
  const weights = model.model_weights;
  if (!Array.isArray(names) || names.length === 0 || names.length > 200 || new Set(names).size !== names.length ||
      names.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(name)) ||
      !weights || !Number.isFinite(weights.intercept) || names.some(name => !Number.isFinite(weights[name]))) throw unavailable();
  const match = approvals(env).find(entry => entry && entry.modelId === model.id && entry.artifactSha256 === artifactDigest(model) &&
    Array.isArray(entry.markets) && entry.markets.includes(market) && entry.inputContract === CONTRACT &&
    typeof entry.reviewedBy === 'string' && entry.reviewedBy.trim().length > 0 &&
    typeof entry.evidenceReference === 'string' && entry.evidenceReference.trim().length > 0 &&
    Number.isFinite(Date.parse(entry.reviewedAt)) && Date.parse(entry.reviewedAt) <= now &&
    Number.isFinite(Date.parse(entry.expiresAt)) && Date.parse(entry.expiresAt) > now &&
    Number.isFinite(entry.maxInputAgeSeconds) && entry.maxInputAgeSeconds > 0 && entry.maxInputAgeSeconds <= 86400 &&
    names.every(name => Array.isArray(entry.featureRanges?.[name]) && entry.featureRanges[name].length === 2 &&
      entry.featureRanges[name].every(Number.isFinite) && entry.featureRanges[name][0] <= entry.featureRanges[name][1]));
  if (!match) throw unavailable();
  return match;
}

function validateInputs(model, input, approval, { now = Date.now() } = {}) {
  const invalid = () => fail('PREDICTIVE_INPUTS_UNVERIFIED', 'Complete, current, verified model inputs are required. No risk score was produced.');
  if (!input || input.contract !== CONTRACT || !input.features || !Number.isFinite(Date.parse(input.observedAt)) ||
      Date.parse(input.observedAt) > now || now - Date.parse(input.observedAt) > approval.maxInputAgeSeconds * 1000) throw invalid();
  const features = {};
  for (const name of model.feature_names) {
    const value = input.features[name];
    const [min, max] = approval.featureRanges[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid();
    features[name] = value;
  }
  return features;
}

function reviewedMarkets(model, options) {
  return ['US', 'NG'].filter(market => { try { assertReviewedModel(model, market, options); return true; } catch { return false; } });
}

module.exports = { CONTRACT, artifactDigest, assertReviewedModel, validateInputs, reviewedMarkets, fail };
