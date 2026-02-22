# DevOps & Deployment Skills — DoctaRx / EC2

> These skills teach OpenClaw how to commit code to GitHub and deploy it to the DoctaRx EC2 server safely and professionally, using the same patterns Claude Code uses.

---

## Infrastructure Reference

| Item | Value |
|------|-------|
| EC2 Instance ID | `i-067815cf18600a570` |
| EC2 Public IP | `3.141.34.168` |
| Availability Zone | `us-east-2b` |
| AWS Region | `us-east-2` |
| OS User | `ec2-user` |
| App Directory | `/home/ec2-user/zuma-teledoc` |
| Git Branch | `main` |
| PM2 App (Next.js) | `doctarx` |
| PM2 App (Cron) | `cronops` |
| Deploy Webhook | `POST https://doctarx.com/api/deploy` |
| Deploy Token Header | `x-deploy-token: doctarx-deploy-2026` |
| Server Port | `3001` |
| Health Check | `GET https://doctarx.com/api/health` |

---

## GOLDEN RULES (Never Violate)

1. **Never force-push to main.** Always `git pull --rebase` before pushing.
2. **Never `git reset --hard` local changes** without user confirmation.
3. **Never commit secrets** — `.env`, credentials, API keys.
4. **Never skip the health check** after deploy. Always verify `{"ready":true}`.
5. **The deploy webhook does NOT rebuild frontend.** If you changed any Next.js page or component, you MUST do a force rebuild via SSH — not just the webhook.
6. **Always use `nohup` for long SSH commands** so the build survives the 60-second SSH window.
7. **Stage specific files**, not `git add .` or `git add -A`, to avoid accidentally committing `.env` or large binaries.

---

## SKILL: Commit and Push Code to GitHub

### When to use
When you have made file changes locally and need to save them to GitHub.

### Step-by-step

```bash
# 1. Check what changed
git status
git diff --stat

# 2. Stage specific files (NEVER use git add . blindly)
git add path/to/file1.js path/to/file2.js

# 3. Commit with a clear, professional message
git commit -m "$(cat <<'EOF'
Brief description of what changed and why

Co-Authored-By: OpenClaw <noreply@openclaw.ai>
EOF
)"

# 4. Pull remote changes first (ALWAYS — avoids rejected push)
git pull --rebase origin main

# 5. Push
git push origin main
```

### If push is rejected
```bash
git pull --rebase origin main
# Resolve any conflicts, then:
git push origin main
```

### What a good commit message looks like
```
Fix: patient dashboard crashing on empty appointment list

Add null check before mapping appointments array to prevent
TypeError when new patients have no visit history.
```

---

## SKILL: Trigger a Fast Deploy (Server-side changes only)

### When to use
When you changed **server-side code only** — Express routes, API handlers, environment config — and the Next.js frontend was NOT modified.

The deploy webhook will:
- `git pull origin main` on the server
- Skip the frontend build (saves time)
- Restart PM2 processes

### Step-by-step

```bash
curl -s -X POST https://doctarx.com/api/deploy \
  -H "Content-Type: application/json" \
  -H "x-deploy-token: doctarx-deploy-2026" \
  -d '{}'
```

### Expected response
```json
{"success":true,"message":"Deploy triggered"}
```

### After triggering, wait 30 seconds then verify
```bash
curl -s https://doctarx.com/api/health
# Must return: {"ready":true, ...}
```

### If you get `{"success":false,"message":"Deploy already in progress"}`
Wait 2 minutes and try again. A previous deploy is still running.

---

## SKILL: Force Full Rebuild and Deploy (Frontend changes)

### When to use
**Any time you modified a Next.js file** — pages, components, layouts, CSS, anything in the `app/` or `components/` directory. The webhook skips `npm run build` if `.next/` exists, so frontend changes will NOT appear without a force rebuild.

### How to connect to EC2 (AWS EC2 Instance Connect)

EC2 Instance Connect gives you a 60-second SSH window. You must generate a temp key, push it, then SSH — all within that window.

```bash
# Step 1: Generate a temporary SSH key pair
ssh-keygen -t rsa -f /tmp/ec2_deploy -N "" -q

# Step 2: Push the public key to EC2 (60-second window starts now)
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-067815cf18600a570 \
  --instance-os-user ec2-user \
  --availability-zone us-east-2b \
  --region us-east-2 \
  --ssh-public-key file:///tmp/ec2_deploy.pub

# Step 3: SSH in immediately and kick off background build
ssh -i /tmp/ec2_deploy \
  -o StrictHostKeyChecking=no \
  ec2-user@3.141.34.168 \
  "cd /home/ec2-user/zuma-teledoc && \
   git pull origin main && \
   nohup bash -c 'npm run build > /tmp/build.log 2>&1 && \
   pm2 restart doctarx && \
   echo BUILD_DONE >> /tmp/build.log' \
   > /tmp/build_outer.log 2>&1 &"
```

> **Why `nohup`?** The SSH session only lasts 60 seconds. `nohup` detaches the build process from the session so it keeps running after SSH disconnects. Without it, the build dies when the connection closes.

### Step 4: Check build progress (new SSH session, ~3 minutes later)

```bash
# Re-push key for a new SSH session
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-067815cf18600a570 \
  --instance-os-user ec2-user \
  --availability-zone us-east-2b \
  --region us-east-2 \
  --ssh-public-key file:///tmp/ec2_deploy.pub

ssh -i /tmp/ec2_deploy \
  -o StrictHostKeyChecking=no \
  ec2-user@3.141.34.168 \
  "tail -30 /tmp/build.log && pm2 list"
```

### What success looks like in build.log
```
✓ Compiled successfully
Route (app)           Size    First Load JS
...
BUILD_DONE
```

### What pm2 list should show
```
┌──────────┬───────────┬──────┬────────┬─────┐
│ name     │ status    │ ↺    │ cpu    │ mem │
├──────────┼───────────┼──────┼────────┼─────┤
│ doctarx  │ online    │ 0    │ 0%     │ ~   │
│ cronops  │ online    │ 0    │ 0%     │ ~   │
└──────────┴───────────┴──────┴────────┴─────┘
```

### Final health check
```bash
curl -s https://doctarx.com/api/health
# Must return: {"ready":true}
```

---

## SKILL: Verify Deployment Succeeded

### Always run this after any deploy

```bash
# 1. Check app is alive and Next.js ready
curl -s https://doctarx.com/api/health

# 2. Check the homepage returns 200 (not warmup loader)
curl -s -o /dev/null -w "%{http_code}" https://doctarx.com/
# Must be 200

# 3. If health returns {"ready":false} — Next.js is still loading or crashed
# Wait 30 seconds and retry. If still false after 2 minutes, force restart:
```

### If server is stuck (ready: false, warmup loader showing)

```bash
# SSH in and check for stuck processes
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-067815cf18600a570 \
  --instance-os-user ec2-user \
  --availability-zone us-east-2b \
  --region us-east-2 \
  --ssh-public-key file:///tmp/ec2_deploy.pub

ssh -i /tmp/ec2_deploy \
  -o StrictHostKeyChecking=no \
  ec2-user@3.141.34.168 \
  "ps aux | grep node | grep -v grep"

# If a process is at 100% CPU and has been running for > 5 minutes, it is stuck:
ssh -i /tmp/ec2_deploy \
  -o StrictHostKeyChecking=no \
  ec2-user@3.141.34.168 \
  "pkill -9 -f 'node server/index.js' && sleep 2 && PORT=3001 pm2 start server/index.js --name doctarx --update-env"
```

---

## SKILL: Check PM2 Logs for Errors

```bash
# Push key and SSH in
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-067815cf18600a570 \
  --instance-os-user ec2-user \
  --availability-zone us-east-2b \
  --region us-east-2 \
  --ssh-public-key file:///tmp/ec2_deploy.pub

ssh -i /tmp/ec2_deploy \
  -o StrictHostKeyChecking=no \
  ec2-user@3.141.34.168 \
  "pm2 logs doctarx --lines 50 --nostream"
```

---

## DECISION TREE: Which Deploy Path?

```
Did you change any file in app/, components/, or public/?
├── YES → Force Full Rebuild (SSH + npm run build + pm2 restart)
└── NO  → Did you change server/, .env, or API routes?
          ├── YES → Trigger Deploy Webhook (fast)
          └── NO  → No deploy needed, changes are config/docs only
```

---

## Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `git push` rejected | Remote has newer commits | `git pull --rebase origin main` then push |
| `{"ready":false}` after deploy | Next.js build crashed or stuck process | Check `pm2 logs`, run force restart |
| Warmup loader showing on site | `nextReady = false` — stale Node process | Kill stuck process, restart pm2 |
| New page/feature not showing | Webhook skipped build | Force rebuild via SSH |
| SSH times out | 60-second window expired | Re-push key and open new SSH session |
| `PORT` env var ignored | `dotenv` doesn't override shell env | Use `PORT=3001 pm2 start ...` explicitly |
| Build hangs > 30 min | OOM or infinite loop in build | Kill `npm run build` process, check for circular imports |

---

## Safety Checklist Before Any Deploy

- [ ] Code reviewed — no secrets, no `.env` values hardcoded
- [ ] `git status` shows only intended files staged
- [ ] Commit message is clear and professional
- [ ] `git pull --rebase` done before push
- [ ] Identified correct deploy path (webhook vs force rebuild)
- [ ] Health check planned after deploy
- [ ] User informed before destructive server operations
