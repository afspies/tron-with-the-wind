FROM node:20-alpine
WORKDIR /app

# Copy only package manifests first for better layer caching.
# npm install will re-run only when dependencies change, not on every source edit.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/game-core/package.json packages/game-core/
COPY apps/server/package.json apps/server/
# Stub for web workspace so npm install doesn't fail
RUN mkdir -p apps/web && echo '{"name":"@tron/web","version":"0.0.0"}' > apps/web/package.json
RUN npm install

# Copy source code (changes here won't invalidate the install layer)
COPY packages/ packages/
COPY apps/server/ apps/server/

EXPOSE 8080
CMD ["npx", "tsx", "--tsconfig", "apps/server/tsconfig.json", "apps/server/src/index.ts"]
