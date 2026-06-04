#!/usr/bin/env python3
"""Parse the EC2 deploy status contract from `GET /api/deploy/log`.

Reads the JSON response on stdin and prints shell-evalable KEY=VALUE lines,
a `---VERIFY---` separator, then the human-readable deploy/verify log lines.

The poller `eval`s the KEY=VALUE block and acts on RESULT/STATUS. Output is
designed so the poller NEVER has to display `status=?`:

  RESULT=ok              -> STATUS is authoritative; act on it
  RESULT=transient       -> endpoint briefly unreachable / non-JSON (e.g. the
                            server is mid-`pm2 reload`); keep polling
  RESULT=contract_error  -> reachable but the response violates the contract
                            (ok!=true, or ok:true with no status AND no log
                            lines to derive from); fail the workflow loudly

Status enum: idle | running | success | failed | timeout | unknown
"""
import json
import sys

KNOWN = {"idle", "running", "success", "failed", "timeout", "unknown"}


def emit(key, value):
    print(f"{key}={value}")


def finish(result, reason="", payload=""):
    emit("RESULT", result)
    if reason:
        emit("REASON", reason)
    print("---VERIFY---")
    if payload:
        print(payload[:2000])
    sys.exit(0)


raw = sys.stdin.read()

# Empty body: curl timed out / connection refused. Transient — keep polling.
if not raw.strip():
    finish("transient", "empty_response")

# Non-JSON body: almost always an nginx 502/504 HTML page while the Node
# server is restarting during `pm2 reload`. Expected mid-deploy — transient.
try:
    data = json.loads(raw)
except Exception:
    finish("transient", "non_json_response")

if not isinstance(data, dict):
    finish("contract_error", "not_an_object", raw)

# A well-formed error envelope (e.g. 401 {ok:false,error:...}) is a real
# endpoint problem, not a transient one.
if data.get("ok") is not True:
    finish("contract_error", "ok_not_true", json.dumps(data))

lines = data.get("lastLines")
if not isinstance(lines, list):
    lines = data.get("lines") if isinstance(data.get("lines"), list) else []
joined = "\n".join(str(x) for x in lines)

status = data.get("status")
if status not in KNOWN:
    # Legacy server without the `status` field: derive it from the deploy log
    # markers the detached bash process writes (those are version-independent).
    sys.stderr.write(
        "WARN deploy_status: server response had no 'status' field; "
        "deriving from deploy-log markers (legacy server)\n"
    )
    if "[deploy] complete" in joined and "[verify:result] FAIL" not in joined:
        status = "success"
    elif "[deploy] failed" in joined or "[verify:result] FAIL" in joined:
        status = "failed"
    elif lines:
        status = "running"
    else:
        # ok:true but neither a status field nor any log lines to derive from:
        # the endpoint is not honoring the contract.
        finish("contract_error", "no_status_and_no_lines", json.dumps(data))

verified = data.get("verified")
if not isinstance(verified, bool):
    verified = "[verify:result] PASS" in joined

checks = data.get("checks") if isinstance(data.get("checks"), dict) else {}


def check(name):
    val = checks.get(name)
    if val in ("pending", "success", "failed"):
        return val
    if f"[deploy:check] {name}=success" in joined:
        return "success"
    if f"[deploy:check] {name}=failed" in joined:
        return "failed"
    return "pending"


exit_code = data.get("exitCode")
exit_code = "" if exit_code is None else exit_code

emit("RESULT", "ok")
emit("STATUS", status)
emit("VERIFIED", "true" if verified else "false")
emit("DEPLOYID", data.get("deployId") or "")
emit("PID", data.get("pid") or "")
emit("EXITCODE", exit_code)
emit("COMMIT", data.get("commit") or "")
emit("CHECK_BUILD", check("build"))
emit("CHECK_PM2", check("pm2"))
emit("CHECK_HEALTH", check("health"))
emit("CHECK_NGHEALTH", check("ngHealth"))

print("---VERIFY---")
markers = (
    "[verify", "[deploy]", "[deploy:check]", "livekit", "LiveKit", "SFU",
    "multiParty", "configured", "media", "pm2", "HTTP", "NG",
)
for line in lines:
    text = str(line)
    if any(m in text for m in markers):
        print(text)
