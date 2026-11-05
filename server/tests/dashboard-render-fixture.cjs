'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const jsx = require('react/jsx-runtime');
const helpers = require('../../lib/dashboard-workspace.cjs');
const root = path.join(__dirname, '../..');

function renderDashboard(kind, sections, { market = kind === 'patient' ? 'US' : 'us', view = 'today', loading = false } = {}) {
  const states = [sections, loading, 0, '2026-11-05T12:00:00Z'];
  let hook = 0;
  function compile(file) {
    const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const loaded = { exports: {} };
    vm.runInNewContext(output, { module: loaded, exports: loaded.exports, console, require(name) {
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'react') return { useState: () => [states[hook++], () => {}], useEffect() {} };
      if (name === 'next/link') return { __esModule: true, default: 'a' };
      if (name === 'lucide-react') return new Proxy({}, { get: () => 'svg' });
      if (name === '@/components/providers/AuthProvider') return { useAuth: () => ({ user: { id: 'fictional-user', firstName: 'Fictional' } }) };
      if (name === '@/components/dashboard/WorkspaceElements') return compile('components/dashboard/WorkspaceElements.jsx');
      if (name === '@/lib/dashboard-workspace.cjs') return helpers;
      if (name === '@/lib/utils') return { formatDateTime: value => String(value) };
      if (name === '@/components/ui/button') return { Button: 'button' };
      if (name === '@/lib/api') return {};
      throw new Error('Unexpected import: ' + name);
    } });
    return loaded.exports;
  }
  const component = compile(kind === 'patient' ? 'components/patient/PatientHome.jsx' : 'components/provider/NGProviderDashboard.jsx').default;
  const nodes = [], text = [];
  function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'string' || typeof node === 'number') { text.push(String(node)); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'function') { walk(node.type(node.props)); return; }
    nodes.push(node); walk(node.props?.children);
  }
  walk(component({ market, view }));
  return { nodes, text: text.join(' '), links: nodes.filter(node => node.type === 'a').map(node => node.props.href) };
}

module.exports = { renderDashboard };
