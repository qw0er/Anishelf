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
through SSH port forwarding; authentication and public access are outside the
current scope.

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
Node.js 24, FFmpeg/FFprobe, database migrations and the built frontend. Choose one
of these deployment methods:

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

Replace `/absolute/media/path` with an existing media directory and save `/media`
in Settings. When reusing data, update any saved host media path to `/media`.
Keep `/data` persistent; it holds settings, SQLite and caches. Stop the previous
service before switching methods to avoid sharing a database or listener between
running instances. Docker, rootful Podman and rootless Podman have separate
storage; switching runtimes requires an explicit data transfer while stopped.

The image runs as UID/GID 1000. Media must be readable and bind-mounted data
writable by the container user. Rootless examples map the host user to that UID.
On SELinux systems, use `Z` for private mounts or `z` for media shared between
containers. GPU acceleration requires additional host/device configuration.
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
  --mount type=volume,source=anishelf-data,target=/data \
  --mount type=bind,source=/absolute/media/path,target=/media,readonly \
  ghcr.io/qw0er/anishelf:latest
docker ps --filter name=anishelf
docker logs -f anishelf
```

On SELinux hosts, replace the media `--mount` with
`-v /absolute/media/path:/media:ro,Z`.

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
the [usage instructions](#run-and-use), and save `/media` in Settings. Change
`ANISHELF_PORT` for a different host port. Host networking requires no `ports` entry. The image health
check uses the same port; `docker compose ps` reports its health status.
On SELinux hosts, add `selinux: Z` under `bind` for a private media mount, or
`selinux: z` if other containers share that directory. Ensure UID/GID 1000 can
read the media files.

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
  -v "$HOME/.local/share/anishelf:/data:Z" \
  -v /absolute/media/path:/media:ro,Z \
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
  -v /var/lib/anishelf:/data:Z \
  -v /absolute/media/path:/media:ro,Z \
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
Volume=/var/lib/anishelf:/data:Z
Volume=/absolute/media/path:/media:ro,Z
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
Volume=%h/.local/share/anishelf:/data:Z
Volume=/absolute/media/path:/media:ro,Z
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
1000. `:Z` labels private mounts for SELinux; use `:z` for shared media.
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

Access `http://127.0.0.1:3000` locally or via SSH and configure `/media` in Settings.
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

## Configuration

Set environment variables before starting the application. Restart after changes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Loopback listener address: `127.x.x.x` or `::1`. |
| `ANISHELF_PORT` | `3000` | Listener port, from 1 to 65535. |
| `ANISHELF_FRONTEND_DIR` | Unset | Absolute frontend build directory containing `index.html`; enables page hosting. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory | Absolute writable directory for settings, the database and caches. |
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
