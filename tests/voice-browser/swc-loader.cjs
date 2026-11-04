'use strict';
// Uses the already-installed Next compiler. No runtime browser injection or
// additional package install is required to compile this test-only entry.
module.exports = function compileVoiceFixture(source) {
  const callback = this.async();
  require('next/dist/build/swc').transform(source, {
    filename: this.resourcePath,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } }, target: 'es2020' },
    module: { type: 'es6' },
  }).then(result => callback(null, result.code), callback);
};
