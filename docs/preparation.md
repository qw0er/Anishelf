# Persistent Web preparation

The backend implements P06 and the completed-file portion of P07 through
`PreparationApplication`. It consumes `PlaybackApplication.plan()` and the public
processing/source APIs. The production bootstrap creates one execution module
and injects its processor into preparation. No whole-library preparation runs
automatically. The library integrates asynchronous compatibility checks and
explicit pre-transcoding, Settings owns the target profile, and a collapsible
floating monitor exposes task progress and operations. Unsupported originals
automatically use a verified completed copy when available.
Real-time HLS remains separate integration work.

## HTTP workflow

1. Read `GET /api/transcode-profiles` and explicitly choose an available profile.
2. Inspect `GET /api/files/:id/compatibility?profileId=...&target=file` and run the
   returned browser capability queries on the client.
3. Send `POST /api/files/:id/preparations` with the existing compatibility-check
   body: `sourceVersion`, `descriptionId`, `output: { profileId, target: "file" }`,
   and `evidence`. Arbitrary encoder parameters, arguments and output paths are
   rejected. MSE delivery is rejected by the preparation endpoint.
4. The response is `kind: "direct"`, `"blocked"`, or `"task"`. Direct means the
   original is compatible; blocked includes a planning reason. A task response
   includes its actual queued/processing/ready/failed/cancelled state.
5. Poll the task URL. Only a completed `ready` task has an artifact ID and size. A playback URL is
   supplied after source availability is checked; during the startup scan,
   `playbackAvailability` is `unknown` and the URL remains null.
   The completed media endpoint supports GET, HEAD and single byte ranges.

| Method and route | Behavior |
| --- | --- |
| `POST /api/files/:id/preparations` | Validate fresh browser evidence, plan, deduplicate and enqueue; return a safe result |
| `GET /api/preparations` | List the latest tasks, including tasks from earlier roots, up to the configured list limit; optional `fileId` filters before limiting, and ready copies are rechecked |
| `GET /api/preparations/:id` | Read a task and recheck a ready copy's source/profile/file availability |
| `POST /api/preparations/:id/cancel` with `{}` | Cancel queued work or abort processing; return after execution and cleanup settle |
| `POST /api/preparations/:id/retry` | Require a fresh compatibility-check body for the same derivation; requeue failed/cancelled work |
| `GET` / `HEAD /api/prepared-media/:id` | Open an authorized, current, published regular file; serve full or Range content |
| `DELETE /api/prepared-media/:id` | Delete a completed copy, preserving its task record, source and viewing history; return 204 |

Retry does not reuse stored browser reports. If source version or effective
processing policy changes, the client creates a new preparation instead. Repeated
creation for the same derivation returns the existing task, including its failed
or cancelled state; retry is explicit. Concurrent clients share work, but each
creation request must pass its own browser negotiation. A ready file's URL is a
source-bound delivery reference, not a universal browser-compatibility promise.

Task JSON includes filename, source version, selected profile ID, processing mode,
per-stream reasons, progress, playback availability, failure reason and timestamps. It excludes filesystem
paths, source registry IDs, encoder settings and raw browser evidence. Polling and
Range responses use `Cache-Control: no-store`.

## Ownership, persistence and publication

SQLite stores `preparation_tasks` and `prepared_artifacts` through Drizzle. Tasks
reference the existing registered original source; preparation never opens a
viewing-progress generation or changes durable progress. A unique execution-plan
identity deduplicates source/root/version, profile content, selected streams,
delivery and operations. Persisted execution snapshots exclude callbacks, abort
signals and browser reports. Profile display metadata does not invalidate files.

The processing Application owns execution workspaces and validates FFmpeg output.
Preparation adopts the validated bytes into `cache/prepared-media` using a hard
link in the same application data filesystem, synchronizes the file, atomically
renames it, synchronizes the directory and revalidates the source. Only then does
a transaction publish the artifact record and ready task. The processing owner
releases its temporary link. Closing the service preserves completed preparation
files. The original media remains read-only throughout.

The configured data directory must keep the processing and prepared cache
subdirectories on the same filesystem. A hard-link failure fails the task and
leaves it retryable; the service does not copy a film into a second large allocation.

The DB/filesystem boundary is reconciled rather than assumed transactional. A
crash before the ready transaction leaves unregistered bytes, which startup
removes. Startup cleans execution workspaces and unknown/pending prepared files,
marks queued/processing jobs failed with `interrupted`, checks ready files as
regular files of the published size, and invalidates changed/missing profiles or
missing outputs. Source availability is rechecked when a ready task/file is used,
after the library is accessible. Until the startup index is available, valid
completed copies are retained and serving returns a retryable unavailable error,
rather than deleting them as missing sources. Interrupted jobs remain available for explicit
retry; they cannot appear streaming or ready.

A ready copy becomes unusable when the source/root/version changes, its profile
content changes/disappears, or its file disappears. Invalidation removes its
artifact registration and records a retryable failure. No cache operation removes
original sources or durable history records.

## Queue and storage bounds

Preparation owns one FIFO worker, matching the execution service's single slot.
Duplicate requests share the same task. Queue capacity and retained output are
bounded by module-owned policy composed into the validated configuration:

| Setting | Built-in default |
| --- | --- |
| `maximumCacheBytes` | 10 GiB of prepared output plus invalidated output still borrowed by readers |
| `minimumFreeBytes` | Leave 64 MiB of free disk space |
| `maximumQueuedTasks` | 100 waiting tasks |
| `listLimit` | 200 recent tasks |
| `progressSaveMs` | At most one normal progress write per second; final progress is preserved |

Before execution, the owner narrows the processor's output budget to the remaining
cache allowance and usable disk space. FFmpeg and application output checks enforce
that budget. A full cache/storage budget fails with explicit feedback; eviction
is manual in this version. The completed media cache is separate from subtitle
storage, while free-disk checks account for all filesystem usage. User-facing
budget settings and interactive-playback priority are not implemented here.

A borrowed artifact remains pinned until its file handle is released. Deleting an
in-use copy returns `PREPARATION_BUSY`. Invalidation prevents new readers but
allows existing handles to finish; those retained bytes still count against the
cache budget, and the final borrower removes the invalidated file. Cancel waits
for child completion/cleanup, and retry cannot overlap the old execution.

Failure reasons distinguish interruption, cancellation, explicit cache deletion,
missing output, cache/storage exhaustion, source/profile changes, missing tools,
missing/unknown execution capabilities and processing failures. Logs contain task
identities and state/size metadata, without tool arguments or output payloads.

## Verification

Lifecycle/HTTP tests cover deduplication, queue capacity, cancellation/retry,
restart reuse and interruption recovery, ready-only URLs, Range/HEAD delivery,
in-use deletion, source/profile invalidation, missing files, publication failure,
storage budgets, and preservation of original bytes and saved progress.

A real-FFmpeg test generates an H.264/AAC MKV source and prepares all four branches
through the HTTP API. It downloads and probes complete outputs, decodes a frame
after seeking, checks copied-stream packet hashes, exercises byte-range delivery,
and reopens outputs after service restart without another execution. Browser
reports in these tests are synthetic. Real browser playback, subtitle alignment,
real-time playback require their subsequent acceptance.

## Web integration

Opening a directory starts asynchronous source-only compatibility checks for its
files. The list remains usable while each pending file action shows a Spinner.
Checks run in a bounded queue, with one slot matching the built-in server probe
policy. Expected transient unavailable responses receive two bounded retries;
request cancellation also cancels retry delays. Leaving a directory aborts client
requests and queued checks. A shared bounded cache binds completed checks to root,
library revision, file identity and metadata; the player can reuse them while
checking the session source version. Unknown capability and failed requests offer
rechecking rather than pretending the source is unsupported.

File actions use icons with accessible names and tooltips.
Only unsupported files expose the pre-transcode action. It negotiates fresh
source/profile-bound browser evidence, then creates or explicitly retries work.
Compatible originals do not expose the action. A pending task disables duplicate
submission, and a completed copy is marked ready. Settings reads the safe profile
catalog and persists the target through `PUT /api/transcode-profiles/selection`.
The form shows only names and descriptions, without encoder arguments. Missing
profile selections direct the user to Settings instead of guessing a fallback.

There is no preparation page or task navigation item. The app shell owns one task
list and profile catalog across route changes. When tasks exist, a bottom-right
floating panel uses one compact row per task, showing the filename, status or
progress, and icon actions with tooltips. Filename tooltips retain the full name,
mode, profile, failure details, size and availability.
It can be folded without stopping polling or losing pending actions. Pending work
and unknown startup availability are polled without overlapping requests;
terminal states stop polling. Refresh, library changes and mutation completion
reload tasks. Leaving the app aborts requests and timers without cancelling server
jobs. Explicit cancel, retry and cache deletion retain their backend lifecycle
semantics; retry obtains fresh browser evidence. Deletion preserves originals
and history.

When an original is supported, the player uses its direct media URL. When it is
unsupported, it automatically checks ready copies for the same source version,
preferring the current target profile. File-specific lookup applies the task limit
after filtering, so older copies remain discoverable outside the global recent
task window. It verifies the actual copy/encode
combination against current browser evidence, then re-reads the artifact before
using its URL. Viewing never enqueues processing. Without a ready copy, the page
shows a preparation hint and a folder return link. If an existing task completes
while the file page is open, the newly ready copy is verified and selected. Unknown
original support remains a separate state with an explicit original-file attempt.
Compatibility details are available on demand rather than opening automatically.

The native Vidstack player keeps its progress controller bound to the original
source; subtitle discovery and rendering also remain bound to that source. A
matching source-version update from progress loading does not unload an active
video. Original-file external links retain their behavior. Real-time fallback
remains planned.

Frontend tests cover bounded directory checking and cancellation, cache reuse,
pending placeholders, supported/unknown action visibility, fresh preparation
requests, persistent profile selection, monitor collapse and route continuity,
automatic prepared selection, missing/stale/rejected copies, explicit
cancel/retry/delete, readiness polling and StrictMode. Browser UI inspection uses
local fixtures for layout, Settings persistence, collapse/navigation and the
selected media URL. It does not certify the backend encoding pipeline or subtitle
alignment in converted production sample files.
