'use strict';
const { MODEL, LANGUAGES, configuration } = require('./geminiLiveEvaluationTransport');
const ENDPOINT = 'https://generativelanguage.googleapis.com/';
const REGION_SCOPE = 'provider_global'; // No regional processing/residency promise.
const BINDING_KEYS = ['provider', 'accountRef', 'projectRef', 'model', 'region', 'termsVersion', 'retentionVersion'];
const fault = () => Object.assign(new Error('The development voice SDK binding is unavailable.'), { code: 'VOICE_DEVELOPER_SDK_REQUIRED', statusCode: 503 });
const ref = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
// Offline comparison factory ONLY for an independently reviewed @google/genai
// constructor. No SDK import, key discovery, credential provisioning or network
// connection occurs at module load or factory creation. The credential-binding
// layer must supply an already-approved key. This does not verify ownership,
// Free Tier eligibility, region enforcement or provider retention.
// SDK 2.32.0 hides its pending socket until setup completes. Do not use this
// factory for live evaluation; the separately owned WebSocket avoids that gap.
function createGeminiDeveloperClientFactory({ GoogleGenAI, env = {} } = {}) {
  if (typeof GoogleGenAI !== 'function' || env.NODE_ENV !== 'test') throw fault();
  return function createClient(input = {}) {
    const { apiKey, providerBinding } = input;
    if (Object.keys(input).some(key => !['apiKey', 'providerBinding'].includes(key))
      || typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{8,1024}$/.test(apiKey)
      || !providerBinding || Object.keys(providerBinding).some(key => !BINDING_KEYS.includes(key))
      || BINDING_KEYS.some(key => !ref(providerBinding[key])) || providerBinding.provider !== 'google'
      || providerBinding.model !== MODEL || providerBinding.region !== REGION_SCOPE) throw fault();
    let client;
    try {
      // Explicit mode and base URL take precedence over the SDK's ambient
      // Vertex/Enterprise and custom endpoint defaults. No caller options merge.
      client = new GoogleGenAI({ apiKey, vertexai: false, enterprise: false, apiVersion: 'v1beta',
        httpOptions: { baseUrl: ENDPOINT } });
      if (typeof client?.live?.connect !== 'function') throw fault();
    } catch { throw fault(); }
    // Expose only the fixed nonclinical Live operation, not authTokens/files or
    // general model APIs. Configuration must be one of our three local prompts.
    return Object.freeze({ live: Object.freeze({ connect(request) {
      try {
        if (!request || Object.keys(request).some(key => !['model', 'config', 'callbacks'].includes(key))
          || !request.callbacks || Object.keys(request.callbacks).some(key => !['onopen', 'onmessage', 'onerror', 'onclose'].includes(key))
          || ['onopen', 'onmessage', 'onerror', 'onclose'].some(key => typeof request.callbacks[key] !== 'function')) throw fault();
        const configured = { model: request.model, config: request.config };
        if (!Object.keys(LANGUAGES).some(language => JSON.stringify(configured) === JSON.stringify(configuration(language)))) throw fault();
        // Clone before SDK code may normalize/mutate config. Callbacks are
        // transport-owned and never derived from a browser frame.
        return Promise.resolve(client.live.connect({ ...structuredClone(configured), callbacks: { ...request.callbacks } })).catch(() => { throw fault(); });
      } catch { throw fault(); }
    } }) });
  };
}
module.exports = { createGeminiDeveloperClientFactory, ENDPOINT, REGION_SCOPE };
