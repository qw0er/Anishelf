# Changelog

## 1.3.1

### Added

- Treat AniList Rewatching as active viewing in the library and Watching automation.
  Switching between Watching and Rewatching preserves automatic subscription settings
  and reuses available local episodes.
- Add a [cross-platform external player guide](docs/guide/external-players.md).

### Changed

- Replace the interactive Bash installer with a non-interactive Python CLI. The new
  installer requires Python 3.9 or later and uses command-line options for installation,
  reconfiguration and removal. See the [deployment guide](docs/guide/deployment.md)
  for updated commands.
- Remove the unsupported mpv external-player preset. A custom integration can still
  be configured when a suitable URL handler is available.

### Fixed

- Fix Podman Quadlet volume rendering for host paths.
- Fix the Outplayer preset URL and the link to external player settings.
