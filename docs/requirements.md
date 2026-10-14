# Anishelf Requirements

- [1. Product Goal and Document Scope](#1-product-goal-and-document-scope)
- [2. Feature Inventory and Version Tracking](#2-feature-inventory-and-version-tracking)
- [3. Rules for Future Features](#3-rules-for-future-features)
- [4. Release Plan and Suggested Evolution](#4-release-plan-and-suggested-evolution)
- [Completed anime library requirements and acceptance](history.md#anime-library-requirements)
- [Archived V2 requirements and acceptance](history.md#v2-requirements)

## 1. Product Goal and Document Scope

Anishelf is a personal animation media library intended to connect:

**tracking → resource discovery → downloading → library ingestion → Web / desktop playback → viewing history → external tracker synchronization**.

Its core value is better Web playback, shared client state, and coordination between tracking and automatic downloading.

This document retains the product goal, delivered feature inventory and future evolution. Version-specific requirements, acceptance and detailed design are retained in [History](history.md). The anime-library version completed requirements and acceptance on 2026-10-14, as confirmed by the user. Its scope is L07–L10, M01–M05 and M07; [the archive](history.md#anime-library-archive-notes) preserves CAT01–CAT08 and the original verification limits. No release number was assigned. No new iteration is selected; viewing and tracking is the next priority. The retained V2 implementation status remains recorded separately in History.

## 2. Feature Inventory and Version Tracking

- **Implemented in** records the delivered implementation and its version; `—` means not implemented. Partial delivery is explicitly identified.
- **Target version** records the selected or delivered iteration; `Unassigned` means no release commitment. `Anime library` names the completed unnumbered iteration archived on 2026-10-14; `Current` is retained for other unnumbered deliveries.
- **Later** identifies a subsequent core capability; **Optional** identifies a possible longer-term extension.
- A target version is not evidence of implementation. Implementation status and acceptance status are separate: delivered code does not certify acceptance. Record outstanding acceptance explicitly; for partial delivery, describe the delivered boundary and keep the remainder explicit. The retained V2 scenarios are recorded as implemented in [History](history.md#v2-requirements), independently of new verification evidence.

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
| L06 | Scheduled scans, filesystem monitoring, and incremental updates | Partial: scheduled scans delivered under V02; filesystem monitoring and incremental updates remain unassigned | V1 (scheduled scans only) | Unassigned |
| L07 | Parse anime titles, seasons, episode numbers, and release variants from filenames | Implemented: filename/directory extraction with preserved evidence | Anime library | Anime library |
| L08 | Review unidentified files and manually link or correct anime and episode associations | Implemented: clear-match automatic admission, manual Review and revision-checked corrections | Anime library | Anime library |
| L09 | Distinguish regular episodes, specials, continuous season numbering, and multi-episode files | Implemented: candidate-specific episode proposals, unresolved ambiguity and confirmed corrections | Anime library | Anime library |
| L10 | Associate multiple file versions with an episode and select a version for playback | Implemented: Catalog associations and Web version selection with source-version checks | Anime library | Anime library |
| L11 | Relink moved files while preserving viewing history | Later | — | Unassigned |
| L12 | Configure and manage multiple resource roots | Optional | — | Unassigned |
| L13 | Rename, organize, delete, and reclaim storage with preservation rules | Optional | — | Unassigned |
| L14 | Download an existing original media file from the Web interface to the user's device | Implemented | Current | Current |
| L15 | Select multiple files and preview/apply a shared episode-number offset | Later | — | Unassigned |

#### Multi-file Batch Offset Correction (L15)

Select an explicit subset of files for a work, preview each file's existing and proposed episode associations, and apply a shared numbering offset through Catalog-owned correction operations. Preserve original parsing evidence and source history, require explicit replacement of existing associations, and reject stale or invalid inputs. Single-file correction and offset previews are delivered in the completed anime-library scope; the multi-file Web workflow is later scope.

#### Resource Identification (L07–L10)

Parse filenames and directory context into identification evidence; external metadata supplies candidates and episode/work relationships. Rank candidates using titles and aliases, year, season/part, format and episode information when available. Show reasons and unresolved conflicts; similar candidates or unknown episode mappings require review. Parser output and match scores are evidence, not authoritative identities or probabilities.

Use consistent title normalization for ranking and admission, retain explicit ordinal provenance and never assume an unmarked title is season one. Publication-local continuous-number conversion requires distinct, agreeing filename anchors within the same directory, season and work; cross-directory propagation, relation-order offsets and conflicting numbering remain unresolved. Zero numbering requires explicit identity confirmation. Review preserves original numbers, offers candidate-specific mappings and shows the same admission blockers used by the runtime and evaluator.

Preserve raw parsed numbering separately from confirmed episode associations, including specials, continuous numbering and multi-episode files. Keep anime, episodes, source files, file-to-episode associations and provider identifiers separate. Manual corrections survive rescans and metadata refresh; reassociation never silently deletes source playback history. Multiple versions of an episode remain selectable without counting as separate episodes.

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
| M01 | Search external anime metadata and store provider identifiers | Implemented: AniList search and provider-qualified identifiers | Anime library | Anime library |
| M02 | Display covers, aliases, descriptions, seasons, episode counts, airing information, and available same-provider work relations | Implemented: cached details, artwork, available episode data and same-provider relations | Anime library | Anime library |
| M03 | Provide anime detail and episode views, organizing the library by title | Implemented: default poster library, work details and episode/version playback | Anime library | Anime library |
| M04 | Manually select, correct, and refresh metadata mappings | Implemented: Review selection/reassociation, episode corrections and metadata refresh | Anime library | Anime library |
| M05 | Cache metadata so external outages do not prevent browsing or playback | Implemented: durable metadata/artwork caching, refresh/retry and retained snapshots during outages | Anime library | Anime library |
| M07 | Preserve multilingual program titles, aliases and descriptions with language tags, original language and locale-independent IDs | Implemented: available provider language information and stable local identities; no invented translations | Anime library | Anime library |
| M06 | Multiple metadata providers and cross-provider ID mapping | Optional; same-provider related works belong to M02 | — | Unassigned |

#### External Metadata and Local Catalog (M01–M07)

External anime metadata is a dependency of the delivered identification workflow, not a later tracker integration. Start with one provider supporting search and details; retain its stable identifiers and available aliases, language information, episode data and work relations. Use local anime and episode identities independent of provider IDs. Cache fetched metadata with refresh status and preserve user corrections. Outages must not block already-cached browsing or existing file playback; unavailable candidate or episode information remains explicitly unresolved.

Provider and parser uncertainty is handled through Review; representative recognition accuracy measurement is not required for the completed anime-library iteration. Seanime is a workflow reference, not a mandated dependency. Multiple providers and cross-provider mappings remain M06. Provider-required service access is distinct from T01–T05 personal account authorization, list import and progress synchronization; basic identification must not require the user to authorize a personal tracker account.

### 2.3 Web Playback and Subtitles

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| P03 | Select or disable external VTT/SRT/ASS/SSA subtitles through Vidstack | Implemented | V2 | V2 |
| P05 | Choose a playback strategy based on media and client capabilities | Implemented | V2 | V2 |
| P06 | Remux media when only the container is incompatible | Implemented | V2 | V2 |
| P07 | FFmpeg full-file pre-transcoding with seeking; copy compatible streams and encode only necessary streams | Implemented: completed-file preparation, reuse, cancellation, retry and recovery | V2 | V2 |
| P08 | Discover/select subtitles and extract tracks packaged in video files such as MKV | Partial: text-track discovery, selection, extraction and delivery implemented; font attachments supported; bitmap extraction deferred | V2 (text subtitles); Current (fonts) | V2 (partial) |
| P09 | Support ASS/SSA styling and fonts, plus a compatibility path for image subtitles | Partial: styled ASS/SSA and fallback fonts implemented, with embedded TTF/OTF support; bitmap handling deferred | V2 (styles and fallback fonts); Current (embedded fonts) | V2 (partial) |
| P14 | HLS/fMP4 delivery and real-time transcoding, including seeking, leases, source-time mapping and interactive scheduling | Later | — | Unassigned |
| P15 | Extract, validate and load embedded font attachments | Implemented | Source-shared TTF/OTF preparation, validated cache and JASSUB loading | Current |
| P16 | Extract embedded PGS/VobSub bitmap subtitle assets with explicit unsupported-Web feedback | Later | — | Unassigned |
| P17 | Automatically prepare full-file Web-compatible copies in the background before playback | Later | — | Unassigned |
| P10 | Select audio tracks, adjust subtitle timing, change playback speed, and use shortcuts | Implemented | Current | Current |
| P11 | Next-episode navigation and automatic continuation | Later | — | Unassigned |
| P12 | Hardware transcoding, HDR handling, broader browser support, and advanced concurrency policies beyond the V2 bounded scheduler | Optional | — | Unassigned |
| P13 | Chapter navigation | Implemented: chapter discovery, source-time mapping and player chapter tracks; real-browser interaction acceptance pending | Current | Current |

#### FFmpeg Full-file Preparation (P05–P07)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Automatic Background Pre-transcoding (P17)

Allow users to enable automatic background preparation for newly scanned or ingested resources under an explicit target playback profile. Reuse existing inspection, compatibility planning and full-file preparation: retain direct-playable originals, remux when sufficient and encode only necessary streams. Deduplicate by source version and preparation profile, reuse valid completed copies, and bound concurrency and cache usage. Provide queue/progress/failure feedback, cancellation and retry; recover after restart without duplicate work and invalidate changed sources. Preserve original files and source-level history. This adds automatic scheduling before playback to the existing preparation capability; it is outside the current anime-library iteration and has no assigned release.

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Deferred Playback and Subtitle Requirements (P14–P16)

P14 and P16 remain outside V2 with no assigned release. P15 is implemented as a subsequent extension:

- **P14 HLS and real-time playback:** serve completed and live HLS/fMP4 playlists and complete segments; prefer valid completed resources and copy compatible streams. Begin playback before full conversion; support pause/resume and seeking beyond generated ranges by restarting near the requested source time. Map progress and subtitle clocks to source time. Expose starting/streaming/buffering/completed/stopped/failed states and corresponding UI. Stop and clean old processing on exit, expired lease, repeated seeks, source invalidation, failure or shutdown. Bound shared concurrency/storage and prioritize interactive work with explicit interruption/requeue feedback. Preserve history/originals and reject stale generations after restart.
- **P15 Embedded fonts:** ASS/SSA selection prepares source-shared TTF/OTF attachments on demand, validates bytes and cached identities, enforces count/size/cache limits and supplies fonts to JASSUB. Attachment names never become filesystem paths. Preparation or download failures preserve subtitles with fallback feedback and retry. External ASS/SSA and prepared-copy playback use attachments from the original video. Exact missing-family/glyph diagnosis and broad font/browser certification remain unverified; acceptance uses styled ASS/SSA and CJK samples.
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

#### Episode Viewing and Tracking (W03–W05)

After confirmed anime/episode associations exist, add planned, watching, completed, paused and dropped statuses; automatic completion and manual watched/unwatched corrections; watched counts, available unwatched episodes and missing-episode information where the expected episode set is known. Retain source playback positions separately from episode watched state. Watching multiple file versions must not inflate episode counts; later-episode viewing must not imply earlier episodes were watched. These capabilities are the next core stage, outside the current identification iteration.

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
| O04 | Unified settings for directories and integrations | Later | — | Unassigned |
| O05 | Task history, logs, and automation decision explanations | Later | — | Unassigned |
| O06 | Back up and restore metadata, viewing history, and configuration | Later | — | Unassigned |
| O07 | LAN access, single-user authentication, and credential protection | Later | — | Unassigned |
| O08 | In-app completion and failure feedback | Implemented: scan result Toasts and preparation results in the floating task monitor | Current | Current |
| O09 | Multiple users, permissions, public deployment support, and remote access | Optional | — | Unassigned |
| O10 | Plugin extensions and public integration APIs | Optional | — | Unassigned |
| O11 | Log rotation, retention, and reopening files without restarting the application | Implemented: size/time rotation, archive count retention, Unix SIGHUP reopening | Current | Current |
| O12 | Automatic log-output fallback after destination failure | Implemented: per-output stderr fallback; stdout/file/both modes | Current | Current |
| O13 | Asynchronous log output with bounded buffering and shutdown flushing | Partial: bounded asynchronous file queue and shutdown draining; stdout/stderr remain synchronous | Current (partial) | Unassigned |
| O14 | Interface localization and language preferences | Partial: English catalog, message keys and fallback implemented; additional locales and language selection remain unassigned | V2 (English foundation) | V2 (partial) |
| O15 | Manage API-backed frontend state and caching with TanStack Query | Implemented | Current | Current |
| O17 | Unified configuration | TypeScript policy defaults, validated user overrides and typed access; built-in cache budget | V2 | V2 |
| O18 | User-editable prepared-media cache budget | Implemented; Settings control, validation and persisted disk-space limit | Current | Current |

#### User-editable Prepared-media Cache Budget (O18)

Allow users to configure the total disk-space limit for generated prepared-media copies through Settings. Validate and persist the explicit choice, preserve it across upgrades and enforce it for future preparation output. Account for retained in-use artifacts, distinguish cache exhaustion from insufficient disk space and preserve originals, history and settings. Lowering the limit must not silently delete existing copies; show exhaustion and allow explicit cleanup. Settings provides a validated, persisted transcode cache budget in GiB. Preparation reads the current limit when starting work and accounts for retained copies; cache exhaustion and insufficient disk space have distinct feedback. Existing copies can be deleted explicitly.

#### Unified Configuration (O17)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Interface Localization (O14)

- Introduce translation resources for interface labels, status messages, and user-facing errors, with English as the default and fallback language.
- Allow users to select a supported language and persist that preference.
- Keep API field names, error codes, resource IDs, and original filenames unchanged across languages.
- Acceptance: changing the language updates supported interface text and error feedback; missing translations fall back to English; browsing and playback state remain intact.

V1 remains English-only as implemented. V2 reserves multilingual support with an English message catalog, stable keys and fallback; additional language packs and a language selector remain unassigned. The completed anime-library iteration delivers program metadata (M07): preserve available language-tagged titles, aliases and descriptions, original language and stable IDs, using exact locale, base language, original language and deterministic available-value fallback. This contract does not add metadata features to V2.

#### Frontend State and Caching (O15)

- Use TanStack Query to manage API-backed server state in the Web interface, including resource listings, scan status, and saved settings.
- Define stable query keys and suitable freshness and retention policies for each kind of data. Reuse fresh results and deduplicate concurrent requests for the same data.
- After a successful scan or settings change, update or invalidate the affected queries so subsequent views reflect the server's latest state.
- Keep loading, refresh, and error feedback visible; a failed refresh must not silently present cached data as current.
- Limit this cache to API-backed data. Media playback streams and local-only interface or player state are outside its scope.
- Acceptance: revisiting a still-fresh resource listing reuses cached data; concurrent requests for the same listing do not trigger duplicate fetches; a completed scan or settings change is reflected on the next affected view; and a refresh failure is distinguishable from a successful current result.

The Web interface implements this capability with TanStack Query, shared query definitions and a QueryClient. API-backed views reuse cached results and coordinate invalidation or refresh after changes; media streams and local player state remain outside the query cache.

#### Notification Delivery Boundary (O08)

The Web interface emits in-app Toasts when library scans complete or fail, provides feedback for successful actions and request failures, and displays preparation progress and completion/failure results in the floating task monitor and task cards. These existing in-app feedback paths fulfill O08; a separate preparation-result Toast is not required.

#### Logging Maintenance (O11–O13)

- O11: Define rotation and retention policies using external deployment tooling or a suitable Pino transport. If rotation renames the active file, support reopening the configured path and a deployment trigger such as a Unix signal.
- O12: Switch subsequent log records to a fallback destination after runtime output failure. Specify buffered-record loss, failure reporting, and whether/how the original destination is restored; cover errors handled internally by Pino as well as emitted stream errors.
- O13: Introduce asynchronous Pino output when measured log volume or write latency affects application responsiveness. Bound buffered memory, define backpressure or overflow behavior, and flush pending records within a bounded shutdown period.
- Acceptance: asynchronous output avoids synchronous destination writes on the application path, buffers remain bounded under a slow destination, and normal shutdown writes pending records; timeout or overflow reports any potential record loss.
- Acceptance: rotation directs subsequent logs to the new file without restarting the application; destination failure triggers the defined fallback without replacing existing business-module loggers.

Current logging supports stdout, file and simultaneous stdout/file output. File modes default to `anishelf.log` in the platformdirs user log directory; `ANISHELF_LOG_PATH` is an optional absolute path override. File output rotates by size or hourly/daily interval and retains a configured archive count through `rotating-file-stream`. Unix SIGHUP reopens the file or retries a failed file destination without replacing business loggers. Each failed output falls back to stderr; healthy outputs continue. The uncertain in-flight failed record is not replayed, queued file records go to stderr, and stderr failure can lose records. Recovery is explicit for files and requires restart for stdout. Rotation, output failure, overflow and shutdown timeout diagnostics bypass the application logger.

File output accepts up to 1 MiB of serialized queued/in-flight records; overflow goes to stderr. Normal shutdown allows two seconds to drain and close file output, then reports potential loss. O13 remains partial because stdout and stderr writes are synchronous. See [development logging](development.md#logging-choice) for lifecycle details and [deployment logging](../README.md#logging) for configuration.

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

V1 is implemented. The archived V2 scope selected saved progress and resume (W01), History (W02), external/styled subtitles and embedded extraction (P03 and partial P08/P09), FFmpeg pre-transcoding (P05–P07), and transferable external-player media links (C01). Web playback remains the primary path. C02 now provides platform-filtered browser invocation and browser-local custom players; C03 native state reading remains a later requirement; other unselected items remain unassigned. Automatic next-episode playback is not part of V2.

| Stage | Question to resolve | Priority candidates |
| --- | --- | --- |
| Completed: anime library | Confirmed anime and episode library from existing files; requirements and acceptance complete | L07–L10, M01–M05, M07; CAT01–CAT08 archived |
| Next core stage: viewing and tracking | Can users manage anime and episode viewing state? | W03–W05, episode completion/corrections and tracking statuses |
| Later: automatic acquisition | Can new episodes reach the library automatically? | Subscriptions, discovery, download integration, ingestion, and recovery |
| Later: external tracking | Can Web viewing records integrate with trackers? | AniList synchronization; possible future read-only native-player state reporting (C03) |

The anime-library iteration is complete and archived. No next iteration has been selected. Subsequent core stages prioritize viewing/tracking, automatic acquisition, then external tracker synchronization; release numbers remain unassigned. Playback enhancements such as HLS, next-episode continuation and broader subtitle compatibility remain separate later work. For example, desktop integration can move ahead once viewing records are stable if it becomes the most pressing need. Select one independently verifiable user workflow at a time instead of assigning the entire inventory to a single release.
