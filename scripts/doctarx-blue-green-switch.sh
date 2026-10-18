#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/doctarx.conf}"
SOURCE_DIST="${1:-${NEXT_STAGING_DIR:-.next.build}}"
DRAIN_SECONDS="${DRAIN_SECONDS:-45}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"

cd "$PROJECT_ROOT"

log() {
  printf '[bluegreen] %s\n' "$*"
}

json_ok() {
  local json="$1"
  local expr="$2"
  node -e '
    const data = JSON.parse(process.argv[1] || "{}");
    const expr = process.argv[2];
    if (expr === "api") {
      process.exit(data.status === "healthy" && data.nextReady === true ? 0 : 1);
    }
    if (expr === "ng") {
      process.exit(data.status === "ok" ? 0 : 1);
    }
    process.exit(1);
  ' "$json" "$expr" >/dev/null 2>&1
}

wait_for_api_health() {
  local port="$1"
  local expected_build="${2:-}"
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
  local body=""

  while [ "$(date +%s)" -lt "$deadline" ]; do
    body="$(curl -s --max-time 10 "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)"
    if json_ok "$body" api && { [ -z "$expected_build" ] || node -e 'const h=JSON.parse(process.argv[1]);process.exit(h.buildId===process.argv[2]?0:1)' "$body" "$expected_build"; }; then
      log "candidate api health ok on port ${port}"
      return 0
    fi
    sleep 2
  done

  log "candidate api health failed on port ${port}: ${body}"
  return 1
}

wait_for_ng_health() {
  local port="$1"
  local deadline=$(( $(date +%s) + 60 ))
  local body=""

  while [ "$(date +%s)" -lt "$deadline" ]; do
    body="$(curl -s --max-time 10 "http://127.0.0.1:${port}/api/ng/health" 2>/dev/null || true)"
    if json_ok "$body" ng; then
      log "candidate ng health ok on port ${port}"
      return 0
    fi
    sleep 2
  done

  log "candidate ng health failed on port ${port}: ${body}"
  return 1
}

current_nginx_port() {
  local port
  port="$(sudo grep -Eo 'proxy_pass http://127[.]0[.]0[.]1:(3001|3002);' "$NGINX_CONF" 2>/dev/null | head -1 | grep -Eo '(3001|3002)' || true)"
  if [ -z "$port" ]; then
    port="3001"
  fi
  printf '%s' "$port"
}

stop_pm2_name() {
  local name="$1"
  pm2 delete "$name" >/dev/null 2>&1 || true
}

verify_switched_nginx() {
  local expected_build_id="$1"
  local body=""

  for _ in $(seq 1 30); do
    body="$(curl -s --max-time 10 --resolve doctarx.com:443:127.0.0.1 https://doctarx.com/api/health 2>/dev/null || true)"
    if json_ok "$body" api && printf '%s' "$body" | grep -Fq -- "$expected_build_id"; then
      log "nginx route verified with build ${expected_build_id}"
      return 0
    fi
    sleep 2
  done

  log "nginx route verification failed: ${body}"
  return 1
}

if [ ! -s "${SOURCE_DIST}/BUILD_ID" ]; then
  log "missing candidate build id at ${SOURCE_DIST}/BUILD_ID"
  exit 1
fi

# Cloudflare Tunnel installations route directly to the named PM2 process.
# Validate the candidate on a second loopback port, then restart only that app.
# The tunnel and security groups are never changed. Keep the prior build for
# rollback if the process fails to serve the exact accepted build.
if [ "${DEPLOY_TRANSPORT:-auto}" = cloudflare-tunnel ] || { [ ! -f "$NGINX_CONF" ] && ! command -v nginx >/dev/null 2>&1; }; then
  app_name="${PM2_APP_NAME:?Set the existing PM2 application name}"
  [[ "$app_name" =~ ^[A-Za-z0-9_-]+$ ]] || exit 1
  origin_port="${DEPLOY_ORIGIN_PORT:-8080}"
  candidate_port="${DEPLOY_CANDIDATE_PORT:-8081}"
  [[ "$origin_port" =~ ^[0-9]{2,5}$ && "$candidate_port" =~ ^[0-9]{2,5}$ ]] || exit 1
  [ "$origin_port" -le 65535 ] && [ "$candidate_port" -le 65535 ] && [ "$origin_port" != "$candidate_port" ]
  previous_dist="$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const p=JSON.parse(s).find(p=>p.name===process.argv[1]);if(!p||p.pm2_env.status!=="online")process.exit(1);process.stdout.write(p.pm2_env.NEXT_DIST_DIR||".next")})' "$app_name")"
  [[ "$previous_dist" =~ ^\.next([.][A-Za-z0-9_-]+)?$ ]] || exit 1
  candidate_dist=".next.blue"
  [ "$previous_dist" != "$candidate_dist" ] || candidate_dist=".next.green"
  [ -s "$previous_dist/BUILD_ID" ] || exit 1
  previous_build_id="$(tr -d '[:space:]' < "$previous_dist/BUILD_ID")"
  build_id="$(tr -d '[:space:]' < "$SOURCE_DIST/BUILD_ID")"
  candidate_name="${app_name}-deploy-check"
  stop_pm2_name "$candidate_name"
  if [ "$SOURCE_DIST" != "$candidate_dist" ]; then
    rm -rf "$candidate_dist"
    mv "$SOURCE_DIST" "$candidate_dist"
  fi
  switched=no
  candidate_cleanup() {
    rc=$?
    trap - EXIT
    stop_pm2_name "$candidate_name"
    if [ "$rc" != 0 ] && [ "$switched" = yes ]; then
      log "restoring ${app_name} to ${previous_dist}"
      NODE_ENV=production PORT="$origin_port" NEXT_DIST_DIR="$previous_dist" APP_BUILD_ID="$previous_build_id" \
        pm2 restart "$app_name" --update-env
      wait_for_api_health "$origin_port" || true
      pm2 save >/dev/null 2>&1 || true
    fi
    exit "$rc"
  }
  trap candidate_cleanup EXIT
  NODE_ENV=production PORT="$candidate_port" NEXT_DIST_DIR="$candidate_dist" APP_BUILD_ID="$build_id" \
    pm2 start server/index.js --name "$candidate_name" --cwd "$PROJECT_ROOT" --wait-ready --listen-timeout 15000 --kill-timeout 30000 --max-memory-restart 1500M --time
  wait_for_api_health "$candidate_port" "$build_id"
  wait_for_ng_health "$candidate_port"
  stop_pm2_name "$candidate_name"
  switched=yes
  NODE_ENV=production PORT="$origin_port" NEXT_DIST_DIR="$candidate_dist" APP_BUILD_ID="$build_id" \
    pm2 restart "$app_name" --update-env
  wait_for_api_health "$origin_port"
  wait_for_ng_health "$origin_port"
  curl -fsS --max-time 10 "http://127.0.0.1:$origin_port/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const h=JSON.parse(s);if(h.buildId!==process.argv[1]||h.nextReady!==true||h.status!=="healthy")process.exit(1)})' "$build_id"
  printf '%s\n' "$origin_port" > .doctarx-active-port
  pm2 save >/dev/null
  switched=no
  log "complete app=${app_name} origin_port=${origin_port} build=${build_id}"
  exit 0
fi

active_port="$(current_nginx_port)"
if [ "$active_port" = "3001" ]; then
  candidate_port="3002"
  candidate_slot="green"
  previous_names=("zuma-teledoc" "zuma-teledoc-blue")
else
  candidate_port="3001"
  candidate_slot="blue"
  previous_names=("zuma-teledoc-green")
fi

candidate_name="zuma-teledoc-${candidate_slot}"
candidate_dist=".next.${candidate_slot}"
build_id="$(tr -d '[:space:]' < "${SOURCE_DIST}/BUILD_ID")"

log "active_port=${active_port} candidate_port=${candidate_port} slot=${candidate_slot} build=${build_id}"

if [ "$SOURCE_DIST" != "$candidate_dist" ]; then
  rm -rf "${candidate_dist}.incoming"
  mv "$SOURCE_DIST" "${candidate_dist}.incoming"
  rm -rf "$candidate_dist"
  mv "${candidate_dist}.incoming" "$candidate_dist"
fi

stop_pm2_name "$candidate_name"
if [ "$candidate_port" = "3001" ]; then
  stop_pm2_name "zuma-teledoc"
fi

log "starting candidate ${candidate_name} on port ${candidate_port}"
NODE_ENV=production \
PORT="$candidate_port" \
NEXT_DIST_DIR="$candidate_dist" \
APP_BUILD_ID="$build_id" \
pm2 start server/index.js \
  --name "$candidate_name" \
  --cwd "$PROJECT_ROOT" \
  --wait-ready \
  --listen-timeout 15000 \
  --kill-timeout 30000 \
  --max-memory-restart 1500M \
  --time \
  --update-env

wait_for_api_health "$candidate_port"
wait_for_ng_health "$candidate_port"

backup_conf="/tmp/doctarx-nginx-$(date -u +%Y%m%dT%H%M%SZ).conf"
sudo cp "$NGINX_CONF" "$backup_conf"

log "switching nginx from ${active_port} to ${candidate_port}"
sudo perl -0pi -e "s#proxy_pass http://127\\.0\\.0\\.1:(?:3001|3002);#proxy_pass http://127.0.0.1:${candidate_port};#g" "$NGINX_CONF"

if ! sudo nginx -t; then
  log "nginx config test failed; restoring ${backup_conf}"
  sudo cp "$backup_conf" "$NGINX_CONF"
  sudo nginx -t
  exit 1
fi

sudo nginx -s reload

if ! verify_switched_nginx "$build_id"; then
  log "route verification failed; rolling nginx back to ${active_port}"
  sudo cp "$backup_conf" "$NGINX_CONF"
  sudo nginx -t
  sudo nginx -s reload
  stop_pm2_name "$candidate_name"
  exit 1
fi

pm2 save >/dev/null 2>&1 || true
printf '%s\n' "$candidate_port" > .doctarx-active-port

if [ "$DRAIN_SECONDS" -gt 0 ]; then
  log "draining previous port ${active_port} for ${DRAIN_SECONDS}s"
  sleep "$DRAIN_SECONDS"
  for name in "${previous_names[@]}"; do
    stop_pm2_name "$name"
  done
  pm2 save >/dev/null 2>&1 || true
fi

log "complete active_port=${candidate_port} active_app=${candidate_name}"
