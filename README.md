# Anishelf

Anishelf is a personal anime library browser and player. Point it at an existing
media directory, browse its folder structure, and watch videos in your browser.

- Automatic and manual library scans.
- Saved playback progress and watch history.
- External subtitles and supported embedded text subtitles.
- Media compatibility checks and prepared copies for browser playback.
- Original-media links for external players.

## Requirements

- For container deployment, use Docker or Podman on Linux. The image includes
  Node.js, FFmpeg/FFprobe and the application; no source build is required.
- For running from source, install Node.js 24 and npm, plus FFmpeg and FFprobe
  for media inspection, subtitle extraction and preparation. Direct playback
  remains available without these tools when the browser supports the original media.
- Read access to the media directory and write access to a separate application
  data directory.

The backend currently listens only on loopback addresses. Remote use is available
through SSH port forwarding or a [Caddy reverse proxy](#caddy-reverse-proxy).
The application has no built-in authentication; Caddy must protect domain access.

## Run and use

To run a previously built application on Linux or macOS, start it from the
repository root:

```sh
ANISHELF_FRONTEND_DIR="$PWD/web/dist" npm run start:backend
```

On Windows PowerShell:

```powershell
$env:ANISHELF_FRONTEND_DIR = Join-Path (Get-Location).Path 'web/dist'
npm run start:backend
```

If you have not built the application yet, follow [Build](#build) first.

Open [Anishelf](http://127.0.0.1:3000), then:

1. Save the absolute media directory in Settings. For a container deployment,
   use the mounted path, such as `/media`.
2. Wait for the scan, browse folders and select a video to play.
3. Select subtitles or prepare a compatible copy when needed. Use **Copy media
   link** to open the original file in an external player.

The library scans on startup and periodically. Use a manual scan after changing
media files, or adjust the automatic scan interval in Settings; `0` disables
scheduled scans. Playback support depends on the browser and the media format.

For a remote server, forward its application port:

```sh
ssh -L 3000:127.0.0.1:3000 user@server
```

Open the same local address and keep the SSH connection active.

## Deploy with a container

Use `ghcr.io/qw0er/anishelf:latest` on Linux AMD64 or ARM64. The image includes
Node.js 24, FFmpeg/FFprobe, database migrations and the built frontend. The
examples include `ANISHELF_PUBLIC_ORIGIN=https://example.com` for domain
access through an authenticated Caddy proxy. Replace it with your actual origin
and apply the [Caddy configuration](#caddy-reverse-proxy). For local or SSH-only
access, omit this variable. Choose one of these deployment methods:

- [Docker CLI](#docker-cli)
- [Docker Compose](#docker-compose)
- [Podman CLI](#podman-cli)
- [Podman Quadlet as root](#quadlet-as-root)
- [Podman Quadlet rootless](#quadlet-rootless)

All examples use host networking because the backend accepts only loopback
listeners. Do not add port mappings (`-p`, Compose `ports`, or Quadlet
`PublishPort`). Set `ANISHELF_PORT` to another unused host port if needed; the
image health check reads the same variable. Access the application locally or
through [SSH forwarding](#run-and-use).

Replace `/absolute/media/path` with an existing media directory. The examples set
`ANISHELF_INITIAL_RESOURCE_ROOT=/media` so a fresh data directory automatically
creates `settings.json` with that root. Existing settings always take precedence,
including `resourceRoot: null`; when reusing data, update the saved root in Settings
if needed. The initial root must be an accessible, readable directory separate
from `/data`. This variable is an initialization default, not a permanent override.
Keep `/data` persistent; it holds settings, SQLite and caches. Stop the previous
service before switching methods to avoid sharing a database or listener between
running instances. Docker, rootful Podman and rootless Podman have separate
storage; switching runtimes requires an explicit data transfer while stopped.

The image runs as UID/GID 1000. Media must be readable and bind-mounted data
writable by the container user. Rootless examples map the host user to that UID.
The examples do not relabel host directories. On enforcing SELinux hosts, follow
the [SELinux mount guidance](#selinux-mounts) below. GPU acceleration requires
additional host/device configuration.
If GHCR requires authentication, log in with the same user and runtime that
will pull the image (`docker login ghcr.io`, `podman login ghcr.io`, or
`sudo podman login ghcr.io`).

`latest` follows stable releases. Pulling alone does not update a running
container. Before updating, record its image digest and back up application data
while stopped. Rollback can require both the previous image and its matching
data backup after database migrations. Automatic updates are not configured.

### Docker CLI

```sh
docker pull ghcr.io/qw0er/anishelf:latest
docker volume create anishelf-data
docker run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 \
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

### Docker Compose

On a Linux host with Docker Engine and the Compose plugin, save this as
`compose.yaml`. Replace `/absolute/media/path` with an existing media directory.
Both AMD64 and ARM64 hosts use the same image reference.

```yaml
services:
  anishelf:
    image: ghcr.io/qw0er/anishelf:latest
    restart: unless-stopped
    network_mode: host
    stop_grace_period: 15s
    environment:
      ANISHELF_PORT: "3000"
      ANISHELF_INITIAL_RESOURCE_ROOT: "/media"
      ANISHELF_PUBLIC_ORIGIN: "https://example.com"
    volumes:
      - anishelf-data:/data
      - type: bind
        source: /absolute/media/path
        target: /media
        read_only: true
        bind:
          create_host_path: false

volumes:
  anishelf-data:
    external: true
    name: anishelf-data
```

Create the volume if it does not already exist, then start the service from the
directory containing `compose.yaml`:

```sh
docker volume create anishelf-data
docker compose config
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f anishelf
```

The external volume reuses data from the Docker run example and survives
`docker compose down`. Stop the old container before switching to Compose so
only one process uses the database and port. Docker and Podman have separate
volume stores; this does not transfer data between runtimes.

Open `http://127.0.0.1:3000` locally or through the SSH forwarding described in
the [usage instructions](#run-and-use). Fresh data uses `/media` automatically;
existing settings remain unchanged. Change
`ANISHELF_PORT` for a different host port. Host networking requires no `ports` entry. The image health
check uses the same port; `docker compose ps` reports its health status.
Ensure UID/GID 1000 can read the media files. See [SELinux mounts](#selinux-mounts)
before enabling Compose relabeling options.

To update to the current `latest` image, run:

```sh
docker compose pull
docker compose stop anishelf
```

Back up the stopped service's `anishelf-data` volume before restarting:

```sh
docker compose up -d
docker compose ps
```

Keep the volume and its backup. Database migrations can require restoring the
matching backup when rolling back to an older image.
See the [Compose service reference](https://docs.docker.com/reference/compose-file/services/)
for networking and mount options.

### Podman CLI

For rootless Podman, run as the user who owns the application data:

```sh
mkdir -p ~/.local/share/anishelf
podman pull ghcr.io/qw0er/anishelf:latest
podman run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 \
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

To run Podman as root, create a fresh data directory owned by UID/GID 1000:

```sh
sudo install -d -m 0750 -o 1000 -g 1000 /var/lib/anishelf
sudo podman pull ghcr.io/qw0er/anishelf:latest
sudo podman run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 --user 1000:1000 \
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
Use Quadlet below for systemd-managed startup at boot.

### Podman Quadlet

Use Linux with systemd, cgroup v2 and Podman with Quadlet support. Choose either
the root or rootless configuration. `[Container] User=` controls the user inside
the container; the configuration location selects rootful or rootless Podman.
Quadlet generates `anishelf.service` and applies `[Install]` during generation;
do not run `systemctl enable` on the generated service.

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
Network=host
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

#### Quadlet rootless

Run these commands as the non-root user who will own the service. Create the
configuration and data directories:

```sh
mkdir -p ~/.config/containers/systemd ~/.local/share/anishelf
```

Save `~/.config/containers/systemd/anishelf.container`:

```ini
[Unit]
Description=Anishelf media server

[Container]
Image=ghcr.io/qw0er/anishelf:latest
ContainerName=anishelf
Network=host
UserNS=keep-id:uid=1000,gid=1000
User=1000:1000
Environment=ANISHELF_PORT=3000
Environment=ANISHELF_INITIAL_RESOURCE_ROOT=/media
Environment=ANISHELF_PUBLIC_ORIGIN=https://example.com
Volume=%h/.local/share/anishelf:/data
Volume=/absolute/media/path:/media:ro
StopTimeout=15

[Service]
Restart=on-failure
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

Replace the media path; the rootless user must own the data directory and be able
to read the media. The user namespace maps that host user to the image's UID/GID
1000. See [SELinux mounts](#selinux-mounts) if SELinux blocks access.
This data directory is separate from the Docker volume. Copy existing data only
while the old service is stopped, preserving a backup and adjusting ownership
for the rootless user.

Start and inspect the generated service:

```sh
systemctl --user daemon-reload
systemctl --user start anishelf.service
systemctl --user status anishelf.service
journalctl --user -u anishelf.service -f
```

To start at boot and keep the user service running after logout:

```sh
sudo loginctl enable-linger "$USER"
```

Access `http://127.0.0.1:3000` locally or via SSH. Fresh data uses `/media`
automatically; existing settings can still be changed in Settings.
Change `Environment=ANISHELF_PORT=3000` for another unused host port; omit
`PublishPort` with host networking. Check the image health with
`podman inspect --format '{{.State.Health.Status}}' anishelf`.

To update, stop the service:

```sh
systemctl --user stop anishelf.service
```

Back up `~/.local/share/anishelf`, then pull and start the current image:

```sh
podman pull ghcr.io/qw0er/anishelf:latest
systemctl --user daemon-reload
systemctl --user start anishelf.service
systemctl --user status anishelf.service
```

Retain the data backup for database rollback.

See the [Quadlet reference](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
for supported keys and generator troubleshooting.

### SELinux mounts

On SELinux enforcing hosts, use `:Z` for private application data and `:ro,z`
for shared, read-only media. For Podman CLI:

```sh
-v "$HOME/.local/share/anishelf:/data:Z" \
-v /srv/anime:/media:ro,z
```

For rootless Quadlet, change the mount entries to:

```ini
Volume=%h/.local/share/anishelf:/data:Z
Volume=/srv/anime:/media:ro,z
```

For rootful Quadlet, use `/var/lib/anishelf:/data:Z` instead. Compose bind mounts
support `bind.selinux: Z` for private data or `z` for shared media.
Relabeling changes host file labels and requires permission and filesystem
support; `:ro` does not prevent it. If `lsetxattr ... operation not permitted`
occurs, have the administrator check labeling permissions and other services
using the directory. SELinux isolation can remain enabled with these labels.

### Caddy reverse proxy

Keep the backend listening on loopback and configure the external origin. For
example, if Caddy serves `https://example.com` and Anishelf uses port 3000,
add these environment variables to your deployment:

```ini
ANISHELF_PORT=3000
ANISHELF_PUBLIC_ORIGIN=https://example.com
```

For Quadlet, use `Environment=ANISHELF_PORT=3000` and
`Environment=ANISHELF_PUBLIC_ORIGIN=https://example.com`. For Compose, add
both values under `environment`; for CLI deployment, pass each with `-e`.
Recreate the container or restart the Quadlet service after configuration changes.

`ANISHELF_PUBLIC_ORIGIN` allows one explicit external origin, without wildcards
or a list of domains. With the example above:

- Requests with Host `example.com` (or `example.com:443`) are accepted.
  Other external domains and ports are rejected.
- Mutations carrying Origin must match `https://example.com`; HTTP, other
  domains and other ports are rejected. Cross-site mutation metadata is rejected
  even when Origin is absent.
- Local access through the configured loopback listener or `localhost` remains
  available on the backend port, including health checks.
- When unset, only the local Host rules apply. This setting does not authenticate
  users; the reverse proxy must authenticate externally accessible routes, except
  for original media explicitly made public as described below.

Configure Caddy to authenticate the entire application and preserve Host and
Origin headers:

```caddyfile
example.com {
    basic_auth {
        qwer <password-hash>
    }
    reverse_proxy 127.0.0.1:3000
}
```

Generate the password hash with `caddy hash-password` and replace
`<password-hash>`. Validate and reload your Caddy configuration after editing.
Caddy must share the host network with Anishelf to reach this loopback upstream.
Use the exact browser origin, including an external non-default port if present;
paths, credentials, queries and fragments are not accepted. Do not rewrite Host
or Origin to the upstream address. Forwarded headers do not grant access.

Check `http://127.0.0.1:3000/api/health` locally, then open the HTTPS domain,
authenticate, and verify both browsing and a Settings save. The public origin
allows that domain while retaining local health checks and rejecting unrelated
Hosts, mutation Origins and cross-site mutation metadata. Basic authentication
is provided by Caddy, not by the public-origin setting.
See [Caddy basic authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth).

#### External players without authentication

With the configuration above, external players must supply their own Basic Auth
credentials. Copy media link, downloaded M3U playlists and external-player launch
links contain only the original media URL; they do not transfer the browser's
authentication state. A player that does not supply credentials receives HTTP 401.

To allow external players to open original media without credentials, replace the
Caddy site block with:

```caddyfile
example.com {
    @protected {
        not path /api/media/*
    }

    basic_auth @protected {
        qwer <password-hash>
    }
    reverse_proxy 127.0.0.1:3000
}
```

This exempts `/api/media/*` from Basic Auth while keeping pages, file listings,
settings and other routes authenticated. Original media retains GET/HEAD and
byte-range support for seeking. Prepared media and subtitle routes remain
authenticated. Keep `ANISHELF_PUBLIC_ORIGIN` and the upstream configuration unchanged.
See [Caddy request matchers](https://caddyserver.com/docs/caddyfile/matchers).

Anyone who obtains an original media URL can access that file without a password;
file IDs are not access credentials. Use this configuration only if that access
is intended. Validate and reload Caddy, then check that an original media link
works without credentials while the application page still requests authentication.

## Configuration

Set environment variables before starting the application. Restart after changes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Loopback listener address: `127.x.x.x` or `::1`. |
| `ANISHELF_PORT` | `3000` | Listener port, from 1 to 65535. |
| `ANISHELF_PUBLIC_ORIGIN` | Unset | One allowed external HTTP(S) origin, such as `https://example.com`; local access remains available. Authentication belongs to the reverse proxy. |
| `ANISHELF_FRONTEND_DIR` | Unset | Absolute frontend build directory containing `index.html`; enables page hosting. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory | Absolute writable directory for settings, the database and caches. |
| `ANISHELF_INITIAL_RESOURCE_ROOT` | Unset | Absolute readable media directory used only to create missing `settings.json`; existing settings are preserved. |
| `ANISHELF_FFMPEG_PATH` | `ffmpeg` from PATH | Optional absolute FFmpeg executable path. |
| `ANISHELF_FFPROBE_PATH` | `ffprobe` from PATH | Optional absolute FFprobe executable path. |

Without `ANISHELF_FRONTEND_DIR`, the backend serves only APIs and media. A configured
frontend directory without `index.html` fails startup. Keep application data outside
the media and frontend directories, and preserve it across updates. Stop the
application and back up its data before upgrading.

## Build

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
