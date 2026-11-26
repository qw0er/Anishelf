# Deployment

Deploy Anishelf on **AMD64** or **ARM64** using **Docker Compose** or **rootless Podman Quadlet** (Podman Compose is not supported). Always deploy matching Web and Backend image tags.

Choose a deployment method:

- **[CLI installer](#cli-installer) (recommended):** Generates and validates a ready-to-run Compose or Quadlet setup using `install.pyz`.
- **[Docker Compose](#docker-compose):** Manually configure `compose.yaml` and `.env`.
- **[Rootless Podman Quadlet](#rootless-podman-quadlet):** Manually install systemd Quadlet units under a dedicated non-root user.
- **[Source installation](#source-installation):** Build and run directly with Node.js.

## CLI installer

Install Docker with Compose v2, or complete the [dedicated user setup](#dedicated-user) for rootless Podman, then run:

```sh
installer="$(mktemp)"
curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/scripts/install.pyz -o "$installer"
python3 "$installer" install --engine docker --deploy-dir "$HOME/anishelf" --media /srv/anishelf/media
rm -f "$installer"
```

> **Note:** A Python zipapp must be a seekable file and cannot be piped directly into `python3`, so the snippet downloads to a temporary file first. From a source checkout, run `python3 scripts/install.pyz install` directly.

### How the installer works

- **Self-contained:** `install.pyz` requires only Python 3.9+ (standard library) and bundles all deployment templates—nothing is fetched at runtime.
- **Validation & permissions:** Configuration is rendered in memory and written to the deployment directory. Compose reconfiguration writes a temporary pair to `/dev/shm` (falling back to `TMPDIR`) for validation, then removes it. If Docker socket access is denied, the installer prompts for `sudo`; non-interactive runs require Docker socket access or pre-authorized `sudo`. Rootless Podman commands run as the service user.
- **Engine & defaults:** If only one container engine is installed, it is detected automatically; if both are present, pass `--engine docker` or `--engine podman` (Podman uses rootless Quadlet). Defaults: `~/anishelf` (`~/anishelf-test` with `--test`), bind `127.0.0.1:3000`, tag `latest`, managed media volume, and log level `info` (`debug` with `--test`) to `stdout`.
- **Native management:** After installation, manage the stack with native `docker compose` or `systemctl --user` commands (printed by the installer). No Python runtime or management script is needed for daily operations.

### Media directories

Pass `--media` for your primary host media directory, and repeat `--extra-media` for additional directories:

```sh
python3 scripts/install.pyz install \
  --engine podman \
  --deploy-dir "$HOME/anishelf" \
  --media /srv/anishelf/media \
  --extra-media /srv/anishelf/extra \
  --qbit --jackett
```

- Relative paths resolve from the current working directory.
- Additional directories mount inside Backend at `/data/extra/1`, `/data/extra/2`, etc. For new setups, they are added to initial resource roots automatically; for existing installations, add those container paths in **Settings** after reconfiguration.
- The bundled downloader always writes completed downloads to the primary `--media` location (or managed volume).
- SELinux `:z` shared labels are applied automatically when SELinux is enforcing or permissive and host media is used. Override with `--selinux-relabel` or `--no-selinux-relabel`.
- Keep the generated deployment folder; failures are recorded in `install.log`.

### Backend-only mode (`--no-web`)

Pass `--no-web` to omit the Web container and publish Backend directly on the configured bind address and port. This exposes the API only (no browser UI). Use `--web` during reconfiguration to restore Web.

- Remote desktop clients require HTTPS (loopback HTTP is supported). Place a TLS reverse proxy in front of Backend—or use SSH port forwarding—and set `ANISHELF_TRUSTED_PROXIES` (in `.env` for Docker, or in the Backend unit for Quadlet) to the proxy's actual source address.
- Configure the proxy to preserve `Host` and set `X-Forwarded-Proto` from the client connection.
- When Web is disabled, omit `web` and `anishelf-web.service` from management commands.

### Logging

- Set verbosity with `--log-level` (`info` by default, `debug` with `--test`).
- Use `--log-destination file` or `--log-destination both` to write rotating logs to `logs/anishelf.log` under the deployment directory.
- The container user (UID/GID 1000 for Docker; mapped to the service user for rootless Quadlet) needs write access to `logs/` and search (`+x`) access to parent directories.
- Reconfiguration archives the old deployment directory (including its logs) and creates a new log directory.
- Use `--log-path /absolute/dedicated-directory/anishelf.log` to write elsewhere on the host. The parent directory must already exist, should be a dedicated directory outside the deployment folder, and is **not** automatically SELinux-relabeled.

### Managing installer deployments

```sh
python3 scripts/install.pyz reconfigure "$HOME/anishelf"
python3 scripts/install.pyz remove "$HOME/anishelf"
```

| Command | Purpose |
| --- | --- |
| `install` | Configure and start a new deployment (refuses to overwrite existing Quadlet units) |
| `reconfigure DIRECTORY` | Archive a saved deployment and apply updated settings in place |
| `remove DIRECTORY` | Stop a saved deployment and archive/remove its active configuration |

`reconfigure` and `remove` also accept `--force` to back up conflicting regular Quadlet unit files into a sibling `*.quadlet-backup.*` directory before replacing or removing them (symlinks and unrelated custom units still block the operation).

**How `deployment.json` and `reconfigure` work:**

- `deployment.json` records installer choices so `reconfigure` can inherit them; explicit flags override saved values. Runtime config still lives in `.env`/Compose or Quadlet units—manual edits to those files are allowed, but are **not** imported back into `deployment.json` (pass flags to preserve them across `reconfigure`).
- Clearing saved options: use `--no-qbit` / `--no-jackett` to disable optional services, `--managed-media` to switch from a host path to the managed volume, `--clear-extra-media` to drop extra mounts, and `--public-origin ''` to clear a fixed origin. Repeating `--extra-media` replaces the saved list. Changing media mounts does not move existing files.
- `reconfigure` keeps the engine and method, validates the new templates (and pulls Quadlet images) before stopping the old stack, then archives the old folder to a sibling backup while preserving volumes and media. Configuration archives are not data backups; if replacement fails after shutdown, restore the archived folder and matching data.
- **Older & generation-only bundles:** Bundles without `deployment.json` can still be reconfigured (unspecified options use installer defaults). Legacy Podman Compose bundles are rejected and must be maintained manually. For `--generate-only` Quadlet bundles, copy `.container`, `.volume`, and `.network` files from `DIRECTORY/quadlet/` to `${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd/`, copy `.target` to `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/`, run `systemctl --user daemon-reload`, and enable/start the target.

### Testing deployment

```sh
python3 scripts/install.pyz install --test
```

Uses the `testing` tag, `anishelf-test` namespace, app port `3001`, qBittorrent ports `8081`/`6882`, and Jackett port `9118`. Host media mounts are disabled in `--test` mode. Use independent credentials and sample media—never import production app data. Wait for both image manifests before passing `--image-tag test-<full-SHA>`. Each engine/account supports one installer-managed testing namespace (network access is not isolated).

### CLI options reference

| Option | Purpose |
| --- | --- |
| `--deploy-dir DIRECTORY` | Deployment directory (default: `~/anishelf`, or `~/anishelf-test` with `--test`) |
| `--engine docker` / `--engine podman` | Select container engine (required when both are installed) |
| `--web` / `--no-web` | Include Web UI (default) or publish Backend API directly |
| `--image-tag TAG` | Matching Web/Backend image tag (default: `latest`) |
| `--log-level LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` (default: `info`; `debug` with `--test`) |
| `--log-destination MODE` | `stdout`, `file`, or `both` (default: `stdout`) |
| `--log-path FILE` | Host Backend log file (default: `DEPLOY_DIR/logs/anishelf.log`; custom parent must exist) |
| `--media DIRECTORY` / `--managed-media` | Use an existing primary host directory or a managed volume |
| `--extra-media DIRECTORY` / `--clear-extra-media` | Replace the additional mount list or clear it |
| `--selinux-relabel` / `--no-selinux-relabel` | Override automatic `:z` labeling |
| `--bind IPV4` | Application bind address (default: `127.0.0.1`) |
| `--port PORT` | Application host port (default: `3000`) |
| `--public-origin ORIGIN` | Optional fixed HTTPS browser origin |
| `--qbit` / `--jackett` | Include bundled qBittorrent or Jackett (`--no-qbit` / `--no-jackett` disables them) |
| `--qbit-port PORT` | qBittorrent WebUI port (default: `8080`) |
| `--peer-port PORT` | qBittorrent peer TCP/UDP port (default: `6881`) |
| `--jackett-port PORT` | Jackett WebUI port (default: `9117`) |
| `--generate-only` | Write configuration without starting services |
| `--test` | Use isolated testing images, services, network, volumes, and ports |

## Docker Compose

### Manual installation

Save [compose.yaml](../../deployment/templates/compose.yaml) and [.env.example](../../deployment/templates/.env.example) as `compose.yaml` and `.env` in a new deployment folder (the repository-root Compose file builds from source instead). Generic templates use Compose profiles for optional services; installer-generated Compose files include only the selected services and do not use profiles.

All `.env` settings are optional:

| `.env` setting | Purpose |
| --- | --- |
| `ANISHELF_TAG` | Matching Web/Backend image tag (default: `latest`) |
| `ANISHELF_LOG_LEVEL` | Backend log level (default: `info`) |
| `ANISHELF_MEDIA_PATH` | Absolute host media directory (omit for a managed volume) |
| `COMPOSE_PROFILES=qbittorrent,jackett` | Include either or both bundled services |
| `ANISHELF_BIND_ADDRESS=0.0.0.0` | Allow LAN access (default: `127.0.0.1`) |
| `ANISHELF_PORT` | Browser port (default: `3000`) |
| `ANISHELF_PUBLIC_ORIGIN=https://anime.example.com` | Optional fixed HTTPS address |

Start the stack from that folder:

```sh
docker compose pull
docker compose up -d
docker compose logs backend
```

Open `http://localhost:3000` (or your server IP and port). Read the one-time initial password from the Backend logs, then see [first use](README.md#first-use).

## Rootless Podman Quadlet

Requires Linux, rootless Podman with Quadlet, cgroup v2, and a systemd user session. Run all Podman and `systemctl --user` commands as the same non-root account.

### Dedicated user

An administrator can create a dedicated service account and enable lingering so services run after logout/reboot:

```sh
sudo useradd --create-home --shell /bin/bash anishelf
sudo loginctl enable-linger anishelf
sudo machinectl shell anishelf@.host
```

Skip account creation if it already exists. If `machinectl` is unavailable, log in over SSH as `anishelf` (a plain `su` may not establish a systemd user session). Ensure `/etc/subuid` and `/etc/subgid` allocate at least 65,536 subordinate UIDs/GIDs for the account.

### Manual installation

If using the CLI installer, run it inside this account—selecting Podman uses Quadlet automatically. For manual installation from a source checkout, copy the [canonical units](../../deployment/templates/quadlet/):

```sh
mkdir -p ~/.config/containers/systemd ~/.config/systemd/user
cp deployment/templates/quadlet/anishelf.network ~/.config/containers/systemd/
cp deployment/templates/quadlet/*.volume ~/.config/containers/systemd/
cp deployment/templates/quadlet/anishelf-backend.container ~/.config/containers/systemd/
cp deployment/templates/quadlet/anishelf-web.container ~/.config/containers/systemd/
cp deployment/templates/quadlet/anishelf.target ~/.config/systemd/user/
```

Review image tags, `PublishPort`, environment variables, and media mounts in the copied files (Quadlet reads its unit files, not Compose `.env`). To include qBittorrent or Jackett, copy both their `.container` and `-init.container` files—volume files alone do not start optional services.

Pull every selected container image (`Image=` in the installed units), then enable and start the target:

```sh
systemctl --user daemon-reload
systemctl --user enable --now anishelf.target
journalctl --user -u anishelf-backend.service -n 100
```

Enable only `anishelf.target` (stopping it later does not disable boot startup; use `systemctl --user disable anishelf.target` to disable it). Open the configured address and use the initial password from Backend logs.

## Storage and optional services

### Permissions and SELinux

- Backend and bundled qBittorrent require read, write, and directory search (`+x`) access to media directories.
- Docker Compose runs Backend as UID/GID `1000` (`node`); rootless Podman maps the host service account to UID/GID `1000` inside the container. Prepare host ownership or ACLs before starting (the installer does not recursively `chown` host media).
- On SELinux hosts, shared media mounts require `:z` labels. Apply relabeling only to a dedicated media tree; use administrator-prepared labels on NFS or storage that must retain existing labels.

### Writable media for file management

Backend mounts `/data/media` read-write (`:rw`) in Docker Compose and rootless Podman Quadlet so **Files** can move and permanently delete files and folders.

- **Upgrading older deployments:** Changing the image tag alone does not change existing mounts. Regenerate your bundle with `python3 scripts/install.pyz reconfigure DIRECTORY`, or edit the Backend media mount (and any additional resource roots) from `:ro` to `:rw`, then recreate the container or run `systemctl --user daemon-reload` and restart the Quadlet unit.
- Read-only roots still allow playback, but Move/Delete will be rejected. Do **not** change read-only credential or configuration mounts.
- Move/Delete uses Node filesystem APIs without an external `coreutils` dependency. See [operations](operations.md#move-and-delete-originals) for confirmation, preservation, and download-client behavior.

### Optional services

| Service | Setup |
| --- | --- |
| Bundled qBittorrent | New installations connect automatically; view WebUI credentials in **Settings → qBittorrent** |
| External qBittorrent | Save credentials, test connection, then save and validate the destination |
| Bundled Jackett | Connects from shared configuration; [select sites](jackett-setup.md) |

Completed downloads use `/data/media` and incomplete files use `/data/incomplete`. External downloaders must map completed paths to the same files visible to Backend. After changing downloader credentials, update **Settings** and revalidate the destination. Existing configurations are never reset by initialization.

## Network and reverse proxy

Domains, IPs, and custom ports work without registering an access address.

### HTTPS reverse proxy

For a fixed HTTPS domain, set `ANISHELF_PUBLIC_ORIGIN` in Compose `.env` or in **both** Quadlet Web and Backend units, then point your TLS proxy at Web and preserve `Host`/`Origin`:

```caddyfile
anime.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

The fixed origin declares the external scheme, so the proxy must terminate and enforce HTTPS (local HTTP remains usable via a different address). Recreate or restart Web and Backend after changes.

### Advanced proxy and host settings

- **Multiple or automatic HTTPS addresses:** Leave `ANISHELF_PUBLIC_ORIGIN` unset and set `ANISHELF_WEB_TRUSTED_PROXIES` to space-separated proxy IPs/CIDRs as seen by Web (also useful for preserving client IPs). A host proxy behind Docker may appear as a bridge gateway—check Web logs to verify. Backend's trust of Web is preconfigured via `ANISHELF_TRUSTED_PROXIES`.
- **Host allowlist:** `ANISHELF_ALLOWED_HOSTS` optionally restricts Backend to exact comma-separated hostnames/IPs without ports; include `127.0.0.1` and `localhost` for health checks.
- Keep Backend private and management WebUIs on loopback or behind protected access. See [configuration](operations.md#environment-variables) for all environment variables.

### SSH port forwarding

For remote access when using loopback defaults:

```sh
ssh -N -L 3000:127.0.0.1:3000 user@server
```

## Operations and maintenance

Run Docker commands from the deployment folder (with Docker socket access or `sudo`). Run Quadlet commands as the owning service account.

### Day-to-day commands

| Task | Docker Compose | Rootless Quadlet |
| --- | --- | --- |
| Status | `docker compose ps` | `systemctl --user status anishelf-backend.service anishelf-web.service` |
| Logs | `docker compose logs -f --tail=100 backend web` | `journalctl --user -u anishelf-backend.service -u anishelf-web.service -f` |
| Stop application | `docker compose stop web backend` | `systemctl --user stop anishelf-web.service anishelf-backend.service` |
| Start application | `docker compose up -d backend web` | `systemctl --user start anishelf-backend.service anishelf-web.service` |
| Stop all | `docker compose stop` | `systemctl --user stop anishelf.target` |
| Start all | `docker compose up -d` | `systemctl --user start anishelf.target` |

For `--test` Quadlet deployments, use `anishelf-test.target` and `anishelf-test-*.service`.

### Resetting the password

Run the reset command, then restart the application services:

```sh
# Docker Compose
docker compose exec backend node apps/server/dist/cli.js auth reset-password
docker compose restart backend web

# Rootless Quadlet
podman exec anishelf-backend node apps/server/dist/cli.js auth reset-password
systemctl --user restart anishelf-backend.service anishelf-web.service
```

### Updates

[Back up](#backup-and-recovery) before updating. Always pull all selected images before replacing or restarting services, and keep Web and Backend on matching tags. Moving tags (`latest`, `testing`) resolve to new builds; pinned release tags stay pinned. Image updates do not upgrade deployment templates—use a newer installer and `reconfigure` when a release requires template changes.

#### Docker Compose updates

Set `ANISHELF_TAG` in `.env`, then update the application only:

```sh
docker compose pull backend web &&
  docker compose up -d --no-deps backend web
```

Or update all configured services (including bundled qBittorrent/Jackett):

```sh
docker compose pull && docker compose up -d
```

Merge any required template changes; do not delete volumes.

#### Rootless Podman Quadlet updates

Run as the service account, using the actual `Image=` values from your `.container` files (if you edit unit files, run `systemctl --user daemon-reload` before restarting):

```sh
# Application only
podman pull ghcr.io/qw0er/anishelf-backend:latest ghcr.io/qw0er/anishelf-web:latest &&
  systemctl --user restart anishelf-backend.service anishelf-web.service

# Application and optional services (omit any service not installed)
podman pull ghcr.io/qw0er/anishelf-backend:latest ghcr.io/qw0er/anishelf-web:latest \
  docker.io/linuxserver/qbittorrent:latest ghcr.io/linuxserver/jackett:latest &&
  systemctl --user restart anishelf-backend.service anishelf-web.service \
    anishelf-qbittorrent.service anishelf-jackett.service
```

The `&&` prevents restarts if pulling fails. Restart the container services directly (their one-shot initializers continue to handle bootstrap). `anishelf.target` uses `Wants=`, so optional services stay running during an application-only restart (refresh older `Requires=` units before relying on this). For testing bundles, use `testing` images and `anishelf-test-*.service` names.

### Backup and recovery

Stop the services that own the volumes before copying them. Preserve ownership, and never copy a live SQLite file alone.

| Volume | Contents |
| --- | --- |
| `anishelf-app` | Database, settings, credentials, and generated data |
| `anishelf-media` or host media path | Original media and completed downloads |
| `anishelf-qbittorrent-config` | Downloader settings and task state |
| `anishelf-qbittorrent-connection` | Bundled credentials (back up together with app/downloader state) |
| `anishelf-qbittorrent-incomplete` | In-progress downloads |
| `anishelf-jackett-config` | Jackett settings, API key, and sites |

Restore matching application/service data and ownership while stopped, then start matching image versions. Database rollback requires the pre-update backup. Never share one `anishelf-app` volume between backends or between production and testing.

### Uninstall

- **Installer-managed:** Run `python3 scripts/install.pyz remove DIRECTORY`.
- **Docker Compose:** Run `docker compose down --remove-orphans` (preserves volumes and media).
- **Manual Quadlet:** Stop and disable `anishelf.target`, remove only this stack's installed unit files, and run `systemctl --user daemon-reload`. Keep persistent volumes unless intentionally deleting data.

## Source installation

Install the Node.js version in `.nvmrc` and ensure `ffmpeg` and `ffprobe` are available on `PATH`.

### Backend only

From the repository root:

```sh
npm ci
npm run build --workspace @anishelf/backend
npm run start:backend
```

Backend listens on `127.0.0.1:3000` by default. Check `/api/health` and sign in with the first-start password from logs. Local clients can connect via loopback; for remote clients, point a TLS reverse proxy directly at Backend, set `ANISHELF_TRUSTED_PROXIES` to the proxy's actual source address, preserve `Host`, and set `X-Forwarded-Proto` from the connection. See the [device session API](../development/clients.md#device-session-api).

### Web and Backend together

To build and serve both the browser interface and API from the repository root:

```sh
npm start
```

For development, use `npm run dev`. To update a source installation, stop the server, back up data, check out the target release, and repeat the build/start commands. See [Development](../development/README.md).
