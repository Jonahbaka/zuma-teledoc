"""Recover only the configured PM2 app via the existing GitHub OIDC role.

No source resets, package downloads, fixture seeds, IAM or network mutations.
AWS CLI credentials are supplied by configure-aws-credentials, never printed.
"""
import json
import os
import re
import shlex
import subprocess
import time


def aws(service, operation, **params):
    command = ["aws", service, operation, "--region", os.environ["AWS_REGION"], "--output", "json", "--cli-input-json", json.dumps(params)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=45, check=False)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)


def host_script(env):
    action = env.get("RECOVERY_ACTION", "diagnose-only")
    directory = env.get("EC2_APP_DIR", "")
    user = env.get("EC2_APP_USER", "")
    app = env.get("EC2_PM2_APP", "")
    port = env.get("EC2_HEALTH_PORT", "")
    if action not in ("diagnose-only", "restart-services"):
        raise ValueError("Unsupported recovery action")
    if not re.fullmatch(r"/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+", directory) or directory.count("/") < 2:
        raise ValueError("Use an explicit application directory")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", user) or not re.fullmatch(r"[A-Za-z0-9_-]+", app) or app in ('all', 'cftunnel', 'cloudflared'):
        raise ValueError("Use the recorded operating user and PM2 app")
    if not port.isdigit() or not 1024 <= int(port) <= 65535:
        raise ValueError("Use the recorded unprivileged origin port")
    commands = ["set -euo pipefail", f"cd {shlex.quote(directory)}", "uptime", "df -h . /tmp", "pm2 list"]
    if action == "restart-services":
        commands += [f"pm2 restart {shlex.quote(app)} --update-env", "pm2 save"]
    commands += [
        "healthy=no",
        "for attempt in $(seq 1 40); do",
        f'  body=$(curl -sS --max-time 5 http://127.0.0.1:{port}/api/health || true)',
        "  if printf '%s' \"$body\" | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d);process.stdin.on(\"end\",()=>{try{const h=JSON.parse(s);process.exit(h.status===\"healthy\"&&h.nextReady===true?0:1)}catch{process.exit(1)}})'; then healthy=yes; printf '%s\\n' \"$body\"; break; fi",
        "  sleep 3",
        "done",
        '[ "$healthy" = yes ]',
        f"curl --fail --silent --show-error --max-time 10 http://127.0.0.1:{port}/api/ng/health",
    ]
    script = "\n".join(commands)
    if user == "root":
        return script
    return f"runuser -u {shlex.quote(user)} -- bash -lc {shlex.quote(script)}"


def main():
    instance_id = os.environ["EC2_INSTANCE_ID"]
    if not re.fullmatch(r"i-[0-9a-f]{8,17}", instance_id):
        raise ValueError("Use the verified EC2 instance ID")
    instance = aws("ec2", "describe-instances", InstanceIds=[instance_id])["Reservations"][0]["Instances"][0]
    if instance["State"]["Name"] != "running":
        raise RuntimeError("Configured instance must be running; this workflow does not change instance power")
    information = aws("ssm", "describe-instance-information", Filters=[{"Key": "InstanceIds", "Values": [instance_id]}])["InstanceInformationList"]
    if not information or information[0]["PingStatus"] != "Online":
        raise RuntimeError("Configured instance is not online in SSM")
    sent = aws("ssm", "send-command", InstanceIds=[instance_id], DocumentName="AWS-RunShellScript", Comment="DoctaRx configured app recovery through GitHub OIDC", TimeoutSeconds=300, Parameters={"commands": [host_script(os.environ)], "executionTimeout": ["240"]})
    command_id = sent["Command"]["CommandId"]
    print(f"SSM command {command_id} on {instance_id}", flush=True)
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        try:
            result = aws("ssm", "get-command-invocation", CommandId=command_id, InstanceId=instance_id)
        except RuntimeError as error:
            if "InvocationDoesNotExist" not in str(error):
                raise
            time.sleep(3)
            continue
        if result["Status"] in ("Pending", "InProgress", "Delayed"):
            time.sleep(5)
            continue
        print(result.get("StandardOutputContent", ""), flush=True)
        if result["Status"] != "Success" or result["ResponseCode"] != 0:
            print(result.get("StandardErrorContent", ""), flush=True)
            raise RuntimeError(f"Recovery command ended with {result['Status']}")
        return
    raise TimeoutError("SSM command did not finish within the bounded recovery window")


if __name__ == "__main__":
    main()
