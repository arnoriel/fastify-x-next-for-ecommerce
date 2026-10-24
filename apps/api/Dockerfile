# API production image. Build context WAJIB root repo:
#   docker build -f apps/api/Dockerfile -t ecommerce-api .
# Output = bundle tunggal (esbuild) → image runtime tanpa node_modules / dev dependency.
ARG NODE_VERSION=22

# ---------- build: install + bundle ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @ecommerce/api

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000
# dist/ = server.mjs + migrate.mjs (+ sourcemap); drizzle/ = file SQL migrasi (dibaca migrate.mjs dari cwd).
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./drizzle
USER node
EXPOSE 4000
# Readiness (Postgres + Redis terjangkau). Non-2xx → unhealthy.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${API_PORT}/ready" || exit 1
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
