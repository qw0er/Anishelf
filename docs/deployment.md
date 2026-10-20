# Container deployment

Use the repository's [compose.yaml](../compose.yaml) with Docker Engine and the
Compose plugin. [Quick start](../README.md#deploy-with-a-container) covers local
builds and release images. Container deployments now run a Caddy frontend and a
Node backend separately; the earlier single-container CLI/Quadlet examples no
longer describe the deployment topology.

## Configure and start

Copy [.env.example](../.env.example) to `.env` beside `compose.yaml`. Compose reads
it automatically; keep it out of version control. The default command starts only
Web and Backend:

```sh
docker compose up -d --build
```

For published matching release images, set `ANISHELF_TAG` and use `pull` followed
by `up -d --no-build`. The source `next` branch may be ahead of published images.

| Compose option | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_TAG` | `latest` | Shared image tag for Web and Backend; pin an available release for predictable updates |
| `ANISHELF_BIND_ADDRESS` | `127.0.0.1` | Application host bind address |
| `ANISHELF_PORT` | `3000` | Published application port; backend container still listens on 3000 |
| `ANISHELF_PUBLIC_ORIGIN` | `http://localhost:3000` | Exact browser-facing origin, including a changed port or HTTPS domain |
| `ANISHELF_MEDIA_PATH` | Unset | Absolute host media directory; unset uses the `anishelf-media` named volume |
| `COMPOSE_PROFILES` | Unset | Set to `qbittorrent` to include the bundled downloader |
| `ANISHELF_QBITTORRENT_API_URL` | Unset | Optional backend-reachable API form default, with no credentials; saved accounts win |
| `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL` | Unset | Optional browser link initializer for new settings only |
| `TZ` | `Etc/UTC` | Backend and downloader time zone |
| `QBITTORRENT_TAG` | `latest` | LinuxServer downloader image tag |
| `QBITTORRENT_BIND_ADDRESS` | `127.0.0.1` | Downloader WebUI host bind address |
| `QBITTORRENT_WEBUI_PORT` | `8080` | Downloader WebUI/API port, both host and container; update the API form default if changed |
| `QBITTORRENT_PEER_PORT` | `6881` | Downloader TCP/UDP peer port, both host and container |
| `QBITTORRENT_UID` / `QBITTORRENT_GID` | `1000` / `1000` | Downloader file ownership; Backend remains UID/GID 1000 |

To use the bundled downloader, uncomment both lines in `.env`:

```dotenv
COMPOSE_PROFILES=qbittorrent
ANISHELF_QBITTORRENT_API_URL=http://qbittorrent:8080
```

Use the same `up` command after editing. Alternatively `docker compose --profile
qbittorrent up -d --build` enables the service for that invocation, but does not
set an API address hint: configure that separately in `.env` or Settings. Keeping
`COMPOSE_PROFILES` in `.env` also keeps the downloader included in subsequent
start, stop, pull and update commands. A profile does not automatically configure
an API account. For an external downloader, leave the profile disabled and enter
its backend-reachable URL in Settings or as the deployment hint.

## Networking and storage

`web` publishes `127.0.0.1:3000:8080` by default. It serves the SPA and proxies the
unchanged `/api` path to `backend:3000` on the Compose network. Keep the backend
port private. `ANISHELF_PUBLIC_ORIGIN` validates Host/Origin and selects Secure
cookies; no CORS configuration or browser API URL is needed.

The frontend listens on plain HTTP inside the private deployment. It has no
persistent application state; TLS terminates at a host reverse proxy. It provides
`/healthz` for its own health check; `/api/health` goes to the backend. Compose
waits for the backend health check before initially starting the frontend.
Caddy resolves the backend service name for subsequent connections, so replacing
the backend does not require a fixed container IP.

The frontend preserves cookies, CSRF tokens, Origin, Host, Range and conditional
request headers. Media responses stream without a proxy response cache. Hashed
`/assets/` files use immutable caching; HTML uses `no-cache`. Unknown API routes
reach backend JSON errors; missing assets return 404 instead of the SPA.
Access and runtime logs filter query strings and request/response headers to
avoid exposing media tokens or credentials.

## Data storage

| Storage | Container path | Backend | qBittorrent |
| --- | --- | --- | --- |
| `anishelf-app` | `/data/app` | Read/write: settings, credentials, SQLite, logs and generated caches | Not mounted |
| `anishelf-media` or `ANISHELF_MEDIA_PATH` | `/data/media` | Read-only: completed library media | Read/write |
| `anishelf-qbittorrent-config` | `/config` | Not mounted | Read/write: downloader settings and task state |
| `anishelf-qbittorrent-incomplete` | `/data/incomplete` | Not mounted | Read/write: unfinished downloads |

`web` has no data mounts. qBittorrent cannot access application state through these
mounts. Fresh application/media volumes inherit UID/GID 1000 from the backend
image. The bundled downloader initializes ownership of only its media/incomplete
mount roots using PUID/PGID, then executes LinuxServer's normal `/init`; it does
not recursively change ownership of existing media. Keep the downloader UID/GID
at 1000 for the default permissions, or explicitly ensure Backend UID/GID 1000
can traverse directories and read every completed file.

For a host media directory, set `ANISHELF_MEDIA_PATH` to its absolute path. The
same directory is mounted read-only by Backend and read/write by the bundled
downloader. Prepare the directory before startup; an empty example on Linux is:

```sh
sudo install -d -o 1000 -g 1000 -m 0755 /srv/anishelf/media
```

For existing files, check their read/traverse permissions instead of blindly
changing ownership recursively. Without the bundled downloader, arrange writes
through your own downloader or host tools. Generated assets stay in `/data/app`;
Anishelf does not require write access to original media. Never use `/data` as a
resource root or share the app volume between running backends.

## Data backup and updates

The default layout uses new isolated volumes. It does not import or migrate the
previous `anishelf-data` layout. Existing volumes are not deleted, but must not be
mistaken for the new installation's application state. This configuration targets
the new layout; there is no compatibility or automatic migration path.

Stop all writers, including a downloader previously enabled on the command line:

```sh
docker compose --profile qbittorrent stop
```

Back up the entire application volume, preserving modes and ownership. For
published images, an example from the Compose directory is:

```sh
docker run --rm --user 0:0 \
  --mount type=volume,source=anishelf-app,target=/data,readonly \
  --mount "type=bind,source=$PWD,target=/backup" \
  --entrypoint tar "ghcr.io/qw0er/anishelf-backend:${ANISHELF_TAG:-latest}" \
  -C /data -czf /backup/anishelf-app-backup.tar.gz .
```

The shell running `docker run` does not load `.env`; set/export `ANISHELF_TAG` or
substitute the exact installed image tag. For source builds use the image built
by Compose. Also back up the media directory/volume, downloader config volume and
incomplete volume if retaining partial transfers is required. The isolated app
volume makes application-only backups possible without copying all media.
Protect backups because RSS URLs and API credentials are recoverable. Restore
only while services are stopped, preserving file ownership and private modes.

For source updates, update the checkout and run `docker compose up -d --build`.
For published images, set the same available `ANISHELF_TAG` for both components,
pull while the current stack is running, then stop, back up and recreate:

```sh
docker compose pull
docker compose --profile qbittorrent stop
# Back up persistent data before proceeding.
docker compose up -d --no-build
```

Keep `.env` and persistent volumes across updates. Keep a pre-update app backup
for database rollback; reverting image tags alone does not undo migrations.
`down --volumes` deletes persistent data and is not an update step. Disabling a
profile does not stop an already running downloader: explicitly stop it before
removing `COMPOSE_PROFILES` from `.env`.

## SELinux mounts

The default stack uses named volumes and needs no media bind relabeling. If adding
a shared media bind mount on an enforcing host, add `selinux: z` under the
mount's `bind` options. Use `Z` only for a private mount. Docker manages labels
for named data volumes; relabel bind-mounted data as appropriate for the host.

## qBittorrent WebUI access

The optional `qbittorrent` profile uses LinuxServer's image with PUID/PGID 1000
and its own config/incomplete volumes. By default its WebUI publishes
`127.0.0.1:8080` and peers use TCP/UDP 6881. Ports, image tag and ownership are
configured in `.env`. The browser WebUI link defaults to blank. An explicitly
supplied `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL` seeds the link only when
`settings.json` is missing; existing saved settings, including an absent or cleared
link, always win. Blank initializer values are treated as unset. This neither
logs into the API nor restores the removed backend proxy.

The URL must be reachable **from the browser**. The Compose hostname
`qbittorrent` is only resolvable inside its container network. For remote access,
use a browser-facing WebUI domain or forward both loopback ports:

```sh
ssh -L 3000:127.0.0.1:3000 -L 8080:127.0.0.1:8080 user@server
```

Read the temporary `admin` password using `docker compose logs qbittorrent`, then
set a permanent password in qBittorrent. Configure completed downloads at
`/data/media` and enable its incomplete directory at `/data/incomplete`.
Only completed media is shared with Backend; unfinished data is not mounted there. These preferences must
be saved in qBittorrent; volume mounting does not configure them. The incomplete
directory keeps partial files outside the watched root once that preference is
enabled. Retain all configured volumes across recreations and stop both writers before
backing them up.

In Anishelf **Settings → qBittorrent → API connection**, enter API URL
`http://qbittorrent:8080` (or the port configured in `.env`), username `admin`
(or your configured account) and the
password you set in qBittorrent. Save, then choose **Test connection**. This URL
is reached by the backend and is separate from the browser WebUI URL below.
`ANISHELF_QBITTORRENT_API_URL` only prefills this form when no account is saved.
It does not persist credentials, connect or test automatically, or override a
saved account. The address can still be edited before saving.
Passwords are stored privately in `/data/app/acquisition/qbittorrent.json` with
mode `0600`, never returned by the settings API. An empty password keeps the saved
one only for the same URL and username; changing either requires reentry.
After saving the API account, configure **Download destination** in Settings:
choose the `/data/media` resource root, enter `/data/media` as the qBittorrent
completed path, save and validate. Other deployment layouts can map a different
qBittorrent path to one selected resource root. Configure the actual equivalent
mounts first; validation of preferences does not prove shared file visibility.
The first completed-file import verifies actual access and size.

Each anime is submitted under its own stable `Title [provider-id]` subdirectory.
Anishelf keeps media mounts read-only and does not create, move or rename files;
qBittorrent owns directory creation and final placement. Keep its incomplete path
outside every watched resource directory. The bundled `/data/incomplete` volume
already has the required isolation when the preference is enabled in qBittorrent.

Existing RSS subscriptions continue discovery only after upgrade. Open the anime,
choose Edit subscription or Confirm download scope, check RSS and explicitly
confirm the previewed starting scope/destination. Changing the destination or API
account requires reconfirmation. Use Open WebUI for transfer controls and deletion;
Activity in anime details reports status and import recovery. Removing a task in
WebUI prevents automatic recreation until explicit acquisition retry.

Protect volume backups because they contain recoverable downloader credentials.

See the [LinuxServer qBittorrent image documentation](https://docs.linuxserver.io/images/docker-qbittorrent/)
for its login, port and directory settings.

In Settings, enter an absolute HTTP/HTTPS **WebUI URL** reachable from your
browser, then save and use **Open qBittorrent WebUI**. Embedded usernames/passwords
are rejected. The address is stored as `qbittorrentWebUiUrl` in
`/data/app/settings.json` through `/api/settings`. Clearing and saving persists
`null` and hides the link; omitted update fields retain their values.

Anishelf opens this address directly. Configure the destination's authentication
and network access independently. Anishelf does not proxy qBittorrent or configure
its alternate UI files.

## Authentication and password recovery

Authentication is always enabled, including local development. The first startup
with no `auth.json` generates a random password and atomically publishes its
salted scrypt hash. The plaintext is printed once to the startup console after
HTTP startup succeeds, separately from application file logging. Container logs
and journald can retain this output. The initial password works immediately;
changing it in **Settings → Security** is optional.

Read the initial startup output with:

```sh
docker compose logs backend
```

`/data/app/auth.json` is the independent credential source. `/data/app/auth-session.key`
signs session cookies, while SQLite stores sessions and hashed media-link tokens.
For source installations, these files live under `ANISHELF_DATA_DIR`, or the
platform's default application data directory. Credentials use mode `0600` and
the data directory uses `0700`. The runtime account must own these files.
Keep the entire stopped data directory together in backups; protect backups as
credentials. Existing data volumes initialize authentication once when upgraded.
An invalid/unreadable credential file or unavailable database blocks startup.

### Reset a forgotten password

No Web login is required. These commands print a newly generated password:

```sh
docker compose exec backend node backend/dist/cli.js auth reset-password
docker compose restart backend
```

For a source checkout, use `npm run auth --workspace @anishelf/backend -- reset-password`
with the same deployment environment, then restart the application. The CLI does
not start HTTP, load user settings or probe media tools. If the server cannot
start, use a one-off container mounting the same data volume:

```sh
docker compose run --rm --no-deps backend node backend/dist/cli.js auth reset-password
```

Reset replaces the credential file atomically. A running process retains its
loaded credential until restarted, so restart immediately after any CLI or manual
file change. Previous sessions and media links then fail their credential
fingerprint checks. Do not delete the database to reset a password. If startup
saved credentials but stopped before printing the initial password, use the same
reset procedure.

### Set a chosen password without the Web interface

Use an interactive terminal to generate the full JSON document, with hidden
password entry and confirmation:

```sh
docker compose exec -it backend node backend/dist/cli.js auth hash-password
# Or in a source checkout:
npm run auth --workspace @anishelf/backend -- hash-password
```

Replace `auth.json` with the printed JSON as the runtime account, preserve mode
`0600`, and restart. The document contains version `1`, algorithm `scrypt`, a
hexadecimal `salt` and `hash`, and parameters `N=32768`, `r=8`, `p=1`. Passwords
contain 8–128 Unicode characters. Leading and trailing whitespace is removed
before hashing and verification. No plaintext password,
initial-password environment variable or initial-password import file is stored.

### Sessions and external players

Browser sessions expire 30 days after login. Signing out revokes that session;
changing the password revokes every session and media link. Modified credentials
are detected immediately for Web changes and after restart for manual changes.
The Web interface checks session status on focus and every minute; API requests
also enforce authentication.

External player links and M3U playlists contain a 24-hour token authorizing only
`GET`/`HEAD` for one original file version, including Range requests. Anyone with
that link can access the file until expiry or password change. Links persist
across restarts; replacing the source invalidates them. Already open streams can
finish. Do not publish these links or log their full query strings. Public APIs,
prepared copies, subtitles and artwork require the browser session.

## Caddy reverse proxy

For a domain served by Caddy on the host, set the browser origin in `.env`:

```dotenv
ANISHELF_PUBLIC_ORIGIN=https://example.com
```

Forward the entire site to the **web** container:

```caddyfile
example.com {
    reverse_proxy 127.0.0.1:3000
}
```

The container's Caddy serves files and proxies APIs; the host's Caddy owns TLS.
Keep Host and Origin unchanged. `ANISHELF_PUBLIC_ORIGIN` determines the external
scheme/port and Secure cookies, independently of forwarded headers. The backend
trusts forwarded headers only from loopback peers, so the container proxy can
make per-source login limits shared across users. No proxy-IP setting is needed.

To change the host port, edit only the left-hand port, for example
`127.0.0.1:8080:8080`, then update the host Caddy upstream and the public origin
if its browser-facing port changes. For LAN HTTP access, publish a deliberate
LAN address and set its exact public origin. Use HTTPS for public access.
External-player links still require their media token; no anonymous API bypass
or separate `/api` host proxy rule is needed.

## Multiple resource directories

The default completed-media root is `/data/media`. For additional existing media,
mount each extra location read-only at a distinct server path, then add each path
to the directory list in Settings and save. For example, mount `/host/anime` at `/media/anime` and
`/host/movies` at `/media/movies`. Do not configure both `/media` and its children.
For fresh installations, initialize both paths with:

```sh
ANISHELF_INITIAL_RESOURCE_ROOTS='["/media/anime","/media/movies"]'
```

Use this instead of `ANISHELF_INITIAL_RESOURCE_ROOT`; existing settings always take
precedence. Settings persist the list as `resourceRoots`; legacy single-path files
are read automatically and rewritten on the next save. Up to 64 non-overlapping
paths are supported. DataDir must remain separate from every media path, including
through symlinks.

Files shows one entry per root when multiple paths are configured. Offline roots
retain their previous listing and show a warning while healthy roots keep updating.
All-root failure preserves the previous index. Removing a path hides its files,
retaining history and accepted associations for restoration. Source IDs and history
survive the automatic file-identity migration; old browser file URLs and stored
external-media links should be refreshed after upgrade.
