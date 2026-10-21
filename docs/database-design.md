# Persistence

SQLite and Drizzle remain the persistence mechanisms. The initial migration
`0000_relational_schema` creates the original 78 business tables.
`0001_snapshot_payloads` replaces thirteen metadata collection tables and detail
columns with a JSON projection and adds durable media inspections. The current
schema has 66 business tables; Drizzle's journal is infrastructure.
SQLite `user_version = 1` identifies this supported database family.

Persistence is required by Anime, Media, Playback and Acquisition assembly. A database startup
failure blocks startup; module combinations without persistence are not supported.

Business tests can use `ApplicationDatabase.openMemory()` for isolated, ephemeral
SQLite connections. They run the same schema migrations and repository assembly
as disk databases. Disk-backed tests remain responsible for migration upgrades,
WAL behavior and persistence across connection restarts. Application startup
continues to use the disk-backed `openDatabase()` path and its existing logs.

## Record Ownership

| Original tables | Relational representation |
| --- | --- |
| `acquisition_feeds` | Feed identity, URL, validators, check/retry times, failure count and error columns; ordered feed entries |
| `acquisition_subscriptions` | Feed foreign key, starting episode, enabled flag, revision and nullable error |
| `acquisition_candidates` | Candidate identity, title, episode, selection, revision/evidence attributes; ordered reasons |
| `acquisition_destination` | One constrained `default` row with scope, path, revision, connection generation and verification flags |
| `acquisition_authorizations` | Work-scoped feed, starting episode, destination revision and connection generation |
| `acquisition_intents` | Identity/reservations, state, retry, progress, timestamps, captured destination, source identity and last command columns |
| `acquisition_directories` | Work primary key and unique stable directory; no representation change |
| `catalog_works` | Scalar work attributes and ordered search titles |
| `catalog_provider_links` | Work/snapshot foreign keys, qualified unique identity and constrained media type |
| `catalog_episodes` | Work foreign key, unique episode identity, constrained kind and provenance |
| `catalog_associations` | Explicit primary key, unique source/episode association, foreign keys and ordered original episode tokens |
| `catalog_reviews` | Source foreign key, decision/revision, scalar identification evidence, ordered extraction inputs/elements, titles, proposals, mapping targets and explanations |
| `catalog_operations` | Command identity/fingerprint, confirmed work/revision and ordered review receipts |
| `metadata_snapshots` | Snapshot/cache identity, kind, indexed freshness/failure columns and one JSON `data` projection for search/detail/relation/airing payloads |
| `metadata_pins` | Composite snapshot/owner primary key and cascading snapshot foreign key |
| `media_inspections` | One JSON FFprobe result per scope/file, source version and inspection/FFprobe format version |
| `metadata_artwork` | Existing scalar asset attributes, nonnegative size and LRU index |
| `tracking_operations` | Account/media identity, revision, origin, delivery/retry state, baseline, desired fields, attempted payload, target and remote-state columns |
| `tracking_connection` | One constrained row, valid connection states, paired account fields and required connected credentials |
| `tracking_list_cache` | Account snapshot header and ordered list entries/titles; unique media identity within each snapshot |
| `tracking_intent_versions` | Existing composite identity and nonnegative manual version |
| `tracking_commands` | Existing composite command identity and nonnegative revision |
| `preparation_tasks` | Immutable encoding specification, execution/encoder parameters and progress columns; ordered audio selections and filters; constrained lifecycle combinations |
| `prepared_artifacts` | Existing primary/foreign keys, unique task and positive size; no representation change |
| `subtitle_assets` | Existing source/track identity and size/state checks, plus valid output-format constraint |
| `subtitle_font_sets` | Source-bound status and ordered warning records |
| `subtitle_font_assets` | Existing attachment identity, cascading foreign key and format/size/index checks; no representation change |
| `playback_completions` | Source-bound observation fields and delivery-result columns, indexed for source and pending delivery |
| `playback_progress` | Existing source identity, position/duration/generation/sequence checks and history index; no representation change |
| `resource_roots` | Opaque scope identity and creation time; obsolete `canonical_path` removed |
| `media_sources` | Existing scoped source identity, resource-root foreign key and lookup indexes; no representation change |
| `auth_sessions` | Explicit authentication, CSRF, cookie and expiry attributes |
| `media_access_links` | Existing hashed capability, source version, fingerprint and expiry index; no representation change |

Child tables declare parent foreign keys, primary keys, nonnegative order positions
and unique parent/position indexes. Replacement and reconstruction preserve order,
duplicates where meaningful, nullable values and absent optional fields. Presence
flags distinguish absent objects and optional nullable attributes. Repository
mappers expose domain objects; database record types remain inside infrastructure.
Metadata projections and FFprobe results are immutable documents that the
application reads as a whole. They use JSON rather than child-table mappers; their
identity, retention and invalidation fields stay relational. Mutable commands,
state transitions and queried relationships retain explicit columns and constraints.
There is no runtime business query using SQLite JSON functions. Composite cache keys and
command fingerprints are stored as digests, not serialized request tuples.

## Preserved Semantics

Source/root primary keys, episode identities, accepted download reservations,
manual intent versions and command receipts survive normal process restarts. Independent
receipts and download intents intentionally do not acquire foreign keys to mutable
operations or removable subscriptions. Removing a subscription must not remove an
in-flight task, and pruning an operation must not erase command deduplication.
Provider-qualified identities remain opaque text. Catalog episode numbers remain
text because their domain permits more than integer download episode positions.

Each account list header, its entries and titles replace atomically. Metadata and
recognition snapshots retain their version ownership; collections do not become
shared mutable records. Recognition comparison uses canonical content fingerprints
so column reconstruction order cannot create new review revisions.
Preparation progress writes update state columns without replacing immutable plans.
Playback observation context remains opaque across the consumer-owned module port;
its required version-2 fields are persisted explicitly. There is no legacy token
fallback. Session serialization is confined to the session-plugin port;
the database stores authentication and cookie attributes as columns.

The unused duplicate provider wire payload (`metadata_snapshots.raw`) is removed.
It has no application read consumer; selected normalized metadata and its field
availability remain durable. This is an intentional removal of redundant diagnostic
payloads, rather than moving them into a differently named text/blob column.

## Initialization and Failure Handling

An empty database applies committed migrations transactionally. Existing format-1
installations apply `0001_snapshot_payloads` once. This upgrade reconstructs ordered
metadata payloads, preserves snapshot IDs, failure metadata, pins and Catalog
foreign keys, then removes obsolete metadata tables. Foreign-key enforcement is
suspended only around migration table rebuilding and restored before integrity
checking and repository construction. Normal operation enforces foreign keys.

Unsupported format markers are rejected before migrations or WAL configuration;
existing records are preserved. `database.ready` logs readiness and
`database.unavailable` reports a startup-blocking failure without private payloads.
Back up a stopped installation before upgrading. Older executables require their
matching database backup. See [Database Migrations and Backups](development.md#database-migrations-and-backups).

## Verification

`database-normalization.test.ts` exercises all normalized record families and
reopens the database to verify ordered collections, optional/null semantics,
metadata, recognition, task specifications, observations and sessions. It compares
every declared table's columns with the initialized database and checks primary keys,
foreign keys and the two deliberate JSON document tables. Additional fixtures reject
invalid state/singleton/version/size values and verify that unsupported-format
rejection preserves existing data. `metadata-migration.test.ts` starts from the previous schema and verifies ordered
payloads, booleans, nulls, provider identities, snapshot pins, references and repeated
startup. Inspection tests verify restart reuse, version invalidation and cleanup.

These are local schema and application regressions. They do not establish
production-data acceptance or a database load benchmark.
