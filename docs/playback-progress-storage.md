# Playback Progress Storage (W01, W02)

Status: the database foundation is implemented (schema, migrations, connection lifecycle, and repository). Playback application session authorization, source fingerprint collection, and available-source candidate filtering are implemented. HTTP APIs are implemented with separate public contracts and presenters. Player/list UI integration remains planned.

This plan specializes the V2 persistence design in `current-version-design.md` for saved progress, resume, and Continue watching. Use SQLite at `dataDir/anishelf.sqlite`, Drizzle repositories, and reviewed versioned SQL migrations. User settings remain in `settings.json`; the library index remains rebuildable in memory.

## 1. Initial Tables

Use three durable tables. A source row represents one version of one file under one resource root. Each source has at most one current progress row. The application currently has no user accounts, so progress belongs to the shared server library.

### `resource_roots`

| Column | SQLite type | Constraint / meaning |
| --- | --- | --- |
| `id` | TEXT | Primary key; hash of the canonical absolute root path |
| `canonical_path` | TEXT | NOT NULL, UNIQUE; server-internal canonical path |
| `created_at_ms` | INTEGER | NOT NULL; server Unix time in milliseconds |

Canonicalize using the resource-access root resolution. Returning to the same canonical root reuses its namespace. Root path changes create another namespace; automatic move/relink support is deferred. Never expose canonical paths in public DTOs.

### `media_sources`

| Column | SQLite type | Constraint / meaning |
| --- | --- | --- |
| `id` | TEXT | Primary key; hash of root ID, file ID, and source version with unambiguous separators |
| `root_id` | TEXT | NOT NULL; foreign key to `resource_roots.id`, delete RESTRICT |
| `file_id` | TEXT | NOT NULL; existing path-derived library resource ID |
| `relative_path` | TEXT | NOT NULL; internal lookup path within the root |
| `source_version` | TEXT | NOT NULL; versioned fingerprint of safely opened file metadata |
| `created_at_ms` | INTEGER | NOT NULL; first registration time |

Add UNIQUE (`root_id`, `file_id`, `source_version`). Build the fingerprint from size, high-resolution mtime/ctime, and available device/inode values. Serialize large metadata integers as decimal strings when hashing, avoiding JavaScript number precision loss. Include a fingerprint-format version. This detects ordinary replacement; it is not a content hash guarantee.

The current index only contains size and ISO modification time. Obtain the stronger fingerprint through the resource-access layer from the safely opened file; do not treat the current index metadata as sufficient identity. Register sources lazily when opening playback. Scanning alone need not populate the database with every file.

Retain old source versions and their progress when files disappear or change. A replacement gets a new source row and does not inherit progress. Availability is derived from the active root, published scan snapshot, and source revalidation, rather than a persistent `available` flag.

### `playback_progress`

| Column | SQLite type | Constraint / meaning |
| --- | --- | --- |
| `source_id` | TEXT | Primary key; foreign key to `media_sources.id`, delete RESTRICT |
| `position_ms` | INTEGER | NOT NULL, >= 0; last accepted source-time position |
| `duration_ms` | INTEGER | Nullable; positive known duration, otherwise NULL |
| `last_viewed_at_ms` | INTEGER | Nullable until the first accepted save; server time |
| `revision` | INTEGER | NOT NULL, >= 0; increment on each accepted mutation |
| `generation` | INTEGER | NOT NULL, >= 1; identifies the current playback session/reset |
| `last_sequence` | INTEGER | NOT NULL, >= 0; latest accepted update within this generation |

Require `position_ms <= duration_ms` when duration is known. Validate finite times and safe integer ranges before conversion from browser seconds. Reject invalid supplied durations; use NULL when duration is legitimately unknown. A new session may create an initial zero row with no viewing time, but that row must not enter viewing lists.

Index `media_sources(root_id, id)` and `playback_progress(last_viewed_at_ms DESC, source_id ASC)` for root filtering and stable ordering. Revisit query plans when real library sizes justify additional indexes.

## 2. Session and Update Rules

Keep active session tokens and their source/generation bindings in memory. Their loss on server restart deliberately requires reopening a session; durable generation values must never be reset. A separate persistent session table is unnecessary for W01/W02.

1. Resolve the current source safely and read its saved progress. On failure, keep playback usable, report the failure, and disable saving until a successful retry.
2. Open a session transactionally: create/reuse the source and progress rows, increment the generation for an existing row, reset `last_sequence` to zero, and return history plus a server-issued token. Opening alone preserves position, duration, and last viewing time. Publish the token only after commit.
3. Each save supplies the token, source version, generation, sequence, position, and duration. Check the active root and source validity before acceptance. Require the current generation and a strictly increasing sequence. Commit values, revision, and server viewing time atomically. Backward seeks are valid newer updates.
4. A retry of the latest accepted sequence is successful only when its normalized position/duration match the stored values. It changes neither revision nor viewing time. A differing payload or an older sequence is rejected. This makes ambiguous network retries safe without an event-log table.
5. Start over requires the current session/generation and a request ID. Atomically increment generation, reset sequence and position, increment revision, and update viewing time. Return the new generation before writes resume. Retain successful reset responses in a bounded in-memory request-ID cache so a lost response can be retried safely during that session. Delayed writes from before reset are rejected.

Opening another session for the same source supersedes the previous writer. Report that conflict; do not silently merge clients. This implements the selected stale-update protection without adding W06 reconciliation. Invalidate tokens on root switches and release them on exit; bound inactive session lifetime and memory usage.

Use approximately five-second periodic saves plus pause, completed seek, ended, and normal exit. Serialize client writes and retain the newest failed payload for retry. An ended event with known duration saves that duration as the position. Direct, prepared, and real-time playback all write source-time progress to the same row.

## 3. Continue Watching

Query records for the active root with positive position and a non-NULL viewing time. A record is finished when known remaining time is at most `min(30,000 ms, duration_ms * 0.05)`. Unknown duration does not imply completion. Derive this condition; do not store an `is_finished` or watched marker that can drift from the saved values or policy.

Order by `last_viewed_at_ms DESC`, then `source_id ASC`. Match candidates against the current scanned library and revalidate source versions before exposing actionable playback links. Exclude missing/replaced files from actionable Continue watching entries while retaining their durable records. Before a scan, return an explicit availability-unknown state.

Apply the display limit after availability filtering so unavailable candidates do not consume every visible slot. Read ordered candidates in bounded batches if necessary. Reuse current library metadata for filename, parent navigation, and playback URL; do not persist duplicate display metadata or URLs.

An eventual Recently watched list can reuse the same rows, ordering, and availability rules while including finished records. It requires no extra table and is not part of the initial W02 UI scope.

## 4. Storage Boundaries and Implementation Order

Do not initially add playback event logs, per-episode watched markers, user profiles, client reconciliation, probe/cache/job tables, or media BLOBs. Normal scanning and cache cleanup must never delete progress or source history.

Enable foreign keys, WAL, a finite busy timeout, and `synchronous=FULL`. Keep transactions short. Apply migrations before enabling dependent writes; preserve the database and surface failures instead of silently replacing it. Document WAL-aware backup before shipping persistence.

Implement in this order:

1. Database startup, reviewed migrations, and resource/source identity access.
2. Progress repository transactions and session lifecycle.
3. History/session/save/start-over APIs and ArtPlayer resume/save integration.
4. Continue watching queries and library UI.

Verify restart/rescan survival; root and source-version isolation; unknown duration; backward seeks; duplicate/delayed writes; reset retries; failed reads without zero overwrite; durable save failures; and filtering/ordering around the near-end boundary. Code changes must pass Biome check and lint, with repository and API tests for these persistence rules.
