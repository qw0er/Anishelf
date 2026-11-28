# Anishelf

A personal anime library for finding, watching and keeping track of your collection.
Run it as a desktop app with a local library, or host it on a server and connect
from a browser or desktop client.

[Get the desktop app](https://github.com/qw0er/Anishelf/releases/latest) ·
[Deploy a server](docs/guide/deployment.md) ·
[User guide](docs/guide/README.md) ·
[Changelog](CHANGELOG.md)

## Features

- **Organize your library.** Scan multiple media directories, browse files,
  posters and related works, and automatically identify anime and episodes.
  Review uncertain matches and choose between available versions.
- **Watch your way.** Play supported media in Web and desktop with
  libmedia-react-player and its bundled software decoding fallback. Select audio
  and subtitle tracks, jump to chapters, and resume from saved progress. Use
  styled ASS/SSA subtitles, prepare a compatible copy, or open the original in
  an external player.
- **Keep track of viewing.** Connect an AniList or Bangumi account to see your
  collection and synchronize viewing status and eligible episode progress.
  Playback history is shared by clients connected to the same server.
- **Find and download releases.** Search configured sources, choose release
  preferences, subscribe to works (including selective season-pack downloads) or
  download individual episodes. Connect qBittorrent to follow downloads through
  verification and library import.
- **Automate what you choose.** Optionally create subscriptions from your connected
  account's Watching list. Monitor activity and review items that need attention.

Anishelf supports one connected tracking account at a time. Playback compatibility
depends on the media and client. See the [playback guide](docs/guide/README.md#playback)
for details.

## Desktop app

Download a package from [GitHub Releases](https://github.com/qw0er/Anishelf/releases/latest):
Linux x64 (AppImage, deb or rpm), Windows x64 (installer), or macOS arm64 (DMG).
The builds are unsigned, and the macOS build is not notarized.

1. Install and open Anishelf. It starts its bundled backend and signs in locally.
2. In **Settings → Library → Resource directories**, choose your media folders.
   Anishelf scans them and adds recognized works to the library.
3. Browse your library, review uncertain matches, and connect a tracking account
   or download services if you want to use them.

To use an existing server instead, open **Settings → Desktop → Server connection**
and choose **External server**. Enter its address and password. Remote connections
require HTTPS; HTTP is available for loopback addresses. Web and desktop clients
connected to the same server share the library and playback history.

Install FFmpeg and FFprobe separately for media probing and transcoding. Desktop
settings also offer command-based external players, offline video caching,
optional launch at login and close to tray. See the
[desktop guide](apps/desktop/README.md) for configuration, platform details and
troubleshooting.

## Server quick start

Install Docker with Compose v2, then run the deployment CLI (Python 3.9+ required):

```sh
curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/scripts/install.pyz -o /tmp/anishelf-install.pyz
python3 /tmp/anishelf-install.pyz install --engine docker --deploy-dir "$HOME/anishelf"
```

The installer uses a managed media volume by default. It prints the address and
management commands for the deployment. Read the initial password from the Backend
logs, then add your media and configure services in Settings.

For host media directories, rootless Podman Quadlet, optional qBittorrent and
Jackett services, or a backend-only deployment, see the
[deployment guide](docs/guide/deployment.md). From a source checkout, you can run
`python3 scripts/install.pyz install` instead.

## Updates

[Back up data and configuration](docs/guide/deployment.md#backup-and-recovery)
first. Keep Web and Backend on matching tags.

### Docker Compose

From the deployment folder, with `ANISHELF_TAG` set in `.env`:

```sh
docker compose pull backend web
docker compose up -d backend web
```

A bare `docker compose pull` also upgrades enabled optional services.

### Rootless Podman Quadlet

Run as the service account:

```sh
podman pull ghcr.io/qw0er/anishelf-backend:latest ghcr.io/qw0er/anishelf-web:latest
systemctl --user restart anishelf-backend.service anishelf-web.service
```

`anishelf.target` uses `Wants=`; refresh older `Requires=` units before relying
on app-only restarts. Use the target only for a full-stack stop. See
[Deployment](docs/guide/deployment.md#updates) for details.

## Documentation

| Task | Start here |
| --- | --- |
| Use Anishelf and configure services | [User guide](docs/guide/README.md) |
| Install and configure the desktop app | [Desktop guide](apps/desktop/README.md) |
| Deploy, maintain, update or uninstall a server | [Deployment](docs/guide/deployment.md) |
| Configure paths, logs and preparation | [Configuration](docs/guide/operations.md) |
| Contribute and run checks | [Development](docs/development/README.md) |
| Understand modules and data flow | [Architecture](docs/development/architecture.md) |
| Change UI / storage / images | [UI design](docs/development/design-system.md) · [Database](docs/development/database-design.md) · [Deployment assets](deployment/README.md) |
| Review scope and completed work | [Requirements](docs/requirements.md) · [History](docs/history.md) |

## License

[GNU Affero General Public License v3.0](LICENSE).
