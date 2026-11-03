# Implemented Requirements

This document records capabilities marked Complete against their documented scope.
Complete does not imply universal compatibility or absence of known issues. Shared
context may mention partially delivered capabilities; their remaining work is tracked
in [Requirements](requirements.md). The recorded status has not been independently
reverified as part of this document split. Item-table fields use the same definitions as
[Requirements](requirements.md#2-feature-inventory-and-version-tracking); `—` in Status
means no separate status is recorded, not that verification is implied.

### 2.0 Delivered V1 Foundation

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| V01 | Resource directory configuration | Complete | — | [Single-root setup; multi-root support under L12](#delivery-notes-v) | 0.1.0 |
| V02 | Library scanning | Complete | — | [Startup/manual scans and filesystem updates](#delivery-notes-v) | 0.1.0 |
| V03 | Resource browsing | Complete | — | Actual directory hierarchy, original filenames, stable natural sorting, and parent navigation | 0.1.0 |
| V04 | Web playback | Complete | — | Browser playback of supported original media with seeking | 0.1.0 |
| V05 | Basic playback controls | Complete | — | Play, pause, seek, volume, fullscreen, and return to the original directory | 0.1.0 |
| V06 | Failure feedback | Complete | — | Missing/unreadable resources and unsupported-media or playback errors | 0.1.0 |

#### Delivery Notes (V)

- **V01:** Original single-root setup; multiple persisted roots and per-root feedback are delivered under L12.
- **V02:** Automatic scans at startup and after resource-root changes; native filesystem monitoring and manual rescans; recursive video discovery; repeated scans without duplicate paths; additions and removals reflected. **Release record:** 0.1.0; 0.4.1 (filesystem monitoring).

Original V1 delivered read-only originals, resource-root confinement, persistent root settings, and visible scan states. L13 and L19 add explicit confirmed moves and deletion. Subtitle loading, saved progress, and media preparation are V2 additions.

### 2.1 Resource Access and Library

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| L05 | Search filenames recursively | Complete | — | Name search within the current directory and its descendants | 1.3.0 |
| L18 | Choose file and directory sorting | Complete | — | Natural-name, size, or modification-time sorting | 1.3.0 |
| L06 | Watch filesystem changes and update the library incrementally | Complete | — | [Incremental updates with monitoring recovery](#delivery-notes-l) | 0.4.1 |
| L07 | Parse anime titles, seasons, episode numbers, and release variants from filenames | Complete | — | Filename/directory extraction with preserved evidence | 0.3.0 |
| L08 | Review unidentified files and manually link or correct anime and episode associations | Complete | — | [Automatic admission and protected manual Review](#delivery-notes-l) | 0.3.0 |
| L09 | Distinguish regular episodes, specials, continuous season numbering, and multi-episode files | Complete | — | [Episode proposals, ambiguity and confirmed corrections](#delivery-notes-l) | 0.3.0 |
| L10 | Associate multiple file versions with an episode and select a version for playback | Complete | — | Episode associations and Web version selection with changed-file protection | 0.3.0 |
| L12 | Configure and manage multiple resource roots | Complete | — | [Separate roots with partial-failure recovery](#delivery-notes-l) | 0.4.1 |
| L13 | Move files or folders with preservation rules | Complete | — | [Confirmed same-filesystem moves; history retained](#delivery-notes-l) | 1.3.0 |
| L19 | Delete files or folders with preservation rules | Complete | — | [Confirmed recursive deletion; history retained](#delivery-notes-l) | 1.3.0 |
| L14 | Download an existing original media file from the Web interface to the user's device | Complete | — | — | 0.2.5 |

#### Delivery Notes (L)

- **L06:** Automatic updates for affected files and folders, with monitoring failure recovery.
- **L08:** Clear-match automatic admission, manual Review and protection against conflicting corrections. Since 1.4.1, Review can re-identify an available pending resource's directory or all pending resources in the background, preserving confirmed and rejected decisions. Unavailable resources are excluded from pending Review but retain their history.
- **L09:** Candidate-specific episode proposals, unresolved ambiguity and confirmed corrections.
- **L12:** Multiple non-overlapping paths, separate Files entries, partial scan recovery and preserved settings/history.
- **L13:** Confirmed same-filesystem moves with retained decisions/history and writable deployment.
- **L19:** Confirmed recursive deletion with retained decisions/history and writable deployment.

The poster library supports Title, Recently added, Recently updated and Unwatched
first sorting. Unwatched first is the default: works with locally available episodes
beyond the tracking provider's cumulative progress precede other works; each group
uses title order. Unknown progress and remote-only works receive no unwatched priority.
Recently updated uses the local Catalog work update timestamp; remote-only works use
the provider list-entry update timestamp, falling back to the list fetch time.
Recently added retains local Catalog creation-time ordering. Files search matches names in the current directory and its subdirectories, showing each result’s relative parent path. Directories remain ahead of files; size and modification-time sorting applies to files, with natural name order breaking ties.

#### Multi-root resource management (L12)

Users can save multiple absolute server resource paths in Settings; removing all
roots returns to setup mode. Canonically duplicate or nested roots and overlap with the
data directory are rejected, including aliases through symlinks. Multiple roots
are browsed as distinct Files entries. Identical relative filenames remain distinct
resources, and reordering roots does not change their identities.

Healthy roots continue to update if another root is unavailable. Failed roots
retain their previous index and report availability/warnings; all-root failure
must not publish an empty library. Removing a root hides its resources while
preserving accepted associations and playback history. Restoring it makes those
records reusable. Legacy single-path settings and durable source records upgrade
without discarding history. Filesystem watching is delivered separately under L06.

#### Move and delete resources (L13, L19)

Users can move an indexed media file or folder into an existing directory while
retaining its name, or permanently delete a file or entire folder. Folder operations
include subtitles and non-media descendants. Separate rename, copy, automatic
organization and retention-policy controls are outside the delivered scope.

Require explicit confirmation before moving or permanently deleting resources.
Reject configured roots, symlinks, special files, overwrites, moves into the source
subtree and moves across filesystems. Moves between configured roots on the same
filesystem are supported. Reject stale or unsafe operations and refresh affected
library entries after success or partial failure; report incomplete changes clearly.

Preserve accepted associations, viewing history, tracking state, settings and generated
media copies. Removed sources become unavailable. Moved files undergo identification
and Review again; existing source associations are not automatically transferred.
Deletion has no recycle bin and does not guarantee immediate disk-space recovery.
Download and seeding clients are not controlled by these operations. Read-only media
remains playable, but move/delete requires write access and a supported deployment.
See [resource operation design](development/architecture.md#confirmed-resource-operations)
for execution constraints and [deployment guidance](guide/deployment.md) for prerequisites.

#### Filesystem Monitoring and Incremental Updates (L06)

Watch the configured resource root recursively for file and directory additions, modifications, removals and moves. Use these changes to refresh affected library entries automatically, without waiting for a scheduled full scan. Avoid treating incomplete, actively written files as ready for identification or playback. Preserve resource-root restrictions, manual associations and viewing history.

Keep startup scanning and explicit manual rescans for initial discovery and reconciliation. Known monitoring failures must trigger recovery and reconciliation. Detect unavailable monitoring or lost events, report degraded monitoring and provide reconciliation and retry; an inaccessible root must not be treated as an empty library. See [Filesystem monitoring](development/architecture.md#resource-directory-isolation).

#### Resource Identification (L07–L10)

Identify works and episodes from filenames, directory context and available external
metadata. Explain proposed matches and conflicts. Similar candidates, unsupported
numbering assumptions and uncertain episode mappings require Review instead of a
forced association. Do not assume an unmarked title is season one or infer numbering
across unrelated works, seasons or releases without supporting evidence.

Preserve original numbering and evidence alongside confirmed associations, including
specials, continuous numbering and multi-episode files. Review must show the proposed
work and episode mapping and explain why automatic identification was withheld.
Manual corrections survive rescans and metadata refresh; reassociation must not
silently delete playback history. Multiple file versions remain selectable without
counting as separate episodes. Matching algorithms and admission policy belong in
[Architecture](development/architecture.md#delivered-anime-library-workflow).

#### Download Existing Media (L14)

- Provide a download action for an individual library file, preserving its original filename and contents.
- Transfer the existing original file without transcoding or modifying the server copy.
- Apply the same resource-root restrictions and access controls as playback; report missing or unreadable files.
- Initially exclude batch downloads, directory archives, and managed offline libraries.

Downloads are available from file actions and playback options. This capability
transfers an existing file to the user’s device; automatic acquisition through
qBittorrent is a separate capability (D01–D07).

### 2.2 Anime Metadata

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| M01 | Search external anime metadata and store provider identifiers | Complete | — | [AniList/Bangumi search with stable work identities](#delivery-notes-m) | 0.3.0 |
| M02 | Display covers, aliases, descriptions, seasons, episode counts, airing information, and available same-provider work relations | Complete | — | Cached details, artwork, available episode data and same-provider relations | 0.3.0 |
| M03 | Provide anime detail and episode views, organizing the library by title | Complete | — | [Poster library, work details and episode/version actions](#delivery-notes-m) | 0.3.0 |
| M04 | Manually select, correct, and refresh metadata mappings | Complete | — | Review selection/reassociation, episode corrections and metadata refresh | 0.3.0 |
| WI11 | Prioritize upcoming broadcast plans on work details | Complete | Completed | [Announced future airtimes and next-broadcast highlight](#delivery-notes-m) | 1.4.1 |
| M05 | Cache metadata so external outages do not prevent browsing or playback | Complete | — | [Cached browsing and playback during provider outages](#delivery-notes-m) | 0.3.0 |
| M07 | Preserve multilingual program titles, aliases and descriptions with language tags, original language and locale-independent IDs | Complete | — | Available provider language information and stable local identities; no invented translations | 0.3.0 |

#### Delivery Notes (M)

- **M01:** AniList and Bangumi search behind permanent project work IDs; each project identity belongs to exactly one source. **Release record:** 0.3.0 (AniList); 1.0.6 (multi-source).
- **M02 / WI11:** Broadcast-plan improvements are complete: provider-announced future airtimes appear first, the next broadcast is highlighted, aired history is collapsed, and dates include the local weekday and time zone. Detail metadata supplies the next broadcast when schedule pages are incomplete. Cached plans remain visible; elapsed plans await refreshed confirmation. Unannounced dates are not estimated. **Release record:** 1.4.1 (broadcast-plan improvements).
- **M03:** Default poster library, work details, episode/version playback and file-list location from available-version actions. **Release record:** 0.3.0; 1.0.6 (file location).
- **M05:** Durable metadata/artwork caching, refresh/retry and retained snapshots during outages.
- **M06:** **Delivered:** Independently selectable AniList/Bangumi search, persisted default source, isolated identities and source-specific Tracking availability. Cross-source linking and metadata composition are unsupported. **Release record:** 1.0.6 (partial).

#### External Metadata and Local Catalog (M01–M07)

External anime metadata is a dependency of the delivered identification workflow, not a later tracker integration. Users select AniList or Bangumi for each search. Automatic recognition searches the persisted default source only. Retain available aliases, language information, episode data and work relations according to source capabilities. Provider changes must not silently replace confirmed local work or episode associations. Cache fetched metadata with refresh status and preserve user corrections. Outages must not block already-cached browsing or existing file playback; unavailable candidate or episode information remains explicitly unresolved.

Each project identity belongs to one source entry. Cross-source association, ID
aliases and metadata composition are unsupported. Historical groups are split during
migration while preserving the primary project ID and local confirmations. Bangumi
schedules, relations, Tracking and a canonical episode catalog are not currently supplied.

Provider and parser uncertainty is handled through Review. Provider-required service access is distinct from T01–T05 personal account authorization, personal list access and viewing-state updates; basic identification must not require the user to authorize a personal tracker account.

Available episode versions expose Show in Files through their file action menu. It opens the corresponding file in Files without starting playback. Multiple versions target their own files; unavailable versions expose no file commands. Detailed interaction conventions remain in the [design system](development/design-system.md).

### 2.3 Web Playback and Subtitles

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| P03 | Select or disable external VTT/SRT/ASS/SSA subtitles | Complete | — | — | 0.2.0 |
| P05 | Choose a playback strategy based on media and client capabilities | Complete | — | — | 0.2.0 |
| P06 | Remux media when only the container is incompatible | Complete | — | — | 0.2.0 |
| P07 | Prepare full-file Web-compatible copies with seeking and avoid unnecessary re-encoding | Complete | — | Completed-file preparation, reuse, cancellation, retry and recovery | 0.2.0 |
| P15 | Extract, validate and load embedded font attachments | Complete | — | Validated embedded TTF/OTF fonts for styled subtitles | 0.2.6 |
| P17 | Automatically prepare full-file Web-compatible copies in the background before playback | Complete | — | [Preset-based background preparation and recovery](#delivery-notes-p) | 1.4.0 |
| P10 | Select audio tracks | Complete | — | — | 0.2.0 |
| P23 | Adjust subtitle timing | Complete | — | — | 0.2.0 |
| P24 | Change playback speed | Complete | — | — | 0.2.0 |
| P25 | Use playback keyboard shortcuts | Complete | — | — | 0.2.0 |
| P11 | Next-episode navigation and automatic continuation | Complete | — | [Next-episode navigation and opt-in continuation](#delivery-notes-p) | 1.3.1 |
| P13 | Chapter navigation | Complete | — | Chapter discovery and navigation aligned with the original timeline | 0.2.6 |

#### Delivery Notes (P)

- **P08:** **Delivered:** Text-track discovery, selection, extraction and delivery; font attachments. **Remaining:** Bitmap subtitle extraction (P16). **Release record:** 0.2.0 (text subtitles); 0.2.6 (embedded fonts).
- **P09:** **Delivered:** Styled ASS/SSA, fallback fonts and embedded TTF/OTF support. **Remaining:** Bitmap subtitle compatibility; extraction is Later under P16, while rendering, OCR and burn-in remain unassigned. **Release record:** 0.2.0 (styles and fallback fonts); 0.2.6 (embedded fonts).
- **P17:** Preset-based evaluation of existing and new resources, per-track processing, reuse and persistent recovery. **Release record:** 1.4.0; 1.4.1 (10-bit SDR video in the Web preset).
- **P11:** Consecutive local regular episodes, explicit version choice and opt-in browser-local continuation with cancellable countdown.
- **P12:** **Delivered:** Custom preparation profiles support NVENC and QSV for H.264/HEVC/AV1, and VideoToolbox for H.264/HEVC. **Remaining:** Broader hardware acceleration. **Release record:** 0.2.0 (hardware encoding; partial).
- **P18:** **Delivered:** Automatic preparation can preserve explicitly accepted HDR streams when packaging permits. **Remaining:** Validated HDR-to-SDR conversion and broader HDR handling. **Release record:** 1.4.0 (HDR stream preservation; partial).
- **P20:** **Delivered:** A fixed single-worker queue. **Remaining:** Configurable task concurrency. **Release record:** 0.2.0 (single-worker queue; partial).

The player prioritizes video and common playback controls on desktop and narrow screens.
Secondary commands and routine technical explanations are available on demand through
More and playback options; unavailable-playback recovery and consequential tracking
decisions remain discoverable. Subtitle controls remain accessible within the player.
See the [player layout conventions](development/design-system.md#player-layout).

#### Full-file Preparation (P05–P07)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Automatic Background Pre-transcoding (P17)

Users can enable automatic preparation and select a playback preset in Settings →
Playback. It is disabled by default and covers both existing resources and newly
discovered or changed files. Checks run without an open browser. Preparation must
not start merely because a user opens playback or replace an active playback asset.

- **Selection:** provide built-in Web and Web · Conservative presets and optional
  administrator-defined presets. Display them as descriptive radio cards, consistent
  with the manual preparation profiles. Put the section description below its title.
  Built-in preset names and descriptions remain English in every interface language;
  custom text is displayed as authored.
- **Defaults:** Web accepts MP4/WebM, H.264/VP9 8-bit or 10-bit 4:2:0 SDR video and unrestricted
  audio formats. Web · Conservative accepts MP4, H.264 8-bit 4:2:0 SDR video in the
  supported profile set, and AAC LC audio. Both retain all audio tracks and impose
  no resolution, frame-rate, channel-count or sample-rate ceiling.
- **Custom policy:** allow filtering by resource root, relative path and file viewing
  state; selecting all, default, matching-language or no audio; and defining accepted
  containers and alternative video/audio specifications. Omitted constraints mean
  unrestricted. Encoding parameters are selected separately from acceptance rules.
- **Reuse and conversion:** reuse suitable originals, completed copies and equivalent
  pending work. Otherwise copy accepted streams when packaging allows, encode only
  the streams requiring conversion, and preserve selected audio order and language
  mappings. A copy may combine copied and encoded audio tracks. Audio acceptance
  does not certify that the output container can carry that audio format.
- **Availability:** the custom file is optional. Invalid custom configuration keeps
  built-ins usable and exposes a configuration issue. Preserve unavailable saved
  selections and pause automation rather than silently changing the selected preset.
- **Lifecycle:** show automatic task provenance, progress and failures in the existing
  task monitor. Support cancellation and server-planned retry. Manual work takes
  priority. Disabling automation or switching presets cancels obsolete queued
  automatic-only work, lets running work finish and retains completed copies.
  Cancelled tasks and deleted copies remain eligible for a later automatic check.
- **Recovery and limits:** retry transient failures with persistent backoff, reevaluate
  incomplete automatic work after restart, fence changed sources and preserve valid
  completed copies. Honor cache and free-space budgets without silently evicting
  valid copies. Preserve original files and playback history.
- **Validation:** defer work when required metadata is unknown and validate actual
  output before publication. HDR-to-SDR conversion remains blocked without a
  validated tone-mapping policy. Presets describe preparation requirements; actual
  playback continues to check the client's capabilities.

See the [architecture](development/architecture.md#automatic-media-preparation) for
module boundaries and the [operator guide](guide/automatic-preparation.md) for exact
configuration fields and examples.

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Configuration and Storage Boundary (V2)

See the [archived V2 requirements and design](history.md#v2-requirements).

### Provider integration boundary

Metadata supports AniList and Bangumi. Tracking supports one AniList account, with
AniList authoritative for viewing state and cumulative episode progress. Basic
metadata lookup and identification do not require personal tracker authorization.
Additional trackers, simultaneous accounts and cross-source episode mappings remain
Later/Unassigned. Associating metadata works does not enable Bangumi Tracking or
arbitrary episode-number conversion. Internal provider boundaries belong in
[Architecture](development/architecture.md#source-organization-and-dependency-boundaries).

### 2.4 Viewing History and Tracking

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| W01 | Save playback position and duration and resume playback | Complete | — | — | 0.2.0 |
| W02 | History page with recent viewing records and resume/replay | Complete | — | History covers continue watching | 0.2.0 |
| W03 | Detect episode completion and submit progress updates or manual corrections to AniList | Complete | — | [Completion detection and manual progress corrections](#delivery-notes-w) | 0.4.0 |
| W04 | Display and update AniList tracking statuses | Complete | — | Remote display/filters and manual status updates | 0.4.0 |
| W05 | Show watched counts and available unwatched episodes from AniList progress, alongside local playback history | Complete | — | Detail indicators/counts and Library available-unwatched counts | 0.4.0 |
| W08 | Treat rewatching as active viewing across Library and Watching automation | Complete | — | [Shared active-viewing behavior; distinct Rewatching status](#delivery-notes-w) | 1.3.1 |

#### Delivery Notes (W)

- **W03:** Unified detail/player commands and 90-percent/natural-end completion with 30-second normal-play minimum.
- **W06:** **Delivered:** Server-backed playback history and progress shared across Web devices. **Remaining:** Native client integration. **Release record:** 0.2.0 (Web playback history and progress; partial).
- **W12:** **Delivered:** Duplicate detection, sequence ordering and newer-session precedence. **Remaining:** Broader cross-client and delayed-update handling. **Release record:** 0.2.0 (Web session protection; partial).
- **W08:** Distinct tracking status with shared active-viewing behavior; see requirements below.

#### Rewatching as Active Viewing (W08)

This extends W04–W05 and S08/S10–S12. Preserve `rewatching` as a distinct tracking
status, but treat both `watching` and `rewatching` as active viewing wherever current
Watching membership
drives Library aggregation or automatic acquisition. This does not require the
optional rewatch-history feature in W07.

| Scenario | Required behavior |
| --- | --- |
| Default Library Watching filter | Include both statuses; retain the Rewatching label on rewatching cards and details |
| Explicit Rewatching filter | Include only `rewatching` entries |
| Watching automation | Include rewatching works in activation previews, membership counts and limits, subscription creation and ongoing acquisition under the same accepted policy |
| Transition between `watching` and `rewatching` | Keep active membership; do not pause or recreate subscriptions, reset their starting episode or replace saved configuration |
| Transition out of both active statuses | Apply existing leave-Watching behavior to automatic subscriptions; manual subscriptions and submitted transfers/imports remain independent |
| Progress and next episode | Use confirmed remote progress for the current viewing pass; progress 3 makes episode 4 the next candidate, subject to local availability and existing version-selection rules |
| Progress-only synchronization | Preserve `rewatching`; do not implicitly change it to `watching` or reset progress because the status denotes a rewatch |
| Existing local resources | Reuse available files and acquire only eligible missing episodes under existing coverage and deduplication rules; rewatching alone never triggers duplicate downloads |

Keep the original status for display, exact Rewatching filtering and AniList
synchronization. Use one consistent active-viewing definition across aggregation,
preview validation, capacity checks and automatic-subscription reconciliation.
Missing or invalid progress retains existing unavailable/unsupported behavior;
do not infer a new pass or reset progress from historical completion. Preserve local
source playback positions and history independently from tracking progress.
Existing completed subscriptions remain completed under the usual coverage and
explicit-resume rules; entering rewatching alone does not reopen them.

Acceptance must cover both statuses in the default list and automation preview,
rewatching-only filtering, subscription continuity in both transition directions,
leaving the active group, progress-only updates retaining the status, and reuse of
local coverage without duplicate acquisition. Extend existing structured decision
logs to make active membership and resulting acquisition decisions diagnosable.

#### Episode Viewing and Tracking (W03–W05)

AniList is the authority for anime viewing status and cumulative episode progress. Display its tracked titles and supported statuses, and submit automatic completion updates and manual progress/status corrections to AniList. Reuse confirmed local work/episode associations and provider identifiers; mapping is already delivered and is not a new implementation requirement. Keep source playback positions and local playback history independent from AniList state. Multiple file versions must not increment progress repeatedly.

AniList cumulative progress does not provide an independent watched/unwatched flag for every episode. Derived episode indicators must be labeled as based on AniList progress, rather than exact local per-episode viewing records. Watching a later episode must not silently imply earlier episodes were watched: noncontiguous completion requires an explicit cumulative-progress decision. The selected automatic policy requires reaching 90 percent of the source timeline or natural source end, plus 30 seconds of normal wall-clock playback in the current session. Seeks, resume restoration, pauses and buffering add no normal time; playback speed does not multiply it. Player manual marks require no telemetry. All entry points report consistent pending, confirmed and failed outcomes; delayed automatic updates must not override explicit manual corrections. Do not introduce a separate authoritative local tracking list or per-episode watched-state store.

### 2.5 Subscriptions and Resource Discovery

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| S01 | Enable or pause RSS discovery from an anime's own page | Complete | — | Download submission separate | 1.0.0 |
| S02 | Set and preserve a subscription starting episode and backlog scope | Complete | — | [Fixed starting scope and activation preview](#delivery-notes-s) | 1.0.0 |
| S03 | Configure RSS and discover releases periodically | Complete | — | [Per-anime RSS and configurable recurring discovery](#delivery-notes-s) | 1.0.0 |
| S04 | Match releases to titles and episodes and explain uncertain matches | Complete | — | Uncertain releases are automatically skipped without review | 1.0.0 |
| S05 | Filter by subtitle language, release group, resolution, codec, and keywords | Complete | — | [Selection profiles for RSS, search and Watching](#delivery-notes-s) | 1.0.0 |
| S06 | Deduplicate and exclude existing files, active downloads, and unwanted episodes | Complete | — | [Exclude duplicate releases, local files and active downloads](#delivery-notes-s) | 1.0.0 |
| S07 | Explain decisions and automatically choose one release per episode | Complete | — | [Automatic release selection with decision explanations](#delivery-notes-s) | 1.0.0 |
| S08 | Coordinate tracking-status changes with subscriptions and explain their effect on existing tasks | Complete | — | [Group-managed automation; manual work stays independent](#delivery-notes-s) | 1.0.0 |
| S10 | Automatically subscribe to anime in AniList Watching | Complete | — | [Opt-in Watching automation with explicit activation scope](#delivery-notes-s) | 1.0.0 |
| S11 | Find a suitable release source without entering an RSS URL for each anime | Complete | — | [Configured-site discovery with pinned sources](#delivery-notes-s) | 1.0.0 |
| S12 | Keep manual and automatic subscription management independent | Complete | — | [Independent manual controls and automatic lifecycle](#delivery-notes-s) | 1.0.6 |
| WI08 | Add a built-in compatibility-first preset for automatic subscription configuration | Complete | Completed | [H.264/VP9 preferred with fallback](#delivery-notes-s) | 1.4.1 |
| WI13 | Combine results from multiple search keywords for unified matching | Complete | Completed | [Merged keyword search results](#merged-keyword-search-results-wi13) | — |
| WI14 | Improve Chinese resource searches using available Chinese titles | Complete | Completed | [Chinese search titles and merged names](#chinese-search-titles-and-merged-names-wi14) | — |

#### Delivery Notes (S)

- **S02:** Fixed starting episode and protection against conflicting edits; global Watching activation previews impact.
- **S03:** One RSS per anime, reliable recurring discovery with a configurable global interval (default 30 minutes).
- **S05:** For RSS, manual search and opt-in Watching: built-in/custom YAML selection profiles.
- **WI08:** The built-in compatibility-first profile accepts H.264/VP9 at 1080p/2160p after 60 minutes, and any codec at those resolutions or 720p after 120 minutes. **Release record:** 1.4.1.
- **S06:** Exclude duplicate releases, available local episodes and already active acquisitions, including across restart.
- **S07:** Profile levels, persisted waiting, seed-count tie-breaking and skipped reasons; manual selection/dismissal outside the simplified scope.
- **S08:** Watching controls automatic subscriptions by current list membership; manual subscriptions and submitted transfers/imports remain independent. **Release record:** 1.0.0; 1.0.6 (independent subscriptions).
- **S09:** **Delivered:** Ordered source discovery. **Remaining:** Searching multiple sources for comparison. **Release record:** 1.0.0 (ordered discovery; partial).
- **S13:** **Delivered:** Profile-based selection and ranking within the current source. **Remaining:** Cross-source comparison. **Release record:** 1.0.0 (single-source selection; partial).
- **S10:** Default-off Watching creation with explicit activation preview, fixed starting scope and recreation exclusions; automatic subscriptions remain group-managed; manual subscriptions take precedence.
- **S11:** Ordered configured-site discovery with Anime identity assessment, S05 profiles, pinned sources and unresolved states.
- **S12:** Tracking status changes and automation disable stop automatic acquisition; manual controls remain independent and completed ranges stop source polling.

The completed subscription scope is [archived](history.md#automatic-acquisition-requirements).
RSS selects candidates automatically without per-release approval; accepted scopes
enable the download worker.
#### Merged Keyword Search Results (WI13)

Subscription discovery and single-episode downloads share collection that searches
all selected title keywords within pagination and item limits, deduplicates releases
by ID and merges results before assessment. Eligible results do not stop collection.
If any keyword request fails, that provider's collection fails without exposing its
partial results for selection. Provider-level errors and coverage information are
sufficient; keyword-level result attribution and feedback are outside the scope.

#### Chinese Search Titles and Merged Names (WI14)

Release assessment prepares up to four ordered search queries from typed metadata
names: romaji, English, native and Chinese. Each category contributes one available
name; missing categories are skipped, Simplified Chinese is preferred over Traditional,
and values are NFKC-normalized, trimmed, length/control-character checked and
deduplicated case-insensitively. Subscription discovery and one-off downloads use these
queries instead of the first four arbitrary aliases. All known titles and aliases remain
available for release-identity assessment. When no Chinese title is available, query
selection retains the existing non-Chinese behavior.

Names are also merged across the supported metadata providers. Optional verification
searches both providers for the same normalized native title, full premiere date, format
and positive episode count, and accepts only a unique match from each provider. Verified
supplemental names are retained as aliases with an optional explicit `searchKind`; they
can contribute romaji, English or Chinese queries but never change project IDs, primary
display titles, other metadata fields, episode mappings or Tracking. The merge is
names-only evidence, not cross-source identity association. It uses bounded
search/detail limits, a five-second deadline and a short-lived in-process cache; stale,
incomplete, ambiguous or failed evidence leaves the source names unchanged. Cached-only
reads never initiate verification.

Existing subscriptions retain their captured search keywords. Creating a subscription
or rediscovering and confirming a source applies the current title-selection rules.

#### AniList Watching to Automatic Acquisition (S05, S10–S12)

The delivered workflow is: add an anime to AniList Watching, let Anishelf find a suitable resource source and maintain its subscription, then automatically download new episodes through qBittorrent and verify their ingestion into the local library. Users configure resource sites, release preferences, destination and automation scope once; routine additions to Watching should not require finding and entering a per-anime RSS URL or approving every episode.

Manual and automatic subscriptions have independent management behavior. Watching is a default-off automatic group with an explicit activation
preview, account binding, a group switch and per-work exclusions. Manual subscriptions
take precedence; saving an automatic subscription in the explicitly labeled work editor
converts it to manual ownership. Manual pause, resume and cancellation remain independent.
Disabling the group, excluding a work or leaving Watching stops automatic discovery,
refresh and new download submissions; submitted transfers/imports continue. List outages
retain records and suspend automatic acquisition until a fresh complete snapshot returns.
The starting episode freezes at creation; progress changes never reset it. Account,
source/profile/target scope changes and late responses must not exceed the user’s
accepted scope. Unsubscribe records automatic-recreation exclusions. Empty or ambiguous source
results retain intent without authorizing guessed downloads.

Both management types complete when every episode in the saved range through a known
total is locally available. Completion preserves records and stops source polling; it does
not follow tracking progress or pending downloads. Explicit resume overrides the completed
range, while a larger metadata total rechecks coverage and may reopen acquisition subject
to the manual pause and automatic group settings. Unknown totals never auto-complete.

Users configure global defaults in Settings and manage individual subscriptions
from work details, with activity, history and diagnostics available on demand. No source-search/resource-sample step is required before
subscribing. The user marked this iteration complete on 2026-10-24. See the
[archived requirements and design](history.md#automatic-acquisition-archive-notes)
and the maintained [UI conventions](development/design-system.md#automatic-acquisition).

Background subscription updates preserve an open editor's inputs and detect conflicting changes before saving.
Check now retries pending discovery without its local scheduling delay. Diagnostics
retains the latest site attempts across restart. Once refreshed detail data includes
local resources, the page automatically opens local episodes and preserves the
library's return filters.

Full season-pack ingestion is not currently supported.

### 2.6 Downloads and Automatic Ingestion

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| D01 | Connect to qBittorrent and validate configuration and download-path mappings | Complete | — | [Private client settings and validated path mapping](#delivery-notes-d) | 1.0.0 |
| D02 | Submit releases, persist task associations, and prevent duplicate submissions | Complete | — | [Durable requests, deduplication and submission recovery](#delivery-notes-d) | 1.0.0 |
| D03 | Display acquisition state, progress and errors | Complete | — | [Detail Activity; transfer details in qBittorrent WebUI](#delivery-notes-d) | 1.0.0 |
| D04 | Manage downloads and recover acquisitions | Complete | — | [WebUI transfer controls; Anishelf acquisition recovery](#delivery-notes-d) | 1.0.0 |
| D05 | Check completed files, scan them, and associate them with episodes | Complete | — | [File verification, association/Review and import retry](#delivery-notes-d) | 1.0.0 |
| D06 | Recover from disconnections, externally removed tasks, and server restarts | Complete | — | [Restart reconciliation and external-removal suppression](#delivery-notes-d) | 1.0.0 |
| D07 | Distinguish task cancellation, downloaded-data deletion, and library-record removal | Complete | — | [Separate WebUI task/data deletion and Catalog actions](#delivery-notes-d) | 1.0.0 |
| D09 | Download an individual episode without creating a subscription | Complete | — | [Single-episode automatic acquisition](#delivery-notes-d) | 1.4.0 |
| D10 | Obtain and display download progress from the download client | Complete | — | [Compact episode progress and scoped task details](#delivery-notes-d) | 1.4.0 |

#### Delivery Notes (D)

- **D01:** Private connection settings, connection test and one root/path mapping with incomplete-directory validation; actual shared visibility verified during import.
- **D02:** Saved acquisition requests, duplicate prevention, per-anime placement and recovery from uncertain submissions.
- **D03:** Compact episode status and scoped task details; real percentage and import states; speed/seeding details in WebUI.
- **D04:** Transfer pause/resume/removal delegated to WebUI; scoped acquisition/import retries in Anishelf.
- **D05:** Safe file verification, library refresh, episode association/Review and independent import retry.
- **D06:** Stale observations, durable bindings, restart reconciliation and external-removal suppression.
- **D07:** Task/data deletion in WebUI, Catalog decisions in existing local workflows; deletion never triggers automatic re-adding.
- **D09:** Missing regular episodes expose a direct Download action. One explicit request uses global release preferences without waiting, persists independently of subscriptions, and follows verified ingestion. Empty or failed discovery requires explicit retry through episode task details.
- **D10:** Episode rows show actual reported download percentages and compact acquisition states. Scoped task details retain verification/import stages, errors and recovery; subscription details retain discovery and configuration diagnostics.

Users manage transfer pause, resume and removal in qBittorrent WebUI. Anishelf
provides acquisition status, recovery and verified library ingestion from work
details. A global download-management page is outside the delivered scope.

#### Individual episode downloads and progress (D09–D10)

Missing regular episodes expose a direct **Download** action.
Accept and persist the request before background discovery. Use the global release
requirements and ranking, bypassing preference waiting periods, to select one
currently available matching release across configured sites. Do not ask users to
choose a publication or create, enable or alter a subscription. Completed discovery
without a usable release stops with an actionable reason and an explicit episode-task
retry; it does not continuously monitor for new publications. Downloads retain the
existing deduplication, submission reconciliation and verified-ingestion workflow.

Local and remote details share an aired-episode timeline. Preserve playable local
files, including specials, but hide other episode placeholders unless metadata or
broadcast records establish that they have aired. Unknown totals use the confirmed
aired range; unknown broadcast progress does not create empty slots.

The separate broadcast-plan panel displays provider-announced future airtimes
first, highlights the next broadcast, and collapses aired history in reverse
chronological order. Detail metadata supplies the next broadcast even when
schedule pagination has not reached it. Show local dates, weekdays and times with
the time zone; never extrapolate unannounced dates. Keep stale plans visible and
mark elapsed plans awaiting confirmation until a post-airtime snapshot arrives.
Stale or failed refreshes preserve confirmed episode rows without advancing them,
and open details refresh at known airtimes. Available local episodes do not show
the acquisition command.

Obtain progress from the download client and keep the displayed information updated
while downloads are active. Show actual reported progress rather than inferring it
from elapsed time or acquisition state. If progress is unavailable or the client
cannot be reached, distinguish unknown or stale information from current progress.
Distinguish a completed transfer from subsequent verification and library ingestion;
a completed download alone does not mean the resource is available in the library.

### 2.7 Desktop and Other Clients

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| C01 | Generate a transferable original-media URL or single-file M3U playlist for manual opening in an external player | Complete | — | [—](#delivery-notes-c) | 0.2.0 |
| C02 | Invoke platform-compatible external players through browser protocol links; manage browser-local custom URL templates in Settings | Complete | — | — | 0.2.1 |

#### Delivery Notes (C)

- **C01:** **Release record:** 0.2.0 (media URL); 0.2.1 (M3U).

Desktop clients should provide library management and acquisition alongside playback;
mobile clients prioritize touch-friendly browsing and playback. Both require an
authenticated server connection for server-backed operations. Cross-client progress
must account for concurrent and delayed updates (W12); native playback integrations
must report progress before they can support reliable continuation (C05). Offline
viewing and advanced playback capabilities are not part of the initial client scope.
A TV application is outside the planned scope.

The proposed implementation and staged validation are in the
[future client design](development/clients.md).

#### External-Player Media Links (C01)

See the [archived V2 requirements and design](history.md#v2-requirements).

### 2.8 External Tracking Services

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| T01 | Authorize AniList, display the connected account, check connectivity, and disconnect | Complete | — | [Account confirmation, private credentials and reconnection](#delivery-notes-t) | 0.4.0 |
| T02 | Read, cache and refresh the connected account's AniList lists and viewing state | Complete | — | [Account-scoped snapshots and unified Library state](#delivery-notes-t) | 0.4.0 |
| T03 | Reuse existing work/episode mappings to submit viewing progress and tracking-status updates to AniList | Complete | — | Manual updates and mapped automatic episode completion | 0.4.0 |
| T04 | Persist pending updates, coalesce superseded updates, retry failures, report expired authorization, and show results | Complete | — | Manual and playback updates retained across failures and restart | 0.4.0 |
| T05 | Detect remote changes before retrying pending updates and resolve conflicts without silently overwriting newer state | Complete | — | [Conflict checks; upstream read/write race remains](#delivery-notes-t) | 0.4.0 |

#### Delivery Notes (T)

- **T01:** Token preview/confirmation, private credentials and safe account reconnection.
- **T02:** Complete account-scoped snapshots, stale/error feedback, unified local/remote Library and viewing-state details.
- **T05:** For manual and playback commands; upstream read/write race remains.

#### AniList Accounts: Delivered Scope

AniList is the viewing-state authority. The delivered scope includes account connection, cached list access, progress/status submissions, durable retries and remote-conflict handling. It reuses existing work/episode mappings and keeps local playback history independent. Independent local tracking, list import/export and reimport merging are excluded.

[Archived AniList accounts requirements](history.md#anilist-accounts-requirements) retain the completed scope and consistency rules. Current implementation ownership is maintained in [Architecture](development/architecture.md).

### 2.9 Interface, Settings, and Maintenance

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| O04 | Unified settings for directories and integrations | Complete | — | [Shared Settings for resources, playback and integrations](#delivery-notes-o) | 1.0.3 |
| O07 | LAN access, single-user authentication, and credential protection | Complete | — | [Password access, protected sessions and media links](#single-user-authentication-o07) | 0.3.3 |
| O08 | In-app completion and failure feedback | Complete | — | Scan result Toasts and preparation results in the floating task monitor | 0.2.0 |
| O11 | Log rotation and retention | Complete | — | Size/time rotation and archive retention; live file reopening excluded | 0.2.6 |
| O12 | Configure diagnostic log output destinations | Complete | — | [stdout, file or both; automatic recovery excluded](#delivery-notes-o) | 0.2.6 |
| O13 | Write diagnostic logs and close output on shutdown | Complete | — | [Diagnostic output closed on normal shutdown](#delivery-notes-o) | 0.2.6 |
| O14 | Interface localization and language preferences | Complete | — | [English/Chinese UI with browser-local language preference](#delivery-notes-o) | 0.2.0 |
| O15 | Keep displayed server data responsive and consistent | Complete | — | — | 0.2.0 |
| O17 | Unified configuration | Complete | — | Consistent defaults and validated user overrides; built-in cache budget | 0.2.0 |
| O18 | User-editable prepared-media cache budget | Complete | — | Settings control, validation and persisted disk-space limit | 0.2.6 |
| O21 | Remote deployment without a repository checkout | Complete | — | [Flag-driven Docker/Podman deployment without checkout](#delivery-notes-o) | 1.0.0 |
| O22 | View the changelog within the application | Complete | Completed | [Offline bundled release notes](#in-app-changelog-o22) | — |
| WI06 | Show qBittorrent and Jackett connection status below section titles | Complete | Completed | [Connection status placement](#connection-status-placement-wi06) | — |

#### Connection Status Placement (WI06)

The qBittorrent and Jackett sources settings cards show their saved connection status
as a badge below the section title. The connection disclosure retains the endpoint and
edit actions without repeating the status line. The badge reflects saved configuration,
not live service availability.

#### In-app Changelog (O22)

Users can open release notes grouped by version in Settings, including the installed
web version and earlier bundled releases. The display identifies the web version and
indicates when its notes are unavailable. The project's changelog is bundled with
the web build and available offline. The existing update check discovers newer releases.

#### Delivery Notes (O)

- **O04:** Shared Settings sections for resource roots, playback/manual and automatic preparation, external players, acquisition services, tracking account, security and About. **Release record:** 1.0.3 (settings scope).
- **O05:** **Delivered:** Durable per-anime acquisition activity, decision reasons, safe correlated logs and terminal-detail retention. **Remaining:** Broader product history. **Release record:** 1.0.0 (acquisition; partial).
- **O07:** Single-password access, persistent sign-in, protected mutations, login limits, local recovery and 24-hour file-specific media links; secure sessions through an HTTPS proxy. **Release record:** 0.3.3; 1.0.1 (secure proxy sessions).
- **O12:** **Delivered:** stdout/file/both routing. **Excluded:** automatic log-output fallback and destination recovery after failure; these are outside the current scope, not planned remainder. **Release record:** 0.2.6; 1.0.0 (simplified).
- **O13:** **Delivered:** diagnostic log output with normal-shutdown closure. **Excluded:** guaranteed bounded buffering and loss accounting; these are outside the current scope, not planned remainder. **Release record:** 0.2.6; 1.0.0 (simplified; partial).
- **O14:** English and Simplified Chinese, browser language detection, language selection and browser-local preference. **Release record:** 0.2.0 (English foundation); 1.2.0 (Simplified Chinese and selection).
- **O19:** Edit and validate supported custom profile files, including acquisition and transcode profiles.
- **O20:** Validate and activate acquisition-profiles.yaml changes without restarting Backend; retain the last valid configuration on reload failure.
- **O21:** Non-interactive flag-driven Docker/Podman deployment, optional services and advanced settings, generated configuration and health feedback. **Release record:** 1.0.0; 1.1.0 (deployment refactor).

#### User-editable Prepared-media Cache Budget (O18)

Allow users to configure and persist a disk-space limit for generated media copies
through Settings. Preserve the choice across upgrades and enforce it for subsequent
preparation. Account for retained in-use copies and distinguish cache exhaustion
from insufficient disk space. Lowering the limit must not silently delete existing
copies; provide explicit cleanup. Preserve originals, history and settings.

#### Unified Configuration (O17)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Interface Localization (O14)

- Introduce translation resources for interface labels, status messages, and user-facing errors, with English as the default and fallback language.
- Allow users to select a supported language and persist that preference.
- Keep API field names, error codes, resource IDs, and original filenames unchanged across languages.

The Web interface supports English and Simplified Chinese. A saved browser-local preference takes precedence; otherwise the browser's preferred languages select a supported language, with English as the fallback. Users can change the language from the header. The completed anime-library iteration separately delivers program metadata (M07): preserve available language-tagged titles, aliases and descriptions, original language and stable IDs, using exact locale, base language, original language and deterministic available-value fallback.

#### Frontend State and Caching (O15)

Keep resource listings, scan status and settings responsive and consistent after
changes. Reuse available data where appropriate while showing loading, refresh and
error feedback. A failed refresh must not present cached data as current. Navigation
and background refresh must not discard local input or disrupt playback. Cache
libraries, keys and invalidation mechanisms belong in
[frontend architecture](development/architecture.md#frontend-ownership).

#### Notification Delivery Boundary (O08)

Provide in-app feedback for scan completion/failure, successful actions and failed
requests. Preparation work exposes progress and completion/failure results. Feedback
must remain discoverable without requiring duplicate notifications for one result.
Presentation follows the [design system](development/design-system.md).

#### Logging Maintenance (O11–O13)

Support stdout, file or simultaneous output with configurable log levels, timestamps,
structured diagnostic context and secret redaction. File output supports rotation
and retention. Failures must produce an actionable diagnostic. Automatic destination
recovery, record fallback and guaranteed loss accounting are outside the current scope.
Library selection, buffering and shutdown behavior belong in
[development logging](development/README.md#logging-choice); configuration and recovery
instructions belong in [Operations](guide/operations.md#operational-log-levels).

#### Single-user authentication (O07)

Authentication is enabled for every deployment. First-time setup provides a random
initial password once, without requiring an immediate change. Existing credentials
are preserved. Invalid credentials or unavailable credential storage fail closed. Users can sign in/out and change the
password with their current password; local CLI or manual credential replacement
provides recovery without Web access. All sessions and media links become invalid
after password change, or after restart for manual edits. Plaintext passwords do
not enter persistent application logging or settings APIs.

Application data and media require authorization, including partial media access.
State-changing actions must be protected against cross-site request forgery. External-player and M3U links authorize only one
original file version for 24 hours and survive restart. Invalid, expired,
wrong-file or changed-source links are rejected. Browser logout/expiry clears
private browser data and exits playback. HTTPS deployment must preserve authentication
for media access. Technical authentication and proxy design belong in
[Architecture](development/architecture.md#authentication-boundary).

#### Embedded fonts (P15)

- **P15 Embedded fonts:** use valid embedded TTF/OTF fonts for ASS/SSA subtitles,
  including external subtitles and playback of prepared copies. Font failures must
  preserve usable subtitles with fallback feedback and retry. Exact missing-font
  diagnosis and broad browser compatibility certification remain unverified.
