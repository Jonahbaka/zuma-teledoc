'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');

function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  return typeof node === 'string' ? node : node?.props ? text(node.props.children) : '';
}

function find(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate));
  if (!node?.props) return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props.children, predicate)];
}

// Execute the real page and its effects against synthetic API responses, as in
// the other SWC UI tests. No network, browser storage, or clinical data is used.
function harness(relativePath, response) {
  let cursor = 0;
  let tree;
  const slots = [];
  const effects = [];
  const requests = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (value) => {
        slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
      }];
    },
    useEffect(callback) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {};
        effects.push(callback);
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'next/link': { __esModule: true, default: 'a' },
    'lucide-react': new Proxy({}, { get: (_, name) => `icon-${String(name)}` }),
    '@/components/ui/button': { Button: 'button' },
    '../../components/NgNav': { __esModule: true, default: 'nav' },
  };
  const filename = path.resolve(__dirname, '../..', relativePath);
  const code = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code;
  const sandboxModule = { exports: {} };
  vm.runInNewContext(code, {
    module: sandboxModule, exports: sandboxModule.exports,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; },
    localStorage: { getItem: () => 'synthetic' },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => response(url) };
    },
    setTimeout: () => {},
  });
  return {
    requests,
    render() {
      cursor = 0;
      tree = sandboxModule.exports.default();
      for (const effect of effects.splice(0)) effect();
      return tree;
    },
    async ready() {
      this.render();
      await new Promise((resolve) => setImmediate(resolve));
      return this.render();
    },
    card(key) {
      const cards = find(tree, (node) => node.type === 'div' && node.key === key);
      assert.equal(cards.length, 1, `Rendered card ${key}`);
      return cards[0];
    },
  };
}

for (const status of [undefined, 'active', 'connected', 'sandbox', 'pending', 'unavailable', 'unknown']) {
  test(`hospital lab remains unavailable with stored status ${status}`, async () => {
    const view = harness('app/ng/hospital/settings/page.js', (url) => url.endsWith('/integrations') ? {
      integrations: [
        { integration_type: 'lab_systems', status, last_sync_at: '2030-01-01T00:00:00Z', error_message: 'Synthetic stored lab status' },
        { integration_type: 'nhia_nhis', status: 'active', last_sync_at: '2030-01-01T00:00:00Z' },
      ],
    } : { hospital: { name: 'Synthetic facility', status: 'verified' } });
    await view.ready();
    let card = view.card('lab_systems');
    assert.match(text(card), /Unavailable/);
    assert.doesNotMatch(text(card), /Connected|Active|Sandbox|Coming Soon/);
    find(card, (node) => node.type === 'button')[0].props.onClick();
    view.render();
    card = view.card('lab_systems');
    assert.match(text(card), /no lab ordering, result ingestion, or automatic critical value alerts/);
    assert.match(text(card), /FHIR can read previously stored lab results/);
    assert.match(text(card), /Planned capabilities \(not live\)/);
    assert.doesNotMatch(text(card), /Last sync|Synthetic stored lab status|Critical values trigger automatic/);
    const links = find(card, (node) => node.type === 'a');
    assert.equal(links.length, 2);
    assert.ok(links.every((link) => link.props.href.startsWith('mailto:enterprise@doctarx.com?subject=Lab%20Integration%20Interest')));
    assert.match(text(view.card('nhia_nhis')), /Active.*Connected/);
    assert.equal(view.requests.length, 2);
    assert.ok(view.requests.every(({ options }) => !options?.method));
  });
}

for (const enabled of [true, false, 'true', 'active', 'connected', 'sandbox', null]) {
  test(`admin lab stays disabled with persisted enabled ${enabled}`, async () => {
    const view = harness('app/ng/admin/features/page.js', () => ({ flags: [
      { key: 'ng_lab_orders', enabled, status: 'active' },
      { key: 'ng_telemedicine_video', enabled: true },
    ] }));
    await view.ready();
    const card = view.card('ng_lab_orders');
    assert.match(text(card), /Unavailable/);
    assert.match(text(card), /no lab ordering, result ingestion, or automatic critical value alerts/);
    assert.match(text(card), /Planned, not live/);
    assert.doesNotMatch(text(card), /Q3 2026|Coming Soon/);
    const button = find(card, (node) => node.type === 'button')[0];
    assert.equal(button.props.disabled, true);
    assert.match(button.props.title, /not implemented/);
    assert.equal(find(card, (node) => node.type === 'icon-ToggleRight').length, 0);
    assert.equal(find(card, (node) => node.type === 'icon-ToggleLeft').length, 1);
    button.props.onClick(); // Guard also blocks direct invocation, not only DOM clicks.
    assert.equal(view.requests.length, 1);
    const video = view.card('ng_telemedicine_video');
    assert.equal(find(video, (node) => node.type === 'button')[0].props.disabled, false);
    assert.equal(find(video, (node) => node.type === 'icon-ToggleRight').length, 1);
  });
}


test('hospital data protection notice does not claim planned integrations are implemented or certified', async () => {
  const view = harness('app/ng/hospital/settings/page.js', (url) => url.endsWith('/integrations')
    ? { integrations: [] }
    : { hospital: { name: 'Synthetic facility', status: 'verified' } });
  const tree = await view.ready();
  const notices = find(tree, (node) => node.type === 'p' && text(node).includes('Planned integrations require'));
  assert.equal(notices.length, 1);
  assert.match(text(notices[0]), /security and privacy review and a data processing agreement before activation/);
  assert.match(text(notices[0]), /does not confirm that it is live/);
  assert.doesNotMatch(text(tree), /All integrations are implemented|TLS 1\.3|encrypted in transit|encrypted.*at rest/);
  const contact = find(notices[0], (node) => node.type === 'a');
  assert.equal(contact.length, 1);
  assert.equal(contact[0].props.href, 'mailto:compliance@doctarx.com');
  assert.equal(view.requests.length, 2);
});
