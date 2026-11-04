#!/usr/bin/env node

const assert = require('assert');
const express = require('express');
const http = require('http');
const path = require('path');

const links = [];
const activations = [];
const users = [
  {
    id: 'super-admin-test',
    email: 'iamjonah.baka@gmail.com',
    first_name: 'Jonah',
    last_name: 'Baka',
    role: 'super_admin',
  },
];

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function lifecycle(link) {
  if (link.deleted_at) return 'deleted';
  if (link.revoked_at || link.is_active === false) return 'revoked';
  if (new Date(link.expires_at) < new Date()) return 'expired';
  if (link.max_uses && link.current_uses >= link.max_uses) return 'used';
  return 'active';
}

function filterLinks(sql, params = []) {
  let result = links.filter((link) => (link.market_scope || 'US') === params[0]);
  const typeParam = params.find((param) => ['patient', 'provider', 'pharmacy', 'admin'].includes(param));
  const searchParam = params.find((param) => typeof param === 'string' && param.startsWith('%') && param.endsWith('%'));

  if (typeParam) {
    result = result.filter((link) => link.link_type === typeParam);
  }

  if (sql.includes('tl.deleted_at IS NULL')) {
    result = result.filter((link) => !link.deleted_at);
  }

  if (sql.includes('tl.deleted_at IS NOT NULL')) {
    result = result.filter((link) => Boolean(link.deleted_at));
  }

  if (sql.includes('tl.revoked_at IS NOT NULL')) {
    result = result.filter((link) => Boolean(link.revoked_at) || link.is_active === false);
  }

  if (sql.includes('tl.is_active = TRUE')) {
    result = result.filter((link) => link.is_active === true);
  }

  if (sql.includes('tl.expires_at <= NOW()')) {
    result = result.filter((link) => new Date(link.expires_at) <= new Date());
  }

  if (sql.includes('tl.max_uses IS NOT NULL AND tl.current_uses >= tl.max_uses')) {
    result = result.filter((link) => link.max_uses && link.current_uses >= link.max_uses);
  }

  if (searchParam) {
    const search = searchParam.slice(1, -1).toLowerCase();
    result = result.filter((link) =>
      [link.label, link.description, link.token, 'iamjonah.baka@gmail.com']
        .some((value) => String(value || '').toLowerCase().includes(search))
    );
  }

  return result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function withJoinedUsers(link) {
  const creator = users.find((user) => user.id === link.created_by) || {};
  const lastUser = users.find((user) => user.id === link.last_used_by) || {};
  return {
    ...link,
    created_by_email: creator.email || null,
    created_by_first_name: creator.first_name || null,
    created_by_last_name: creator.last_name || null,
    last_used_by_email: lastUser.email || null,
    last_used_by_first_name: lastUser.first_name || null,
    last_used_by_last_name: lastUser.last_name || null,
    activation_count: activations.filter((activation) => activation.link_id === link.id).length,
  };
}

const mockDb = {
  query: async (sql, params = []) => {
    if (sql.includes('ALTER TABLE testing_access_links ADD COLUMN IF NOT EXISTS status')) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes('INSERT INTO testing_access_links')) {
      const row = {
        id: `test-link-${links.length + 1}`,
        token: params[0],
        link_type: params[1],
        label: params[2],
        description: params[3],
        max_uses: params[4],
        current_uses: 0,
        expires_at: params[5],
        bypass_payment: params[6],
        bypass_subscription: params[7],
        grant_tier: params[8],
        market_scope: params[9],
        created_by: params[10],
        status: 'active',
        is_active: true,
        revoked_at: null,
        revoked_by: null,
        deleted_at: null,
        deleted_by: null,
        last_used_at: null,
        last_used_by: null,
        created_at: nowIso(links.length * 1000),
        updated_at: nowIso(links.length * 1000),
      };
      links.push(row);
      return { rows: [row], rowCount: 1 };
    }

    if (sql.includes('COUNT(*)::int AS count') && sql.includes('testing_access_links')) {
      return { rows: [{ count: filterLinks(sql, params).length }] };
    }

    if (sql.includes('FROM testing_access_links tl') && sql.includes('ORDER BY tl.created_at DESC')) {
      const limit = Number(params[params.length - 2] || 100);
      const offset = Number(params[params.length - 1] || 0);
      return { rows: filterLinks(sql, params).slice(offset, offset + limit).map(withJoinedUsers) };
    }

    if (sql.includes('UPDATE testing_access_links') && sql.includes("status = 'deleted'")) {
      const [id, marketScope, userId] = params;
      const link = links.find((candidate) =>
        candidate.id === id &&
        candidate.market_scope === marketScope &&
        !candidate.deleted_at
      );
      if (!link) return { rows: [], rowCount: 0 };
      link.is_active = false;
      link.status = 'deleted';
      link.deleted_at = nowIso();
      link.deleted_by = userId;
      link.updated_at = nowIso();
      return { rows: [link], rowCount: 1 };
    }

    if (sql.includes('UPDATE testing_access_links') && sql.includes("status = 'revoked'")) {
      const [id, marketScope, userId] = params;
      const link = links.find((candidate) =>
        candidate.id === id &&
        candidate.market_scope === marketScope &&
        !candidate.deleted_at
      );
      if (!link) return { rows: [], rowCount: 0 };
      link.is_active = false;
      link.status = 'revoked';
      link.revoked_at = nowIso();
      link.revoked_by = userId;
      link.updated_at = nowIso();
      return { rows: [link], rowCount: 1 };
    }

    if (sql.includes('SELECT * FROM testing_access_links') && sql.includes('WHERE token = $1')) {
      return { rows: links.filter((link) => link.token === params[0]).slice(0, 1) };
    }

    if (sql.includes('FROM testing_link_activations')) {
      return { rows: [] };
    }

    throw new Error(`Unhandled mock query: ${sql}`);
  },
};

const dbPath = require.resolve(path.join('..', 'server', 'db'));
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: mockDb,
};

const authPath = require.resolve(path.join('..', 'server', 'middleware', 'auth'));
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    authenticate: (req, _res, next) => {
      req.user = users[0];
      next();
    },
    requireRole: () => (_req, _res, next) => next(),
  },
};

async function request(baseUrl, method, pathName, body) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/testing-links', require('../server/routes/testingLinks'));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const created = [];
    for (const role of ['patient', 'provider', 'pharmacy']) {
      const res = await request(baseUrl, 'POST', '/api/testing-links', {
        linkType: role,
        label: `NG ${role} QA access`,
        description: `Lifecycle test for ${role}`,
        maxUses: 3,
        expiresInHours: 72,
        marketScope: 'NG',
      });
      assert.strictEqual(res.status, 201, JSON.stringify(res.payload));
      assert.strictEqual(res.payload.success, true);
      assert.strictEqual(res.payload.link.link_type, role);
      assert(res.payload.link.fullUrl.includes('/ng/access/'), 'Expected NG access URL');
      created.push(res.payload.link);
    }

    const list = await request(baseUrl, 'GET', '/api/testing-links?marketScope=NG&limit=100');
    assert.strictEqual(list.status, 200, JSON.stringify(list.payload));
    assert.strictEqual(list.payload.links.length, 3, 'Expected all three links to list');

    const pharmacy = created.find((link) => link.link_type === 'pharmacy');
    assert(pharmacy.loginUrl.includes('/ng/pharmacy/login?test_token='), 'Expected pharmacy login URL');
    assert(pharmacy.registerUrl.includes('/ng/pharmacy/register?test_token='), 'Expected pharmacy register URL');

    const revoked = await request(baseUrl, 'PATCH', `/api/testing-links/${created[0].id}`, {
      action: 'revoke',
      marketScope: 'NG',
    });
    assert.strictEqual(revoked.status, 200, JSON.stringify(revoked.payload));
    assert.strictEqual(revoked.payload.link.status, 'revoked');

    const revokedValidation = await request(baseUrl, 'POST', '/api/testing-links/validate', {
      token: created[0].token,
    });
    assert.strictEqual(revokedValidation.status, 410, JSON.stringify(revokedValidation.payload));
    assert.strictEqual(revokedValidation.payload.status, 'revoked');

    const deleted = await request(baseUrl, 'DELETE', `/api/testing-links/${created[1].id}?marketScope=NG`);
    assert.strictEqual(deleted.status, 200, JSON.stringify(deleted.payload));
    assert.strictEqual(deleted.payload.link.status, 'deleted');

    const defaultList = await request(baseUrl, 'GET', '/api/testing-links?marketScope=NG&limit=100');
    assert.strictEqual(defaultList.payload.links.length, 2, 'Expected soft-deleted link hidden by default');

    const includeDeleted = await request(baseUrl, 'GET', '/api/testing-links?marketScope=NG&includeDeleted=true&limit=100');
    assert.strictEqual(includeDeleted.payload.links.length, 3, 'Expected deleted link visible with includeDeleted');

    const pharmacyFilter = await request(baseUrl, 'GET', '/api/testing-links?marketScope=NG&type=pharmacy&limit=100');
    assert.strictEqual(pharmacyFilter.payload.links.length, 1, 'Expected role filter to find pharmacy link');

    const revokedFilter = await request(baseUrl, 'GET', '/api/testing-links?marketScope=NG&status=revoked&limit=100');
    assert.strictEqual(revokedFilter.payload.links.length, 1, 'Expected status filter to find revoked link');

    const search = await request(baseUrl, 'GET', '/api/testing-links?marketScope=NG&query=pharmacy&limit=100');
    assert.strictEqual(search.payload.links.length, 1, 'Expected search to find pharmacy link');

    console.log(JSON.stringify({
      createdLinks: created.map((link) => ({
        id: link.id,
        role: link.link_type,
        fullUrl: link.fullUrl,
        loginUrl: link.loginUrl,
        registerUrl: link.registerUrl,
        status: lifecycle(links.find((candidate) => candidate.id === link.id)),
      })),
      listCount: list.payload.links.length,
      defaultListAfterDeleteCount: defaultList.payload.links.length,
      includeDeletedCount: includeDeleted.payload.links.length,
      revokedValidationStatus: revokedValidation.status,
      revokedValidationMessage: revokedValidation.payload.error,
      pharmacyFilterCount: pharmacyFilter.payload.links.length,
      revokedFilterCount: revokedFilter.payload.links.length,
      searchCount: search.payload.links.length,
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
