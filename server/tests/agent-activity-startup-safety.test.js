'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const servicePath = require.resolve('../services/agentSocialService');
const originalLoad = Module._load;
let queries = [];
let missing = [];
let unavailable = false;
let service;
try {
  Module._load = function isolateDatabase(request, parent) {
    if (parent?.filename === servicePath && request === '../db') {
      return {
        async query(sql, params) {
          queries.push({ sql, params });
          assert.match(sql, /^\s*SELECT\b/);
          assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i);
          if (unavailable) throw new Error('Private database connection detail');
          return { rows: missing.map(relation => ({ relation })) };
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };
  service = require(servicePath);
} finally {
  Module._load = originalLoad;
}

test('server restarts only check activity schema and never recreate posts or profiles', async () => {
  queries = []; missing = []; unavailable = false;
  assert.equal(await service.initialize(), true);
  assert.equal(await service.initialize(), true);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params[0], [
    'agora_profiles', 'agora_posts', 'agora_reactions', 'agora_comments',
    'agora_topics', 'agora_follows', 'agora_polls', 'agora_poll_votes',
    'agora_brainstorms', 'agora_achievements', 'agora_daily_digest',
  ]);
});

test('missing schema and connection failure never trigger a seed or delayed migration retry', async () => {
  queries = []; missing = ['agora_posts']; unavailable = false;
  assert.equal(await service.initialize(), false);
  unavailable = true;
  assert.equal(await service.initialize(), false);
  assert.equal(queries.length, 2);
});
