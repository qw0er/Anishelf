# Anishelf

A personal anime library and browser player with AniList tracking and automatic
subscription downloads.

- Poster library with automatic identification and manual association review.
- Browser playback, subtitles and compatible media preparation.
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

Stop the stack and [back up data and configuration](docs/guide/deployment.md#backup-and-recovery)
before updating. Keep Web and Backend on matching image tags and apply any
release-specific template changes.

### Docker Compose

From the deployment folder, set `ANISHELF_TAG` in `.env`, then:

```sh
docker compose stop
# Back up data and configuration before continuing.
docker compose pull
docker compose up -d
```

### Rootless Podman Quadlet

Run as the service account, using the default `latest` image tags:

```sh
systemctl --user stop anishelf.target
# Back up data and configuration before continuing.
podman pull ghcr.io/qw0er/anishelf-backend:latest
podman pull ghcr.io/qw0er/anishelf-web:latest
systemctl --user start anishelf.target
```

Pull optional service images when updating them. See [Deployment](docs/guide/deployment.md#updates)
for details and recovery instructions.

## Documentation

| Task | Start here |
| --- | --- |
| Deploy, maintain, update or uninstall | [Deployment](docs/guide/deployment.md) |
| Use Anishelf and configure services | [User guide](docs/guide/README.md) |
| Configure paths, logs and preparation | [Configuration](docs/guide/operations.md) |
| Contribute and run checks | [Development](docs/development/README.md) |
| Understand modules and data flow | [Architecture](docs/development/architecture.md) |
| Change UI / storage / images | [UI design](docs/development/design-system.md) · [Database](docs/development/database-design.md) · [Packaging](package/README.md) |
| Review scope and completed work | [Requirements](docs/requirements.md) · [History](docs/history.md) |

## License

[GNU Affero General Public License v3.0](LICENSE).
