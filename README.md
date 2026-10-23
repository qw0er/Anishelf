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

### Use and operate Anishelf

- [User guide and first use](docs/guide/README.md)
- [Configuration, media directories, logs and backups](docs/guide/operations.md)
- [Jackett setup](docs/guide/jackett-setup.md)
- [Watching and subscriptions](docs/guide/watching-automation.md)
- [Release selection profiles](docs/guide/acquisition-profiles.md)

### Develop Anishelf

- [Development environment, tests and CI](docs/development/README.md)
- [Architecture](docs/development/architecture.md)
- [UI design system](docs/development/design-system.md)
- [Database design](docs/development/database-design.md)
- [AniList API verification](docs/development/anilist-api-verification.md)
- [Container packaging](package/README.md)

### Project records

- [Requirements and future scope](docs/requirements.md)
- [Completed iterations and verification](docs/history.md)

## License

[GNU Affero General Public License v3.0](LICENSE).
