#!/usr/bin/env bash
# =============================================================================
# deploy.sh — ZumaTeledoc Deployment Script
# =============================================================================
# Usage: ./deploy.sh
# Requires: .env file in the project root with all required variables set.
# =============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ── 1. Load .env ─────────────────────────────────────────────────────────────
ENV_FILE="./.env"
if [ ! -f "$ENV_FILE" ]; then
  error ".env file not found. Copy env.example → .env and fill in your values."
fi
info "Loading environment from $ENV_FILE"
set -o allexport
source "$ENV_FILE"
set +o allexport

# ── 2. Validate required variables ───────────────────────────────────────────
info "Validating required environment variables..."

REQUIRED_VARS=(
  "DATABASE_URL"
  "AWS_REGION"
  "AWS_ACCESS_KEY_ID"
  "AWS_SECRET_ACCESS_KEY"
  "JWT_ACCESS_SECRET"
  "JWT_REFRESH_SECRET"
  "ENCRYPTION_KEY"
  "NODE_ENV"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    error "Required variable '$var' is not set in .env"
  fi
done
info "All required variables present."

# ── 3. Safety checks ─────────────────────────────────────────────────────────
# Warn if .env is accidentally tracked by git
if git ls-files --error-unmatch .env &>/dev/null 2>&1; then
  error ".env is tracked by git! Remove it with: git rm --cached .env"
fi

# Warn if global-bundle.pem is tracked
if git ls-files --error-unmatch global-bundle.pem &>/dev/null 2>&1; then
  warn "global-bundle.pem is tracked by git. Add '*.pem' to .gitignore."
fi

# ── 4. Download RDS SSL certificate bundle ───────────────────────────────────
CERT_FILE="./global-bundle.pem"
if [ ! -f "$CERT_FILE" ]; then
  info "Downloading AWS RDS global SSL certificate bundle..."
  CERT_URL="https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem"
  if command -v wget &>/dev/null; then
    wget -q -O "$CERT_FILE" "$CERT_URL"
  elif command -v curl &>/dev/null; then
    curl -sSL -o "$CERT_FILE" "$CERT_URL"
  else
    error "Neither wget nor curl found. Install one to download the RDS certificate."
  fi
  info "Certificate saved to $CERT_FILE"
else
  info "RDS certificate bundle already present, skipping download."
fi

export PGSSLROOTCERT="$CERT_FILE"

# ── 5. Install dependencies ───────────────────────────────────────────────────
info "Installing Node.js dependencies..."
npm install --omit=dev
info "Dependencies installed."

# ── 6. Run database migrations ───────────────────────────────────────────────
info "Running database migrations..."
npm run migrate
info "Migrations complete."

# ── 7. Build Next.js (production) ─────────────────────────────────────────────
if [ "${SKIP_BUILD:-false}" != "true" ]; then
  info "Building Next.js application..."
  npm run build
  info "Build complete."
else
  warn "Skipping Next.js build (SKIP_BUILD=true)."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
info "Deployment preparation complete."
info "Start the server with: npm start  (or: node server/index.js)"
