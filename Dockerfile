# syntax=docker/dockerfile:1
# The whole system in ONE container (web app + API + WhatsApp send worker), for hosts whose
# free plan runs a single service, such as Render. See README > Deployment > Option A.
# For separate services use apps/api/Dockerfile and apps/web/Dockerfile instead.
#
#   docker build -t ticketing .

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma

# --- API: compile TypeScript ---
FROM base AS api-build
RUN npm ci --workspace apps/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w apps/api

# --- Web: self-contained Next.js build. The API runs in the same container. ---
FROM base AS web-build
RUN npm ci --workspace apps/web --include-workspace-root
ENV API_INTERNAL_URL=http://127.0.0.1:4000 \
  NEXT_OUTPUT=standalone \
  NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
RUN npm run build -w apps/web

# --- Runtime ---
FROM base AS run
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  API_PORT=4000 \
  PORT=3000
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root \
  && npm cache clean --force
COPY --from=api-build /app/apps/api/dist apps/api/dist
# The web server lives in its own folder so its traced node_modules do not mix with the API's.
COPY --from=web-build /app/apps/web/.next/standalone web
COPY --from=web-build /app/apps/web/.next/static web/apps/web/.next/static
COPY --from=web-build /app/apps/web/public web/apps/web/public
COPY deploy/start.mjs deploy/start.mjs

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/start.mjs"]
