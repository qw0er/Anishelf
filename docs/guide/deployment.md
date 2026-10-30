# Deployment

Use **Docker Compose** or **rootless Podman Quadlet** on AMD64/ARM64.
Deploy matching Web and Backend image tags. Podman Compose is not supported.

## CLI installer

Install Docker with Compose v2, or complete the [rootless Podman setup](#rootless-podman-quadlet), then run:

```sh
installer="$(mktemp)"
curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/scripts/install.pyz -o "$installer"
python3 "$installer" install --engine docker --deploy-dir "$HOME/anishelf" --media /srv/anishelf/media
rm -f "$installer"
```

`install.pyz` is a self-contained Python 3.9+ zipapp that uses only the standard
library. It bundles the canonical deployment templates, so it does not fetch them
at runtime. Configuration is rendered in memory and written directly to the
deployment directory. Only Compose reconfiguration writes a temporary compose/env
pair to memory-backed `/dev/shm` (falling back to `TMPDIR`) for validation, then
removes it. The installer is non-interactive and never prompts; every choice is a
flag. A zipapp must be a seekable file, so it cannot be piped directly into
`python3`; the example above uses `mktemp` and removes the archive after the run.
From a source checkout, use `python3 scripts/install.pyz install`.

If exactly one container engine is installed, the installer detects it. When both
Docker and Podman are available, pass `--engine docker` or `--engine podman`.
Podman uses rootless Quadlet. Defaults are `~/anishelf` (or `~/anishelf-test` with
`--test`), loopback binding, port `3000`, the `latest` image tag and a managed media
volume.

```sh
python3 scripts/install.pyz install \
  --engine podman \
  --deploy-dir "$HOME/anishelf" \
  --media /srv/anishelf/media \
  --extra-media /srv/anishelf/extra \
  --qbit --jackett
```

Repeat `--extra-media` for additional existing host directories. Relative paths
resolve from the current working directory. The primary `--media` directory or
managed volume remains in place. Additional directories are mounted in Backend at
`/data/extra/1`, `/data/extra/2`, and so on, and are added to the initial resource
roots for new settings. For an existing installation, add those container paths in
Settings after reconfiguration. The bundled downloader continues to use the primary
media location. Host mounts are rejected in `--test` mode. Keep the generated
folder; failures are recorded in `install.log`.

SELinux shared labels are automatic when SELinux is enforcing or permissive and
host media is selected. Use `--selinux-relabel` or `--no-selinux-relabel` to
override that decision.

Compose deployments include an executable `manage.sh` in the deployment folder.
The project name and profiles are fixed when the bundle is generated; the script
does not read `.env` at runtime. It supports only `up` and `down`:

```sh
./manage.sh up
./manage.sh down
```

`up` runs `docker compose up -d`, and `down` runs
`docker compose down --remove-orphans`. Both include the profiles selected during
installation. Testing deployments use the same script with the `anishelf-test`
project and testing profiles.

Commands:

| Command | Purpose |
| --- | --- |
| `install` | Configure and start a new deployment |
| `reconfigure DIRECTORY` | Archive a saved deployment and start replacement settings in place |
| `remove DIRECTORY` | Stop a saved deployment and archive/remove its active configuration |

`install` and `reconfigure` accept the settings options below. `install` always
refuses to overwrite existing Quadlet units. `reconfigure` and `remove`
additionally accept `--force`.

| Option | Purpose |
| --- | --- |
| `--deploy-dir DIRECTORY` | New deployment directory; default `~/anishelf` |
| `--engine docker` / `--engine podman` | Select an engine; required when both are installed |
| `--image-tag TAG` | Matching Web/Backend image tag; default `latest` |
| `--media DIRECTORY` | Existing primary host media directory; omit for a managed volume |
| `--extra-media DIRECTORY` | Additional host media directory; repeat for multiple |
| `--selinux-relabel` / `--no-selinux-relabel` | Override automatic `:z` labeling |
| `--bind IPV4` | Application bind address; default `127.0.0.1` |
| `--port PORT` | Application host port; default `3000` |
| `--public-origin ORIGIN` | Optional fixed HTTPS browser origin |
| `--qbit` / `--jackett` | Include bundled qBittorrent or Jackett |
| `--qbit-port PORT` | qBittorrent WebUI port; default `8080` |
| `--peer-port PORT` | qBittorrent peer TCP/UDP port; default `6881` |
| `--jackett-port PORT` | Jackett WebUI port; default `9117` |
| `--generate-only` | Write configuration without starting services |
| `--test` | Use isolated testing images, services, network, volumes and ports |

## Docker Compose

### Manual installation

Save [compose.yaml](../../package/deploy/compose.yaml) and
[.env.example](../../package/deploy/.env.example) as `compose.yaml` and `.env`
in a new deployment folder. The repository-root Compose file builds source instead.

All settings are optional:

| `.env` setting | Purpose |
| --- | --- |
| `ANISHELF_TAG` | Matching Web/Backend image tag; default `latest` |
| `ANISHELF_MEDIA_PATH` | Absolute host media directory; omit for a managed volume |
| `COMPOSE_PROFILES=qbittorrent,jackett` | Include either or both bundled services |
| `ANISHELF_BIND_ADDRESS=0.0.0.0` | Allow LAN access; default is loopback only |
| `ANISHELF_PORT` | Browser port; default `3000` |
| `ANISHELF_PUBLIC_ORIGIN=https://anime.example.com` | Optional fixed HTTPS address |

From that folder:

```sh
docker compose pull
docker compose up -d
docker compose logs backend
```

Open `http://localhost:3000` (or your server IP and selected port). The initial
password appears once in Backend logs. See [first use](README.md#first-use).

### Manual updates

Stop services and [back up](#backup-and-recovery) first. Set `ANISHELF_TAG` in `.env`, then:

```sh
docker compose stop
# Back up data and configuration before continuing.
docker compose pull
docker compose up -d
```

Merge template changes when required by the release. Do not delete volumes to update.

## Rootless Podman Quadlet

Requires Linux, rootless Podman with Quadlet, cgroup v2 and a systemd user session.
Run all Podman and `systemctl --user` commands as the same non-root account.

### Dedicated user

An administrator can create a service account and enable startup after logout/reboot:

```sh
sudo useradd --create-home --shell /bin/bash anishelf
sudo loginctl enable-linger anishelf
sudo machinectl shell anishelf@.host
```

Skip account creation if it exists. If `machinectl` is unavailable, log in through
SSH as `anishelf`; a plain `su` may not establish the systemd user session.
The account needs at least 65,536 subordinate UIDs/GIDs in `/etc/subuid` and
`/etc/subgid`. Have an administrator allocate unused ranges if missing.

### Installation

Run the installer in this account; selecting Podman uses Quadlet automatically.
For manual deployment, copy the [canonical units](../../package/deploy/quadlet/):

```sh
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user
cp package/deploy/quadlet/anishelf.network ~/.config/containers/systemd/
cp package/deploy/quadlet/*.volume ~/.config/containers/systemd/
cp package/deploy/quadlet/anishelf-backend.container ~/.config/containers/systemd/
cp package/deploy/quadlet/anishelf-web.container ~/.config/containers/systemd/
cp package/deploy/quadlet/anishelf.target ~/.config/systemd/user/
```

These commands use a source checkout. Review image tags, `PublishPort`, environment
and media mounts in the copied files. To include qBittorrent or Jackett, copy both
its `.container` and `-init.container` files too. The volume files alone do not start
optional services. Quadlet reads its unit files, not Compose `.env`.

Pull every selected container image (`Image=` in the installed units), then start:

```sh
systemctl --user daemon-reload
systemctl --user enable --now anishelf.target
journalctl --user -u anishelf-backend.service -n 100
```

Enable the target only. Open the selected address and use the initial password
from Backend logs.

### Manual updates

Run as the service account, using the default `latest` image tags:

```sh
systemctl --user stop anishelf.target
# Back up data and configuration before continuing.
podman pull ghcr.io/qw0er/anishelf-backend:latest
podman pull ghcr.io/qw0er/anishelf-web:latest
systemctl --user start anishelf.target
```

Pull optional service images too when updating them. Apply unit changes only when required by the release. Keep installer-managed copies in the saved deployment
folder synchronized with installed units before using script maintenance.

## Storage and optional services

Backend reads and manages media as UID/GID 1000. Backend and bundled qBittorrent need directory write/search access;
rootless Podman maps the service account to this identity. Prepare host ownership
or ACLs before starting. On SELinux hosts, shared media needs `:z` labels; apply
relabeling only to a dedicated media tree. Use administrator-prepared labels on
NFS or storage that must retain existing labels.

| Service | Setup |
| --- | --- |
| Bundled qBittorrent | New installations connect automatically; show WebUI credentials in Settings → qBittorrent |
| External qBittorrent | Save credentials, test connection, then save and validate the destination |
| Bundled Jackett | Connects from shared configuration; [select sites](jackett-setup.md) |

Completed downloads use `/data/media`; incomplete files use `/data/incomplete`.
External downloaders must map completed paths to the same files visible to Backend.
After changing downloader credentials, update Settings and revalidate the destination.
Existing configurations are never reset by initialization.

## Network

Domains, IPs and changed ports work without registering an access address.
For an HTTPS proxy, set `ANISHELF_PUBLIC_ORIGIN` in Compose `.env` or both Quadlet
Web/Backend units. Point your TLS proxy at Web and preserve Host/Origin:

```caddyfile
anime.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

The fixed origin declares the external scheme; the proxy must terminate/enforce
HTTPS. Local HTTP remains usable through a different address. Recreate/restart
Web and Backend after configuration changes.

For automatic/multiple HTTPS addresses, leave the fixed origin unset and configure
`ANISHELF_WEB_TRUSTED_PROXIES` with space-separated proxy IPs/CIDRs as seen by Web.
This is also optional for preserving original client IPs. A Docker host proxy may
appear as a bridge gateway; inspect Web logs. Backend's private Web trust is
preconfigured through `ANISHELF_TRUSTED_PROXIES`.

`ANISHELF_ALLOWED_HOSTS` optionally restricts Backend to exact comma-separated
hostnames/IPs without ports; include `127.0.0.1` and `localhost` for health checks.
Keep Backend private and management WebUIs on loopback or behind protected access.
See [configuration](operations.md#environment-variables) for all variables.

For remote access with loopback defaults, use SSH forwarding:

```sh
ssh -N -L 3000:127.0.0.1:3000 user@server
```

## Updates

Follow [Docker Compose updates](#manual-updates) or
[rootless Quadlet updates](#manual-updates-1). Keep matching Web/Backend tags and
apply release-specific template changes.

## Maintenance

Run Docker commands from the deployment folder; run Quadlet commands as its owner.

| Task | Docker Compose | Rootless Quadlet |
| --- | --- | --- |
| Status | `docker compose ps` | `systemctl --user status anishelf-backend.service anishelf-web.service` |
| Logs | `docker compose logs -f --tail=100 backend web` | `journalctl --user -u anishelf-backend.service -u anishelf-web.service -f` |
| Stop | `docker compose stop` | `systemctl --user stop anishelf.target` |
| Start | `docker compose up -d` | `systemctl --user start anishelf.target` |

To reset the password, run the matching command, then restart Backend:

```sh
# Docker Compose
docker compose exec backend node backend/dist/cli.js auth reset-password
docker compose restart backend

# Rootless Quadlet
podman exec anishelf-backend node backend/dist/cli.js auth reset-password
systemctl --user restart anishelf-backend.service
```

### Backup and recovery

Stop the stack before copying complete volumes, host media and deployment files.
Preserve ownership; do not copy a live SQLite file alone.

| Volume | Contents |
| --- | --- |
| `anishelf-app` | Database, settings, credentials and generated data |
| `anishelf-media` or host media path | Original media and completed downloads |
| `anishelf-qbittorrent-config` | Downloader settings and task state |
| `anishelf-qbittorrent-connection` | Bundled credentials; back up with app/downloader state |
| `anishelf-qbittorrent-incomplete` | In-progress downloads |
| `anishelf-jackett-config` | Jackett settings, API key and sites |

Restore matching application/service data and ownership while stopped, then start
matching image versions. Database rollback requires the pre-update backup. Never
share one app volume between backends or between production and testing.

### Installer-managed configuration

From a checkout, manage a saved installer folder with:

```sh
python3 scripts/install.pyz reconfigure "$HOME/anishelf"
python3 scripts/install.pyz remove "$HOME/anishelf"
```

Both commands act only on a saved installer folder; passing the subcommand is the
explicit request to stop and archive it. Relative paths, including the deployment
folder and media directories, resolve from the current working directory. For
conflicting installed Quadlet unit files, add `--force` to back up each conflicting
regular file in a sibling `*.quadlet-backup.*` directory before replacing or
removing it. Symbolic links and unrelated custom units still block the operation. They archive the entire old folder to a
sibling backup and preserve volumes/media. Reconfiguration keeps the engine and
method, collects settings afresh and prepares templates before stopping services;
Quadlet images are pulled first. Pass the same host media path to retain it.
If replacement fails after shutdown, restore the archived folder and matching data.
Configuration archives are not data backups.

Legacy Podman Compose bundles must be maintained manually with their original
configuration; the installer rejects them without changing files or services.

### Testing deployment

```sh
python3 scripts/install.pyz install --test
```

This uses the `testing` tag, `anishelf-test` namespace, app port `3001`, downloader
ports `8081`/`6882` and Jackett port `9118`. Host media mounts are disabled.
Use independent credentials and sample media; do not import production app data.
Wait for both image manifests before passing `--image-tag test-<full-SHA>`.
The saved profile retains this namespace during maintenance. Each engine/account
supports one installer-managed testing namespace; network access is not isolated.
Use the same maintenance commands with testing names and its deployment folder.

## Uninstall

Docker Compose: `docker compose down --remove-orphans` preserves volumes.
For manual Quadlet deployments, stop/disable the target and remove only this stack's
installed units, then run `systemctl --user daemon-reload`. Keep persistent data
unless intentionally deleting it. Use script removal for installer-managed folders.

## Source installation

With Node.js 24, npm and FFmpeg/FFprobe installed:

```sh
npm ci
npm start
```

To update, stop, back up, check out the chosen release and repeat these commands.
For development containers, use `npm run compose:up` or `npm run compose:up:full`.
See [Development](../development/README.md).

## Writable media for file management

Backend now mounts `/data/media` read-write in Docker Compose and rootless Podman
Quadlet so Files can move and permanently delete files/folders. Existing deployments
must regenerate their bundle with `python3 scripts/install.pyz reconfigure DIRECTORY` or edit
the Backend media mount from `:ro` to `:rw`, then recreate the container/restart
its Quadlet unit. Run `systemctl --user daemon-reload` after unit edits.
Changing the image alone does not change an existing mount. Apply the same rule to
additional configured resource roots. Keeping a root read-only allows playback but
rejects Move/Delete. Do not change read-only credential/configuration mounts.

Grant the Backend container user write/search permission on managed directories;
the installer does not recursively chown host media. Rootless Quadlet keeps the
host user's identity; Compose runs Backend as the image's `node` user (UID 1000).
Retain shared `z` labels on SELinux host media mounts used by Backend/qBittorrent.
Move/Delete uses Node filesystem APIs without an external coreutils dependency.
See [operations](operations.md#move-and-delete-originals) for confirmation,
preservation and download-client behavior.
