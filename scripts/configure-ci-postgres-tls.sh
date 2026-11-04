#!/usr/bin/env bash
# TLS for the disposable GitHub service only; never change application policy.
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${NODE_ENV:-}" = test
test -n "${RUNNER_TEMP:-}"
test -n "${GITHUB_ENV:-}"
container_id="${1:?Pass the PostgreSQL service container ID}"
[[ "$container_id" =~ ^[a-f0-9]{12,64}$ ]]
database_name="$(docker exec "$container_id" printenv POSTGRES_DB)"
[[ "$database_name" =~ ^doctarx_[a-z0-9_]+_test$ ]]
case "$(docker inspect --format '{{.Config.Image}}' "$container_id")" in
  postgres:16|postgres:18) ;;
  *) echo 'Expected the disposable PostgreSQL service image' >&2; exit 1 ;;
esac
certificate_dir="$(mktemp -d "$RUNNER_TEMP/doctarx-pg-tls.XXXXXX")"
umask 077
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -sha256 \
  -subj '/CN=DoctaRx fictional CI database CA' \
  -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' \
  -keyout "$certificate_dir/ca.key" -out "$certificate_dir/ca.crt" 2>/dev/null
openssl req -new -newkey rsa:2048 -nodes -subj '/CN=localhost' \
  -keyout "$certificate_dir/server.key" -out "$certificate_dir/server.csr" 2>/dev/null
cat > "$certificate_dir/extensions" <<'EOF'
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -in "$certificate_dir/server.csr" -CA "$certificate_dir/ca.crt" \
  -CAkey "$certificate_dir/ca.key" -CAcreateserial -days 1 -sha256 \
  -extfile "$certificate_dir/extensions" -out "$certificate_dir/server.crt" 2>/dev/null
docker cp "$certificate_dir/server.key" "$container_id:/tmp/doctarx-ci-server.key"
docker cp "$certificate_dir/server.crt" "$container_id:/tmp/doctarx-ci-server.crt"
docker exec --user root "$container_id" chown postgres:postgres /tmp/doctarx-ci-server.key /tmp/doctarx-ci-server.crt
docker exec --user root "$container_id" chmod 600 /tmp/doctarx-ci-server.key
docker exec --user postgres "$container_id" psql -U postgres -d "$database_name" -v ON_ERROR_STOP=1 \
  -c "ALTER SYSTEM SET ssl_cert_file='/tmp/doctarx-ci-server.crt'" \
  -c "ALTER SYSTEM SET ssl_key_file='/tmp/doctarx-ci-server.key'" \
  -c "ALTER SYSTEM SET ssl='on'" -c 'SELECT pg_reload_conf()'
# Require real verified TLS before making the CA available to browser jobs.
verified=false
for attempt in {1..20}; do
  if test "$(PGSSLMODE=verify-full PGSSLROOTCERT="$certificate_dir/ca.crt" psql "$DATABASE_URL" -Atc 'SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()' 2>/dev/null)" = t; then
    verified=true; break
  fi
  sleep 0.25
done
test "$verified" = true
printf 'DOCTARX_TEST_PG_CA=%s\n' "$certificate_dir/ca.crt" >> "$GITHUB_ENV"
echo 'Disposable database: verified TLS connection established.'
