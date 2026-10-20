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
Description=Anishelf backend

[Container]
Image=ghcr.io/qw0er/anishelf-backend:latest
ContainerName=anishelf-backend
Network=anishelf.network
NetworkAlias=backend
UserNS=keep-id:uid=1000,gid=1000
Environment=ANISHELF_PUBLIC_ORIGIN=http://localhost:3000
Environment=ANISHELF_INITIAL_RESOURCE_ROOT=/data/media
Environment=ANISHELF_QBITTORRENT_API_URL=http://qbittorrent:8080
Volume=anishelf-app.volume:/data/app
Volume=anishelf-media.volume:/data/media:ro

[Service]
Restart=always
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=default.target
```

`anishelf-web.container`:

```ini
[Unit]
Description=Anishelf web
Requires=anishelf-backend.service
After=anishelf-backend.service

[Container]
Image=ghcr.io/qw0er/anishelf-web:latest
ContainerName=anishelf-web
Network=anishelf.network
UserNS=keep-id:uid=1000,gid=1000
PublishPort=127.0.0.1:3000:8080

[Service]
Restart=always
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=default.target
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
Description=Anishelf optional qBittorrent

[Container]
Image=docker.io/linuxserver/qbittorrent:latest
ContainerName=anishelf-qbittorrent
Network=anishelf.network
NetworkAlias=qbittorrent
UserNS=keep-id:uid=1000,gid=1000
User=0
Group=0
Environment=PUID=1000
Environment=PGID=1000
Environment=WEBUI_PORT=8080
Environment=TORRENTING_PORT=6881
Volume=anishelf-qbittorrent-config.volume:/config
Volume=anishelf-media.volume:/data/media
Volume=anishelf-qbittorrent-incomplete.volume:/data/incomplete
PublishPort=127.0.0.1:8080:8080
PublishPort=6881:6881
PublishPort=6881:6881/udp
Entrypoint=/bin/sh
Exec=-ec "mkdir -p /data/media /data/incomplete; chown 1000:1000 /data/media /data/incomplete; echo 'qBittorrent media and incomplete mount roots initialized.'; exec /init"

[Service]
Restart=always
TimeoutStartSec=900
TimeoutStopSec=45

[Install]
WantedBy=default.target
```

```sh
mkdir -p ~/.config/containers/systemd
# Save the selected files before reloading.
systemctl --user daemon-reload
systemctl --user start anishelf-web.service
# Only when the optional downloader files are installed:
systemctl --user start anishelf-qbittorrent.service
journalctl --user -u anishelf-backend.service -f
```

Open `http://localhost:3000`. The backend journal contains the initial password.
Read the downloader password with `journalctl --user -u anishelf-qbittorrent.service`.
`UserNS=keep-id` maps your user to container UID/GID 1000; downloader initialization
runs as container root to prepare writable mount roots, then drops privileges.
For host media, replace the media volume mount in both containers with the same
absolute host path (`:ro,z` for Backend, `:z` for qBittorrent).
Enable startup without login with `sudo loginctl enable-linger "$USER"`.
`WantedBy=default.target` handles startup; do not enable generated services.
See the [Quadlet reference](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html).

## Network and qBittorrent

Backend stays private; Web and the optional downloader publish their own ports. For HTTPS, set
`ANISHELF_PUBLIC_ORIGIN=https://anime.example.com` in the backend environment and
forward your host reverse proxy to `127.0.0.1:3000`:

```caddyfile
anime.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Configure the bundled or an existing qBittorrent 5.x instance in Anishelf Settings: API address,
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
- Quadlet updates: stop Web, Backend and the optional downloader, back up, change both image tags, run
  `podman pull` for both images, then `systemctl --user daemon-reload` and
  `systemctl --user start anishelf-web.service`. Restart the optional downloader
  with `systemctl --user start anishelf-qbittorrent.service`. Reverting images does not undo
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
