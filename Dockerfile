FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/ packages/
COPY apps/server/ apps/server/
# Create stub for web workspace so npm install doesn't fail
RUN mkdir -p apps/web && echo '{"name":"@tron/web","version":"0.0.0"}' > apps/web/package.json
RUN npm install
ENV PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "--tsconfig", "apps/server/tsconfig.json", "apps/server/src/index.ts"]
