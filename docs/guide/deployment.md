# Deployment

[Deploy](#interactive-installer) · [Maintain](#maintenance) · [Update](#updates) · [Uninstall](#uninstall)

## Choose a deployment

| Method | Requirements | Best for |
| --- | --- | --- |
| Docker Compose | Docker with Compose v2; daemon access | Most installations |
| Podman Compose | Podman with a working Compose provider | Compose without Docker |
| Podman Quadlet | Linux, rootless Podman, cgroup v2, systemd user session | Services managed by systemd |
| [Source](#source-installation) | Node.js 24, npm, FFmpeg/FFprobe | Development or custom hosting |

Container images support AMD64 and ARM64. Always deploy matching Web and Backend versions.

## Interactive installer

For rootless Podman, first [prepare the service account](#prepare-a-dedicated-service-account).
Then run:

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/package/install.sh)
```

The wizard selects an installed engine, offers Compose or Quadlet for Podman, and
asks for a **new** deployment directory, media directory and optional services.
Review the summary and confirm to start. Keep the generated directory for maintenance.

| Option | Default / action |
| --- | --- |
| Media directory | Blank creates a managed volume; otherwise use a dedicated absolute host path |
| qBittorrent / Jackett | Optional; enable during installation or connect external services in Settings |
| App address | `127.0.0.1:3000`; change bind address and public origin in advanced options for remote access |
| Image tag | `latest`; advanced options allow a published release tag |
| SELinux | Shared relabeling on Enforcing/Permissive hosts; select only a dedicated media tree |
| Preview only | Add `--generate-only` to save configuration without starting services |

The installer needs Bash and curl. It does not install packages or configure host
users. Ordinary installation refuses existing deployment files. Use the explicit
maintenance actions below to remove or replace a saved installer configuration.
Installer failures are recorded in the generated `install.log`.

### Prepare a dedicated service account

For rootless Podman, an administrator creates the account and enables startup after
logout/reboot:

```sh
sudo useradd --create-home --shell /bin/bash anishelf
sudo loginctl enable-linger anishelf
sudo machinectl shell anishelf@.host
```

Skip `useradd` if the account exists. If `machinectl` is unavailable, log in directly
as `anishelf` through SSH. Run the installer, `podman` and `systemctl --user` commands
inside this account's login session, without sudo.

The account needs subordinate UID/GID ranges (at least 65,536 each, usually assigned
to regular users automatically). If absent, have the administrator allocate unused
ranges in `/etc/subuid` and `/etc/subgid`. Avoid a plain `su` switch: it may not
establish the systemd user session required by Quadlet.

### Media permissions

| Deployment | Required access to a host media directory |
| --- | --- |
| Docker | Container UID/GID 1000 can read and traverse it; bundled qBittorrent also needs write access |
| Rootless Podman | The service account has the same access; generated units map it to container UID/GID 1000 |
| SELinux | Shared `z` labels for media shared by Backend and qBittorrent; Backend mounts it read-only |

Prepare host ownership/ACLs before starting. Automatic relabeling is for dedicated
media storage; on NFS or pre-labeled storage, use administrator-prepared labels and
decline relabeling in advanced options.

## Docker Compose

For manual installation, save [compose.yaml](../../package/deploy/compose.yaml) and
[.env.example](../../package/deploy/.env.example) as `compose.yaml` and `.env` in a
new deployment directory. Edit `.env`, then run there:

```sh
docker compose pull
docker compose up -d
docker compose logs backend
```

Use `podman compose` instead for a Podman deployment, including all maintenance
commands below. The installer records its engine in `.env` as `ANISHELF_DEPLOY_ENGINE`.

| `.env` setting | Purpose |
| --- | --- |
| `ANISHELF_TAG` | Matching Web/Backend release tag |
| `ANISHELF_MEDIA_PATH` | Absolute host media path; omit for a managed volume |
| `COMPOSE_PROFILES=qbittorrent,jackett` | Enable both optional services; select either or omit both |
| `ANISHELF_BIND_ADDRESS` / `ANISHELF_PORT` | Host listener; defaults to `127.0.0.1:3000` |
| `ANISHELF_PUBLIC_ORIGIN` | Browser-facing origin, such as `https://anime.example.com` |

The environment example lists optional WebUI and peer ports. Container/backend
variables are documented in [Configuration](operations.md#environment-variables).

## Isolated testing deployment

Use the installer testing profile to run a test build beside production with
Docker/Podman Compose or rootless Podman Quadlet:

```sh
bash package/install.sh --test
```

From a source checkout, add `--templates-dir package/deploy` to use its local
templates. `--ref` selects deployment templates, not the container image tag.
Choose the engine and deployment method in the wizard. Advanced options let you
select a matching `test-<full-SHA>` image tag instead of the moving `testing` tag.
Wait for both test image manifests to publish before installing.

| Setting | Testing default |
| --- | --- |
| Deployment directory | `~/anishelf-test` |
| Image tag | `testing` |
| Web address | `http://localhost:3001` (loopback only) |
| Compose project | `anishelf-test` |
| Quadlet target | `anishelf-test.target` |
| Containers, network and named volumes | Separate testing namespace |
| Optional qBittorrent WebUI / peer ports | `8081` / `6882` |
| Optional Jackett WebUI port | `9118` |

The profile creates a fresh application database and dedicated media volume.
It does not offer host media mounts, preventing downloader writes or SELinux
relabeling of production media. Copy sample files into the testing media volume
for playback checks. Optional bundled qBittorrent and Jackett use their own
configuration and download volumes. Configure only independent test credentials;
do not import the production database, which can contain active subscriptions
and production service credentials. This profile isolates storage, not outbound
network access. Advanced port overrides must remain distinct from production.

From your computer, forward the test port and open `http://localhost:3001`:

```sh
ssh -N -L 3001:127.0.0.1:3001 user@server
```

For Compose, update the image tag in the test directory's `.env`, then run:

```sh
cd ~/anishelf-test
docker compose pull
docker compose up -d
docker compose logs --tail=100 backend web
```

Use `podman compose` for a Podman installation. For Quadlet, use the installer to
render and apply a new tag without editing individual units:

```sh
bash package/install.sh --reconfigure "$HOME/anishelf-test"
```

The saved profile retains the testing namespace; reconfiguration collects settings
again and preserves test data. Read logs with
`journalctl --user -u anishelf-test-backend.service`. Stop only the test stack with
`systemctl --user stop anishelf-test.target` (Quadlet) or `docker compose down`
(from the test Compose directory).

To remove the test deployment configuration while preserving its volumes:

```sh
bash package/install.sh --remove "$HOME/anishelf-test"
```

The installer reads the saved profile for removal/reconfiguration; do not add
`--test` to a production bundle. Keep the `.deployment-profile` file with the
saved deployment configuration. Each engine/account supports one installer-managed
testing namespace; a different directory alone does not create another instance.

## Podman Quadlet

Run the installer as the service account and select **Podman → Quadlet**. It installs:

| Files | Location |
| --- | --- |
| `anishelf-*.container`, `anishelf-*.volume`, `anishelf.network` | `~/.config/containers/systemd/` |
| `anishelf.target` | `~/.config/systemd/user/` |

For manual installation, use the canonical [Quadlet files](../../package/deploy/quadlet/).
Core files are the network, app/media/qBittorrent-connection/Jackett-config volumes,
Backend, Web and target. Add qBittorrent's container, init container and config/incomplete
volumes together; add Jackett's container if needed. Match app image tags, public
origins and media mounts before starting:

```sh
systemctl --user daemon-reload
systemctl --user enable --now anishelf.target
```

Enable the target only. It manages the stack, including installed optional services.
Quadlet reads installed unit files rather than Compose `.env`.

## First login and optional services

Open [localhost:3000](http://localhost:3000) and use the initial password from
Backend logs. For a remote server with the default loopback binding:

```sh
ssh -L 3000:127.0.0.1:3000 user@server
```

| Service | Connection / next step |
| --- | --- |
| Anishelf | [First use](README.md#first-use): resource roots, Library and AniList |
| Bundled qBittorrent | API `http://qbittorrent:8080`; WebUI `http://localhost:8080` |
| Bundled Jackett | API `http://jackett:9117/`; WebUI `http://localhost:9117`; [select sites](jackett-setup.md) |
| External qBittorrent | Save API credentials, test connection, then save and validate the destination in Settings |

### Bundled qBittorrent

New configurations get a permanent random password and automatic Anishelf connection.
In **Settings → qBittorrent**, show/copy WebUI credentials and save a browser-reachable
WebUI link. Existing configurations require manual connection setup.

Completed downloads use `/data/media`; incomplete files use `/data/incomplete`,
outside watched roots. External downloaders must map their completed path to the
same files visible to Backend. A validated destination is checked again during import.

After changing the WebUI password, update it in Anishelf, test the connection,
revalidate the destination and save affected subscriptions again. Lost credentials
require backup recovery or entering the current password; initialization does not reset it.

## Network and qBittorrent

For HTTPS, point your TLS proxy at Web's loopback port:

```caddyfile
anime.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Set `ANISHELF_PUBLIC_ORIGIN=https://anime.example.com` in **both Web and Backend**
(via Compose `.env` or both Quadlet units), then recreate/restart them. Preserve
Host and Origin through the proxy. Packaged Backend trusts the private Web proxy;
for custom networks, narrow `ANISHELF_TRUSTED_PROXIES` to its actual CIDR.
Keep Backend private and management WebUIs on loopback or behind protected access.

## Maintenance

Run Compose commands from the saved deployment directory; run Quadlet commands as
the service account.

| Task | Docker Compose | Podman Quadlet |
| --- | --- | --- |
| Status | `docker compose ps` | `systemctl --user status anishelf.target anishelf-backend.service anishelf-web.service` |
| Logs | `docker compose logs -f --tail=100 backend web` | `journalctl --user -u anishelf-backend.service -u anishelf-web.service -f` |
| Stop | `docker compose stop` | `systemctl --user stop anishelf.target` |
| Start | `docker compose up -d` | `systemctl --user start anishelf.target` |
| Restart | `docker compose restart` | `systemctl --user restart anishelf.target` |

### Storage, updates and recovery

Stop the whole stack before backing up. Copy each volume's complete data with your
backup tool, preserving ownership; also save deployment configuration and host media.
Do not copy an active SQLite file by itself.

| Persistent volume | Contents |
| --- | --- |
| `anishelf-app` | Database, settings, credentials, profiles and generated caches |
| `anishelf-media` or host media directory | Original media and completed downloads |
| `anishelf-qbittorrent-config` | Downloader configuration and task state |
| `anishelf-qbittorrent-connection` | Initial bundled credentials; back up with app and downloader config |
| `anishelf-qbittorrent-incomplete` | In-progress downloads |
| `anishelf-jackett-config` | Jackett configuration, API key and site settings |

For recovery, stop the stack, restore the matching application/service data and
ownership, then start the matching image versions. Never share one app volume
between backends. Database migrations require the pre-update backup when rolling back.

To reset the Anishelf password, run the appropriate command, then restart Backend:

```sh
# Compose
docker compose exec backend node backend/dist/cli.js auth reset-password
docker compose restart backend

# Quadlet
podman exec anishelf-backend node backend/dist/cli.js auth reset-password
systemctl --user restart anishelf-backend.service
```

### Updates

1. Stop the stack and back up its data and deployment configuration.
2. Select matching application versions and update using the commands below.
3. Check Backend logs and sign in. If rollback is needed, restore the matching backup.

**Compose:** edit `ANISHELF_TAG` in `.env`, then:

```sh
docker compose pull
docker compose up -d --remove-orphans
docker compose logs --tail=100 backend
```

**Quadlet:** edit `Image=` in installed Backend, Web and optional qBittorrent-init
units to the same application tag. Pull the selected images (replace `VERSION`):

```sh
podman pull ghcr.io/qw0er/anishelf-backend:VERSION
podman pull ghcr.io/qw0er/anishelf-web:VERSION
systemctl --user daemon-reload
systemctl --user start anishelf.target
journalctl --user -u anishelf-backend.service -n 100
```

Pull optional qBittorrent/Jackett images too when updating those services. For
releases with template changes, merge the new [Compose](../../package/deploy/compose.yaml)
or [Quadlet](../../package/deploy/quadlet/) settings into the saved configuration.
Do not run ordinary installation over an existing deployment or delete volumes to upgrade.

### Remove or replace deployment configuration

Run the installer as the original deployment user, using the same Docker/Podman
context. These actions manage saved installer bundles only, not source checkouts.

```sh
# Stop services and remove their active configuration, keeping all data.
bash package/install.sh --remove "$HOME/anishelf"

# Collect fresh settings from current templates and replace the saved deployment.
bash package/install.sh --reconfigure "$HOME/anishelf"
```

Both actions require confirmation (default No) and save the previous configuration
by renaming the entire old deployment directory to a sibling such as
`anishelf.backup.XXXXXX`, including custom files and a removal log. These maintenance
actions require GNU `mv` (coreutils). They never remove named volumes, images, host media or unrelated files.
Removal leaves the original deployment path absent. Reconfiguration creates a fresh
directory at that path after archiving the old directory. Reconfiguration performs
removal itself; do not run removal first when replacing a working deployment.

Reconfiguration retains the original engine, deployment method and standard volume
names. Enter the same host media path to keep using a bind-mounted library; review
all optional services, ports, origin and image tag because settings are collected
afresh. It renders new templates and validates Compose before stopping old services.
For Quadlet, installation and reconfiguration explicitly pull every selected image
from the rendered units, including optional services, before installing units or
stopping the old deployment. Pull failure aborts without replacing the old configuration;
repeated initializer images are pulled only once. Generation-only mode never pulls.
Use `--ref VERSION` to select templates from a release or `--templates-dir` for local
templates. These actions cannot be combined with `--generate-only`.

Compose removal runs `down --remove-orphans` with both optional profiles, without
`--volumes`. Quadlet removal stops services, disables the target, removes matching
installed unit files and reloads systemd. Locally changed installed Quadlet units
must be reconciled with the saved bundle first. Configuration backups are not data
backups: take an application-data backup before an upgrade. If replacement fails
after stopping services, the old configuration remains in the reported backup;
rename the backup directory back to the original deployment path before restarting
the old deployment, with matching data if migrations
have already run.

## Uninstall

These commands remove services while preserving persistent volumes and host media.

**Compose:**

```sh
docker compose down --remove-orphans
```

**Quadlet:** stop the target, then remove this stack's installed units:

```sh
systemctl --user disable --now anishelf.target
rm -f ~/.config/containers/systemd/anishelf-*.container \
      ~/.config/containers/systemd/anishelf-*.volume \
      ~/.config/containers/systemd/anishelf.network \
      ~/.config/systemd/user/anishelf.target
systemctl --user daemon-reload
systemctl --user reset-failed
```

Keep the deployment directory for reinstalling, or delete it after saving its
configuration. To **erase data permanently**, remove only the volumes listed in
[Storage](#storage-updates-and-recovery) using your engine's `volume rm` command,
after confirming backups. Host media must be removed separately. Remove a dedicated
service account only after migrating or deleting its rootless storage.

## Source installation

Install Node.js 24, npm and FFmpeg/FFprobe, then run from the repository root:

```sh
npm ci
npm start
```

The root [compose.yaml](../../compose.yaml) instead builds the checkout with
`npm run compose:up` (equivalent to `docker compose up -d --build`). To include bundled
qBittorrent and Jackett, run `npm run compose:up:full`. See [Development](../development/README.md) for checks
and [Configuration](operations.md) for startup variables. To update a source install,
stop it, back up, check out the selected release, then repeat `npm ci` and `npm start`.
To uninstall, stop its process/service and remove the checkout; retain its configured
data directory and media unless intentionally erasing them.
