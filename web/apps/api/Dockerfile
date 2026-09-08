# syntax=docker/dockerfile:1
#
# DROMEX web API. Build context is the "web" workspace root.
# Runtime is pinned to the approved Node 24 LTS image (DEC-415).
FROM node:24.20.0-trixie-slim

ENV NODE_ENV=production
WORKDIR /app

# Manifests first: dependency installation caches independently of source changes.
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --omit=dev --workspace apps/api

COPY tsconfig.base.json ./
COPY apps/api/src ./apps/api/src

USER node

# Documents the container port only. Host publishing is restricted to the
# loopback address in docker-compose.dev.yml; production publishes nothing.
EXPOSE 3000

# node:24 strips TypeScript types natively, so no build step and no
# experimental flag is required. "slim" ships no curl or wget, so the
# check uses Node's built-in fetch rather than an added utility.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/src/server.ts"]
