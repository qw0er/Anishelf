# Additional container deployment guidance

The primary deployment paths are [Docker Compose and rootless Podman Quadlet](../README.md#deploy-with-a-container).
Use the shared image, networking, media permissions and environment guidance there.
This document covers alternate deployment methods and operational details.

## qBittorrent WebUI access

Set `ANISHELF_QBITTORRENT_URL=http://qbittorrent:8080` on Anishelf to enable the
proxy. This private upstream must be an HTTP(S) origin with no credentials, path,
query or fragment; restart Anishelf after changing it. Without this variable the
proxy returns an actionable 503 response. The proxy requires an Anishelf session
on every page, asset and API request. Existing instances can keep their own
qBittorrent login, or explicitly trust only the Anishelf backend source address.

**WebUI URL** in Settings is a separate, persisted browser navigation target.
Leave it blank to use the built-in proxy; enter an absolute HTTP/HTTPS URL to
open an independently hosted WebUI. Embedded usernames/passwords are rejected.
Save before opening the link; clearing and saving restores the proxy. This field
does not change the backend upstream, configure qBittorrent's alternate UI files,
or protect the external destination with Anishelf authentication. It is stored
by System Configuration as `qbittorrentWebUiUrl` in `/data/settings.json`.
Blank or cleared values persist as `null`; omitted update fields retain their
current values. The Settings UI reads and saves through `/api/settings`.
Acquisition only exposes read-only navigation information and the proxy route;
it has no independent settings file.
Custom upstream UI assets must support a subpath; response bodies are streamed
without HTML/JavaScript rewriting. The application currently serves at `/`.

## Data storage

Anishelf requires a persistent writable `/data`; both named volumes and bind
mounts satisfy this requirement. The primary examples use named volumes for
consistent lifecycle management. The alternate Podman examples below use bind
mounts when an explicit host directory is useful for backups or storage placement.
`keep-id` lets the dedicated account own a rootless bind mount while the
application runs as UID/GID 1000 inside the container.

Named volumes are isolated by runtime and, for rootless Podman, by account.
Run Podman volume commands as the service account; `sudo podman` uses different
storage. Never mount the same application data in two running instances.

## Data backup and migration

Stop the application before copying data so the database and caches are consistent.
For Docker Compose, run `docker compose stop`, then export the volume to the
current directory with a temporary container:

```sh
docker run --rm --user 0:0 \
  --mount type=volume,source=anishelf-data,target=/data,readonly \
  --mount "type=bind,source=$PWD,target=/backup" \
  --entrypoint tar ghcr.io/qw0er/anishelf:latest \
  -C /data -czf /backup/anishelf-data-backup.tar.gz .
```

For rootless Quadlet, run `systemctl --user stop anishelf.service` and
`podman volume export anishelf-data --output anishelf-data-backup.tar` as `anishelf`.
For bind mounts, back up the entire host data directory after stopping the service.
Keep backups outside the data volume and retain the previous image version for rollback.

Existing bind-mount deployments are not migrated automatically. Stop the old
instance and back up its data before switching the Quadlet configuration.
As `anishelf`, create and import a fresh destination volume:

```sh
podman volume create anishelf-data
tar -C "$HOME/.local/share/anishelf" -cf anishelf-data-migration.tar .
podman volume import anishelf-data anishelf-data-migration.tar
```

Use an empty destination volume. Then install the `.volume` file and updated
`.container` file from the README, reload the user service manager and start the
service. Confirm settings and the library before removing the old directory.
When moving from another account or rootful deployment, an administrator must
copy the stopped data to a location readable by `anishelf` first and adjust its
ownership. Do not reuse another account's Podman storage directory.

## Docker CLI

```sh
docker pull ghcr.io/qw0er/anishelf:latest
docker volume create anishelf-data
docker run -d --name anishelf --restart unless-stopped \
  -p 127.0.0.1:3000:3000 --stop-timeout 15 \
  -e ANISHELF_PORT=3000 \
  -e ANISHELF_INITIAL_RESOURCE_ROOT=/media \
  -e ANISHELF_PUBLIC_ORIGIN=https://example.com \
  --mount type=volume,source=anishelf-data,target=/data \
  --mount type=bind,source=/absolute/media/path,target=/media,readonly \
  ghcr.io/qw0er/anishelf:latest
docker ps --filter name=anishelf
docker logs -f anishelf
```

For SELinux mount options, see [SELinux mounts](#selinux-mounts).

To update:

```sh
docker pull ghcr.io/qw0er/anishelf:latest
docker stop --time 15 anishelf
```

Back up `anishelf-data`, then run `docker rm anishelf` and repeat the `docker run`
command. Keep the data volume.

## Podman CLI

#### Rootless CLI

Complete the [dedicated service account setup](../README.md#dedicated-service-account), then run as
`anishelf`:

```sh
mkdir -p ~/.local/share/anishelf
podman pull ghcr.io/qw0er/anishelf:latest
podman run -d --name anishelf --restart unless-stopped \
  -p 127.0.0.1:3000:3000 --stop-timeout 15 \
  --userns keep-id:uid=1000,gid=1000 --user 1000:1000 \
  -e ANISHELF_PORT=3000 \
  -e ANISHELF_INITIAL_RESOURCE_ROOT=/media \
  -e ANISHELF_PUBLIC_ORIGIN=https://example.com \
  -v "$HOME/.local/share/anishelf:/data" \
  -v /absolute/media/path:/media:ro \
  ghcr.io/qw0er/anishelf:latest
podman ps --filter name=anishelf
podman logs -f anishelf
```

#### Rootful CLI

From your administrator account, create a fresh data directory owned by
UID/GID 1000:

```sh
sudo install -d -m 0750 -o 1000 -g 1000 /var/lib/anishelf
sudo podman pull ghcr.io/qw0er/anishelf:latest
sudo podman run -d --name anishelf --restart unless-stopped \
  -p 127.0.0.1:3000:3000 --stop-timeout 15 --user 1000:1000 \
  -e ANISHELF_PORT=3000 \
  -e ANISHELF_INITIAL_RESOURCE_ROOT=/media \
  -e ANISHELF_PUBLIC_ORIGIN=https://example.com \
  -v /var/lib/anishelf:/data \
  -v /absolute/media/path:/media:ro \
  ghcr.io/qw0er/anishelf:latest
sudo podman ps --filter name=anishelf
sudo podman logs -f anishelf
```

For updates, pull `latest`, stop with `podman stop --time 15 anishelf`, back up
that deployment's data directory, remove with `podman rm anishelf`, and repeat
its run command. Prefix Podman commands with `sudo` for the root deployment.
Use [rootless Quadlet](../README.md#podman-quadlet-rootless) for systemd-managed startup at boot.

## Rootful Podman Quadlet

Use Podman with Quadlet support on Linux with systemd and cgroup v2.
The `[Install]` section enables startup
at boot; start the generated service without running `systemctl enable`.

#### Quadlet as root

Prepare a fresh data directory and the system configuration directory:

```sh
sudo mkdir -p /etc/containers/systemd
sudo install -d -m 0750 -o 1000 -g 1000 /var/lib/anishelf
```

Save `/etc/containers/systemd/anishelf.container`:

```ini
[Unit]
Description=Anishelf media server

[Container]
Image=ghcr.io/qw0er/anishelf:latest
ContainerName=anishelf
PublishPort=127.0.0.1:3000:3000
User=1000:1000
Environment=ANISHELF_PORT=3000
Environment=ANISHELF_INITIAL_RESOURCE_ROOT=/media
Environment=ANISHELF_PUBLIC_ORIGIN=https://example.com
Volume=/var/lib/anishelf:/data
Volume=/absolute/media/path:/media:ro
StopTimeout=15

[Service]
Restart=on-failure
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Rootful Podman uses the system service manager; the application still runs as
UID/GID 1000 inside the container. Ensure that user can read the media directory.

```sh
sudo systemctl daemon-reload
sudo systemctl start anishelf.service
sudo systemctl status anishelf.service
sudo journalctl -u anishelf.service -f
```

The install target starts the service on subsequent boots. Check container health
with `sudo podman inspect --format '{{.State.Health.Status}}' anishelf`.
To update, run `sudo systemctl stop anishelf.service`, back up `/var/lib/anishelf`,
then run:

```sh
sudo podman pull ghcr.io/qw0er/anishelf:latest
sudo systemctl start anishelf.service
sudo systemctl status anishelf.service
```

If you edit the Quadlet file, run `sudo systemctl daemon-reload` before starting.

## SELinux mounts

On SELinux enforcing hosts, named data volumes are managed by the runtime.
For rootless Quadlet, keep `:U` and add `:Z` for private data; use `:ro,z` for
shared media:

```ini
Volume=anishelf-data.volume:/data:Z,U
Volume=/absolute/media/path:/media:ro,z
```

For rootful Quadlet, use `/var/lib/anishelf:/data:Z`. For CLI deployments, use
`-v` mounts with the same `:Z` and `:ro,z` suffixes. For Docker Compose, add `selinux: z` under the media mount's `bind` options.
For Docker CLI, replace the media `--mount` with
`-v /absolute/media/path:/media:ro,z`. Relabeling changes host file labels;
ensure the directory allows it and that other services can still access it.

## Authentication and password recovery

Authentication is always enabled, including local development. The first startup
with no `auth.json` generates a random password and atomically publishes its
salted scrypt hash. The plaintext is printed once to the startup console after
HTTP startup succeeds, separately from application file logging. Container logs
and journald can retain this output. The initial password works immediately;
changing it in **Settings → Security** is optional.

Read the initial startup output with:

```sh
docker compose logs anishelf
# Docker CLI deployment:
docker logs anishelf
# As the dedicated rootless Podman account:
journalctl --user -u anishelf.service
```

`/data/auth.json` is the independent credential source. `/data/auth-session.key`
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
docker compose exec anishelf node backend/dist/cli.js auth reset-password
docker compose restart anishelf
```

For Docker CLI, replace `docker compose exec anishelf` with `docker exec anishelf`
and restart with `docker restart anishelf`. For rootless Quadlet, run as the
service account:

```sh
podman exec anishelf node backend/dist/cli.js auth reset-password
systemctl --user restart anishelf.service
```

For a source checkout, use `npm run auth --workspace @anishelf/backend -- reset-password`
with the same deployment environment, then restart the application. The CLI does
not start HTTP, load user settings or probe media tools. If the server cannot
start, use a one-off container mounting the same data volume:

```sh
docker compose run --rm --no-deps anishelf node backend/dist/cli.js auth reset-password
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
docker compose exec -it anishelf node backend/dist/cli.js auth hash-password
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

Set `ANISHELF_PUBLIC_ORIGIN=https://example.com` and restart Anishelf. Keep Host
and Origin headers unchanged. Caddy on the same host provides TLS and forwards
the request scheme and client address. By default only loopback proxies are trusted:

```caddyfile
example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Container deployments use bridge networking and publish `127.0.0.1:3000:3000`.
Keep `ANISHELF_HOST=0.0.0.0` inside the container (the image default); container
loopback listeners cannot receive bridge port mappings. To change the host port,
change the left-hand port only, for example `127.0.0.1:8080:3000`, and update
Caddy's upstream. Set `ANISHELF_PUBLIC_ORIGIN` to the browser-facing origin,
including its port, whenever it differs from the internal listener. This also
supports deliberate LAN publication; keep public access behind HTTPS.

Caddy is expected to run on the host and connect to the published loopback port.
Only loopback peers are trusted for forwarded headers. Container forwarding may
present a gateway IP instead, so per-source login limits can be shared across
users. This does not block proxy access: Host/Origin validation uses the configured
public origin, and Secure cookies depend on that origin rather than forwarded
headers. No proxy-IP configuration is required.

When migrating an existing host-network deployment, recreate the container with
port publication and remove any old `ANISHELF_HOST=127.0.0.1` override. Keep its
existing data volume and media mounts. Do not run both instances on the same data.

Use the exact public origin, including a non-default port if necessary. HTTPS
origins use Secure cookies; local HTTP works when no HTTPS public origin is set.
Do not serve the public application over plain HTTP.

When migrating, keep the existing Caddy Basic Auth until application login,
password recovery and an external-player link have been checked. Then remove
`basic_auth` and any `/api/media/*` bypass matcher. Anishelf validates media
access itself; no anonymous media-path exemption is needed.


See the [Docker volume reference](https://docs.docker.com/engine/storage/volumes/)
and [Podman Quadlet reference](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
for volume lifecycle and supported unit keys.

## Multiple resource directories

Mount each media location read-only at a distinct server path, then add each path
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
