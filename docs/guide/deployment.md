# Deployment

Use **Docker Compose** or **rootless Podman Quadlet** on AMD64/ARM64.
Deploy matching Web and Backend image tags. Podman Compose is not supported.

## Interactive installer

Install Docker with Compose v2, or complete the [rootless Podman setup](#rootless-podman-quadlet), then run:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/package/install.sh)
```

The wizard selects Docker Compose or Podman Quadlet, asks for a new deployment
folder, media storage, access/port and optional qBittorrent/Jackett services.
Advanced options include image tag, HTTPS origin and SELinux labels.
Keep the generated folder; failures are recorded in `install.log`.

| Option | Purpose |
| --- | --- |
| `--generate-only` | Write configuration without starting services |
| `--engine docker` / `--engine podman` | Select an engine explicitly |
| `--ref VERSION` | Select deployment templates from a release |
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
bash package/install.sh --reconfigure "$HOME/anishelf"
bash package/install.sh --remove "$HOME/anishelf"
```

Both require confirmation and GNU `mv`. They archive the entire old folder to a
sibling backup and preserve volumes/media. Reconfiguration keeps the engine and
method, collects settings afresh and prepares templates before stopping services;
Quadlet images are pulled first. Enter the same host media path to retain it.
If replacement fails after shutdown, restore the archived folder and matching data.
Configuration archives are not data backups.

Legacy Podman Compose bundles must be maintained manually with their original
configuration; the installer rejects them without changing files or services.

### Testing deployment

```sh
bash package/install.sh --test
```

This uses the `testing` tag, `anishelf-test` namespace, app port `3001`, downloader
ports `8081`/`6882` and Jackett port `9118`. Host media mounts are disabled.
Use independent credentials and sample media; do not import production app data.
Wait for both image manifests before selecting `test-<full-SHA>` in advanced options.
The saved profile retains this namespace during maintenance. Each engine/account
supports one installer-managed testing namespace; network access is not isolated.
Use the same maintenance commands with testing names and its deployment folder.

## Uninstall

Docker Compose: `docker compose down --remove-orphans` preserves volumes.
For manual Quadlet deployments, stop/disable the target and remove only this stack's
installed units, then run `systemctl --user daemon-reload`. Keep persistent data
unless intentionally deleting it. Use script removal for installer-managed folders.

## Source installation

With Node.js 24, npm and FFmpeg/FFprobe installed (Move/Delete additionally
requires Linux procfs and GNU coreutils 9.5 or later):

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
must regenerate their bundle with `install.sh --reconfigure DIRECTORY` or edit
the Backend media mount from `:ro` to `:rw`, then recreate the container/restart
its Quadlet unit. Run `systemctl --user daemon-reload` after unit edits.
Changing the image alone does not change an existing mount. Apply the same rule to
additional configured resource roots. Keeping a root read-only allows playback but
rejects Move/Delete. Do not change read-only credential/configuration mounts.

Grant the Backend container user write/search permission on managed directories;
the installer does not recursively chown host media. Rootless Quadlet keeps the
host user's identity; Compose runs Backend as the image's `node` user (UID 1000).
Retain shared `z` labels on SELinux host media mounts used by Backend/qBittorrent.
The Backend image includes GNU coreutils for no-overwrite, same-filesystem moves.
See [operations](operations.md#move-and-delete-originals) for confirmation,
preservation and download-client behavior.
