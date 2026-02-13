#!/usr/bin/env node
/**
 * Copy @mediapipe/tasks-vision WASM runtime to public/ so everything is
 * self-hosted.  Zero CDN dependencies → zero CSP issues.
 *
 * Also downloads the selfie-segmenter TFLite model from Google's model hub
 * if it doesn't already exist locally.
 *
 * Run manually:  node scripts/copy-mediapipe.js
 * Runs automatically via npm "prebuild" and "postinstall".
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const WASM_SRC = path.join(__dirname, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const WASM_DEST = path.join(__dirname, '..', 'public', 'mediapipe-wasm');
const MODEL_DIR = path.join(__dirname, '..', 'public', 'mediapipe-models');
const MODEL_FILE = path.join(MODEL_DIR, 'selfie_segmenter.tflite');
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

// ── Copy WASM files ──
function copyWasm() {
  if (!fs.existsSync(WASM_SRC)) {
    console.warn('[copy-mediapipe] @mediapipe/tasks-vision not found — skipping WASM copy.');
    return 0;
  }
  if (!fs.existsSync(WASM_DEST)) fs.mkdirSync(WASM_DEST, { recursive: true });

  const files = fs.readdirSync(WASM_SRC).filter(f => f.endsWith('.js') || f.endsWith('.wasm'));
  let copied = 0;
  for (const file of files) {
    fs.copyFileSync(path.join(WASM_SRC, file), path.join(WASM_DEST, file));
    const kb = (fs.statSync(path.join(WASM_DEST, file)).size / 1024).toFixed(0);
    console.log(`  WASM  ${file} (${kb} KB)`);
    copied++;
  }
  return copied;
}

// ── Download model file ──
function downloadModel() {
  return new Promise((resolve) => {
    if (fs.existsSync(MODEL_FILE)) {
      const kb = (fs.statSync(MODEL_FILE).size / 1024).toFixed(0);
      console.log(`  MODEL selfie_segmenter.tflite already exists (${kb} KB) — skipping download`);
      resolve(true);
      return;
    }
    if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });

    console.log('  MODEL downloading selfie_segmenter.tflite ...');
    const file = fs.createWriteStream(MODEL_FILE);
    
    const request = (url) => {
      https.get(url, (response) => {
        // Follow redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          console.warn(`  MODEL download failed (HTTP ${response.statusCode}) — virtual backgrounds will use fallback`);
          file.close();
          try { fs.unlinkSync(MODEL_FILE); } catch {}
          resolve(false);
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          const kb = (fs.statSync(MODEL_FILE).size / 1024).toFixed(0);
          console.log(`  MODEL selfie_segmenter.tflite downloaded (${kb} KB)`);
          resolve(true);
        });
      }).on('error', (err) => {
        console.warn(`  MODEL download error: ${err.message} — virtual backgrounds will use fallback`);
        file.close();
        try { fs.unlinkSync(MODEL_FILE); } catch {}
        resolve(false);
      });
    };
    
    request(MODEL_URL);
  });
}

// ── Main ──
async function main() {
  console.log('[copy-mediapipe] Setting up MediaPipe assets...');
  const wasmCount = copyWasm();
  const modelOk = await downloadModel();
  console.log(`[copy-mediapipe] Done. WASM files: ${wasmCount}, Model: ${modelOk ? 'OK' : 'SKIPPED'}`);
}

main().catch((err) => {
  console.warn('[copy-mediapipe] Error:', err.message);
  // Never fail the build — virtual backgrounds are optional
  process.exit(0);
});
