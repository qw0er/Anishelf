# Anishelf Requirements

- [1. Product Goal and Document Scope](#1-product-goal-and-document-scope)
- [2. Feature Inventory and Version Tracking](#2-feature-inventory-and-version-tracking)
- [3. Rules for Future Features](#3-rules-for-future-features)
- [4. Release Plan and Suggested Evolution](#4-release-plan-and-suggested-evolution)
- [Completed automatic acquisition requirements and design](history.md#automatic-acquisition-archive-notes)
- [Completed AniList accounts requirements](history.md#anilist-accounts-requirements)
- [Completed anime library requirements](history.md#anime-library-requirements)
- [Archived V2 requirements](history.md#v2-requirements)

## 1. Product Goal and Document Scope

Anishelf is a personal animation media library intended to connect:

**tracking → resource discovery → downloading → library ingestion → Web / desktop playback → viewing history → external tracker synchronization**.

Its core value is better Web playback, shared client state, and coordination between tracking and automatic downloading.

This document retains the product goal, delivered feature inventory and future evolution.
Completed requirements and detailed designs are retained in [History](history.md).
The completed anime-library, AniList accounts and automatic-acquisition iterations are archived in History.
Multi-root resource management (L12) is implemented.
The repository is at version 1.2.0. Later and Optional items remain future work.
The retained V2 implementation status remains recorded separately in History.

## 2. Feature Inventory and Version Tracking

- **Implemented in** records the first project release containing the delivered capability, based on Git history. Where meaningful extensions shipped later, their releases are identified separately. `—` means no implementation is recorded; partial delivery is explicitly identified. V1 and V2 are historical iteration names; the corresponding project versions are recorded below.
- **Selected** identifies planned work for the next iteration, not delivered implementation.
- **Later** identifies a subsequent core capability; **Optional** identifies a possible longer-term extension.
- For partial delivery, describe the delivered boundary and keep the remainder explicit.

### 2.0 Delivered V1 Foundation

| ID | Feature | Delivered scope | Implemented in |
| --- | --- | --- | --- |
| V01 | Resource directory configuration | Original single-root setup; multiple persisted roots and per-root feedback are delivered under L12 | 0.1.0 |
| V02 | Library scanning | Automatic scans at startup and after resource-root changes; native filesystem monitoring and manual rescans; recursive video discovery; repeated scans without duplicate paths; additions and removals reflected | 0.1.0; 0.4.1 (filesystem monitoring) |
| V03 | Resource browsing | Actual directory hierarchy, original filenames, stable natural sorting, and parent navigation | 0.1.0 |
| V04 | Web playback | Browser direct playback through bounded media streams and byte ranges | 0.1.0 |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory | 0.1.0 |
| V06 | Failure feedback | Missing/unreadable resources and unsupported-media or playback errors | 0.1.0 |

V1 includes read-only originals, resource-root confinement, persistent root settings, and visible scan states. Subtitle loading, saved progress, and media preparation are V2 additions.

### 2.1 Resource Access and Library

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| L05 | Search filenames and choose sorting | Later | — |
| L06 | Watch filesystem changes and update the library incrementally | Implemented: native recursive monitoring, path-scoped resource updates, directory-scoped identification and Catalog publications, degraded-state recovery | 0.4.1 |
| L07 | Parse anime titles, seasons, episode numbers, and release variants from filenames | Implemented: filename/directory extraction with preserved evidence | 0.3.0 |
| L08 | Review unidentified files and manually link or correct anime and episode associations | Implemented: clear-match automatic admission, manual Review and revision-checked corrections | 0.3.0 |
| L09 | Distinguish regular episodes, specials, continuous season numbering, and multi-episode files | Implemented: candidate-specific episode proposals, unresolved ambiguity and confirmed corrections | 0.3.0 |
| L10 | Associate multiple file versions with an episode and select a version for playback | Implemented: Catalog associations and Web version selection with source-version checks | 0.3.0 |
| L11 | Relink moved files while preserving viewing history | Later | — |
| L12 | Configure and manage multiple resource roots | Implemented: up to 64 non-overlapping paths, per-root Files entries, scoped identities, partial scan recovery, legacy settings/history upgrade | 0.4.1 |
| L13 | Rename, organize, delete, and reclaim storage with preservation rules | Optional | — |
| L14 | Download an existing original media file from the Web interface to the user's device | Implemented | 0.2.5 |
| L15 | Batch Review with shared work selection and episode-number offset previews | Later | — |
| L16 | Improve matching using representative real-world failure cases | Later | — |
| L17 | Learn scoped matching rules from explicit manual corrections | Later | — |

The poster library supports Title, Recently added, Recently updated and Unwatched
first sorting. Unwatched first is the default: works with locally available episodes
beyond the tracking provider's cumulative progress precede other works; each group
uses title order. Unknown progress and remote-only works receive no unwatched priority.
Recently updated uses the local Catalog work update timestamp; remote-only works use
the provider list-entry update timestamp, falling back to the list fetch time.
Recently added retains local Catalog creation-time ordering. This poster sorting
delivery does not complete L05 filename search and sorting in Files.

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
without discarding history. Filesystem watching is delivered separately under L06. Identity-preserving moved-file relinking remains
future scope under L11.

#### Filesystem Monitoring and Incremental Updates (L06)

Watch the configured resource root recursively for file and directory additions, modifications, removals and moves. Use these changes to refresh affected library entries automatically, without waiting for a scheduled full scan. Coalesce bursts of events and wait for actively written files to stabilize before identification or media inspection. Preserve resource-root restrictions, manual associations and viewing history; identity-preserving relinking of moved files remains L11.

Keep startup scanning and explicit manual rescans for initial discovery and reconciliation. Scheduled full scans are removed; known monitoring failures trigger recovery reconciliation. Detect unavailable monitoring or lost events, report degraded monitoring and provide reconciliation and retry; an inaccessible root must not be treated as an empty library. See [Filesystem monitoring](development/architecture.md#resource-directory-isolation).

#### Batch Review (L15)

Select an explicit subset of files for a work, preview each file's existing and proposed episode associations, and apply a shared numbering offset through Catalog-owned correction operations. Preserve original parsing evidence and source history, require explicit replacement of existing associations, and reject stale or invalid inputs. Single-file correction and offset previews are delivered in the completed anime-library scope; the multi-file Web workflow is later scope.

After correcting one file, allow the user to find related files, explicitly select the batch scope and preview a shared work assignment and numbering conversion. Show per-file conflicts and exclusions before confirmation; a single correction does not authorize automatic changes to other files. Batch Review must remain usable without learned rules.

#### Matching Improvements from Real Failures (L16)

Collect representative local failure cases with user-confirmed expected works and episode mappings, preserving filename, directory and release provenance. Diagnose extraction, candidate retrieval, ranking, numbering and admission separately. Prioritize recurring failures such as shortened titles, season/part ambiguity, continuous numbering and end-of-series markers; do not lower admission thresholds solely to improve corpus coverage.

#### Learning from Manual Corrections (L17)

Learn explainable, scoped rules only from explicit user-confirmed corrections. Candidate rule types include title aliases, season/part interpretations, directory or release-batch work assignments, episode offsets, numbering-token selection, explicitly identified special/ancillary content and rejected candidates. Keep work identity and episode mapping independent; an arbitrary single-file correction must not become a general numbering rule.

Default to narrow scopes using resource root, directory, release batch, title context, work and season/part evidence. One confirmation may produce suggestions or a user-authorized batch preview; automatic reuse requires multiple independent, consistent confirmations and no conflicting evidence. Never learn new manual evidence from automatic admissions or rule-generated suggestions alone. Do not propagate offsets across unrelated directories, releases, seasons or parts, or overwrite manual decisions.

Preserve each rule's source confirmations and applicable context, explain its effect on recommendations, and support disabling or deleting rules. Replaced, revoked or stale source evidence must invalidate dependent suggestions until revalidated. Conflicting rules require Review; disabling a rule must not silently undo confirmed associations.

#### Resource Identification (L07–L10)

Parse filenames and directory context into identification evidence; external metadata supplies candidates and episode/work relationships. Rank candidates using titles and aliases, year, season/part, format and episode information when available. Show reasons and unresolved conflicts; similar candidates or unknown episode mappings require review. Parser output and match scores are evidence, not authoritative identities or probabilities.

Use consistent title normalization for ranking and admission, retain explicit ordinal provenance and never assume an unmarked title is season one. Publication-local continuous-number conversion requires distinct, agreeing filename anchors within the same directory, season and work; cross-directory propagation, relation-order offsets and conflicting numbering remain unresolved. Zero numbering requires explicit identity confirmation. Review preserves original numbers, offers candidate-specific mappings and shows the same admission blockers used by the runtime and evaluator.

Preserve raw parsed numbering separately from confirmed episode associations, including specials, continuous numbering and multi-episode files. Keep anime, episodes, source files, file-to-episode associations and provider identifiers separate. Manual corrections survive rescans and metadata refresh; reassociation never silently deletes source playback history. Multiple versions of an episode remain selectable without counting as separate episodes.

#### Download Existing Media (L14)

- Provide a download action for an individual library file, preserving its original filename and contents.
- Transfer the existing original file without transcoding or modifying the server copy.
- Apply the same resource-root restrictions and access controls as playback; report missing or unreadable files.
- Initially exclude batch downloads, directory archives, and managed offline libraries.

This is a user-facing file download, separate from acquiring new releases through qBittorrent (D01–D08). File actions and the player's More playback options menu provide **Download video**. The action rechecks file access and starts a native browser download from the original-media route with the original filename, without buffering the complete file in JavaScript. Automatic acquisition through qBittorrent is delivered separately under D01–D07; its completed iteration is archived in History.

### 2.2 Anime Metadata

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| M01 | Search external anime metadata and store provider identifiers | Implemented: AniList and Bangumi search behind permanent project work IDs; external source identifiers retained through associations | 0.3.0 (AniList); 1.0.6 (multi-source) |
| M02 | Display covers, aliases, descriptions, seasons, episode counts, airing information, and available same-provider work relations | Implemented: cached details, artwork, available episode data and same-provider relations | 0.3.0 |
| M03 | Provide anime detail and episode views, organizing the library by title | Implemented: default poster library, work details, episode/version playback and file-list location from available-version actions | 0.3.0; 1.0.6 (file location) |
| M04 | Manually select, correct, and refresh metadata mappings | Implemented: Review selection/reassociation, episode corrections and metadata refresh | 0.3.0 |
| M05 | Cache metadata so external outages do not prevent browsing or playback | Implemented: durable metadata/artwork caching, refresh/retry and retained snapshots during outages | 0.3.0 |
| M07 | Preserve multilingual program titles, aliases and descriptions with language tags, original language and locale-independent IDs | Implemented: available provider language information and stable local identities; no invented translations | 0.3.0 |
| M06 | Multiple metadata providers and cross-provider ID mapping | Partial: AniList/Bangumi search, explicit verified work associations, combined descriptions and permanent ID aliases; automatic cross-source matching, association management UI and cross-source episode mappings remain unassigned | 1.0.6 (partial) |

#### External Metadata and Local Catalog (M01–M07)

External anime metadata is a dependency of the delivered identification workflow, not a later tracker integration. Metadata searches AniList and Bangumi behind application-owned contracts. Ordinary search, detail, relation, schedule and artwork access uses permanent project work IDs; external source identifiers are translated through a separate association capability. Retain available aliases, language information, episode data and work relations according to source capabilities. Keep local Catalog work and episode identities separate from external source IDs. Cache fetched metadata with refresh status and preserve user corrections. Outages must not block already-cached browsing or existing file playback; unavailable candidate or episode information remains explicitly unresolved.

Explicit cross-source work association requires confirmation of both work identity and equivalent regular-episode numbering. The target project ID remains canonical and previously issued IDs remain resolvable aliases. Associated sources contribute descriptions in stable source order; equal titles alone never establish identity. Associations do not merge local Catalog works, episodes or files, and conflicting existing local works must be reconciled first. Automatic cross-source matching, an association management UI and independent cross-source episode mappings remain unassigned. Bangumi schedules, relations and a canonical episode catalog are not currently supplied.

Provider and parser uncertainty is handled through Review; representative recognition accuracy measurement is not required for the completed anime-library iteration. Seanime is a workflow reference, not a mandated dependency. Provider-required service access is distinct from T01–T05 personal account authorization, personal list access and viewing-state updates; basic identification must not require the user to authorize a personal tracker account.

Available episode versions expose Show in Files through their file action menu. It resolves the current parent directory on demand, opens Files and scrolls to, focuses and highlights the corresponding file row without starting playback. Multiple versions target their own files; unavailable versions expose no file commands. Detailed interaction conventions remain in the [design system](development/design-system.md).

### 2.3 Web Playback and Subtitles

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| P03 | Select or disable external VTT/SRT/ASS/SSA subtitles through Vidstack | Implemented | 0.2.0 |
| P05 | Choose a playback strategy based on media and client capabilities | Implemented | 0.2.0 |
| P06 | Remux media when only the container is incompatible | Implemented | 0.2.0 |
| P07 | FFmpeg full-file pre-transcoding with seeking; copy compatible streams and encode only necessary streams | Implemented: completed-file preparation, reuse, cancellation, retry and recovery | 0.2.0 |
| P08 | Discover/select subtitles and extract tracks packaged in video files such as MKV | Partial: text-track discovery, selection, extraction and delivery implemented; font attachments supported; bitmap extraction deferred | 0.2.0 (text subtitles); 0.2.6 (embedded fonts) |
| P09 | Support ASS/SSA styling and fonts, plus a compatibility path for image subtitles | Partial: styled ASS/SSA and fallback fonts implemented, with embedded TTF/OTF support; bitmap handling deferred | 0.2.0 (styles and fallback fonts); 0.2.6 (embedded fonts) |
| P14 | HLS/fMP4 delivery and real-time transcoding, including seeking, leases, source-time mapping and interactive scheduling | Later | — |
| P15 | Extract, validate and load embedded font attachments | Implemented: source-shared TTF/OTF preparation, validated cache and JASSUB loading | 0.2.6 |
| P16 | Extract embedded PGS/VobSub bitmap subtitle assets with explicit unsupported-Web feedback | Later | — |
| P17 | Automatically prepare full-file Web-compatible copies in the background before playback | Later | — |
| P10 | Select audio tracks, adjust subtitle timing, change playback speed, and use shortcuts | Implemented | 0.2.0 |
| P11 | Next-episode navigation and automatic continuation | Later | — |
| P12 | Hardware transcoding, HDR handling, broader browser support, and advanced concurrency policies beyond the V2 bounded scheduler | Optional | — |
| P13 | Chapter navigation | Implemented: chapter discovery, source-time mapping and player chapter tracks | 0.2.6 |

The player prioritizes video and common playback controls on desktop and narrow screens.
Secondary commands and routine technical explanations are available on demand through
More and playback options; unavailable-playback recovery and consequential tracking
decisions remain discoverable. Subtitle controls stay in Vidstack. The compact layout
is implemented.
See the [player layout conventions](development/design-system.md#player-layout).

#### FFmpeg Full-file Preparation (P05–P07)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Automatic Background Pre-transcoding (P17)

Allow users to enable automatic background preparation for newly scanned or ingested resources under an explicit target playback profile. Reuse existing inspection, compatibility planning and full-file preparation: retain direct-playable originals, remux when sufficient and encode only necessary streams. Deduplicate by source version and preparation profile, reuse valid completed copies, and bound concurrency and cache usage. Provide queue/progress/failure feedback, cancellation and retry; recover after restart without duplicate work and invalidate changed sources. Preserve original files and source-level history. This adds automatic scheduling before playback to the existing preparation capability; it is outside the current anime-library iteration and has no assigned release.

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Deferred Playback and Subtitle Requirements (P14–P16)

P14 and P16 remain outside V2 with no assigned release. P15 is implemented as a subsequent extension:

- **P14 HLS and real-time playback:** serve completed and live HLS/fMP4 playlists and complete segments; prefer valid completed resources and copy compatible streams. Begin playback before full conversion; support pause/resume and seeking beyond generated ranges by restarting near the requested source time. Map progress and subtitle clocks to source time. Expose starting/streaming/buffering/completed/stopped/failed states and corresponding UI. Stop and clean old processing on exit, expired lease, repeated seeks, source invalidation, failure or shutdown. Bound shared concurrency/storage and prioritize interactive work with explicit interruption/requeue feedback. Preserve history/originals and reject stale generations after restart.
- **P15 Embedded fonts:** ASS/SSA selection prepares source-shared TTF/OTF attachments on demand, validates bytes and cached identities, enforces count/size/cache limits and supplies fonts to JASSUB. Attachment names never become filesystem paths. Preparation or download failures preserve subtitles with fallback feedback and retry. External ASS/SSA and prepared-copy playback use attachments from the original video. Exact missing-family/glyph diagnosis and broad font/browser certification remain unverified.
- **P16 Bitmap extraction:** extract supported PGS/VobSub in native representation, preserving paired files and access/cache protections; show explicit unsupported-Web feedback. Web rendering, OCR and burn-in remain separately unassigned.

#### Configuration and Storage Boundary (V2)

See the [archived V2 requirements and design](history.md#v2-requirements).

### Provider integration boundary

Metadata and Tracking use provider-owned adapters behind application-owned contracts.
Metadata currently supports AniList and Bangumi through permanent project work IDs;
source identities and explicit associations are separate from ordinary content access.
Tracking supports one AniList account, with AniList authoritative for its viewing state
and cumulative episode progress. Product-owned viewing statuses, explicit target
resolution outcomes and capability checks isolate Library and Playback from provider
protocols. Additional Tracking providers, simultaneous accounts and evidence-backed
cross-source episode mappings remain Later/Unassigned. Metadata work association does
not provide Bangumi Tracking or arbitrary episode-number conversion. See the
[provider integration design](development/architecture.md#source-organization-and-dependency-boundaries).

### 2.4 Viewing History and Tracking

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| W01 | Save playback position and duration and resume playback | Implemented | 0.2.0 |
| W02 | History page with recent viewing records and resume/replay | Implemented; History covers continue watching | 0.2.0 |
| W03 | Detect episode completion and submit progress updates or manual corrections to AniList | Implemented: unified detail/player commands and 90-percent/natural-end completion with 30-second normal-play minimum | 0.4.0 |
| W04 | Display and update AniList tracking statuses | Implemented: remote display/filters and manual status updates | 0.4.0 |
| W05 | Show watched counts and available unwatched episodes from AniList progress, alongside local playback history | Implemented: detail indicators/counts and Library available-unwatched counts | 0.4.0 |
| W06 | Share records across clients and handle duplicate, out-of-order, or concurrent progress updates | Later | — |
| W07 | Rewatch history, ratings, tags, and personal notes | Optional | — |

#### Episode Viewing and Tracking (W03–W05)

AniList is the authority for anime viewing status and cumulative episode progress. Display its tracked titles and supported statuses, and submit automatic completion updates and manual progress/status corrections to AniList. Reuse confirmed local work/episode associations and provider identifiers; mapping is already delivered and is not a new implementation requirement. Keep source playback positions and local playback history independent from AniList state. Multiple file versions must not increment progress repeatedly.

AniList cumulative progress does not provide an independent watched/unwatched flag for every episode. Derived episode indicators must be labeled as based on AniList progress, rather than exact local per-episode viewing records. Watching a later episode must not silently imply earlier episodes were watched: noncontiguous completion requires an explicit cumulative-progress decision. The selected automatic policy requires reaching 90 percent of the source timeline or natural source end, plus 30 seconds of normal wall-clock playback in the current session. Seeks, resume restoration, pauses and buffering add no normal time; playback speed does not multiply it. Player manual marks require no telemetry. All entry points share durable Tracking commands and result states; persisted manual versions prevent late automatic observations from overriding explicit corrections. Do not introduce a separate authoritative local tracking list or per-episode watched-state store.

### 2.5 Subscriptions and Resource Discovery

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| S01 | Enable or pause RSS discovery from an anime's own page | Implemented; download submission separate | 1.0.0 |
| S02 | Set and preserve a subscription starting episode and backlog scope | Implemented: fixed creation lower bound and revision-checked edits; global Watching activation previews impact | 1.0.0 |
| S03 | Configure RSS and discover releases periodically | Implemented: one RSS per anime, shared conditional fetches and durable scheduling with a configurable global interval (default 30 minutes) | 1.0.0 |
| S04 | Match releases to titles and episodes and explain uncertain matches | Implemented: uncertain releases are automatically skipped without review | 1.0.0 |
| S05 | Filter by subtitle language, release group, resolution, codec, and keywords | Implemented for RSS, manual search and opt-in Watching: built-in/custom YAML selection profiles | 1.0.0 |
| S06 | Deduplicate and exclude existing files, active downloads, and unwanted episodes | Implemented: discovery identities, accessible local episodes and downloader hashes; durable canonical-hash and work/episode reservations before submission | 1.0.0 |
| S07 | Explain decisions and automatically choose one release per episode | Implemented: profile levels, persisted waiting, seed-count tie-breaking and skipped reasons; manual selection/dismissal outside the simplified scope | 1.0.0 |
| S08 | Coordinate tracking-status changes with subscriptions and explain their effect on existing tasks | Implemented: Watching controls automatic subscriptions by current list membership; manual subscriptions and submitted transfers/imports remain independent | 1.0.0; 1.0.6 (independent subscriptions) |
| S09 | Search multiple sources, rank releases, process season packs, and upgrade quality | Optional | — |
| S10 | Automatically subscribe to anime in AniList Watching | Implemented: default-off Watching creation with session-bound preview, fixed starting scope and recreation exclusions; automatic subscriptions remain group-managed; manual subscriptions take precedence | 1.0.0 |
| S11 | Find a suitable release source without entering an RSS URL for each anime | Implemented: ordered configured-site discovery with Anime identity assessment, S05 profiles, pinned sources and unresolved states | 1.0.0 |
| S12 | Keep manual and automatic subscription management independent | Implemented: Tracking status changes and automation disable stop automatic acquisition; manual controls remain independent and completed ranges stop source polling | 1.0.6 |

The completed subscription scope is [archived](history.md#automatic-acquisition-requirements).
RSS selects candidates automatically without per-release approval; accepted scopes
enable the download worker.
#### AniList Watching to Automatic Acquisition (S05, S10–S12)

The delivered workflow is: add an anime to AniList Watching, let Anishelf find a suitable resource source and maintain its subscription, then automatically download new episodes through qBittorrent and verify their ingestion into the local library. Users configure resource sites, release preferences, destination and automation scope once; routine additions to Watching should not require finding and entering a per-anime RSS URL or approving every episode.

Subscriptions share a source-selection/download engine but have separate management
ownership. Watching is a default-off automatic group with a session-bound activation
preview, account binding, a group switch and per-work exclusions. Manual subscriptions
take precedence; saving an automatic subscription in the explicitly labeled work editor
converts it to manual ownership. Manual pause, resume and cancellation remain independent.
Disabling the group, excluding a work or leaving Watching stops automatic discovery,
refresh and new download submissions; submitted transfers/imports continue. List outages
retain records and suspend automatic acquisition until a fresh complete snapshot returns.
The starting episode freezes at creation; progress changes never reset it. Account,
source/profile/target scope changes and late responses respect accepted scope and revision
checks. Unsubscribe records automatic-recreation exclusions. Empty or ambiguous source
results retain intent without authorizing guessed downloads.

Both management types complete when every episode in the saved range through a known
total is locally available. Completion preserves records and stops source polling; it does
not follow tracking progress or pending downloads. Explicit resume overrides the completed
range, while a larger metadata total rechecks coverage and may reopen acquisition subject
to the manual pause and automatic group gates. Unknown totals never auto-complete.

Settings owns global configuration and help. Work details use a compact Header row,
a short defaults-first editor and an on-demand Activity dialog with secondary History
and lazy grouped Diagnostics. No source-search/resource-sample step is required before
subscribing. The user marked this iteration complete on 2026-10-24. See the
[archived requirements and design](history.md#automatic-acquisition-archive-notes)
and the maintained [UI conventions](development/design-system.md#automatic-acquisition).

Background subscription updates preserve an open editor's inputs and accepted revision.
Check now retries pending discovery without its local scheduling delay. Diagnostics
retains the latest site attempts across restart. Once refreshed detail data includes
local resources, the page automatically opens local episodes and preserves the
library's return filters.

Full season-pack ingestion is not supported by the current one-selected-video import path.

### 2.6 Downloads and Automatic Ingestion

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| D01 | Connect to qBittorrent and validate configuration and download-path mappings | Implemented: private API settings, connection test and one root/path mapping with incomplete-directory validation; actual shared visibility verified during import | 1.0.0 |
| D02 | Submit releases, persist task associations, and prevent duplicate submissions | Implemented: persisted intent, canonical identity/reservations, per-anime placement and uncertain-outcome reconciliation | 1.0.0 |
| D03 | Display acquisition state, progress and errors | Implemented: compact detail Activity; real percentage and import states; speed/seeding details in WebUI | 1.0.0 |
| D04 | Manage downloads and recover acquisitions | Implemented: transfer pause/resume/removal delegated to WebUI; scoped acquisition/import retries in Anishelf | 1.0.0 |
| D05 | Check completed files, scan them, and associate them with episodes | Implemented: confined file verification, targeted Resources refresh, Anime association/Review and independent import retry | 1.0.0 |
| D06 | Recover from disconnections, externally removed tasks, and server restarts | Implemented: stale observations, durable bindings, restart reconciliation and external-removal suppression | 1.0.0 |
| D07 | Distinguish task cancellation, downloaded-data deletion, and library-record removal | Implemented boundary: task/data deletion in WebUI, Catalog decisions in existing local workflows; deletion never triggers automatic re-adding | 1.0.0 |
| D08 | Multiple download clients, seeding policies, bandwidth schedules, and storage policies | Optional | — |

The [qBittorrent adapter foundation](development/architecture.md#task-execution-and-recovery) also supplies low-level
submission, observations and control commands. The current acquisition workflow adds
persistence, reconciliation, per-anime placement and verified ingestion. Transfer
controls use WebUI; compact detail Activity supplies status and recovery without a
global download-management page. See [archived acquisition requirements](history.md#automatic-acquisition-requirements).

### 2.7 Desktop and Other Clients

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| C01 | Generate a transferable original-media URL or single-file M3U playlist for manual opening in an external player | Implemented | 0.2.0 (media URL); 0.2.1 (M3U) |
| C02 | Invoke platform-compatible external players through browser protocol links; manage browser-local custom URL templates in Settings | Implemented | 0.2.1 |
| C03 | Read external-player state when the selected integration exposes it, including playing/paused state, position, and playback end | Optional later capability; browser invocation reads no native state | — |
| C04 | Control desktop playback, pause, and seeking from the Web | Later | — |
| C05 | Continue viewing between Web and desktop using saved positions | Later | — |
| C06 | Manage multiple devices and transfer playback sessions | Optional | — |
| C07 | Full desktop, mobile, and TV apps, casting, and offline viewing | Optional | — |

#### External-Player Media Links (C01)

See the [archived V2 requirements and design](history.md#v2-requirements).

### 2.8 External Tracking Services

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| T01 | Authorize AniList, display the connected account, check connectivity, and disconnect | Implemented: PIN token preview/confirmation, private credentials, reconnection and generation fencing | 0.4.0 |
| T02 | Read, cache and refresh the connected account's AniList lists and viewing state | Implemented: complete account-scoped snapshots, stale/error feedback, unified local/remote Library and viewing-state details | 0.4.0 |
| T03 | Reuse existing work/episode mappings to submit viewing progress and tracking-status updates to AniList | Implemented: manual updates and mapped automatic episode completion | 0.4.0 |
| T04 | Persist pending updates, coalesce superseded updates, retry failures, report expired authorization, and show results | Implemented: manual commands and durable playback handoff | 0.4.0 |
| T05 | Detect remote changes before retrying pending updates and resolve conflicts without silently overwriting newer state | Implemented for manual and playback commands; upstream read/write race remains | 0.4.0 |
| T06 | Multiple trackers, rating synchronization and advanced rewatch support | Optional | — |

#### AniList Accounts: Selected Scope

AniList is the viewing-state authority. This iteration selects account connection, cached list access, progress/status submissions, durable retries and remote-conflict handling. It reuses existing work/episode mappings and keeps local playback history independent. Independent local tracking, list import/export and reimport merging are excluded.

[Archived AniList accounts requirements](history.md#anilist-accounts-requirements) retain the completed scope and consistency rules. Current implementation ownership is maintained in [Architecture](development/architecture.md).

### 2.9 Interface, Settings, and Maintenance

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| O03 | Dashboard for continued viewing, new episodes, downloads, and exceptions | Later | — |
| O04 | Unified settings for directories and integrations | Implemented: shared Settings sections for resource roots, playback/preparation, external players, acquisition services, tracking account, security and About | 1.0.3 (settings scope) |
| O05 | Task history, logs, and automation decision explanations | Partial: durable per-anime acquisition activity, decision reasons, safe correlated logs and terminal-detail retention; broader product history remains later | 1.0.0 (acquisition; partial) |
| O06 | Back up and restore metadata, viewing history, and configuration | Later | — |
| O07 | LAN access, single-user authentication, and credential protection | Implemented: single password, independent hash file, persistent Cookie sessions, CSRF, login limits, local recovery and 24-hour scoped media links; remote access through TLS proxy with explicit container proxy trust and Secure session cookies | 0.3.3; 1.0.1 (secure proxy sessions) |
| O08 | In-app completion and failure feedback | Implemented: scan result Toasts and preparation results in the floating task monitor | 0.2.0 |
| O09 | Multiple users, permissions, public deployment support, and remote access | Optional | — |
| O10 | Plugin extensions and public integration APIs | Optional | — |
| O11 | Log rotation, retention, and reopening files without restarting the application | Implemented: dependency-managed size/time rotation and archive retention; custom reopening removed | 0.2.6 |
| O12 | Automatic log-output fallback after destination failure | Simplified: stdout/file/both routing; output failures follow dependency defaults | 0.2.6; 1.0.0 (simplified) |
| O13 | Asynchronous log output with bounded buffering and shutdown flushing | Simplified: dependency-owned buffering and file-stream shutdown; no custom queue guarantees | 0.2.6; 1.0.0 (simplified; partial) |
| O14 | Interface localization and language preferences | Implemented: English and Simplified Chinese, browser language detection, language selection and browser-local preference | 0.2.0 (English foundation); 1.2.0 (Simplified Chinese and selection) |
| O15 | Manage API-backed frontend state and caching with TanStack Query | Implemented | 0.2.0 |
| O17 | Unified configuration | TypeScript policy defaults, validated user overrides and typed access; built-in cache budget | 0.2.0 |
| O18 | User-editable prepared-media cache budget | Implemented; Settings control, validation and persisted disk-space limit | 0.2.6 |
| O19 | In-app editor for hand-written configuration files | Later: edit and validate supported custom profile files, including acquisition and transcode profiles | — |
| O20 | Hot reload acquisition profile configuration | Later: validate and activate acquisition-profiles.yaml changes without restarting Backend; retain the last valid configuration on reload failure | — |
| O21 | Interactive remote deployment without a repository checkout | Implemented: GitHub-delivered Bash wizard, Docker/Podman auto-detection (choice only when both exist), Docker Compose/rootless Podman Quadlet, optional advanced settings, fresh-file generation, shared SELinux labeling, optional services and runtime health checks | 1.0.0; 1.1.0 (deployment refactor) |

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
history when the effective profile policy is unchanged. Current acquisition profiles are loaded only at startup.

#### Unified Configuration (O17)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Interface Localization (O14)

- Introduce translation resources for interface labels, status messages, and user-facing errors, with English as the default and fallback language.
- Allow users to select a supported language and persist that preference.
- Keep API field names, error codes, resource IDs, and original filenames unchanged across languages.

The Web interface supports English and Simplified Chinese. A saved browser-local preference takes precedence; otherwise the browser's preferred languages select a supported language, with English as the fallback. Users can change the language from the header. The completed anime-library iteration separately delivers program metadata (M07): preserve available language-tagged titles, aliases and descriptions, original language and stable IDs, using exact locale, base language, original language and deterministic available-value fallback.

#### Frontend State and Caching (O15)

- Use TanStack Query to manage API-backed server state in the Web interface, including resource listings, scan status, and saved settings.
- Define stable query keys and suitable freshness and retention policies for each kind of data. Reuse fresh results and deduplicate concurrent requests for the same data.
- After a successful scan or settings change, update or invalidate the affected queries so subsequent views reflect the server's latest state.
- Keep loading, refresh, and error feedback visible; a failed refresh must not silently present cached data as current.
- Limit this cache to API-backed data. Media playback streams and local-only interface or player state are outside its scope.

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
are outside the current requirements. See [development logging](development/README.md#logging-choice)
and [deployment logging](guide/operations.md#operational-log-levels).

## 3. Rules for Future Features

These rules apply to the relevant capabilities as they are implemented. V2 applies them to progress updates, subtitle access, and media preparation; unassigned systems do not become V2 dependencies.

- **Keep states separate:** tracking, subscriptions, downloads, file availability, and viewing status are independent. Deleting a watched file must not erase its history.
- **Verify ingestion:** download completion alone does not prove that a file exists or is playable.
- **Make subscription scope explicit:** show the starting episode and backlog range. Reading an AniList list must not silently start bulk downloads. Watching creates subscriptions only within an explicitly enabled policy and accepted backlog scope (S10).
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
| Completed: anime library | Confirmed anime and episode library from existing files; requirements complete | L07–L10, M01–M05, M07 archived |
| Completed: AniList accounts | AniList-owned viewing state, unified progress/status commands and recoverable submission | W03–W05, T01–T05 archived |
| Completed: automatic acquisition | Watching creates ordinary subscriptions with background discovery, scoped downloads and verified ingestion; compact work-detail UI | S01–S08, S10–S12, D01–D07; requirements/design archived on 2026-10-24; S09 remains optional |
| Optional tracking extensions | Are additional tracker capabilities needed? | T06; possible future read-only native-player state reporting (C03) |

The anime-library, AniList accounts and automatic-acquisition iterations are complete
and archived. No next active iteration or next release number is selected. Playback enhancements such as HLS, next-episode continuation and broader subtitle
compatibility are separate candidates. Select one independently verifiable user workflow
before promoting future requirements into an active iteration. AniList remains the
viewing-state authority; an independent local tracking/import workflow is not selected.

Library automation improvements L15–L17 remain future, unassigned work and do not displace core workflows. Their suggested order is Batch Review, matching improvements from representative real failures, then learning from manual corrections. Batch correction provides immediate user control; broader automatic reuse follows only after its evidence and conflict boundaries are validated.

### Single-user authentication

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
