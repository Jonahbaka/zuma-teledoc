# Operational-agent execution drain

This implements one prerequisite for future full-release rollback: stop new
operational-agent executions and await the complete executions already admitted
by this process. It is not production promotion, a distributed fence, or proof
that all application/database writers have stopped. The primary deployment
quarantine and immutable-serving refusal are unchanged.

## Actual runtime behavior

`server/services/agent-runtime/runtime.js` uses the shared in-process
`workAdmissionBarrier` for both timer polls and authenticated manual `run-next` /
`tasks/:id/run` requests. Admission is recorded synchronously before the first
asynchronous database acquire. Tracking covers claim transaction, rollback/release,
awaited tools, tool-call logs, approval creation and final task-status persistence.

`stopAgentWorker()` still means pause polling, not quiescence. It invalidates the
current timer generation so an already queued old callback cannot run after stop
or a subsequent restart. Its returned snapshot exposes active executions and busy
state instead of implying that an absent timer means idle.

`drainAgentWorker({ timeoutMs })` closes execution admission permanently for this
module/process lifetime, then stops polling. There is no reopen/reset API. Manual
execution refuses with HTTP 503 and `WORKER_ADMISSION_CLOSED`. Candidate, immutable
and explicitly runtime-disabled processes also refuse execution before claiming a
task. `DISABLE_SCHEDULERS=true` disables timer work but intentionally preserves
explicit manual execution until the terminal drain.

Drain waits for all admitted execution promises. The timeout is bounded to 1–30000
milliseconds, default 10000. Its result contains `activeCount`, `failedCount`,
`admissionClosed`, `idle`, `drained`, a bounded reason and scope:

- `drained:true`: local accepted execution promises settled without an unresolved
  rejection. A task whose failure was successfully recorded may still drain.
- `DRAIN_TIMEOUT`: accepted work remains active. No cancellation, requeue, task
  replay, admission reopening or optimistic cleanup is performed.
- `WORK_SETTLEMENT_FAILED`: an accepted execution rejected, for example during
  claim or final persistence. Even with zero active promises, it cannot certify a
  clean drain. The failure latch is permanent and contains no raw error details.
- `processFenced:false`, `scope:in_process_execution_only` always remain explicit.

Timeout does not cancel a promise or its provider/database work. A later drain can
observe successful late settlement, but never reopens admission. Uncertain task
outcomes need reconciliation, not automatic replay. Claimed rows are not silently
reset to queued, because the tool or database effect may already have occurred.

Claim failures request client disposal even when rollback fails. The actual
`db.getClient()` wrapper now preserves node-postgres release arguments instead of
dropping `release(true)` or an error argument. Its existing transport and pool
configuration are otherwise unchanged.

## Signal shutdown integration

The existing server SIGTERM/SIGINT handler is now single-flight. It closes agent
execution admission and awaits a 10-second drain before voice, NemoClaw or shared
DB cleanup. Incomplete/rejected drain skips those cleanup steps and exits nonzero,
not as a clean shutdown. Repeated signals do not duplicate cleanup or report a
second success. This avoids closing the shared DB underneath a known in-flight
operational-agent execution on the orderly shutdown path.

The main PM2 configuration has a 30-second kill timeout. The 10-second drain is a
budget for this worker only, not a bound for all later cleanup. The host may still
terminate the process, including on an incomplete drain. A nonzero exit is failure
evidence; it is not known task rollback or proof that a remote effect stopped.

## Boundaries that still block deployment

- Other schedulers, the legacy agent orchestrator, delayed initializers, HTTP
  requests, Socket.IO and separate processes are not fenced by this barrier.
- Task creation/cancellation, approval decisions and budget-setting routes remain
  ordinary DB writers. This change fences execution, not every queue mutation.
- A new process starts with new admission state. PM2 auto-restart, a queued host
  start or another machine can start another worker. A production adapter needs
  durable external ownership/fencing and independent process verification.
- Existing startup schema/seed writes, incomplete historical schema coverage,
  runtime state/Next cache paths, verified transport, config identity and backup /
  rollback compatibility still require work. No real PostgreSQL or provider was
  contacted by these tests.
- The production promoter must not substitute this drain result for the immutable
  foundation adapter's global quiescence/fencing contract. The barrier is a useful
  component, not a relaxation of that contract or of the deployment quarantine.

## Regression evidence

`server/tests/agent-worker-drain.test.js` uses the actual runtime, route and signal
handler source with synthetic database/tools and controlled waits. It pauses at
acquire, claim selection, COMMIT, tool execution, tool logging and final persistence;
tests recorded versus uncertain failures, failed rollback disposal through the real
DB facade, timeout/late completion, simultaneous manual/timer work, old callback
generations, disabled modes, invalid settings and repeated signals. Manual route
fixtures preserve the authentication/authorization middleware chain and invoke the
handler to verify 503; they do not constitute authenticated end-to-end HTTP tests. No test sends an external communication or executes a real task.
The test is registered in `test:deploy-guard`.
