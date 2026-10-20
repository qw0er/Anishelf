# Anishelf

Anishelf is a personal anime library browser and player. Point it at an existing
media directory, browse its folder structure, and watch videos in your browser.

- Automatic admission of clearly identified anime, with Review for failures and corrections.
- A poster library, episode details and source-version selection.
- Automatic and manual library scans.
- Saved playback progress and watch history.
- External subtitles and supported embedded text subtitles.
- Media compatibility checks and prepared copies for browser playback.
- Original-media links for external players.
- AniList account connection, identity preview, connection checks and reconnection in Settings.
- RSS subscriptions with automatic single-version selection, per-anime download directories, durable qBittorrent acquisition and verified library ingestion.

## Requirements

- For container deployment, use Docker Engine and Docker Compose on Linux.
  Separate backend and web images contain the required runtime tools.
- Read access to the media directory and write access to a separate application
  data directory.

Source installations listen on loopback by default; container images listen on
`0.0.0.0` internally and publish a host loopback port. Remote use is available
through SSH port forwarding or a [Caddy reverse proxy](docs/deployment.md#caddy-reverse-proxy).
The application requires a single access password. On first startup, it generates
a random password and displays it once in the startup console. Sign in with that
password; change it or sign out under **Settings → Security**. Keep the data
directory persistent. See [password recovery](docs/deployment.md#authentication-and-password-recovery).

## Run and use

From the repository root, run:

```sh
npm start
```

This builds the application and starts it at `http://127.0.0.1:3000`.
For a fresh checkout, install dependencies first; see [Build from source](#build-from-source).

Open [Anishelf](http://127.0.0.1:3000), then:

1. Sign in with the password printed by the first startup, then save the absolute media directory in Settings. For a container deployment,
   use the mounted path, such as `/media`.
2. Wait for the scan. **Library** shows confirmed anime; open a work, select an
   episode and choose a file version when several are available. **Files** keeps
   the original folder browser and direct-file playback.
3. Select subtitles or prepare a compatible copy when needed. Use **Copy media
   link** to open the original file in an external player.

Clear title and episode matches are added to Library automatically after scanning.
Open **Review** for failed or ambiguous identification, search/select a work, preview
the episode mapping and confirm it. Review also lists associated/rejected sources;
use **Correct associations** to change an identified work or episode with explicit
replacement.
Manual corrections and rejections survive later scans; original files remain
accessible in Files.
See [Anime Catalog](docs/anime-catalog.md) for identification and correction endpoints.

To discover releases, open an anime detail page and add its RSS address and starting
episode under **RSS subscription**. Check the source, then enable the subscription.
Discovery selects one eligible version per episode automatically and explains skips;
no release review or advanced filtering setup is required. To enable automatic
acquisition, save your qBittorrent API account in Settings, select the resource
directory and corresponding completed path, enable a separate incomplete directory
in qBittorrent, and validate the destination. Confirm the subscription preview with
its displayed per-anime destination. Existing subscriptions require this fresh
confirmation before downloading. Activity shows acquisition/import results; use
**Open WebUI** for download controls. See [RSS subscriptions](docs/rss-subscriptions.md)
and [automatic acquisition](docs/current-requirement.md) for scope and limits.

The library scans on startup and watches filesystem changes for incremental updates.
Manual scans reconcile the library when needed; monitoring failures are reported
and retried automatically. There are no scheduled full scans. See
[Filesystem monitoring](docs/filesystem-monitoring.md) for recovery and limitations.
Playback support depends on the browser and the media format.

For a remote server, forward its application port:

```sh
ssh -L 3000:127.0.0.1:3000 user@server
```

Open the same local address and keep the SSH connection active.

## Connect an AniList account

Under **Settings → AniList account**, open **Open provider authorization**,
authorize the application, and copy the access token from the AniList PIN page.
Paste it into **Access token**, select **Preview account**, then verify
the displayed identity and select **Confirm connection**. No developer application
registration or local script is required for normal use.

Use **Check connection** to validate the stored authorization. To reauthorize,
repeat the preview/confirmation flow; an invalid token does not replace a working
connection. **Disconnect** removes the local credential without revoking the token
on AniList. The connection applies to the whole single-user Anishelf server.
Browse AniList lists, including titles without local files, from Library. Edit cumulative
progress and tracking status on details or from the player. Automatic completion submits
confirmed episode targets; skipped episodes require explicit confirmation. Pending changes,
retries and remote conflicts remain visible until confirmed. AniList owns viewing state;
local playback positions and history remain independent.

Tokens persist in private files under the application data directory; protect
backups of that directory. Public metadata access and local playback do not
require an AniList account. Provider integration boundaries and upgrade/restore behavior are documented in
[Provider-independent anime integration](docs/tracking-provider-design.md).
See the [archived AniList design](docs/history.md#anilist-design-implemented-account-foundation)
for storage and verification details.

## Deploy with a container

Use Docker Engine with the Compose plugin on Linux AMD64 or ARM64. The
[compose.yaml](compose.yaml) starts Web and Backend. qBittorrent is optional.

- `web` serves the frontend and forwards `/api` to the private backend. Its default
  browser entry is `http://localhost:3000`, published on host loopback only.
- `backend` owns the private `anishelf-app` volume and reads completed media from
  `anishelf-media` at `/data/media` through a read-only mount.
- Optional `qbittorrent` writes completed media to the same media volume. Its
  configuration and incomplete downloads have separate private volumes.

### Docker Compose

For a source checkout:

```sh
cp .env.example .env
# Edit .env for your browser origin, ports and optional downloader.
docker compose up -d --build
docker compose logs -f backend
```

Open [Anishelf](http://localhost:3000) and sign in with the password printed in
backend logs. Fresh settings use `/data/media` as the resource root. No downloader
or browser WebUI link is configured by default.

To include qBittorrent, uncomment these two lines in `.env`:

```dotenv
COMPOSE_PROFILES=qbittorrent
ANISHELF_QBITTORRENT_API_URL=http://qbittorrent:8080
```

Then run the same Compose command. Read its temporary password with
`docker compose logs qbittorrent`, set a permanent password in qBittorrent, and
configure completed downloads at `/data/media` and incomplete downloads at
`/data/incomplete`. In Anishelf Settings, the API address is prefilled; enter your
qBittorrent username/password, save and test. The prefilled address alone does not
connect an account. Existing saved API accounts always take precedence.

The **WebUI URL** is an optional browser-reachable address, configured separately
in Settings. It is not inferred from the backend API URL. Leave it blank when only
API access is needed; Anishelf does not proxy the downloader WebUI.

[.env.example](.env.example) centralizes the shared Anishelf image tag, browser
origin, published ports, time zone and downloader options. To use an existing host
media directory, set `ANISHELF_MEDIA_PATH=/srv/anishelf/media`; see
[storage permissions](docs/deployment.md#data-storage). Keep
`ANISHELF_PUBLIC_ORIGIN` aligned with the browser hostname, port and scheme when
changing the published port or using HTTPS.

For published releases, set `ANISHELF_TAG` to the same available release tag for
both images, then use `docker compose pull` and `docker compose up -d --no-build`.
Branch pushes do not publish images; build from source when the desired tag is
unavailable. [Back up persistent data](docs/deployment.md#data-backup-and-updates)
before updates. Do not use `down --volumes` unless intentionally deleting data.
The isolated volume layout does not automatically import older shared-volume
installations. See [deployment guidance](docs/deployment.md) for storage, updates,
TLS, SELinux and password recovery.

## Configuration

Set environment variables before starting the application. Restart after changes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Listener IPv4/IPv6 address; the container image defaults to `0.0.0.0`. |
| `ANISHELF_PORT` | `3000` | Listener port, from 1 to 65535. |
| `ANISHELF_PUBLIC_ORIGIN` | Unset | One allowed external HTTP(S) origin, such as `https://example.com`; local access remains available. Anishelf enforces application authentication. |
| `ANISHELF_FRONTEND_DIR` | Unset | Absolute frontend build directory containing `index.html`; enables page hosting. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory | Absolute writable directory for settings, the database and caches. |
| `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL` | Unset | Initial absolute browser WebUI address; seeds missing `settings.json`, without replacing existing settings. |
| `ANISHELF_INITIAL_RESOURCE_ROOTS` | Unset | JSON array of up to 64 readable, non-overlapping absolute media paths; only creates missing settings. |
| `ANISHELF_INITIAL_RESOURCE_ROOT` | Unset | Single-path initialization convenience; do not combine with the plural initializer. Existing settings are preserved. |
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
Adjust the logging variables above as needed; failed file output falls back to stderr.

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
npm run build
```

The build produces `backend/dist` and `web/dist`. Keep the backend's production
Node.js dependencies and `backend/migrations` available when deploying the build.

To build a container image instead:

```sh
docker build -f package/Dockerfile -t anishelf:local .
```

Use `anishelf:local` in place of the published image in the
[container deployment examples](#deploy-with-a-container). See
[container packaging](package/README.md) for image publication details.
The image includes Node.js, FFmpeg/FFprobe and the built application.
