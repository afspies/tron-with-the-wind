#!/usr/bin/env bash
#
# Deploy Tron with the Wind
#
# Usage:
#   ./deploy.sh prod                Deploy both server + web to production (bumps version)
#   ./deploy.sh prod server         Deploy server only to production (bumps version)
#   ./deploy.sh prod web            Deploy web only to production (bumps version)
#   ./deploy.sh prod --no-bump      Deploy both to production without version bump
#   ./deploy.sh staging             Deploy both to staging (no version bump)
#   ./deploy.sh staging server      Deploy staging server only
#   ./deploy.sh staging web         Deploy staging web only
#   ./deploy.sh logs [prod|staging] Tail server logs
#   ./deploy.sh status [prod|staging] Show container status
#
# Configuration via .env file (see .env.example)
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
COLYSEUS_STAGING_URL="${COLYSEUS_STAGING_URL:-wss://tron-staging-server.afspies.com}"

# Environment config
env_config() {
  local env="$1"
  case "$env" in
    prod)
      HOST_PORT=8080
      COMPOSE_PROJECT=tron-prod
      SERVER_DIR=/opt/tron-prod
      COLYSEUS_URL="$COLYSEUS_PROD_URL"
      CF_BRANCH=main
      ;;
    staging)
      HOST_PORT=8081
      COMPOSE_PROJECT=tron-staging
      SERVER_DIR=/opt/tron-staging
      COLYSEUS_URL="$COLYSEUS_STAGING_URL"
      CF_BRANCH=staging
      ;;
    *)
      echo "Error: Unknown environment '$env'. Use 'prod' or 'staging'."
      exit 1
      ;;
  esac
}

require_host() {
  if [ -z "$HETZNER_HOST" ]; then
    echo "Error: HETZNER_HOST not set. Add it to .env or export it."
    echo "  Example: HETZNER_HOST=root@123.45.67.89"
    exit 1
  fi
}

# Version bump (prod only)
bump_version() {
  local current
  current=$(node -p "require('./package.json').version")
  local IFS=.
  read -r major minor patch <<< "$current"
  patch=$((patch + 1))
  local new_version="${major}.${minor}.${patch}"

  echo "=== Bumping version: $current → $new_version ==="

  # Update root package.json
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    pkg.version = '$new_version';
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

  # Update apps/web/package.json
  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8'));
    pkg.version = '$new_version';
    fs.writeFileSync('apps/web/package.json', JSON.stringify(pkg, null, 2) + '\n');
  "

  git add package.json apps/web/package.json
  git commit -m "Release v${new_version}"
  git tag -a "v${new_version}" -m "Release v${new_version}"

  VERSION="$new_version"
  echo "  Tagged v${new_version}"
}

deploy_server() {
  local env="$1"
  env_config "$env"
  require_host

  echo "=== Deploying server ($env) to $HETZNER_HOST ==="

  ssh "$HETZNER_HOST" bash -s -- "$SERVER_DIR" "$HOST_PORT" "$COMPOSE_PROJECT" <<'REMOTE'
set -euo pipefail
SERVER_DIR="$1"
HOST_PORT="$2"
COMPOSE_PROJECT="$3"

cd "$SERVER_DIR"
git pull
HOST_PORT="$HOST_PORT" docker compose -p "$COMPOSE_PROJECT" up -d --build
echo ""
echo "Server updated. Container status:"
docker compose -p "$COMPOSE_PROJECT" ps
REMOTE

  echo ""
  echo "Server deployed ($env)."
}

deploy_web() {
  local env="$1"
  env_config "$env"

  echo "=== Building web with COLYSEUS_URL=$COLYSEUS_URL ==="

  VITE_APP_ENV="$env" VITE_COLYSEUS_URL="$COLYSEUS_URL" npm run build

  echo ""
  echo "=== Deploying to Cloudflare Pages ($CLOUDFLARE_PAGES_PROJECT, branch=$CF_BRANCH) ==="

  npx wrangler pages deploy apps/web/dist/ \
    --project-name="$CLOUDFLARE_PAGES_PROJECT" \
    --branch="$CF_BRANCH"

  echo ""
  if [ "$env" = "prod" ]; then
    echo "Web deployed to https://tron.afspies.com"
  else
    echo "Web deployed to https://tron-staging.afspies.com"
  fi
}

server_logs() {
  local env="${1:-prod}"
  env_config "$env"
  require_host

  ssh "$HETZNER_HOST" "cd $SERVER_DIR && docker compose -p $COMPOSE_PROJECT logs -f --tail=100"
}

server_status() {
  local env="${1:-prod}"
  env_config "$env"
  require_host

  ssh "$HETZNER_HOST" "cd $SERVER_DIR && docker compose -p $COMPOSE_PROJECT ps"
}

show_usage() {
  echo "Usage: ./deploy.sh <env> [component] [--no-bump]"
  echo ""
  echo "  ./deploy.sh prod                Deploy both (bumps version, tags, pushes)"
  echo "  ./deploy.sh prod server         Deploy server only (bumps version)"
  echo "  ./deploy.sh prod web            Deploy web only (bumps version)"
  echo "  ./deploy.sh prod --no-bump      Deploy both without version bump"
  echo "  ./deploy.sh staging             Deploy both to staging (no bump)"
  echo "  ./deploy.sh staging server      Deploy staging server only"
  echo "  ./deploy.sh staging web         Deploy staging web only"
  echo "  ./deploy.sh logs [prod|staging] Tail server logs"
  echo "  ./deploy.sh status [prod|staging] Show container status"
}

# Parse arguments
CMD="${1:-}"
COMPONENT="${2:-all}"
NO_BUMP=false

# Check for --no-bump in any position
for arg in "$@"; do
  if [ "$arg" = "--no-bump" ]; then
    NO_BUMP=true
  fi
done

# If component is --no-bump, reset to all
if [ "$COMPONENT" = "--no-bump" ]; then
  COMPONENT=all
fi

case "$CMD" in
  prod|staging)
    ENV="$CMD"
    SHOULD_BUMP=false

    # Only bump for prod unless --no-bump
    if [ "$ENV" = "prod" ] && [ "$NO_BUMP" = "false" ]; then
      SHOULD_BUMP=true
    fi

    if [ "$SHOULD_BUMP" = "true" ]; then
      bump_version
    fi

    case "$COMPONENT" in
      server)
        deploy_server "$ENV"
        ;;
      web)
        deploy_web "$ENV"
        ;;
      all)
        deploy_server "$ENV"
        echo ""
        deploy_web "$ENV"
        ;;
      *)
        echo "Error: Unknown component '$COMPONENT'. Use 'server' or 'web'."
        exit 1
        ;;
    esac

    # Push tags after successful prod deploy
    if [ "$SHOULD_BUMP" = "true" ]; then
      echo ""
      echo "=== Pushing version tag ==="
      git push && git push --tags
    fi
    ;;
  logs)
    server_logs "${2:-prod}"
    ;;
  status)
    server_status "${2:-prod}"
    ;;
  -h|--help|help)
    show_usage
    ;;
  *)
    show_usage
    exit 1
    ;;
esac
