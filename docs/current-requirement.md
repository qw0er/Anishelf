# Automatic Acquisition: Current Iteration Requirements Analysis

Date: 2026-10-19.

Implementation update (2026-10-20): the standalone [qBittorrent API adapter](qbittorrent-adapter.md)
and manual account settings are delivered as a tested foundation. Subscription,
discovery, durable downloads, path verification and ingestion remain unimplemented;
ACQ01–ACQ11 have not been accepted.

Status: the next iteration targets automatic resource acquisition. This report
analyzes the existing requirements; it is not an implementation or acceptance
record. No release number is assigned. The detailed scope below is proposed,
and unresolved product decisions remain explicit.

The [current iteration design](current-architecture.md) defines module ownership,
the implementation workflow and proposed policy defaults. Its selected policies
and remaining compatibility gates refine the analysis questions below; neither
document is evidence of delivered implementation.

## 1. Goal and User Workflow

Allow a user to subscribe to an anime and have eligible releases downloaded,
verified and added to the playable library without manually handling each release.

The complete workflow is:

**Choose an anime → enable a subscription and preview its episode scope → discover
releases → match, filter and deduplicate → submit a download → verify completed
files → ingest and associate episodes → expose available resources for playback.**

Success means eligible new episodes become available in the library, with visible
reasons and recovery actions when acquisition cannot proceed. Discovering a release
or receiving a download-complete status alone does not satisfy this goal.

## 2. Existing Requirement Coverage

The authoritative inventory is [Subscriptions and Resource Discovery](requirements.md#25-subscriptions-and-resource-discovery)
and [Downloads and Automatic Ingestion](requirements.md#26-downloads-and-automatic-ingestion).
These items currently remain Later/Unassigned in that inventory.

| IDs | Required capability | Proposed iteration scope |
| --- | --- | --- |
| S01–S02 | Enable/pause subscriptions from anime pages; configure starting episode and backlog with an impact preview | Core |
| S03 | Configure sources such as RSS and discover releases periodically | Core; select an initial supported source before implementation |
| S04 | Match releases to works and episodes; send ambiguous results to review | Core |
| S05 | Filter subtitle language, release group, resolution, codec and keywords | Core; define supported fields and missing-field behavior |
| S06 | Exclude existing files, active downloads and unwanted episodes | Core |
| S07 | Explain selection/rejection and allow manual selection or dismissal | Core |
| S08 | Coordinate tracking-status changes with subscriptions and explain effects on existing tasks | Define a minimal explicit policy; full automation remains undecided |
| D01 | Connect to qBittorrent; validate credentials and download-path mappings | Core; one download client |
| D02 | Submit releases, persist task associations and prevent duplicate submissions | Core |
| D03–D04 | Show download progress, speed, status and errors; pause, resume, cancel and retry | Core |
| D05 | Verify completed files, index them and associate them with episodes | Core |
| D06 | Recover after disconnection, external task removal and server restart | Core |
| D07 | Distinguish task cancellation, downloaded-data deletion and library-record removal | Core |
| S09 | Multi-source search/ranking, season packs and quality upgrades | Defer |
| D08 | Multiple clients, seeding policies, bandwidth schedules and storage policies | Defer |

Supporting requirements are O03 (downloads and exceptions dashboard), O04
(integration settings), and O05 (task history, logs and decision explanations).
Deliver the portions needed by this workflow rather than treating their entire
product-wide scope as an iteration dependency.

## 3. Existing Foundations and Responsibility Boundaries

The delivered library and AniList workflows provide work/provider identities,
confirmed episode associations, local resource availability, playback, and remote
viewing state. Reuse those capabilities through their public APIs; do not create
a second authoritative anime catalog or tracking list.

The [current architecture](architecture.md) separates local resource monitoring,
resource access, identification, metadata and catalog responsibilities. Acquisition
must coordinate with these owners rather than treating an RSS match or downloader
path as an already validated library resource.

Local filesystem monitoring discovers file changes, while download orchestration
tracks acquisition intent and downloader tasks. A filesystem event does not prove
download completion; a downloader completion does not prove successful ingestion.
Define their handoff and reconciliation explicitly in the implementation design.

AniList remains authoritative for viewing status and cumulative progress. Reading
or refreshing its lists must not enable subscriptions or start downloads.

## 4. Functional Requirements

### 4.1 Subscription and Episode Scope

- Provide enable/pause controls on an anime's page, including works without local files.
- Show the selected starting episode and backlog range before activation or scope expansion.
- Preview affected episodes, known existing resources, active acquisitions and unresolved cases.
- Keep subscription state independent from AniList tracking status and downloader task state.
- Explain the effect of pausing or changing a subscription on existing tasks; settle the exact policy before implementation.

### 4.2 Discovery, Matching and Selection

- Configure and validate the initial supported feed source, and discover releases periodically.
- Match release evidence to a work and episode scope using existing identities and applicable recognition capabilities.
- Retain the source and relevant release evidence so users can inspect a decision.
- Send ambiguous works, numbering and unsupported release shapes to review rather than forcing a match.
- Apply supported language, group, resolution, codec and keyword filters with visible reasons.
- Exclude episodes outside the subscription scope, already satisfied episodes and active acquisitions according to a documented deduplication policy.
- Explain selected, rejected, duplicate and unresolved outcomes; allow manual selection and dismissal.
- Isolate source failures so existing library browsing and playback remain available.

### 4.3 Download Orchestration

- Connect to qBittorrent and report authentication, connectivity and path-mapping failures separately.
- Persist the relationship between acquisition intent, release identity, work/episodes and downloader task.
- Prevent duplicate active submissions across polling, retries and restarts, including uncertain submission outcomes.
- Show task status, progress, speed and actionable errors, with pause/resume/cancel/retry controls.
- Reconcile persisted state with the downloader after reconnection or restart, including tasks removed outside Anishelf.
- Treat cancellation, deletion of downloaded data and removal of library records as separate actions with explicit effects.

### 4.4 Completion and Ingestion

- Resolve completed downloader paths to configured library locations using validated mappings.
- Verify relevant files exist and are accessible before confirming ingestion; completion flags alone are insufficient.
- Use existing resource indexing and work/episode association paths, preserving manual catalog decisions.
- Distinguish downloading, completion awaiting verification, ingestion failure and library availability in user feedback; exact internal states belong in the design.
- Allow ingestion retry without submitting the release for download again.
- Leave unsupported or ambiguous files reviewable and report missing/unreadable files explicitly.
- Reuse existing playback eligibility checks; successful indexing does not guarantee browser compatibility.

### 4.5 Feedback, History and Credentials

- Provide an acquisition overview and per-anime visibility into subscriptions, candidates, downloads and exceptions.
- Record durable task outcomes and selection/rejection explanations, with retry or review actions where applicable.
- Add structured logs for discovery runs, decisions, submissions, reconciliation and ingestion outcomes, using identifiers that connect the workflow.
- Protect feed/downloader credentials through the existing authentication boundary; do not expose passwords, tokens or credential-bearing source URLs in logs or ordinary responses.

## 5. Consistency and File-Safety Rules

These requirements apply the existing [future-feature rules](requirements.md#3-rules-for-future-features):

- Tracking, subscriptions, downloads, file availability and viewing history are independent states.
- Repeated discovery, retries, process interruption and restart must not create duplicate active downloads.
- Unknown or contradictory title/episode evidence requires review.
- Subscription scope must be explicit; list reads must never silently initiate backlog acquisition.
- Download completion requires file verification and ingestion before library success is reported.
- Cancellation does not implicitly delete downloaded files, library entries or viewing history.
- Any file movement must account for seeding and downloader path associations; automatic organization is not assumed.
- Remote outages must preserve existing local browsing/playback and accepted acquisition intent.

## 6. Acceptance Scenarios

These are proposed acceptance criteria, not recorded passes. Automated tests should
cover orchestration and failure handling; real RSS, qBittorrent, mapped filesystem
and browser validation are required to demonstrate the complete workflow.

| ID | Related requirements | Expected result |
| --- | --- | --- |
| ACQ01 | S01–S02 | Activate a subscription after previewing starting episode/backlog scope; only eligible episodes proceed. |
| ACQ02 | S03–S05, S07 | Discover representative releases; apply configured filters with visible reasons; ambiguous title/episode results require review and submit no automatic download. |
| ACQ03 | S06, D02 | Repeated polling, repeated selection, submission interruption and restart produce no duplicate active acquisition; existing files and active downloads are excluded according to the selected policy. |
| ACQ04 | D01, D03–D04 | Validate qBittorrent and directory mappings; display progress/errors and exercise pause, resume, cancel and retry with truthful feedback. |
| ACQ05 | D05 | A completed, accessible mapped file is indexed and associated with its episode, then opens through existing playback checks using a supported media sample. |
| ACQ06 | D05 | A completed task with missing/unreadable files or invalid mapping is not reported as library success; fixing the cause and retrying ingestion does not redownload it. |
| ACQ07 | D06 | Recover from downloader disconnection, server restart and externally removed tasks without silently losing intent or duplicating downloads. |
| ACQ08 | S07, O05 | Inspect selected, filtered, duplicate, dismissed and unresolved candidates; manual selection/dismissal produces consistent subsequent discovery behavior. |
| ACQ09 | D07 | Cancellation, data deletion and library-record removal have distinct, visible effects; cancellation preserves files and viewing history. |
| ACQ10 | S08 | Reading AniList lists starts no acquisition; tracking-status changes and subscription pause follow the explicitly selected policy, including effects on existing tasks. |
| ACQ11 | O03–O05 | Source/downloader failures expose actionable status and correlated logs without credentials; existing local browsing and playback remain usable. |

## 7. Decisions Required Before Implementation

| Topic | Decision needed |
| --- | --- |
| Initial source | Which RSS provider/feed formats are supported, how they are configured/authenticated, and whether feeds are global or per anime. |
| Discovery lifecycle | Poll interval, initial-feed backlog behavior, request limits, retry/backoff and retention of release evidence. |
| Subscription defaults | Starting episode, default backlog, specials/unknown episodes, and preview behavior when metadata is incomplete. |
| Matching and filters | Supported release evidence, language semantics, filter precedence, unknown-field behavior and ambiguous-match review. |
| Version selection | What satisfies an episode, how multiple releases compete, deduplication identities, and whether any manual override bypasses filters. Automatic quality upgrades remain deferred. |
| Unsupported releases | How to explain and handle season packs, multi-episode releases and other shapes beyond the initial supported scope. |
| Downloader paths | Supported deployment layouts, remote/local path mapping, completed-file placement and partially downloaded file visibility. |
| Pause and tracking changes | Effects of paused/completed/dropped AniList statuses, subscription pause and scope edits on future discovery and existing tasks. |
| Recovery and deletion | Treatment of uncertain submission results, external task removal, retained seeding tasks and explicit data-deletion actions. |
| Review and retention | Whether existing Review can support acquisition candidates, how dismissal persists, and how long task/decision history is retained. |

The [implementation design](current-architecture.md#1-scope-and-selected-design-policies)
now proposes explicit starting/backlog scope, user-configured RSS 2.0 feeds,
hard-filter/unknown-evidence behavior, stable preference ordering, no automatic
quality upgrades, completed files in mapped roots, durable cancellation suppression
and advisory-only AniList status changes. It also specifies acquisition-owned
remote review and a proposed 90-day detailed history policy with retained compact
deduplication records. These are design defaults pending implementation validation.
Real feed compatibility, supported qBittorrent versions, storage limits and mapped
deployment acceptance remain gates in design section 11.

## 8. Delivery Boundary

The proposed next-version core is **S01–S07 and D01–D07**, supported by the
necessary settings, task visibility and decision history. S08 requires an explicit
minimum policy before the workflow is complete; automatic tracking-driven
subscription management is not implicitly selected.

Multi-source ranking/search, season-pack processing, quality upgrades, multiple
download clients, seeding management, bandwidth/storage schedules, automatic file
organization and unrelated playback enhancements remain outside this proposal.

Implement in independently verifiable steps: subscription/discovery/review,
download submission/control/reconciliation, then verified ingestion and complete
failure recovery. Acceptance of the iteration requires the end-to-end workflow,
not only the individual integration steps.
