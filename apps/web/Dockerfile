# syntax=docker/dockerfile:1
# Web app (Next.js): admin, pass pages, scanner. It forwards /api/* to the API.
# Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg API_INTERNAL_URL=http://api:4000 -t ticketing-web .

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/web --include-workspace-root

# Where this server reaches the API. It is needed at BUILD time as well as at run time:
# Next.js bakes the /api/* forwarding rule into the build.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
  NEXT_OUTPUT=standalone \
  NEXT_TELEMETRY_DISABLED=1
COPY apps/web apps/web
RUN npm run build -w apps/web

# --- runtime image: the self-contained server Next.js traced, plus static files ---
FROM node:20-bookworm-slim AS run
WORKDIR /app
ARG API_INTERNAL_URL=http://api:4000
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  API_INTERNAL_URL=$API_INTERNAL_URL \
  PORT=3000 \
  HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/admin/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
