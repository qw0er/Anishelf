# Anishelf

A personal anime library and browser player with AniList tracking and automatic
subscription downloads.

- Poster library with automatic identification and manual association review.
- Browser playback, subtitles and compatible media preparation.
- Playback history, resume and external-player links.
- AniList lists, viewing progress and Watching-based subscription creation.
- Unified subscriptions, qBittorrent downloads and verified library ingestion.

## Quick start

Start the interactive deployment wizard (Bash and curl required):

```sh
bash <(curl -fsSL https://raw.githubusercontent.com/qw0er/Anishelf/main/package/install.sh)
```

Docker or Podman is detected automatically; choose an engine only when both are installed.
Podman supports Compose or rootless Quadlet. See the
[deployment guide](docs/guide/deployment.md#interactive-installer) for prerequisites,
SELinux handling and first login.

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
