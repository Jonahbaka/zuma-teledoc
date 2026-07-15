#!/usr/bin/env bash
set -Eeuo pipefail

NESTORA_SHA="${NESTORA_SHA:?NESTORA_SHA is required}"
NURSING_SHA="${NURSING_SHA:?NURSING_SHA is required}"
PUBLIC_IP="${PUBLIC_IP:?PUBLIC_IP is required}"
PILOT_PUBLIC_KEY="${PILOT_PUBLIC_KEY:-/tmp/nursing-pilot-recipient.pub}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

APPS_ROOT="/home/ec2-user/apps"
CONFIG_ROOT="/home/ec2-user/.config/doctarx-aux"
NESTORA_ROOT="$APPS_ROOT/nestora"
NURSING_ROOT="$APPS_ROOT/doctarx-nursing-education"
NESTORA_ENV="$CONFIG_ROOT/nestora.env"
NURSING_ENV="$CONFIG_ROOT/nursing.env"
PILOT_PASSWORD_FILE="$CONFIG_ROOT/nursing-pilot-password"
PILOT_SEEDED_FILE="$CONFIG_ROOT/nursing-pilot-seeded"
ECOSYSTEM_FILE="$APPS_ROOT/ecosystem.aux.config.cjs"
NGINX_BACKUP="/tmp/doctarx-nginx-before-aux-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
LOG_FILE="/tmp/doctarx-aux-deploy-$(date -u +%Y%m%dT%H%M%SZ).log"

exec > >(tee -a "$LOG_FILE") 2>&1

log() {
  printf '[aux-deploy] %s\n' "$*"
}

report_result() {
  local exit_code=$?
  trap - EXIT
  if [ "$exit_code" -eq 0 ]; then
    log '[aux-deploy:result] success'
  else
    log "[aux-deploy:result] failure exit=$exit_code"
  fi
  exit "$exit_code"
}

trap report_result EXIT

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    log "Required command is missing: $1"
    exit 1
  }
}

atomic_link() {
  local target="$1"
  local link="$2"
  ln -sfn "$target" "${link}.next"
  mv -Tf "${link}.next" "$link"
}

restore_link() {
  local previous="$1"
  local link="$2"
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    atomic_link "$previous" "$link"
  else
    rm -f "$link"
  fi
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local expected="$3"
  local body=""
  local code=""
  local response_file=""
  response_file="$(mktemp)"
  for attempt in $(seq 1 40); do
    code="$(curl -sS --max-time 12 -o "$response_file" -w '%{http_code}' "$url" 2>/dev/null || true)"
    body="$(cat "$response_file")"
    if [ "$code" = 200 ] && printf '%s' "$body" | grep -q "$expected"; then
      rm -f "$response_file"
      log "$name health check passed"
      return 0
    fi
    sleep 3
  done
  rm -f "$response_file"
  log "$name health check failed: $url (HTTP ${code:-unavailable}; response=${body:-empty})"
  return 1
}

start_with_env() (
  local env_file="$1"
  local app_name="$2"

  set -a
  source "$env_file"
  set +a
  pm2 delete "$app_name" >/dev/null 2>&1 || true
  pm2 start "$ECOSYSTEM_FILE" --env production --only "$app_name" --update-env
)

prepare_release() {
  local name="$1"
  local repository="$2"
  local sha="$3"
  local root="$4"
  local env_file="$5"
  local release="$root/releases/$sha"
  local staging="$root/releases/.${sha}.staging"

  mkdir -p "$root/releases"
  if [ -f "$release/.release-ready" ]; then
    log "$name release $sha is already built"
    PREPARED_RELEASE="$release"
    return 0
  fi

  case "$staging" in
    "$APPS_ROOT"/*) rm -rf "$staging" "$release" ;;
    *) log "Refusing to clean unexpected staging path: $staging"; exit 1 ;;
  esac

  log "Cloning $name release $sha"
  git clone --filter=blob:none --no-checkout "$repository" "$staging"
  git -C "$staging" fetch --depth=1 origin "$sha"
  git -C "$staging" checkout --detach "$sha"
  test "$(git -C "$staging" rev-parse HEAD)" = "$sha"
  ln -sfn "$env_file" "$staging/.env"

  log "Installing $name dependencies"
  (
    cd "$staging"
    npm ci --include=dev --no-audit --no-fund
  )

  log "Building $name"
  if [ "$name" = "Nestora" ]; then
    (
      cd "$staging"
      set -a
      source "$env_file"
      set +a
      nice -n 10 env NODE_OPTIONS=--max-old-space-size=2048 npm run build
      npm run migrate
    )
  else
    (
      cd "$staging"
      set -a
      source "$env_file"
      set +a
      nice -n 10 env NODE_OPTIONS=--max-old-space-size=2048 npm run build
      npm run test:bundle
      npm run migrate
    )
  fi

  touch "$staging/.release-ready"
  mv "$staging" "$release"
  PREPARED_RELEASE="$release"
}

for command in git node npm openssl psql curl python3 pm2; do
  require_command "$command"
done

log "Starting sequential auxiliary release on $(hostname)"
log "Disk and memory before deployment"
df -h / "$HOME"
free -h || true

AVAILABLE_KB="$(df -Pk "$HOME" | awk 'NR == 2 {print $4}')"
if [ "$AVAILABLE_KB" -lt 6291456 ]; then
  log "At least 6 GiB of free disk is required; available KiB=$AVAILABLE_KB"
  exit 1
fi

mkdir -p "$APPS_ROOT" "$CONFIG_ROOT" "$NESTORA_ROOT/releases" "$NURSING_ROOT/releases"
chmod 700 "$CONFIG_ROOT"
umask 077

if [ ! -s "$NESTORA_ENV" ]; then
  NESTORA_DB_PASSWORD="$(openssl rand -hex 24)"
  NESTORA_SESSION_SECRET="$(openssl rand -hex 32)"
  cat > "$NESTORA_ENV" <<EOF
NODE_ENV=production
PORT=3003
DATABASE_URL=postgresql://nestora_app:${NESTORA_DB_PASSWORD}@127.0.0.1:5432/nestora
DATABASE_SSL=false
DATABASE_SSL_REJECT_UNAUTHORIZED=false
DATABASE_POOL_MAX=10
NESTORA_SESSION_SECRET=${NESTORA_SESSION_SECRET}
NEXT_PUBLIC_APP_ORIGIN=https://nestora.doctarx.com
ADMIN_EMAIL=jonahbaka00@gmail.com
SUPPORT_EMAIL=jonahbaka00@gmail.com
CONTACT_EMAIL=jonahbaka00@gmail.com
EMAIL_FROM="Nestora <jonahbaka00@gmail.com>"
EMAIL_REPLY_TO=jonahbaka00@gmail.com
EOF
  chmod 600 "$NESTORA_ENV"
  unset NESTORA_SESSION_SECRET
fi

if [ ! -s "$NURSING_ENV" ]; then
  NURSING_DB_PASSWORD="$(openssl rand -hex 24)"
  NURSING_SESSION_SECRET="$(openssl rand -hex 32)"
  cat > "$NURSING_ENV" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3004
NEXT_PUBLIC_APP_URL=https://doctarx.com
NEXT_PUBLIC_ASSET_PREFIX=/nursing-education
NURSING_SESSION_SECRET=${NURSING_SESSION_SECRET}
DATABASE_URL=postgresql://doctarx_nursing:${NURSING_DB_PASSWORD}@127.0.0.1:5432/doctarx_nursing
DB_POOL_MAX=10
NEXT_PUBLIC_ENABLE_NURSING_ROLE_SWITCHER=false
DAILYMED_REQUEST_TIMEOUT_MS=25000
DAILYMED_CACHE_TTL_MS=21600000
DAILYMED_RETRY_DELAY_MS=350
EOF
  chmod 600 "$NURSING_ENV"
  unset NURSING_SESSION_SECRET
fi

if [ ! -s "$PILOT_PASSWORD_FILE" ]; then
  printf 'NrX!%s9a\n' "$(openssl rand -hex 12)" > "$PILOT_PASSWORD_FILE"
  chmod 600 "$PILOT_PASSWORD_FILE"
fi

NESTORA_DB_PASSWORD="$(python3 - "$NESTORA_ENV" <<'PY'
import sys
from urllib.parse import urlparse

for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("DATABASE_URL="):
        print(urlparse(line.rstrip().split("=", 1)[1]).password or "")
        break
PY
)"
NURSING_DB_PASSWORD="$(python3 - "$NURSING_ENV" <<'PY'
import sys
from urllib.parse import urlparse

for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("DATABASE_URL="):
        print(urlparse(line.rstrip().split("=", 1)[1]).password or "")
        break
PY
)"
test -n "$NESTORA_DB_PASSWORD"
test -n "$NURSING_DB_PASSWORD"

log "Provisioning isolated PostgreSQL roles and databases"
sudo -iu postgres psql -v ON_ERROR_STOP=1 \
  -v nestora_password="$NESTORA_DB_PASSWORD" \
  -v nursing_password="$NURSING_DB_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nestora_app') THEN
    CREATE ROLE nestora_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'doctarx_nursing') THEN
    CREATE ROLE doctarx_nursing LOGIN;
  END IF;
END
$$;
ALTER ROLE nestora_app WITH LOGIN PASSWORD :'nestora_password';
ALTER ROLE doctarx_nursing WITH LOGIN PASSWORD :'nursing_password';
SELECT 'CREATE DATABASE nestora OWNER nestora_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'nestora')\gexec
SELECT 'CREATE DATABASE doctarx_nursing OWNER doctarx_nursing'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'doctarx_nursing')\gexec
ALTER DATABASE nestora OWNER TO nestora_app;
ALTER DATABASE doctarx_nursing OWNER TO doctarx_nursing;
SQL

HBA_FILE="$(sudo -iu postgres psql -tAc 'SHOW hba_file;' | tr -d '[:space:]')"
NESTORA_HBA_RULE='host nestora nestora_app 127.0.0.1/32 scram-sha-256'
NURSING_HBA_RULE='host doctarx_nursing doctarx_nursing 127.0.0.1/32 scram-sha-256'
HBA_TMP="$(mktemp)"
printf '%s\n%s\n' "$NESTORA_HBA_RULE" "$NURSING_HBA_RULE" > "$HBA_TMP"
sudo grep -vxF \
  -e "$NESTORA_HBA_RULE" \
  -e "$NURSING_HBA_RULE" \
  "$HBA_FILE" >> "$HBA_TMP" || true
sudo install -o postgres -g postgres -m 600 "$HBA_TMP" "$HBA_FILE"
rm -f "$HBA_TMP"
sudo -iu postgres psql -v ON_ERROR_STOP=1 -c 'SELECT pg_reload_conf();' >/dev/null
unset NESTORA_DB_PASSWORD NURSING_DB_PASSWORD

prepare_release \
  Nestora \
  https://github.com/Jonahbaka/NESTORA.git \
  "$NESTORA_SHA" \
  "$NESTORA_ROOT" \
  "$NESTORA_ENV"
NESTORA_RELEASE="$PREPARED_RELEASE"

prepare_release \
  Nursing \
  https://github.com/Jonahbaka/DoctaRx_Nursing_Education.git \
  "$NURSING_SHA" \
  "$NURSING_ROOT" \
  "$NURSING_ENV"
NURSING_RELEASE="$PREPARED_RELEASE"

if [ ! -f "$PILOT_SEEDED_FILE" ]; then
  log "Loading controlled Nursing pilot accounts and training records"
  (
    cd "$NURSING_RELEASE"
    set -a
    source "$NURSING_ENV"
    set +a
    NURSING_TEST_ACCOUNT_PASSWORD="$(cat "$PILOT_PASSWORD_FILE")" npm run seed
  )
  touch "$PILOT_SEEDED_FILE"
  chmod 600 "$PILOT_SEEDED_FILE"
fi

log "Verifying the Nestora runtime database connection"
(
  cd "$NESTORA_RELEASE"
  set -a
  source "$NESTORA_ENV"
  set +a
  node --input-type=module <<'NODE'
import { getPool, query } from './lib/server/db.js';

await query('SELECT 1');
await getPool().end();
NODE
)

cat > "$ECOSYSTEM_FILE" <<'EOF'
module.exports = {
  apps: [
    {
      name: 'nestora',
      cwd: '/home/ec2-user/apps/nestora/current',
      script: '/bin/bash',
      args: ['-lc', 'set -a; source /home/ec2-user/.config/doctarx-aux/nestora.env; set +a; exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3003'],
      interpreter: 'none',
      max_memory_restart: '768M',
      time: true,
      env_production: { NODE_ENV: 'production' },
    },
    {
      name: 'doctarx-nursing-education',
      cwd: '/home/ec2-user/apps/doctarx-nursing-education/current',
      script: '/bin/bash',
      args: ['-lc', 'set -a; source /home/ec2-user/.config/doctarx-aux/nursing.env; set +a; exec node server/index.js'],
      interpreter: 'none',
      max_memory_restart: '1024M',
      time: true,
      env_production: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3004' },
    },
  ],
};
EOF

OLD_NESTORA="$(readlink -f "$NESTORA_ROOT/current" 2>/dev/null || true)"
log "Activating Nestora $NESTORA_SHA"
atomic_link "$NESTORA_RELEASE" "$NESTORA_ROOT/current"
if ! start_with_env "$NESTORA_ENV" nestora; then
  restore_link "$OLD_NESTORA" "$NESTORA_ROOT/current"
  [ -n "$OLD_NESTORA" ] && start_with_env "$NESTORA_ENV" nestora || true
  exit 1
fi
if ! wait_for_url Nestora 'http://127.0.0.1:3003/api/health?deep=1' '"status":"ok"'; then
  pm2 logs nestora --lines 80 --nostream || true
  restore_link "$OLD_NESTORA" "$NESTORA_ROOT/current"
  [ -n "$OLD_NESTORA" ] && start_with_env "$NESTORA_ENV" nestora || true
  exit 1
fi

OLD_NURSING="$(readlink -f "$NURSING_ROOT/current" 2>/dev/null || true)"
log "Activating Nursing Education $NURSING_SHA"
atomic_link "$NURSING_RELEASE" "$NURSING_ROOT/current"
if ! start_with_env "$NURSING_ENV" doctarx-nursing-education; then
  restore_link "$OLD_NURSING" "$NURSING_ROOT/current"
  [ -n "$OLD_NURSING" ] && start_with_env "$NURSING_ENV" doctarx-nursing-education || true
  exit 1
fi
if ! wait_for_url 'Nursing Education' 'http://127.0.0.1:3004/ng/nursing' '<!DOCTYPE html'; then
  pm2 logs doctarx-nursing-education --lines 80 --nostream || true
  restore_link "$OLD_NURSING" "$NURSING_ROOT/current"
  [ -n "$OLD_NURSING" ] && start_with_env "$NURSING_ENV" doctarx-nursing-education || true
  exit 1
fi
pm2 save

log "Installing nginx routes with rollback protection"
sudo tar -czf "$NGINX_BACKUP" -C / etc/nginx/nginx.conf etc/nginx/conf.d

if ! sudo grep -Rqs 'server_name[[:space:]].*nestora\.doctarx\.com' /etc/nginx/conf.d; then
  cat > /tmp/nestora.conf <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name nestora.doctarx.com;

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        client_max_body_size 25m;
    }
}
NGINX
  sudo install -o root -g root -m 644 /tmp/nestora.conf /etc/nginx/conf.d/nestora.conf
fi

sudo python3 "$SCRIPT_DIR/install_nursing_nginx.py"
if ! sudo nginx -t; then
  log "nginx validation failed; restoring the pre-deployment configuration"
  sudo rm -f /etc/nginx/conf.d/nestora.conf
  sudo tar -xzf "$NGINX_BACKUP" -C /
  sudo nginx -t
  exit 1
fi
sudo systemctl reload nginx

NURSING_CODE="$(curl -k -sS -o /tmp/nursing-public.html -w '%{http_code}' \
  --resolve doctarx.com:443:127.0.0.1 \
  https://doctarx.com/nursing-education || true)"
if [ "$NURSING_CODE" != "200" ]; then
  log "Nursing nginx route returned HTTP $NURSING_CODE; restoring nginx"
  sudo rm -f /etc/nginx/conf.d/nestora.conf
  sudo tar -xzf "$NGINX_BACKUP" -C /
  sudo nginx -t
  sudo systemctl reload nginx
  exit 1
fi

NESTORA_LOCAL_CODE="$(curl -sS -o /tmp/nestora-public.json -w '%{http_code}' \
  -H 'Host: nestora.doctarx.com' \
  'http://127.0.0.1/api/health?deep=1' || true)"
test "$NESTORA_LOCAL_CODE" = "200"

DNS_READY=false
for attempt in $(seq 1 20); do
  if getent ahostsv4 nestora.doctarx.com 2>/dev/null | awk '{print $1}' | grep -qx "$PUBLIC_IP"; then
    DNS_READY=true
    break
  fi
  sleep 6
done

if [ "$DNS_READY" = true ]; then
  log "Nestora DNS is ready; provisioning or renewing TLS"
  if ! command -v certbot >/dev/null 2>&1; then
    sudo dnf install -y certbot python3-certbot-nginx
  fi
  sudo certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email jonahbaka00@gmail.com \
    --redirect \
    --keep-until-expiring \
    -d nestora.doctarx.com
  sudo nginx -t
  sudo systemctl reload nginx
  log "Nestora TLS is active"
else
  log "Nestora DNS does not yet resolve to $PUBLIC_IP; HTTP service is installed and TLS is pending DNS"
fi

if [ -s "$PILOT_PUBLIC_KEY" ]; then
  CIPHERTEXT="$(openssl pkeyutl \
    -encrypt \
    -pubin \
    -inkey "$PILOT_PUBLIC_KEY" \
    -pkeyopt rsa_padding_mode:oaep \
    -pkeyopt rsa_oaep_md:sha256 \
    -in "$PILOT_PASSWORD_FILE" | base64 -w0)"
  printf 'NURSING_PILOT_CREDENTIAL_CIPHERTEXT=%s\n' "$CIPHERTEXT"
fi

log "Deployment complete"
pm2 list
log "Log file: $LOG_FILE"
