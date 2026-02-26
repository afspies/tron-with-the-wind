#!/usr/bin/env bash
#
# Deploy Tron with the Wind
#
# Usage:
#   ./deploy.sh prod                Deploy both server + web to production
#   ./deploy.sh prod server         Deploy server only to production
#   ./deploy.sh prod web            Deploy web only to production
#   ./deploy.sh staging             Deploy both to staging
#   ./deploy.sh staging server      Deploy staging server only
#   ./deploy.sh staging web         Deploy staging web only
#   ./deploy.sh logs [prod|staging] Tail server logs
#   ./deploy.sh status [prod|staging] Show container status
#
# Every deploy bumps the patch version, commits, tags, and pushes.
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
      WEB_URL="https://tron.afspies.com"
      ;;
    staging)
      HOST_PORT=8081
      COMPOSE_PROJECT=tron-staging
      SERVER_DIR=/opt/tron-staging
      COLYSEUS_URL="$COLYSEUS_STAGING_URL"
      CF_BRANCH=staging
      WEB_URL="https://tron-staging.afspies.com"
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

# Version bump
bump_version() {
  local current
  current=$(node -p "require('./package.json').version")
  local IFS=.
  read -r major minor patch <<< "$current"
  patch=$((patch + 1))
  local new_version="${major}.${minor}.${patch}"

  echo "=== Bumping version: $current → $new_version ==="

  for pkg_file in package.json apps/web/package.json; do
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$pkg_file', 'utf8'));
      pkg.version = '$new_version';
      fs.writeFileSync('$pkg_file', JSON.stringify(pkg, null, 2) + '\n');
    "
  done

  git add package.json apps/web/package.json
  git commit -m "Release v${new_version}"
  git push

  VERSION="$new_version"
  echo "  Pushed v${new_version} commit"
}

# Tag after successful deploy
tag_version() {
  local version="$1"
  echo "=== Tagging v${version} ==="
  git tag -a "v${version}" -m "Release v${version}"
  git push --tags
  echo "  Pushed tag v${version}"
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
  echo "Web deployed to $WEB_URL"
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
  echo "Usage: ./deploy.sh <env> [component]"
  echo ""
  echo "  ./deploy.sh prod                Deploy both (bumps version, tags, pushes)"
  echo "  ./deploy.sh prod server         Deploy server only"
  echo "  ./deploy.sh prod web            Deploy web only"
  echo "  ./deploy.sh staging             Deploy both to staging"
  echo "  ./deploy.sh staging server      Deploy staging server only"
  echo "  ./deploy.sh staging web         Deploy staging web only"
  echo "  ./deploy.sh logs [prod|staging] Tail server logs"
  echo "  ./deploy.sh status [prod|staging] Show container status"
  echo ""
  echo "Every deploy bumps the patch version, commits, tags, and pushes."
}

# Parse arguments
CMD="${1:-}"
COMPONENT="${2:-all}"

case "$CMD" in
  prod|staging)
    ENV="$CMD"

    # Confirm production deploy
    if [ "$ENV" = "prod" ]; then
      read -rp "Deploy to PRODUCTION? [y/N] " confirm
      if [[ "$confirm" != [yY] ]]; then
        echo "Aborted."
        exit 0
      fi
    fi

    # Always bump version
    bump_version

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

    # Tag after successful deploy
    echo ""
    tag_version "$VERSION"
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
