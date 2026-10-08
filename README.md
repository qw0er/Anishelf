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
- Read access to the media directory and write access to a separate application
  data directory.

The backend currently listens only on loopback addresses. Remote use is available
through SSH port forwarding or a [Caddy reverse proxy](#caddy-reverse-proxy).
The application has no built-in authentication; Caddy must protect domain access.

## Run and use

From the repository root, run:

```sh
npm start
```

This builds the application and starts it at `http://127.0.0.1:3000`.
For a fresh checkout, install dependencies first; see [Build from source](#build-from-source).

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

Use `ghcr.io/qw0er/anishelf:latest` on Linux AMD64 or ARM64 with Docker
or Podman. The image includes Node.js, FFmpeg/FFprobe and the built application.

- Replace `/absolute/media/path` with your media directory.
- Keep `/data` persistent for settings, the database and caches.
- Use host networking without port mappings; Anishelf listens on loopback.
- Media must be readable and data writable by the container's UID/GID 1000.
- Set `ANISHELF_PUBLIC_ORIGIN` to your domain and configure [Caddy](#caddy-reverse-proxy),
  or omit it for local/SSH access.
- `ANISHELF_INITIAL_RESOURCE_ROOT=/media` initializes a fresh installation;
  change existing roots in Settings.

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

### Podman CLI

#### Dedicated rootless user

Use a dedicated non-root `anishelf` account with a writable home and subordinate
UID/GID ranges in `/etc/subuid` and `/etc/subgid`. Create it from an administrator
account if needed:

```sh
sudo useradd --create-home --user-group --shell /bin/bash anishelf
sudo loginctl enable-linger anishelf
```

Ensure the account can read the media directory and owns its application data.
If media access relies on supplementary groups, use `--group-add keep-groups`
(or `GroupAdd=keep-groups` in Quadlet) with the `crun` runtime.
Run rootless commands from this account:

```sh
sudo -iu anishelf
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
```

#### Rootless CLI

Complete the [dedicated user setup](#dedicated-rootless-user), then run as
`anishelf`:

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

#### Rootful CLI

From your administrator account, create a fresh data directory owned by
UID/GID 1000:

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

Use Podman with Quadlet support on Linux with systemd and cgroup v2.
Choose rootful or rootless deployment. The `[Install]` section enables startup
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

Complete the [dedicated user setup](#dedicated-rootless-user), then create the
configuration and data directories as `anishelf`:

```sh
mkdir -p ~/.config/containers/systemd ~/.local/share/anishelf
```

Save `~/.config/containers/systemd/anishelf.container` in `anishelf`'s home:

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

The account must own the data directory and be able to read the media.
`UserNS=keep-id` maps it to UID/GID 1000 inside the container.

Start and inspect the generated service:

```sh
systemctl --user daemon-reload
systemctl --user start anishelf.service
systemctl --user status anishelf.service
journalctl --user -u anishelf.service -f
```

To update, stop the service:

```sh
systemctl --user stop anishelf.service
```

Back up `anishelf`'s `~/.local/share/anishelf`, then pull and start the current
image from the same `anishelf` shell:

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

On SELinux enforcing hosts, use `:Z` for private data and `:ro,z` for shared
media in Quadlet mounts:

```ini
Volume=%h/.local/share/anishelf:/data:Z
Volume=/absolute/media/path:/media:ro,z
```

For rootful Quadlet, use `/var/lib/anishelf:/data:Z`. For CLI deployments, use
`-v` mounts with the same `:Z` and `:ro,z` suffixes. Relabeling changes host file labels;
ensure the directory allows it and that other services can still access it.

### Caddy reverse proxy

Set `ANISHELF_PUBLIC_ORIGIN=https://example.com` in your deployment and
restart it. Configure Caddy on the same host to protect the application:

```caddyfile
example.com {
    basic_auth {
        qwer <password-hash>
    }
    reverse_proxy 127.0.0.1:3000
}
```

Generate `<password-hash>` with `caddy hash-password`, then validate and reload
Caddy. Use your exact public origin, including a non-default port if needed.
Keep Host and Origin headers unchanged. Anishelf has no built-in authentication.

#### External players without authentication

External-player links do not include the browser's Basic Auth credentials.
To make original media accessible without authentication, use:

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

Anyone with an original media URL can access that file. Pages, settings,
prepared media and subtitles remain authenticated.

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
For containers, read them with `docker logs -f anishelf` or `podman logs -f anishelf` or
`journalctl -u anishelf.service -f` (`--user` for rootless Quadlet).

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
