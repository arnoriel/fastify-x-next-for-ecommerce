# Web (Next.js) production image. Build context WAJIB root repo:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.contoh.com -t ecommerce-web .
# NEXT_PUBLIC_API_URL ter-inline ke bundle browser saat build → mengganti URL API = rebuild image ini.
ARG NODE_VERSION=22

# ---------- build ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
ARG NEXT_PUBLIC_API_URL
ARG NEXT_IMAGE_HOSTS=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_IMAGE_HOSTS=${NEXT_IMAGE_HOSTS}
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "ERROR: build-arg NEXT_PUBLIC_API_URL wajib diisi" >&2; exit 1)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @ecommerce/web

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# standalone = server.js + node_modules hasil trace; static & public harus disalin manual.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# Readiness web = API ikut siap (lihat app/ready/route.ts).
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/ready" || exit 1
CMD ["node", "apps/web/server.js"]
