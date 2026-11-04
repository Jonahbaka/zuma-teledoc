'use strict';
// Actual component under synthetic hooks/API. No browser, database, or patient data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const root = path.resolve(__dirname, '../..');
const filename = path.join(root, 'app/(dashboard)/admin/roles/page.js');
const source = fs.readFileSync(filename, 'utf8');
const output = transformSync(source, { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
const plain = value => JSON.parse(JSON.stringify(value));
function all(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => all(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...all(tree.props?.children, predicate)];
}
function text(tree) { return tree == null ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children); }
function harness({ active = true, failure = false, self = false, role = 'super_admin' } = {}) {
  const slots = [], effects = [], calls = [], messages = []; let cursor = 0, dirty = false;
  const actor = { id: 'actor', role };
  const record = { id: self ? actor.id : 'target', role: 'patient', firstName: 'Synthetic', lastName: 'Account', email: 'synthetic@example.invalid', isActive: active, createdAt: '2026-01-01' };
  const react = {
    useState(value) { const index = cursor++; if (!slots[index]) slots[index] = { value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; dirty = true; }]; },
    useEffect(fn, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) { slots[index] = { deps }; effects.push(fn); } },
  };
  const api = {
    async getUsers() { return { data: { success: true, users: [record] } }; },
    async updateUserStatus(id, data) { calls.push(['updateUserStatus', id, plain(data)]); if (failure) throw new Error('Synthetic failure'); return { data: { success: true } }; },
    async deleteUser() { calls.push(['deleteUser']); throw new Error('Destructive API must be unreachable'); },
  };
  const element = (type, props) => ({ type, props });
  const dependencies = { react, 'react/jsx-runtime': { jsx: element, jsxs: element },
    '@/lib/api': { adminAPI: api }, '@/components/providers/AuthProvider': { useAuth: () => ({ user: actor }) },
    '@/components/ui/use-toast': { toast: value => messages.push(value) } };
  const sourceModule = { exports: {} };
  vm.runInNewContext(output, { module: sourceModule, exports: sourceModule.exports, console,
    require(name) { if (dependencies[name]) return dependencies[name]; assert.ok(name === 'lucide-react' || name.startsWith('@/components/ui/')); return new Proxy({}, { get: (_, key) => key }); },
  });
  function render() { let tree; do { cursor = 0; dirty = false; tree = sourceModule.exports.default(); effects.splice(0).forEach(fn => fn()); } while (dirty); return tree; }
  return { render, calls, messages, async ready() { render(); await new Promise(resolve => setImmediate(resolve)); return render(); },
    controls: () => all(render(), node => node.type === 'Button'),
  };
}
test('roles page has no permanent-deletion handler, API call, button, or false success text', async () => {
  assert.doesNotMatch(source, /handleDeleteUser|adminAPI\.deleteUser|Trash2|User Deleted|permanently removed/);
  const h = harness(); const tree = await h.ready();
  assert.match(text(tree), /Permanent deletion is unavailable/);
  assert.match(text(tree), /clinical history/); assert.match(text(tree), /retaining records/);
  assert.equal(h.controls().filter(node => /delete/i.test(text(node) + (node.props['aria-label'] || ''))).length, 0);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.messages, []);
});
for (const active of [true, false]) test(`accessible ${active ? 'deactivation' : 'reactivation'} only sends the existing status contract after a click`, async () => {
  const h = harness({ active }); await h.ready();
  h.render(); assert.deepEqual(h.calls, [], 'rendering and data loading never mutate accounts');
  const button = h.controls().find(node => node.props['aria-label'] === `${active ? 'Deactivate' : 'Reactivate'} account for Synthetic Account`);
  assert.ok(button); await button.props.onClick();
  assert.deepEqual(h.calls, [['updateUserStatus', 'target', { isActive: !active }]]);
  assert.equal(h.messages[0].title, 'Status Updated');
  assert.ok(!JSON.stringify(h.messages).match(/delet|permanent/i));
});
test('failed status update reports error, never deletion or status success', async () => {
  const h = harness({ failure: true }); await h.ready();
  await h.controls().find(node => node.props['aria-label']?.startsWith('Deactivate')).props.onClick();
  assert.equal(h.calls.length, 1); assert.equal(h.messages.length, 1); assert.equal(h.messages[0].title, 'Error');
});
test('own account status toggle remains absent and ordinary admin still has status control', async () => {
  const own = harness({ self: true }); await own.ready();
  assert.equal(own.controls().filter(node => /^(Deactivate|Reactivate)/.test(node.props['aria-label'] || '')).length, 0);
  const admin = harness({ role: 'admin' }); await admin.ready();
  assert.ok(admin.controls().some(node => node.props['aria-label']?.startsWith('Deactivate')));
  assert.deepEqual(own.calls, []); assert.deepEqual(admin.calls, []);
});
test('separate test-account lifecycle remains reversible and own-account endpoint deactivates (source only)', () => {
  const service = fs.readFileSync(path.join(root, 'server/services/adminTestAccountService.js'), 'utf8');
  const lifecycle = service.slice(service.indexOf('async function updateAdminTestAccountLifecycle'));
  assert.ok(lifecycle.length > 0); assert.doesNotMatch(lifecycle, /DELETE FROM/i);
  assert.match(lifecycle, /SET is_active = CASE WHEN \$4 = 'restore' THEN TRUE ELSE FALSE END/);
  assert.match(lifecycle, /status: 'deleted'/); assert.match(lifecycle, /deletedAt: null/);
  const users = fs.readFileSync(path.join(root, 'server/routes/users.js'), 'utf8');
  const own = users.slice(users.indexOf("router.delete('/account'"), users.indexOf("router.delete('/account'") + 1100);
  assert.match(own, /authenticate/); assert.match(own, /UPDATE users SET is_active = false/);
  assert.match(own, /UPDATE refresh_tokens SET revoked_at/); assert.doesNotMatch(own, /DELETE FROM/i);
});
