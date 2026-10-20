# Container deployment

Use the repository's [compose.yaml](../compose.yaml) with Docker Engine and the
Compose plugin. [Quick start](../README.md#deploy-with-a-container) covers local
builds and release images. Container deployments now run a Caddy frontend and a
Node backend separately; the earlier single-container CLI/Quadlet examples no
longer describe the deployment topology.

## Networking and storage

`web` publishes the application at `127.0.0.1:3000:8080`. It serves the SPA and proxies the
unchanged `/api` path to `backend:3000` on the Compose network. Keep the backend
port private. The application services run as UID/GID 1000. Backend and qBittorrent
both mount the named `anishelf-data` volume at `/data`. qBittorrent configuration
has its own volume; no host media bind or separate incomplete-download volume is
required. Set `ANISHELF_PUBLIC_ORIGIN` on `backend` to the browser's
exact origin, including its port. This setting validates Host/Origin and selects
Secure cookies; no CORS configuration or browser API URL is needed.

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

Keep the named `anishelf-data` volume shared by backend and qBittorrent:

| Path in both containers | Contents |
| --- | --- |
| `/data/app` | Anishelf credentials, sessions, settings, SQLite and generated assets |
| `/data/media` | Completed media; the initial Anishelf resource root |
| `/data/incomplete` | In-progress downloads, outside every watched root |

The backend image defaults `ANISHELF_DATA_DIR` to `/data/app` and creates all three
directories owned by UID/GID 1000. Fresh named-volume initialization copies this
layout from the image. Both mounts are writable; Anishelf's application still
treats original media as read-only. The shared storage does not isolate Anishelf
state from qBittorrent. `web` has no data mount. Never share the application state
between two running backends. Do not configure `/data` as a resource root: it would
contain application state and incomplete downloads and fails directory separation.

## Data backup and migration

Stop both writers, then back up the shared volume (including downloaded media and
partial downloads). Ensure the backup destination has enough space:

```sh
docker compose stop
docker run --rm --user 0:0 \
  --mount type=volume,source=anishelf-data,target=/data,readonly \
  --mount "type=bind,source=$PWD,target=/backup" \
  --entrypoint tar ghcr.io/qw0er/anishelf-backend:latest \
  -C /data -czf /backup/anishelf-data-backup.tar.gz .
```

For a locally built installation, use the backend image built by Compose in that
command. Also back up `anishelf-qbittorrent-config`, which holds qBittorrent's
configuration and task state, while qBittorrent is stopped. Copy credentials,
database, settings and caches together. Keep backups outside the volume. Restore
only while both services are stopped and preserve UID/GID 1000 ownership and
private credential file permissions.

### Upgrade an existing flat data volume

Earlier images stored application state directly at `/data`. Changing the data
directory without moving that state would initialize a separate installation.
After stopping the services and making a verified backup, move the old application
files and directories into `app/`. The following command is for the standard
`anishelf-data` volume; use the locally built backend image if necessary:

```sh
docker run --rm --user 0:0 \
  --mount type=volume,source=anishelf-data,target=/data \
  --entrypoint sh ghcr.io/qw0er/anishelf-backend:latest -ec '
    mkdir -p /data/app /data/media /data/incomplete
    test -z "$(ls -A /data/app)" || {
      echo "app/ is not empty; inspect the existing layout before migrating." >&2
      exit 1
    }
    find /data -mindepth 1 -maxdepth 1 \
      ! -name app ! -name media ! -name incomplete \
      -exec mv -t /data/app -- {} +
    chown 1000:1000 /data /data/app /data/media /data/incomplete
  '
```

This preserves existing file permissions and does not merge two application
states. Keep `settings.json`, credentials, SQLite (including any WAL/SHM files),
logs and generated assets together. If an earlier installation already uses the
reserved `app`, `media` or `incomplete` names for other content, inspect and resolve
those paths before using the command. No automatic migration runs at startup.

Existing settings override `ANISHELF_INITIAL_RESOURCE_ROOT`. If media previously
lived in a host bind, copy it into the shared volume's `media/` directory while
both services are stopped, then change the saved resource root to `/data/media`
in Settings. Moving to a different resource-root path does not guarantee automatic
identity/history relinking; retain the old media mount and saved root until that
transition has been checked if preserving existing associations is required.
For existing qBittorrent tasks, update their save locations and confirm file access
before resuming. Retain the old incomplete volume until its partial downloads have
been transferred or finished; Compose no longer mounts it automatically.

To migrate from the all-in-one image, stop the old container or systemd service,
back up its data, and use the same `anishelf-data` volume in Compose. If it used a
bind mount or a differently named volume, update both shared mounts accordingly.
Migrate flat application state and media using the steps above. Remove
`ANISHELF_FRONTEND_DIR` from the backend environment. Disable the old startup
unit before starting Compose; do not run two backends on the same data.

For source builds, update the checkout and run `docker compose up -d --build`.
For published images, pull both matching release versions before stopping and
backing up the deployment, then run `docker compose up -d --no-build`.
Keep the backup for database rollback. Do not use `down --volumes` during upgrades.

## SELinux mounts

The default stack uses named volumes and needs no media bind relabeling. If adding
a shared media bind mount on an enforcing host, add `selinux: z` under the
mount's `bind` options. Use `Z` only for a private mount. Docker manages labels
for named data volumes; relabel bind-mounted data as appropriate for the host.

## qBittorrent WebUI access

Compose includes `linuxserver/qbittorrent:latest`, with PUID/PGID 1000 and its own
`anishelf-qbittorrent-config` volume. The browser WebUI is published at
`http://localhost:8080`; TCP/UDP port 6881 is published for peers. The backend has
`ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL=http://localhost:8080`, which seeds the
saved browser URL only when `settings.json` does not exist. It works with or
without resource-root initializers. Existing files, including a cleared or absent
URL, remain unchanged. The initializer does not connect to or authenticate with
the downloader API, and it does not restore the removed backend proxy.

The URL must be reachable **from the browser**. The Compose hostname
`qbittorrent` is only resolvable inside its container network. For remote access,
use a browser-facing WebUI domain or forward both loopback ports:

```sh
ssh -L 3000:127.0.0.1:3000 -L 8080:127.0.0.1:8080 user@server
```

Read the temporary `admin` password using `docker compose logs qbittorrent`, then
set a permanent password in qBittorrent. Configure completed downloads at
`/data/media` and enable its incomplete directory at `/data/incomplete`.
Both services see these paths in the same named volume. These preferences must
be saved in qBittorrent; volume mounting does not configure them. The incomplete
directory keeps partial files outside the watched root once that preference is
enabled. Retain `anishelf-data` and `anishelf-qbittorrent-config` across recreations
and stop both writers before backing them up.

In Anishelf **Settings → qBittorrent → API connection**, enter API URL
`http://qbittorrent:8080`, username `admin` (or your configured account) and the
password you set in qBittorrent. Save, then choose **Test connection**. This URL
is reached by the backend and is separate from the browser WebUI URL below.
Passwords are stored privately in `/data/app/acquisition/qbittorrent.json` with
mode `0600`, never returned by the settings API. An empty password keeps the saved
one only for the same URL and username; changing either requires reentry.
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
contain 12–128 Unicode characters and are never trimmed. No plaintext password,
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

For a domain served by Caddy on the host, set the backend environment in Compose:

```yaml
ANISHELF_PUBLIC_ORIGIN: https://example.com
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

The default shared-volume root is `/data/media`. For additional existing media,
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
