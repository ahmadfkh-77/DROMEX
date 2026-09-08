# syntax=docker/dockerfile:1
#
# DROMEX web development preview. Build context is the "web" workspace root.
# This image serves the Vite development server only. It is not a
# production web image; production serving is a later phase.
FROM node:24.20.0-trixie-slim

ENV NODE_ENV=development
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace apps/web

COPY tsconfig.base.json ./
COPY apps/web ./apps/web

EXPOSE 5173

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Binds 0.0.0.0 inside the container so Docker can reach it. The host
# publishing rule in docker-compose.dev.yml keeps it on 127.0.0.1 only.
CMD ["npm", "run", "dev", "--workspace", "apps/web", "--", "--host", "0.0.0.0", "--port", "5173"]
