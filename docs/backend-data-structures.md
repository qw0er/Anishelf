# Backend Data Structures

This document records implemented type ownership and data boundaries in
`backend/src`. Exporting a TypeScript type allows another module to import it;
it does not make that type a public HTTP contract.

## Ownership Rules

| Owner | Responsibility | Consumers |
| --- | --- | --- |
| `http/schemas` | Public TypeBox schemas for JSON requests, responses, DTOs and runtime constraints | HTTP routes and contract type inference |
| `http/contracts.ts` | `Static<typeof Schema>` aliases derived from the public schemas | Presenters and the Web API client |
| `http/instance.ts` | Fastify instance type retaining the TypeBox Type Provider | JSON API route modules |
| `http/presenters.ts` | Explicit conversion from backend business data into public JSON shapes | HTTP handlers |
| `config/model.ts` | Validated deployment options and persisted user settings | Startup, configuration, logging, applications, resource access, and HTTP configuration/presentation |
| `library/model.ts` | Resource identity, path-free business information, internal index entries, snapshots, listings, and library status | Library index, scanner, applications, and HTTP presenters |
| `library/scan-state.ts` | Business scan lifecycle, safe issues, and warning summaries | Library application, scanner, resource access, and HTTP presenters |
| `playback/model.ts` | Backend playback identity, progress, commands, and results independent of SQLite | Applications and playback repository |
| `database/schema.ts` | SQLite tables and constraints | Database adapters |
| Implementation files | Private runtime state and local helpers | Their owning module |

Application and adapter modules do not import HTTP contracts. HTTP handlers call
application use cases, and presenters import business types to build DTOs.
Public contracts do not import backend business models or runtime modules.
Biome enforces these import boundaries, including type-only imports.

## Public HTTP Contracts

All public JSON shapes are defined by TypeBox in `http/schemas` and exported as
inferred types from `http/contracts.ts`. Route request and response types are
inferred from these same schemas. Presenters retain explicit field projection.

| Type | Purpose |
| --- | --- |
| `ResourceId` | String representation of a public resource ID |
| `DirectoryDto` | Directory identity and display name; no relative path |
| `FileDto` | File identity, display name, size, modification timestamp, and MIME type; no relative path |
| `ResourceDto` | A directory or file DTO |
| `ScanWarningSummaryDto` | Bounded warning count and safe messages |
| `LibraryIssueDto` | A safe library failure code and message |
| `ScanStateDto` | Public running, completed, failed, or cancelled scan state |
| `LibraryResponse` | `GET /api/library` status and scan information |
| `ScanResponse` | `POST /api/library/scan` result |
| `SettingsResponse` | `GET/PUT /api/settings` response |
| `UpdateSettingsRequest` | `PUT /api/settings` request |
| `DirectoryResponse` | `GET /api/directories/:id` result |
| `FileResponse` | `GET /api/files/:id` metadata and direct playback URL |
| `ApiErrorResponse` | Safe error code, message, and request ID |
| `PlaybackProgressDto` | Public position, duration, viewing time and generation/sequence |
| `OpenPlaybackRequest`, `PlaybackSessionResponse` | Session opening input and output |
| `SavePlaybackProgressRequest`, `SavePlaybackProgressResponse` | Progress update and accepted/duplicate result |
| `ContinueWatchingResponse` | Availability state and file/progress entries returned by recent history |

The scan schema reuses private common fields for its state union. `errors.ts` owns
the stable `errorCodes` vocabulary and derives `ErrorCode` from it; the error
schema uses the same values. The health route uses `HealthResponseSchema` and
returns `{ status: "ok" }`.

The Web client imports types through `@anishelf/backend/http/contracts`. This
workspace export resolves to source and does not bundle backend runtime code.

## Library and Configuration Data

| Definition | Types | Scope |
| --- | --- | --- |
| `config/model.ts` | `LogLevel`, `LoggingConfig`, `DeploymentConfig` | Backend startup and infrastructure configuration |
| `config/model.ts` | `PersistentSettings` | `settings.json` and backend settings operations; HTTP projects it into an independent `SettingsResponse` |
| `library/model.ts` | `ResourceId`, `DirectoryInfo`, `FileInfo`, `ResourceInfo` | Backend identity and path-free business information |
| `library/model.ts` | `DirectoryEntry`, `FileEntry`, `LibraryEntry` | Internal index entries, which add root-relative paths |
| `library/model.ts` | `LibrarySnapshot` | Read-only published index with ID and parent-child maps |
| `library/model.ts` | `DirectoryListing`, `LibraryStatus` | Application results consumed by HTTP presenters |
| `library/scan-state.ts` | `Timestamp` | ISO 8601 UTC string timestamps used by the library and resource metadata |
| `library/scan-state.ts` | `ScanWarningSummary`, `ScanState`, `LibraryIssue` | Backend business scan state and safe failure information |
| `library/scan-state.ts` | `ScanStateFields` | Private common fields for the business scan union |
| `application/library.ts` | `SettingsStore` | Configuration capability required by the library application, not a JSON object |
| `application/library.ts` | `UpdateLibrarySettings`, `RunningScan` | Local application input and lifecycle helpers |
| `library/scanner.ts` | `ScanTraversalProgress` | Scanner-owned mutable counts and warnings, reported to the application through a progress callback |
| `library/scanner.ts` | `ScanTask` | Private directory/file work queue items |

The scanner updates a separate traversal object. The application copies reported
counts and warnings into its lifecycle state; it does not pass its `RunningScan`
object to the scanner. Public scan DTOs are constructed by the HTTP presenter.

Library entries contain filesystem-relative paths. The application constructs
path-free business information, and HTTP presenters explicitly select public
fields. Additional internal fields are not automatically serialized.

## Playback Data

The following types are owned by `playback/model.ts` and are backend business
data. Playback-session, progress-save, release, and history
HTTP endpoints call the application. Presenters map these results to independent
public schemas; database source IDs and internal paths are omitted.

| Type | Purpose |
| --- | --- |
| `PlaybackSourceIdentity` | Canonical root, file ID, relative path, and file version |
| `ResolvedPlaybackSource` | Validated source identity, path-free file information, and root epoch |
| `RegisteredPlaybackSource` | Registered source identity and persistence metadata returned by the repository |
| `PlaybackProgress` | Durable business progress, including generation, last sequence, and timestamps |
| `PlaybackProgressUpdate` | Repository progress-write input |
| `SavePlaybackProgressResult` | Saved, duplicate, or stale repository/application result |
| `PlaybackSession` | Application open result with token, generation, file, direct plan, and progress |
| `SavePlaybackProgress` | Application save input with token, file version, generation, sequence, and position |
| `ContinueWatchingCandidate` | Ordered repository candidate before live availability checks |
| `ContinueWatchingItem` | Validated available file and saved progress |
| `ContinueWatchingResult` | Availability-check state and validated items |

`PlaybackSessionState` belongs only to `application/playback.ts`. Its token-keyed
Map stores authorization state, root epoch, generation, `touchedAtMs`. It is not persisted or exposed as a DTO.

`PlaybackProgressRow` and `MediaSourceRow` are private schema-derived types in
`database/playback-repository.ts`. Repository projections return independently
defined business records, so a table-column addition does not automatically
change application result types. Transactions, generation checks, sequence
ordering, and database constraints retain their existing behavior.

The schema contains `resourceRoots`, `mediaSources`, and `playbackProgress`.
`Store` in `database/index.ts` describes the Drizzle database capability and is
used by the repository; it is not a business record.

## Resource and Local Helper Types

| Definition | Type | Purpose |
| --- | --- | --- |
| `resources/access.ts` | `ResourceFileMetadata` | Inspected size, modification timestamp, and MIME type |
| `resources/access.ts` | `ResourceSourceMetadata` | File metadata with a content-version identity |
| `resources/access.ts` | `OpenedResourceFile` | Backend-only metadata, file handle, and release operation |
| `config/deployment.ts` | `Environment` | Private environment-variable parsing input |
| `http/media.ts` | `ByteRange` | Private byte-range parsing result |
| `http/security.ts` | `RequestOriginConfig` | Private listener settings needed for origin validation |
| `errors.ts` | `ErrorCode` | Shared typed error identifiers |

Numeric millisecond timestamps use the `AtMs` suffix. Serialized library
timestamps use ISO strings, such as `modifiedAt`, `startedAt`, and `finishedAt`.
File handles, Maps, relative paths, and mutable session objects belong to backend
operations rather than public JSON contracts.
