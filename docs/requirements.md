# Anishelf Requirements

- [1. Product Goal and Document Scope](#1-product-goal-and-document-scope)
- [2. Feature Inventory and Version Tracking](#2-feature-inventory-and-version-tracking)
- [3. Rules for Future Features](#3-rules-for-future-features)
- [4. Release Plan and Suggested Evolution](#4-release-plan-and-suggested-evolution)
- [Completed AniList accounts requirements and acceptance](history.md#anilist-accounts-requirements)
- [Completed anime library requirements and acceptance](history.md#anime-library-requirements)
- [Archived V2 requirements and acceptance](history.md#v2-requirements)

## 1. Product Goal and Document Scope

Anishelf is a personal animation media library intended to connect:

**tracking → resource discovery → downloading → library ingestion → Web / desktop playback → viewing history → external tracker synchronization**.

Its core value is better Web playback, shared client state, and coordination between tracking and automatic downloading.

This document retains the product goal, delivered feature inventory and future evolution.
Completed requirements, acceptance and detailed designs are retained in [History](history.md).
The anime-library iteration (L07–L10, M01–M05, M07; CAT01–CAT08) was accepted by the user
on 2026-10-14. The AniList accounts iteration (T01–T05, W03–W05; ANI01–ANI10) was accepted
by the user on 2026-10-17 and is now [archived](history.md#anilist-accounts-archive-notes).
Neither iteration was assigned a release number. Multi-root resource management (L12)
is implemented in the current unnumbered scope; user acceptance remains pending. No
new release number has been selected;
Later/Unassigned items remain future work. The retained V2 implementation status remains
recorded separately in History.

## 2. Feature Inventory and Version Tracking

- **Implemented in** records the delivered implementation and its version; `—` means not implemented. Partial delivery is explicitly identified.
- **Target version** records the selected or delivered iteration; `Unassigned` means no release commitment. `Anime library` names the completed unnumbered iteration archived on 2026-10-14; `Current` is retained for other unnumbered deliveries.
- **Selected** identifies planned work for the next iteration, not delivered implementation.
- **Later** identifies a subsequent core capability; **Optional** identifies a possible longer-term extension.
- A target version is not evidence of implementation. Implementation status and acceptance status are separate: delivered code does not certify acceptance. Record outstanding acceptance explicitly; for partial delivery, describe the delivered boundary and keep the remainder explicit. The retained V2 scenarios are recorded as implemented in [History](history.md#v2-requirements), independently of new verification evidence.

### 2.0 Delivered V1 Foundation

| ID | Feature | Delivered scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| V01 | Resource directory configuration | Original single-root setup; multiple persisted roots and per-root feedback are delivered under L12 | V1 | V1 |
| V02 | Library scanning | Automatic scans at startup and after resource-root changes; native filesystem monitoring and manual rescans; recursive video discovery; repeated scans without duplicate paths; additions and removals reflected | V1 | V1 |
| V03 | Resource browsing | Actual directory hierarchy, original filenames, stable natural sorting, and parent navigation | V1 | V1 |
| V04 | Web playback | Browser direct playback through bounded media streams and byte ranges | V1 | V1 |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory | V1 | V1 |
| V06 | Failure feedback | Missing/unreadable resources and unsupported-media or playback errors | V1 | V1 |

V1 includes read-only originals, resource-root confinement, persistent root settings, and visible scan states. Its original acceptance criteria remain in the archived V2 requirements as the regression baseline. Subtitle loading, saved progress, and media preparation are V2 additions.

### 2.1 Resource Access and Library

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| L05 | Search filenames, choose sorting, and filter resources | Later | — | Unassigned |
| L06 | Watch filesystem changes and update the library incrementally | Implemented: native recursive monitoring, path-scoped resource updates, directory-scoped identification and Catalog publications, degraded-state recovery; deployment acceptance pending | Current | Current |
| L07 | Parse anime titles, seasons, episode numbers, and release variants from filenames | Implemented: filename/directory extraction with preserved evidence | Anime library | Anime library |
| L08 | Review unidentified files and manually link or correct anime and episode associations | Implemented: clear-match automatic admission, manual Review and revision-checked corrections | Anime library | Anime library |
| L09 | Distinguish regular episodes, specials, continuous season numbering, and multi-episode files | Implemented: candidate-specific episode proposals, unresolved ambiguity and confirmed corrections | Anime library | Anime library |
| L10 | Associate multiple file versions with an episode and select a version for playback | Implemented: Catalog associations and Web version selection with source-version checks | Anime library | Anime library |
| L11 | Relink moved files while preserving viewing history | Later | — | Unassigned |
| L12 | Configure and manage multiple resource roots | Implemented: up to 64 non-overlapping paths, per-root Files entries, scoped identities, partial scan recovery, legacy settings/history upgrade; acceptance pending | Current | Current |
| L13 | Rename, organize, delete, and reclaim storage with preservation rules | Optional | — | Unassigned |
| L14 | Download an existing original media file from the Web interface to the user's device | Implemented | Current | Current |
| L15 | Batch Review with shared work selection and episode-number offset previews | Later | — | Unassigned |
| L16 | Improve matching using representative real-world failure cases | Later | — | Unassigned |
| L17 | Learn scoped matching rules from explicit manual corrections | Later | — | Unassigned |

The poster library supports Title, Recently added, Recently updated and Unwatched
first sorting. Unwatched first is the default: works with locally available episodes
beyond the tracking provider's cumulative progress precede other works; each group
uses title order. Unknown progress and remote-only works receive no unwatched priority.
Recently updated uses the local Catalog work update timestamp; remote-only works use
the provider list-entry update timestamp, falling back to the list fetch time.
Recently added retains local Catalog creation-time ordering. This poster sorting
delivery does not complete L05 filename search/sorting/filtering in Files.

#### Multi-root resource management (L12)

Settings persist `resourceRoots` as a list of absolute server paths; an empty list
returns to setup mode. Canonically duplicate or nested roots and overlap with the
data directory are rejected, including aliases through symlinks. Multiple roots
are browsed as distinct Files entries. Identical relative filenames remain distinct
resources, and reordering roots does not change their identities.

Healthy roots continue to update if another root is unavailable. Failed roots
retain their previous index and report availability/warnings; all-root failure
must not publish an empty library. Removing a root hides its resources while
preserving accepted associations and playback history. Restoring it makes those
records reusable. Legacy single-path settings and durable source records upgrade
without discarding history. Filesystem watching and moved-file relinking remain
separate future scope (L06 and L11).

#### Filesystem Monitoring and Incremental Updates (L06)

Watch the configured resource root recursively for file and directory additions, modifications, removals and moves. Use these changes to refresh affected library entries automatically, without waiting for a scheduled full scan. Coalesce bursts of events and wait for actively written files to stabilize before identification or media inspection. Preserve resource-root restrictions, manual associations and viewing history; identity-preserving relinking of moved files remains L11.

Keep startup scanning and explicit manual rescans for initial discovery and reconciliation. Scheduled full scans are removed; known monitoring failures trigger recovery reconciliation. Detect unavailable monitoring or lost events, report degraded monitoring and provide reconciliation and retry; an inaccessible root must not be treated as an empty library.

Acceptance: after files stabilize, additions, changes and removals appear automatically without waiting for the scan interval; nested directory changes are covered; bursts do not create duplicate entries or overlapping full scans; monitoring failures are visible and reconciliation restores the library. Existing manual associations and viewing history remain intact. The implementation is described in [Filesystem monitoring](filesystem-monitoring.md); live deployment acceptance, particularly on network mounts, remains pending.

#### Batch Review (L15)

Select an explicit subset of files for a work, preview each file's existing and proposed episode associations, and apply a shared numbering offset through Catalog-owned correction operations. Preserve original parsing evidence and source history, require explicit replacement of existing associations, and reject stale or invalid inputs. Single-file correction and offset previews are delivered in the completed anime-library scope; the multi-file Web workflow is later scope.

After correcting one file, allow the user to find related files, explicitly select the batch scope and preview a shared work assignment and numbering conversion. Show per-file conflicts and exclusions before confirmation; a single correction does not authorize automatic changes to other files. Batch Review must remain usable without learned rules.

Acceptance: selected valid files receive the previewed associations, excluded files remain unchanged, conflicts are visible and stale inputs are rejected. Existing manual associations require explicit replacement.

#### Matching Improvements from Real Failures (L16)

Collect representative local failure cases with user-confirmed expected works and episode mappings, preserving filename, directory and release provenance. Diagnose extraction, candidate retrieval, ranking, numbering and admission separately. Prioritize recurring failures such as shortened titles, season/part ambiguity, continuous numbering and end-of-series markers; do not lower admission thresholds solely to improve corpus coverage.

Acceptance: evaluate against a fixed baseline and held-out cases, report recognition and correct automatic admission separately, and inspect incorrect admissions and regressions. Distinguish frozen-candidate evaluation from live-search retrieval. Unresolved identities and numbering remain reviewable.

#### Learning from Manual Corrections (L17)

Learn explainable, scoped rules only from explicit user-confirmed corrections. Candidate rule types include title aliases, season/part interpretations, directory or release-batch work assignments, episode offsets, numbering-token selection, explicitly identified special/ancillary content and rejected candidates. Keep work identity and episode mapping independent; an arbitrary single-file correction must not become a general numbering rule.

Default to narrow scopes using resource root, directory, release batch, title context, work and season/part evidence. One confirmation may produce suggestions or a user-authorized batch preview; automatic reuse requires multiple independent, consistent confirmations and no conflicting evidence. Never learn new manual evidence from automatic admissions or rule-generated suggestions alone. Do not propagate offsets across unrelated directories, releases, seasons or parts, or overwrite manual decisions.

Preserve each rule's source confirmations and applicable context, explain its effect on recommendations, and support disabling or deleting rules. Replaced, revoked or stale source evidence must invalidate dependent suggestions until revalidated. Conflicting rules require Review; disabling a rule must not silently undo confirmed associations.

Acceptance: earlier confirmations predict later unseen files, with release/context separation to prevent evaluation leakage. Verify conflict handling, scope boundaries, evidence invalidation and rule removal, and report incorrect automatic applications as well as coverage gains.

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

This is a user-facing file download, separate from acquiring new releases through qBittorrent (D01–D08). File actions and the player's More playback options menu provide **Download video**. The action rechecks file access and starts a native browser download from the original-media route with the original filename, without buffering the complete file in JavaScript. Automatic acquisition through qBittorrent is delivered separately under D01–D07, with live acceptance pending.

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

Provider and parser uncertainty is handled through Review; representative recognition accuracy measurement is not required for the completed anime-library iteration. Seanime is a workflow reference, not a mandated dependency. Multiple providers and cross-provider mappings remain M06. Provider-required service access is distinct from T01–T05 personal account authorization, personal list access and viewing-state updates; basic identification must not require the user to authorize a personal tracker account.

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
| P13 | Chapter navigation | Implemented and accepted: chapter discovery, source-time mapping, player chapter tracks and real-browser interaction acceptance (2026-10-19) | Current | Current |

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

### Provider integration boundary

Metadata and Tracking use provider-owned adapters behind application-owned contracts. AniList remains the production provider and authority for its viewing state. Opaque provider-qualified identities, product-owned viewing statuses, explicit target resolution outcomes and provider capability checks isolate Library and Playback from provider protocols. One tracking account and cumulative episode progress are supported. Additional production providers, simultaneous accounts and evidence-backed cross-provider episode mappings remain Later/Unassigned. See [the provider integration design](tracking-provider-design.md).

### 2.4 Viewing History and Tracking

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| W01 | Save playback position and duration and resume playback | Implemented | V2 | V2 |
| W02 | History page with recent viewing records and resume/replay | Implemented; History covers continue watching | V2 | V2 |
| W03 | Detect episode completion and submit progress updates or manual corrections to AniList | Implemented: unified detail/player commands and 90-percent/natural-end completion with 30-second normal-play minimum; accepted by the user on 2026-10-17 | AniList accounts | AniList accounts |
| W04 | Display and update AniList tracking statuses | Implemented: remote display/filters and manual status updates; accepted by the user on 2026-10-17 | AniList accounts | AniList accounts |
| W05 | Show watched counts and available unwatched episodes from AniList progress, alongside local playback history | Implemented: detail indicators/counts and Library available-unwatched counts; accepted by the user on 2026-10-17 | AniList accounts | AniList accounts |
| W06 | Share records across clients and handle duplicate, out-of-order, or concurrent progress updates | Later | — | Unassigned |
| W07 | Rewatch history, ratings, tags, and personal notes | Optional | — | Unassigned |

#### Episode Viewing and Tracking (W03–W05)

AniList is the authority for anime viewing status and cumulative episode progress. Display its tracked titles and supported statuses, and submit automatic completion updates and manual progress/status corrections to AniList. Reuse confirmed local work/episode associations and provider identifiers; mapping is already delivered and is not a new implementation requirement. Keep source playback positions and local playback history independent from AniList state. Multiple file versions must not increment progress repeatedly.

AniList cumulative progress does not provide an independent watched/unwatched flag for every episode. Derived episode indicators must be labeled as based on AniList progress, rather than exact local per-episode viewing records. Watching a later episode must not silently imply earlier episodes were watched: noncontiguous completion requires an explicit cumulative-progress decision. The selected automatic policy requires reaching 90 percent of the source timeline or natural source end, plus 30 seconds of normal wall-clock playback in the current session. Seeks, resume restoration, pauses and buffering add no normal time; playback speed does not multiply it. Player manual marks require no telemetry. All entry points share durable Tracking commands and result states; persisted manual versions prevent late automatic observations from overriding explicit corrections. Do not introduce a separate authoritative local tracking list or per-episode watched-state store.

### 2.5 Subscriptions and Resource Discovery

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| S01 | Enable or pause RSS discovery from an anime's own page | Implemented; download submission separate | Current | Unassigned |
| S02 | Set and preserve a subscription starting episode and backlog scope | Implemented: fixed creation lower bound and revision-checked edits; global Watching activation previews impact | Current | Unassigned |
| S03 | Configure RSS and discover releases periodically | Implemented: one RSS per anime, shared conditional fetches and durable scheduling with a configurable global interval (default 30 minutes); live feed acceptance pending | Current | Unassigned |
| S04 | Match releases to titles and episodes and explain uncertain matches | Implemented: uncertain releases are automatically skipped without review | Current | Unassigned |
| S05 | Filter by subtitle language, release group, resolution, codec, and keywords | Implemented for RSS, manual search and opt-in Watching: built-in/custom YAML selection profiles; live Watching acceptance pending | — | Current |
| S06 | Deduplicate and exclude existing files, active downloads, and unwanted episodes | Implemented: discovery identities, accessible local episodes and downloader hashes; durable canonical-hash and work/episode reservations before submission; live acceptance pending | Current | Current |
| S07 | Explain decisions and automatically choose one release per episode | Implemented: profile levels, persisted waiting, seed-count tie-breaking and skipped reasons; manual selection/dismissal outside the simplified scope | Current | Unassigned |
| S08 | Coordinate tracking-status changes with subscriptions and explain their effect on existing tasks | Implemented: Watching creates ordinary subscriptions; subsequent status changes do not alter them, and user settings/transfers/imports are preserved | Current | Current |
| S09 | Search multiple sources, rank releases, process season packs, and upgrade quality | Optional | — | Unassigned |
| S10 | Automatically subscribe to anime in AniList Watching | Implemented: default-off Watching creation with session-bound preview, fixed starting scope and recreation exclusions; existing subscriptions remain user-managed; live acceptance pending | — | Current |
| S11 | Find a suitable release source without entering an RSS URL for each anime | Implemented: ordered configured-site discovery with Anime identity assessment, S05 profiles, pinned sources and unresolved states; live Watching acceptance pending | — | Current |
| S12 | Preserve ordinary subscription management after Watching creation | Implemented: Tracking status changes and automation disable stop no existing subscription; edits, pause/resume and cancellation share the manual workflow | — | Current |

See [RSS subscriptions](rss-subscriptions.md) for the implemented first two stages.
RSS selects candidates automatically without per-release approval. Separately confirmed
acquisition scopes enable the download worker; complete live acceptance remains pending.

#### AniList Watching to Automatic Acquisition (S05, S10–S12)

The intended workflow is: add an anime to AniList Watching, let Anishelf find a suitable resource source and maintain its subscription, then automatically download new episodes through qBittorrent and verify their ingestion into the local library. Users configure resource sites, release preferences, destination and automation scope once; routine additions to Watching should not require finding and entering a per-anime RSS URL or approving every episode.

The workflow uses one subscription model. Users can save subscription intent before
any eligible release exists; source discovery runs in the background. Watching is a
default-off creation trigger with a session-bound activation preview. It creates
missing subscriptions using confirmed progress plus one or episode 1 and then leaves
them under ordinary user control. Existing subscriptions are skipped. Later Tracking
status/account changes or disabling Watching do not stop those subscriptions.

Manual and Watching-created work share Edit, Pause/Resume and Unsubscribe. User edits
are never overwritten by reconciliation. Unsubscribe records automatic-recreation
exclusions while submitted transfers/imports continue. The starting episode freezes
at creation, including during unresolved discovery. Site/profile/target changes and
late responses must respect accepted scope and revision checks. Source identity must
be verified before binding download permission; empty or ambiguous results do not
block saving intent and do not authorize guessed downloads.

Settings owns global configuration and help. Work details use a compact Header row,
a short defaults-first editor and an on-demand Activity dialog with secondary History
and lazy grouped Diagnostics. No source-search/resource-sample step is required before
subscribing. See [the interaction design](subscription-interaction-redesign.md) and
[current requirements](current-requirement.md). The user reported manual live pipeline
acceptance; real Watching acceptance remains pending.

Acceptance requires a real AniList account, supported resource feed/site, qBittorrent and mapped media storage. After automation is enabled, a newly Watching anime must acquire a matching new episode without manual RSS entry, download it into its per-anime directory, and expose it in the library only after verified association and access. Also verify initial backlog scope, duplicate list refreshes, restart recovery, tracking/source/downloader outages, ambiguous results, manual overrides and status transitions. Existing single-episode RSS-to-download-to-ingestion behavior needs its own live acceptance; full season-pack ingestion is not supported by the current one-selected-video import path and is not implied by this workflow. Successful ingestion does not certify browser playback compatibility.

### 2.6 Downloads and Automatic Ingestion

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| D01 | Connect to qBittorrent and validate configuration and download-path mappings | Implemented: private API settings, connection test and one root/path mapping with incomplete-directory validation; actual shared visibility verified during import; live acceptance pending | Current | Current |
| D02 | Submit releases, persist task associations, and prevent duplicate submissions | Implemented: persisted intent, canonical identity/reservations, per-anime placement and uncertain-outcome reconciliation; live acceptance pending | Current | Current |
| D03 | Display acquisition state, progress and errors | Implemented: compact detail Activity; real percentage and import states; speed/seeding details in WebUI | Current | Current |
| D04 | Manage downloads and recover acquisitions | Implemented: transfer pause/resume/removal delegated to WebUI; scoped acquisition/import retries in Anishelf | Current | Current |
| D05 | Check completed files, scan them, and associate them with episodes | Implemented: confined file verification, targeted Resources refresh, Anime association/Review and independent import retry; live acceptance pending | Current | Current |
| D06 | Recover from disconnections, externally removed tasks, and server restarts | Implemented: stale observations, durable bindings, restart reconciliation and external-removal suppression; live acceptance pending | Current | Current |
| D07 | Distinguish task cancellation, downloaded-data deletion, and library-record removal | Implemented boundary: task/data deletion in WebUI, Catalog decisions in existing local workflows; deletion never triggers automatic re-adding | Current | Current |
| D08 | Multiple download clients, seeding policies, bandwidth schedules, and storage policies | Optional | — | Unassigned |

The [qBittorrent adapter foundation](qbittorrent-adapter.md) also supplies low-level
submission, observations and control commands. The current acquisition workflow adds
persistence, reconciliation, per-anime placement and verified ingestion. Transfer
controls use WebUI; compact detail Activity supplies status and recovery without a
global download-management page. See [current requirements](current-requirement.md).

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
| T01 | Authorize AniList, display the connected account, check connectivity, and disconnect | Implemented: PIN token preview/confirmation, private credentials, reconnection and generation fencing; accepted by the user on 2026-10-17 | AniList accounts | AniList accounts |
| T02 | Read, cache and refresh the connected account's AniList lists and viewing state | Implemented and user-accepted on 2026-10-17: complete account-scoped snapshots, stale/error feedback, unified local/remote Library and viewing-state details | AniList accounts | AniList accounts |
| T03 | Reuse existing work/episode mappings to submit viewing progress and tracking-status updates to AniList | Implemented: manual updates and mapped automatic episode completion; accepted by the user on 2026-10-17 | AniList accounts | AniList accounts |
| T04 | Persist pending updates, coalesce superseded updates, retry failures, report expired authorization, and show results | Implemented: manual commands and durable playback handoff; accepted by the user on 2026-10-17 | AniList accounts | AniList accounts |
| T05 | Detect remote changes before retrying pending updates and resolve conflicts without silently overwriting newer state | Implemented for manual and playback commands; accepted by the user on 2026-10-17; upstream read/write race remains | AniList accounts | AniList accounts |
| T06 | Multiple trackers, rating synchronization and advanced rewatch support | Optional | — | Unassigned |

#### AniList Accounts: Selected Scope and Acceptance

AniList is the viewing-state authority. This iteration selects account connection, cached list access, progress/status submissions, durable retries and remote-conflict handling. It reuses existing work/episode mappings and keeps local playback history independent. Independent local tracking, list import/export and reimport merging are excluded.

[Archived AniList accounts requirements](history.md#anilist-accounts-requirements) retains the completed scope, consistency rules and ANI01–ANI10 scenarios. [The final acceptance record](history.md#anilist-accounts-archive-notes) records user acceptance on 2026-10-17; current implementation ownership is maintained in [Architecture](architecture.md).

### 2.9 Interface, Settings, and Maintenance

| ID | Feature | Scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| O03 | Dashboard for continued viewing, new episodes, downloads, and exceptions | Later | — | Unassigned |
| O04 | Unified settings for directories and integrations | Later | — | Unassigned |
| O05 | Task history, logs, and automation decision explanations | Partial: durable per-anime acquisition activity, decision reasons, safe correlated logs and terminal-detail retention; broader product history remains later | Current (acquisition) | Unassigned |
| O06 | Back up and restore metadata, viewing history, and configuration | Later | — | Unassigned |
| O07 | LAN access, single-user authentication, and credential protection | Implemented: single password, independent hash file, persistent Cookie sessions, CSRF, login limits, local recovery and 24-hour scoped media links; remote access through TLS proxy | Current | Current |
| O08 | In-app completion and failure feedback | Implemented: scan result Toasts and preparation results in the floating task monitor | Current | Current |
| O09 | Multiple users, permissions, public deployment support, and remote access | Optional | — | Unassigned |
| O10 | Plugin extensions and public integration APIs | Optional | — | Unassigned |
| O11 | Log rotation, retention, and reopening files without restarting the application | Implemented: dependency-managed size/time rotation and archive retention; custom reopening removed | Current | Current |
| O12 | Automatic log-output fallback after destination failure | Simplified: stdout/file/both routing; output failures follow dependency defaults | Current | Current |
| O13 | Asynchronous log output with bounded buffering and shutdown flushing | Simplified: dependency-owned buffering and file-stream shutdown; no custom queue guarantees | Current (partial) | Unassigned |
| O14 | Interface localization and language preferences | Partial: English catalog, message keys and fallback implemented; additional locales and language selection remain unassigned | V2 (English foundation) | V2 (partial) |
| O15 | Manage API-backed frontend state and caching with TanStack Query | Implemented | Current | Current |
| O17 | Unified configuration | TypeScript policy defaults, validated user overrides and typed access; built-in cache budget | V2 | V2 |
| O18 | User-editable prepared-media cache budget | Implemented; Settings control, validation and persisted disk-space limit | Current | Current |
| O19 | In-app editor for hand-written configuration files | Later: edit and validate supported custom profile files, including acquisition and transcode profiles | — | Unassigned |
| O20 | Hot reload acquisition profile configuration | Later: validate and activate acquisition-profiles.yaml changes without restarting Backend; retain the last valid configuration on reload failure | — | Unassigned |

#### User-editable Prepared-media Cache Budget (O18)

Allow users to configure the total disk-space limit for generated prepared-media copies through Settings. Validate and persist the explicit choice, preserve it across upgrades and enforce it for future preparation output. Account for retained in-use artifacts, distinguish cache exhaustion from insufficient disk space and preserve originals, history and settings. Lowering the limit must not silently delete existing copies; show exhaustion and allow explicit cleanup. Settings provides a validated, persisted transcode cache budget in GiB. Preparation reads the current limit when starting work and accounts for retained copies; cache exhaustion and insufficient disk space have distinct feedback. Existing copies can be deleted explicitly.

#### Configuration File Editor (O19)

Provide an in-app editing panel for supported configuration files that currently
require manual file editing, initially custom acquisition and transcode profile
YAML files. Show the current content, documented examples and field guidance;
allow users to edit a draft, validate it with the owning module's schema, explicitly
save it or discard changes. Preserve comments and formatting when saving. Display
syntax and validation errors with field paths and line/column locations where
available, and explain whether a restart is required for changes to take effect.
Detect concurrent file changes before saving and keep the previous valid file on
validation or write failure. Built-in profiles remain read-only.

Acceptance: a user can create or edit a supported custom profile without accessing
the host filesystem; invalid drafts leave saved configuration unchanged; successful
saves preserve the user's text and report activation/restart status. Existing
external-file loading and profile-selection controls do not constitute delivery of
this editor. This is future work with no assigned release and is outside the current
automatic-acquisition iteration.

#### Acquisition Profile Hot Reload (O20)

Reload changes to `acquisition-profiles.yaml` in the application data directory
without restarting Backend, including edits saved through atomic file replacement.
Validate the complete file before activating one consistent profile snapshot.
Invalid, incomplete or unreadable updates must retain the last valid configuration
and expose safe reload diagnostics instead of stopping the application or partially
applying a file. Refresh the available profile choices and make activation status
visible to the user.

Apply accepted changes to subsequent discovery and unreserved release assessment,
using profile fingerprints to reject stale decisions. Preserve existing download
reservations and submitted tasks; reloading must not grant acquisition permission
or change a subscription's selected source. Preserve existing per-episode waiting
history when the effective profile policy is unchanged.

Acceptance: a valid edit becomes available without a restart; a failed reload leaves
the last valid profiles usable and reports the failure; later corrected edits can
activate successfully. This is future work with no assigned release, separate from
the configuration editor (O19) and outside the current automatic-acquisition
iteration. Current acquisition profiles are still loaded only at startup.

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

The selected scope is stdout, file and simultaneous stdout/file output with Pino
routing and `rotating-file-stream` rotation/retention. File modes default to
`anishelf.log` in the platformdirs user log directory; `ANISHELF_LOG_PATH` is an
optional absolute override. Levels, JSON context, timestamps and redaction remain.
Dependencies own buffering, backpressure and output behavior. Shutdown ends the
owned file stream within the existing application shutdown lifecycle.

Custom reopening/SIGHUP handling, recovery, stderr record fallback, bounded queues
and potential-loss accounting are removed. A file stream error reports a concise
stderr diagnostic; restart after fixing the destination. These extra guarantees
are outside the current requirements. See [development logging](development.md#logging-choice)
and [deployment logging](../README.md#logging).

## 3. Rules for Future Features

These rules apply to the relevant capabilities as they are implemented. V2 applies them to progress updates, subtitle access, and media preparation; unassigned systems do not become V2 dependencies.

- **Keep states separate:** tracking, subscriptions, downloads, file availability, and viewing status are independent. Deleting a watched file must not erase its history.
- **Verify ingestion:** download completion alone does not prove that a file exists or is playable.
- **Make subscription scope explicit:** show the starting episode and backlog range. Reading an AniList list must not silently start bulk downloads. Future Watching automation may create subscriptions only within an explicitly enabled policy and accepted backlog scope (S10).
- **Allow uncertainty:** uncertain title or episode matches require review rather than forced association.
- **Recover without duplication:** polling, retries, and restarts must not create duplicate active downloads.
- **Protect original files:** cancellation and deletion are distinct. Moving files must account for seeding and path associations.
- **Preserve local playback and pending intent:** save source positions/history independently and persist accepted AniList updates before delivery; remote failures must not block playback. Pending intent is not confirmed remote state.
- **Avoid inflated progress:** keep actual source playback history separate from AniList cumulative progress and derived episode indicators. Watching a later episode must not silently imply all earlier episodes were watched.
- **Reject stale events:** delayed player updates must not overwrite newer progress or manual corrections.
- **Validate compatibility:** browser, codec, subtitle, and hardware support must be demonstrated with real media samples.

## 4. Release Plan and Suggested Evolution

V1 is implemented. The archived V2 scope selected saved progress and resume (W01), History (W02), external/styled subtitles and embedded extraction (P03 and partial P08/P09), FFmpeg pre-transcoding (P05–P07), and transferable external-player media links (C01). Web playback remains the primary path. C02 now provides platform-filtered browser invocation and browser-local custom players; C03 native state reading remains a later requirement; other unselected items remain unassigned. Automatic next-episode playback is not part of V2.

| Stage | Question to resolve | Priority candidates |
| --- | --- | --- |
| Completed: anime library | Confirmed anime and episode library from existing files; requirements and acceptance complete | L07–L10, M01–M05, M07; CAT01–CAT08 archived |
| Completed: AniList accounts | AniList-owned viewing state, unified progress/status commands and recoverable submission; accepted on 2026-10-17 | W03–W05, T01–T05; ANI01–ANI10 archived |
| Current: automatic acquisition | Can AniList Watching titles acquire new episodes without manual RSS setup? | S05, S10–S12 Watching reconciliation, source discovery and status policy; live acceptance of existing RSS/download/ingestion paths; S09 extensions remain separate |
| Optional tracking extensions | Are additional tracker capabilities needed? | T06; possible future read-only native-player state reporting (C03) |

The anime-library and AniList accounts iterations are complete and archived. No next
release number is assigned. The current automatic-acquisition iteration includes the pending Watching-to-acquisition workflow (S05, S10–S12) and live acceptance of the implemented RSS/download/ingestion path. See [current iteration requirements](current-requirement.md).
Playback enhancements such as HLS, next-episode continuation and broader subtitle
compatibility are separate candidates. Select one independently verifiable user workflow
before promoting future requirements into an active iteration. AniList remains the
viewing-state authority; an independent local tracking/import workflow is not selected.

Library automation improvements L15–L17 remain future, unassigned work and do not displace core workflows. Their suggested order is Batch Review, matching improvements from representative real failures, then learning from manual corrections. Batch correction provides immediate user control; broader automatic reuse follows only after its evidence and conflict boundaries are validated.

### Single-user authentication acceptance

Authentication is enabled for every deployment. A missing credential file creates
one random password and displays it once after startup; using it does not require
an immediate password change. Existing files are preserved. Invalid credentials
or unavailable persistence fail closed. Users can sign in/out and change the
password with their current password; local CLI or manual credential replacement
provides recovery without Web access. All sessions and media links become invalid
after password change, or after restart for manual edits. Plaintext passwords do
not enter persistent application logging or settings APIs.

Business APIs and media assets require authentication, including HEAD/Range.
CSRF checks protect mutations. External-player and M3U links authorize only one
original file version for 24 hours and survive restart. Invalid, expired,
wrong-file or changed-source links are rejected. Browser logout/expiry clears
private query caches and exits playback. Caddy supplies HTTPS without Basic Auth
or an anonymous media-path exemption.
