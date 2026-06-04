#!/usr/bin/env python3
"""Summarize browser WebRTC E2E evidence (artifacts/.../result.json) into the
exact required-evidence checklist, with PASS/FAIL per item. Report-only: the
e2e runner itself gates the job (it exits non-zero on failure). This makes the
CI log self-documenting and prevents over-claiming.
"""
import json
import sys

CONNECTED = ("connected", "completed")


def main(path):
    d = json.load(open(path))
    prov = d.get("provider", {}) or {}
    pat = d.get("patient", {}) or {}
    pc = prov.get("connected", {}) or {}
    qc = pat.get("connected", {}) or {}
    msg = d.get("messaging", {}) or {}
    signals = (d.get("fixture", {}) or {}).get("signals", []) or []
    sig_types = sorted({str(s.get("signalType", "")).lower() for s in signals if s.get("signalType")})

    def has(types, *needles):
        return any(any(n in t for n in needles) for t in types)

    checks = []
    checks.append(("provider+patient joined same room",
                   bool(pc.get("roomId")) and pc.get("roomId") == qc.get("roomId"),
                   f"provider room={pc.get('roomId')} patient room={qc.get('roomId')}"))
    checks.append(("signaling: offer present", has(sig_types, "offer"), f"types={sig_types}"))
    checks.append(("signaling: answer present", has(sig_types, "answer"), f"types={sig_types}"))
    checks.append(("signaling: ICE candidates present", has(sig_types, "candidate", "ice"),
                   f"types={sig_types}"))
    checks.append(("provider peerConnection connected",
                   str(pc.get("peerConnectionState")) in CONNECTED,
                   f"state={pc.get('peerConnectionState')} ice={pc.get('iceConnectionState')}"))
    checks.append(("patient peerConnection connected",
                   str(qc.get("peerConnectionState")) in CONNECTED,
                   f"state={qc.get('peerConnectionState')} ice={qc.get('iceConnectionState')}"))
    checks.append(("provider receives remote audio+video",
                   (pc.get("remoteAudioTrackCount", 0) >= 1) and (pc.get("remoteVideoTrackCount", 0) >= 1),
                   f"audio={pc.get('remoteAudioTrackCount')} video={pc.get('remoteVideoTrackCount')}"))
    checks.append(("patient receives remote audio+video",
                   (qc.get("remoteAudioTrackCount", 0) >= 1) and (qc.get("remoteVideoTrackCount", 0) >= 1),
                   f"audio={qc.get('remoteAudioTrackCount')} video={qc.get('remoteVideoTrackCount')}"))
    checks.append(("in-call chat both directions",
                   bool(msg.get("providerToPatient")) and bool(msg.get("patientToProvider")),
                   f"p->q={msg.get('providerToPatient')} q->p={msg.get('patientToProvider')}"))
    checks.append(("participants leave cleanly",
                   bool(prov.get("leftCleanly")) and bool(pat.get("leftCleanly")),
                   f"provider={prov.get('leftCleanly')} patient={pat.get('leftCleanly')}"))

    print("================ WEBRTC E2E EVIDENCE ================")
    print(f"finalResult (runner): {d.get('finalResult')}")
    print(f"environment: {d.get('environment')}")
    print(f"roomId: {d.get('roomId')}")
    if d.get("error"):
        print(f"error: {str(d.get('error'))[:500]}")
    for name, ok, detail in checks:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")

    all_ok = all(ok for _, ok, _ in checks) and d.get("finalResult") == "pass"
    print(f"\nWEBRTC_E2E={'PASS' if all_ok else 'FAIL'}")
    return 0  # report-only; the e2e runner exit code is the gate


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
