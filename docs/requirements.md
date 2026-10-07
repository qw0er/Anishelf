# Anishelf Requirements

- [1. Product Goal and Document Scope](#1-product-goal-and-document-scope)
- [2. Feature Inventory and Version Tracking](#2-feature-inventory-and-version-tracking)
- [3. Rules for Future Features](#3-rules-for-future-features)
- [4. Release Plan and Suggested Evolution](#4-release-plan-and-suggested-evolution)
- [Archived V2 requirements and acceptance](history.md#v2-requirements)

## 1. Product Goal and Document Scope

Anishelf is a personal animation media library intended to connect:

**tracking → resource discovery → downloading → library ingestion → Web / desktop playback → viewing history → external tracker synchronization**.

Its core value is better Web playback, shared client state, and coordination between tracking and automatic downloading.

This document retains the product goal, feature inventory and future evolution. Version-specific V2 requirements, acceptance and detailed design have moved to [History](history.md#v2-archive-notes). The archived acceptance gaps remain open; archiving does not declare V2 fully accepted. No next active release has been assigned.

## 2. Feature Inventory and Version Tracking

- **Implemented in** records the first completed version; `—` means not implemented.
- **Target version** records the selected iteration; `Unassigned` means no release commitment.
- **Later** identifies a subsequent core capability; **Optional** identifies a possible longer-term extension.
- A target version is not evidence of implementation. Mark a requirement implemented only after its acceptance criteria pass. For partial delivery, describe the delivered boundary and keep the remainder explicit.

### 2.0 Delivered V1 Foundation

| ID | Feature | Delivered scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| V01 | Resource directory configuration | Configure and persist one server-accessible root; startup before setup; directory access feedback | V1 | V1 |
| V02 | Library scanning | Automatic scans at startup and after resource-root changes; configurable scheduled scans (60 minutes by default; 0 disables) and manual rescans; recursive video discovery; repeated scans without duplicate paths; additions and removals reflected | V1 | V1 |
| V03 | Resource browsing | Actual directory hierarchy, original filenames, stable natural sorting, and parent navigation | V1 | V1 |
| V04 | Web playback | Browser direct playback through bounded media streams and byte ranges | V1 | V1 |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory | V1 | V1 |
| V06 | Failure feedback | Missing/unreadable resources and unsupported-media or playback errors | V1 | V1 |

V1 includes read-only originals, resource-root confinement, persistent root settings, and visible scan states. Its original acceptance criteria remain in the archived V2 requirements as the regression baseline. Subtitle loading, saved progress, and media preparation are V2 additions.

### 2.1 Resource Access and Library

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| L05 | Search filenames, choose sorting, and filter resources | Later | — | Unassigned |
| L06 | Scheduled scans, filesystem monitoring, and incremental updates | Later | — | Unassigned |
| L07 | Parse anime titles, seasons, episode numbers, and release variants from filenames | Later | — | Unassigned |
| L08 | Review unidentified files and manually link or correct anime and episode associations | Later | — | Unassigned |
| L09 | Distinguish regular episodes, specials, continuous season numbering, and multi-episode files | Later | — | Unassigned |
| L10 | Associate multiple file versions with an episode and select a version for playback | Later | — | Unassigned |
| L11 | Relink moved files while preserving viewing history | Later | — | Unassigned |
| L12 | Configure and manage multiple resource roots | Optional | — | Unassigned |
| L13 | Rename, organize, delete, and reclaim storage with preservation rules | Optional | — | Unassigned |
| L14 | Download an existing original media file from the Web interface to the user's device | Implemented | — | Web |

#### Download Existing Media (L14)

- Provide a download action for an individual library file, preserving its original filename and contents.
- Transfer the existing original file without transcoding or modifying the server copy.
- Apply the same resource-root restrictions and access controls as playback; report missing or unreadable files.
- Initially exclude batch downloads, directory archives, and managed offline libraries.
- Acceptance: the downloaded file matches the source contents and filename, the server original remains unchanged, and unavailable or unauthorized resources cannot be downloaded.

This is a user-facing file download, separate from acquiring new releases through qBittorrent (D01–D08). File actions and the player's More playback options menu provide **Download video**. The action rechecks file access and starts a native browser download from the original-media route with the original filename, without buffering the complete file in JavaScript. Download acquisition through qBittorrent remains unassigned.

### 2.2 Anime Metadata

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| M01 | Search external anime metadata and store provider identifiers | Later | — | Unassigned |
| M02 | Display covers, aliases, descriptions, seasons, episode counts, and airing information | Later | — | Unassigned |
| M03 | Provide anime detail and episode views, organizing the library by title | Later | — | Unassigned |
| M04 | Manually select, correct, and refresh metadata mappings | Later | — | Unassigned |
| M05 | Cache metadata so external outages do not prevent browsing or playback | Later | — | Unassigned |
| M07 | Preserve multilingual program titles, aliases and descriptions with language tags, original language and locale-independent IDs | Contract reserved in V2; metadata implementation later | — | Unassigned |
| M06 | Multiple metadata providers, related works, and cross-provider ID mapping | Optional | — | Unassigned |

### 2.3 Web Playback and Subtitles

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| P03 | Select or disable external VTT/SRT/ASS/SSA subtitles through Vidstack | Later | V2 external discovery, delivery, rendering and selection/off | V2 |
| P05 | Choose a playback strategy based on media and client capabilities | Later | — | V2 |
| P06 | Remux media when only the container is incompatible | Later | — | V2 |
| P07 | FFmpeg full-file pre-transcoding with seeking; copy compatible streams and encode only necessary streams | V2 completed-file workflow | — | V2 |
| P08 | Discover/select subtitles and extract tracks packaged in video files such as MKV | V2: VTT/SRT/ASS/SSA text extraction; fonts and bitmap extraction deferred | — | V2 (partial) |
| P09 | Support ASS/SSA styling and fonts, plus a compatibility path for image subtitles | V2: styled ASS/SSA with fallback fonts; embedded fonts and bitmap handling deferred | — | V2 (partial) |
| P14 | HLS/fMP4 delivery and real-time transcoding, including seeking, leases, source-time mapping and interactive scheduling | Later | — | Unassigned |
| P15 | Extract, validate and load embedded font attachments | Later | — | Unassigned |
| P16 | Extract embedded PGS/VobSub bitmap subtitle assets with explicit unsupported-Web feedback | Later | — | Unassigned |
| P10 | Select audio tracks, adjust subtitle timing, change playback speed, and use shortcuts | Later | — | Unassigned |
| P11 | Next-episode navigation, automatic continuation, and playback preferences | Later | — | Unassigned |
| P12 | Hardware transcoding, HDR handling, broader browser support, and advanced concurrency policies beyond the V2 bounded scheduler | Optional | — | Unassigned |
| P13 | Opening/ending skips and chapter navigation | Optional | — | Unassigned |

#### FFmpeg Full-file Preparation (P05–P07)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Deferred Playback and Subtitle Requirements (P14–P16)

These capabilities are outside V2 and have no assigned release:

- **P14 HLS and real-time playback:** serve completed and live HLS/fMP4 playlists and complete segments; prefer valid completed resources and copy compatible streams. Begin playback before full conversion; support pause/resume and seeking beyond generated ranges by restarting near the requested source time. Map progress and subtitle clocks to source time. Expose starting/streaming/buffering/completed/stopped/failed states and corresponding UI. Stop and clean old processing on exit, expired lease, repeated seeks, source invalidation, failure or shutdown. Bound shared concurrency/storage and prioritize interactive work with explicit interruption/requeue feedback. Preserve history/originals and reject stale generations after restart.
- **P15 Embedded fonts:** extract supported attachments, enforce size limits and safe filenames, validate cached fonts, load them into the styled renderer and provide fallback/missing-font feedback. Acceptance uses styled ASS/SSA and CJK samples with embedded fonts.
- **P16 Bitmap extraction:** extract supported PGS/VobSub in native representation, preserving paired files and access/cache protections; show explicit unsupported-Web feedback. Web rendering, OCR and burn-in remain separately unassigned.

Deferred acceptance retains its existing identifiers:

| ID | Requirements | Scenario and passing result | Acceptance completed in | Target version |
| --- | --- | --- | --- | --- |
| A22 | P14, W01 | Real-time playback begins before full conversion; seek into ungenerated media, pause/resume and reopen preserve source-time position and subtitle alignment; compatible streams are copied | — | Unassigned |
| A23 | P14 | Exit, expired lease, repeated seeks, source changes, failure and restart stop old children and clean incomplete output; preparation yields to playback and can restart; no stale generation is served | — | Unassigned |

#### Configuration and Storage Boundary (V2)

See the [archived V2 requirements and design](history.md#v2-requirements).

### 2.4 Viewing History and Tracking

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| W01 | Save playback position and duration and resume playback | Implemented | V2 | V2 |
| W02 | History page with recent viewing records and resume/replay | Implemented; History covers continue watching | V2 | V2 |
| W03 | Detect completion and manually mark or unmark episodes as watched | Later | — | Unassigned |
| W04 | Manage planned, watching, completed, paused, and dropped statuses | Later | — | Unassigned |
| W05 | Show available unwatched episodes, watched counts, and history | Later | — | Unassigned |
| W06 | Share records across clients and handle duplicate, out-of-order, or concurrent progress updates | Later | — | Unassigned |
| W07 | Rewatch history, ratings, tags, and personal notes | Optional | — | Unassigned |

### 2.5 Subscriptions and Resource Discovery

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| S01 | Enable or pause automatic acquisition from an anime's own page | Later | — | Unassigned |
| S02 | Set the starting episode and backlog scope with an impact preview | Later | — | Unassigned |
| S03 | Configure sources such as RSS and discover releases periodically | Later | — | Unassigned |
| S04 | Match releases to titles and episodes, queuing ambiguous matches for review | Later | — | Unassigned |
| S05 | Filter by subtitle language, release group, resolution, codec, and keywords | Later | — | Unassigned |
| S06 | Deduplicate and exclude existing files, active downloads, and unwanted episodes | Later | — | Unassigned |
| S07 | Explain selection and rejection decisions and allow manual selection or dismissal | Later | — | Unassigned |
| S08 | Coordinate tracking-status changes with subscriptions and explain their effect on existing tasks | Later | — | Unassigned |
| S09 | Search multiple sources, rank releases, process season packs, and upgrade quality | Optional | — | Unassigned |

### 2.6 Downloads and Automatic Ingestion

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| D01 | Connect to qBittorrent and validate configuration and download-path mappings | Later | — | Unassigned |
| D02 | Submit releases, persist task associations, and prevent duplicate submissions | Later | — | Unassigned |
| D03 | Display progress, speed, task status, and errors | Later | — | Unassigned |
| D04 | Pause, resume, cancel, and retry downloads | Later | — | Unassigned |
| D05 | Check completed files, scan them, and associate them with episodes | Later | — | Unassigned |
| D06 | Recover from disconnections, externally removed tasks, and server restarts | Later | — | Unassigned |
| D07 | Distinguish task cancellation, downloaded-data deletion, and library-record removal | Later | — | Unassigned |
| D08 | Multiple download clients, seeding policies, bandwidth schedules, and storage policies | Optional | — | Unassigned |

### 2.7 Desktop and Other Clients

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| C01 | Generate a transferable original-media URL or single-file M3U playlist for manual opening in an external player | Implemented | V2 | V2 |
| C02 | Invoke platform-compatible external players through browser protocol links; manage browser-local custom URL templates in Settings | Implemented; native platform acceptance pending | Current | Current |
| C03 | Read external-player state when the selected integration exposes it, including playing/paused state, position, and playback end | Optional later capability; browser invocation reads no native state | — | Later |
| C04 | Control desktop playback, pause, and seeking from the Web | Later | — | Unassigned |
| C05 | Continue viewing between Web and desktop using saved positions | Later | — | Unassigned |
| C06 | Manage multiple devices and transfer playback sessions | Optional | — | Unassigned |
| C07 | Full desktop, mobile, and TV apps, casting, and offline viewing | Optional | — | Unassigned |

#### External-Player Media Links (C01)

See the [archived V2 requirements and design](history.md#v2-requirements).

### 2.8 External Tracking Services

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| T01 | Authorize AniList, check connectivity, and disconnect | Later | — | Unassigned |
| T02 | Import selected tracked titles without implicitly enabling downloads | Later | — | Unassigned |
| T03 | Map titles and episode numbering and synchronize progress and tracking status | Later | — | Unassigned |
| T04 | Queue synchronization, retry failures, report expired authorization, and show results | Later | — | Unassigned |
| T05 | Preview reimport differences and resolve conflicts | Later | — | Unassigned |
| T06 | Automatic bidirectional synchronization, multiple trackers, and rating synchronization | Optional | — | Unassigned |

### 2.9 Interface, Settings, and Maintenance

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| O03 | Dashboard for continued viewing, new episodes, downloads, and exceptions | Later | — | Unassigned |
| O04 | Unified settings for directories, playback preferences, and integrations | Later | — | Unassigned |
| O05 | Task history, logs, and automation decision explanations | Later | — | Unassigned |
| O06 | Back up and restore metadata, viewing history, and configuration | Later | — | Unassigned |
| O07 | LAN access, single-user authentication, and credential protection | Later | — | Unassigned |
| O08 | Completion and failure notifications with notification preferences | Later | — | Unassigned |
| O09 | Multiple users, permissions, public deployment support, and remote access | Optional | — | Unassigned |
| O10 | Plugin extensions and public integration APIs | Optional | — | Unassigned |
| O11 | Log rotation, retention, and reopening files without restarting the application | Later | — | Unassigned |
| O12 | Automatic log-output fallback after destination failure | Later | — | Unassigned |
| O13 | Asynchronous log output with bounded buffering and shutdown flushing | Later | — | Unassigned |
| O14 | Interface localization and language preferences | V2 English catalog/keys/fallback foundation; additional locales and selection later | — | V2 (partial) |
| O15 | Manage API-backed frontend state and caching with TanStack Query | Later | — | Unassigned |
| O16 | Complete everyday-use Web interface | Finished UI for V2 library, History, primary Web playback, full-file preparation tasks, and scoped settings | — | V2 |
| O17 | Unified configuration | TypeScript policy defaults, validated user overrides and typed access; built-in cache budget | V2 implementation; acceptance pending | V2 |
| O18 | User-editable prepared-media cache budget | Later; Settings control, validation and persisted disk-space limit | — | Unassigned |

#### User-editable Prepared-media Cache Budget (O18, Later)

Allow users to configure the total disk-space limit for generated prepared-media copies through Settings. Validate and persist the explicit choice, preserve it across upgrades and enforce it for future preparation output. Account for retained in-use artifacts, distinguish cache exhaustion from insufficient disk space and preserve originals, history and settings. Lowering the limit must not silently delete existing copies; show exhaustion and allow explicit cleanup. V2 retains its built-in budget and manual prepared-copy deletion. This feature has no assigned release.

#### Unified Configuration (O17)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Complete Web Interface (O16)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Interface Localization (O14)

- Introduce translation resources for interface labels, status messages, and user-facing errors, with English as the default and fallback language.
- Allow users to select a supported language and persist that preference.
- Keep API field names, error codes, resource IDs, and original filenames unchanged across languages.
- Acceptance: changing the language updates supported interface text and error feedback; missing translations fall back to English; browsing and playback state remain intact.

V1 remains English-only as implemented. V2 reserves multilingual support with an English message catalog, stable keys and fallback; additional language packs and a language selector remain unassigned. Future program metadata (M07) stores language-tagged titles, aliases and descriptions with original language and stable IDs, using exact locale, base language, original language and deterministic available-value fallback. This contract does not add metadata features to V2.

#### Frontend State and Caching (O15)

- Use TanStack Query to manage API-backed server state in the Web interface, including resource listings, scan status, and saved settings.
- Define stable query keys and suitable freshness and retention policies for each kind of data. Reuse fresh results and deduplicate concurrent requests for the same data.
- After a successful scan or settings change, update or invalidate the affected queries so subsequent views reflect the server's latest state.
- Keep loading, refresh, and error feedback visible; a failed refresh must not silently present cached data as current.
- Limit this cache to API-backed data. Media playback streams and local-only interface or player state are outside its scope.
- Acceptance: revisiting a still-fresh resource listing reuses cached data; concurrent requests for the same listing do not trigger duplicate fetches; a completed scan or settings change is reflected on the next affected view; and a refresh failure is distinguishable from a successful current result.

This frontend caching improvement remains unassigned beyond V2. It does not require the V1 interface to use TanStack Query.

#### Logging Maintenance (O11–O13)

- O11: Define rotation and retention policies using external deployment tooling or a suitable Pino transport. If rotation renames the active file, support reopening the configured path and a deployment trigger such as a Unix signal.
- O12: Switch subsequent log records to a fallback destination after runtime output failure. Specify buffered-record loss, failure reporting, and whether/how the original destination is restored; cover errors handled internally by Pino as well as emitted stream errors.
- O13: Introduce asynchronous Pino output when measured log volume or write latency affects application responsiveness. Bound buffered memory, define backpressure or overflow behavior, and flush pending records within a bounded shutdown period.
- Acceptance: asynchronous output avoids synchronous destination writes on the application path, buffers remain bounded under a slow destination, and normal shutdown writes pending records; timeout or overflow reports any potential record loss.
- Acceptance: rotation directs subsequent logs to the new file without restarting the application; destination failure triggers the defined fallback without replacing existing business-module loggers.

The implemented V1 release uses one fixed stdout or file destination; V2 retains that boundary. It supports configured levels and synchronous writes through a process-lifetime logger. Asynchronous logging, rotation, reopening, signal handling, and automatic destination switching are outside the current release.

## 3. Rules for Future Features

These rules apply to the relevant capabilities as they are implemented. V2 applies them to progress updates, subtitle access, and media preparation; unassigned systems do not become V2 dependencies.

- **Keep states separate:** tracking, subscriptions, downloads, file availability, and viewing status are independent. Deleting a watched file must not erase its history.
- **Verify ingestion:** download completion alone does not prove that a file exists or is playable.
- **Make subscription scope explicit:** show the starting episode and backlog range. Importing a list must not silently start bulk downloads.
- **Allow uncertainty:** uncertain title or episode matches require review rather than forced association.
- **Recover without duplication:** polling, retries, and restarts must not create duplicate active downloads.
- **Protect original files:** cancellation and deletion are distinct. Moving files must account for seeding and path associations.
- **Save local records first:** external synchronization failures must not block playback; retry later.
- **Avoid inflated progress:** keep per-episode records separate from external cumulative progress. Watching a later episode must not imply all earlier episodes were watched.
- **Reject stale events:** delayed player updates must not overwrite newer progress or manual corrections.
- **Validate compatibility:** browser, codec, subtitle, and hardware support must be demonstrated with real media samples.

## 4. Release Plan and Suggested Evolution

V1 is implemented. The archived V2 scope selected saved progress and resume (W01), History (W02), external/styled subtitles and embedded extraction (P03 and partial P08/P09), FFmpeg pre-transcoding (P05–P07), transferable external-player media links (C01), and a complete everyday-use Web interface (O16). Web playback remains the primary path. C02 now provides platform-filtered browser invocation and browser-local custom players; C03 native state reading remains a later requirement; other unselected items remain unassigned. Automatic next-episode playback is not part of V2.

| Stage | Question to resolve | Priority candidates |
| --- | --- | --- |
| Later: everyday viewing | Can the product support regular viewing comfortably? | HLS and real-time playback, embedded fonts and bitmap extraction; next episode remains unassigned |
| Later: anime library | Can files be organized into anime titles and episodes? | Metadata, identification, manual corrections, episodes, and tracking records |
| Later: automatic acquisition | Can new episodes reach the library automatically? | Subscriptions, discovery, download integration, ingestion, and recovery |
| Later: external tracking | Can Web viewing records integrate with trackers? | AniList synchronization; possible future read-only native-player state reporting (C03) |

These later stages are not fixed releases or mandatory ordering. For example, desktop integration can move ahead once viewing records are stable if it becomes the most pressing need. Select one independently verifiable user workflow at a time instead of assigning the entire inventory to a single release.
