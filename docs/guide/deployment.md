# Deployment

Use Docker/Podman Compose with published images, rootless Podman Quadlet or a source
installation. Container images support Linux AMD64 and ARM64. Deploy matching Web
and Backend versions; the backend reads original media without modifying it.

- [Interactive installer](#interactive-installer)
- [Docker Compose](#docker-compose)
- [Bundled qBittorrent](#bundled-qbittorrent)
- [Podman Quadlet](#podman-quadlet)
- [Network and HTTPS](#network-and-qbittorrent)
- [Storage, updates and recovery](#storage-updates-and-recovery)
- [Jackett](#jackett-source-service)
- [Source installation](#source-installation)

## Interactive installer

Install without cloning the repository:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/package/install.sh)
```

Run from an interactive Bash shell with curl available. Docker needs Compose v2 and
access to its daemon. Podman Compose needs a working external Compose provider
(docker-compose or podman-compose); `podman compose version` must succeed. See
[Podman's Compose documentation](https://docs.podman.io/en/latest/markdown/podman-compose.1.html).
The installer uses the selected engine throughout and stops if its provider is missing.
Quadlet needs Linux, rootless Podman with cgroup v2/Quadlet and an active systemd user
session. Before running a rootless deployment, follow
[Prepare a dedicated service account](#prepare-a-dedicated-service-account) below,
including administrator setup for startup after logout/reboot. The script does not install packages, create users, invoke sudo or
change system security settings.

The wizard detects Docker and Podman commands. One installed engine is selected
automatically; both installed engines produce a choice. With no engine installed it
stops with installation guidance. Docker uses Compose directly; Podman offers Compose
(default) or rootless Quadlet. Engine availability is checked before prompts, while
runtime access/provider checks happen after confirmation.

Basic questions cover a **new** absolute output directory, optional existing media
directory, bundled qBittorrent and bundled Jackett. Blank media uses a managed named
volume. The final configuration summary is always shown before confirmation.

```text
[Detected docker; using it automatically.]
New deployment directory [/home/alice/anishelf]:
Existing dedicated media directory; leave blank for a managed volume []:
Include bundled qBittorrent (y/n) [no]:
Include bundled Jackett (y/n) [no]:
Adjust advanced options (image tag, networking, ports and SELinux) (y/n) [no]:
[Configuration summary]
Create configuration and start this deployment (y/n) [yes]:
```

Accepting defaults skips further configuration questions. Advanced options expose:

| Setting | Default |
| --- | --- |
| Matching Web/Backend image tag | latest |
| Application bind address and host port | 127.0.0.1:3000 |
| Public browser origin | http://localhost:3000 |
| qBittorrent WebUI / peer TCP+UDP port, if included | 127.0.0.1:8080 / 6881 |
| Jackett WebUI, if included | 127.0.0.1:9117 |
| Dedicated media shared SELinux relabeling | Enabled when local mode is Enforcing or Permissive |

Management ports remain on loopback; use a tunnel or separately protected proxy.
Adjust the bind address and browser origin in advanced options for remote access.
Source templates default to main and are resolved to one immutable GitHub commit
before download. App image selection is separate; choose a published image tag that
contains the selected features. GitHub API/network failures stop before writing the
bundle. The command becomes available after the script is published on that ref.

Review the summary and confirm. Compose writes compose.yaml/.env, validates the
configuration, pulls images and starts the project. Quadlet saves a generated unit
bundle, installs .container/.volume/.network files under the user's container systemd
directory and the regular anishelf.target under the user's systemd directory. It
reloads the user manager and enables/starts the target, not generated service units.
Both paths check the application's local HTTP health and print the password-log
command. The output directory contains a private install.log with installer outcomes;
application/container logs stay with the runtime. No credentials are collected.
Existing deployments/units are refused instead of overwritten. Service failures retain
the generated configuration and persistent data for diagnosis.

To inspect configuration without touching Docker, Podman or systemd:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/package/install.sh) --generate-only
```

`--ref REF` selects a template branch, tag or commit (no slash-containing ref names).
For reproducible installation, replace main in the script URL with a full commit and
pass that same commit as --ref. `--templates-dir /path/to/package/deploy` is available
for maintainers testing local templates. `--engine docker` or `--engine podman`
overrides detection, including offline generation when no engine is installed.
Generation assumes rootless Podman when the current account is non-root; startup
verifies the actual engine mode. The chosen Compose engine is recorded as
ANISHELF_DEPLOY_ENGINE in .env; use that engine to manage the saved deployment.
Rerunning the installer is not an update
mechanism: update the saved deployment using the normal backup/upgrade procedure.
Paths may contain spaces and Unicode; quotes, backslashes, colons, dollar signs,
percent signs and control characters are rejected rather than injected into config.

### Installer and SELinux

The wizard detects local Enforcing/Permissive mode and defaults to shared relabeling
for a dedicated host media directory; the summary states the relabeling decision.
Advanced options let an administrator override it. Compose uses :ro,z for Backend and :z for
qBittorrent; Quadlet emits the same host mount distinction and adds shared z labels
to its managed named-volume mounts. This follows Podman's
[shared/private volume-label semantics](https://docs.podman.io/en/latest/markdown/podman-run.1.html#volume-v-source-volume-host-dir-container-dir-options):
private :Z labels would prevent independent containers from reliably sharing media.
The runtime performs relabeling when containers start; generation alone does not
change filesystem labels. Large directory trees can make that first start slow.

Only select relabeling for a dedicated media tree. System directory roots/subtrees
and the whole current home directory are refused. Neither setenforce nor
SecurityLabelDisable/label=disable is used. If a directory is already labeled by your
administrator, enable advanced options and decline automatic relabeling. Remote Docker hosts cannot be detected
by local getenforce; choose the option for the daemon host's policy. On NFS/read-only
or other filesystems that reject security-label xattrs, have an administrator prepare
supported storage/labels and decline relabeling; the installer does not bypass SELinux.

Labels do not replace Unix permissions. Backend's container UID/GID 1000 must read
and traverse media; bundled qBittorrent must also write. Rootless Podman Compose and Quadlet use
keep-id:uid=1000,gid=1000 to map the service account to that identity. Generated
rootless Compose services share that user namespace mapping, with qBittorrent and
Jackett explicitly running their LinuxServer initialization as container root. The generated
host-media entrypoint does not chown the media root. The installer never applies
chmod/chown to host media; managed named volumes and incomplete/config storage still
receive their normal container initialization. Correct host ownership/access before
starting if necessary. Review AVC denials with the host's audit tooling when a
labeled mount still fails, and inspect service logs for lsetxattr/permission failures.

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

Use rootless Podman with Quadlet and cgroup v2. Run the deployment as a dedicated
non-root `anishelf` account without sudo privileges. The administrator prepares the
account once; the installer only generates/starts the deployment as the current user.

### Prepare a dedicated service account

As an administrator, create a regular account with a home directory and enable its
user manager to run at boot and after logout:

```sh
sudo useradd --create-home --shell /bin/bash anishelf
sudo loginctl enable-linger anishelf
sudo loginctl show-user anishelf -p Linger
```

If the account already exists, skip useradd and check its home and shell. Do not add
it to sudo/wheel or the Docker group. Use a regular account rather than a system
account: distribution defaults often allocate subordinate IDs only to regular users.
Check both allocations:

```sh
grep '^anishelf:' /etc/subuid /etc/subgid
```

Each file must assign the account at least 65,536 subordinate IDs. If either range is
missing, have the administrator allocate an unused, non-overlapping range with
usermod's --add-subuids/--add-subgids options according to the host's allocation policy.
Do this before the account first creates containers; do not copy another user's ranges.
See the [Podman rootless setup guide](https://github.com/containers/podman/blob/main/docs/tutorials/rootless_tutorial.md).

Enter a proper login session as the service account. On hosts with machinectl:

```sh
sudo machinectl shell anishelf@.host
```

Alternatively, log in directly as anishelf through the host's configured login/SSH
mechanism. A plain su/sudo user switch may not establish the systemd user session.
If an administrator uses `sudo -iu anishelf` after enabling lingering, set the existing
user manager's environment in that shell and verify its bus is available:

```sh
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
test -S "$XDG_RUNTIME_DIR/bus"
systemctl --user show-environment
```

Do not create /run/user directories or point these variables at the administrator's
session. If the bus is missing, fix the user manager/login setup before deployment.
The [machinectl reference](https://www.freedesktop.org/software/systemd/man/latest/machinectl.html)
describes creating a separate local user session.

Run the following and every subsequent installer, Podman and systemctl --user command
**inside the anishelf account's session**, without sudo:

```sh
whoami
podman info --format '{{.Host.Security.Rootless}} {{.Host.CgroupsVersion}}'
systemctl --user show-environment
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user
```

Expect anishelf and `true v2`. The home directory owns its configuration and rootless
container storage; `sudo podman` addresses root's separate storage. Host UID/GID need
not be 1000: `keep-id:uid=1000,gid=1000` maps the service account to container UID/GID
1000. For a host media tree, grant this account read/traverse access and, if using
bundled qBittorrent, write access. Prepare ownership/ACLs and shared SELinux labels as
an administrator; the installer does not provision users, subordinate IDs, lingering,
sessions or host media permissions. Access granted only through supplementary groups
may need additional Podman group-preservation configuration; verify access inside the
container rather than relying on the host shell alone.

For an existing deployment under another user, stop its target and back up first.
Rootless volumes and container storage are per-user: migrate data with ownership
appropriate to the new account, then install/start its units. Merely copying unit
files or changing the login user does not move the old volumes.

### Install and manage the units

Once the account is ready, run the [interactive installer](#interactive-installer)
from that session and select Podman/Quadlet, or install manually as follows.

Copy the core files from
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
`UserNS=keep-id` maps the anishelf service account to container UID/GID 1000; downloader initialization
runs as container root to prepare writable mount roots, then drops privileges.
For host media, replace the media volume mount in both containers with the same
absolute host path (`:ro,z` for Backend, `:z` for qBittorrent).
Startup without login uses the lingering configured by the administrator above.
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
