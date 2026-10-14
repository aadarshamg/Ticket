# syntax=docker/dockerfile:1
# API + WhatsApp send worker.
# Build from the repository root:
#   docker build -f apps/api/Dockerfile -t ticketing-api .

FROM node:20-bookworm-slim AS base
WORKDIR /app
# Prisma's query engine needs OpenSSL; outbound HTTPS (Meta, managed Postgres) needs CA certificates.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Workspace manifests and the Prisma schema (the api's postinstall runs `prisma generate`).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/api/prisma apps/api/prisma

# --- compile TypeScript (needs dev dependencies) ---
FROM base AS build
RUN npm ci --workspace apps/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w apps/api

# --- runtime image: production dependencies and compiled code only ---
FROM base AS run
ENV NODE_ENV=production
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root \
  && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist

USER node
WORKDIR /app/apps/api
ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Apply any pending migrations, then start. With several API instances, run the migration
# as a separate one-off job instead (node dist/scripts/migrate.js) and start with
# `node dist/index.js`.
CMD ["sh", "-c", "node dist/scripts/migrate.js && node dist/index.js"]
