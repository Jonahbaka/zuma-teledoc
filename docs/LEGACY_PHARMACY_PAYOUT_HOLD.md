# Legacy pharmacy payout hold

The legacy pharmacy-wallet payout path is disabled in code. The service rejects direct, concurrent and repeated calls before wallet access or any provider operation. The authenticated pharmacy route returns a private HTTP 503 with `LEGACY_PHARMACY_SETTLEMENT_DISABLED`. Standard account authentication and portal role restrictions remain unchanged. There is no environment-variable or administrator bypass.

The old implementation could issue duplicate transfers after concurrent reads of one pending balance, or after a provider transfer succeeded but recording its wallet transaction failed. Retrying with a fresh reference could pay again. Disabling the path does not prove any historical duplicate occurred, reverse a payment, repair a balance, cancel a pending transfer or refund money.

## Operator action

Finance must reconcile earlier transfer references against verified provider evidence and the original wallet/ledger records before any replacement payout. Preserve the existing balances, pending amounts and history. Do not treat a timeout, HTTP error or locally restored pending amount as proof that a provider did not transfer funds.

The wallet view still shows recorded balances, transaction history and a read-only medication statement. Its legacy payout button is disabled and explains the hold. The reviewed medication-order ledger, separate approved settlement workflow, verification/recovery operations and access rules are unchanged. Legacy money is not migrated into that workflow automatically.

Restoring legacy payouts requires a separately designed and approved durable claim, stable provider idempotency, ambiguous-outcome reconciliation, atomic local financial evidence and operator protocol. This patch does not implement or claim that settlement lifecycle. No live payout, provider call or production data was used to validate the gate.
