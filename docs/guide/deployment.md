# Deployment

Use Docker Compose with published images, rootless Podman Quadlet or a source
installation. Container images support Linux AMD64 and ARM64. Deploy matching Web
and Backend versions; the backend reads original media without modifying it.

- [Docker Compose](#docker-compose)
- [Bundled qBittorrent](#bundled-qbittorrent)
- [Podman Quadlet](#podman-quadlet)
- [Network and HTTPS](#network-and-qbittorrent)
- [Storage, updates and recovery](#storage-updates-and-recovery)
- [Jackett](#jackett-source-service)
- [Source installation](#source-installation)

## Docker Compose

Save the published-image [compose.yaml](../../package/deploy/compose.yaml) into a
new deployment directory. Use that file as the canonical service, health-check,
mount and volume configuration rather than copying a YAML example from this guide.
Optionally save the [environment example](../../package/deploy/.env.example) beside
it as `.env` and uncomment the settings you need. The repository-root Compose file
builds the checkout instead; see [Source installation](#source-installation).

Run from the deployment directory:

```sh
docker compose pull
docker compose up -d
docker compose logs backend
```

Open [localhost:3000](http://localhost:3000). The initial Anishelf password appears
in Backend logs. For another machine, use a configured public origin with your
HTTPS proxy, or forward the loopback listener:

```sh
ssh -L 3000:127.0.0.1:3000 user@server
```

Optional `.env` settings:

| Variable | Default / purpose |
| --- | --- |
| `ANISHELF_TAG` | `latest`; matching Web/Backend release images |
| `ANISHELF_BIND_ADDRESS` / `ANISHELF_PORT` | `127.0.0.1` / `3000`; application host address/port |
| `ANISHELF_PUBLIC_ORIGIN` | `http://localhost:<ANISHELF_PORT>`; override for LAN or HTTPS |
| `ANISHELF_MEDIA_PATH` | Absolute host media directory; unset uses the media volume |
| `COMPOSE_PROFILES` | `qbittorrent`, `jackett` or `qbittorrent,jackett` for optional services |
| `QBITTORRENT_TAG` | `latest`; downloader image version |
| `QBITTORRENT_BIND_ADDRESS` / `QBITTORRENT_WEBUI_PORT` | `127.0.0.1` / `8080`; host WebUI address/port |
| `QBITTORRENT_PEER_PORT` | `6881`; synchronized listener and TCP/UDP publication |
| `JACKETT_BIND_ADDRESS` / `JACKETT_PORT` | `127.0.0.1` / `9117`; Jackett management listener |

Backend runs as UID/GID 1000; give it read/traverse access to bind-mounted media.
On SELinux hosts, add `z` to shared media bind mounts. Keep persistent application,
media and optional service volumes. Stop services and back up before updating;
never use `down --volumes` to update. See [Configuration and operations](operations.md)
for environment variables, logging, resource settings and database backups, and
[First use](README.md#first-use) after deployment.

## Bundled qBittorrent

Enable `COMPOSE_PROFILES=qbittorrent`, then run `docker compose up -d`.

| Setting | Bundled downloader |
| --- | --- |
| WebUI credentials | Anishelf Settings → qBittorrent → Show WebUI password |
| API address | `http://qbittorrent:8080` |
| Browser WebUI | `http://localhost:<QBITTORRENT_WEBUI_PORT>` (default 8080) |
| Completed directory | `/data/media` |
| Enabled incomplete directory | `/data/incomplete` |

For new installations, the initialization service generates a random permanent password,
configures both directories, and publishes credentials in the private
`anishelf-qbittorrent-connection` volume. Anishelf automatically connects and validates
the `/data/media` resource mapping. Saving a subscription accepts its scope;
shared file visibility is proven when a completed download is imported.

In Settings, use **Show WebUI password**, **Copy WebUI password** and **Copy username**
to sign into qBittorrent. The password is hidden after 30 seconds or when the page is
backgrounded. Save a browser-reachable WebUI URL separately and use **Open WebUI**.
If you change credentials inside qBittorrent, use **Update password or use an external
instance** to save the new credentials in Anishelf, then test the connection and
save/validate the destination again. Changed connection generations require renewed
subscription scope acceptance by saving again.

Existing qBittorrent configurations are preserved and need one manual connection
setup, including the separate incomplete directory. Initialization never resets an
existing password. A manually saved or removed Anishelf connection takes precedence
over deployment credentials, including after restart. External downloaders continue
to require their API credentials and completed-directory mapping.

Back up the app, qBittorrent configuration and connection volumes together. The
connection volume contains the initial password; the app privately stores subsequent
credential updates. Restore missing credentials from backup, or enter the current
qBittorrent credentials manually. Never delete only the configuration volume while
retaining the connection volume; initialization rejects this inconsistent state.

## Podman Quadlet

Use rootless Podman with Quadlet and cgroup v2. Copy the core files from
[package/deploy/quadlet](../../package/deploy/quadlet) to
`~/.config/containers/systemd/`: `anishelf.network`, `anishelf-app.volume`,
`anishelf-media.volume`, `anishelf-qbittorrent-connection.volume`,
`anishelf-jackett-config.volume`, `anishelf-backend.container` and `anishelf-web.container`.
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
Environment=ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE=/run/anishelf-qbittorrent/connection.json
Volume=anishelf-qbittorrent-connection.volume:/run/anishelf-qbittorrent:ro
Environment=ANISHELF_BUNDLED_JACKETT_CONFIG_FILE=/run/jackett-config/Jackett/ServerConfig.json
Volume=anishelf-jackett-config.volume:/run/jackett-config:ro
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

`anishelf-qbittorrent-connection.volume`:

```ini
[Volume]
VolumeName=anishelf-qbittorrent-connection
```

`anishelf-qbittorrent-init.container`:

```ini
[Unit]
Description=Initialize bundled qBittorrent credentials and paths
PartOf=anishelf.target

[Container]
Image=ghcr.io/qw0er/anishelf-backend:latest
UserNS=keep-id:uid=1000,gid=1000
User=0
Group=0
Volume=anishelf-qbittorrent-config.volume:/config
Volume=anishelf-qbittorrent-connection.volume:/connection
Exec=node /app/package/qbittorrent-init.mjs

[Service]
Type=oneshot
RemainAfterExit=yes
TimeoutStartSec=900
```

`anishelf-qbittorrent.container`:

```ini
[Unit]
Requires=anishelf-qbittorrent-init.service
After=anishelf-qbittorrent-init.service
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
Read and copy the downloader credentials in Anishelf Settings. Existing downloader configurations require manual connection setup. Install the optional init container together with qBittorrent; its oneshot service must succeed before qBittorrent starts.
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

Compose settings are listed in the [Docker Compose settings](#docker-compose)
and [deployment .env example](../../package/deploy/.env.example). Quadlet uses the
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

Configure an existing or external qBittorrent instance in Anishelf Settings: API address,
credentials, Test connection, then Download destination. Its completed directory
must map to the same files mounted at `/data/media`; incomplete downloads must
stay outside watched media. Configure the optional browser WebUI link separately.
Container `localhost` refers to that container, not the host. For rootless Podman,
a host downloader may be reachable through `host.containers.internal` if its
listener and firewall allow it. Save each subscription against the validated destination to authorize
automatic downloads; automatic source choices bind permission after discovery. Destination validation alone does not prove shared visibility.

The optional bundled qBittorrent uses `http://qbittorrent:8080`, completed path
`/data/media` and an enabled incomplete path `/data/incomplete`. New configurations get a random permanent password and automatic destination validation. In Anishelf Settings, show/copy WebUI credentials and configure the browser WebUI link. After changing credentials in WebUI, update the Anishelf connection and revalidate the destination. Existing configurations and saved manual connections are preserved.

## Storage, updates and recovery

- Keep `anishelf-app` persistent and separate from media. It contains the database,
  settings, credentials and generated caches. Do not share it between backends.
- Stop the application and optional downloader before backing up the entire app volume. Back up media and
  downloader state separately. Preserve ownership and protect credential backups.
- Quadlet updates: run `systemctl --user stop anishelf.target`, back up, change the backend, initialization and web image tags, run
  `podman pull` for the application images, then `systemctl --user daemon-reload` and
  `systemctl --user start anishelf.target`. Reverting images does not undo
  database migrations; retain the matching pre-update backup.
- Extra media roots need read-only mounts and matching entries in Settings.
  Network filesystems require checking watcher behavior; manual scans reconcile drift.
- The five volumes match Compose: `anishelf-app`, `anishelf-media`,
  `anishelf-qbittorrent-config`, `anishelf-qbittorrent-incomplete` and
  `anishelf-qbittorrent-connection`. Back up the connection volume together with app
  and downloader configuration. It contains the initial WebUI password.

Reset a forgotten password, then restart Backend:

```sh
# Docker Compose
docker compose exec backend node backend/dist/cli.js auth reset-password
docker compose restart backend

# Quadlet
podman exec anishelf-backend node backend/dist/cli.js auth reset-password
systemctl --user restart anishelf-backend.service
```


The bundled initializer allows container port translation by disabling qBittorrent's
Host-header port check. Account authentication, localhost authentication and CSRF
protection remain enabled. The WebUI host binding defaults to `127.0.0.1`.


## Jackett source service

Settings now includes external Jackett connection, ordered site selection and
separate service/capability/search diagnostics. An optional `jackett` profile is
available in both Compose files, with matching optional rootless Quadlet units.
See [Jackett setup](jackett-setup.md) for the image configuration, private bootstrap,
first-run public-site provisioning, preservation rules and verification limits.
The backend starts independently of Jackett and keeps saved external configuration
or an explicit disconnect when a bundled credential file becomes available.

## Source installation

Install Node.js 24 and npm, plus FFmpeg and FFprobe for media inspection,
subtitle extraction and preparation. Direct playback remains available without
these tools when the browser supports the original media.

Run from the repository root:
```sh
npm ci
npm start
```

The repository-root [compose.yaml](../../compose.yaml) builds the current checkout:

```sh
docker compose up -d --build
# Optional downloader:
docker compose --profile qbittorrent up -d --build
```
