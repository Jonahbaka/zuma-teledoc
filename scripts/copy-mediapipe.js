#!/usr/bin/env node
/**
 * Copy MediaPipe selfie-segmentation assets to public/ so they are self-hosted
 * and do NOT depend on any external CDN (avoids CSP issues in production).
 *
 * Run manually:  node scripts/copy-mediapipe.js
 * Or automatically via the "postinstall" npm script.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'selfie_segmentation');
const DEST = path.join(__dirname, '..', 'public', 'mediapipe');

// Required files for selfie-segmentation to run in the browser
const REQUIRED_FILES = [
  'selfie_segmentation.js',
  'selfie_segmentation.binarypb',
  'selfie_segmentation.tflite',
  'selfie_segmentation_landscape.tflite',
  'selfie_segmentation_solution_simd_wasm_bin.js',
  'selfie_segmentation_solution_simd_wasm_bin.wasm',
  'selfie_segmentation_solution_simd_wasm_bin.data',
  'selfie_segmentation_solution_wasm_bin.js',
  'selfie_segmentation_solution_wasm_bin.wasm',
];

if (!fs.existsSync(SRC)) {
  console.warn('[copy-mediapipe] @mediapipe/selfie_segmentation not found — skipping.');
  process.exit(0);
}

if (!fs.existsSync(DEST)) {
  fs.mkdirSync(DEST, { recursive: true });
}

let copied = 0;
for (const file of REQUIRED_FILES) {
  const src = path.join(SRC, file);
  const dest = path.join(DEST, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const size = (fs.statSync(dest).size / 1024).toFixed(0);
    console.log(`  ✓ ${file} (${size} KB)`);
    copied++;
  } else {
    console.warn(`  ⚠ ${file} not found in package — skipping`);
  }
}

console.log(`\n[copy-mediapipe] Copied ${copied}/${REQUIRED_FILES.length} files to public/mediapipe/`);
