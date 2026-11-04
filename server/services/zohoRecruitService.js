const credentialVault = require('./agent-orchestrator/credential-vault');

const DEFAULT_ACCOUNTS_BASE = 'https://accounts.zoho.com';
const DEFAULT_RECRUIT_API_BASE = 'https://recruit.zoho.com';
const DEFAULT_SCOPE = [
  'ZohoRecruit.modules.jobopenings.CREATE',
  'ZohoRecruit.modules.jobopenings.READ',
  'ZohoRecruit.modules.jobopenings.UPDATE'
].join(',');
const VAULT_PLATFORM = 'zoho_recruit';
const VAULT_LABEL = 'DoctaRx Zoho Recruit OAuth';

function env(name) {
  return String(process.env[name] || '').trim();
}

function required(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function computeExpiresAt(expiresInSeconds) {
  const sec = Number(expiresInSeconds || 3600);
  return new Date(Date.now() + sec * 1000).toISOString();
}

async function parseResponse(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

class ZohoRecruitService {
  getConfig() {
    const accountsBase = env('ZOHO_ACCOUNTS_BASE_URL') || DEFAULT_ACCOUNTS_BASE;
    const recruitApiBase = env('ZOHO_RECRUIT_API_BASE_URL') || DEFAULT_RECRUIT_API_BASE;
    const scope = env('ZOHO_RECRUIT_SCOPE') || DEFAULT_SCOPE;
    return {
      accountsBase: accountsBase.replace(/\/$/, ''),
      recruitApiBase: recruitApiBase.replace(/\/$/, ''),
      clientId: required('ZOHO_RECRUIT_CLIENT_ID'),
      clientSecret: required('ZOHO_RECRUIT_CLIENT_SECRET'),
      redirectUri: required('ZOHO_RECRUIT_REDIRECT_URI'),
      scope
    };
  }

  buildAuthorizeUrl(state = '') {
    const cfg = this.getConfig();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      scope: cfg.scope,
      redirect_uri: cfg.redirectUri,
      access_type: 'offline',
      prompt: 'consent'
    });
    if (state) params.set('state', state);
    return `${cfg.accountsBase}/oauth/v2/auth?${params.toString()}`;
  }

  async exchangeAuthorizationCode(code) {
    const cfg = this.getConfig();
    const tokenRes = await fetch(`${cfg.accountsBase}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        code
      })
    });
    const payload = await parseResponse(tokenRes);
    if (!tokenRes.ok || payload.error) {
      throw new Error(`Zoho authorization_code exchange failed: ${JSON.stringify(payload)}`);
    }
    await this.saveTokens(payload, 'authorization_code');
    return payload;
  }

  async refreshAccessToken(refreshToken) {
    const cfg = this.getConfig();
    const tokenRes = await fetch(`${cfg.accountsBase}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: refreshToken
      })
    });
    const payload = await parseResponse(tokenRes);
    if (!tokenRes.ok || payload.error) {
      throw new Error(`Zoho refresh_token exchange failed: ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  async saveTokens(tokenPayload, source = 'unknown') {
    const existing = await credentialVault.getCredentialByPlatform(VAULT_PLATFORM, 'operator', VAULT_LABEL);
    const refreshToken = tokenPayload.refresh_token || existing?.apiSecret || null;
    if (!refreshToken) {
      throw new Error('No refresh token available to persist');
    }

    const extraData = {
      accessToken: tokenPayload.access_token || existing?.apiKey || null,
      refreshToken,
      apiDomain: tokenPayload.api_domain || existing?.extraData?.apiDomain || null,
      tokenType: tokenPayload.token_type || existing?.extraData?.tokenType || 'Bearer',
      scope: tokenPayload.scope || existing?.extraData?.scope || null,
      expiresIn: Number(tokenPayload.expires_in || 3600),
      expiresAt: computeExpiresAt(tokenPayload.expires_in || 3600),
      obtainedAt: nowIso(),
      source
    };

    await credentialVault.upsertCredentialByPlatform({
      platform: VAULT_PLATFORM,
      accountLabel: VAULT_LABEL,
      apiKey: extraData.accessToken,
      apiSecret: refreshToken,
      extraData,
      assignedAgents: ['growth', 'ceo', 'engineering', 'operations'],
      notes: 'Zoho Recruit OAuth tokens for autonomous job posting'
    });
    return extraData;
  }

  async getAccessToken() {
    const cred = await credentialVault.getCredentialByPlatform(VAULT_PLATFORM, 'growth', VAULT_LABEL);
    if (!cred) {
      throw new Error('Zoho Recruit OAuth credential not connected yet');
    }

    const extra = cred.extraData || {};
    const token = extra.accessToken || cred.apiKey;
    const refreshToken = extra.refreshToken || cred.apiSecret;
    const expiresAt = extra.expiresAt ? new Date(extra.expiresAt).getTime() : 0;

    if (token && expiresAt > Date.now() + 60_000) {
      return {
        accessToken: token,
        apiDomain: extra.apiDomain || null
      };
    }
    if (!refreshToken) {
      throw new Error('Zoho Recruit refresh token missing');
    }

    const refreshed = await this.refreshAccessToken(refreshToken);
    const saved = await this.saveTokens({ ...refreshed, refresh_token: refreshToken }, 'refresh_token');
    return {
      accessToken: saved.accessToken,
      apiDomain: saved.apiDomain || null
    };
  }

  async createJobOpening(job, options = {}) {
    const { accessToken, apiDomain } = await this.getAccessToken();
    const cfg = this.getConfig();
    const apiBase = (apiDomain || cfg.recruitApiBase || DEFAULT_RECRUIT_API_BASE).replace(/\/$/, '');
    const endpoint = `${apiBase}/recruit/v2/Job_Openings`;
    const payload = { data: [job] };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const body = await parseResponse(res);
    if (!res.ok || body.code === 'INVALID_DATA') {
      throw new Error(`Zoho create job opening failed: ${JSON.stringify(body)}`);
    }

    const created = body.data?.[0] || body;
    if (options.publishToBoards && created?.details?.id) {
      const publishResult = await this.publishToBoards(created.details.id, options.publishChannels || ['LinkedIn', 'Indeed']);
      return { created, publishResult };
    }
    return { created };
  }

  async publishToBoards(jobOpeningId, channels = ['LinkedIn', 'Indeed']) {
    const { accessToken, apiDomain } = await this.getAccessToken();
    const cfg = this.getConfig();
    const apiBase = (apiDomain || cfg.recruitApiBase || DEFAULT_RECRUIT_API_BASE).replace(/\/$/, '');

    // Zoho Recruit publish endpoint may vary by org/DC setup; this attempts the standard action endpoint.
    const endpoint = `${apiBase}/recruit/v2/Job_Openings/${jobOpeningId}/actions/publish`;
    const payload = { data: [{ job_boards: channels }] };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const body = await parseResponse(res);
    if (!res.ok) {
      return {
        success: false,
        message: 'Job created, but publish call was not accepted by Zoho endpoint',
        endpoint,
        response: body
      };
    }
    return { success: true, response: body };
  }

  async getConnectionStatus() {
    try {
      const cred = await credentialVault.getCredentialByPlatform(VAULT_PLATFORM, 'operator', VAULT_LABEL);
      if (!cred) return { connected: false };
      const extra = cred.extraData || {};
      return {
        connected: true,
        accountLabel: cred.accountLabel || VAULT_LABEL,
        expiresAt: extra.expiresAt || null,
        scope: extra.scope || null,
        apiDomain: extra.apiDomain || null,
        updatedAt: extra.obtainedAt || null
      };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }
}

module.exports = new ZohoRecruitService();
