/**
 * GitHub Service (Agent Chat integration)
 *
 * Uses the Credential Vault ("github" platform) to call GitHub REST API.
 * Node >= 20 provides global fetch.
 */

const credentialVault = require('./credential-vault');

const GH_API = 'https://api.github.com';

function truncate(value, max = 6000) {
  const s = String(value ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n…(truncated, ${s.length - max} chars more)`;
}

function safeJson(value) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

async function getToken(requestingAgent = 'operator') {
  const cred = await credentialVault.getCredentialByPlatform('github', requestingAgent);
  const token = cred?.apiKey;
  if (!token) throw new Error('GitHub token not found in Credential Vault (platform: github, field: api_key)');
  return token.trim();
}

async function ghFetch(path, { token, method = 'GET', body = null, headers = {} } = {}) {
  const url = path.startsWith('http') ? path : `${GH_API}${path.startsWith('/') ? '' : '/'}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const msg = json?.message || text || `GitHub error (${res.status})`;
    const detail = json?.errors ? `\n${safeJson(json.errors)}` : '';
    throw new Error(`${msg}${detail}`.trim());
  }
  return json ?? text;
}

async function whoAmI(requestingAgent = 'operator') {
  const token = await getToken(requestingAgent);
  const user = await ghFetch('/user', { token });
  return {
    login: user?.login,
    name: user?.name,
    url: user?.html_url,
    scopes: null // scopes are in headers; not exposed here
  };
}

async function listRepos(owner, requestingAgent = 'operator') {
  const token = await getToken(requestingAgent);
  if (!owner) throw new Error('owner is required');
  const repos = await ghFetch(`/users/${encodeURIComponent(owner)}/repos?per_page=30&sort=updated`, { token });
  return (Array.isArray(repos) ? repos : []).map((r) => ({
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    url: r.html_url,
    updatedAt: r.updated_at,
    description: r.description
  }));
}

async function listIssues(owner, repo, requestingAgent = 'operator') {
  const token = await getToken(requestingAgent);
  if (!owner || !repo) throw new Error('owner and repo are required');
  const issues = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?per_page=20&state=open`, { token });
  return (Array.isArray(issues) ? issues : [])
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      url: i.html_url,
      author: i.user?.login,
      createdAt: i.created_at
    }));
}

async function getFile(owner, repo, filePath, requestingAgent = 'operator') {
  const token = await getToken(requestingAgent);
  if (!owner || !repo || !filePath) throw new Error('owner, repo, and filePath are required');
  const data = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.replace(/^\/+/, '')}`, { token });
  if (Array.isArray(data)) {
    return { type: 'directory', entries: data.slice(0, 60).map((e) => ({ name: e.name, path: e.path, type: e.type })) };
  }
  if (data?.type !== 'file') {
    return { type: data?.type || 'unknown', raw: data };
  }
  const contentB64 = data.content || '';
  const buff = Buffer.from(contentB64, 'base64');
  const text = truncate(buff.toString('utf8'), 12000);
  return {
    type: 'file',
    path: data.path,
    size: data.size,
    sha: data.sha,
    downloadUrl: data.download_url,
    text
  };
}

// Write operations are supported but should be gated by UI/confirmation.
async function createIssue(owner, repo, { title, body } = {}, requestingAgent = 'operator') {
  const token = await getToken(requestingAgent);
  if (!owner || !repo) throw new Error('owner and repo are required');
  if (!title) throw new Error('title is required');
  const created = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    token,
    method: 'POST',
    body: { title, body: body || '' }
  });
  return { number: created?.number, url: created?.html_url, title: created?.title };
}

async function commentIssue(owner, repo, issueNumber, { body } = {}, requestingAgent = 'operator') {
  const token = await getToken(requestingAgent);
  if (!owner || !repo) throw new Error('owner and repo are required');
  if (!issueNumber) throw new Error('issueNumber is required');
  if (!body) throw new Error('body is required');
  const created = await ghFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/comments`, {
    token,
    method: 'POST',
    body: { body }
  });
  return { url: created?.html_url, id: created?.id };
}

module.exports = {
  whoAmI,
  listRepos,
  listIssues,
  getFile,
  createIssue,
  commentIssue
};

