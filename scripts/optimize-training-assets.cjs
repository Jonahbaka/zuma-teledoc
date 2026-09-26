#!/usr/bin/env node
/**
 * scripts/optimize-training-assets.cjs
 *
 * The PHC training illustrations ship inside the nurse field guide, which is
 * used on the same low-bandwidth, intermittently powered connections the FCT
 * PHCB assessment described. The source PNGs were ~2 MB each (~16 MB total),
 * which is not acceptable for that audience.
 *
 * This script re-encodes every training illustration in place, keeping the
 * original dimensions and filenames, and also emits a WebP variant that the
 * component serves first with the PNG as fallback.
 *
 *   node scripts/optimize-training-assets.cjs
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIR = path.join(__dirname, '..', 'public', 'images', 'training');
const WEBP_WIDTH = 1024;
const WEBP_QUALITY = 72;
const PNG_QUALITY = 82;

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function optimizeOne(file) {
  const source = path.join(DIR, file);
  const stem = file.replace(/\.png$/i, '');
  const before = fs.statSync(source).size;

  const image = sharp(source, { failOn: 'none' }).rotate();
  const meta = await image.metadata();

  // Re-encode the PNG in place: palette quantization keeps these flat-shaded
  // illustrations visually identical at a fraction of the weight.
  const pngBuffer = await image
    .clone()
    .png({ quality: PNG_QUALITY, palette: true, effort: 9, compressionLevel: 9 })
    .toBuffer();
  fs.writeFileSync(source, pngBuffer);

  const webpBuffer = await image
    .clone()
    .resize({ width: Math.min(WEBP_WIDTH, meta.width), withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer();
  fs.writeFileSync(path.join(DIR, `${stem}.webp`), webpBuffer);

  return {
    file,
    dimensions: `${meta.width}x${meta.height}`,
    before,
    pngAfter: pngBuffer.length,
    webp: webpBuffer.length,
  };
}

(async () => {
  if (!fs.existsSync(DIR)) {
    console.error(`[assets] Missing directory: ${DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.png'));
  if (!files.length) {
    console.log('[assets] No PNG training assets found.');
    return;
  }

  console.log(`[assets] Optimizing ${files.length} training illustration(s) in ${DIR}\n`);
  let beforeTotal = 0;
  let afterTotal = 0;
  let webpTotal = 0;

  for (const file of files.sort()) {
    const result = await optimizeOne(file);
    beforeTotal += result.before;
    afterTotal += result.pngAfter;
    webpTotal += result.webp;
    console.log(
      `  ${file.padEnd(30)} ${result.dimensions}  `
      + `${kb(result.before)} -> png ${kb(result.pngAfter)} / webp ${kb(result.webp)}`
    );
  }

  console.log(
    `\n[assets] Total: ${kb(beforeTotal)} -> ${kb(afterTotal)} as PNG `
    + `(${((1 - afterTotal / beforeTotal) * 100).toFixed(1)}% smaller); `
    + `${kb(webpTotal)} served as WebP (${((1 - webpTotal / beforeTotal) * 100).toFixed(1)}% smaller than before).`
  );
})().catch((error) => {
  console.error('[assets] Optimization failed:', error);
  process.exit(1);
});
