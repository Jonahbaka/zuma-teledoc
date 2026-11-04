'use strict';

// These historical files were created without owner binding in a public
// directory. They must not be served, even after the legacy API is disabled.
// This helper has no Node-only dependencies so both HTTP entrypoints can use it.
function isLegacyCreatorAssetPath(rawPath) {
  let candidate = String(rawPath || '').split('?')[0].split('#')[0];
  // HTTP permits absolute-form request targets. Express serves their pathname,
  // so treating the scheme or host as a path segment would bypass this guard.
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) {
    try { candidate = new URL(candidate).pathname; } catch { return false; }
  }
  // Account for encoded separators and proxy normalization without an unbounded
  // decoding loop. Check each representation before attempting another decode.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const segments = [];
    for (const segment of candidate.replace(/\\/g, '/').split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') segments.pop();
      else segments.push(segment.toLowerCase());
    }
    if (segments[0] === 'uploads' && segments[1] === 'creator') return true;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch { break; }
  }
  return false;
}

module.exports = { isLegacyCreatorAssetPath };
