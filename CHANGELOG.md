# Changelog

## 1.4.0

### Added

- Automatically prepare browser-compatible media in the background using configurable
  presets and filters. Monitor preparation tasks and reuse completed files. See the
  [automatic preparation guide](https://github.com/qw0er/Anishelf/blob/main/docs/guide/automatic-preparation.md).
- Download individual missing episodes without creating a subscription. Follow search,
  download and import progress from the episode row and retry failed requests.
- Configure the backend log level with the installer `--log-level` option.

### Changed

- Show aired episodes on anime detail pages, keeping playable local episodes visible.
  Episode rows now show compact download progress and provide scoped task details.
- Show all works by default in the library.
- Add a separate Jackett WebUI settings section and move search diagnostics into a
  test dialog beside resource sites.

### Fixed

- Align connection controls with their endpoint and hide empty Jackett action menus.
- Request sudo when the installer needs access to the Docker socket.
- Improve the preparation monitor layout on narrow screens.

## 1.3.1

### Added

- Treat AniList Rewatching as active viewing in the library and Watching automation.
  Switching between Watching and Rewatching preserves automatic subscription settings
  and reuses available local episodes.
- Add a [cross-platform external player guide](https://github.com/qw0er/Anishelf/blob/main/docs/guide/external-players.md).

### Changed

- Replace the interactive Bash installer with a non-interactive Python CLI. The new
  installer requires Python 3.9 or later and uses command-line options for installation,
  reconfiguration and removal. See the [deployment guide](https://github.com/qw0er/Anishelf/blob/main/docs/guide/deployment.md)
  for updated commands.
- Remove the unsupported mpv external-player preset. A custom integration can still
  be configured when a suitable URL handler is available.

### Fixed

- Fix Podman Quadlet volume rendering for host paths.
- Fix the Outplayer preset URL and the link to external player settings.
