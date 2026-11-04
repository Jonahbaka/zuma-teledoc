'use strict';
const path = require('node:path');
const webpack = require('webpack');
const ROOT = path.resolve(__dirname, '../..');
async function buildFixture() {
  const outputPath = path.join(ROOT, 'artifacts/voice-browser/bundle');
  await new Promise((resolve, reject) => {
    const compiler = webpack({ mode: 'development', devtool: false, cache: false, target: 'web',
      entry: path.join(__dirname, 'entry.jsx'), output: { path: outputPath, filename: 'fixture.js', clean: true },
      resolve: { extensions: ['.js', '.jsx', '.cjs'], alias: { '@/lib/voice/voiceLiveApi': path.join(__dirname, 'fixture-api.cjs'), '@': ROOT } },
      module: { rules: [{ test: /\.jsx?$/, exclude: /node_modules/, use: path.join(__dirname, 'swc-loader.cjs') }] },
      optimization: { minimize: false },
    });
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error || closeError || stats?.hasErrors()) reject(error || closeError || new Error(stats.toString({ all: false, errors: true })));
        else resolve();
      });
    });
  });
  return outputPath;
}
if (require.main === module) buildFixture().then(result => console.log(`Synthetic browser fixture compiled: ${result}`)).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildFixture };
