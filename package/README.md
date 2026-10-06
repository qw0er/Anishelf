# Container packaging

Build from the repository root:

```sh
docker build -f package/Dockerfile -t anishelf:local .
```

The image includes Node.js 24, FFmpeg/FFprobe, production backend dependencies,
database migrations and the built frontend. The image sets `ANISHELF_FRONTEND_DIR=/app/web/dist`, so Node hosts both pages and APIs.
GPU acceleration requires additional host/device configuration.

The current backend accepts only loopback listeners. On Linux, use host networking
so the host's shared Caddy can reach `127.0.0.1:3000`; port publishing with `-p`
does not work with this listener configuration.

```sh
docker volume create anishelf-data
docker run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 \
  -e ANISHELF_PORT="${ANISHELF_PORT:-3000}" \
  --mount type=volume,source=anishelf-data,target=/data \
  --mount type=bind,source=/absolute/media/path,target=/media,readonly \
  anishelf:local
```

Open `http://127.0.0.1:3000` and configure `/media` as the media directory.
The current access policy supports local access or SSH forwarding.
To use a different port, set `ANISHELF_PORT=3001` in your shell before running
the command above, or replace its `-e` option with `-e ANISHELF_PORT=3001`.
The default is 3000; valid ports range from 1 to 65535. The listener and image
health check both use this variable. With host networking, the selected port is
also the host port: open `http://127.0.0.1:3001` and point Caddy's upstream to
`127.0.0.1:3001`. No image rebuild is required to change the port.

The process runs as the image's `node` user (UID/GID 1000). Media mounts must be
readable by that user. Bind-mounted data directories must also be writable by it.
On SELinux hosts, apply an appropriate container label to bind mounts.
Keep `/data` persistent across updates; it contains settings, SQLite and caches.
Stop the container and back up data before an update. Older images may require
restoring the matching backup after database migrations.
