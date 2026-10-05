# Anishelf Requirements

- [1. Product Goal and Document Scope](#1-product-goal-and-document-scope)
- [2. Feature Inventory and Version Tracking](#2-feature-inventory-and-version-tracking)
- [3. Rules for Future Features](#3-rules-for-future-features)
- [4. Release Plan and Suggested Evolution](#4-release-plan-and-suggested-evolution)
- [Current Release Scope and Acceptance](#current-release-scope-and-acceptance)

## 1. Product Goal and Document Scope

Anishelf is a personal animation media library intended to connect:

**tracking → resource discovery → downloading → library ingestion → Web / desktop playback → viewing history → external tracker synchronization**.

Its core value is better Web playback, shared client state, and coordination between tracking and automatic downloading.

This document is the complete product requirements inventory, including delivered features, the active iteration, and unassigned future capabilities. The [current release scope and acceptance](#current-release-scope-and-acceptance) below is the living release plan, currently for V2. Requirements remain in this inventory when selected for a release; update the inventory and active release sections together rather than moving or deleting requirements.

**Latest completed version: V1. Active version: V2, in progress.** V1 completion and manual browser acceptance are user-reported. The direct-playback Vidstack adapter and saved progress are implemented; external subtitle discovery, delivery and rendering, plus embedded text-subtitle discovery and selected-track preparation/delivery, are implemented. Both subtitle origins use one backend preparation contract and one frontend selection flow; embedded fonts, bitmap extraction and the remaining V2 workflows are unfinished. Replacing the player controls does not complete V2 acceptance.

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

V1 includes read-only originals, resource-root confinement, persistent root settings, and visible scan states. Its original acceptance criteria remain in the active release section below as the regression baseline. Subtitle loading, saved progress, and media preparation are V2 additions.

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
| L14 | Download an existing original media file from the Web interface to the user's device | Later | — | Unassigned |

#### Download Existing Media (L14)

- Provide a download action for an individual library file, preserving its original filename and contents.
- Transfer the existing original file without transcoding or modifying the server copy.
- Apply the same resource-root restrictions and access controls as playback; report missing or unreadable files.
- Initially exclude batch downloads, directory archives, and managed offline libraries.
- Acceptance: the downloaded file matches the source contents and filename, the server original remains unchanged, and unavailable or unauthorized resources cannot be downloaded.

This is a user-facing file download, separate from acquiring new releases through qBittorrent (D01–D08). Both capabilities remain unassigned. The implemented V1 release serves media bytes for playback but does not provide a dedicated download action; V2 does not add that action.

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
| P07 | FFmpeg pre-transcoding and real-time transcoding with seeking; copy compatible streams and encode only necessary streams | Later | — | V2 |
| P08 | Discover/select subtitles and extract tracks packaged in video files such as MKV | V2: VTT/SRT/ASS/SSA and fonts; supported bitmap extraction, other codecs unassigned | — | V2 (partial) |
| P09 | Support ASS/SSA styling and fonts, plus a compatibility path for image subtitles | V2: styled ASS/SSA and fonts; bitmap Web rendering remains unassigned | — | V2 (partial) |
| P10 | Select audio tracks, adjust subtitle timing, change playback speed, and use shortcuts | Later | — | Unassigned |
| P11 | Next-episode navigation, automatic continuation, and playback preferences | Later | — | Unassigned |
| P12 | Hardware transcoding, HDR handling, broader browser support, and advanced concurrency policies beyond the V2 bounded scheduler | Optional | — | Unassigned |
| P13 | Opening/ending skips and chapter navigation | Optional | — | Unassigned |

#### FFmpeg Pre-transcoding and Real-time Transcoding (P05–P07)

V2 implements both **Prepare for Web → wait for a reusable completed copy → play** and **Watch → transcode only as needed while playback proceeds**. Web playback remains primary. The target Web strategy uses HLS/fMP4 for completed and real-time resources: prefer an existing valid completed HLS resource, then necessary on-demand packaging or transcoding. Compatible streams are copied. Preserve the original `GET/HEAD /api/media/:id` Range route for external players. The HLS model/planning foundation is implemented; Web HLS delivery and real-time acquisition remain pending, so current Web playback still uses originals and completed file copies. A user may choose direct-only or preparation-first behavior; pre-transcoding the library is never automatic.

| Source and target compatibility | Required processing |
| --- | --- |
| Source streams compatible with HLS delivery | Package as HLS with compatible streams copied; no audio/video encoding |
| Only delivery container unsupported | Remux with compatible audio/video copied |
| Audio alone unsupported | Copy video; encode audio only |
| Video unsupported | Encode video; copy audio if compatible, otherwise encode audio |
| Subtitle needs extraction or text-format conversion | Process only subtitle; keep compatible audio/video untouched |

- Use FFprobe inspection and validated browser/delivery capabilities, not filename extensions alone. Report the processing mode and per-stream reason. Copy compatible streams in both pre-transcoding and real-time paths.
- Pre-transcoding produces a reusable completed Web-compatible file, with seeking, deduplicated work, queued/processing/ready/failed/cancelled feedback, retry and cache deletion. Partial MP4 output must never be exposed as a ready file.
- Real-time playback begins from complete playable segments before the entire file is processed. Show starting, streaming/buffering, completed, stopped and failed states. Do not expose partially written segments.
- Support real-time pause/resume and seeking beyond the already generated range by restarting processing near the requested source position. Preserve source-time progress and subtitle synchronization; do not make the user wait for processing from the beginning.
- Share source history across original, prepared and real-time playback. Validate source version and profile before reuse; changed or unavailable originals invalidate derived playback.
- Bound total processing concurrency and cache storage. Give interactive playback priority over background preparation with explicit interruption/requeue feedback. Report insufficient compute/storage rather than claiming all inputs transcode at real-time speed.
- Stop/reclaim real-time processing on player exit, expired client lease, source invalidation, failure or shutdown. After restart, interrupted sessions cannot appear streaming or ready; reopening uses saved progress. Interrupted pre-transcodes remain retryable.
- Preserve original media and durable history when cancelling jobs, deleting/evicting cached assets or cleaning incomplete outputs. No multi-resolution ladder, hardware encoding, HDR guarantee, or automatic whole-library preparation is required in V2.

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

- Support external WebVTT, SRT, ASS and SSA with Vidstack and a dedicated ASS/SSA renderer. Preserve ASS/SSA styling, positioning and fonts within the validated renderer capability; do not silently strip styling by converting every track to plain WebVTT.
- Discover same-directory matching filenames and language suffixes. Show multiple/ambiguous candidates for selection. Provide track selection and off controls; show language, title, format and unsupported status where available.
- Use FFprobe to enumerate subtitles packaged inside video containers, including MKV, and FFmpeg to extract a selected supported track to an independent cached subtitle asset. Extract embedded WebVTT, SubRip/SRT, ASS/SSA and associated supported font attachments. No audio/video transcode is required solely for extraction.
- Identify and extract supported embedded PGS/VobSub bitmap tracks in their native representation; clearly state that their Web rendering, OCR and burn-in remain unassigned. Other extraction codecs remain unsupported with feedback; P08 remains partial.
- Apply the same playback path to external and extracted text subtitles. Keep cue timing and styled overlays aligned on original, pre-transcoded and real-time media, including resume and seeks that restart transcoding at an offset.
- Keep originals read-only; store extracted/converted assets separately. Enforce root confinement, regular-file checks, asset/attachment size limits and cache invalidation. Do not trust embedded attachment filenames as paths.
- Malformed, missing, unreadable, unsupported or unrenderable subtitles show useful errors without blocking video. Missing fonts show a fallback warning. P09 delivers styled ASS/SSA and fonts in V2; bitmap rendering remains outside V2.

#### Configuration and Storage Boundary (V2)

FFmpeg/FFprobe executable paths are optional startup overrides; otherwise find each executable through the server process PATH. Define media-format, transcode, subtitle and runtime defaults in TypeScript; bundle the English catalog as a read-only resource. Keep user choices and explicit overrides in `settings.json`; combine them through one validated typed configuration service (O17). V2 selects SQLite with Drizzle ORM for history, source identity, jobs and cache metadata, while generated media/subtitles/fonts remain separate files. Durable records are not disposable cache. These choices are planned, not implemented.

### 2.4 Viewing History and Tracking

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| W01 | Save playback position and duration and resume playback | Later | — | V2 |
| W02 | Continue-watching and recently watched lists | Later | — | V2 |
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
| C01 | Generate a transferable original-media URL for manual opening in an external player | Implemented | V2 | V2 |
| C02 | Invoke an external player from the browser/OS through a registered protocol or equivalent integration | Later | — | Later |
| C03 | Read external-player state when the selected integration exposes it, including playing/paused state, position, and playback end | Optional later capability; V2 only generates a transferable media link and reads no native state | — | Later |
| C04 | Control desktop playback, pause, and seeking from the Web | Later | — | Unassigned |
| C05 | Continue viewing between Web and desktop using saved positions | Later | — | Unassigned |
| C06 | Manage multiple devices and transfer playback sessions | Optional | — | Unassigned |
| C07 | Full desktop, mobile, and TV apps, casting, and offline viewing | Optional | — | Unassigned |

#### External-Player Media Links (C01)

V2 supports generating and copying an origin-aware original-media URL for the user to paste manually into an external player. The player fetches the media directly over HTTP/Range, including through SSH forwarding. V2 does not select or launch a player, register protocols, or report playback state. External-player state reading remains a later optional requirement (C03); browser/OS invocation is separately deferred as C02. External playback never updates Web history. See the active release acceptance section below.

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
| O16 | Complete everyday-use Web interface | Finished UI for V2 library, continue watching, primary Web playback, pre-transcode/real-time tasks, and scoped settings | — | V2 |
| O17 | Unified configuration | TypeScript policy defaults, validated user overrides and typed access | V2 (partial) | V2 |

#### Unified Configuration (O17)

Implemented foundation: unified startup/settings composition, immutable typed policy views for current scanning, playback, subtitles, media tools, HTTP and database behavior, and a safe read-only client configuration API. The [transcode profile foundation](transcode-profiles.md) provides built-in and external preparation profiles, a catalog API and persistent default selection. Profile execution, user-facing selection controls, generated-cache budgets and profile-content invalidation remain planned.

Use environment variables for startup options. Define container/MIME capabilities, transcode profiles, subtitle handling and resource limits/timers in TypeScript; bundle English messages as a read-only resource. Save user choices and any exposed custom profile overrides in `settings.json`. Merge only explicit user values with current defaults, validate the effective result and write settings atomically. Unset choices adopt new defaults on update; explicit choices remain. Cache keys include effective profile content. Configuration cannot bypass access checks or create unsupported codec/delivery capabilities. See the current design for ownership and upgrade rules.

#### Complete Web Interface (O16)

V2 replaces the basic V1 validation pages with a finished, API-backed interface for everyday use. Deliver consistent visual hierarchy and navigation for the file library, continue watching, Web player, preparation tasks, and V2 settings. Web playback is the primary action; copying an external-player link is secondary and optional. Include designed setup/loading/empty/refresh/error states, useful scan/preparation feedback, preserved navigation context, responsive desktop/mobile layouts, and accessible keyboard controls. Validate at 1280 px and 390 px widths with long and Chinese filenames. No placeholder data or nonfunctional feature controls count as delivery. Scope settings and task presentation to implemented V2 capabilities; broader dashboards and integrations remain under O03–O05. Detailed workflows and acceptance criteria are in the active release section below.

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

V1 is implemented. V2 selects saved progress and resume (W01), continue watching (W02), external/styled subtitles and embedded extraction (P03 and partial P08/P09), FFmpeg pre-transcoding and real-time transcoding (P05–P07), transferable external-player media links (C01), and a complete everyday-use Web interface (O16). Web playback remains the primary path. C02 browser invocation and C03 native state reading are later requirements; other unselected items remain unassigned. Automatic next-episode playback is not part of V2.

| Stage | Question to resolve | Priority candidates |
| --- | --- | --- |
| Later: everyday viewing | Can the product support regular viewing comfortably? | Pre-transcoding and real-time playback, external/embedded subtitles, saved progress and resume; next episode remains unassigned |
| Later: anime library | Can files be organized into anime titles and episodes? | Metadata, identification, manual corrections, episodes, and tracking records |
| Later: automatic acquisition | Can new episodes reach the library automatically? | Subscriptions, discovery, download integration, ingestion, and recovery |
| Later: external tracking | Can Web viewing records integrate with trackers? | AniList synchronization; possible future read-only native-player state reporting (C03) |

These later stages are not fixed releases or mandatory ordering. For example, desktop integration can move ahead once viewing records are stable if it becomes the most pressing need. Select one independently verifiable user workflow at a time instead of assigning the entire inventory to a single release.

## Current Release Scope and Acceptance

**V1 is implemented; V2 is in progress.** V1 manual browser acceptance is user-reported.
The direct-playback Vidstack adapter is implemented and checked with a temporary
H.264 sample. Saved progress, playback history/resume, and same-directory external
subtitle discovery, version-checked delivery, selection and rendering are implemented.
The FFmpeg/FFprobe utility layer supports media inspection and selected text-subtitle
extraction. `SubtitleApplication` integrates embedded-track discovery into the subtitle
list API with codec/support metadata and nonfatal probe warnings. Selected embedded
text-track extraction, persisted assets, restart reuse, version-checked delivery and
CC-menu preparation/retry are implemented. External and embedded tracks now share
a public descriptor and selected-track preparation contract; the backend returns
a ready original URL for external subtitles or prepares/reuses an embedded asset.
The frontend uses one controller without source-specific branches. Embedded fonts, bitmap extraction,
playback preparation, and the other
unfinished requirements below remain part of the current V2 scope.

Startup options use defaults and environment variables. `ANISHELF_DATA_DIR` overrides the platform-specific user data directory selected by `platformdirs`. The [current design](architecture.md) specifies the V2 architecture.

### 1. Goal and Operating Scope

Extend the existing file browser into an everyday Web viewing workflow:

**configure a resource directory → scan automatically at startup and after root changes, or manually → select a file → play directly, use a prepared copy, or transcode in real time as needed → select subtitles → watch → save progress → return and resume**, with an option to generate and copy a media link for opening manually in an external player.

- Web playback is the default and primary experience. Selecting a file or a playback-history entry opens the Web player. Generating a transferable media link is a secondary action for manual use in an external player.
- Personal use, one server, one resource root with nested directories, and one active playback session.
- Keep original media read-only. Store viewing records, extracted/converted subtitles, and prepared copies separately from the resource root.
- Retain local/loopback operation and the existing deployment boundary.
- Use English for UI, user-facing messages, and documentation; preserve original filenames.
- Choose and record the target desktop browser/version and representative real media samples for V2 acceptance. File extensions alone do not prove compatibility.
- Continue using directories and files as organizational and playback units. Anime identification and episode associations are not prerequisites.

### 2. Requirements and Implementation Versions

| ID | Requirement | Iteration scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| V01 | Resource directory configuration | Configure and persist one root; allow startup before setup; expose existence/readability errors | V1 | V1 |
| V02 | Library scanning | Automatically scan at startup and after resource-root changes; allow configurable scheduled scans (60 minutes by default; 0 disables) and manual rescans; recursively discover supported video extensions; avoid duplicate paths; reflect additions/removals | V1 | V1 |
| V03 | Resource browsing | Actual hierarchy, original names, stable natural sorting, and parent navigation | V1 | V1 |
| V04 | Web playback | Stream original compatible files without downloading the whole file first; support seeking | V1 | V1 |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory | V1 | V1 |
| V06 | Failure feedback | Distinguish missing/unreadable resources and unsupported media or playback failures | V1 | V1 |
| W01 | Saved progress and resume | Persist position, duration, and last viewing time on the server; restore position when reopening a file | V2 | V2 |
| W02 | Playback history and continue watching | List recent available files with saved progress; resume unfinished files and reopen completed files | V2 | V2 |
| P03 | External subtitles | Vidstack VTT/SRT/ASS/SSA discovery, selection and off | V2 | V2 |
| P08 | Embedded subtitle extraction | FFmpeg extraction from MKV/other containers; supported text tracks, fonts and bitmap assets | V2 (partial) | V2 (partial) |
| P09 | Styled subtitles and fonts | ASS/SSA rendering and extracted fonts; provide clear feedback for unsupported Web rendering | V2 (partial) | V2 (partial) |
| P05 | Playback strategy | Use original compatible media; choose the required preparation path for the target browser | — | V2 |
| P06 | Container-only preparation | Remux compatible audio/video when only the container is incompatible | — | V2 |
| P07 | FFmpeg pre-transcoding and real-time transcoding | Necessary streams only; reusable completed copies or segmented playback during processing; seeking, cleanup and recovery | — | V2 |
| C01 | External-player media link | Generate and copy a client-reachable original-media URL for the user to paste into a player | V2 | V2 |
| O14 | English UI foundation | English message catalog, stable keys and fallback | V2 (partial) | V2 (partial) |
| O17 | Unified configuration | TypeScript policy defaults, validated user overrides and typed access | V2 (partial) | V2 |
| O16 | Complete everyday-use Web interface | Finished application navigation, resource browsing, playback history/resume, Web player, preparation feedback, and V2 settings with responsive and accessible states | V2 (partial) | V2 |

#### Saved Progress, Resume, and Playback History (W01, W02)

- Save playback position, duration, and last viewing time to the server during playback at a bounded interval and on pause, seek completion, and normal player exit. Periodic saves bound progress loss when a tab closes unexpectedly.
- Restore the saved position after media metadata is available; clamp it to the playable duration. Seeking to zero uses the ordinary progress-save flow. Resume must not depend on audible autoplay being allowed.
- Show save/load failures and allow retry without blocking playback. A failed load must not silently overwrite an existing record with an initial zero position.
- Reject delayed or duplicate updates that would overwrite a newer accepted update. Seeking backward intentionally must remain possible; choosing the greatest position is not a valid conflict policy.
- Scope records to the resource root and source identity/version so switching roots or replacing content at the same path cannot apply unrelated progress. Unchanged files retain progress across rescans and server restarts.
- Removing a file from the index does not erase its viewing record. Missing or replaced resources are excluded from actionable history entries.
- Playback history is ordered by last viewing time and includes available files with saved progress, including completed files and records saved at position zero. Each entry can reopen the file with its original directory context; unfinished files resume from their saved position.
- The History page shows up to 100 recent files with saved position, known duration, and last viewing time. It provides refresh, empty, loading, and unavailable-history states.
- Original, prepared and real-time playback of the same source share a viewing record; HLS segment-relative timestamps map back to source time.

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

- Support external WebVTT, SRT, ASS and SSA with Vidstack and a dedicated ASS/SSA renderer. Preserve ASS/SSA styling, positioning and fonts within the validated renderer capability; do not silently strip styling by converting every track to plain WebVTT.
- Discover same-directory matching filenames and language suffixes. Show multiple/ambiguous candidates for selection. Provide track selection and off controls; show language, title, format and unsupported status where available.
- Use FFprobe to enumerate subtitles packaged inside video containers, including MKV, and FFmpeg to extract a selected supported track to an independent cached subtitle asset. Extract embedded WebVTT, SubRip/SRT, ASS/SSA and associated supported font attachments. No audio/video transcode is required solely for extraction.
- Identify and extract supported embedded PGS/VobSub bitmap tracks in their native representation; report clearly when a track cannot be rendered in the Web player. Unsupported extraction codecs produce feedback; P08 remains partial.
- Apply the same playback path to external and extracted text subtitles. Keep cue timing and styled overlays aligned on original, pre-transcoded and real-time media, including resume and seeks that restart transcoding at an offset.
- Keep originals read-only; store extracted/converted assets separately. Enforce root confinement, regular-file checks, asset/attachment size limits and cache invalidation. Do not trust embedded attachment filenames as paths.
- Malformed, missing, unreadable, unsupported or unrenderable subtitles show useful errors without blocking video. Missing fonts show a fallback warning. P09 covers styled ASS/SSA and supported fonts; bitmap tracks report Web-rendering limitations.

#### FFmpeg Pre-transcoding and Real-time Transcoding (P05–P07)

V2 implements both **Prepare for Web → wait for a reusable completed copy → play** and **Watch → transcode only as needed while playback proceeds**. Web playback remains primary. The target Web strategy uses HLS/fMP4 for completed and real-time resources: prefer an existing valid completed HLS resource, then necessary on-demand packaging or transcoding. Compatible streams are copied. Preserve the original `GET/HEAD /api/media/:id` Range route for external players. The HLS model/planning foundation is implemented; Web HLS delivery and real-time acquisition remain pending, so current Web playback still uses originals and completed file copies. A user may choose direct-only or preparation-first behavior; pre-transcoding the library is never automatic.

| Source and target compatibility | Required processing |
| --- | --- |
| Source streams compatible with HLS delivery | Package as HLS with compatible streams copied; no audio/video encoding |
| Only delivery container unsupported | Remux with compatible audio/video copied |
| Audio alone unsupported | Copy video; encode audio only |
| Video unsupported | Encode video; copy audio if compatible, otherwise encode audio |
| Subtitle needs extraction or text-format conversion | Process only subtitle; keep compatible audio/video untouched |

- Use FFprobe inspection and validated browser/delivery capabilities, not filename extensions alone. Report the processing mode and per-stream reason. Copy compatible streams in both pre-transcoding and real-time paths.
- Pre-transcoding produces a reusable completed Web-compatible file, with seeking, deduplicated work, queued/processing/ready/failed/cancelled feedback, retry and cache deletion. Partial MP4 output must never be exposed as a ready file.
- Real-time playback begins from complete playable segments before the entire file is processed. Show starting, streaming/buffering, completed, stopped and failed states. Do not expose partially written segments.
- Support real-time pause/resume and seeking beyond the already generated range by restarting processing near the requested source position. Preserve source-time progress and subtitle synchronization; do not make the user wait for processing from the beginning.
- Share source history across original, prepared and real-time playback. Validate source version and profile before reuse; changed or unavailable originals invalidate derived playback.
- Bound total processing concurrency and cache storage. Give interactive playback priority over background preparation with explicit interruption/requeue feedback. Report insufficient compute/storage rather than claiming all inputs transcode at real-time speed.
- Stop/reclaim real-time processing on player exit, expired client lease, source invalidation, failure or shutdown. After restart, interrupted sessions cannot appear streaming or ready; reopening uses saved progress. Interrupted pre-transcodes remain retryable.
- Preserve original media and durable history when cancelling jobs, deleting/evicting cached assets or cleaning incomplete outputs. No multi-resolution ladder, hardware encoding, HDR guarantee, or automatic whole-library preparation is required in V2.

#### External-Player Media Link (C01)

V2 offers a secondary **Copy media link** action for users who want to open the file manually in an external player. Web playback remains the primary workflow.

- Resolve the selected file through the existing API and recheck its accessibility. Generate a client-reachable absolute URL from the relative original-media route and the browser's application origin, including an SSH-forwarded origin. Never expose server filesystem paths or internal hostnames.
- Copy the URL to the clipboard and display it in a selectable field if clipboard access is unavailable. The user pastes it into the external player's Open URL command. The external player fetches media directly over HTTP/Range; the browser does not relay media bytes.
- Do not choose a player, register a protocol, open another application, or claim that playback started. Validate link formation with spaces, Unicode, percent signs, ampersands, and forwarded origins.
- External playback is **playback only**. It does not read or synchronize position, pause, completion or watched state; it does not update Web history or transfer saved position. The copy-link action does not require an Anishelf bridge.
- Web playback remains usable regardless of whether the user opens the copied link.

#### Configuration and Multilingual Foundation (O17, Partial O14)

The current-function configuration foundation is implemented: one `ConfigurationService` validates built-in policy and explicit settings, supplies immutable snapshots, and preserves atomic writes. The Web build defines local playback/renderer policy and imports browser-safe shared constraints; no client-configuration endpoint is required. Transcode profiles, cache budgets and profile-content cache invalidation remain planned until the corresponding V2 features exist.

- Use environment variables for startup options. Define media-format capabilities, subtitle support and limits, runtime defaults and built-in transcode profiles in TypeScript. Bundle the English catalog as a read-only resource. Do not copy these defaults into persistent policy files.
- Store only user choices in `settings.json`: resource root, Web playback mode, cache budget and selected profile IDs. Save custom profile definitions or parameter overrides only if V2 exposes editing them. Merge explicit user values with the current built-in defaults, validate the result and write settings atomically. Missing fields receive current defaults; explicit choices survive upgrades. Reject invalid settings with actionable diagnostics.
- Application modules consume one validated typed configuration view. Profile-content changes invalidate cached outputs. Configuration cannot bypass access checks or create unsupported browser, renderer or FFmpeg capabilities. Expose only safe client preferences and capabilities through the API.
- Use stable UI/error keys, a separate English catalog and English fallback. Ship English UI and preserve original filenames.

### 3. Complete Web Interface (O16)

Replace the basic V1 validation pages with a finished interface for everyday use. This is a V2 deliverable with real API-backed behavior, not a static mockup. Keep Web viewing prominent throughout the application.

| Area | Required experience |
| --- | --- |
| Application shell | Consistent navigation between Library, preparation tasks, and Settings; clear current location, page titles, and back navigation |
| Library | Clear directory/file presentation, breadcrumbs, parent navigation, readable original filenames including long/Chinese names, scan action/status, and access to playback history with progress and resume actions |
| Web player | Video as the main focus; Vidstack play/pause/seek/volume/fullscreen controls; subtitle selection/off, saved progress/resume, direct/prepared/real-time status and processing reason, and return to the original directory |
| Preparation tasks | Reachable pre-transcode queued/processing/ready/failed/cancelled and real-time starting/streaming/stopped states, affected filename, available progress feedback, failure reason/retry/cancel, real-time stop, and prepared-copy deletion; ready copies link to Web playback |
| Settings | Clearly grouped resource-directory configuration, Web playback mode, cache budget, and supported playback/configuration options; expose only settings supported by V2 |
| External-player link | Secondary **Copy media link** action with a selectable URL fallback, distinct from the primary Web playback action |

- Define and apply a consistent visual system for typography, spacing, colors, buttons, forms, and status indicators. Use deliberate layouts and readable hierarchy rather than the existing test-page arrangement.
- Provide designed initial setup, loading, empty library, no continue-watching entries, refreshing, success, partial-scan warning, unavailable resource, and recoverable failure states with useful next actions.
- Prefer Toast for operation results and recoverable playback/subtitle failures. Keep ongoing subtitle preparation notifications visible until completion, failure or selection cancellation. Keep form validation, initial page failures, setup/empty states and persistent scan/library status in context.
- Keep scan/transcoding/persistence feedback visible without interrupting usable browsing or active Web playback. Do not claim an unsupported numeric completion percentage; show an indeterminate state when only task status is known.
- Preserve the current directory and return context when moving between browsing and playback. Opening tasks/settings and returning must not unexpectedly discard the user's location. Explain any root-change reset.
- Support desktop and narrow/mobile layouts without overlapping controls or page-wide horizontal overflow. Validate at least 1280 px and 390 px viewport widths. Long filenames must remain identifiable and full names accessible.
- Provide keyboard navigation, visible focus, accessible control labels, sufficient text contrast, and status/error cues beyond color alone. Destructive cache actions must clearly identify that they delete a prepared copy.
- Keep labels and feedback in English. Do not show placeholder metadata, nonfunctional controls, invented posters, or incomplete integrations as completed features.
- This scope presents V2's real file-based workflow.

### 4. Acceptance Criteria and Versions

#### Inherited V1 Baseline

These scenarios passed in V1 according to the user's manual acceptance report and remain regression requirements for V2.

| ID | Scenario | Passing result | Implemented in |
| --- | --- | --- | --- |
| A01 | Configure and scan nested media directories | Hierarchy appears and navigation works | V1 |
| A02 | Repeat scans; add/remove files and rescan | No duplicate entries; changes appear | V1 |
| A03 | Play a validated compatible sample | Audio/video start before the whole file is downloaded | V1 |
| A04 | Pause, seek to an unplayed position, adjust volume, enter fullscreen | Controls work and playback continues at the requested position | V1 |
| A05 | Unreadable directory, removed file, or unplayable media | Appropriate errors appear; browsing remains usable | V1 |
| A06 | Leave the player | Original directory is restored | V1 |
| A07 | Chinese/spaced paths and outside-root access attempts | Valid resources work; outside-root and symlink escapes are rejected | V1 |

#### V2 Acceptance

Implementation versions are listed in Section 2. A dash below means that the acceptance scenario has not been recorded as complete.

| ID | Requirements | Scenario and passing result | Acceptance completed in | Target version |
| --- | --- | --- | --- | --- |
| A08 | W01 | Watch, pause, reopen, rescan, and restart: saved progress survives and resumes correctly; backward seeks, including zero, persist | — | V2 |
| A09 | W01, W02 | Playback history is ordered by last viewed time, includes completed and zero-position records, offers resume/replay, and excludes missing or replaced sources from actionable entries; changed roots/content cannot inherit unrelated progress | V2 | V2 |
| A10 | W01 | Delayed/duplicate updates cannot overwrite newer progress; failed loading does not write zero; persistence errors leave playback usable | — | V2 |
| A11 | P03, P08, P09 | Select/disable VTT/SRT/ASS/SSA external and extracted text tracks; preserve validated styles/fonts and timing across original/prepared/real-time playback | — | V2 |
| A12 | P03, P08 | Ambiguous matches require selection; malformed/unsupported/unavailable subtitles produce feedback; outside-root access is rejected; originals remain unchanged | — | V2 |
| A13 | P05, P06, P07 | Real samples exercise all four strategy branches; compatible streams are preserved in remux/audio-only cases; incompatible samples play and seek after preparation | — | V2 |
| A14 | P07 | Duplicate requests share work; repeated playback reuses output; source changes invalidate it; queued/processing/ready/failed states are accurate | — | V2 |
| A15 | P07, W01 | Failure, insufficient storage, interrupted jobs, restart, retry, and cache deletion do not expose partial output or alter originals/history | — | V2 |
| A16 | C01 | Generate a reachable original-media URL and copy it or show it in a selectable field; manually open it in a player through the local and SSH-forwarded application origins | — | V2 |
| A17 | C01, W01 | Missing/unavailable media produces a useful link error; copying the link never changes Web playback history or progress | — | V2 |
| A18 | C01 | Generated links contain only the validated application media route; spaces, Unicode, percent signs and ampersands resolve to the intended resource, including through SSH forwarding | — | V2 |
| A19 | O16, C01 | File/resume actions open Web playback; Copy media link is visibly secondary and never invokes another application | — | V2 |
| A20 | O16 | Complete setup, scan, browse, resume, subtitle selection, preparation/retry/cache deletion, and settings workflows through finished API-backed screens; navigation and directory return context remain correct | — | V2 |
| A21 | O16 | At 1280 px and 390 px widths, long/Chinese filenames, controls, and task feedback remain usable; keyboard focus, labels, contrast, and loading/empty/error states pass visual and interaction review | — | V2 |
| A22 | P05–P07, W01 | Real-time playback begins before full conversion; seek into ungenerated media, pause/resume and reopen preserve source-time position and subtitle alignment; compatible streams are copied | — | V2 |
| A23 | P07 | Exit, expired lease, repeated seeks, source changes, failure and restart stop old children and clean incomplete output; preparation yields to playback and can restart; no stale generation is served | — | V2 |
| A24 | P03, P08, P09 | MKV with multiple text tracks and fonts extracts/selects correctly; external and extracted ASS/SSA styles/CJK text render; supported bitmap tracks extract but display explicit unsupported-Web feedback | — | V2 |
| A25 | Configuration | With no tool paths configured, FFmpeg/FFprobe resolve independently from process PATH; valid overrides work, missing/invalid binaries show dependent-feature errors while direct playback remains usable | — | V2 |
| A26 | Persistence | User settings remain in settings.json; Drizzle migrations/transactions preserve history and enforce deduplication; restart reconciles SQLite and asset files; cache cleanup never removes durable records | — | V2 |
| A27 | O17 | Startup uses current built-in defaults for unset choices, preserves explicit settings across upgrades, rejects invalid overrides, supplies one validated view and invalidates cached output when the effective profile changes | — | V2 |
| A28 | O14 | English UI, player labels and errors resolve through message keys with fallback; language-independent IDs and original filenames remain stable | — | V2 |

Record browser/OS versions for Web playback, representative external-player URL checks, source codecs, subtitle formats, pre-transcode and real-time profiles, styled subtitle/font samples, and real-sample results. Automated tests do not certify browser decoding. V2 completion requires the new acceptance scenarios and retained V1 regression behavior; then update implemented-version fields, including the partial P08/P09 boundaries.

### 5. Essential Quality Requirements

- Preserve V1 root confinement, bounded media streams, seeking, atomic scan publication, persistent settings, and read-only originals.
- Persist progress durably without requiring the in-memory index to survive restart; do not mix viewing records into rebuildable scan state.
- Restrict generated-asset access to known cache entries. Separate writable application data/cache from original media and frontend static assets.
- Bound shared pre-transcode/real-time concurrency and clean up children, leases and partial output during failure/shutdown.
- External-player support generates a transferable media URL only; the user opens it manually in a player.
- External services must not become playback dependencies unless explicitly included in this scope.
- FFmpeg/FFprobe executable overrides are optional; default discovery uses the server process PATH. Missing tools disable dependent features with actionable feedback.
- Keep user preferences in `settings.json`, program policy in TypeScript and the English catalog in a bundled resource. Use SQLite through Drizzle ORM for application records and cache metadata; store media/subtitle/font payloads as files. Cache cleanup must not erase durable viewing records or user settings.
