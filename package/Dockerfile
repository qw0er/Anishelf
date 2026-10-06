# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Native SQLite bindings can fall back to compilation when needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY web/package.json ./web/package.json
RUN npm ci && npm rebuild better-sqlite3

COPY backend/ ./backend/
COPY web/ ./web/
RUN npm run build \
    && rm -rf node_modules backend/node_modules web/node_modules \
    && npm ci --omit=dev --workspace @anishelf/backend \
    && npm rebuild better-sqlite3 \
    && mkdir -p backend/node_modules

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
# Override the listener at runtime with -e ANISHELF_PORT=3001.
# The health check reads the same environment variable.
ENV NODE_ENV=production \
    ANISHELF_HOST=127.0.0.1 \
    ANISHELF_PORT=3000 \
    ANISHELF_DATA_DIR=/data \
    ANISHELF_FRONTEND_DIR=/app/web/dist \
    ANISHELF_FFMPEG_PATH=/usr/bin/ffmpeg \
    ANISHELF_FFPROBE_PATH=/usr/bin/ffprobe

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data \
    && chown node:node /data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/migrations ./backend/migrations
COPY --from=build /app/web/dist ./web/dist

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e 'fetch(`http://${process.env.ANISHELF_HOST.includes(":") ? `[${process.env.ANISHELF_HOST}]` : process.env.ANISHELF_HOST}:${process.env.ANISHELF_PORT}/api/health`).then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));'
CMD ["node", "backend/dist/index.js"]
