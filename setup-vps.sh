#!/usr/bin/env bash
#
# One-time Hetzner VPS bootstrap for Tron server
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

echo "=== Tron VPS Setup ==="
echo "  Host: $HOST"
echo "  Repo: $REPO_URL"
echo ""

# Install Docker if not present, clone repo, build and start
ssh "$HOST" bash -s -- "$REPO_URL" <<'REMOTE_SCRIPT'
set -euo pipefail
REPO_URL="$1"

echo "[1/4] Installing Docker..."
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

echo "[2/4] Cloning repository..."
if [ -d /opt/tron ]; then
  echo "  /opt/tron already exists, pulling latest..."
  cd /opt/tron
  git pull
else
  git clone "$REPO_URL" /opt/tron
  cd /opt/tron
fi

echo "[3/4] Building and starting server..."
docker compose up -d --build

echo "[4/4] Verifying..."
sleep 2
if curl -sf http://localhost:80 >/dev/null 2>&1 || docker compose ps | grep -q "Up"; then
  echo ""
  echo "=== Server is running ==="
  docker compose ps
else
  echo ""
  echo "Warning: Server may not be ready yet. Check logs with:"
  echo "  ssh $HOST 'cd /opt/tron && docker compose logs'"
fi
REMOTE_SCRIPT

echo ""
echo "=== VPS setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Add DNS A record: tron-server.afspies.com -> VPS IP (proxied via Cloudflare)"
echo "  2. Set Cloudflare SSL mode to 'Flexible' for tron-server.afspies.com"
echo "  3. Deploy with: ./deploy.sh server"
