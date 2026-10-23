# Anishelf

A personal anime library and browser player with AniList tracking and RSS downloads.

- Poster library, automatic identification and manual Review.
- Browser playback, subtitles and compatible media preparation.
- Playback history, resume and external-player links.
- AniList lists and viewing progress.
- RSS subscriptions, optional qBittorrent downloads and verified library ingestion.

## Deploy with a container

Requires Docker Compose on Linux AMD64 or ARM64. Save this as `compose.yaml`,
or use [the deployment file](package/deploy/compose.yaml). Images are pulled from GHCR.

```yaml
services:
  backend:
    image: ghcr.io/qw0er/anishelf-backend:${ANISHELF_TAG:-latest}
    restart: unless-stopped
    stop_grace_period: 15s
    environment:
      ANISHELF_PUBLIC_ORIGIN: ${ANISHELF_PUBLIC_ORIGIN:-http://localhost:${ANISHELF_PORT:-3000}}
      ANISHELF_DATA_DIR: /data/app
      ANISHELF_INITIAL_RESOURCE_ROOTS: /data/media
      ANISHELF_QBITTORRENT_API_URL: http://qbittorrent:8080
      ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE: /run/anishelf-qbittorrent/connection.json
    volumes:
      - anishelf-app:/data/app
      - qbittorrent-connection:/run/anishelf-qbittorrent:ro
      - ${ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media:ro
    # Podman's default OCI build format drops Dockerfile HEALTHCHECK metadata.
    # Declaring it here keeps depends_on.service_healthy working under Podman.
    healthcheck:
      test:
        - CMD-SHELL
        - >-
          node -e "fetch('http://127.0.0.1:3000/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"
      interval: 30s
      timeout: 5s
      start_period: 30s
      retries: 3

  web:
    image: ghcr.io/qw0er/anishelf-web:${ANISHELF_TAG:-latest}
    restart: unless-stopped
    stop_grace_period: 15s
    ports:
      - "${ANISHELF_BIND_ADDRESS:-127.0.0.1}:${ANISHELF_PORT:-3000}:8080"
    depends_on:
      backend:
        condition: service_healthy

  qbittorrent-init:
    profiles: [qbittorrent]
    image: ghcr.io/qw0er/anishelf-backend:${ANISHELF_TAG:-latest}
    user: "0:0"
    restart: "no"
    command: ["node", "/app/package/qbittorrent-init.mjs"]
    healthcheck:
      disable: true
    volumes:
      - qbittorrent-config:/config
      - qbittorrent-connection:/connection

  qbittorrent:
    depends_on:
      qbittorrent-init:
        condition: service_completed_successfully
    profiles: [qbittorrent]
    # Initialize only the mount roots before LinuxServer's normal init process.
    entrypoint:
      - /bin/sh
      - -ec
      - |
        mkdir -p /data/media /data/incomplete
        chown "$${PUID}:$${PGID}" /data/media /data/incomplete
        echo "qBittorrent media and incomplete mount roots initialized."
        exec /init
    image: linuxserver/qbittorrent:${QBITTORRENT_TAG:-latest}
    restart: unless-stopped
    stop_grace_period: 30s
    environment:
      PUID: "1000"
      PGID: "1000"
      WEBUI_PORT: "8080"
      TORRENTING_PORT: "${QBITTORRENT_PEER_PORT:-6881}"
    ports:
      - "${QBITTORRENT_BIND_ADDRESS:-127.0.0.1}:${QBITTORRENT_WEBUI_PORT:-8080}:8080"
      - "${QBITTORRENT_PEER_PORT:-6881}:${QBITTORRENT_PEER_PORT:-6881}"
      - "${QBITTORRENT_PEER_PORT:-6881}:${QBITTORRENT_PEER_PORT:-6881}/udp"
    volumes:
      - qbittorrent-config:/config
      - ${ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media
      - qbittorrent-incomplete:/data/incomplete

volumes:
  anishelf-app:
    name: anishelf-app
  anishelf-media:
    name: anishelf-media
  qbittorrent-incomplete:
    name: anishelf-qbittorrent-incomplete
  qbittorrent-connection:
    name: anishelf-qbittorrent-connection
  qbittorrent-config:
    name: anishelf-qbittorrent-config
```

```sh
docker compose pull
docker compose up -d
docker compose logs backend
```

Open [localhost:3000](http://localhost:3000). The initial password appears in Backend logs.

Optional `.env` settings:

| Variable | Default / purpose |
| --- | --- |
| `ANISHELF_TAG` | `latest`; matching Web/Backend release images |
| `ANISHELF_BIND_ADDRESS` / `ANISHELF_PORT` | `127.0.0.1` / `3000`; application host address/port |
| `ANISHELF_PUBLIC_ORIGIN` | `http://localhost:<ANISHELF_PORT>`; override for LAN or HTTPS |
| `ANISHELF_MEDIA_PATH` | Host media directory; unset uses the media volume |
| `COMPOSE_PROFILES` | Set `qbittorrent` to include the downloader |
| `QBITTORRENT_TAG` | `latest`; downloader image version |
| `QBITTORRENT_BIND_ADDRESS` / `QBITTORRENT_WEBUI_PORT` | `127.0.0.1` / `8080`; host WebUI address/port |
| `QBITTORRENT_PEER_PORT` | `6881`; synchronized listener and TCP/UDP publication |

See [the optional deployment environment file](package/deploy/.env.example).

- Backend runs as UID/GID 1000 and reads original media without modifying it.
- Keep all five data volumes. Stop services and back up before updating; never use `down --volumes` to update.
- On SELinux hosts, add `z` to shared media bind mounts.
- Remote access: `ssh -L 3000:127.0.0.1:3000 user@server`.
- [Quadlet, HTTPS, backup and password recovery](docs/deployment.md).

## First use

1. Sign in. Container deployments use `/data/media` as the initial resource root.
2. Browse **Library** or **Files**; resolve uncertain matches in **Review**.
3. Connect AniList under **Settings → AniList account**: authorize, paste the token, preview and confirm.
4. For automatic downloads, configure qBittorrent as below, then confirm an anime's RSS subscription preview.

## qBittorrent

Enable `COMPOSE_PROFILES=qbittorrent`, then run `docker compose up -d`.

| Setting | Bundled downloader |
| --- | --- |
| WebUI credentials | Anishelf Settings → qBittorrent → Show WebUI password |
| API address | `http://qbittorrent:8080` |
| Browser WebUI | `http://localhost:<QBITTORRENT_WEBUI_PORT>` (default 8080) |
| Completed directory | `/data/media` |
| Enabled incomplete directory | `/data/incomplete` |

For new installations, the initialization service generates a random permanent password,
configures both directories, and publishes credentials in the private
`anishelf-qbittorrent-connection` volume. Anishelf automatically connects and validates
the `/data/media` resource mapping. Subscription scope still requires confirmation;
shared file visibility is proven when a completed download is imported.

In Settings, use **Show WebUI password**, **Copy WebUI password** and **Copy username**
to sign into qBittorrent. The password is hidden after 30 seconds or when the page is
backgrounded. Save a browser-reachable WebUI URL separately and use **Open WebUI**.
If you change credentials inside qBittorrent, use **Update password or use an external
instance** to save the new credentials in Anishelf, then test the connection and
save/validate the destination again. Changed connection generations require renewed
subscription confirmation.

Existing qBittorrent configurations are preserved and need one manual connection
setup, including the separate incomplete directory. Initialization never resets an
existing password. A manually saved or removed Anishelf connection takes precedence
over deployment credentials, including after restart. External downloaders continue
to require their API credentials and completed-directory mapping.

Back up the app, qBittorrent configuration and connection volumes together. The
connection volume contains the initial password; the app privately stores subsequent
credential updates. Restore missing credentials from backup, or enter the current
qBittorrent credentials manually. Never delete only the configuration volume while
retaining the connection volume; initialization rejects this inconsistent state.

## Development

Requires Node.js 24, npm and FFmpeg/FFprobe.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Listener IPv4/IPv6 address; the container image defaults to `0.0.0.0`. |
| `ANISHELF_PORT` | `3000` | Listener port, from 1 to 65535. |
| `ANISHELF_PUBLIC_ORIGIN` | Unset | One allowed external HTTP(S) origin, such as `https://example.com`; local access remains available. Anishelf enforces application authentication. |
| `ANISHELF_FRONTEND_DIR` | Unset | Absolute frontend build directory containing `index.html`; enables page hosting. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory | Absolute writable directory for settings, the database and caches. |
| `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL` | Unset | Initial absolute browser WebUI address; seeds missing `settings.json`, without replacing existing settings. |
| `ANISHELF_QBITTORRENT_API_URL` | Unset | Suggested backend API address; external instances still require saved credentials. |
| `ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE` | Unset | Absolute path to deployment-generated initial credentials; missing files are retried without blocking startup. |
| `ANISHELF_INITIAL_RESOURCE_ROOTS` | Unset | One readable absolute media path or up to 64 non-overlapping paths separated by `:`; only creates missing settings. |
| `ANISHELF_FFMPEG_PATH` | `ffmpeg` from PATH | Optional absolute FFmpeg executable path. |
| `ANISHELF_FFPROBE_PATH` | `ffprobe` from PATH | Optional absolute FFprobe executable path. |
| `ANISHELF_LOG_LEVEL` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |
| `ANISHELF_LOG_DESTINATION` | `stdout` | Log output destination: `stdout`, `file`, or `both` (stdout and file). |
| `ANISHELF_LOG_PATH` | `anishelf.log` in the platform-specific user log directory | Optional absolute file path override for `file` or `both`; rejected for `stdout`. |
| `ANISHELF_LOG_MAX_SIZE_BYTES` | `10485760` (10 MiB) | Positive integer file rotation threshold in bytes; file modes only. |
| `ANISHELF_LOG_MAX_FILES` | `7` | Positive integer maximum number of rotated archives; excludes the active file. File modes only. |
| `ANISHELF_LOG_ROTATE_INTERVAL` | `1d` | File rotation interval: `1h` (hourly) or `1d` (daily). File modes only. |

Without `ANISHELF_FRONTEND_DIR`, the backend serves only APIs and media. A configured
frontend directory without `index.html` fails startup. Keep application data outside
the media and frontend directories, and preserve it across updates. Stop the
application and back up its data before upgrading.

### Logging

Logs are structured JSON, written to stdout at `info` level by default.
For containers, read them with `docker compose logs -f backend web`.

For file logging, set:

```ini
ANISHELF_LOG_DESTINATION=both
ANISHELF_LOG_PATH=/data/logs/anishelf.log
```

Use an absolute writable path; `/data/logs/anishelf.log` persists in the container's
data mount. Without an explicit path, file logs use the platform's user log
directory. Files rotate daily or at 10 MiB, retaining seven archives by default.
Adjust the logging variables above as needed. Pino and rotating-file-stream own output
behavior; file errors produce a stderr diagnostic. Restart after fixing a failed destination.

## Preparation modes

In Settings, choose a preparation mode independently of the output profile.
Compatibility is the default: preparation encodes both video and audio using the
selected profile, without audio-only or video-only transcoding. The profile still
controls the container, codecs, and encoding parameters; compatibility mode does
not guarantee support on every device. Fast preparation preserves streams supported
by the requesting browser when the profile allows it, reducing processing time but
potentially limiting playback on other devices. Already playable originals still
use direct playback. Mode changes apply to new preparation requests; existing tasks
and prepared files remain available and are checked against the playback device.

The choice is saved as `preparationMode` (`compatible` or `fast`) in `settings.json`.

## Build from source

Install Node.js 24 and npm, plus FFmpeg and FFprobe for media inspection,
subtitle extraction and preparation. Direct playback remains available without
these tools when the browser supports the original media.

Run from the repository root:
```sh
npm ci
npm start
```

The repository-root [compose.yaml](compose.yaml) builds the current checkout:

```sh
docker compose up -d --build
# Optional downloader:
docker compose --profile qbittorrent up -d --build
```

## Documentation

- [Development and environment variables](docs/development.md)
- [Container packaging](package/README.md)
- [Architecture](docs/architecture.md)
- [Requirements](docs/requirements.md) and [current iteration](docs/current-requirement.md)
- [Transcode profiles and preparation modes](docs/transcode-profiles.yaml)


The bundled initializer allows container port translation by disabling qBittorrent's
Host-header port check. Account authentication, localhost authentication and CSRF
protection remain enabled. The WebUI host binding defaults to `127.0.0.1`.
