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

This document defines product goals, user-visible behavior, acceptance constraints,
delivered capabilities and future scope. Requirements describe outcomes; module
ownership, API shapes, persistence mechanisms, libraries and algorithms belong in
[Architecture](development/architecture.md), [Playback design](development/playback.md)
and the [Design system](development/design-system.md). Operational prerequisites
belong in the [operator guides](guide/README.md).

Implementation descriptions and release records do not make a particular mechanism
mandatory for future changes. A design may evolve while preserving the product
requirements. When implementation and current documents disagree, verify the intended
behavior and update the affected documents together; do not silently treat an old
implementation choice as a new requirement. Future features specify outcomes and
acceptance boundaries without selecting their technical solution in advance.
Completed requirements and detailed designs are retained in [History](history.md).
The completed anime-library, AniList accounts and automatic-acquisition iterations are archived in History.
Multi-root resource management (L12) is implemented.
The repository is at version 1.3.0. Later and Optional items remain future work.
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
| V04 | Web playback | Browser playback of supported original media with seeking | 0.1.0 |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory | 0.1.0 |
| V06 | Failure feedback | Missing/unreadable resources and unsupported-media or playback errors | 0.1.0 |

Original V1 delivered read-only originals, resource-root confinement, persistent root settings, and visible scan states. L13 adds explicit confirmed moves and deletion. Subtitle loading, saved progress, and media preparation are V2 additions.

### 2.1 Resource Access and Library

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| L05 | Search filenames and choose sorting | Implemented: recursive name search and natural-name, size, or modification-time sorting | 1.3.0 |
| L06 | Watch filesystem changes and update the library incrementally | Implemented: automatic updates for affected files and folders, with monitoring failure recovery | 0.4.1 |
| L07 | Parse anime titles, seasons, episode numbers, and release variants from filenames | Implemented: filename/directory extraction with preserved evidence | 0.3.0 |
| L08 | Review unidentified files and manually link or correct anime and episode associations | Implemented: clear-match automatic admission, manual Review and protection against conflicting corrections | 0.3.0 |
| L09 | Distinguish regular episodes, specials, continuous season numbering, and multi-episode files | Implemented: candidate-specific episode proposals, unresolved ambiguity and confirmed corrections | 0.3.0 |
| L10 | Associate multiple file versions with an episode and select a version for playback | Implemented: episode associations and Web version selection with changed-file protection | 0.3.0 |
| L12 | Configure and manage multiple resource roots | Implemented: multiple non-overlapping paths, separate Files entries, partial scan recovery and preserved settings/history | 0.4.1 |
| L13 | Move and delete files or folders with preservation rules | Implemented: direct confirmed same-filesystem moves and recursive deletion; retained decisions/history and writable deployment | 1.3.0 |
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

#### Move and delete resources (L13)

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

#### Batch Review (L15)

Select an explicit subset of files for a work, preview each file's existing and proposed episode associations, and apply a shared numbering offset after explicit confirmation. Preserve original parsing evidence and source history, require explicit replacement of existing associations, and reject stale or invalid inputs. Single-file correction and offset previews are delivered in the completed anime-library scope; the multi-file Web workflow is later scope.

After correcting one file, allow the user to find related files, explicitly select the batch scope and preview a shared work assignment and numbering conversion. Show per-file conflicts and exclusions before confirmation; a single correction does not authorize automatic changes to other files. Batch Review must remain usable without learned rules.

#### Matching Improvements from Real Failures (L16)

Collect representative local failure cases with user-confirmed expected works and episode mappings, preserving filename, directory and release provenance. Diagnose extraction, candidate retrieval, ranking, numbering and admission separately. Prioritize recurring failures such as shortened titles, season/part ambiguity, continuous numbering and end-of-series markers; do not lower admission thresholds solely to improve corpus coverage.

#### Learning from Manual Corrections (L17)

Learn explainable, scoped rules only from explicit user-confirmed corrections. Candidate rule types include title aliases, season/part interpretations, directory or release-batch work assignments, episode offsets, numbering-token selection, explicitly identified special/ancillary content and rejected candidates. Keep work identity and episode mapping independent; an arbitrary single-file correction must not become a general numbering rule.

Default to narrow scopes using resource root, directory, release batch, title context, work and season/part evidence. One confirmation may produce suggestions or a user-authorized batch preview; automatic reuse requires multiple independent, consistent confirmations and no conflicting evidence. Never learn new manual evidence from automatic admissions or rule-generated suggestions alone. Do not propagate offsets across unrelated directories, releases, seasons or parts, or overwrite manual decisions.

Preserve each rule's source confirmations and applicable context, explain its effect on recommendations, and support disabling or deleting rules. Replaced, revoked or stale source evidence must invalidate dependent suggestions until revalidated. Conflicting rules require Review; disabling a rule must not silently undo confirmed associations.

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

External anime metadata is a dependency of the delivered identification workflow, not a later tracker integration. Users can search AniList and Bangumi metadata and continue accessing works after verified cross-source association. Retain available aliases, language information, episode data and work relations according to source capabilities. Provider changes must not silently replace confirmed local work or episode associations. Cache fetched metadata with refresh status and preserve user corrections. Outages must not block already-cached browsing or existing file playback; unavailable candidate or episode information remains explicitly unresolved.

Explicit cross-source work association requires confirmation of both work identity and equivalent regular-episode numbering. Existing work references remain usable after association. Associated sources contribute descriptions in stable source order; equal titles alone never establish identity. Associations do not merge local Catalog works, episodes or files, and conflicting existing local works must be reconciled first. Automatic cross-source matching, an association management UI and independent cross-source episode mappings remain unassigned. Bangumi schedules, relations and a canonical episode catalog are not currently supplied.

Provider and parser uncertainty is handled through Review. Provider-required service access is distinct from T01–T05 personal account authorization, personal list access and viewing-state updates; basic identification must not require the user to authorize a personal tracker account.

Available episode versions expose Show in Files through their file action menu. It opens the corresponding file in Files without starting playback. Multiple versions target their own files; unavailable versions expose no file commands. Detailed interaction conventions remain in the [design system](development/design-system.md).

### 2.3 Web Playback and Subtitles

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| P03 | Select or disable external VTT/SRT/ASS/SSA subtitles | Implemented | 0.2.0 |
| P05 | Choose a playback strategy based on media and client capabilities | Implemented | 0.2.0 |
| P06 | Remux media when only the container is incompatible | Implemented | 0.2.0 |
| P07 | Prepare full-file Web-compatible copies with seeking and avoid unnecessary re-encoding | Implemented: completed-file preparation, reuse, cancellation, retry and recovery | 0.2.0 |
| P08 | Discover/select subtitles and extract tracks packaged in video files such as MKV | Partial: text-track discovery, selection, extraction and delivery implemented; font attachments supported; bitmap extraction deferred | 0.2.0 (text subtitles); 0.2.6 (embedded fonts) |
| P09 | Support ASS/SSA styling and fonts, plus a compatibility path for image subtitles | Partial: styled ASS/SSA and fallback fonts implemented, with embedded TTF/OTF support; bitmap handling deferred | 0.2.0 (styles and fallback fonts); 0.2.6 (embedded fonts) |
| P14 | Begin playback during conversion, with seeking and synchronized subtitles/progress | Later | — |
| P15 | Extract, validate and load embedded font attachments | Implemented: validated embedded TTF/OTF fonts for styled subtitles | 0.2.6 |
| P16 | Extract embedded PGS/VobSub bitmap subtitle assets with explicit unsupported-Web feedback | Later | — |
| P17 | Automatically prepare full-file Web-compatible copies in the background before playback | Later | — |
| P10 | Select audio tracks, adjust subtitle timing, change playback speed, and use shortcuts | Implemented | 0.2.0 |
| P11 | Next-episode navigation and automatic continuation | Implemented: consecutive local regular episodes, explicit version choice and opt-in browser-local continuation with cancellable countdown | Next release |
| P12 | Hardware transcoding, HDR handling, broader browser support, and advanced processing resource controls | Optional | — |
| P13 | Chapter navigation | Implemented: chapter discovery and navigation aligned with the original timeline | 0.2.6 |

The player prioritizes video and common playback controls on desktop and narrow screens.
Secondary commands and routine technical explanations are available on demand through
More and playback options; unavailable-playback recovery and consequential tracking
decisions remain discoverable. Subtitle controls remain accessible within the player.
See the [player layout conventions](development/design-system.md#player-layout).

#### Full-file Preparation (P05–P07)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Automatic Background Pre-transcoding (P17)

Allow users to opt into background preparation of Web-compatible copies for newly
scanned or ingested resources under a chosen playback profile. Avoid unnecessary
conversion and duplicate work, reuse usable completed copies and bound resource use.
Show queued work, progress and failures; support cancellation, retry and restart
recovery. Changed originals must not reuse outdated preparation results. Preserve
originals and playback history. This capability has no assigned release.

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Deferred Playback and Subtitle Requirements (P14–P16)

P14 and P16 have no assigned release. P15 is delivered.

- **P14 Real-time playback:** begin playback before conversion finishes, with pause,
  resume and seeking into portions not yet converted. Keep subtitles and saved
  progress aligned with the original timeline. Explain buffering, failures and
  interrupted work; release unused processing resources and keep resource use
  bounded. Preserve originals and history across cancellation and restart. Delivery
  protocol, processing lifecycle and scheduling are deferred to feature design.
- **P15 Embedded fonts:** use valid embedded TTF/OTF fonts for ASS/SSA subtitles,
  including external subtitles and playback of prepared copies. Font failures must
  preserve usable subtitles with fallback feedback and retry. Exact missing-font
  diagnosis and broad browser compatibility certification remain unverified.
- **P16 Bitmap extraction:** extract supported PGS/VobSub subtitles in their native
  format, preserving required paired files and access restrictions. Explain when
  Web playback is unsupported. Rendering, OCR and burn-in remain unassigned.

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

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| W01 | Save playback position and duration and resume playback | Implemented | 0.2.0 |
| W02 | History page with recent viewing records and resume/replay | Implemented; History covers continue watching | 0.2.0 |
| W03 | Detect episode completion and submit progress updates or manual corrections to AniList | Implemented: unified detail/player commands and 90-percent/natural-end completion with 30-second normal-play minimum | 0.4.0 |
| W04 | Display and update AniList tracking statuses | Implemented: remote display/filters and manual status updates | 0.4.0 |
| W05 | Show watched counts and available unwatched episodes from AniList progress, alongside local playback history | Implemented: detail indicators/counts and Library available-unwatched counts | 0.4.0 |
| W06 | Share records across clients and handle duplicate, out-of-order, or concurrent progress updates | Later | — |
| W07 | Rewatch history, ratings, tags, and personal notes | Optional | — |
| W08 | Treat rewatching as active viewing across Library and Watching automation | Implemented: distinct tracking status with shared active-viewing behavior; see requirements below | — |

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

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| S01 | Enable or pause RSS discovery from an anime's own page | Implemented; download submission separate | 1.0.0 |
| S02 | Set and preserve a subscription starting episode and backlog scope | Implemented: fixed starting episode and protection against conflicting edits; global Watching activation previews impact | 1.0.0 |
| S03 | Configure RSS and discover releases periodically | Implemented: one RSS per anime, reliable recurring discovery with a configurable global interval (default 30 minutes) | 1.0.0 |
| S04 | Match releases to titles and episodes and explain uncertain matches | Implemented: uncertain releases are automatically skipped without review | 1.0.0 |
| S05 | Filter by subtitle language, release group, resolution, codec, and keywords | Implemented for RSS, manual search and opt-in Watching: built-in/custom YAML selection profiles | 1.0.0 |
| S06 | Deduplicate and exclude existing files, active downloads, and unwanted episodes | Implemented: exclude duplicate releases, available local episodes and already active acquisitions, including across restart | 1.0.0 |
| S07 | Explain decisions and automatically choose one release per episode | Implemented: profile levels, persisted waiting, seed-count tie-breaking and skipped reasons; manual selection/dismissal outside the simplified scope | 1.0.0 |
| S08 | Coordinate tracking-status changes with subscriptions and explain their effect on existing tasks | Implemented: Watching controls automatic subscriptions by current list membership; manual subscriptions and submitted transfers/imports remain independent | 1.0.0; 1.0.6 (independent subscriptions) |
| S09 | Search multiple sources, rank releases, process season packs, and upgrade quality | Optional | — |
| S10 | Automatically subscribe to anime in AniList Watching | Implemented: default-off Watching creation with explicit activation preview, fixed starting scope and recreation exclusions; automatic subscriptions remain group-managed; manual subscriptions take precedence | 1.0.0 |
| S11 | Find a suitable release source without entering an RSS URL for each anime | Implemented: ordered configured-site discovery with Anime identity assessment, S05 profiles, pinned sources and unresolved states | 1.0.0 |
| S12 | Keep manual and automatic subscription management independent | Implemented: Tracking status changes and automation disable stop automatic acquisition; manual controls remain independent and completed ranges stop source polling | 1.0.6 |

The completed subscription scope is [archived](history.md#automatic-acquisition-requirements).
RSS selects candidates automatically without per-release approval; accepted scopes
enable the download worker.
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

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| D01 | Connect to qBittorrent and validate configuration and download-path mappings | Implemented: private connection settings, connection test and one root/path mapping with incomplete-directory validation; actual shared visibility verified during import | 1.0.0 |
| D02 | Submit releases, persist task associations, and prevent duplicate submissions | Implemented: saved acquisition requests, duplicate prevention, per-anime placement and recovery from uncertain submissions | 1.0.0 |
| D03 | Display acquisition state, progress and errors | Implemented: compact detail Activity; real percentage and import states; speed/seeding details in WebUI | 1.0.0 |
| D04 | Manage downloads and recover acquisitions | Implemented: transfer pause/resume/removal delegated to WebUI; scoped acquisition/import retries in Anishelf | 1.0.0 |
| D05 | Check completed files, scan them, and associate them with episodes | Implemented: safe file verification, library refresh, episode association/Review and independent import retry | 1.0.0 |
| D06 | Recover from disconnections, externally removed tasks, and server restarts | Implemented: stale observations, durable bindings, restart reconciliation and external-removal suppression | 1.0.0 |
| D07 | Distinguish task cancellation, downloaded-data deletion, and library-record removal | Implemented boundary: task/data deletion in WebUI, Catalog decisions in existing local workflows; deletion never triggers automatic re-adding | 1.0.0 |
| D08 | Multiple download clients, seeding policies, bandwidth schedules, and storage policies | Optional | — |

Users manage transfer pause, resume and removal in qBittorrent WebUI. Anishelf
provides acquisition status, recovery and verified library ingestion from work
details. A global download-management page is outside the delivered scope.

### 2.7 Desktop and Other Clients

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| C01 | Generate a transferable original-media URL or single-file M3U playlist for manual opening in an external player | Implemented | 0.2.0 (media URL); 0.2.1 (M3U) |
| C02 | Invoke platform-compatible external players through browser protocol links; manage browser-local custom URL templates in Settings | Implemented | 0.2.1 |
| C03 | Read external-player state when the selected integration exposes it, including playing/paused state, position, and playback end | Optional later capability; browser invocation reads no native state | — |
| C04 | Control desktop playback, pause, and seeking from the Web | Later | — |
| C05 | Continue viewing between Web and desktop using saved positions | Later | — |
| C06 | Manage multiple devices and transfer playback sessions | Optional | — |
| C07 | Desktop application for Windows, macOS and Linux, with a complete local library and server or a connection to a remote Anishelf server | Later | — |
| C08 | Android and iOS applications for connecting to a remote Anishelf server, browsing the library and playing media | Later | — |
| C09 | Desktop and mobile playback with resume, track and subtitle selection, and progress reporting consistent with Web | Later | — |
| C10 | Prefer original media when compatible; offer an appropriate compatible version when available and explain playback failures or unavailable options | Later | — |
| C11 | Mobile picture-in-picture, background playback and offline viewing | Optional | — |
| C12 | Casting | Optional | — |

Desktop clients should provide library management and acquisition alongside playback;
mobile clients prioritize touch-friendly browsing and playback. Both require an
authenticated server connection for server-backed operations. Cross-client progress
must account for concurrent and delayed updates (W06); native playback integrations
must report progress before they can support reliable continuation (C05). Offline
viewing and advanced playback capabilities are not part of the initial client scope.
A TV application is outside the planned scope.

The proposed implementation and staged validation are in the
[future client design](development/clients.md).

#### External-Player Media Links (C01)

See the [archived V2 requirements and design](history.md#v2-requirements).

### 2.8 External Tracking Services

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| T01 | Authorize AniList, display the connected account, check connectivity, and disconnect | Implemented: token preview/confirmation, private credentials and safe account reconnection | 0.4.0 |
| T02 | Read, cache and refresh the connected account's AniList lists and viewing state | Implemented: complete account-scoped snapshots, stale/error feedback, unified local/remote Library and viewing-state details | 0.4.0 |
| T03 | Reuse existing work/episode mappings to submit viewing progress and tracking-status updates to AniList | Implemented: manual updates and mapped automatic episode completion | 0.4.0 |
| T04 | Persist pending updates, coalesce superseded updates, retry failures, report expired authorization, and show results | Implemented: manual and playback updates retained across failures and restart | 0.4.0 |
| T05 | Detect remote changes before retrying pending updates and resolve conflicts without silently overwriting newer state | Implemented for manual and playback commands; upstream read/write race remains | 0.4.0 |
| T06 | Multiple trackers, rating synchronization and advanced rewatch support | Optional | — |

#### AniList Accounts: Delivered Scope

AniList is the viewing-state authority. The delivered scope includes account connection, cached list access, progress/status submissions, durable retries and remote-conflict handling. It reuses existing work/episode mappings and keeps local playback history independent. Independent local tracking, list import/export and reimport merging are excluded.

[Archived AniList accounts requirements](history.md#anilist-accounts-requirements) retain the completed scope and consistency rules. Current implementation ownership is maintained in [Architecture](development/architecture.md).

### 2.9 Interface, Settings, and Maintenance

| ID | Feature | Scope | Implemented in |
| --- | --- | --- | --- |
| O03 | Dashboard for continued viewing, new episodes, downloads, and exceptions | Later | — |
| O04 | Unified settings for directories and integrations | Implemented: shared Settings sections for resource roots, playback/preparation, external players, acquisition services, tracking account, security and About | 1.0.3 (settings scope) |
| O05 | Task history, logs, and automation decision explanations | Partial: durable per-anime acquisition activity, decision reasons, safe correlated logs and terminal-detail retention; broader product history remains later | 1.0.0 (acquisition; partial) |
| O06 | Back up and restore metadata, viewing history, and configuration | Later | — |
| O07 | LAN access, single-user authentication, and credential protection | Implemented: single-password access, persistent sign-in, protected mutations, login limits, local recovery and 24-hour file-specific media links; secure sessions through an HTTPS proxy | 0.3.3; 1.0.1 (secure proxy sessions) |
| O08 | In-app completion and failure feedback | Implemented: scan result Toasts and preparation results in the floating task monitor | 0.2.0 |
| O09 | Multiple users, permissions, public deployment support, and remote access | Optional | — |
| O10 | Plugin extensions and public integration APIs | Optional | — |
| O11 | Log rotation and retention | Implemented: size/time rotation and archive retention; live file reopening excluded | 0.2.6 |
| O12 | Automatic log-output fallback after destination failure | Simplified: stdout/file/both routing; automatic recovery not provided | 0.2.6; 1.0.0 (simplified) |
| O13 | Reliable diagnostic log output | Simplified: normal shutdown closes output; guaranteed bounded buffering and loss accounting are not provided | 0.2.6; 1.0.0 (simplified; partial) |
| O14 | Interface localization and language preferences | Implemented: English and Simplified Chinese, browser language detection, language selection and browser-local preference | 0.2.0 (English foundation); 1.2.0 (Simplified Chinese and selection) |
| O15 | Keep displayed server data responsive and consistent | Implemented | 0.2.0 |
| O17 | Unified configuration | Implemented: consistent defaults and validated user overrides; built-in cache budget | 0.2.0 |
| O18 | User-editable prepared-media cache budget | Implemented; Settings control, validation and persisted disk-space limit | 0.2.6 |
| O19 | In-app editor for hand-written configuration files | Later: edit and validate supported custom profile files, including acquisition and transcode profiles | — |
| O20 | Hot reload acquisition profile configuration | Later: validate and activate acquisition-profiles.yaml changes without restarting Backend; retain the last valid configuration on reload failure | — |
| O21 | Remote deployment without a repository checkout | Implemented: non-interactive flag-driven Docker/Podman deployment, optional services and advanced settings, generated configuration and health feedback | 1.0.0; 1.1.0 (deployment refactor) |

#### User-editable Prepared-media Cache Budget (O18)

Allow users to configure and persist a disk-space limit for generated media copies
through Settings. Preserve the choice across upgrades and enforce it for subsequent
preparation. Account for retained in-use copies and distinguish cache exhaustion
from insufficient disk space. Lowering the limit must not silently delete existing
copies; provide explicit cleanup. Preserve originals, history and settings.

#### Configuration File Editor (O19)

Provide an in-app editing panel for supported configuration files that currently
require manual file editing, initially custom acquisition and transcode profile
YAML files. Show the current content, documented examples and field guidance;
allow users to edit a draft, validate it, explicitly
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
rejecting decisions based on outdated configuration. Preserve existing download
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

## 3. Rules for Future Features

These acceptance constraints apply to relevant delivered and future capabilities.
Unassigned features do not become dependencies of selected work.

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

V1 is implemented. The archived V2 scope selected saved progress and resume (W01), History (W02), external/styled subtitles and embedded extraction (P03 and partial P08/P09), FFmpeg pre-transcoding (P05–P07), and transferable external-player media links (C01). Web playback remains the primary path. C02 now provides platform-filtered browser invocation and browser-local custom players; C03 native state reading remains a later requirement; other unselected items remain unassigned. Automatic next-episode playback was outside V2; P11 is now implemented as a separate extension.

| Stage | Question to resolve | Priority candidates |
| --- | --- | --- |
| Completed: anime library | Confirmed anime and episode library from existing files; requirements complete | L07–L10, M01–M05, M07 archived |
| Completed: AniList accounts | AniList-owned viewing state, unified progress/status commands and recoverable submission | W03–W05, T01–T05 archived |
| Completed: automatic acquisition | Watching creates ordinary subscriptions with background discovery, scoped downloads and verified ingestion; compact work-detail UI | S01–S08, S10–S12, D01–D07; requirements/design archived on 2026-10-24; S09 remains optional |
| Optional tracking extensions | Are additional tracker capabilities needed? | T06; possible future read-only native-player state reporting (C03) |

The anime-library, AniList accounts and automatic-acquisition iterations are complete
and archived. No next active iteration or next release number is selected. Playback enhancements such as HLS and broader subtitle compatibility remain separate
candidates. P11 adds navigation within the current confirmed work and opt-in automatic
continuation, independently of AniList viewing state. Select one independently verifiable user workflow
before promoting future requirements into an active iteration. AniList remains the
viewing-state authority; an independent local tracking/import workflow is not selected.

Library automation improvements L15–L17 remain future, unassigned work and do not displace core workflows. Their suggested order is Batch Review, matching improvements from representative real failures, then learning from manual corrections. Batch correction provides immediate user control; broader automatic reuse follows only after its evidence and conflict boundaries are validated.

### Single-user authentication

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
