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
[compose.yaml](compose.yaml) file runs three containers:

- `web`: Caddy serves the built frontend and forwards `/api` to `backend:3000`.
  It publishes the application entry at `127.0.0.1:3000`.
- `backend`: Node.js and FFmpeg/FFprobe handle APIs, scanning and media delivery.
  It mounts `anishelf-data` at `/data`, storing application state in `/data/app`
  and browsing completed media in `/data/media`.
- `qbittorrent`: the download client shares `anishelf-data` at `/data`, with
  completed media in `/data/media` and partial downloads in `/data/incomplete`.
  Its configuration has a separate volume. Its WebUI publishes `127.0.0.1:8080`;
  peer TCP/UDP uses 6881.

### Docker Compose

From a fresh source installation, build and start directly; no host media path
or separate media volume is required:

```sh
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Open [Anishelf](http://localhost:3000). Read the initial password from the backend
logs. The backend image initializes the shared directories for UID/GID 1000.
`/data/media` initializes a fresh installation; existing installations must follow
the [storage migration steps](docs/deployment.md#data-backup-and-migration) before
starting with this layout. The Compose environment also
sets `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL=http://localhost:8080`, so a fresh
installation has an **Open qBittorrent WebUI** link immediately. Existing
`settings.json` is preserved; save the address in Settings for an existing install.
This is a browser link, so use an address reachable from the browser rather than
`http://qbittorrent:8080`. For remote access, change it to your WebUI domain or
forward port 8080 alongside port 3000 over SSH.

Read the qBittorrent temporary `admin` password with `docker compose logs qbittorrent`
and set a permanent password in its WebUI. Its authentication is independent of
Anishelf. Set completed downloads to `/data/media` and enable the incomplete
folder at `/data/incomplete` so unfinished data stays outside the watched library.
These qBittorrent preferences must be configured in its WebUI; mounting the volume
does not set them automatically. Anishelf keeps original media read-only at the
application level; the shared volume itself is writable by both containers.
In Anishelf Settings, configure the qBittorrent **API connection** with
`http://qbittorrent:8080`, your qBittorrent username and password, save, then use
**Test connection**. This account is separate from Anishelf login, and the API
URL is separate from the browser WebUI URL. Saved passwords are never returned;
leave the field blank to retain one for the same API URL and username.
See [qBittorrent deployment details](docs/deployment.md#qbittorrent-webui-access).

The Compose file also names the release images `ghcr.io/qw0er/anishelf-backend:latest`
and `ghcr.io/qw0er/anishelf-web:latest`. After these images have been published,
you can use `docker compose pull` followed by `docker compose up -d --no-build`
instead of building locally. Deploy both images from the same release.

Set the backend's `ANISHELF_PUBLIC_ORIGIN` to the exact browser-facing origin.
The provided value is `http://localhost:3000`; change it for another hostname,
port or HTTPS domain. The browser uses the same origin for pages and APIs.
A host TLS proxy forwards the whole site to the web container's published port;
see [Caddy domain access](docs/deployment.md#caddy-reverse-proxy).

Keep `anishelf-data` across updates. Stop the containers and
[back up the volume](docs/deployment.md#data-backup-and-migration) before upgrading.
`docker compose down` retains the volume; `docker compose down --volumes` deletes
it. Existing deployments must migrate the old flat application directory into
`app/` before reusing the volume. Remove the old `ANISHELF_FRONTEND_DIR` override; the backend image
now serves only APIs. See [deployment guidance](docs/deployment.md) for migration,
SELinux, password recovery and multiple media mounts.

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
