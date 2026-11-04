#!/usr/bin/env node
/**
 * scripts/generate-phc-visual-assets.cjs
 *
 * Generates the original DoctaRx PHC visual assets used by the public progress
 * page and the PHC workspace header.
 *
 * Provenance: these are hand-authored, original SVG compositions rendered to
 * PNG and WebP with sharp. No third-party or competitor artwork, photography,
 * branding, or screenshots are used, and no patient or staff information
 * appears in any asset. Readiness tables, clinical diagrams, and data charts
 * are deliberately NOT generated as images - they stay real HTML so they stay
 * accurate, accessible, and translatable.
 *
 *   node scripts/generate-phc-visual-assets.cjs
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'public', 'media', 'ng');

const PALETTE = {
  ink: '#0B1220',
  deep: '#0F2A33',
  teal: '#0E7490',
  emerald: '#10B981',
  mint: '#5EEAD4',
  indigo: '#4F46E5',
};

const HERO_DEFS = `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.deep}"/>
      <stop offset="52%" stop-color="#123A4A"/>
      <stop offset="100%" stop-color="#1B1F4B"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="${PALETTE.emerald}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${PALETTE.emerald}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="${PALETTE.indigo}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${PALETTE.indigo}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="linkStroke" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.mint}"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="${PALETTE.mint}"/>
    </linearGradient>
    <linearGradient id="nodeFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1B3A4B"/>
      <stop offset="100%" stop-color="#0B1A26"/>
    </linearGradient>
    <linearGradient id="nodeStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${PALETTE.mint}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${PALETTE.emerald}" stop-opacity="0.5"/>
    </linearGradient>
    <linearGradient id="nodeSheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <pattern id="dotGrid" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.6" fill="#FFFFFF" fill-opacity="0.07"/>
    </pattern>
    <filter id="blurBig" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="70"/>
    </filter>
    <filter id="softShadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#020617" flood-opacity="0.55"/>
    </filter>
  </defs>`;

const HERO_NODES = [
  { x: 250, y: 300 },
  { x: 250, y: 640 },
  { x: 1350, y: 300 },
  { x: 1350, y: 640 },
];

const HERO_LINKS = [
  { d: 'M 324 300 C 620 210, 980 210, 1276 300', strong: true },
  { d: 'M 324 640 C 620 730, 980 730, 1276 640', strong: true },
  { d: 'M 324 300 C 520 400, 700 470, 800 470', strong: false },
  { d: 'M 1276 300 C 1080 400, 900 470, 800 470', strong: false },
];

function heroNodesMarkup() {
  return HERO_NODES.map((node, index) => `
    <g filter="url(#softShadow)">
      <rect x="${node.x - 74}" y="${node.y - 74}" width="148" height="148" rx="42"
            fill="url(#nodeFill)" stroke="url(#nodeStroke)" stroke-width="2"/>
      <rect x="${node.x - 74}" y="${node.y - 74}" width="148" height="60" rx="42"
            fill="url(#nodeSheen)" opacity="0.5"/>
      <circle cx="${node.x}" cy="${node.y}" r="30" fill="none"
              stroke="${index % 2 ? PALETTE.mint : PALETTE.emerald}" stroke-width="3" opacity="0.85"/>
      <path d="M ${node.x - 14} ${node.y} h 12 l 7 -18 l 9 36 l 7 -18 h 12"
            fill="none" stroke="#ECFDF5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`).join('');
}

function heroLinksMarkup() {
  return HERO_LINKS.map((link) => `
    <path d="${link.d}" fill="none" stroke="url(#linkStroke)"
          stroke-width="${link.strong ? 4 : 2.5}" stroke-linecap="round"
          stroke-dasharray="${link.strong ? '14 12' : '6 14'}"
          opacity="${link.strong ? 0.9 : 0.55}"/>`).join('');
}

function heroSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img">
  ${HERO_DEFS}

  <rect width="1600" height="900" fill="url(#bg)"/>
  <rect width="1600" height="900" fill="url(#dotGrid)"/>
  <circle cx="380" cy="220" r="380" fill="url(#glowA)" filter="url(#blurBig)"/>
  <circle cx="1240" cy="700" r="420" fill="url(#glowB)" filter="url(#blurBig)"/>
  <path d="M 0 760 C 400 690, 760 830, 1180 740 C 1380 690, 1520 720, 1600 700 L 1600 900 L 0 900 Z"
        fill="#071722" fill-opacity="0.75"/>
  ${heroLinksMarkup()}
  ${heroNodesMarkup()}
  <g filter="url(#softShadow)">
    <rect x="632" y="386" width="336" height="168" rx="56" fill="url(#nodeFill)"
          stroke="url(#nodeStroke)" stroke-width="2"/>
    <rect x="632" y="386" width="336" height="70" rx="56" fill="url(#nodeSheen)" opacity="0.45"/>
    <path d="M 690 470 h 44 l 20 -56 l 30 112 l 22 -56 h 44"
          fill="none" stroke="#A7F3D0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <circle cx="800" cy="470" r="150" fill="none" stroke="${PALETTE.emerald}" stroke-opacity="0.18" stroke-width="2"/>
  <circle cx="800" cy="470" r="210" fill="none" stroke="${PALETTE.emerald}" stroke-opacity="0.10" stroke-width="2"/>
</svg>`;
}

function ribbonSvg() {
  const nodes = [
    { x: 220, y: 268, r: 15, color: PALETTE.emerald },
    { x: 560, y: 322, r: 11, color: PALETTE.mint },
    { x: 900, y: 272, r: 15, color: PALETTE.emerald },
    { x: 1240, y: 246, r: 11, color: PALETTE.mint },
    { x: 1520, y: 196, r: 15, color: PALETTE.emerald },
  ].map((node) => `<circle cx="${node.x}" cy="${node.y}" r="${node.r}" fill="${PALETTE.ink}"`
    + ` stroke="${node.color}" stroke-width="4"/>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="420" viewBox="0 0 1600 420" role="img">
  <defs>
    <linearGradient id="band1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.emerald}" stop-opacity="0.85"/>
      <stop offset="50%" stop-color="${PALETTE.mint}" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="${PALETTE.indigo}" stop-opacity="0.8"/>
    </linearGradient>
    <linearGradient id="band2" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${PALETTE.mint}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${PALETTE.teal}" stop-opacity="0.45"/>
    </linearGradient>
    <filter id="blurBand" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="34"/>
    </filter>
  </defs>
  <rect width="1600" height="420" fill="${PALETTE.ink}"/>
  <g filter="url(#blurBand)" opacity="0.55">
    <path d="M -40 300 C 320 180, 620 380, 940 250 C 1220 136, 1420 250, 1640 160 L 1640 460 L -40 460 Z"
          fill="url(#band2)"/>
  </g>
  <path d="M -40 300 C 320 180, 620 380, 940 250 C 1220 136, 1420 250, 1640 160"
        fill="none" stroke="url(#band1)" stroke-width="5" stroke-linecap="round"/>
  <path d="M -40 352 C 340 250, 640 420, 960 300 C 1240 198, 1440 300, 1640 220"
        fill="none" stroke="${PALETTE.emerald}" stroke-opacity="0.4" stroke-width="3"
        stroke-linecap="round" stroke-dasharray="18 16"/>
  ${nodes}
</svg>`;
}

const ASSETS = [
  { name: 'fct-assessment-hero', svg: heroSvg, width: 1600 },
  { name: 'phc-workspace-ribbon', svg: ribbonSvg, width: 1600 },
];

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[visuals] Rendering ${ASSETS.length} original asset(s) into ${OUT_DIR}\n`);

  for (const asset of ASSETS) {
    const svg = asset.svg();
    const buffer = Buffer.from(svg);
    const png = await sharp(buffer, { density: 144 })
      .png({ compressionLevel: 9, palette: true, quality: 88, effort: 9 })
      .toBuffer();
    const webp = await sharp(buffer, { density: 144 }).webp({ quality: 80, effort: 6 }).toBuffer();

    fs.writeFileSync(path.join(OUT_DIR, `${asset.name}.svg`), svg, 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, `${asset.name}.png`), png);
    fs.writeFileSync(path.join(OUT_DIR, `${asset.name}.webp`), webp);

    console.log(`  ${asset.name.padEnd(24)} ${asset.width}px  png ${kb(png.length)}  webp ${kb(webp.length)}`);
  }

  console.log('\n[visuals] Done. Charts and clinical diagrams intentionally remain HTML, not generated images.');
})().catch((error) => {
  console.error('[visuals] Generation failed:', error);
  process.exit(1);
});
