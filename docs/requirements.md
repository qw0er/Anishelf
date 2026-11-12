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

This document tracks product behavior, future work and issues. See
[Implemented requirements](implemented-requirements.md) for completed capabilities,
[History](history.md) for archived iterations, and the [operator guides](guide/README.md)
for operational prerequisites. Technical design belongs in
[Architecture](development/architecture.md), [Playback design](development/playback.md)
and the [Design system](development/design-system.md).

Requirements describe outcomes rather than prescribing implementation. When code and
documentation disagree, verify the intended behavior and update the affected documents.
The current release is 1.6.3; 1.7.0 is upcoming.

## 2. Feature Inventory and Version Tracking

The inventory tracks partial and not-started capabilities. Keep table entries brief;
record detailed behavior, acceptance criteria and delivery boundaries in the notes.

- **Item** describes a feature, improvement or reported bug.
- **Delivery** measures the documented scope: `Not started`, `Partial` or `Complete`. `—` means unassessed or inapplicable. Complete items may still have documented limitations.
- **Status** records planning and progress: `Block` awaits a prerequisite identified in the notes; `Low priority` is deferred; `Later` is planned for future implementation; `Optional` is a possible extension; `Completed` covers both implementation and acceptance. Status does not assign a release.
- **Details** links to notes on behavior, open questions and, for partial work, what is delivered and remains.
- **First release** is the first release containing any part of the capability. `—` means none is recorded or applicable; `Unreleased` means not yet released. V1 and V2 are historical iteration names, not releases.

Record scope exclusions and release qualifications in the notes. Split remaining work
into a new ID when it needs independent planning and acceptance.

### 2.1 Resource Access and Library

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| L15 | Batch Review with shared work selection and episode-number offset previews | Not started | Low priority | — | — |
| L17 | Learn scoped matching rules from explicit manual corrections | Not started | Low priority | — | — |

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
| M08 | Read per-episode metadata and display episode titles on anime detail pages | Not started | Low priority | [Per-episode metadata and detail-page titles](#per-episode-metadata-m08); no active iteration assigned | — |
| M10 | Discover anime beyond the user's library | Not started | Optional | [Anime discovery](#anime-discovery-m10) | — |

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
| P20 | Configure media preparation task concurrency | Partial | Optional | [Fixed single-worker queue; configurable concurrency optional](#delivery-notes-p) | 0.2.0 |
| P21 | Limit CPU processing capacity per preparation task | Not started | Optional | — | — |
| P29 | Automatically play the next episode after playback ends | Not started | Optional | — | — |

#### Delivery Notes (P)

- **P20:** **Delivered:** A fixed single-worker queue. **Remaining:** Configurable task concurrency. **Release record:** 0.2.0 (single-worker queue; partial).

#### Media Processing Resource Controls (P20–P21)

Allow an administrator to limit the impact of media preparation on the server:

- Configure how many preparation tasks may run concurrently and limit CPU processing
  capacity per task where the selected processing method supports it. Show when a
  requested limit cannot be enforced; do not imply an exact CPU usage percentage.
- Expose configured limits and queued, running and waiting states, including why a
  task is waiting. Validate settings and retain the last valid configuration across
  invalid changes and restart.
- Preserve manual task priority, cancellation, recovery and free-space
  protections. Applying a new limit must not corrupt active tasks or prepared files.

GPU-specific limits and exact resource enforcement depend on the selected encoder
and runtime and require separate feasibility validation. These controls extend the
existing single-worker queue and free-space protection; they are not required for basic
preparation.

#### Configuration and Storage Boundary (V2)

See the [archived V2 requirements and design](history.md#v2-requirements).

### Provider integration boundary

Simultaneous accounts and cross-source episode mappings remain future work. See the [implemented provider boundary](implemented-requirements.md#provider-integration-boundary).

### 2.4 Viewing History and Tracking

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| W06 | Share playback history and progress across clients | Partial | Block | [Shared Web records; native client integration blocked](#delivery-notes-w) | 0.2.0 |
| W07 | Record separate rewatch history | Not started | Optional | — | — |
| W09 | Rate works | Not started | Optional | — | — |
| W10 | Add personal tags to works | Not started | Optional | — | — |
| W11 | Add personal notes to works | Not started | Optional | — | — |

#### Delivery Notes (W)

- **W06:** **Delivered:** Server-backed playback history and progress shared across Web devices. **Remaining:** Native client integration depends on desktop and mobile clients (C07 and C08). **Release record:** 0.2.0 (Web playback history and progress; partial).

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
| C15 | Desktop offline caching and viewing | Not started | Optional | — | — |
| C16 | Adapt Web playback fullscreen for iPhone | Not started | Optional | — | — |
| C12 | Casting | Not started | Optional | — | — |

Desktop clients should provide library management and acquisition alongside playback;
mobile clients prioritize touch-friendly browsing and playback. Both require an
authenticated server connection for server-backed operations. Cross-client progress
must account for concurrent and delayed updates (W12); native playback integrations
must report progress before they can support reliable continuation (C05). Offline
viewing and advanced playback capabilities are not part of the initial client scope.
Desktop and mobile offline viewing should allow users to cache selected media for
playback without a server connection. iPhone fullscreen playback should use the
available platform behavior and keep playback controls usable.
A TV application is outside the planned scope.

The proposed implementation and staged validation are in the
[future client design](development/clients.md).

### 2.8 External Tracking Services

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| T06 | Connect and synchronize multiple tracking services | Not started | Optional | — | — |
| T07 | Synchronize ratings with tracking services | Not started | Optional | — | — |

### 2.9 Interface, Settings, and Maintenance

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| O03 | Dashboard for continued viewing, new episodes, downloads, and exceptions | Not started | Optional | — | — |
| O09 | Support multiple users and permissions | Not started | Optional | — | — |
| O19 | In-app editor for hand-written configuration files | Not started | Optional | [Draft, validate and save supported custom profiles](#delivery-notes-o) | — |
| O23 | Support multi-node deployments | Not started | Optional | — | — |
| O24 | Separate cache and persistent data storage locations | Not started | Optional | — | — |
| O25 | Configure a total storage limit for prepared copies | Not started | Optional | [Prepared Copy Storage Limit](#prepared-copy-storage-limit-o25) | — |
| O26 | Configure the source refresh interval in Web Settings | Not started | Optional | [Source Refresh Interval](#source-refresh-interval-o26) | — |

#### Delivery Notes (O)

- **O19:** Edit and validate supported custom profile files, including acquisition and transcode profiles.
- **O24:** Allow cache and persistent application data to be stored separately so
  cache cleanup does not remove persistent data.

#### Prepared Copy Storage Limit (O25)

Allow an administrator to opt into a total storage limit for prepared copies.
By default, preparation uses available disk space and the system's free-space
reserve. When a limit is configured, show usage and the limit on the Prepared
copies page. If a new copy would exceed the limit, explain the failure and provide
access to manual cleanup. Preserve existing copies when the limit is lowered.

See [O18](implemented-requirements.md#prepared-copy-storage-o18) for the retired
cache budget setting.

#### Source Refresh Interval (O26)

Allow administrators to adjust the shared RSS and Jackett refresh interval from
the Downloads section of Settings. The current interval is fixed at 30 minutes.
If this feature is implemented, retain 30 minutes as the default and preserve
existing retry and rate-limit behavior. Users can request an immediate check
from a subscription's actions.

#### Configuration File Editor (O19)

Provide an in-app editing panel for supported configuration files that currently
require manual file editing, initially custom acquisition and transcode profile
YAML files. Show the current content, documented examples and field guidance;
allow users to edit a draft, validate it, explicitly
save it or discard changes. Preserve comments and formatting when saving. Display
syntax and validation errors with field paths and line/column locations where
available, and explain that a Backend restart is required for file changes to take effect.
Detect concurrent file changes before saving and keep the previous valid file on
validation or write failure. Built-in profiles remain read-only.

#### Configuration File Loading

Read `settings.json`, `acquisition-profiles.yaml` and `transcode-profiles.yaml`
from the application data directory at Backend startup. External file edits, including atomic file replacement, take effect only
after restarting Backend. There is no automatic file watching or manual reload
command. Configuration-file hot reload is outside the current scope.

Settings saved through the application continue to update disk and memory on save.
The in-app configuration file editor (O19) must explain that saved file edits require
a Backend restart. Deployment environment variables and container configuration also
remain restart-bound. Startup validation must report invalid custom files and retain
the documented built-in fallbacks; malformed persistent settings block startup.

#### Logging Maintenance (O11–O13)

See [implemented requirements](implemented-requirements.md#logging-maintenance-o11o13).

## 3. Rules for Future Features

These acceptance constraints apply to relevant delivered and future capabilities.
Optional features do not automatically become dependencies of planned work.

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
| WI03 | Optimize resource matching | — | Low priority | Improve the accuracy of matching resource-search results to the intended work and episode. | — |
| WI16 | Identify media by its actual contents | Not started | Optional | [Media identification during scanning](#media-identification-during-scanning-wi16) | — |

#### Matching Improvements from Real Failures (L16)

Collect representative local failure cases with user-confirmed expected works and episode mappings, preserving filename, directory and release provenance. Diagnose extraction, candidate retrieval, ranking, numbering and admission separately. Prioritize recurring failures such as shortened titles, season/part ambiguity, continuous numbering and end-of-series markers; do not lower admission thresholds solely to improve corpus coverage.

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
directory scans. Record coverage and limitations.

## 5. Bugs

Reported bugs may require reproduction and confirmation. Record observed and expected
behavior, impact, reproduction conditions and verification evidence as they become known.

| ID | Item | Delivery | Status | Details | First release |
| --- | --- | --- | --- | --- | --- |
| B01 | An active embedded subtitle cue can be missing after resume and track selection | Partial | Block | [ASS/SSA workaround verified. Movi's built-in path awaits an upstream fix.](#missing-embedded-subtitle-after-resume-b01) | — |

### Missing embedded subtitle after resume (B01)

Resume Web playback at a saved position within an embedded subtitle cue, then
select that subtitle track. The cue already in progress can be missing for the
rest of its display interval. The expected behavior is to show the active cue
after track selection and keep it visible until its scheduled end.

The Chromium smoke test with Movi 0.4.1 reproduced this with an embedded ASS cue
spanning a 20-second file. Seeking back to the start also failed to restore that
cue in the same test. A separate fixture displayed later cues after track selection
and seeking. See the [recorded smoke validation](development/movi.md#recorded-smoke-validation).

Anishelf's JASSUB path works around B01 for ASS/SSA by rendering the complete
track at the current playback time. The Chromium browser test showed the active
cue after seeking to three seconds and selecting the track, with playback
continuing normally.

Standalone Movi 0.4.1 tests also reproduced missing active cues in MKV samples
with embedded SRT, WebVTT, PGS, VobSub and DVB. Playback resumed inside the cue
before the track was enabled. The same steps displayed the active cues in
external SRT and WebVTT samples. The built-in Movi path, including the ASS/SSA
fallback, remains deferred pending an upstream fix.
See [Movi Player issue #33](https://github.com/MrUjjwalG/movi-player/issues/33).

## Movi Player and manual preparation direction

The current implementation uses Movi Player for client playback without browser
compatibility negotiation. Users explicitly choose original files or prepared copies.
Preparation is manual. Selected embedded ASS/SSA tracks and eligible font
attachments are extracted on demand. The server probes preparation input/output
and validates tools, container constraints and source access. New copies preserve
subtitles, fonts and chapters, using Matroska by default. Browser/device performance
and subtitle fidelity require actual sample validation; support lists do not certify
universal playback. JASSUB renders styled ASS/SSA from either subtitle source. This
direction supersedes earlier compatibility-driven preparation,
automatic-processing-window and full client-font-rendering requirements.
