# DoctaRx Nigeria — Production Deploy Runbook (EC2 host)

This runbook covers the steps that **must run on the EC2 instance** (they need the
real `.env`, the Neon/RDS network path, PM2, nginx, and coturn). The application
build itself is CI-verified — `npm run build` produces a clean `.next/BUILD_ID`
with no compile errors (217 static pages generated).

> Runtime entrypoint is `server/index.js` (a custom Express server that embeds
> Next.js) started by PM2 — **not** `next start`. Health: `/health`, `/readyz`,
> `/api/health` (the last returns `healthy` only once Next reports `ready`).

---

## 0. One-time prerequisites on the host
- Node 22.x, PM2 (`npm i -g pm2`), nginx, certbot, coturn installed.
- DNS: `doctarx.com` / `www.doctarx.com` → this EC2 Elastic IP.
- `.env` present in the project root, populated from `env.example`. Required keys
  validated by `deploy.sh`: `DATABASE_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `ENCRYPTION_KEY`, `NODE_ENV=production`. Also set `NEXT_PUBLIC_APP_URL=https://doctarx.com`.

## 1. Pull the release
```bash
cd /home/ec2-user/zuma-teledoc
git fetch origin
git checkout claude/nice-davinci-1fha9   # or merge to main first, then checkout main
git pull
```

## 2. Build + migrate (deploy.sh does load-env → RDS cert → install → migrate → build)
```bash
./deploy.sh
# DB is Neon (primary) + AWS RDS (backup) over node-postgres (pg). Migrations:
#   npm run migrate        # server/db/migrate.js
#   npm run ng:migrate     # ng/migrations/migrate.js  (Nigeria modules)
# Verify SSL: deploy.sh exports PGSSLROOTCERT to the RDS global bundle.
npm run validate:db        # sanity-check Neon + AWS connectivity before serving
```

## 3. Smoke-test BEFORE handing to PM2 (avoid crash loops on missing BUILD_ID)
```bash
test -f .next/BUILD_ID || { echo "BUILD_ID missing — rebuild before starting"; exit 1; }
node server/index.js &     # foreground sanity boot
sleep 5
curl -fsS http://localhost:3000/api/health   # expect {"status":"healthy",...}
kill %1
```

## 4. Start under PM2
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 status
```
> The web app is intentionally `exec_mode: fork`, `instances: 1`. Socket.IO room
> and presence state is in-process (no Redis adapter), so cluster mode would split
> rooms across workers and break multi-party conferencing. To scale later: add
> `@socket.io/redis-adapter`, move the `Map`s in `server/services/socketService.js`
> to Redis, then restore `cluster`/`instances: max` and add `ip_hash` in nginx.

## 5. nginx (WebSocket-aware reverse proxy)
```bash
sudo cp config/nginx/doctarx.conf /etc/nginx/conf.d/doctarx.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 6. TLS (certbot)
```bash
sudo certbot --nginx -d doctarx.com -d www.doctarx.com
```

## 7. coturn (TURN/STUN — required for Nigerian carrier-grade/symmetric NAT)
Mobile networks in Nigeria frequently use symmetric NAT; plain STUN is not enough,
so a relay is mandatory for reliable video. `/etc/turnserver.conf`:
```conf
listening-port=3478
tls-listening-port=5349
fingerprint
use-auth-secret
static-auth-secret=<TURN_SHARED_SECRET>        # also expose to the app env
realm=doctarx.com
cert=/etc/letsencrypt/live/doctarx.com/fullchain.pem
pkey=/etc/letsencrypt/live/doctarx.com/privkey.pem
no-cli
min-port=49152
max-port=65535
```
```bash
sudo systemctl enable --now coturn
# open UDP/TCP 3478, 5349 and UDP 49152-65535 in the EC2 security group
```
Confirm the app advertises these ICE servers — see `getTelehealthIceServers()` in
`server/services/telehealthSessionService.js`; wire the TURN URL + credential there
via env so clients receive the relay.

## 8. Post-deploy verification (run from a real network, not the host loopback)
```bash
curl -I https://doctarx.com
curl -fsS https://doctarx.com/api/health        # status: healthy
# WebSocket upgrade should return HTTP/1.1 101:
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
     "https://doctarx.com/socket.io/?EIO=4&transport=websocket"
```
Then validate from a browser (these need real clients — cannot be asserted from CLI):
- Realtime chat connects (Socket.IO).
- Two participants join a conference room and see each other's media (ICE/TURN).
- A referral with attached SOAP note + prescription persists and is retrievable.

## Rollback
```bash
pm2 stop zuma-teledoc cronops
git checkout <previous-good-sha>
./deploy.sh && pm2 restart ecosystem.config.js --env production && pm2 save
```
