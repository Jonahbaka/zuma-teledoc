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
PRE_DEPLOY_BUILD_ID = os.environ.get("PRE_DEPLOY_BUILD_ID", "").strip()
REQUIRE_BUILD_ID_CHANGE = os.environ.get("REQUIRE_BUILD_ID_CHANGE", "").lower() in ("1", "true", "yes")
READY_DEADLINE_S = int(os.environ.get("VERIFY_READY_DEADLINE", "600"))
WARMUP_MARKER = "Connecting to DoctaRx"
BAD_DASHBOARD_COPY = "Live panels use the authenticated provider APIs where available"

results = {}   # gate_name -> (ok: bool, detail: str)
evidence = {}  # free-form evidence for the report


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def _do(url, method="GET"):
    """Return (status_code, headers_dict, body_text). Does not follow redirects
    so we can observe 3xx (auth redirects, www->apex). Errors -> (code|0, {}, text)."""
    opener = urllib.request.build_opener(_NoRedirect)
    req = urllib.request.Request(url, method=method, headers={
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 DoctaRxProductionVerifier/1.0",
    })
    try:
        with opener.open(req, timeout=20) as r:
            return r.getcode(), dict(r.headers), r.read(200000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            body = e.read(200000).decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, dict(e.headers or {}), body
    except Exception as e:
        return 0, {}, f"<request error: {e}>"


def _req(path, method="GET"):
    """(status_code, body_text) against BASE — back-compat helper."""
    code, _h, body = _do(f"{BASE}{path}", method)
    return code, body


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


def db_value_is_healthy(value):
    if value is True:
        return True
    if isinstance(value, str):
        return value.lower() in ("ok", "healthy", "up", "connected", "true")
    if isinstance(value, dict):
        status = str(value.get("status", "")).lower()
        if status in ("ok", "healthy", "up", "connected"):
            return True
        if value.get("healthy") is True or value.get("allHealthy") is True:
            return True
        primary = value.get("primary")
        if isinstance(primary, dict) and primary.get("healthy") is True:
            return True
    return False


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
if REQUIRE_BUILD_ID_CHANGE or PRE_DEPLOY_BUILD_ID:
    gate("build_id_changed_after_deploy",
         bool(build_id) and bool(PRE_DEPLOY_BUILD_ID) and build_id != PRE_DEPLOY_BUILD_ID,
         f"preDeployBuildId={PRE_DEPLOY_BUILD_ID or 'missing'} liveBuildId={build_id or 'missing'}")
gate("next_ready", health.get("nextReady") is True, f"nextReady={health.get('nextReady')}")
gate("next_init_status_ready", health.get("nextInitStatus") == "ready", f"nextInitStatus={health.get('nextInitStatus')}")
gate("next_init_error_null", health.get("nextInitError") in (None, "", "null"), f"nextInitError={health.get('nextInitError')}")
if EXPECT:
    gate("commit_matches_intended", commit[:7] == EXPECT[:7], f"live={commit[:12]} expected={EXPECT}")

# ── Phase 2: NG platform + clinical route ─────────────────────────────────────
ng_code, ng_health, ng_raw = _json(f"/api/ng/health?verify={int(time.time())}")
ng_features = (ng_health or {}).get("features") if isinstance(ng_health, dict) else {}
if not isinstance(ng_features, dict):
    ng_features = {}
ng_clinical_emr = (ng_health or {}).get("clinicalEmr") or ng_features.get("clinicalEmr")
ng_multi_party = (ng_health or {}).get("multiPartyConferencing") or ng_features.get("multiPartyConferencing")
evidence["ng_status"] = (ng_health or {}).get("status")
evidence["ng_clinicalEmr"] = ng_clinical_emr
evidence["ng_multiParty"] = ng_multi_party
gate("ng_health_ok", isinstance(ng_health, dict) and ng_health.get("status") == "ok",
     f"HTTP={ng_code} status={(ng_health or {}).get('status')}")
gate("ng_clinical_emr_true", ng_clinical_emr is True,
     f"clinicalEmr={ng_clinical_emr}")

# Database health (best-effort — only gate if a public signal exists).
db_key, db_val = find_db_status(health, ng_health)
if db_key is not None:
    evidence["database"] = {db_key: db_val}
    healthy_db = db_value_is_healthy(db_val)
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

# Bare /ng landing must render past warmup (Nigeria platform path, not the root app).
ng_root_code, ng_root_body = _req("/ng")
ng_root_warm = WARMUP_MARKER in ng_root_body
evidence["ng_root_http"] = ng_root_code
gate("ng_root_real_page",
     (ng_root_code == 200 or 300 <= ng_root_code < 400) and not ng_root_warm,
     f"/ng HTTP={ng_root_code} warmup={ng_root_warm}")

# ── Phase 3c: www.doctarx.com /ng behavior ────────────────────────────────────
# Report whether www serves /ng, redirects to the apex /ng (verify final dest),
# fails, or serves only root. Not a hard gate by itself (www->apex redirect is a
# valid config), but a broken www/ng is surfaced as a blocker for the verdict.
print("== www.doctarx.com /ng behavior ==")
www = {}
for p in ("/ng", "/ng/provider/login", "/ng/provider/dashboard"):
    code, headers, body = _do(f"https://www.doctarx.com{p}")
    loc = headers.get("Location") or headers.get("location") or ""
    warm = WARMUP_MARKER in body
    if 300 <= code < 400 and "doctarx.com" in loc:
        # Follow the redirect target to confirm the final /ng destination works.
        fcode, _fh, fbody = _do(loc if loc.startswith("http") else f"https://doctarx.com{loc}")
        fwarm = WARMUP_MARKER in fbody
        verdict = "redirect->apex OK" if (fcode == 200 or 300 <= fcode < 400) and not fwarm else f"redirect->apex BROKEN (dest HTTP {fcode}, warmup={fwarm})"
        www[p] = {"http": code, "redirect": loc, "dest_http": fcode, "verdict": verdict}
    elif code == 200 and not warm:
        www[p] = {"http": code, "verdict": "serves /ng directly"}
    elif warm:
        www[p] = {"http": code, "verdict": "WARMUP page"}
    else:
        www[p] = {"http": code, "verdict": "FAIL/odd"}
    print(f"  www{p}: HTTP={code} loc={loc or '-'} -> {www[p]['verdict']}")
evidence["www_ng"] = www
www_ok = all(("OK" in v["verdict"]) or ("serves /ng directly" in v["verdict"]) for v in www.values())
evidence["www_ng_ok"] = www_ok
print(f"www /ng overall: {'OK' if www_ok else 'NOT OK (see blockers)'}")

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
if not evidence.get("www_ng_ok"):
    blockers.append("www_ng_behavior (see www section)")
clin = evidence.get("clinical_route_http")
print("\n================ FINAL REPORT ================")
print(f"AWS deployment: {deployed}")
print(f"Commit deployed: {commit[:12] or 'unknown'}")
print(f"Build id: {build_id or 'unknown'}")
print(f"Health status: {health.get('status')}")
print(f"Next ready: {health.get('nextReady')}")
print(f"Database status: {evidence['database']}")
print(f"NG clinical route: HTTP {clin} ({'mounted' if clin in (401, 403) else 'NOT mounted'})")
print(f"NG /ng landing: HTTP {evidence.get('ng_root_http')} "
      f"({'ok' if results.get('ng_root_real_page', (False,))[0] else 'NOT ok'})")
print(f"Provider dashboard status: HTTP {evidence.get('provider_dashboard_http')} "
      f"({'ok' if results.get('provider_dashboard_real_or_auth', (False,))[0] else 'NOT ok'})")
print(f"www /ng behavior: {'OK' if evidence.get('www_ng_ok') else 'NOT OK'} -> "
      + "; ".join(f"{k}:{v['verdict']}" for k, v in (evidence.get('www_ng') or {}).items()))
print("Live Neon simulation: not executed by this production gate; see Neon DB Verify workflow")
print("Video E2E simulation: not executed by this production gate; see Video WebRTC E2E workflow")
print("LiveKit SFU 3/5/10 media: not executed by this production gate; see LiveKit SFU E2E workflow")
print("TURN relay: not asserted by this production gate")
print(f"Remaining blockers: {', '.join(blockers) if blockers else 'none for this production gate'}")
print(f"\nPRODUCTION_VERIFY={'PASS' if all_pass else 'FAIL'}")

sys.exit(0 if all_pass else 1)
