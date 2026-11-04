'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../app/(dashboard)/provider/appointments/[id]/visit/page.js'), 'utf8');

test('legacy visit editor keeps failed reads distinct from an explicitly absent note', () => {
  assert.doesNotMatch(source, /api\.get\(`\/visits\/appointment\/\$\{appointmentId\}`\)\.catch/);
  assert.match(source, /!visitRes\.data\?\.success/);
  assert.match(source, /hasOwnProperty\.call\(visitRes\.data, 'visit'\)/);
  assert.match(source, /setLoadError\(true\)/);
  assert.ok(source.indexOf('if (loadError)') < source.indexOf('{/* Header */}'));
  assert.match(source, /Existing notes must load before editing/);
  assert.match(source, /onClick=\{fetchAppointmentAndVisit\}>Try again/);
  assert.match(source, /if \(loading \|\| loadError \|\| saving \|\| !appointment \|\| readOnly\) return/);
});

test('changing the appointment remounts the note editor rather than reusing another patient draft', () => {
  assert.match(source, /return <ProviderVisitEditor key=\{params\.id\} \/>/);
  assert.match(source, /function ProviderVisitEditor\(\)/);
  assert.match(source, /setSubjective\(v\.subjective \|\| ''\)/);
  assert.match(source, /setPlan\(v\.plan \|\| ''\)/);
});

const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const compiled = ts.transpileModule(source + '\nexport { ProviderVisitEditor };', {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function renderEditor(visit, { loading = false, loadError = false } = {}) {
  let hook = 0, writes = 0;
  const states = [loading, false, loadError, { id: 'appointment', patientFirstName: 'Synthetic' }, visit];
  const loaded = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, console,
    require(name) {
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'react') return { useState: initial => [hook < states.length ? states[hook++] : (hook++, initial), () => {}], useEffect() {} };
      if (name === 'next/navigation') return { useParams: () => ({ id: 'appointment' }), usePathname: () => '/provider/appointments/appointment/visit', useRouter: () => ({ push() {} }) };
      if (name === 'lucide-react') return new Proxy({}, { get: () => 'span' });
      if (name === '@/lib/api') return { __esModule: true, default: { async post() { writes++; }, async put() { writes++; } } };
      if (name === '@/lib/providerPortal') return { toProviderPortalPath: value => value };
      if (name === '@/components/ui/use-toast') return { toast() {} };
      if (name.startsWith('@/components/ui/')) return new Proxy({}, { get: (_object, key) => key === 'Button' ? 'button' : key === 'Input' ? 'input' : key === 'Label' ? 'label' : 'div' });
      return { __esModule: true, default: 'div' };
    },
  });
  const nodes = [];
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    nodes.push(node); walk(node.props?.children);
  }
  walk(loaded.exports.ProviderVisitEditor());
  return { nodes, writes: () => writes };
}

test('rendered signed and locked notes visibly prevent edits and save/sign actions', async () => {
  for (const visit of [{ id: 'note', isSigned: true }, { id: 'note', isLocked: true }]) {
    const rendered = renderEditor(visit);
    const actions = rendered.nodes.filter(node => node.type === 'button' && node.props.onClick);
    assert.equal(actions.length, 2);
    for (const action of actions) { assert.equal(action.props.disabled, true); await action.props.onClick(); }
    assert.equal(rendered.writes(), 0);
    const fields = rendered.nodes.filter(node => ['input', 'textarea'].includes(node.type));
    assert.ok(fields.length >= 13);
    for (const field of fields) assert.equal(field.props.type === 'checkbox' ? field.props.disabled : field.props.readOnly, true);
    assert.ok(rendered.nodes.some(node => node.props?.role === 'status' && String(node.props.children).includes('read-only')));
  }
});

test('rendered unsigned notes remain editable, while unavailable reads do not render editing or saving controls', () => {
  const draft = renderEditor({ id: 'note', isSigned: false, isLocked: false });
  for (const node of draft.nodes.filter(node => node.type === 'button' && node.props.onClick)) assert.equal(node.props.disabled, false);
  assert.ok(draft.nodes.some(node => node.type === 'textarea' && node.props.readOnly === false));
  for (const state of [{ loading: true }, { loadError: true }]) {
    const unavailable = renderEditor(null, state);
    assert.equal(unavailable.nodes.filter(node => ['input', 'textarea'].includes(node.type)).length, 0);
    assert.equal(unavailable.nodes.filter(node => node.type === 'button' && node.props.children !== 'Try again').length, 0);
  }
});
