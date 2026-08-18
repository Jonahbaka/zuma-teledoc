# Test Evidence

Evidence date: 2026-08-18. Local runtime: Node.js 22.12.0, npm 10.9.0, Windows. A transitive lint dependency declares Node `^22.13.0`; CI/staging must use Node 22.13+ even though local commands completed.

| Command | Exact result |
|---|---|
| `npm ci --prefer-offline --no-audit --no-fund` | Exit 0; 897 packages installed from the updated lockfile. |
| `npm audit` | Exit 0; 0 vulnerabilities. |
| `npm audit --omit=dev` | Exit 0; 0 vulnerabilities. |
| `npm ls brace-expansion --all` | Exit 0; patched 5.0.9/1.1.18 dependency graph, no invalid tree. |
| `node --test ng/tests/nigeria-imaging-authorization.test.js ng/tests/rbac.test.js ng/tests/governance.test.js ng/tests/dhis2.test.js ng/tests/auditLineage.test.js` | 37 passed, 0 failed. |
| `node --test ng/tests/public-health-missing-data.test.js ng/tests/dhis2.test.js` | 10 passed, 0 failed. |
| `node --test ng/tests/rbac.test.js ng/tests/governance.test.js ng/tests/public-health-missing-data.test.js` | 29 passed, 0 failed after object-scope/transaction remediation. |
| `npm run lint` | Exit 0; 0 errors, 38 warnings. Warnings are listed in lint output and remain debt. |
| `npm test` | Final exit 0: 135 passed, 8 database tests explicitly skipped; regression 12/12 and portal contract 14/14 passed. |
| `npm run build` | Exit 0; Next.js 15.5.23 compiled, type/lint phase completed, 222 static pages generated. |
| Local HTTP `/` | 200, 182,966-byte HTML response. |
| Local HTTP `/ng/admin/public-health-programme` | 200, 70,790-byte HTML response containing programme content. |
| Local HTTP `/ng/provider/imaging` with authorization flags unset | Streamed 200 containing Next not-found/noindex state; no imaging heading/content was present. Unit tests also prove API/UI gating. |

## What this does not prove

- The skipped PostgreSQL lifecycle tests did not write or reconcile a database.
- No live camera, microphone, SFU, TURN relay, reconnection, or network-throttling test ran.
- No authorized DHIS2 request ran.
- No payment, delivery, email, SMS, or AI provider was exercised.
- No authenticated multi-browser, WCAG, or five-viewport evidence was captured.
- The in-app browser runtime could not initialize because its local assets were unavailable; no screenshot is claimed. Basic HTTP evidence is not a substitute for browser UAT.
- No backup/restore or production-mode stability soak ran.

Those omissions are blockers, not passes.
