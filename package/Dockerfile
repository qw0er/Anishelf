# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS dependencies
WORKDIR /app
# Native SQLite bindings can fall back to compilation when needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY scripts/build-info.mjs ./scripts/build-info.mjs
ARG ANISHELF_BUILD_TAG=""
ARG ANISHELF_BUILD_COMMIT=""
ARG ANISHELF_BUILD_CHANNEL=development
ARG ANISHELF_BUILD_TIME=""
ENV ANISHELF_BUILD_TAG=$ANISHELF_BUILD_TAG \
    ANISHELF_BUILD_COMMIT=$ANISHELF_BUILD_COMMIT \
    ANISHELF_BUILD_CHANNEL=$ANISHELF_BUILD_CHANNEL \
    ANISHELF_BUILD_TIME=$ANISHELF_BUILD_TIME
RUN npm ci && npm rebuild better-sqlite3

FROM dependencies AS backend-build
COPY apps/server/ ./apps/server/
RUN npm run build --workspace @anishelf/backend \
    && rm -rf node_modules apps/server/node_modules apps/web/node_modules \
    && npm ci --omit=dev --workspace @anishelf/backend \
    && npm rebuild better-sqlite3 \
    && mkdir -p apps/server/node_modules

FROM dependencies AS web-build
# Web imports shared contracts and build defaults from the backend workspace.
COPY apps/server/ ./apps/server/
COPY apps/web/ ./apps/web/
COPY CHANGELOG.md ./CHANGELOG.md
RUN npm run build --workspace @anishelf/web

FROM node:24-trixie-slim AS backend
WORKDIR /app
ENV NODE_ENV=production \
    ANISHELF_HOST=0.0.0.0 \
    ANISHELF_PORT=3000 \
    ANISHELF_DATA_DIR=/var/lib/anishelf \
    ANISHELF_FFMPEG_PATH=/usr/bin/ffmpeg \
    ANISHELF_FFPROBE_PATH=/usr/bin/ffprobe
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /var/lib/anishelf /data/media \
    && chown -R node:node /var/lib/anishelf /data
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/apps/server/package.json ./apps/server/package.json
COPY --from=backend-build /app/apps/server/build-info.json ./apps/server/build-info.json
COPY --from=backend-build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=backend-build /app/apps/server/dist ./apps/server/dist
COPY --from=backend-build /app/apps/server/migrations ./apps/server/migrations
COPY package/qbittorrent-init.mjs ./package/qbittorrent-init.mjs
COPY package/jackett-init.mjs ./package/jackett-init.mjs
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e 'fetch(`http://${process.env.ANISHELF_HOST === "0.0.0.0" ? "127.0.0.1" : process.env.ANISHELF_HOST === "::" ? "[::1]" : process.env.ANISHELF_HOST.includes(":") ? `[${process.env.ANISHELF_HOST}]` : process.env.ANISHELF_HOST}:${process.env.ANISHELF_PORT}/api/health`).then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));'
CMD ["node", "apps/server/dist/index.js"]

FROM caddy:2-alpine AS web
ENV XDG_CONFIG_HOME=/tmp/caddy/config \
    XDG_DATA_HOME=/tmp/caddy/data
COPY package/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
EXPOSE 8080
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
