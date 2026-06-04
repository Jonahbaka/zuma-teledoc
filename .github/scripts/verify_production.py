#!/usr/bin/env python3
"""Production readiness verifier for DoctaRx Nigeria.

Runs from the GitHub Actions runner (which can reach https://doctarx.com) and
proves the deployment is actually live — NOT merely that /api/health reports a
new commit. Encodes the hard-won deployment lesson: a new gitCommit does not
mean the NG clinical route is mounted or that pages render past the warmup
loader. Every required-evidence item is a hard gate.

Exit 0 only if ALL hard gates pass; otherwise exit 1. Prints an evidence block
and the canonical final report. Media (TURN/SFU/multi-party) is intentionally
reported NOT VERIFIED — it cannot be proven from CI without a real browser
WebRTC session, and we never claim it from route/health checks.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = os.environ.get("VERIFY_BASE", "https://doctarx.com").rstrip("/")
EXPECT = (os.environ.get("EXPECT_COMMIT", "") or "")[:12]
READY_DEADLINE_S = int(os.environ.get("VERIFY_READY_DEADLINE", "600"))
WARMUP_MARKER = "Connecting to DoctaRx"
BAD_DASHBOARD_COPY = "Live panels use the authenticated provider APIs where available"

results = {}   # gate_name -> (ok: bool, detail: str)
evidence = {}  # free-form evidence for the report


def _req(path, method="GET"):
    """Return (status_code, body_text). Does not follow redirects so we can see
    3xx auth redirects. Network/HTTP errors return (code or 0, text)."""
    url = f"{BASE}{path}"

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, method=method, headers={"Cache-Control": "no-cache"})
    try:
        with opener.open(req, timeout=20) as r:
            return r.getcode(), r.read(200000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read(200000).decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, body
    except Exception as e:
        return 0, f"<request error: {e}>"


def _json(path):
    code, body = _req(path)
    try:
        return code, json.loads(body), body
    except Exception:
        return code, None, body


def gate(name, ok, detail=""):
    results[name] = (bool(ok), detail)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    return ok


def find_db_status(*objs):
    """Best-effort: locate a database/Neon health signal in any health JSON."""
    for o in objs:
        if not isinstance(o, dict):
            continue
        for k, v in o.items():
            kl = k.lower()
            if any(t in kl for t in ("database", "neon", "postgres", "db")):
                return k, v
    return None, None


# ── Phase 1: readiness wait ───────────────────────────────────────────────────
print(f"== Verifying production at {BASE} (expect commit prefix '{EXPECT or 'any'}') ==")
deadline = time.time() + READY_DEADLINE_S
health = None
while time.time() < deadline:
    ts = int(time.time())
    code, health, raw = _json(f"/api/health?verify={ts}")
    if code == 200 and isinstance(health, dict):
        status = health.get("status")
        ready = health.get("nextReady") is True
        commit = (health.get("gitCommit") or "")
        commit_ok = (not EXPECT) or commit[:12].startswith(EXPECT[:7]) or EXPECT[:7] == commit[:7]
        print(f"  {time.strftime('%H:%M:%S')} health status={status} nextReady={ready} "
              f"gitCommit={commit[:12]} nextInitStatus={health.get('nextInitStatus')}")
        if status == "healthy" and ready and commit_ok:
            break
    else:
        print(f"  {time.strftime('%H:%M:%S')} health HTTP={code} (still warming / unreachable)")
    time.sleep(15)

# Final authoritative health snapshot.
code, health, raw = _json(f"/api/health?verify={int(time.time())}")
if not isinstance(health, dict):
    gate("health_reachable", False, f"/api/health HTTP={code} body={raw[:160]}")
    health = {}
else:
    gate("health_reachable", code == 200, f"HTTP={code}")

commit = health.get("gitCommit") or ""
build_id = health.get("buildId") or health.get("version") or ""
evidence["gitCommit"] = commit
evidence["buildId"] = build_id
evidence["health_status"] = health.get("status")
evidence["nextReady"] = health.get("nextReady")
evidence["nextInitStatus"] = health.get("nextInitStatus")
evidence["nextInitError"] = health.get("nextInitError")
evidence["startedAt"] = health.get("startedAt")

gate("health_status_healthy", health.get("status") == "healthy", f"status={health.get('status')}")
gate("build_id_present", bool(build_id) and build_id != "missing", f"buildId={build_id}")
gate("next_ready", health.get("nextReady") is True, f"nextReady={health.get('nextReady')}")
gate("next_init_status_ready", health.get("nextInitStatus") == "ready", f"nextInitStatus={health.get('nextInitStatus')}")
gate("next_init_error_null", health.get("nextInitError") in (None, "", "null"), f"nextInitError={health.get('nextInitError')}")
if EXPECT:
    gate("commit_matches_intended", commit[:7] == EXPECT[:7], f"live={commit[:12]} expected={EXPECT}")

# ── Phase 2: NG platform + clinical route ─────────────────────────────────────
ng_code, ng_health, ng_raw = _json(f"/api/ng/health?verify={int(time.time())}")
evidence["ng_status"] = (ng_health or {}).get("status")
evidence["ng_clinicalEmr"] = (ng_health or {}).get("clinicalEmr")
evidence["ng_multiParty"] = (ng_health or {}).get("multiPartyConferencing")
gate("ng_health_ok", isinstance(ng_health, dict) and ng_health.get("status") == "ok",
     f"HTTP={ng_code} status={(ng_health or {}).get('status')}")
gate("ng_clinical_emr_true", isinstance(ng_health, dict) and ng_health.get("clinicalEmr") is True,
     f"clinicalEmr={(ng_health or {}).get('clinicalEmr')}")

# Database health (best-effort — only gate if a public signal exists).
db_key, db_val = find_db_status(health, ng_health)
if db_key is not None:
    evidence["database"] = {db_key: db_val}
    healthy_db = (db_val is True) or (isinstance(db_val, str) and db_val.lower() in ("ok", "healthy", "up", "connected")) \
        or (isinstance(db_val, dict) and str(db_val.get("status", "")).lower() in ("ok", "healthy", "up", "connected"))
    gate("database_healthy", bool(healthy_db), f"{db_key}={db_val}")
else:
    evidence["database"] = "not exposed via public health API"
    print("[INFO] database_healthy: no public DB signal in /api/health or /api/ng/health (cannot verify from CI)")

# NG clinical route must be MOUNTED (401/403 unauthenticated), not 404 (missing) or 503 (warming).
clin_code, clin_body = _req(f"/api/ng/clinical/prescriptions?verify={int(time.time())}")
evidence["clinical_route_http"] = clin_code
gate("ng_clinical_route_mounted", clin_code in (401, 403),
     f"/api/ng/clinical/prescriptions HTTP={clin_code} (need 401/403; 404=not mounted, 503=warming)")

# ── Phase 3: provider pages render past warmup ────────────────────────────────
login_code, login_body = _req("/ng/provider/login")
login_warm = WARMUP_MARKER in login_body
evidence["provider_login_http"] = login_code
gate("provider_login_real_page", login_code == 200 and not login_warm and len(login_body) > 800,
     f"HTTP={login_code} warmup={login_warm} bytes={len(login_body)}")

dash_code, dash_body = _req("/ng/provider/dashboard")
dash_warm = WARMUP_MARKER in dash_body
dash_bad = BAD_DASHBOARD_COPY in dash_body
evidence["provider_dashboard_http"] = dash_code
# Real page (200) OR an auth redirect (3xx) are both acceptable; warmup is not.
gate("provider_dashboard_real_or_auth",
     (dash_code == 200 or 300 <= dash_code < 400) and not dash_warm,
     f"HTTP={dash_code} warmup={dash_warm}")
gate("provider_dashboard_no_unprofessional_copy", not dash_bad,
     f"badCopyPresent={dash_bad}")

# ── Phase 4: stability poll (5 × 15s) ─────────────────────────────────────────
print("== Stability poll (5 × 15s) ==")
started_ats = []
healthy_count = 0
ready_count = 0
for i in range(1, 6):
    code, h, _ = _json(f"/api/health?stability={i}")
    if isinstance(h, dict):
        st = h.get("status")
        started_ats.append(h.get("startedAt"))
        if st == "healthy":
            healthy_count += 1
        if h.get("nextReady") is True:
            ready_count += 1
        print(f"  poll {i}: status={st} nextReady={h.get('nextReady')} startedAt={h.get('startedAt')}")
    else:
        print(f"  poll {i}: HTTP={code} (unreachable)")
    if i < 5:
        time.sleep(15)

stable_started = len(set([s for s in started_ats if s])) == 1 and len(started_ats) == 5
evidence["stability"] = {"healthy": f"{healthy_count}/5", "nextReady": f"{ready_count}/5",
                         "startedAt_stable": stable_started}
gate("stability_5of5_healthy", healthy_count == 5, f"{healthy_count}/5 healthy")
gate("stability_started_at_stable", stable_started, f"distinct startedAt={set(started_ats)}")
gate("stability_next_ready", ready_count == 5, f"{ready_count}/5 nextReady")

# ── Verdict + report ──────────────────────────────────────────────────────────
all_pass = all(ok for ok, _ in results.values())

print("\n================ EVIDENCE ================")
print(json.dumps(evidence, indent=2, default=str))

deployed = "VERIFIED" if all_pass else "FAILED"
blockers = [name for name, (ok, _) in results.items() if not ok]
clin = evidence.get("clinical_route_http")
print("\n================ FINAL REPORT ================")
print(f"AWS deployment: {deployed}")
print(f"Commit deployed: {commit[:12] or 'unknown'}")
print(f"Build id: {build_id or 'unknown'}")
print(f"Health status: {health.get('status')}")
print(f"Next ready: {health.get('nextReady')}")
print(f"Database status: {evidence['database']}")
print(f"NG clinical route: HTTP {clin} ({'mounted' if clin in (401, 403) else 'NOT mounted'})")
print(f"Provider dashboard status: HTTP {evidence.get('provider_dashboard_http')} "
      f"({'ok' if results.get('provider_dashboard_real_or_auth', (False,))[0] else 'NOT ok'})")
print("Live Neon simulation: previously VERIFIED (run ng-clinical-1780506341962, 21/21) — not re-run from CI")
print("Video E2E simulation: NOT VERIFIED from CI (requires browser WebRTC e2e:video:ng)")
print("TURN relay: NOT VERIFIED")
print("SFU: NOT VERIFIED (LiveKit configuration only; no real media session)")
print("3/5/10-person media: NOT VERIFIED")
print(f"Remaining blockers: {', '.join(blockers) if blockers else 'none (deploy gates passed; media verification still pending)'}")
print(f"\nPRODUCTION_VERIFY={'PASS' if all_pass else 'FAIL'}")

sys.exit(0 if all_pass else 1)
