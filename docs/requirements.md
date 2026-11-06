# Anishelf Requirements

- [1. Product Goal and Document Scope](#1-product-goal-and-document-scope)
- [2. Feature Inventory and Version Tracking](#2-feature-inventory-and-version-tracking)
- [Implemented requirements](implemented-requirements.md)
- [3. Rules for Future Features](#3-rules-for-future-features)
- [4. Improvements](#4-improvements)
- [5. Bugs](#5-bugs)
- [Completed automatic acquisition requirements and design](history.md#automatic-acquisition-archive-notes)
- [Completed AniList accounts requirements](history.md#anilist-accounts-requirements)
- [Completed anime library requirements](history.md#anime-library-requirements)
- [Archived V2 requirements](history.md#v2-requirements)

## 1. Product Goal and Document Scope

Anishelf is a personal animation media library intended to connect:

**tracking → resource discovery → downloading → library ingestion → Web / desktop playback → viewing history → external tracker synchronization**.

Its core value is better Web playback, shared client state, and coordination between tracking and automatic downloading.

This document defines product goals, user-visible behavior, acceptance constraints,
future scope, issues, improvements and work progress. Implemented capabilities are
recorded in [Implemented requirements](implemented-requirements.md).
Requirements describe outcomes; module
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
Completed requirements are recorded in [Implemented requirements](implemented-requirements.md); archived iterations and detailed designs are in [History](history.md).
The completed anime-library, AniList accounts and automatic-acquisition iterations are archived in History.
The repository is at version 1.4.1; 1.4.2 is the planned next release. Later and Optional items remain future work.
The retained V2 implementation status remains recorded separately in History.

## 2. Feature Inventory and Version Tracking

The inventory lists partial and not-started capabilities; fully implemented capabilities
are in [Implemented requirements](implemented-requirements.md). It separates capability,
delivery state, status and delivery boundary. Keep each table cell brief; put detailed behavior, acceptance constraints
and release extensions in the corresponding notes or requirement sections.

- **Item** describes a feature, improvement or reported bug.
- **Delivery** is `Not started`, `Partial` or `Complete`, measured against the current documented scope. `—` means it has not been assessed or does not apply to the item. `Complete` does not imply universal compatibility or the absence of documented limitations.
- **Status** combines planning and work progress: `Unassigned` is recorded without a decision to schedule it; `Later` is a future core candidate; `Optional` is a possible extension; `Planned` is selected but not started; `In progress` is active; `Completed` is implemented and awaiting acceptance verification; `Verified` has passed its acceptance checks. `—` means no separate status is recorded or applicable. Record blockers and reopen items when needed. Status does not by itself assign a release.
- **Details** summarizes the delivered boundary, remaining work, reported behavior or open questions, and links to detailed notes. For partial delivery, distinguish delivered behavior from remaining work explicitly in the notes.
- **First release** records the first project release containing any delivered part of the capability, based on the existing release records. `—` means no first release is recorded or the field does not apply; `Unreleased` retains an existing “Next release” record without assigning a release number. Later extensions and release qualifications appear in delivery notes. V1 and V2 are historical iteration names, not project versions.
- Improvements and reported bugs are tracked in [Section 4](#4-improvements) and [Section 5](#5-bugs); feature work is recorded with its feature. `Planned` does not mean work has started.
- A scope reduction is a requirement decision, not a delivery state. Record excluded guarantees and relevant release history in the notes instead of using `Simplified` as a status. Split remaining work into a new ID only when it needs independent planning and acceptance.

### 2.1 Resource Access and Library

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| L15 | Batch Review with shared work selection and episode-number offset previews | Not started | Later | — | — |
| L17 | Learn scoped matching rules from explicit manual corrections | Not started | Later | — | — |

#### Batch Review (L15)

Select an explicit subset of files for a work, preview each file's existing and proposed episode associations, and apply a shared numbering offset after explicit confirmation. Preserve original parsing evidence and source history, require explicit replacement of existing associations, and reject stale or invalid inputs. Single-file correction and offset previews are delivered in the completed anime-library scope; the multi-file Web workflow is later scope.

After correcting one file, allow the user to find related files, explicitly select the batch scope and preview a shared work assignment and numbering conversion. Show per-file conflicts and exclusions before confirmation; a single correction does not authorize automatic changes to other files. Batch Review must remain usable without learned rules.

#### Learning from Manual Corrections (L17)

Learn explainable, scoped rules only from explicit user-confirmed corrections. Candidate rule types include title aliases, season/part interpretations, directory or release-batch work assignments, episode offsets, numbering-token selection, explicitly identified special/ancillary content and rejected candidates. Keep work identity and episode mapping independent; an arbitrary single-file correction must not become a general numbering rule.

Default to narrow scopes using resource root, directory, release batch, title context, work and season/part evidence. One confirmation may produce suggestions or a user-authorized batch preview; automatic reuse requires multiple independent, consistent confirmations and no conflicting evidence. Never learn new manual evidence from automatic admissions or rule-generated suggestions alone. Do not propagate offsets across unrelated directories, releases, seasons or parts, or overwrite manual decisions.

Preserve each rule's source confirmations and applicable context, explain its effect on recommendations, and support disabling or deleting rules. Replaced, revoked or stale source evidence must invalidate dependent suggestions until revalidated. Conflicting rules require Review; disabling a rule must not silently undo confirmed associations.

### 2.2 Anime Metadata

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| M06 | Multiple independently selectable metadata providers | Complete | — | Default source, per-search selection and source-isolated identities; no cross-source mapping | 1.0.6 |
| M08 | Read per-episode metadata and display episode titles on anime detail pages | Not started | Later | [Per-episode metadata and detail-page titles](#per-episode-metadata-m08); no active iteration assigned | — |
| M10 | Discover anime beyond the user's library | Not started | Later | [Anime discovery](#anime-discovery-m10) | — |

#### Delivery Notes (M)

- **M06:** **Delivered:** Independently selectable AniList/Bangumi search, a persisted default source, isolated identities and source-specific Tracking availability. Cross-source linking and metadata composition are unsupported. Title presentation supports a persisted Chinese/original/English/romaji preference; see [M09](implemented-requirements.md#title-display-preference-m09). **Release record:** 1.0.6 (partial); 1.4.2 (source-isolated identities; complete).

#### External Metadata and Local Catalog (M01–M07)

See [implemented metadata requirements](implemented-requirements.md#external-metadata-and-local-catalog-m01m07) for the current boundary. Sources are independent. Cross-source identity association, metadata composition and cross-source episode mappings are outside the supported behavior.

#### Per-episode Metadata (M08)

Read per-episode titles, descriptions, durations and air dates according to source
capabilities. The initial presentation displays episode titles on anime detail
pages while retaining episode numbers; when a title is unavailable, preserve the
existing episode label. Reading other episode fields does not require displaying
them in the initial detail-page integration.

Bangumi provides a formal episode catalog with episode identities and numbering.
AniList provides limited streaming-episode titles and airing schedules, without a
guaranteed reliable mapping between streaming titles and episode numbers. Treat
missing fields and unsupported capabilities as unavailable rather than inventing
values or assuming both sources provide equivalent episode data.

Use confirmed work and episode associations when attaching metadata to local
episodes. Uncertain correspondences remain unresolved; do not infer cross-source
identity or numbering solely from similar titles. Cache available episode metadata
and expose refresh status. Provider outages and refresh failures must preserve
cached browsing and local playback, and metadata refresh must not overwrite manual
associations or corrections.

#### Anime Discovery (M10)

Provide a dedicated discovery page for browsing anime beyond the user's local
library and tracking list. Offer ways to explore newly airing or upcoming works,
popular works and categories, and to search and filter by available attributes
such as season, year, format and genre. Show the selected metadata source and make
available ordering, filters and data reflect that source's actual capabilities;
do not invent rankings, release dates or missing fields. Support pagination or
incremental loading and retain the browsing context when returning from a work.

Show enough information to evaluate each work and open its detail page. Where
available, indicate existing local or tracking status and offer explicit actions
to manage tracking or acquisition through their existing workflows. Browsing or
opening a work must not add it to a list, create a subscription or start a download.
Keep source identities distinct and do not merge works across providers based on
similar titles. The local poster library remains a separate view.

Provide usable loading, empty, unavailable and retry states, including partial
source results and refresh failures. Preserve any available cached content without
misrepresenting its freshness. The page must be usable on desktop and narrow screens
and with keyboard navigation. Validate discovery, filtering, pagination, source
capability differences, navigation and explicit-action boundaries, including source
failures and works already present in the user's library or tracking list.

### 2.3 Web Playback and Subtitles

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| P08 | Discover/select subtitles and extract tracks packaged in video files such as MKV | Partial | Later | [Text subtitles and fonts supported; bitmap extraction pending](#delivery-notes-p) | 0.2.0 |
| P09 | Support ASS/SSA styling and fonts, plus a compatibility path for image subtitles | Partial | Unassigned | [Styled ASS/SSA and fonts supported; bitmap compatibility pending](#delivery-notes-p) | 0.2.0 |
| P14 | Begin playback during conversion, with seeking and synchronized subtitles/progress | Not started | Later | — | — |
| P16 | Extract embedded PGS/VobSub bitmap subtitle assets with explicit unsupported-Web feedback | Not started | Later | — | — |
| P12 | Hardware-accelerated transcoding | Partial | Optional | [Hardware encoding profiles supported; broader acceleration optional](#delivery-notes-p) | 0.2.0 |
| P18 | HDR playback and conversion handling | Partial | Optional | [Accepted HDR streams preserved; conversion and broader handling optional](#delivery-notes-p) | 1.4.0 |
| P20 | Configure media preparation task concurrency | Partial | Optional | [Fixed single-worker queue; configurable concurrency optional](#delivery-notes-p) | 0.2.0 |
| P21 | Limit CPU processing capacity per preparation task | Not started | Optional | — | — |
| P22 | Schedule automatic preparation within permitted time windows | Not started | Optional | — | — |

#### Delivery Notes (P)

- **P08:** **Delivered:** Text-track discovery, selection, extraction and delivery; font attachments. **Remaining:** Bitmap subtitle extraction (P16). **Release record:** 0.2.0 (text subtitles); 0.2.6 (embedded fonts).
- **P09:** **Delivered:** Styled ASS/SSA, fallback fonts and embedded TTF/OTF support. **Remaining:** Bitmap subtitle compatibility; extraction is Later under P16, while rendering, OCR and burn-in remain unassigned. **Release record:** 0.2.0 (styles and fallback fonts); 0.2.6 (embedded fonts).
- **P12:** **Delivered:** Custom preparation profiles support NVENC and QSV for H.264/HEVC/AV1, and VideoToolbox for H.264/HEVC. **Remaining:** Broader hardware acceleration. **Release record:** 0.2.0 (hardware encoding; partial).
- **P18:** **Delivered:** Automatic preparation can preserve explicitly accepted HDR streams when packaging permits. **Remaining:** Validated HDR-to-SDR conversion and broader HDR handling. **Release record:** 1.4.0 (HDR stream preservation; partial).
- **P20:** **Delivered:** A fixed single-worker queue. **Remaining:** Configurable task concurrency. **Release record:** 0.2.0 (single-worker queue; partial).

#### Media Processing Resource Controls (P20–P22)

Allow an administrator to limit the impact of media preparation on the server:

- Configure how many preparation tasks may run concurrently and limit CPU processing
  capacity per task where the selected processing method supports it. Show when a
  requested limit cannot be enforced; do not imply an exact CPU usage percentage.
- Configure permitted processing windows for automatic preparation. Work outside a
  window waits until the next window; manual preparation remains available. Define
  what happens to running work when a window closes before enabling this control.
- Expose configured limits and queued, running and waiting states, including why a
  task is waiting. Validate settings and retain the last valid configuration across
  invalid changes and restart.
- Preserve manual task priority, cancellation, recovery, cache and free-space
  protections. Applying a new limit must not corrupt active tasks or prepared files.

GPU-specific limits and exact resource enforcement depend on the selected encoder
and runtime and require separate feasibility validation. These controls extend the
existing single-worker queue and storage budgets; they are not required for basic
preparation.

#### Subtitles and Embedded Extraction (P03, Partial P08–P09)

See the [archived V2 requirements and design](history.md#v2-requirements).

#### Deferred Playback and Subtitle Requirements (P14–P16)

P14 and P16 have no assigned release. See [P15 embedded fonts](implemented-requirements.md#embedded-fonts-p15).

- **P14 Real-time playback:** begin playback before conversion finishes, with pause,
  resume and seeking into portions not yet converted. Keep subtitles and saved
  progress aligned with the original timeline. Explain buffering, failures and
  interrupted work; release unused processing resources and keep resource use
  bounded. Preserve originals and history across cancellation and restart. Delivery
  protocol, processing lifecycle and scheduling are deferred to feature design.
- **P16 Bitmap extraction:** extract supported PGS/VobSub subtitles in their native
  format, preserving required paired files and access restrictions. Explain when
  Web playback is unsupported. Rendering, OCR and burn-in remain unassigned.

#### Configuration and Storage Boundary (V2)

See the [archived V2 requirements and design](history.md#v2-requirements).

### Provider integration boundary

Additional trackers, simultaneous accounts and cross-source episode mappings remain
Later/Unassigned. See the [implemented provider boundary](implemented-requirements.md#provider-integration-boundary).

### 2.4 Viewing History and Tracking

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| W06 | Share playback history and progress across clients | Partial | Later | [Shared Web records; native client integration pending](#delivery-notes-w) | 0.2.0 |
| W12 | Handle duplicate, out-of-order, or concurrent playback progress updates | Partial | Later | [Web session ordering protected; broader client handling pending](#delivery-notes-w) | 0.2.0 |
| W07 | Record separate rewatch history | Not started | Optional | — | — |
| W09 | Rate works | Not started | Optional | — | — |
| W10 | Add personal tags to works | Not started | Optional | — | — |
| W11 | Add personal notes to works | Not started | Optional | — | — |

#### Delivery Notes (W)

- **W06:** **Delivered:** Server-backed playback history and progress shared across Web devices. **Remaining:** Native client integration. **Release record:** 0.2.0 (Web playback history and progress; partial).
- **W12:** **Delivered:** Duplicate detection, sequence ordering and newer-session precedence. **Remaining:** Broader cross-client and delayed-update handling. **Release record:** 0.2.0 (Web session protection; partial).

### 2.5 Subscriptions and Resource Discovery

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| S09 | Search multiple sources for the same acquisition | Partial | Optional | [Ordered discovery supported; multi-source comparison optional](#delivery-notes-s) | 1.0.0 |
| S13 | Rank releases across sources | Partial | Optional | [Current-source ranking supported; cross-source ranking optional](#delivery-notes-s) | 1.0.0 |
| S14 | Download and ingest season packs | Not started | Optional | — | — |
| S15 | Upgrade an existing episode to a preferred release | Not started | Optional | — | — |

#### Delivery Notes (S)

- **S09:** **Delivered:** Ordered source discovery. **Remaining:** Searching multiple sources for comparison. **Release record:** 1.0.0 (ordered discovery; partial).
- **S13:** **Delivered:** Profile-based selection and ranking within the current source. **Remaining:** Cross-source comparison. **Release record:** 1.0.0 (single-source selection; partial).

### 2.6 Downloads and Automatic Ingestion

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| D08 | Support multiple download clients | Not started | Optional | — | — |
| D11 | Configure seeding policies | Not started | Optional | — | — |
| D12 | Configure download bandwidth schedules | Not started | Optional | — | — |
| D13 | Configure download storage policies | Not started | Optional | — | — |
| D14 | Reuse verified acquisition targets during ingestion | Not started | Later | [Acquisition target reuse](#acquisition-target-reuse-d14) | — |

#### Acquisition Target Reuse (D14)

For downloads initiated by Anishelf, preserve the accepted work, episode, release
and download-task identity through completion and ingestion. When task ownership,
the completed file and its source version are verified and the file-to-episode
relationship is unambiguous, associate the file with that accepted target without
requiring another metadata search or a filename match. Reuse the confirmed target
instead of independently identifying the same file during routine scanning.

Treat a filename as supporting evidence rather than a mandatory match; a clear
contradiction must remain visible for review. Do not infer an individual episode
from task ownership alone when multiple video files, season packs or other layouts
make their correspondence ambiguous. Unverified ownership, changed or missing files,
conflicting targets and existing incompatible associations require review or retry;
never overwrite a manual decision. Preserve existing completion, path, source
version and ingestion verification, and keep transfer completion distinct from file
availability and playability.

Retain provenance and explain the accepted target and any conflict in diagnostics.
Ensure retries and restarts are idempotent and concurrent scans cannot replace a
confirmed association. Validate single-episode downloads with incomplete filenames,
contradictory names, multi-file layouts, changed files, ownership failures, manual
associations and restart or scan races. Coordinate with evidence-based decision
evaluation (WI15) and media identification during scanning (WI16).

### 2.7 Desktop and Other Clients

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| C03 | Read external-player state when the selected integration exposes it, including playing/paused state, position, and playback end | Not started | Optional | Browser invocation reads no native state | — |
| C04 | Control desktop playback, pause, and seeking from the Web | Not started | Later | — | — |
| C05 | Continue viewing between Web and desktop using saved positions | Not started | Later | — | — |
| C06 | Manage multiple devices and transfer playback sessions | Not started | Optional | — | — |
| C07 | Desktop application for Windows, macOS and Linux, with a complete local library and server or a connection to a remote Anishelf server | Not started | Later | — | — |
| C08 | Android and iOS applications for connecting to a remote Anishelf server, browsing the library and playing media | Not started | Later | — | — |
| C09 | Desktop and mobile playback with resume, track and subtitle selection, and progress reporting consistent with Web | Not started | Later | — | — |
| C10 | Prefer original media when compatible; offer an appropriate compatible version when available and explain playback failures or unavailable options | Not started | Later | — | — |
| C11 | Mobile picture-in-picture playback | Not started | Optional | — | — |
| C13 | Mobile background playback | Not started | Optional | — | — |
| C14 | Mobile offline viewing | Not started | Optional | — | — |
| C12 | Casting | Not started | Optional | — | — |

Desktop clients should provide library management and acquisition alongside playback;
mobile clients prioritize touch-friendly browsing and playback. Both require an
authenticated server connection for server-backed operations. Cross-client progress
must account for concurrent and delayed updates (W12); native playback integrations
must report progress before they can support reliable continuation (C05). Offline
viewing and advanced playback capabilities are not part of the initial client scope.
A TV application is outside the planned scope.

The proposed implementation and staged validation are in the
[future client design](development/clients.md).

### 2.8 External Tracking Services

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| T06 | Connect and synchronize multiple tracking services | Not started | Optional | — | — |
| T07 | Synchronize ratings with tracking services | Not started | Optional | — | — |
| T08 | Support advanced rewatch synchronization | Not started | Optional | — | — |

### 2.9 Interface, Settings, and Maintenance

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| O03 | Dashboard for continued viewing, new episodes, downloads, and exceptions | Not started | Later | — | — |
| O05 | Task history, logs, and automation decision explanations | Partial | Later | [Acquisition activity and diagnostics; broader history pending](#delivery-notes-o) | 1.0.0 |
| O06 | Back up and restore metadata, viewing history, and configuration | Not started | Later | — | — |
| O09 | Support multiple users and permissions | Not started | Optional | — | — |
| O19 | In-app editor for hand-written configuration files | Not started | Later | [Draft, validate and save supported custom profiles](#delivery-notes-o) | — |
| O20 | Hot reload acquisition profile configuration | Not started | Later | [Validate and activate acquisition profiles without restart](#delivery-notes-o) | — |
| O23 | Support multi-node deployments | Not started | Unassigned | — | — |

#### Proposed feature work

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| WI07 | Dynamically load configuration | — | Unassigned | Define which configuration is loaded dynamically and when changes take effect. Acquisition profile hot reload is already described under O20; determine whether this proposal extends that scope. | — |

#### Delivery Notes (O)

- **O05:** **Delivered:** Durable per-anime acquisition activity, decision reasons, safe correlated logs and terminal-detail retention. **Remaining:** Broader product history. **Release record:** 1.0.0 (acquisition; partial).
- **O19:** Edit and validate supported custom profile files, including acquisition and transcode profiles.
- **O20:** Validate and activate acquisition-profiles.yaml changes without restarting Backend; retain the last valid configuration on reload failure.

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

#### Logging Maintenance (O11–O13)

See [implemented requirements](implemented-requirements.md#logging-maintenance-o11o13).

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

## 4. Improvements

These entries improve existing capabilities. Feature IDs retain their original
status and delivery information; work IDs track specific proposed changes. All
item tables use the same columns, with `—` where a value is not recorded or applicable.
Details and acceptance criteria may be refined as decisions are made.

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| L16 | Improve matching using representative real-world failure cases | Not started | Later | — | — |
| P26 | Improve transcoding progress display | Not started | Unassigned | [Transcoding progress](#transcoding-progress-p26) | — |
| P27 | Improve prepared-media file management | Not started | Unassigned | [Prepared-media file management](#prepared-media-file-management-p27) | — |
| WI01 | Review tracking-service completion error feedback | — | Unassigned | For “Could not load or update the tracking service completion.”, decide whether to use a dialog or display the error directly, and consider recovery. | — |
| WI03 | Optimize resource matching | — | Unassigned | Improve the accuracy of matching resource-search results to the intended work and episode. | — |
| WI05 | Redesign automatic subscription management interaction | Complete | Completed | Review the existing interaction and define the desired workflow. | — |
| WI09 | Improve automatic acquisition frequency | — | Unassigned | Review the current frequency and define the desired scheduling behavior. | — |
| WI10 | Prevent interface flicker when adding a work | Complete | Completed | [Library and detail refresh continuity](implemented-requirements.md#library-and-detail-refresh-continuity-wi10) | — |
| WI12 | Improve resource-search title matching and feedback | Not started | Unassigned | [Title matching and result feedback](#resource-search-improvements-wi12) | — |
| WI15 | Improve evidence-based decisions and their evaluation | Not started | Unassigned | [Evidence-based decision quality](#evidence-based-decision-quality-wi15) | — |
| WI16 | Identify media by its actual contents | Not started | Unassigned | [Media identification during scanning](#media-identification-during-scanning-wi16) | — |

#### Matching Improvements from Real Failures (L16)

Collect representative local failure cases with user-confirmed expected works and episode mappings, preserving filename, directory and release provenance. Diagnose extraction, candidate retrieval, ranking, numbering and admission separately. Prioritize recurring failures such as shortened titles, season/part ambiguity, continuous numbering and end-of-series markers; do not lower admission thresholds solely to improve corpus coverage.

#### Transcoding Progress (P26)

Make manual and automatic transcoding progress easy to understand in the task
monitor. Identify the affected media and show whether the task is queued, running,
completed, failed or cancelled. While running, show available progress and estimated
remaining time when reliable; otherwise indicate that progress or the estimate is
unavailable rather than presenting a misleading value. Keep progress current, show
failure and recovery information, and retain access to applicable task actions.
The display must remain usable on desktop and narrow screens.

#### Prepared-media File Management (P27)

Provide a central view of generated media copies so users can understand and manage
their disk usage. Show total usage and the configured cache budget, and identify
each copy by its source media, size and availability. Provide useful search or
filtering and allow users to select and explicitly delete individual copies or
multiple copies together. Show the expected impact before deletion and report
successes and failures, including partial failures.

Account for copies in use or involved in active preparation, and explain when a
copy cannot yet be removed. Keep the view and storage totals current after cleanup.
Deleting a prepared copy must preserve the original media, playback history and
settings; automatic preparation may make the source eligible for preparation again.
Do not silently delete valid copies when the cache budget is lowered.

#### Resource Search Improvements (WI12)

- **WI12:** Improve matching between a work's titles and resource-search results.
  Explain whether results matched or were rejected and provide useful reasons for
  uncertain or unsuccessful searches. Preserve the distinction between a candidate
  and a confirmed match; do not accept uncertain results solely to increase matches.

#### Evidence-based Decision Quality (WI15)

Improve decisions that depend on incomplete observations, naming conventions,
similarity, ranking or thresholds. Coordinate filename and resource matching with
L16 and WI03/WI12 rather than treating the same failure as separate acceptance
work. Review and improve, as applicable:

- Filename and directory parsing, title normalization, season and part evidence,
  candidate retrieval and ranking, automatic admission, episode mapping and
  directory-based numbering conversions.
- Cross-provider name correspondence and candidate retrieval; release-title
  identity, episode and attribute extraction; and acquisition filtering and version
  selection with missing, stale or unreliable source observations.
- Download-completion observations, video discovery by filename, external subtitle
  association and language labels, browser playback compatibility, media acceptance
  and preparation, playback completion and near-end decisions, and processing
  progress estimates.

For each decision, document its evidence, assumptions, unknown and conflicting
states, consequences and limits. Improve accuracy and useful coverage while
measuring false positive and false negative outcomes separately. Keep uncertainty
visible or require review where evidence cannot justify an automatic action; do not
weaken identity, episode, download authorization or original-file safeguards merely
to increase coverage. A ranking score is not a probability unless independently
calibrated and presented as such. A reported download completion does not prove
successful ingestion, and a browser capability report does not guarantee playback.
Preserve the existing names-only boundary for cross-provider enrichment.

Maintain versioned evaluation datasets with independently reviewed expected results,
source and capture provenance, rationale, and explicit unknown or unresolved labels.
Extend the existing identification and title-enrichment corpora; add representative
fixtures or datasets for the remaining decisions, including authentic failures,
hard negatives, missing and contradictory data, boundary values, and relevant
device/media observations. Preserve privacy and permissions when collecting cases.
Use family-separated development and holdout cases where tuning can leak related
examples, and record known sampling and ground-truth limitations. Include separately
captured search and pagination cases to assess retrieval as well as candidate
verification; do not describe a controlled candidate pool as end-to-end recall.

Provide reproducible offline evaluations and reports per decision and relevant
case category, including denominators, false admissions or unsafe actions, missed
matches and unresolved outcomes where applicable. Establish reviewed baselines and
explicit regression criteria before making them gates; include deterministic,
maintainable checks in the normal test or CI workflow, and document any separately
run real-device, network or media validation and its results. Compare changes with
the baseline and holdout set, investigate regressions, and update expectations only
with evidence rather than to make a test pass. Log decision reasons and evidence
needed for diagnosis without exposing sensitive information or excessive per-item
output. Report limitations instead of claiming universal accuracy or compatibility.

#### Media Identification During Scanning (WI16)

Improve resource discovery to identify video from actual media evidence rather than
relying solely on its filename extension. Discover valid video with misleading,
unrecognized or missing extensions, and distinguish it from non-video files using
video extensions. Identify the container and streams when evidence is available;
do not treat an extension or a successful container identification alone as proof
that a video stream exists or that the file is playable.

Keep unexamined, confirmed-video, confirmed-non-video and inconclusive results
distinct. An unavailable tool, unreadable or still-changing file, timeout, malformed
file or incomplete inspection must not be presented as a conclusive non-video
result. Preserve previously indexed resources and their associations when inspection
is inconclusive, provide useful diagnostics and allow a later retry. Confirmed
non-video results must not be automatically admitted as videos. Preserve root access
and symbolic-link boundaries, and never modify source files during inspection.

Make initial and incremental scans usable for large libraries: bound inspection
resources, support cancellation, reuse results only while tied to the same file
version, and re-evaluate changed files. Define candidate discovery so that supported
videos without conventional extensions can be found without claiming that every
file was fully verified when inspection is limited. Surface scan progress and
incomplete results without blocking access to existing library data. Format
identification is separate from playback compatibility and complete-file integrity.

Validate the behavior with representative real or synthetic media and non-media
fixtures, including misleading and absent extensions, audio-only containers,
damaged and incomplete files, unavailable inspection, changed files, and large
directory scans. Record coverage and limitations alongside WI15 evaluation work.

## 5. Bugs

Reported bugs may require reproduction and confirmation. Record observed and expected
behavior, impact, reproduction conditions and verification evidence as they become known.

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
