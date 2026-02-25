#!/usr/bin/env bash
#
# One-time Hetzner VPS bootstrap for Tron server (prod + staging)
#
# Usage: ./setup-vps.sh user@HETZNER_IP
#
# Prerequisites:
#   - SSH access to the VPS (key-based auth recommended)
#   - Git repo accessible from VPS (deploy key or public repo)
#
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: ./setup-vps.sh user@HETZNER_IP"
  exit 1
fi

HOST="$1"
REPO_URL="$(git remote get-url origin 2>/dev/null || echo '')"

if [ -z "$REPO_URL" ]; then
  echo "Error: Could not detect git remote URL. Run from inside the repo."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Tron VPS Setup ==="
echo "  Host: $HOST"
echo "  Repo: $REPO_URL"
echo ""

# Copy nginx config to VPS
echo "[0/6] Uploading nginx config..."
scp "$SCRIPT_DIR/nginx/tron.conf" "$HOST:/tmp/tron.conf"

# Run setup on VPS
ssh "$HOST" bash -s -- "$REPO_URL" <<'REMOTE_SCRIPT'
set -euo pipefail
REPO_URL="$1"

echo "[1/6] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "  Docker installed."
else
  echo "  Docker already installed."
fi

# Ensure docker compose plugin is available
if ! docker compose version &>/dev/null; then
  echo "Error: docker compose plugin not found. Please install it manually."
  exit 1
fi

echo "[2/6] Installing nginx..."
if ! command -v nginx &>/dev/null; then
  apt-get update -qq
  apt-get install -y -qq nginx
  systemctl enable nginx
  echo "  nginx installed."
else
  echo "  nginx already installed."
fi

# Deploy nginx config
echo "[3/6] Configuring nginx..."
cp /tmp/tron.conf /etc/nginx/sites-available/tron.conf
ln -sf /etc/nginx/sites-available/tron.conf /etc/nginx/sites-enabled/tron.conf
# Remove default site if it exists
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
echo "  nginx configured."

# Clone or pull a repo into the given directory
setup_repo() {
  local dir="$1"
  if [ -d "$dir" ]; then
    echo "  $dir already exists, pulling latest..."
    cd "$dir"
    git pull
  else
    git clone "$REPO_URL" "$dir"
    cd "$dir"
  fi
}

echo "[4/6] Setting up production (/opt/tron-prod)..."
# Migrate from legacy /opt/tron if it exists
if [ -d /opt/tron ] && [ ! -d /opt/tron-prod ]; then
  echo "  Migrating /opt/tron → /opt/tron-prod..."
  cd /opt/tron && docker compose down 2>/dev/null || true
  mv /opt/tron /opt/tron-prod
fi
setup_repo /opt/tron-prod
HOST_PORT=8080 docker compose -p tron-prod up -d --build

echo "[5/6] Setting up staging (/opt/tron-staging)..."
setup_repo /opt/tron-staging
HOST_PORT=8081 docker compose -p tron-staging up -d --build

echo "[6/6] Verifying..."
sleep 2
echo ""
echo "=== Production ==="
docker compose -p tron-prod ps
echo ""
echo "=== Staging ==="
docker compose -p tron-staging ps
REMOTE_SCRIPT

echo ""
echo "=== VPS setup complete ==="
echo ""
echo "Next steps:"
echo "  1. DNS A records (proxied via Cloudflare, SSL mode 'Flexible'):"
echo "     tron-server.afspies.com         → $(echo "$HOST" | cut -d@ -f2)"
echo "     tron-staging-server.afspies.com → $(echo "$HOST" | cut -d@ -f2)"
echo "  2. Deploy with: ./deploy.sh prod   or  ./deploy.sh staging"
echo "  3. Verify: ./deploy.sh status prod  and  ./deploy.sh status staging"
