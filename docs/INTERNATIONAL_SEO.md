# International search discovery

The public sitemap contains reviewed editorial entrypoints, the real public
directories, five language versions of the international overview, and three
product-use guides. It excludes account, clinical, payment and operational
routes. Adding an indexable page requires a real route, unique metadata,
self-canonical URL and an entry in lib/seo/public-seo-config.cjs.

## Content and language boundaries

- International overview: /international (English), /international/es,
  /international/fr, /international/pt and /international/ar.
- These pages translate information, not the authenticated application. Each
  has server-rendered content, its own canonical, reciprocal language links
  and x-default. Arabic content uses an explicit lang and RTL direction;
  the shared English site shell retains its English language declaration.
- The US and Nigerian homepages form a separate regional alternate cluster.
  The overview is not falsely declared a translation of the homepage.
- No IP or browser-language redirects force users or crawlers into a market.
- Clinical availability, licensing, pharmacy inventory and interpretation
  must be confirmed locally. These pages do not promise worldwide treatment.
- Guides identify DoctaRx as the organizational author and do not invent
  clinician reviewers, clinical credentials, ratings or publication dates.
  Qualified editorial review is required before adding treatment guidance.
- Have native-language editors review translations as content evolves.

## Crawling and privacy

Robots allows rendering assets and retrieval of noindex responses. Both Next
middleware and the custom Express server set X-Robots-Tag on non-editorial
routes. Unknown query parameters are excluded to keep account identifiers,
search details and token URLs out of indexing. Recognized marketing attribution
parameters retain the clean canonical.

Robots and noindex are not authentication. Existing access checks, private
document handling and encryption remain the security boundary. Do not add
patient/provider document URLs to a sitemap. Do not submit private URLs to
external validation services.

For preview deployments set DOCTARX_SEO_NOINDEX=true before building and serving.
Keep previews behind authentication as appropriate. Leave the flag unset for
the approved public production site. CareOps retains its separate noindex
profile and its own robots/sitemap behavior.

## Verification and launch

1. Run node scripts/generate-public-seo.js and
   node --test server/tests/public-seo.test.js.
2. Run npm run lint, type checking and npm run build.
3. Run node scripts/verify-public-seo.cjs with CHROME_PATH pointing at an existing
   Chrome installation, or with an existing Playwright Chromium. It starts
   a temporary production server on loopback, crawls every sitemap page,
   verifies canonical/language/header/404 behavior, and checks new editorial
   pages at mobile and desktop widths with Axe. Results go to artifacts/seo.
4. The public-repository readiness workflow repeats these checks; it does not
   deploy. Existing whole-release deployment quarantine still applies.
5. After an authorized, verified release, verify the doctarx.com property in
   Google Search Console and Bing Webmaster Tools. Existing DNS ownership
   verification can be retained. For HTML verification, set the actual provided
   GOOGLE_SITE_VERIFICATION and BING_SITE_VERIFICATION values before building.
   These are public verification tokens, not API keys. Never invent them.
6. Submit https://doctarx.com/sitemap.xml in both verified properties. Inspect
   representative public English/translated URLs and monitor indexing,
   canonical selection, country/language impressions and Core Web Vitals.
   Do not submit account, search-query or clinical URLs.

No search-console ownership or sitemap submission is claimed by this change.
Search engines determine indexing and rankings. No indexing API, backlink
scheme, hidden text, fabricated locality page or AI-specific file is required.
The sitemap omits lastmod until a real editorial update date is recorded;
build time is not an editorial update.

Official guidance:
- https://developers.google.com/search/docs/specialty/international/localized-versions
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- https://developers.google.com/search/docs/appearance/ai-features
