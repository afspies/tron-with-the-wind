#!/usr/bin/env bash
#
# Deploy Tron with the Wind
#
# Usage:
#   ./deploy.sh              Deploy server + web
#   ./deploy.sh server       Deploy server only
#   ./deploy.sh web          Deploy web only
#   ./deploy.sh server:logs  View server logs
#
# Configuration via .env file (see .env.example):
#   HETZNER_HOST=root@IP
#   CLOUDFLARE_PAGES_PROJECT=tron-with-the-wind
#   COLYSEUS_PROD_URL=wss://tron-server.afspies.com
#
set -euo pipefail
cd "$(dirname "$0")"

# Load .env if present
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

HETZNER_HOST="${HETZNER_HOST:-}"
CLOUDFLARE_PAGES_PROJECT="${CLOUDFLARE_PAGES_PROJECT:-tron-with-the-wind}"
COLYSEUS_PROD_URL="${COLYSEUS_PROD_URL:-wss://tron-server.afspies.com}"

deploy_server() {
  if [ -z "$HETZNER_HOST" ]; then
    echo "Error: HETZNER_HOST not set. Add it to .env or export it."
    echo "  Example: HETZNER_HOST=root@123.45.67.89"
    exit 1
  fi

  echo "=== Deploying server to $HETZNER_HOST ==="

  ssh "$HETZNER_HOST" bash <<'REMOTE'
set -euo pipefail
cd /opt/tron
git pull
docker compose up -d --build
echo ""
echo "Server updated. Container status:"
docker compose ps
REMOTE

  echo ""
  echo "Server deployed."
}

deploy_web() {
  echo "=== Building web with COLYSEUS_URL=$COLYSEUS_PROD_URL ==="

  VITE_COLYSEUS_URL="$COLYSEUS_PROD_URL" npm run build

  echo ""
  echo "=== Deploying to Cloudflare Pages ($CLOUDFLARE_PAGES_PROJECT) ==="

  npx wrangler pages deploy apps/web/dist/ --project-name="$CLOUDFLARE_PAGES_PROJECT"

  echo ""
  echo "Web deployed to https://tron.afspies.com"
}

server_logs() {
  if [ -z "$HETZNER_HOST" ]; then
    echo "Error: HETZNER_HOST not set."
    exit 1
  fi

  ssh "$HETZNER_HOST" "cd /opt/tron && docker compose logs -f --tail=100"
}

case "${1:-all}" in
  server)
    deploy_server
    ;;
  web)
    deploy_web
    ;;
  server:logs|logs)
    server_logs
    ;;
  all)
    deploy_server
    echo ""
    deploy_web
    ;;
  *)
    echo "Usage: ./deploy.sh [server|web|server:logs]"
    echo ""
    echo "  (no args)     Deploy server + web"
    echo "  server        Deploy server only"
    echo "  web           Deploy web only"
    echo "  server:logs   Tail server logs"
    ;;
esac
