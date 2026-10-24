# syntax=docker/dockerfile:1

FROM node:24-trixie-slim AS dependencies
WORKDIR /app
# Native SQLite bindings can fall back to compilation when needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY web/package.json ./web/package.json
COPY scripts/build-info.mjs ./scripts/build-info.mjs
ARG ANISHELF_BUILD_TAG
ARG ANISHELF_BUILD_COMMIT
ARG ANISHELF_BUILD_CHANNEL=development
ARG ANISHELF_BUILD_TIME
ENV ANISHELF_BUILD_TAG=$ANISHELF_BUILD_TAG \
    ANISHELF_BUILD_COMMIT=$ANISHELF_BUILD_COMMIT \
    ANISHELF_BUILD_CHANNEL=$ANISHELF_BUILD_CHANNEL \
    ANISHELF_BUILD_TIME=$ANISHELF_BUILD_TIME
RUN npm ci && npm rebuild better-sqlite3

FROM dependencies AS backend-build
COPY backend/ ./backend/
RUN npm run build --workspace @anishelf/backend \
    && rm -rf node_modules backend/node_modules web/node_modules \
    && npm ci --omit=dev --workspace @anishelf/backend \
    && npm rebuild better-sqlite3 \
    && mkdir -p backend/node_modules

FROM dependencies AS web-build
# Web imports shared contracts and build defaults from the backend workspace.
COPY backend/ ./backend/
COPY web/ ./web/
RUN npm run build --workspace @anishelf/web

FROM node:24-trixie-slim AS backend
WORKDIR /app
ENV NODE_ENV=production \
    ANISHELF_HOST=0.0.0.0 \
    ANISHELF_PORT=3000 \
    ANISHELF_DATA_DIR=/data/app \
    ANISHELF_FFMPEG_PATH=/usr/bin/ffmpeg \
    ANISHELF_FFPROBE_PATH=/usr/bin/ffprobe
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/app /data/media \
    && chown -R node:node /data
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/backend/package.json ./backend/package.json
COPY --from=backend-build /app/backend/build-info.json ./backend/build-info.json
COPY --from=backend-build /app/backend/node_modules ./backend/node_modules
COPY --from=backend-build /app/backend/dist ./backend/dist
COPY --from=backend-build /app/backend/migrations ./backend/migrations
COPY package/qbittorrent-init.mjs ./package/qbittorrent-init.mjs
COPY package/jackett-init.mjs ./package/jackett-init.mjs
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e 'fetch(`http://${process.env.ANISHELF_HOST === "0.0.0.0" ? "127.0.0.1" : process.env.ANISHELF_HOST === "::" ? "[::1]" : process.env.ANISHELF_HOST.includes(":") ? `[${process.env.ANISHELF_HOST}]` : process.env.ANISHELF_HOST}:${process.env.ANISHELF_PORT}/api/health`).then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));'
CMD ["node", "backend/dist/index.js"]

FROM caddy:2-alpine AS web
ENV XDG_CONFIG_HOME=/tmp/caddy/config \
    XDG_DATA_HOME=/tmp/caddy/data
COPY package/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/web/dist /srv
EXPOSE 8080
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
