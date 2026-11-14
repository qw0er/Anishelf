# Anishelf

A personal anime library and browser player with AniList tracking and automatic
subscription downloads.

- Poster library with automatic identification and manual association review.
- Movi Player browser playback, client subtitles and manual media preparation.
- Playback history, resume and external-player links.
- AniList lists, viewing progress and Watching-based subscription creation.
- Unified subscriptions, qBittorrent downloads and verified library ingestion.

## Quick start

Start the non-interactive deployment CLI (Python 3.9+ required):

```sh
curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/scripts/install.pyz -o /tmp/anishelf-install.pyz
python3 /tmp/anishelf-install.pyz install --engine docker --deploy-dir "$HOME/anishelf"
```

`install.pyz` is a self-contained Python 3.9+ zipapp using only the standard library.
From a source checkout, run `python3 scripts/install.pyz install` instead. See the
[deployment guide](docs/guide/deployment.md#cli-installer) for media, ports,
profiles and prerequisites.

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

`anishelf.target` now uses `Wants=`; refresh older `Requires=` units before relying
on app-only restarts. Use the target only for a full-stack stop. See
[Deployment](docs/guide/deployment.md#updates) for details.

## Documentation

| Task | Start here |
| --- | --- |
| Deploy, maintain, update or uninstall | [Deployment](docs/guide/deployment.md) |
| Use Anishelf and configure services | [User guide](docs/guide/README.md) |
| Configure paths, logs and preparation | [Configuration](docs/guide/operations.md) |
| Contribute and run checks | [Development](docs/development/README.md) |
| Review desktop and Windows support | [Windows compatibility](docs/development/windows-compatibility.md) |
| Understand modules and data flow | [Architecture](docs/development/architecture.md) |
| Change UI / storage / images | [UI design](docs/development/design-system.md) · [Database](docs/development/database-design.md) · [Deployment assets](deployment/README.md) |
| Review scope and completed work | [Requirements](docs/requirements.md) · [History](docs/history.md) |

## License

[GNU Affero General Public License v3.0](LICENSE).
