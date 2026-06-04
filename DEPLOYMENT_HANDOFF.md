# DoctaRx Nigeria — Deployment Handoff

**Repo:** `Jonahbaka/zuma-teledoc` · **Branch:** `main` · **HEAD at handoff:** `ef13e49`
**Production:** https://doctarx.com (Nigeria path: `/ng`, API: `/api/ng/...`)
**EC2:** `i-067815cf18600a570` · app root `/home/ec2-user/zuma-teledoc` · PM2 apps `zuma-teledoc` + `cronops`
**Last known-good deployed commit:** `6c10edbda5de` (ancestor of HEAD — already includes the PM2 `wait_ready`/`process.send('ready')` fix; **do not revert**)

---

## 1. TL;DR — where this stands

- The **deploy pipeline was rebuilt** for real observability and a hard production gate. The code is correct and unit-tested locally, but **no deploy of the new commits has cleanly LANDED + passed the production gate yet.**
- **Root operational blocker:** repeated pushes each triggered a full EC2 build, and the *old* live server (`6c10edb`) has **no in-progress guard** (that guard only exists in the new, not-yet-live `server/routes/deploy.js`). Result: **multiple concurrent Next.js builds piled up on EC2 and destabilized it.** The `61bacf2` deploy run polled for the full 40 min seeing `status endpoint unreachable/non-JSON (server may be mid-reload)` every iteration, then timed out — i.e., production was returning 502/non-JSON (server flapping) during that window.
- **Video WebRTC E2E: VERIFIED** (1:1 P2P) on commit `84a68cb` — run `26939870054`. Real evidence (see §5).
- **Neon direct DB verification: BLOCKED from CI** — the GitHub repo has **no `DATABASE_URL` secret** (confirmed: the `neon-verify` step saw `DATABASE_URL:` empty and exited). No AWS CLI/SSM is available either.
- **Production gate (`/ng`, NG clinical route, stability): NOT YET CONFIRMED** — pending a deploy that actually lands.

---

## 2. Hard environment constraints (apply to whoever continues)

- The agent sandbox **cannot reach `doctarx.com`** (network allowlist: `Host not in allowlist`) and has **no AWS CLI / credentials / SSM**. All production verification must run **from the GitHub Actions runner**, which *can* reach `doctarx.com`.
- **Secrets:** never print, echo, commit, or place secrets in source. Only redacted forms (e.g. `NG_LIVEKIT_API_SECRET=lksec_****1234`). The deploy webhook injects whitelisted secrets into EC2 `.env` server-side; values never appear as shell args.
- The repo currently does **not** expose `DATABASE_URL` as a GitHub secret (deploy injects only the secrets that ARE set; DB creds live in EC2 `.env`).

---

## 3. What production actually is right now

- Production is (was) serving the last-good commit **`6c10edb`**. That commit **predates** the `/api/deploy/log` route (added later in `f72e965`), which is why `GET /api/deploy/log` returns `{"success":false,"error":"Endpoint not found"}` on the live server. This is expected, not a bug.
- During the concurrent-build pile-up (≈08:1x–08:36 UTC) the public endpoint returned **non-JSON/502** continuously → **production was likely flapping/down**. **First action for whoever continues: confirm production health and stability** (see §7 step 0). If GPT already landed a successful deploy, verify which commit is live via `/api/health` `gitCommit`.

---

## 4. Deploy pipeline architecture built this session (all on `main`)

Files:
- **`.github/workflows/deploy.yml`** — trigger webhook (resilient: POSTs once, never re-POSTs, falls through to polling on timeout; only 401/403 fails fast) + poll/verify step.
- **`.github/scripts/deploy_status.py`** — parses the deploy status contract; classifies `ok` / `transient` (empty/non-JSON, e.g. mid-reload) / `route_missing` (404 on old server) / `contract_error` (real breach). Never prints `status=?`.
- **`server/routes/deploy.js`** — **the deploy LOG is the single source of truth** (survives the `pm2 reload` that restarts the Node process mid-deploy). Stable status contract: `{ ok, deployId, pid, status, startedAt, finishedAt, commit, branch, logPath, lastLines, exitCode, verified, checks{build,pm2,health,ngHealth} }`. POST **attaches to an in-progress deploy** instead of starting a second (this is the guard that will end the pile-up **once it is live**).
- **`server/routes/deploy-command.js`** — deploy split into `build`/`pm2`/`health`/`ngHealth` phases, each emitting `[deploy:check] <phase>=success|failed`; header markers `[deploy:id]`, `[deploy:pid] $$`, `[deploy] start`; exactly one terminal marker `[deploy] complete` / `[deploy] failed (exit N)`.
- **`.github/scripts/verify_production.py`** — **authoritative production gate**, runs from the runner against `https://doctarx.com`. Hard gates (all required): `/api/health` `status=healthy` + correct `gitCommit` + `buildId` + `nextReady=true` + `nextInitStatus=ready` + `nextInitError=null`; `/api/ng/health` `clinicalEmr:true`; `/api/ng/clinical/prescriptions` ∈ **{401,403}** (mounted; 404=not mounted, 503=warming both FAIL); `/ng` + `/ng/provider/login` + `/ng/provider/dashboard` render **past the warmup loader** (`Connecting to DoctaRx`) and dashboard lacks the copy `Live panels use the authenticated provider APIs where available`; **5/5 stability** with stable `startedAt`. Also checks **`www.doctarx.com/ng`** behavior (serves / redirects-to-apex+follows / broken). Media is reported **NOT VERIFIED** by design.
- **Bootstrap path:** because the live server lacks `/api/deploy/log`, the poller confirms a landed deploy via **`/api/health` `gitCommit` == intended SHA** + health + ng-health, then runs `verify_production.py`. Once a new commit is live, `/api/deploy/log` exists and later deploys use the rich contract.

---

## 5. Evidence already captured (from CI logs — trustworthy)

- **Video WebRTC E2E — PASS** (run `26939870054`, job `79478435167`, commit `84a68cb`):
  `summarize_video_evidence.py` parsed the uploaded `result.json` (8-file artifact w/ screenshots):
  - provider+patient joined same room `ng-video-room-ng-video-e2e-appointment`
  - signaling: offer / answer / ice-candidate present
  - provider PC `connected` (ice connected); patient PC `connected` (ice connected)
  - provider remote audio=1 video=1; patient remote audio=1 video=1
  - in-call chat both directions; both leave cleanly → `WEBRTC_E2E=PASS`
  - **Scope:** 1:1 **P2P** path only. TURN relay / LiveKit **SFU** / 3·5·10-person = **NOT VERIFIED**.
- **Neon CI verify — FAILED (blocked, not a real failure):** run `26940596702` — `DATABASE_URL` secret empty → cannot connect. Needs the secret (see §7 step 4).
- **Deploy runs — all FAILED/timeout so far** (commits `52ee567`,`8be0cc0`,`56c5afc`,`61bacf2` completed=failure; `8f58151`,`b665cf4`,`84a68cb`,`ef13e49` were in-progress at handoff). `61bacf2` (`26938732984`) timed out after 40 min of `transient` (server unreachable/non-JSON) — the pile-up symptom.

---

## 6. Commits made this session (newest first; all pushed to `main`)

```
ef13e49 feat(ci): Neon DB verification + www/.ng production gate checks
84a68cb feat(ci): real browser WebRTC E2E job (provider+patient 1:1 P2P)
b665cf4 chore: gitignore Python bytecode cache
8f58151 feat(deploy): gate success on real production verification, not commit alone
61bacf2 fix(deploy): make trigger webhook resilient to a busy/overloaded server
56c5afc fix(deploy): bootstrap-aware poller for servers predating /api/deploy/log
8be0cc0 fix(deploy): establish a stable deploy status contract (observability)
52ee567 fix(deploy): extend poll timeout to 40 min, add log-line fallback detection
2242ac2 fix(deploy): supervise EC2 deploy to a real terminal state, no false success
```
(plus earlier: `7c43492`, `8fab287`, `f72e965`, …). `6c10edb` (last-good, `wait_ready` fix) is an ancestor — **do not revert it.**

---

## 7. Next actions for GPT (do these in order)

**Step 0 — Stabilize & confirm production first (most important).**
- Hit `https://doctarx.com/api/health?verify=$(date +%s)` and `/api/ng/health`. Record `gitCommit`, `status`, `nextReady`. If flapping/down, the concurrent-build pile-up must drain. Prefer **AWS SSM** on `i-067815cf18600a570` (the sandbox here had no SSM; GPT may): inspect/kill stray `next build`/`node` build processes, confirm only one PM2 `zuma-teledoc` online, then run the deploy once.
- **Stop the pile-up:** do NOT push repeatedly. Each push to `main` retriggers `deploy.yml`. Land ONE commit, then stop and let it converge. Once the new `server/routes/deploy.js` (with the attach/in-progress guard) is live, the pile-up self-resolves.

**Step 1 — Land the deploy on `ef13e49` (or newer HEAD).**
- Re-run `deploy.yml` via `workflow_dispatch` (no new commit needed) once EC2 is calm, or push a single trivial commit. Watch the run: `gh run watch` / poll `actions_get`.
- Success = `verify_production.py` prints `PRODUCTION_VERIFY=PASS` in the run log.

**Step 2 — Confirm the AWS deploy from the deploy log** (once `/api/deploy/log` is live or via SSM `tail -n 200 /tmp/doctarx-deploy.log`): `test:deploy-gate` passed, `npm run build` completed, `.next` exists, `[deploy:check] build/pm2/health/ngHealth=success`, `[deploy] complete`, PM2 reload OK for `zuma-teledoc` + `cronops`.

**Step 3 — Confirm the Nigeria `/ng` gate** (the production gate already covers this): `/api/ng/health clinicalEmr:true`, `/api/ng/clinical/prescriptions` ∈ {401,403}, `/ng` + `/ng/provider/login` + `/ng/provider/dashboard` real pages (no warmup, no bad copy), 5/5 stability, and `www.doctarx.com/ng` behavior.

**Step 4 — Neon proof (currently blocked).** Choose one:
- (a) Add a **`DATABASE_URL`** GitHub repo secret → re-run **`neon-verify.yml`** (read-only: proves `017_ng_clinical_records.sql` in `ng_migrations`, the 5 tables exist, and documented persisted records present). For a fresh 21/21 live sim with new IDs: dispatch `neon-verify.yml` with `run_live_sim=true` (mutating; guarded by `ALLOW_PRODUCTION_SIMULATION`).
- (b) Or via **SSM** on EC2: `cd /home/ec2-user/zuma-teledoc && node .github/scripts/verify_neon.js` (it reads the server's own `DATABASE_URL`).
- Required tables: `ng_clinical_encounters`, `ng_soap_notes`, `ng_diagnoses`, `ng_medication_history`, `ng_referrals`. Documented IDs to confirm: encounter `6562aa8b-…`, SOAP `b6ebbf4b-…`, diagnosis `6253f6c0-…`, referral `da5bd8fd-…`, prescription `8b421df7-…`, lab `6e422336-…`, document `4f457330-…`.

**Step 5 — Video.** Already PASS (1:1 P2P). Keep TURN/SFU/3·5·10-person as **NOT VERIFIED** unless a real browser session against production media (LiveKit SFU) with valid demo creds is executed.

---

## 8. Useful commands / run IDs

- Deploy workflow: `.github/workflows/deploy.yml` (push to `main` + `workflow_dispatch`)
- Video: `.github/workflows/video-e2e.yml` → `npm run e2e:video:ng` (needs `CHROME_PATH`; runner auto-detects google-chrome)
- Neon: `.github/workflows/neon-verify.yml` → `node .github/scripts/verify_neon.js` (needs `DATABASE_URL`)
- Production gate (manual): `EXPECT_COMMIT=<sha> VERIFY_BASE=https://doctarx.com python3 .github/scripts/verify_production.py`
- Latest evidence runs: video `26939870054` (PASS), neon `26940596702` (blocked), deploy timeouts `26938732984` et al.

---

## 9. Final report format to fill in (only from logs/evidence)

```
AWS deployment: VERIFIED / FAILED
Neon deployment: VERIFIED / FAILED
Nigeria /ng deployment: VERIFIED / FAILED
www.doctarx.com/ng behavior:
Commit deployed:
Build id:
Health status:
Next ready:
Database status:
NG clinical route:
Provider dashboard status:
Live Neon simulation:
Video E2E simulation:
TURN relay:           NOT VERIFIED (unless actually tested)
SFU:                  NOT VERIFIED (unless actually tested)
3/5/10-person media:  NOT VERIFIED (unless actually tested)
Remaining blockers:
```

**Do not report "deployment successful" until the production gate (`PRODUCTION_VERIFY=PASS`) and the WebRTC run both pass, and Neon is verified by DB evidence.**
