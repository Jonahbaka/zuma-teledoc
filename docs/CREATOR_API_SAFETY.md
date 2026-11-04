# Legacy creator API containment

The creator namespace is unavailable until real authenticated, owner-scoped capabilities exist. This is a safety boundary, not a publishing implementation or a working content library.

## Confirmed baseline defects

At baseline `0f3ed4f`, a local VM reproduction with fictional in-memory files demonstrated:

- Unauthenticated `POST /api/creator/publish` returned HTTP 200, `success: true`, a fabricated LinkedIn URL/post ID, and `status: published` without calling a provider.
- A supplied `videoId: ../../victim` read and overwrote a fictional JSON file outside `public/uploads/creator`.
- Unauthenticated `GET /api/creator/content` returned another fictional owner's private metadata.
- `GET /api/creator/analytics` returned fixed invented totals. Upload, generation and schedule operations also reported unsupported work as successful.
- Importing the route created a directory in the public asset tree. Metadata had no verified owner association.

The reproduction did not access production data, publish externally, or connect to a database.

## Current behavior

- Every request under `/api/creator` passes the existing session authentication middleware. Unauthenticated callers receive its normal rejection. Authenticated callers receive HTTP 503, `success: false`, and `code: CREATOR_UNAVAILABLE`.
- The namespace does not inspect request-controlled IDs or filenames, read or write legacy files, create directories, access providers, claim an upload/generation/schedule, generate receipts, return content lists, or invent analytics. Environment flags cannot enable a mock implementation.
- Responses use `Cache-Control: private, no-store`.
- Both the custom Express server and standalone Next entrypoint deny `/uploads/creator` and its descendants before static file handling. The shared policy handles encoded/normalized paths and HTTP absolute-form request targets. Unrelated uploads and pages retain their existing behavior.
- Historical files are neither read nor deleted by this change. Ownerless JSON must not be automatically imported as trusted user content or publication evidence.

## Verification

`node --test server/tests/creator-api-safety.test.js` exercises the actual router with a recording authentication boundary, all seven original operations, unknown methods/paths, unauthenticated and two distinct authenticated actors, malicious/malformed inputs, and a dependency trap prohibiting storage or provider imports. It also runs actual local Express HTTP/static fixtures and the standalone middleware with the real NextResponse implementation. It is included in `npm test`.

The independent reviewer found and reproduced an absolute-form target bypass in the initial Express guard. The correction checks Express's parsed path and normalizes absolute-form URLs; dedicated regressions cover it.

Focused tests and changed-file lint pass. These are not substitutes for the final integrated production build and deployment acceptance. No production deployment, real-provider publishing, browser acceptance, historical-data migration, or external-cache invalidation was performed. The repository-required `promptpay-zuma-operator` skill was unavailable in the provided checkout/catalog; repository instructions and current safety guidance were followed.

## Release and future implementation boundaries

The final integrated build must include the root Next middleware and the early Express guard. Existing reverse proxies/CDNs must not independently serve the historical creator directory; the checked-in Nginx configuration proxies requests to the app, but no live proxy configuration was inspected. Previously cached/publicly retrieved copies cannot be recalled by this patch. Any historical-data review, quarantine or migration needs separate operator verification and authorization.

Re-enabling the feature requires private owner-scoped storage, server-issued content identifiers, real upload validation and processing, verified provider integrations and receipts, durable scheduling, honest analytics, and tests proving cross-user isolation. Merely adding credentials or an environment switch is insufficient.
