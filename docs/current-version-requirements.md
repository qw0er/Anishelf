# Current Version Requirements: AniList Accounts

## 1. Goal and Status

The current selected iteration connects an AniList account and lets users view and update AniList-owned viewing state from Anishelf. No release number is assigned. T01 account foundations, shared request scheduling, and T02 list reads/cache/refresh with Library display are implemented. Manual progress/status changes and their durable submission, retry and conflict recovery are now implemented. Automatic completion (W03), durable playback handoff and derived episode indicators/counts (W05) are implemented. Real-provider writes and complete iteration acceptance remain pending.

[Overall requirements](requirements.md) retains the feature inventory and delivery status. [History](history.md#anime-library-requirements) retains the completed anime-library iteration. [Current version design](current-version-design.md) defines the planned implementation and authorization approach. The current architecture remains documented in [Architecture](architecture.md); the design records the implemented foundation separately from the remaining plan.

## 2. Selected Requirements

| ID | Required behavior |
| --- | --- |
| T01 | Authorize AniList, show the connected account and connectivity state, disconnect and reauthorize. |
| T02 | Read, cache and refresh the account's lists, progress and tracking statuses, including titles without local resources. |
| T03 | Reuse existing work/episode mappings to submit viewing progress and tracking-status changes. |
| T04 | Persist pending updates, coalesce superseded operations, retry failures and expose authorization and submission results. |
| T05 | Detect remote changes and resolve conflicts without silently overwriting newer remote state. |
| W03 | Detect episode completion and support manual progress corrections through AniList updates. |
| W04 | Display and update AniList-supported tracking statuses. |
| W05 | Show watched counts and available unwatched episodes derived from AniList progress, alongside independent local playback history. |

## 3. Ownership and Consistency

AniList owns viewing state. Anishelf reads and refreshes remote lists and submits user or playback-driven changes; this workflow includes both reads and writes, without merging an independent local tracking database. List import/export and reimport-difference workflows are not required. Local persistence consists of source playback positions/history, account-scoped remote caches and durable pending update operations, alongside existing catalog data and associations. Reading lists must not enable subscriptions or downloads.

- **Account lifecycle:** show authorization/connectivity state and the connected account; support disconnect and reauthorization. Isolate cached lists and pending operations by account. Disconnect stops submission; another account must never receive the previous account's pending updates. Credentials must not appear in logs or browser-visible application responses.
- **Lists and cached state:** display AniList titles, progress and statuses, including titles without local files. Expose refresh errors and stale cached state. Provider metadata access and existing file playback remain usable without a personal account; without authorization, AniList viewing-state changes are unavailable.
- **Viewing updates:** reuse delivered mappings and existing playback. Submit only confirmed, unambiguous work/episode targets. Automatic completion, repeated playback and multiple versions must not produce duplicate increments. Keep pending desired state visibly distinct from confirmed remote state; failed submission must not be shown as remote success.
- **Durable submission:** persist an accepted update before attempting delivery, without blocking playback on the remote request. Retain pending operations across restart, coalesce superseded operations for the same account/work, and expose pending, failed, authorization-required and successful outcomes with retry feedback. Preserve explicit backward corrections rather than always taking the maximum progress.
- **Remote conflicts:** retain the remote baseline for a pending operation and refresh before retrying it. If remote progress/status changed, do not silently overwrite it with an older operation; display the conflict and allow keeping the remote value or explicitly submitting the local intent. Duplicate delivery and uncertain request outcomes must be reconciled against remote state before retrying. Refresh must not discard pending intent.
- **Independent playback:** authorization expiry, offline operation and AniList failures must not prevent playback, local resume or history saves. Disconnect and list refresh must not erase those local records.

This iteration does not add independent local tracking, list import/export, automatic acquisition, rating synchronization, multiple trackers or external-player state collection. The current design selects a bundled Client ID with manual PIN authorization; the 85-percent effective watched-coverage policy, evidence persistence/validation and durable handoff are implemented; this section records requirements, not implemented behavior.

Source playback positions, resume and history remain local capabilities. Existing catalog works, episodes, provider identifiers and confirmed source associations remain the mapping foundation. No new identification or numbering-mapping workflow is required by this iteration.

AniList cumulative progress cannot represent arbitrary independent watched/unwatched flags for each episode. Episode indicators must identify their basis in AniList progress. Watching a later episode must not silently imply that skipped earlier episodes were watched; require an explicit cumulative-progress decision. Replaying an episode or choosing another file version must not increment progress again. No separate authoritative local tracking list or per-episode watched-state store is selected.

## 4. User Workflow

1. Connect an AniList account and verify the displayed identity.
2. Read its lists and viewing state, with visible refresh and cached-state feedback.
3. Open available local resources through existing catalog and playback paths.
4. Submit progress/status changes from playback completion or manual correction; show pending intent until remote confirmation.
5. Show success, retryable failure, expired authorization or a remote conflict and provide the corresponding recovery action.

## 5. Acceptance Criteria

Full ANI01–ANI10 acceptance remains pending. Account/list foundations and the manual submission path have implementation and fixture evidence below; automatic-completion scenarios now have fixture coverage, with real-browser playback and provider-write acceptance still pending.

| ID | Requirements | Acceptance scenario |
| --- | --- | --- |
| ANI01 | T01 | Authorize, display the correct account, check connectivity, disconnect and reauthorize. No credentials appear in logs or application data responses. |
| ANI02 | T01, T02, T04 | Disconnect stops submissions. Connecting a different account does not expose the previous account's cached list or submit its pending operations. |
| ANI03 | T02, W04, W05 | Show remote titles, progress and statuses, including titles without local files; refresh updates the view, while an unavailable provider produces explicit stale/error feedback. Reading lists starts no downloads. |
| ANI04 | T03, W03 | A confirmed episode completion submits the intended cumulative progress using existing mappings. Repeated playback and alternate file versions do not create duplicate increments; ambiguous targets remain unresolved. |
| ANI05 | T03, W03, W04 | Manual progress/status changes are reflected after remote confirmation; explicit backward corrections are supported. Noncontiguous completion requires an explicit decision and is not silently treated as contiguous viewing. |
| ANI06 | T04 | Offline or failed submissions retain durable pending intent across restart, show its status, coalesce superseded operations and can be retried. Pending state is distinguishable from confirmed remote state. |
| ANI07 | T04, T05 | Authorization expiry produces actionable feedback. A remotely successful request whose response was lost is reconciled before retry, without duplicate progress changes. |
| ANI08 | T05 | A remote edit made while an update is pending is detected before retry. The user can keep remote state or explicitly submit local intent; refreshing does not discard pending intent. |
| ANI09 | W05 | Derived episode indicators and watched counts reflect AniList cumulative progress; actual local playback history remains separately identifiable. |
| ANI10 | T01–T05, W03–W05 | Offline operation, authorization failure, disconnect and refresh do not block existing playback, subtitles, preparation, local resume or history persistence. Metadata-assisted identification still works without personal authorization. |

## 6. Policy and Remaining Acceptance

The [current version design](current-version-design.md) selects a maintainer-provided public Client ID, manual PIN token authorization, server-side credential storage, account isolation, durable submission and conflict recovery. It also defines skipped-episode and backward-correction behavior, and selects at least 85-percent effective watched coverage for automatic completion. Seeked ranges do not count, overlapping intervals count once, playback speed uses source-time coverage, and persisted evidence supports resumed playback for the same source version. Natural end does not bypass the threshold. Before full acceptance, verify fresh browser authorization, actual media playback evidence and real-account writes. Implemented evidence bounds, validation tolerances and the durable playback handoff are recorded below. Manual request contracts, retry bounds and queue limits are implemented below. These decisions must preserve the ownership and acceptance rules above.

## 7. Excluded Scope

Independent local tracking, list import/export, reimport merging, automatic acquisition, ratings, multiple trackers, advanced rewatch support and external-player state collection are outside this iteration. Historical requirements and acceptance records remain unchanged.

## 8. Account Foundation Delivery

T01 now has authenticated/CSRF-protected status, token preview, confirmation,
connection check and disconnect endpoints, plus a Settings interface using bundled
Client ID 53902. Preview candidates belong to one login session, expire after five
minutes and are invalidated by a connection change. Confirmation and disconnect
require the current connection generation. The credential file reference and
account identity persist in SQLite; the token stays in a private server-side file.

Metadata and Tracking share one bounded AniList scheduler, including pacing,
provider rate headers, priority with fairness, cancellation and shutdown. The
public metadata adapter does not receive personal tokens.

Validation includes actual token-based account preview, confirmation, Viewer
checks, service reconstruction with persisted credentials and local disconnect in
an isolated temporary directory; no AniList list was mutated. Automated HTTP tests
cover login/CSRF, session-bound confirmation and response/log secret withholding.
Frontend tests cover masked input clearing, confirmation, reconnect feedback and
old-account query removal. A real browser inspected the disconnected Settings
section. Fresh browser authorization, connected-account browser interaction and
full ANI01–ANI10 acceptance are not claimed by these checks.


## 9. List Read and Display Delivery

T02 now reads all AniList list chunks and custom groups, persists a complete
account-scoped snapshot, refreshes stale data in the background and supports
explicit refresh. Failed refreshes retain the previous snapshot with visible
error/stale feedback. Authorization failures provide reconnect guidance. A late
response from a replaced connection cannot publish a snapshot.

Library defaults to local works; All works includes AniList entries without local
resources. Existing provider IDs join matched works exactly, with status/progress
shown separately from resource availability. Scope, viewing state, title, format,
year, availability and pagination compose in one view. Local cards keep their
existing detail/playback routes. Remote-only details reuse Metadata and display
cached viewing state without creating Catalog works. Account changes clear the
browser's personal list/entry caches. No read initiates downloads or tracking writes.

Automated tests and a read-only live fetch of 244 entries validate list access.
A production-build fixture browser checks cards/status filters, remote detail
fallback and a 390-pixel viewport without horizontal overflow. This delivered the read/display portion of W04. The subsequent manual update
delivery is recorded below; automatic completion and W05 are delivered in Section 11. Full ANI01–ANI10 acceptance remains pending.


## 10. Manual Viewing Updates and Reliable Submission Delivery

Local and remote-only work details now offer an AniList progress/status editor.
Commands contain absolute values and only intended fields, including explicit
backward progress corrections and an initial status for a new remote entry.
Confirmed remote values remain distinct from pending intent. Automatic completion is delivered separately below; automatic status transitions remain outside scope.

Tracking persists one revisioned operation per account/media before dispatch.
Unsent edits coalesce; an attempted payload remains immutable while a later edit
is retained. Each delivery first reads the individual remote entry. Already-applied
values reconcile as success; edits to intended baseline fields pause for explicit
conflict resolution. Keeping AniList values cancels intent; submitting local intent
captures a fresh baseline and checks again before delivery. Entry appearance/removal
and lost responses follow the same reconciliation path. AniList has no atomic
conditional mutation, so a concurrent remote edit between read and write remains
an upstream limitation.

The worker serializes delivery through the shared scheduler. Transient failures
use exponential backoff with jitter and provider retry times, with at most five
automatic attempts before explicit retry. Authorization errors pause submission;
reconnecting the same account resumes it, while another account cannot receive
old operations. Restart recovers persisted attempts by reading remote state first.
Admission allows at most 100 unfinished operations per account; retained records
are bounded to 1,000, pruning only the oldest successful/cancelled record as needed.

The editor exposes pending, failed, reconnect-required and conflict outcomes,
retry time, explicit retry and conflict choices. App-level polling continues result
notifications after detail navigation, with an action to reopen the work. Account
changes cancel queries and clear the previous account's notices. Confirmed writes
update affected cached entries and make the full list stale for refresh; list
refresh cannot discard operations or publish a pre-write snapshot over a confirmed
result. Diagnostic events contain operation identity/state and safe error codes,
without tokens or provider payloads.

Automated fixtures cover database restart, lost responses, backward corrections,
coalescing, immutable attempts with later edits, account fencing, retry bounds,
protocol identity checks, HTTP session/CSRF validation and UI pending/conflict/retry
behavior. A production-build browser fixture verified a manual backward correction
and status change through pending to confirmed state. These are fixture checks;
no real AniList list mutation or full iteration acceptance is claimed.


## 11. Playback Completion and Derived Viewing Display Delivery

The Web player records continuous source-time intervals during playback, splits
anchors on seeks, buffering, pauses and resource switches, and maps prepared-media
time back to the source. Resume restoration contributes no coverage. Requests carry
at most 128 intervals; continuity samples require no more than five seconds between
observations. Rates from 0.25 to 16 are accepted. The backend validates integer source
bounds, rate continuity (100 ms rounding tolerance), and newly covered wall-time cost
against elapsed server time plus one second, capped at five minutes per request.
Previously persisted overlapping ranges consume no additional time budget. Shared
media inspection supplies the canonical source duration; an unknown duration or a
client duration differing by more than one second produces no completion evidence.
Rejected evidence leaves valid position/history saves usable. Persisted coverage
keeps at most 4,096 disjoint ranges, retaining existing evidence if the limit is hit.
These bounds conservatively omit unobserved time; they do not certify a malicious
client's telemetry.

Migration `0014_playback_completion` adds source-version coverage and completion
receipts. A validated progress save merges coverage and records an 85-percent
completion in one SQLite transaction. Receipts bind the source to an opaque captured
account/generation and confirmed single-target mapping/revision. The Playback-owned
handoff worker processes at most 100 eligible receipts every two seconds, rotates
retries by last attempt time, resumes after restart and retains unavailable admission
for retry. Source and target context deduplicate replay. Pending intent is admitted
to the existing Tracking worker before the receipt becomes queued. Recovery checks
confirmed progress and existing intent, so an acknowledgement lost after admission
cannot increment progress twice. Newer manual operations take precedence.

Anime revalidates source availability, confirmed associations and account generation
before admission. Same-account reconnection revalidates against the current generation and existing queue/remote baseline; another account cannot receive the observation. Regular positive-integer episodes and explicitly mapped single-entry
movies are supported. Ambiguous, special, fractional or multi-episode mappings are
not inferred. Contiguous progress advances absolutely; already tracked episodes do
not increment or lower progress. Skipped episodes require confirmation. An absent
entry requires an explicit initial status. Existing entries receive progress-only
commands, with no automatic tracking-status policy. Admission failures never depend
on a live AniList response to acknowledge local progress.

Eligible players poll `GET /api/playback/sessions/:token/completion`; a POST to the
same authenticated, CSRF-protected route records the user's advance/keep decision
before retrying admission. Player feedback distinguishes recorded, waiting for a
decision, unavailable, queued and unchanged outcomes. Queued is not remote success;
the existing operation monitor reports confirmed delivery, failures and conflicts,
including automatically admitted operations that complete between polls. Terminal
player outcomes stop polling. Decisions survive navigation and can be resumed by
reopening the same source under the same account generation and mapping.

Local details show watched/unwatched indicators only for supported episode numbers
and a confirmed cached AniList entry. Specials and fractional numbers remain unknown.
Counts use cumulative AniList progress and available unwatched episodes; duplicate
file versions count once. Library cards compute available unwatched counts from
actual available episode targets during existing page hydration, rather than
subtracting progress from availability. Pending intent never changes these indicators;
local resume/history remains separate and no per-episode watched-state store is added.

Automated fixtures cover coverage union, resumed sessions, seeks, speed, timeline
mapping, elapsed-time/duration rejection, stale sessions, restart, lost responses,
replay/version deduplication, skipped decisions, explicit initial status, account and
mapping changes, manual precedence, UI decisions and count semantics. A production
build fixture browser verifies detail indicators and explicit skipped-episode admission
at 390 px and 1280 px without horizontal overflow. No real AniList list mutation or
real-media browser completion acceptance is claimed by these checks.
