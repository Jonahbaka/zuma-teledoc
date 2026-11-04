# Express Sentry startup and export safety

## Scope

This change fixes the Express API's installed `@sentry/node` 10.70.0 integration. The former `requestHandler()`, `tracingHandler()`, and `errorHandler()` calls are not exported by this SDK. With a DSN present, the old first call threw during application initialization. The old error handler also sat after the terminal JSON response handler, which consumed route errors before Sentry could see them.

The current client initializes before Express/HTTP imports, and `setupExpressErrorHandler(app)` is registered after API routes and before the terminal error handler. Missing DSN leaves the client disabled without loading the SDK. Expected 4xx errors retain Sentry's default exclusion; genuine 5xx errors can be observed without changing the application's response.

## Privacy boundary

This is deliberately error-only monitoring, not a general performance instrumentation rollout.

- Error exports allow only event ID, time, configured environment, a fixed component tag, standard error type, a fixed redacted message, fatal/error level, handled/unhandled status, and vetted source locations.
- Source locations are relative paths of modules present in the running application's module cache, with line/column numbers. Absolute paths, unrecognized files, function names, local variables, and source snippets are not retained. This preserves useful code locations while excluding supplied stack text. Modules outside the checkout, including symlinked dependency directories, are omitted.
- Request URL/path/query, headers, cookies, request/response body, user identity, arbitrary context, tags, extra data, breadcrumbs, custom fingerprints, and exception text are not exported.
- Attachments are removed. Performance spans, logs, profiles, sessions, feedback, replay, check-ins, client reports, and unknown envelope types are blocked by the transport. Incoming dynamic sampling context and arbitrary envelope headers are not forwarded.
- Input properties are snapshotted once before validation and copying, so changing getters cannot swap in unchecked values. Bounded index loops avoid invoking input array methods or iterators.
- The same scrubber runs in `beforeSend` and at the transport boundary. The latter also protects against SDK internal errors and direct event/envelope sends that bypass `beforeSend`. Malformed data fails closed without logging its contents.
- Only HTTP request isolation, Express integration, and uncaught/unhandled error integrations are enabled. HTTP body collection, breadcrumbs, trace propagation, tracing, SDK debug logging, and sessions are disabled. `SENTRY_TRACES_SAMPLE_RATE` cannot reopen tracing in this Express client.

Original errors and request metadata can exist in SDK memory before these export filters. This is an outbound-data safeguard, not a claim that private information never enters process memory or the SDK.

## Verification

Run `node --test server/tests/sentry-startup-safety.test.js`. It is also included in the default `npm test` command.

The focused suite covers:

1. Disabled behavior without a DSN.
2. The actual installed SDK with a local Express server and an intercepted underlying transport: one redacted 500 event, no expected 401 event, no private synthetic marker or attachment, and unchanged JSON response, and isolation between two concurrent requests.
3. SDK initialization before Express import and error capture before the terminal JSON handler.
4. Explicitly disabled extra telemetry channels even if the trace sample environment variable is `1`.
5. Allowlisted export fields, intact input data, safe source stacks, and idempotent redaction.
6. Custom exception names, malformed objects, invalid IDs/timestamps, and non-error messages.
7. Last-mile filtering of envelope headers and all non-error item types.
8. Events that bypass the before-send hook.
9. Changing getters on scalar fields, including exception types, event IDs, timestamps, frame coordinates, and handled status.
10. Changing getters on nested containers and filenames.
11. Overridden input array methods attempting to inject unsanitized envelope items.

The initial baseline run reproduced `TypeError: Sentry.requestHandler is not a function`; the same real-SDK test passes after the fix. Independent review also identified a changing-getter validation/copy gap; that regression and adjacent overridden-array-method cases failed before their correction and now pass. Tests use synthetic data only and never deliver events to Sentry.

## Limits and release gate

- No Sentry project/DSN was created or enabled. No production traffic, live error delivery, dashboard behavior, data-processing agreement, regulatory compliance, or deployment has been verified.
- Separate `sentry.server.config.js`, `sentry.edge.config.js`, and browser configuration are not protected by this Express client. This checkout has no explicit imports, instrumentation entry point, or `withSentryConfig` wrapper activating those files; this source review does not establish deployed runtime behavior. Initializing a different client in the same process can replace the active SDK client; do not enable a separate configuration without an equivalent privacy boundary and integration review.
- Existing console logs and the application's Debugger/orchestrator error feed are separate sinks, unchanged here.
- Redacted messages, omitted custom names, and stripped context reduce diagnostic detail. Errors lacking a vetted source frame may group more coarsely. Environment values must remain deployment labels, never patient information.
- Full application startup with database/services, production load/startup latency, frontend build, and real Sentry acceptance are separate checks. Do not interpret this focused test as a full release approval.

## Version-matched reference

The official Sentry SDK source for 10.70.0 exports `setupExpressErrorHandler` and `expressErrorHandler`:
https://github.com/getsentry/sentry-javascript/blob/10.70.0/packages/node/src/integrations/tracing/express.ts

The current Express integration guide is https://docs.sentry.io/platforms/javascript/guides/express/. The installed version's source is authoritative for this patch because newer documentation may describe subsequent SDK behavior.
