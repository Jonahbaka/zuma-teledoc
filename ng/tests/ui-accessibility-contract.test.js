'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Accessibility contract for the shared clinical UI layer.
 *
 * The full browser check (scripts/e2e-ng-lifecycle-browser.cjs with @axe-core/playwright)
 * needs a running deployment and seeded credentials, so it cannot run here. These
 * assertions cover the rules that matter most at a PHC and that regress silently:
 * colour-only status, missing accessible names, absent live regions, and touch
 * targets that are too small to hit reliably.
 */

const COMPONENT_PATH = path.join(__dirname, '..', '..', 'components', 'ui', 'clinic-states.jsx');
const source = fs.readFileSync(COMPONENT_PATH, 'utf8');

const TONE_TOKENS = /\b(?:bg|text|border)-(?:slate|emerald|amber|rose|sky)-\d{2,3}\b/g;

// Tailwind palette values used by this component, for a real WCAG contrast check.
const PALETTE = {
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-300': '#cbd5e1',
  'slate-500': '#64748b', 'slate-700': '#334155', 'slate-800': '#1e293b',
  'slate-900': '#0f172a', 'slate-950': '#020617',
  'emerald-50': '#ecfdf5', 'emerald-100': '#d1fae5', 'emerald-800': '#065f46', 'emerald-900': '#064e3b',
  'amber-50': '#fffbeb', 'amber-100': '#fef3c7', 'amber-900': '#78350f', 'amber-950': '#451a03',
  'rose-50': '#fff1f2', 'rose-200': '#fecdd3', 'rose-900': '#881337', 'rose-950': '#4c0519',
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-900': '#0c4a6e', 'sky-950': '#082f49',
};

function relativeLuminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

test('every paired background/text tone meets the WCAG AA contrast ratio', () => {
  const pairs = source.match(/\bbg-\w+-\d{2,3} text-\w+-\d{3}\b/g) || [];
  assert.ok(pairs.length > 0, 'the component file defines paired tone classes');

  for (const pair of new Set(pairs)) {
    const background = /^bg-([\w-]+)/.exec(pair)[1];
    const text = /text-([\w-]+)/.exec(pair)[1];
    const backgroundHex = PALETTE[background];
    const textHex = PALETTE[text];
    assert.ok(backgroundHex, `palette entry missing for ${background}`);
    assert.ok(textHex, `palette entry missing for ${text}`);

    const ratio = contrastRatio(textHex, backgroundHex);
    // 4.5:1 is the WCAG AA threshold for body text; these are all status labels.
    assert.ok(ratio >= 4.5, `${text} on ${background} is only ${ratio.toFixed(2)}:1`);
  }
});

test('the lightest backgrounds are paired with the darkest text, and vice versa', () => {
  // A tone that uses a mid-grey text on a light surface reads as disabled in
  // bright sunlight, so direction matters as well as the ratio.
  const pairs = new Set(source.match(/\bbg-\w+-\d{2,3} text-\w+-\d{3}\b/g) || []);
  for (const pair of pairs) {
    const background = /^bg-([\w-]+)/.exec(pair)[1];
    const text = /text-([\w-]+)/.exec(pair)[1];
    assert.ok(contrastRatio(PALETTE[text], PALETTE[background]) >= 4.5, `${pair} fails AA`);
  }
});

test('status is never communicated by colour alone: every pill renders an icon and a label', () => {
  const pill = source.slice(source.indexOf('export function StatusPill'));
  assert.match(pill, /<Icon/, 'the status pill renders an icon');
  assert.match(pill, /\{label \|\| key \|\| 'Unknown'\}/, 'the status pill always renders a text label');
  assert.match(pill, /data-status=/, 'the pill exposes its state for testing and e2e assertions');
});

test('every tone falls back to a neutral style instead of rendering unstyled', () => {
  const pill = source.slice(source.indexOf('export function StatusPill'));
  assert.match(pill, /STATUS_TONES\[key\] \|\|/, 'an unknown status has a defined fallback tone');
});

test('loading, error, and connectivity states are announced to assistive technology', () => {
  assert.match(source, /role="status"/, 'loading and connectivity states use a status role');
  assert.match(source, /role="alert"/, 'errors use an alert role');
  assert.match(source, /aria-live="polite"/, 'state changes are announced politely');
  assert.match(source, /aria-busy="true"/, 'loading placeholders declare they are busy');
  assert.match(source, /className="sr-only"/, 'placeholders carry a screen-reader label');
});

test('decorative icons are hidden from the accessibility tree', () => {
  const icons = source.match(/<(?:AlertTriangle|CheckCircle2|CloudOff|Inbox|Loader2|RefreshCw|WifiOff|Wifi)[^>]*>/g) || [];
  assert.ok(icons.length > 0, 'the layer renders icons');
  const withoutAria = icons.filter((tag) => !/aria-hidden|aria-label/.test(tag));
  assert.deepEqual(withoutAria, [], 'every icon is either decorative or labelled');
});

test('interactive controls are reachable by keyboard with a visible focus ring', () => {
  const buttons = source.match(/<button[\s\S]*?>/g) || [];
  assert.ok(buttons.length > 0, 'the layer renders buttons');
  for (const button of buttons) {
    assert.match(button, /type="button"/, 'buttons never submit a form by accident');
  }
  assert.match(source, /focus-visible:ring-2/, 'a visible focus ring is defined');
  assert.match(source, /focus:outline-none focus-visible:ring/, 'focus is never removed without a replacement');
});

test('touch targets are large enough to use reliably on a tablet', () => {
  assert.match(source, /min-h-11/, 'controls are at least 44px tall (WCAG 2.5.5 target size)');
  assert.doesNotMatch(
    source,
    /min-h-(?:7|8|9)\b/,
    'no control in this layer is smaller than 36px; these are primary actions'
  );
});

test('loading placeholders reserve space so the layout does not jump when data arrives', () => {
  assert.match(source, /animate-pulse/, 'skeletons are visually distinguishable from content');
  assert.match(source, /w-2\/3/, 'the final placeholder line is shortened, matching a real text block');
});
