# Backend Data Structures

This document records implemented type ownership and data boundaries in
`backend/src`. Cross-module consumers import selected types through the owning module's `public.ts`; internal exports are not public module APIs or HTTP contracts.

## Ownership Rules

| Owner | Responsibility | Consumers |
| --- | --- | --- |
| `contracts/schemas` | Public TypeBox schemas for JSON requests, responses, DTOs and runtime constraints | HTTP routes and contract type inference |
| `contracts/http.ts` | `Static<typeof Schema>` aliases derived from the public schemas | Presenters and the Web API client |
| `transport/instance.ts` | Fastify instance type retaining the TypeBox Type Provider | JSON API route modules |
| `transport/presenters.ts` | Explicit conversion from backend business data into public JSON shapes | HTTP handlers |
| `modules/configuration/domain/model.ts` | Validated deployment options and persisted user settings | Startup, configuration, logging, applications, resource access, and HTTP configuration/presentation |
| `modules/library/domain/model.ts` | Resource identity, path-free business information, internal index entries, snapshots, listings, and library status | Library index, scanner, applications, and HTTP presenters |
| `modules/library/domain/scan-state.ts` | Business scan lifecycle, safe issues, and warning summaries | Library application, scanner, resource access, and HTTP presenters |
| `modules/playback/domain/model.ts` | Backend playback identity, progress, commands, and results independent of SQLite | Applications and playback repository |
| `platform/database/schema.ts` | SQLite tables and constraints | Database adapters |
| Implementation files | Private runtime state and local helpers | Their owning module |

Application and adapter modules do not import HTTP contracts. HTTP handlers call
application use cases, and presenters import business types to build DTOs.
Public contracts do not import backend business models or runtime modules.
`npm run lint` runs Biome and the resolved-import architecture checker, including type-only imports and business-module cycles.

## Public HTTP Contracts

All public JSON shapes are defined by TypeBox in `contracts/schemas` and exported as
inferred types from `contracts/http.ts`. Route request and response types are
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

The scan schema reuses private common fields for its state union. `contracts/errors.ts` owns
the stable `errorCodes` vocabulary and derives `ErrorCode` from it; the error
schema uses the same values. The health route uses `HealthResponseSchema` and
returns `{ status: "ok" }`.

The Web client imports types through `@anishelf/backend/contracts/http`. This
workspace export resolves to source and does not bundle backend runtime code.

## Library and Configuration Data

| Definition | Types | Scope |
| --- | --- | --- |
| `modules/configuration/domain/model.ts` | `LogLevel`, `LoggingConfig`, `DeploymentConfig`, `MediaToolsConfig` | Backend startup and infrastructure configuration |
| `platform/media/model.ts` | `MediaInfo`, `MediaStream`, `ToolStatus` | FFprobe descriptors and independently discovered tool availability; internal infrastructure types |
| `platform/media/model.ts` | `SubtitleFormat`, `ExtractedSubtitle` | Selected text subtitle extraction result; persistence and access control belong to the caller |
| `modules/configuration/domain/model.ts` | `PersistentSettings` | `settings.json` and backend settings operations; HTTP projects it into an independent `SettingsResponse` |
| `modules/library/domain/model.ts` | `ResourceId`, `DirectoryInfo`, `FileInfo`, `ResourceInfo` | Backend identity and path-free business information |
| `modules/library/domain/model.ts` | `DirectoryEntry`, `FileEntry`, `LibraryEntry` | Internal index entries, which add root-relative paths |
| `modules/library/domain/model.ts` | `LibrarySnapshot` | Read-only published index with ID and parent-child maps |
| `modules/library/domain/model.ts` | `DirectoryListing`, `LibraryStatus` | Application results consumed by HTTP presenters |
| `modules/library/domain/scan-state.ts` | `Timestamp` | ISO 8601 UTC string timestamps used by the library and resource metadata |
| `modules/library/domain/scan-state.ts` | `ScanWarningSummary`, `ScanState`, `LibraryIssue` | Backend business scan state and safe failure information |
| `modules/library/domain/scan-state.ts` | `ScanStateFields` | Private common fields for the business scan union |
| `modules/configuration/public.ts` | `SettingsStore` | Configuration persistence capability used by the root-switch application |
| `modules/library/application/scan-coordinator.ts` | `RunningScan` | Private scan lifecycle state |
| `modules/library/infrastructure/scanner.ts` | `ScanTraversalProgress` | Scanner-owned mutable counts and warnings, reported to the application through a progress callback |
| `modules/library/infrastructure/scanner.ts` | `ScanTask` | Private directory/file work queue items |

The scanner updates a separate traversal object. The application copies reported
counts and warnings into its lifecycle state; it does not pass its `RunningScan`
object to the scanner. Public scan DTOs are constructed by the HTTP presenter.

Library entries contain filesystem-relative paths. The application constructs
path-free business information, and HTTP presenters explicitly select public
fields. Additional internal fields are not automatically serialized.

## Playback Data

Progress/session types are owned by `modules/playback/domain/model.ts`.
`SourceIdentity`, `ResolvedSource`, `RegisteredSource` and `FileInfo` belong to
`modules/media-source/domain/model.ts`; consumers use its Public API. Playback-session, progress-save, release, and history
HTTP endpoints call the application. Presenters map these results to independent
public schemas; database source IDs and internal paths are omitted.

| Type | Purpose |
| --- | --- |
| `SourceIdentity` | Canonical root, file ID, relative path, and file version |
| `ResolvedSource` | Validated source identity, path-free file information, and root epoch |
| `RegisteredSource` | Registered source identity and persistence metadata returned by the repository |
| `PlaybackProgress` | Durable business progress, including generation, last sequence, and timestamps |
| `PlaybackProgressUpdate` | Repository progress-write input |
| `SavePlaybackProgressResult` | Saved, duplicate, or stale repository/application result |
| `PlaybackSession` | Application open result with token, generation, file, direct plan, and progress |
| `SavePlaybackProgress` | Application save input with token, file version, generation, sequence, and position |
| `ContinueWatchingCandidate` | Ordered repository candidate before live availability checks |
| `ContinueWatchingItem` | Validated available file and saved progress |
| `ContinueWatchingResult` | Availability-check state and validated items |

`PlaybackSessionState` belongs only to `modules/playback/application/playback.ts`. Its token-keyed
Map stores authorization state, root epoch, generation, `touchedAtMs`. It is not persisted or exposed as a DTO.

`PlaybackProgressRow` belongs to the playback repository; `MediaSourceRow`
belongs to `modules/media-source/infrastructure/repository.ts`. Both are private
schema-derived types. Repository projections return independently
defined business records, so a table-column addition does not automatically
change application result types. Transactions, generation checks, sequence
ordering, and database constraints retain their existing behavior.

The schema contains `resourceRoots`, `mediaSources`, `playbackProgress` and `subtitleAssets`.
`Store` in `platform/database/store.ts` describes the Drizzle database capability and is
used by the repository; it is not a business record.

## Resource and Local Helper Types

| Definition | Type | Purpose |
| --- | --- | --- |
| `modules/media-source/infrastructure/access.ts` | `ResourceFileMetadata` | Inspected size, modification timestamp, and MIME type |
| `modules/media-source/infrastructure/access.ts` | `ResourceSourceMetadata` | File metadata with a content-version identity |
| `modules/media-source/infrastructure/access.ts` | `OpenedResourceFile` | Backend-only metadata, file handle, and release operation |
| `modules/configuration/infrastructure/deployment.ts` | `Environment` | Private environment-variable parsing input |
| `modules/library/http/media.ts` | `ByteRange` | Private byte-range parsing result |
| `transport/security.ts` | `RequestOriginConfig` | Private listener settings needed for origin validation |
| `contracts/errors.ts` | `ErrorCode` | Shared typed error identifiers |

Numeric millisecond timestamps use the `AtMs` suffix. Serialized library
timestamps use ISO strings, such as `modifiedAt`, `startedAt`, and `finishedAt`.
File handles, Maps, relative paths, and mutable session objects belong to backend
operations rather than public JSON contracts.
