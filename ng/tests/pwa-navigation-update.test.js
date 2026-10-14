'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');

function metadataDocument() {
  const nodes = [];
  const head = { appendChild(node) { nodes.push(node); node.parentNode = head; } };
  function element(tag) {
    return { tag, attributes: {}, parentNode: null, setAttribute(key, value) { this.attributes[key] = value; }, remove() { throw new Error('React-owned metadata must not be detached'); } };
  }
  for (const href of ['/manifest.webmanifest', '/ng/manifest.webmanifest']) {
    const link = element('link'); link.setAttribute('rel', 'manifest'); link.setAttribute('href', href); head.appendChild(link);
  }
  const document = {
    head, createElement: element,
    querySelectorAll() { return nodes.filter(node => node.tag === 'link' && node.attributes.rel === 'manifest'); },
    querySelector(selector) {
      const name = /meta\[name="([^"]+)"/.exec(selector)?.[1];
      const rel = /link\[rel="([^"]+)"/.exec(selector)?.[1];
      return nodes.find(node => name ? node.tag === 'meta' && node.attributes.name === name : rel && node.tag === 'link' && node.attributes.rel === rel) || null;
    },
  };
  return { document, nodes };
}

test('PWA market navigation preserves Next-owned metadata nodes and uses the DoctaRx navy theme', () => {
  const { document, nodes } = metadataDocument();
  const originalLinks = [...document.querySelectorAll()];
  const source = fs.readFileSync(path.resolve(__dirname, '../../components/pwa/PwaBootstrap.jsx'), 'utf8');
  const start = source.indexOf('function syncInstallMetadata(');
  const end = source.indexOf('function isIOSLikeDevice()', start);
  const context = { document, window: { __doctarxPwaAssetVersion: 'checked-version' }, PWA_ASSET_VERSION: 'fallback' };
  vm.runInNewContext(source.slice(start, end) + '; globalThis.sync = syncInstallMetadata;', context);
  for (const route of ['/ng/pharmacies', '/ng', '/', '/pharmacies', '/ng/pharmacies', '/ng']) context.sync(route);
  assert.deepEqual(document.querySelectorAll(), originalLinks, 'React retains ownership of both temporary route links');
  for (const link of originalLinks) assert.equal(link.attributes.href, '/ng/manifest.webmanifest?v=checked-version');
  assert.equal(nodes.find(node => node.attributes.name === 'theme-color').attributes.content, '#0f172a');
  assert.equal(nodes.find(node => node.attributes.name === 'application-name').attributes.content, 'DoctaRx Nigeria');
  assert.equal(nodes.filter(node => node.attributes.name === 'theme-color').length, 1);
});

function updateView(responses, waiting) {
  const slots = [], effects = [], requests = [], timers = new Map(), intervals = [];
  const windowEvents = new Map(), workerEvents = new Map();
  let cursor = 0, dirty = false, tree, reloads = 0, storageCalls = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useRef(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: initial } }; return slots[index].value; },
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: initial }; return [slots[index].value, value => { slots[index].value = value; dirty = true; }]; },
    useEffect(callback) { const index = cursor++; if (!slots[index]) { slots[index] = {}; effects.push(() => { slots[index].cleanup = callback(); }); } },
  };
  const window = {
    location: { reload() { reloads++; } }, __doctarxPwaRuntime: waiting ? { registration: { waiting } } : null,
    addEventListener(name, callback) { windowEvents.set(name, callback); }, removeEventListener(name) { windowEvents.delete(name); },
  };
  Object.defineProperty(window, 'localStorage', { get() { storageCalls++; throw new Error('Clinical session storage must be preserved'); } });
  Object.defineProperty(window, 'sessionStorage', { get() { storageCalls++; throw new Error('Clinical draft storage must be preserved'); } });
  const serviceWorker = { addEventListener(name, callback) { workerEvents.set(name, callback); }, removeEventListener(name) { workerEvents.delete(name); } };
  const compiledModule = { exports: {} };
  const filename = path.resolve(__dirname, '../../components/providers/DeploymentVersionCheck.jsx');
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
  vm.runInNewContext(compiled, {
    module: compiledModule, exports: compiledModule.exports, require(name) { if (name === 'react') return react; if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }; throw new Error(name); },
    window, navigator: { serviceWorker }, document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    process: { env: { NEXT_PUBLIC_API_URL: 'http://api.example.invalid/api' } }, AbortController,
    async fetch(url, options) { requests.push({ url, options }); const next = responses.shift(); if (next instanceof Error) throw next; return { ok: next?.ok !== false, async json() { return next?.data || {}; } }; },
    setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {},
    setTimeout(callback) { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const view = {
    render() { do { cursor = 0; dirty = false; tree = compiledModule.exports.DeploymentVersionCheck(); for (const effect of effects.splice(0)) effect(); } while (dirty); return tree; },
    async flush() { await new Promise(resolve => setImmediate(resolve)); view.render(); },
    poll: () => intervals[0](),
    announce: () => windowEvents.get('doctarx:application-update')(),
    button() { function walk(node) { if (Array.isArray(node)) return node.map(walk).find(Boolean); if (node?.type === 'button') return node; return node?.props ? walk(node.props.children) : null; } return walk(tree); },
    unmount() { for (const slot of slots) slot.cleanup?.(); },
    requests, workerEvents, get reloads() { return reloads; }, get storageCalls() { return storageCalls; },
  };
  return view;
}

test('a verified deployment change offers refresh without clearing sessions or interrupting visits', async () => {
  const view = updateView([{ data: { buildId: 'version-a' } }, { data: { buildId: 'version-b' } }]);
  assert.equal(view.render(), null); await view.flush();
  await view.poll(); await view.flush();
  assert.ok(view.button()); assert.equal(view.reloads, 0); assert.equal(view.storageCalls, 0);
  assert.equal(view.requests[0].url, 'http://api.example.invalid/api/health');
  assert.equal(view.requests[0].options.cache, 'no-store');
  view.button().props.onClick(); view.render();
  assert.equal(view.reloads, 1); assert.equal(view.storageCalls, 0);
  view.unmount();
});

test('an outage, missing version or unknown placeholder cannot manufacture a deployment change', async () => {
  const view = updateView([{ data: { buildId: 'version-a' } }, new Error('Offline'), { data: {} }, { data: { version: 'unknown' } }, { ok: false, data: { buildId: 'version-b' } }]);
  view.render(); await view.flush();
  for (let index = 0; index < 4; index++) { await view.poll(); await view.flush(); assert.equal(view.render(), null); }
  assert.equal(view.reloads, 0); assert.equal(view.storageCalls, 0);
  view.unmount();
});

test('service-worker activation is announced and waits for explicit refresh and controller confirmation', async () => {
  const messages = [];
  const view = updateView([{ data: { buildId: 'version-a' } }], { postMessage(message) { messages.push(message); } });
  view.render(); await view.flush();
  view.announce(); view.render(); assert.equal(view.reloads, 0);
  view.button().props.onClick(); view.render();
  assert.equal(messages[0].type, 'SKIP_WAITING'); assert.equal(view.reloads, 0);
  view.workerEvents.get('controllerchange')();
  assert.equal(view.reloads, 1); assert.equal(view.storageCalls, 0);
  view.unmount();
});
