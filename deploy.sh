#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Bump patch version in package.json
OLD_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD_VERSION"
PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$PATCH"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "Version: $OLD_VERSION → $NEW_VERSION"

# Build with TURN enabled
TURN_WORKER_URL=https://tron-turn-credentials.alexfspies.workers.dev npm run build

# Download publish script if not cached
PUBLISH_SCRIPT="/tmp/herenow-publish.sh"
if [[ ! -f "$PUBLISH_SCRIPT" ]]; then
  curl -sL https://raw.githubusercontent.com/heredotnow/skill/main/here-now/scripts/publish.sh -o "$PUBLISH_SCRIPT"
  chmod +x "$PUBLISH_SCRIPT"
fi

# Deploy
HERENOW_API_KEY="${HERE_NOW_KEY:?Set HERE_NOW_KEY env var}" "$PUBLISH_SCRIPT" dist --slug tropic-dahlia-2mgy

# Git tag
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
echo "Tagged v$NEW_VERSION"

echo ""
echo "Deployed v$NEW_VERSION → https://tropic-dahlia-2mgy.here.now/"
