# Deployment

[README](../README.md#deploy-with-a-container) contains the production Docker
Compose configuration. The repository-root Compose file is for development.
Both deployment methods pull separate Web and Backend images from GHCR.

## Podman Quadlet

Use rootless Podman with Quadlet and cgroup v2. Copy the core files from
[package/deploy/quadlet](../package/deploy/quadlet/) to
`~/.config/containers/systemd/`: `anishelf.network`, `anishelf-app.volume`,
`anishelf-media.volume`, `anishelf-backend.container` and `anishelf-web.container`.
Use the same published image tag in both application containers.

Save `anishelf.target` in `~/.config/systemd/user/` (regular systemd units use
this directory, rather than the Quadlet directory):

```ini
[Unit]
Description=Anishelf stack
Requires=anishelf-backend.service anishelf-web.service
After=anishelf-backend.service anishelf-web.service

[Install]
WantedBy=default.target
```

`anishelf.network`:

```ini
[Network]
NetworkName=anishelf
```

`anishelf-app.volume`:

```ini
[Volume]
VolumeName=anishelf-app
```

`anishelf-media.volume`:

```ini
[Volume]
VolumeName=anishelf-media
```

`anishelf-backend.container`:

```ini
[Unit]
PartOf=anishelf.target
Description=Anishelf backend

[Container]
# Pin the same release tag in Backend and Web.
Image=ghcr.io/qw0er/anishelf-backend:latest
ContainerName=anishelf-backend
Network=anishelf.network
NetworkAlias=backend
UserNS=keep-id:uid=1000,gid=1000
# Set the exact browser origin, including HTTPS or a changed host port.
Environment=ANISHELF_PUBLIC_ORIGIN=http://localhost:3000
# Initial root for new settings only; change existing roots in Settings.
Environment=ANISHELF_INITIAL_RESOURCE_ROOTS=/data/media
# Optional API form hint; use Settings for external endpoints and credentials.
Environment=ANISHELF_QBITTORRENT_API_URL=http://qbittorrent:8080
Volume=anishelf-app.volume:/data/app
# Optional host media: replace with /absolute/media:/data/media:ro,z.
Volume=anishelf-media.volume:/data/media:ro

[Service]
Restart=always
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=anishelf.target
```

`anishelf-web.container`:

```ini
[Unit]
PartOf=anishelf.target
Description=Anishelf web
Requires=anishelf-backend.service
After=anishelf-backend.service

[Container]
# Pin the same release tag in Web and Backend.
Image=ghcr.io/qw0er/anishelf-web:latest
ContainerName=anishelf-web
Network=anishelf.network
UserNS=keep-id:uid=1000,gid=1000
# Host address:host port:container port. Keep container port 8080.
# Change the host address for LAN access; update Backend public origin too.
PublishPort=127.0.0.1:3000:8080

[Service]
Restart=always
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=anishelf.target
```

To include qBittorrent, also install these three files. Omit them for an external downloader.

`anishelf-qbittorrent-config.volume`:

```ini
[Volume]
VolumeName=anishelf-qbittorrent-config
```

`anishelf-qbittorrent-incomplete.volume`:

```ini
[Volume]
VolumeName=anishelf-qbittorrent-incomplete
```

`anishelf-qbittorrent.container`:

```ini
[Unit]
PartOf=anishelf.target
Description=Anishelf optional qBittorrent

[Container]
# Pin the desired qBittorrent image tag here.
Image=docker.io/linuxserver/qbittorrent:latest
ContainerName=anishelf-qbittorrent
Network=anishelf.network
NetworkAlias=qbittorrent
UserNS=keep-id:uid=1000,gid=1000
User=0
Group=0
Environment=PUID=1000
Environment=PGID=1000
# Internal WebUI/API port; keep 8080 when only changing the host port.
Environment=WEBUI_PORT=8080
# Peer port: change this and both TCP/UDP PublishPort entries together.
Environment=TORRENTING_PORT=6881
Volume=anishelf-qbittorrent-config.volume:/config
# For host media, use the same path as Backend: /absolute/media:/data/media:z.
Volume=anishelf-media.volume:/data/media
Volume=anishelf-qbittorrent-incomplete.volume:/data/incomplete
# WebUI host address:host port:container port; edit the first two fields.
# Set Anishelf Settings WebUI URL to the browser-reachable address.
PublishPort=127.0.0.1:8080:8080
# Peer host/container ports must match TORRENTING_PORT (TCP and UDP).
PublishPort=6881:6881
PublishPort=6881:6881/udp
Entrypoint=/bin/sh
Exec=-ec "mkdir -p /data/media /data/incomplete; chown 1000:1000 /data/media /data/incomplete; echo 'qBittorrent media and incomplete mount roots initialized.'; exec /init"

[Service]
Restart=always
TimeoutStartSec=900
TimeoutStopSec=45

[Install]
WantedBy=anishelf.target
```

```sh
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user
# Save the Quadlet files and target in their respective directories.
systemctl --user daemon-reload
systemctl --user enable --now anishelf.target
journalctl --user -u anishelf-backend.service -f
```

Open `http://localhost:3000`. The backend journal contains the initial password.
Read the downloader password with `journalctl --user -u anishelf-qbittorrent.service`.
`UserNS=keep-id` maps your user to container UID/GID 1000; downloader initialization
runs as container root to prepare writable mount roots, then drops privileges.
For host media, replace the media volume mount in both containers with the same
absolute host path (`:ro,z` for Backend, `:z` for qBittorrent).
Enable startup without login with `sudo loginctl enable-linger "$USER"`.
Use the target for all stack operations. Installed optional qBittorrent files join
the target automatically through `WantedBy=anishelf.target`; `PartOf` propagates
stop and restart to all three containers. Network and volumes remain available.

```sh
systemctl --user start anishelf.target
systemctl --user stop anishelf.target
systemctl --user restart anishelf.target
```

Enable only `anishelf.target`, not the generated container services. If upgrading
from the previous Quadlet examples, replace all installed `.container` files and
reload so they no longer start independently through `default.target`.
See the [Quadlet reference](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html).

## Optional deployment settings

Compose settings are listed in the [README](../README.md#deploy-with-a-container)
and [deployment .env example](../package/deploy/.env.example). Quadlet uses the
corresponding `Image`, `PublishPort`, `Environment` and `Volume` entries directly;
it does not read Compose `.env` files. Keep WebUI internal port 8080 for the
suggested API address. Change peer `TORRENTING_PORT` and both peer publications
together.

## Network and qBittorrent

Backend stays private; Web and the optional downloader publish their own ports. For HTTPS, set
`ANISHELF_PUBLIC_ORIGIN=https://anime.example.com` in the backend environment and
forward your host reverse proxy to `127.0.0.1:3000`:

```caddyfile
anime.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Configure the bundled or an existing qBittorrent instance in Anishelf Settings: API address,
credentials, Test connection, then Download destination. Its completed directory
must map to the same files mounted at `/data/media`; incomplete downloads must
stay outside watched media. Configure the optional browser WebUI link separately.
Container `localhost` refers to that container, not the host. For rootless Podman,
a host downloader may be reachable through `host.containers.internal` if its
listener and firewall allow it. Confirm each subscription's preview to authorize
automatic downloads. Destination validation alone does not prove shared visibility.

The optional bundled qBittorrent uses `http://qbittorrent:8080`, completed path
`/data/media` and an enabled incomplete path `/data/incomplete`. Read its temporary
password with `docker compose logs qbittorrent` and set a permanent one in WebUI.

## Storage, updates and recovery

- Keep `anishelf-app` persistent and separate from media. It contains the database,
  settings, credentials and generated caches. Do not share it between backends.
- Stop the application and optional downloader before backing up the entire app volume. Back up media and
  downloader state separately. Preserve ownership and protect credential backups.
- Quadlet updates: run `systemctl --user stop anishelf.target`, back up, change both image tags, run
  `podman pull` for both images, then `systemctl --user daemon-reload` and
  `systemctl --user start anishelf.target`. Reverting images does not undo
  database migrations; retain the matching pre-update backup.
- Extra media roots need read-only mounts and matching entries in Settings.
  Network filesystems require checking watcher behavior; manual scans reconcile drift.
- The four volumes match Compose: `anishelf-app`, `anishelf-media`,
  `anishelf-qbittorrent-config` and `anishelf-qbittorrent-incomplete`.

Reset a forgotten password, then restart Backend:

```sh
# Docker Compose
docker compose exec backend node backend/dist/cli.js auth reset-password
docker compose restart backend

# Quadlet
podman exec anishelf-backend node backend/dist/cli.js auth reset-password
systemctl --user restart anishelf-backend.service
```
