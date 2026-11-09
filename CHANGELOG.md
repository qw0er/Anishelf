# Changelog

## 1.5.1

### Added

- Add v2 runtime transcode profiles with open encoder options, scoped FFmpeg
  parameters, audio/video filter chains and runtime capability diagnostics.

### Changed

- Load configuration files only at Backend startup; restart after external edits.
  Remove the manual profile reload API and Settings action.

- Copy streams already matching the target codec and explicitly configured output
  constraints independently of browser compatibility. Remux matching H.264/AAC MKV
  files into MP4 and encode only nonmatching tracks; omitted constraints do not
  require matching. All encoder options, including profile and level, apply only
  when encoding. Automatic preparation falls back to encoding when a copied stream
  would fail preset acceptance or its acceptance is unknown; forced copying blocks.

- Let transcode profiles control stream copying directly and remove the global
  preparation mode. Keep queued/running execution snapshots and completed copies
  valid after configuration changes. Custom profile files now require v2.
- Allow manual preparation when predicted browser support is unknown; validate
  actual output before publication and negotiate playback against the finished copy.

- Standardize typography, icons, action feedback and inventory layouts across the
  Web interface. Improve empty states and recovery in library, subscription,
  prepared-media and review views.
- Manage installer-generated deployments with native Docker Compose or systemd and
  Podman commands. Generated Compose files contain only selected services; use the
  latest installer to reconfigure older deployments and adopt the new layout.

### Fixed

- Preserve interface state during refreshes and make loading and operation errors
  actionable across settings, tracking, playback, subtitles and other views.
- Show tracking completion errors with retry controls where they occur.

## 1.5.0

### Added

- Manage prepared copies under Files with filename/path search, availability filters,
  sorting, pagination, storage usage, playback and original-file location links.
- Delete individual or selected prepared copies with a space estimate, in-use
  protection, partial-failure reporting and retry. Preserve originals, viewing
  history and retryable metadata when a filesystem deletion fails.
- Browse all manual and automatic subscriptions on a dedicated Subscriptions page with
  search, management and attention filters, status, last check and per-work
  include/exclude controls.
- Add a [custom transcode profiles guide](https://github.com/qw0er/Anishelf/blob/main/docs/guide/transcode-profiles.md)
  covering profile structure, codec and quality options, and selection.

### Changed

- Show every active preparation task in the monitor and load inactive history in
  batches of ten. Reflect the active task in the file preparation action and allow
  cancelling it there.
- Group media-link actions in a submenu and compact the player action bar on narrow
  screens. Size the player from the source video's aspect ratio, reducing width
  rather than cropping the frame when viewport height is limiting.
- Save single-value settings immediately and report success or failure with a toast.
  Keep explicit Save actions for forms that submit several values together.
- Improve matching between AniList and Bangumi titles when a work's names differ
  between sources, including title variants, season and part scope, and missing or
  conflicting dates and episode counts. Ambiguous candidates remain unmatched.

### Fixed

- Replace a stale preparation task when retrying after its preparation profile
  changed, instead of rejecting the retry while the matching task still exists.

## 1.4.3

### Added

- Reuse saved installation choices when reconfiguring a deployment; explicitly
  supplied flags still override them.
- Add start, stop and update actions to the generated management helper. Updates pull
  selected images before replacing running services, retain the configured image tag
  and preserve volumes and media.

### Changed

- Shorten broadcast-plan status labels.

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
