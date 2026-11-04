'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('CronOps locks exactly its declared dependency ranges to registry artifacts with integrity', () => {
  const manifest = JSON.parse(read('cronops/package.json'));
  const lock = JSON.parse(read('cronops/package-lock.json'));
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies);
  assert.equal(manifest.devDependencies.typescript, '^5.4.5');
  assert.equal(manifest.devDependencies['ts-node'], '^10.9.2');
  assert.equal(lock.packages['node_modules/typescript'].version, '5.9.3');
  assert.equal(lock.packages['node_modules/ts-node'].version, '10.9.2');
  for (const [name, dependency] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.ok(name.startsWith('node_modules/'), name);
    assert.ok(dependency.resolved.startsWith('https://registry.npmjs.org/'), name);
    assert.match(dependency.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/, name);
  }
});

test('CronOps typecheck cannot fall through to root or global tsc; application runtime commands are unchanged', () => {
  const { scripts } = JSON.parse(read('cronops/package.json'));
  assert.equal(scripts.typecheck, 'node ./node_modules/typescript/bin/tsc --noEmit');
  assert.equal(scripts.start, 'ts-node --project tsconfig.json index.ts');
  assert.equal(scripts['start:prod'], 'ts-node --project tsconfig.json --transpile-only index.ts');
  assert.equal(scripts.dev, 'CRONOPS_DRY_RUN=true ts-node --project tsconfig.json index.ts');
  assert.equal(scripts['run-task'], 'ts-node --project tsconfig.json scripts/run-task.ts');
  const { compilerOptions } = JSON.parse(read('cronops/tsconfig.json'));
  assert.equal(compilerOptions.module, 'commonjs'); assert.equal(compilerOptions.moduleResolution, 'node');
  assert.equal(compilerOptions.ignoreDeprecations, undefined);
});

test('pg query/write generic correction erases without changing the emitted runtime implementation', () => {
  const corrected = read('cronops/services/db.ts');
  for (const method of ['query', 'write']) assert.ok(corrected.includes(`${method}<T extends QueryResultRow = Record<string, unknown>>`));
  const prior = corrected.replace(', QueryResultRow }', ' }').replaceAll('T extends QueryResultRow =', 'T =');
  const emit = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  assert.equal(emit(corrected), emit(prior));
});
