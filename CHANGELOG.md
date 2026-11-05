# Changelog

## 1.4.2

### Added

- Save a global title display preference in Settings: Chinese, original, English or
  romaji. Pages use the preferred available title and fall back to the original
  or another available title without changing matching evidence.
- Open the changelog in Settings, including the installed Web version and earlier
  releases. The changelog is bundled with the Web build for offline use.
- Search torrents with prepared romaji, English, original and Chinese titles instead of
  the first four arbitrary aliases. Chinese titles now participate when available.
- Collect additional English, romaji and Bangumi infobox aliases, and use conservatively
  verified names from the other metadata source as matching evidence without changing
  work identity, primary titles or episode mappings.

### Changed

- Isolate AniList and Bangumi metadata sources. Each work belongs to one source,
  automatic identification uses the selected default source, and existing cross-source
  groups are split while retaining the primary identity and local confirmations.
- Choose the default metadata source in Settings.
- Show qBittorrent and Jackett connection status below their settings section titles.
- Show only the primary title and source in work headers; alternative titles remain
  internal search evidence.

### Fixed

- Record disconnected metadata requests and their cancelled AniList reads as debug
  events instead of server errors and upstream warnings. Log routine visible-title enrichment
  batch scheduling at debug level.

- Resolve poster titles through the same Metadata cache for local and Tracking-only
  works. Visible works missing the preferred title trigger bounded background name
  enrichment and update automatically without opening their detail page.
- Verify cross-source names using shared explicit original, English or romaji titles,
  including sources whose original-title languages differ; retain premiere-date,
  format, episode-count and unique-match checks.
- Merge results from all selected search keywords before assessment, so a matching
  keyword no longer stops collection.
- Refresh cached pages after a deployment and check for an updated service worker on
  load and when returning to the page.

## 1.4.1

### Added

- Re-identify an individual pending resource or all pending resources from Review.
  Directory-wide identification refreshes suggestions while preserving confirmed and
  rejected decisions; the bulk action runs in the background and reports outcomes.
- Add a compatibility-first acquisition profile that prefers H.264 and VP9 releases.

### Changed

- Prioritize announced upcoming broadcasts on work details, highlight the next
  broadcast and collapse aired history.
- Accept 10-bit SDR H.264 and VP9 video in the automatic preparation Web preset.

### Fixed

- Improve metadata title matching using the same filename parser used for resources.
- Exclude unavailable resources from pending Review while preserving their history.

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
