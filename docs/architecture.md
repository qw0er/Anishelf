# Anishelf Architecture

- [1. Architecture and Modules](#1-architecture-and-modules)
- [2. Configuration, Persistence, and Identity](#2-configuration-persistence-and-identity)
- [3. Inherited Library and Media Behavior (V1 → V2)](#3-inherited-library-and-media-behavior-v1--v2)
- [4. Vidstack Web Playback (V2; V04–V06, O16)](#4-vidstack-web-playback-v2-v04v06-o16)
- [5. Progress, Resume, and Lists (V2; W01–W02)](#5-progress-resume-and-lists-v2-w01w02)
- [6. Subtitles (V2; P03, Partial P08–P09)](#6-subtitles-v2-p03-partial-p08p09)
- [7. Playback Plan and FFmpeg Transcoding (V2; P05–P07)](#7-playback-plan-and-ffmpeg-transcoding-v2-p05p07)
- [8. External-Player Media Link (V2; C01)](#8-external-player-media-link-v2-c01)
- [9. HTTP Contracts and Failure Semantics](#9-http-contracts-and-failure-semantics)
- [10. Everyday Interface (V2; O16)](#10-everyday-interface-v2-o16)
- [11. Delivery Order, Acceptance, and Deferred Scope](#11-delivery-order-acceptance-and-deferred-scope)
- [Backend Data Structures](#backend-data-structures)
- [Playback Progress Storage](#playback-progress-storage)
- [UI Conventions](#ui-conventions)
- [Implemented Integration Reference](#implemented-integration-reference)

**V1 is implemented; V2 is in progress.** The direct-playback Vidstack adapter
and saved progress are implemented. External subtitle delivery/rendering and embedded
subtitle discovery/preparation/delivery are implemented; embedded fonts, video preparation,
and the remaining V2 workflows are planned. The [current requirements](requirements.md#current-release-scope-and-acceptance) define scope and acceptance.

The [UI conventions](#ui-conventions) below record page compositions and screen
conventions built on Tailwind defaults and shared controls. The broader V2 interface remains planned.

## 1. Architecture and Modules

### 1.1 Architecture classification

Anishelf is a browser/server (B/S) application with separate React and Node.js
workspaces. The backend is a modular monolith organized by business feature, with
layers inside each module. HTTP uses request/response; business modules collaborate
through explicit in-process APIs. Repositories persist current state with SQLite
transactions. This is practical layering, not strict Clean Architecture, CQRS,
Event Sourcing or a message-driven system.

| Dimension | Current classification |
| --- | --- |
| System form | B/S, including deployments where browser and server share a machine |
| Frontend/backend relationship | Separate workspaces and HTTP boundary; shared browser-safe contracts |
| System decomposition | Modular monolith; one backend process |
| Code organization | Package by feature, with HTTP/application/domain/infrastructure folders within backend modules |
| Internal design | Layered applications, explicit module APIs and dependency injection at bootstrap |
| Database read/write design | CRUD-style state persistence with repositories and transactions |
| Module communication | HTTP request/response, direct in-process calls, background work and status polling |

### 1.2 Feature-oriented architecture: implemented and planned

The diagram groups React features and backend business modules by capability.
HTTP, application, domain and infrastructure belong inside their owning backend
module rather than forming global horizontal layers. Solid boxes describe current
code; dashed amber elements describe the remaining V2 proposals. Selected arrows
mean **caller → dependency**; the catalog and registry wiring notes describe
bootstrap injection rather than reverse module imports. Proposed names describe
responsibilities, not existing classes.

![Anishelf frontend features, backend business modules and planned V2 extensions](architecture.svg)

Library, Playback and Subtitles depend on the Media Source public API and the
Configuration public policy/types; Library and Media Source also consume the
settings-store capability. Media Source depends on Configuration, never Library.
The shared transport and platform areas support these modules; they do not own
business workflows. Frontend feature imports follow Library → Playback → Subtitles.

`bootstrap/` owns assembly, startup and shutdown. It connects the source catalog
port to the library index, creates one media-source service and one source
registry, injects these into consumers, and registers module HTTP routes. Other
modules cannot import bootstrap. Shared models and policy are dependencies, not
an extra stage through which requests must flow.

### 1.3 Code organization and public boundaries

```text
backend/src/
  bootstrap/             # Process and dependency assembly
  modules/
    configuration/       # Effective configuration and atomic settings persistence
    library/             # Browse, scan coordination and root-switch use case
    media-source/        # Source identity, root epoch and confined access
    media-inspection/    # Shared version-bound probe cache and concurrency
    playback/            # Sessions, progress and history
    subtitles/           # Discovery, preparation, delivery and asset lifecycle
  contracts/             # Browser-safe HTTP schemas/types, formats and defaults
  transport/             # Shared HTTP security, presenters, errors and static serving
  platform/              # Database schema/connection types, logging, media processes
  shared/                # Domain errors and common collation

web/src/
  features/
    library/
    playback/
    subtitles/
  routes/                # Route composition and loaders/actions
  api/                   # HTTP requests and shared contract types
  components/ui/         # Shared presentation controls
```

Each backend business module has a `public.ts` that exposes selected capabilities
and types. Cross-module imports must resolve to that file, including type-only
imports. Public APIs are TypeScript interfaces/functions, not extra HTTP services.
Only bootstrap may import another module's implementation for assembly. Modules
use `http/`, `application/`, `domain/` and `infrastructure/` where needed; empty
layers are not required.

| Caller | Allowed business dependency |
| --- | --- |
| Module HTTP routes | Their own Application; contracts and shared transport helpers handle validation and presentation |
| Application | Its own domain/adapters and another module's Public API; never HTTP or Fastify |
| Domain | Business definitions and stable shared definitions; no own application or concrete infrastructure |
| Infrastructure | Its own models and platform services; no application or HTTP coordination |
| Bootstrap | Concrete implementations needed to assemble the process |
| Web feature | Another feature's `public.ts`; backend imports are restricted to explicitly exported browser-safe contracts |

`npm run architecture:check` resolves imports with the TypeScript compiler API and
checks these boundaries, including dynamic literal imports, type imports and
re-exports. It rejects business-module and frontend-feature cycles. `npm run lint`
runs both Biome and this check. Tests may inspect implementation details for
regression coverage; production source is checked independently.

### 1.4 Responsibility and state ownership

| Owner / entry | Responsibility |
| --- | --- |
| [`bootstrap/library.ts`](../backend/src/bootstrap/library.ts) | Connect the catalog port to `LibraryIndex`; assemble source, scan and settings capabilities |
| [`library/application/library.ts`](../backend/src/modules/library/application/library.ts) | Browse published entries and expose library use cases; delegate scan/settings/source work |
| [`library/application/scan-coordinator.ts`](../backend/src/modules/library/application/scan-coordinator.ts) | Own the single scan timer, task state, cancellation, settings/scan exclusion and snapshot publication |
| [`library/application/settings.ts`](../backend/src/modules/library/application/settings.ts) | Commit settings through Configuration, then invalidate the source epoch/reset the index on a real root change and trigger scanning |
| [`media-source/public.ts`](../backend/src/modules/media-source/public.ts) | Source API, source/catalog models and controlled access capabilities; no library implementation dependency |
| [`media-source/application/sources.ts`](../backend/src/modules/media-source/application/sources.ts) | Own the root epoch, resolve indexed IDs, inspect source versions and open confined media; reject asynchronous resolution spanning a root change |
| [`media-source/infrastructure/repository.ts`](../backend/src/modules/media-source/infrastructure/repository.ts) | Register canonical roots and source versions for both playback and subtitles; preserve existing identity hashes |
| [`playback/public.ts`](../backend/src/modules/playback/public.ts) | Session/progress/history capability and result types; the application depends on `MediaSourceApi`, not Library |
| [`subtitles/public.ts`](../backend/src/modules/subtitles/public.ts) | Discovery/preparation/content capability and result types; the application depends on `MediaSourceApi`, not Library or Playback |
| [`configuration/public.ts`](../backend/src/modules/configuration/public.ts) | Settings-store interface, configuration types and program policy; atomic persistence stays internal |

The catalog port exposes only indexed file lookup and snapshot availability.
Bootstrap supplies it from the index; Media Source never imports Library. Missing
or unscanned IDs retain their existing behavior. The source service owns the one
root epoch; only the root-switch callback assembled by bootstrap invalidates it.
Playback and subtitle consumers receive the read-only source capability.

Settings and scans share the coordinator's exclusion gate. A failed settings
write preserves the prior index and epoch. A same-root save does not trigger a
scan. Successful root changes reset the snapshot only after persistence. Scheduled,
manual and startup scans continue to use the same lifecycle and cancellation path.

| State | Owner / persistence |
| --- | --- |
| User settings | Configuration; atomic `settings.json` |
| Published index | Library; rebuildable memory |
| Scan state, timer and operation gate | Scan coordinator; process memory |
| Root epoch | Media Source; process memory |
| Root/source identity records | Source registry; existing SQLite tables |
| Progress/history | Playback repository; SQLite |
| Playback session tokens | Playback application; process memory |
| Probe cache and extraction work | Subtitle applications; process memory |
| Subtitle asset metadata / payloads | Subtitle repository / private cache files |

The existing database schema, migrations, identity hashes, settings format and
HTTP URLs are unchanged by this organization. No new queue, event bus or universal
job engine is introduced. See [backend data structures](#backend-data-structures) below
for type ownership and [development](development.md) for operational behavior.

### 1.5 Browser organization and call paths

Frontend components, hooks and controllers are grouped in `features/library`,
`features/playback` and `features/subtitles`. Each feature has a `public.ts` for
cross-feature use. `SubtitleTracks` and `useSubtitleDiscovery` handle both external
and embedded tracks. `SubtitleController` registers all supported tracks and uses
the same selected-track preparation flow without branching on `origin`. Routes
compose screens; the common API client and UI controls stay shared.

1. **Scan:** library HTTP → `LibraryApplication.startScan` → `ScanCoordinator`
   → scanner → Media Source access API; the coordinator publishes to the index.
2. **Root switch:** settings HTTP → `SettingsApplication.updateSettings` →
   scan exclusion gate → Configuration commit → source epoch invalidation/index
   reset → scan. Bootstrap connects the invalidation callback.
3. **Playback:** player controller → playback HTTP → `PlaybackApplication` →
   `MediaSourceApi` + playback repository. Vidstack independently requests media
   bytes through library HTTP → library application → source API.
4. **Subtitles:** subtitle controllers → subtitle HTTP → `SubtitleApplication`
   → source API + discovery/media adapters. A selected embedded track delegates
   to `SubtitlePreparationApplication`, which validates the source, extracts,
   publishes the file atomically and saves the ready asset row.
5. **Persistence:** bootstrap injects a common source registry into playback and
   subtitle repositories. Subtitle persistence no longer depends on the playback
   repository for source registration.

### 1.6 Planned V2 extensions and historical design

Dashed modules remain proposals, not new implementations delivered by this
refactor. Their final placement must follow the same public boundaries.

| Planned module / extension | Intended integration | Design section |
| --- | --- | --- |
| Media tasks and playback/cache settings | Extend routes and the API client; basic settings already exist | 2, 10 |
| HLS player adapter | Extend Vidstack with hls.js, source-time seeking and leases | 4, 7 |
| Preparation / HLS / font routes | Validate requests and call application use cases | 9 |
| Video preparation / HLS sessions | Coordinate jobs and real-time sessions through source APIs, planner and scheduler | 7 |
| Playback planner | Compatibility, stream-copy/encoding choices and prepared-asset reuse | 7 |
| Media scheduler / transcode worker | Bounded video-processing slot, real-time priority and controlled FFmpeg execution | 7 |
| Job / asset repositories | Persist operational metadata without coupling to playback repositories | 2, 7 |
| Generated cache / leases | Budget, eviction, source/profile validity and active-reader protection | 2, 7 |
| Font preparation | Extend subtitles, media tools and registered font delivery to JASSUB | 6 |

Video/font work, automatic cache eviction and broader V2 settings remain planned.
Unassigned metadata, download/subscription, tracker and desktop-bridge features
are outside this diagram. Retain the [V1 design](history.md#v1-design) and
[historical design index](history.md); the following sections preserve
the detailed V2 target design.

## 2. Configuration, Persistence, and Identity

### Configuration (V1 retained; V2 additions)

Startup uses defaults and environment variables for the listener, data directory and logging. Optional `ANISHELF_FFMPEG_PATH` and `ANISHELF_FFPROBE_PATH` executable paths accept absolute values. When omitted, resolve `ffmpeg` and `ffprobe` from the server process environment's **PATH**. Resolve each independently; do not require both overrides and do not invent mandatory binary-specific environment variables. An invalid explicit override produces an actionable tool error rather than silently choosing another binary. The implemented tool layer resolves and checks versions at startup, retains absolute paths for child processes, and rediscovers after restart. It offers on-demand media inspection and selected text-subtitle extraction through `MediaTools`; embedded inspection, registered text assets and player selection are integrated. Transcoding and embedded font integration remain planned. Missing binaries log warnings without disabling direct playback. Service managers must provide PATH if their default environment omits the tools.

Missing tools do not prevent V1 browsing, direct media delivery, or already usable external subtitles. Disable dependent probing/extraction/transcoding with a precise capability error. The administrator controls executable paths; Web requests never supply executables or arbitrary flags.

`settings.json` contains **user-configurable values only**: the resource root and V2's Web playback preference (`auto`, `direct`, or `pretranscoded`), total generated-cache budget (default 10 GiB) and selected profile IDs where exposed. `auto` tries supported original playback, then a valid prepared copy, then necessary real-time processing. `direct` does not start processing; `pretranscoded` offers preparation and waits for a ready copy if the original is incompatible. Per-file preparation remains explicit. If custom profile editing is exposed, store only validated user-defined profiles or parameter overrides here. Do not store built-in profile copies or viewing history in settings.

The cache budget applies to generated files, not the database or original media. Reserve capacity for active sessions and remove least-recently-used, unleased regenerable assets when necessary; never delete viewing history, originals, or active output. If capacity cannot be made available, return a storage error. Lowering the budget schedules cleanup rather than removing in-use assets.

Originals, writable data, and frontend static assets remain separate and non-overlapping. Use a single process-lifetime Pino logger, configured level and fixed stdout/file destination, with synchronous writes; add structured job/session IDs and redact credentials. Deferred log rotation/fallback requirements remain unchanged.

### Built-in defaults and user settings (O17)

The current-function foundation is implemented in `modules/configuration/domain/policy.ts` and `modules/configuration/application/service.ts`. The composition root creates one service; adapters receive typed read-only policy views. The service retains raw explicit settings separately from the effective immutable snapshot. Missing settings do not generate a file, failed writes preserve the published snapshot, and existing root-only settings remain valid. Current settings are `resourceRoot` and optional `scanIntervalMinutes`; the additional V2 settings described below remain planned.

Browser playback timing and subtitle renderer limits live in `web/src/config/media-policy.ts`. Browser-safe scan constraints and subtitle size limits are shared through `contracts/defaults.ts`; supported subtitle formats come from the shared format registry. No runtime client-configuration request is required. HTTP settings schemas receive server constraints through a factory and remain authoritative. Player policies are stable across scan polling, so revalidation does not reopen sessions or reset subtitle renderers. Loading-indicator delay and polling intervals remain local frontend interaction policy.

Current policy defaults preserve existing behavior: scan concurrency 8 and warning preview 5; session idle expiry 30 minutes and capacity 1000; history/continue defaults 100/20 and list/batch bounds 100; near-end threshold min(30 seconds, 5%); subtitle text 10 MiB; tool detection 5 seconds/64 KiB, execution 30 seconds/10 MiB and extraction 60 seconds; HTTP body 64 KiB, database busy wait and shutdown 5 seconds; progress saves/requests 5 seconds; subtitle initialization 15 seconds and renderer memory 64 MiB. These values are program-owned and are not user-editable. Transcode profiles and derived-cache invalidation remain planned.

The policy audit also centralizes subtitle read chunks (64 KiB), probe/extraction concurrency (one each), default text conversion (SRT), and name sorting (English, numeric, base sensitivity, directories first). `ScanCoordinator` configures sorting on the library index; subtitle discovery shares the name comparator. The history HTTP route delegates an omitted limit to `PlaybackApplication.history`, so an injected history default is honored. The history description does not embed a fixed count.

`web/src/config/interaction-policy.ts` owns loading delay, scan/subtitle polling (1000/500 ms), default/error Toast lifetimes (6000/10000 ms), persistent preparation feedback, seek steps (5 seconds), and eager/metadata player loading. These local presentation settings and the frontend default language are owned by the web workspace and are not serialized as server configuration. `contracts/subtitles.ts` supplies browser-safe subtitle enums, renderer subsets, MIME mappings, format conversions to schemas and adapters. The subtitle registry is the single source for format names, extensions, MIME, conversions, renderer support and native codecs; policy derives its default maps and codec list from that registry. Program capability checks remain separate from policy subsets.

`modules/subtitles/domain/identity.ts` owns opaque track/asset ID construction and the extraction processing version. Hash payloads and existing IDs remain compatible. `platform/storage.ts` owns stable paths, source-version markers, temporary suffixes and private permissions; changes require compatibility review. `platform/adapter-policy.ts` names fixed SQLite durability, logging redaction/write behavior and development static-cache constraints. `contracts/defaults.ts` shares deployment defaults and the Vite development port/origins. Subtitle fallback names are defined in `modules/subtitles/domain/identity.ts`; no separate subtitle message catalog is needed. No policy or capability file is generated in the data directory.

Startup uses environment variables. Media capabilities, transcode profiles, subtitle rules and runtime policy are defined in TypeScript. The English message catalog is a bundled read-only resource. None of these defaults is copied into `dataDir`; `dataDir/settings.json` stores only user choices and explicit overrides.

| Owner | Values | Update rule |
| --- | --- | --- |
| TypeScript | Discovery extensions and MIME mappings for MP4/M4V, WebM and MKV; container/codec capabilities; supported subtitle codecs/renderers/font types; 10/20/100 MiB text/font/total-font limits | Updated with the program; enabling discovery does not guarantee browser decoding |
| TypeScript | Prepared MP4 profile: H.264/yuv420p CRF 20/medium and AAC 192 kbit/s; real-time HLS/fMP4 profile: CRF 23/veryfast and AAC 192 kbit/s | Updated with the program; validate against delivery adapters and detected tools |
| TypeScript | Scan concurrency 8; media/probe/extraction slots 1 each; queue 20; progress interval 5 s; near-end 30 s/5%; lease renewal/expiry 10/30 s; paused stop 30 s; bounded cleanup and job timeouts | Updated with the program; define finite values and valid timing relationships |
| Bundled resource | English message catalog and fallback `en` | Updated with the program; additional locales and selection deferred |
| User | Resource root, Web mode, 10 GiB default cache budget, selected profile IDs; optional custom profile definitions or parameter overrides only if editing is exposed | Validated atomic writes to `settings.json`; explicit values persist |

The effective configuration is the current built-in defaults merged with explicit user settings. Missing settings keys use current defaults, so new program defaults apply without rewriting a generated policy file. Existing root-only settings remain valid. Reject malformed or unsupported explicit values with file/key diagnostics; perform an explicit migration only when the settings schema changes. Custom profiles cannot add a muxer, encoder or delivery adapter that the program lacks.

The entry point constructs a typed `ConfigurationService`. Only this layer reads environment variables, resolves built-in policy, validates user settings and writes `settings.json`. Library, resource access/MIME resolution, playback planner, workers, subtitle service and HTTP composition receive immutable typed views through injection. The Web build owns presentation and media-controller preferences and imports only browser-safe shared constraints. Retain validated `GET/PUT /api/settings` for writable preferences; server paths and credentials are never bundled into the frontend.

Settings commit to disk atomically before replacing the in-memory snapshot. Running scans/jobs capture their effective settings and profile hash; any change to effective profile content invalidates derived-cache reuse, even when its ID stays the same. Validation schemas and path confinement remain program invariants.

### Multilingual readiness (O14 foundation; future M07)

Keep English as the shipped/default/fallback locale. Put UI text and user-facing error translations behind stable message keys in a separate English catalog, including player controls and accessible labels. API errors retain stable codes and interpolation parameters plus an English fallback message; never use translated strings as identity. Locale changes must not recreate playback or alter IDs, filenames, records or routes. No additional language pack or language selector is required in V2.

Future program metadata must support language-tagged titles, aliases and descriptions, an original-language tag, and locale-independent program/episode IDs. Resolution will prefer exact locale, base language, original language, then a deterministic available value. Reserve this contract without adding metadata tables, provider integration or program pages to the file-based V2 workflow. Original filenames remain untouched.

### SQLite and Drizzle ORM (V2)

Use a local `anishelf.sqlite` under `dataDir`, accessed through Drizzle repositories; select `better-sqlite3` as the initial adapter and verify its Node/runtime packaging during implementation. Drizzle supports [SQLite adapters](https://orm.drizzle.team/docs/sqlite/get-started-sqlite). Generate and review versioned SQL migrations with Drizzle Kit, apply them before dependent features become ready, and track applied migrations. Do not perform destructive schema push at runtime. V1 has no history database to import; retain its settings JSON untouched except explicit user-setting upgrades.

| Storage | Contents | Policy |
| --- | --- | --- |
| settings.json | User-configurable application preferences | Atomic JSON writes; authoritative settings source |
| SQLite durable tables | Root/source identity and progress | Transactional; never erased by cache cleanup |
| SQLite operational/cache tables | Probe results, subtitle/font asset metadata, conversion jobs, prepared assets, HLS sessions | Versioned, invalidatable and recoverable |
| Private cache directories | MP4, HLS manifests/segments, extracted subtitles/fonts | File payloads; referenced by opaque database IDs |
| In-memory index | Rebuildable current directory snapshot | Retain V1 scan behavior |

Use foreign keys, a finite busy timeout, WAL mode, and short transactions. Uniquely constrain source-version/profile/preparation-mode keys for deduplication; enforce progress generation/sequence checks and updates within one transaction. Index history by root and last-viewed time, and jobs by state. Never hold a transaction across FFmpeg work or streaming. Choose `synchronous=FULL` for committed durable records and include WAL-aware backup/migration recovery in operational documentation. SQLite must be on local writable storage; copying a live database file alone is not a complete backup.

The filesystem and SQLite are not one transaction: write/validate and rename an asset first, then commit its ready row. Startup reconciliation removes orphan files, invalidates missing ready assets, and fails interrupted sessions/jobs. Cache deletion marks an asset unavailable transactionally before file removal; retry tombstones after failure. Database/migration failure must not silently create an empty database: preserve data, report diagnostics, disable dependent writes and derived playback, and keep independent V1 functions available where their state is valid.

| Record | Minimum fields | Lifecycle |
| --- | --- | --- |
| Root / source | Canonical root key, file ID, source version | Namespace history/cache; revalidate before use |
| Progress | Source key, position, duration, server time, session generation, sequence | Durable; original, MP4 and HLS share it |
| Probe cache | Source version, tool/probe version, streams/duration | Regenerable |
| Subtitle / font asset | Source/sidecar version, stream or attachment ID, format, converter version, file ID | Lazy extraction and invalidation |
| Transcode job / prepared asset | Source, stream selections, profile/mode, state, output ID, error | Persistent queue; publish only validated completion |
| Real-time session | Source, profile, generation, source-time origin, lease, segment registry, state | Ephemeral files; interrupted sessions expire on restart |

V1 file IDs hash kind and relative path and are not globally unique across roots. V2 therefore namespaces records by canonical root identity. A source version uses high-resolution size/mtime/ctime and available device/inode metadata from the safely opened file; ordinary content replacement invalidates records even at the same path. Check before and after processing. Identical-stat adversarial replacement is outside the trusted-local-media-tree model; this is not a content hash guarantee. Renames create new identities; automatic relinking remains L11, unassigned.

The library index stays in memory and is rebuilt by an automatic scan at startup whenever a resource root is configured, and after the resource root changes; scheduled scans default to a 60-minute interval after scan completion, with a configurable interval or disable option in settings.json. Manual scans remain available after media changes. History survives independently. Until a scan completes, lists explain that availability is unknown; do not expose playable links merely because a history record exists. Partial scan omissions never erase history. Switching roots clears the active listing and playback session but retains records under their original root keys.

## 3. Inherited Library and Media Behavior (V1 → V2)

Preserve one scan with bounded traversal, shared concurrent scan starts, settings/scan exclusion, directories-first natural sorting, and atomic snapshot publication. Retain the prior snapshot on root failure; report partial child failures. Scan only recognized video extensions; inspect subtitles on file selection rather than adding them as playable library entries.

Keep original media read-only and IDs opaque. Recheck canonical containment, path components, symlink replacement, and regular-file type when opening resources. Capture the root and entry together so a settings change cannot redirect an in-flight lookup. Existing open streams keep their handles. This retains the local trusted-tree threat model, not a guarantee against hostile concurrent filesystem mutation.

Retain bounded streaming, `HEAD`, single bounded/open/suffix byte ranges, `206`, and unsatisfiable `416`. Malformed/multipart ranges and unverifiable `If-Range` fall back to full `200`; HEAD ignores Range. Close handles on completion, errors, and disconnect. Never buffer the whole media file into a browser Blob. Prepared-media delivery uses the same transport behavior, resolved through a separate private asset registry.

## 4. Vidstack Web Playback (V2; V04–V06, O16)

The current adapter uses bundled `@vidstack/react` 1.15.6 for original-media HTTP Range playback. `MediaPlayer`, `MediaProvider`, and the default video layout provide player state, accessible controls, keyboard interaction, and fullscreen. The application owns source-access checks and server progress persistence. Provider setup attaches the native video to the progress controller; unmount detaches before provider cleanup. Local player storage is disabled so it cannot compete with server resume. The broader workflow below remains the V2 target.

Use the [React components](https://vidstack.io/docs/player/getting-started/installation/react/) from the pinned npm dependency, with bundled styles and no runtime CDN. The provider controls the browser video element; it does not add codecs or replace server preparation.

1. A file or resume action opens `/files/:id?directory=<id>`. Load the source reference, playback plan, history, and subtitle choices, keeping individual nonfatal failures separate.
2. Mount one player per selected source. Provide the original, ready-copy, or real-time HLS URL, English controls, metadata preload, play/pause, seeking, volume, and fullscreen. Playback starts from user input; do not require audible autoplay.
3. Load history before enabling automatic progress writes. Restore a finite saved position after media metadata arrives, clamped to actual duration; then enable event-driven saving. If history loading fails, playback remains available with Retry file available and saving disabled.
4. Map underlying media metadata, pause, seek completion, time updates, ended, and error events into application actions. Keep the adapter independent of route revalidation; scan polling must not recreate the player.
5. On explicit source/copy switch, capture position, pause saving during setup, load the new URL, restore position once ready, and reapply the selected subtitle. Original, copy, and real-time playback use the same history key. HLS uses the source-time mapping in Section 7.
6. On normal exit, capture the final position and save/release in the background without blocking navigation; unmount the player to release its media source. Tab termination only permits best-effort flushing. Destroy hls.js/JASSUB workers, release real-time sessions, remove timers/listeners, and abort obsolete subtitle/metadata requests. Verify React StrictMode setup/cleanup and repeat navigation.
7. On playback error, recheck accessibility before reporting a missing/unreadable source. If decoding remains uncertain, show a generic playback failure with retry, pre-transcoding, real-time playback, and a Copy media link option. Automatic Web mode may select real-time transcoding for a known incompatibility; a generic error alone must not trigger repeated conversion attempts or launch a native player.

Keep subtitle labels and filenames as text, and subtitle HTML escaping enabled. Do not enable server-dependent download, offset, quality workflows, extra shortcuts, or unrelated plugin features merely because they exist. Basic keyboard accessibility is required; P10's additional playback tools remain unassigned. Disable any built-in independent resume store so server history is authoritative.

## 5. Progress, Resume, and Lists (V2; W01–W02)

Create a server-issued playback session only after a successful history read. Atomically increment its generation for that source. Each update includes source version, generation, monotonically increasing sequence, position, and duration. Reject an older generation or sequence; retrying an identical accepted update is idempotent. Check finite nonnegative times and clamp to the validated duration. Use server timestamps for ordering, never client clock order or maximum playback position.

Save approximately every five seconds while playing, and on pause, completed seek, ended, and normal exit. Serialize frontend writes and coalesce periodic updates; retain the newest failed payload for retry. An intentional backward seek, including seeking to zero, is a newer ordinary update within the current session generation. Opening a new session rotates the generation and rejects delayed writes from earlier sessions. After server restart, sessions must be reopened before updates are accepted. This protects one-session operation without introducing W06's multi-client reconciliation.

Continue watching includes available records with positive position that are not near the end, ordered by `lastViewedAt` descending with source ID as a stable tie-breaker. Define near-end as remaining time no greater than `min(30 seconds, 5% of duration)` for a finite positive duration. An ended event stores duration as position. This only controls list membership; it does not mark an episode watched. A compact Recently watched list includes finished records as well, under the same availability checks. Missing files may be shown disabled with rescan feedback; do not delete their records. Unknown/nonfinite duration does not qualify for completion and is not persisted as a fabricated value.

## 6. Subtitles (V2; P03, Partial P08–P09)

`SubtitleApplication` owns both subtitle HTTP use cases, independently of playback
sessions. Startup injects a shared `MediaInspectionApi` for probing and the
resolved `MediaTools` extraction capability. `GET /api/files/:id/subtitles`
merges same-directory external candidates with FFprobe subtitle-stream descriptors.
The public track shape is shared by both sources: opaque ID, name, language/title,
format, source version, size, codec, default/forced flags, `supported` and
`unsupportedReason`. `origin` remains descriptive metadata; the frontend does not
branch on it. External tracks have a known size, a null codec and false default/forced
flags. Embedded sizes are unknown (`null`); stream indexes and server paths are
private. The backend derives `supported` from its codec/format capabilities, not the
availability of a prepared asset or a guarantee of successful rendering. `mov_text`/`text` anticipate SRT conversion; WebVTT maps to `vtt`.
Unknown and bitmap codecs remain visible with an unsupported status.

Discovery validates the source/root before and after inspection. The shared
`MediaInspectionApplication` in `modules/media-inspection/application/inspection.ts`
owns probing, not the subtitle application. Its `public.ts` exposes a read-only
`MediaInspectionApi.inspect(fileId, expectedSourceVersion?)` capability for subtitle
and future playback-plan consumers. It resolves confined sources through
`MediaSourceApi`, checks source version/root epoch before reuse and after probing,
and returns the resolved source plus media information. The result is backend-only;
filesystem paths and stream indexes are not public HTTP contracts.

Successful probes are cached in memory by canonical root, file ID and source version,
up to `media.maximumProbeCacheEntries` (32 by default); oldest insertions are evicted.
Same-source callers share one active probe across consumers. Uncached sources receive
`MediaInspectionBusyError` when `media.probeConcurrency` is exhausted; there is no
unbounded queue. Callers receive independent copies of media information, so one
consumer cannot mutate another consumer's cached result. Failures are not cached.
Every caller revalidates its source, including on cache hits. File replacement or a
root-epoch change produces `PLAYBACK_CONFLICT` rather than usable stale metadata.

Subtitles map busy feedback to `SUBTITLE_PROBE_BUSY`, and FFprobe absence/failure to
safe `SUBTITLE_PROBE_UNAVAILABLE` / `SUBTITLE_PROBE_FAILED` warnings alongside external
candidates. An application without an inspection provider skips embedded inspection.
The composition root owns the shared service lifetime: closing subtitles stops only
subtitle preparation; server shutdown aborts and awaits shared probes before the
database closes. No scan/list request or service construction starts probing.

Discovery does not read subtitle contents, extract tracks or write assets. The player
registers all supported tracks as empty local placeholders in Vidstack's CC menu,
initially off. Selecting any track calls
`POST /api/files/:id/subtitles/:trackId/prepare` with the discovered video
`sourceVersion` and track `subtitleVersion`; no selectors, paths or conversion flags
are accepted. `SubtitleApplication` resolves the opaque ID and chooses the source
implementation. External preparation checks both versions and validates readable,
bounded, decodable text, then returns `200 ready` with the version-checked original
content URL and `statusUrl: null`. It creates no asset row or cache copy and works
without the extraction service. Missing or stale external track versions are rejected.
For compatibility, older embedded-only requests may omit `subtitleVersion`.
The external content endpoint still accepts sidecar IDs only and rechecks versions
when Vidstack loads the ready URL.

Embedded preparation returns `202 pending` with a status URL, or `200 ready` with a
content URL for a reusable asset. The frontend polls the supplied status URL only
while pending and handles both sources through the same controller. `GET /api/subtitle-assets/:id/status` returns
`pending | ready | failed` and a safe error code. Failed attempts can be retried
through the same prepare request. `GET /api/subtitle-assets/:id` serves UTF-8 text
only for registered, ready assets whose source/root and bounded regular file are
still valid; pending output never has a content URL. The asset registry uses SQLite
`subtitle_assets`, a source foreign key, selected stream, format and processing
version. It does not create a playback session or update viewing progress.

Text extraction uses the policy concurrency limit (one by default); same-asset requests share its pending record,
while a different extraction receives retryable busy feedback when all slots are occupied. Cache budget checks and publication are serialized even when multiple extraction slots are enabled. Processing preserves
supported text formats, converts `mov_text`/`text` to the policy default output format (SRT by default) when required, validates
output identity and size, and rechecks the source/root before and after publishing.
Files live under `dataDir/cache/subtitles/<opaque asset ID>.<format>`. A private
`.pending` file is written and synced, atomically renamed, then committed ready in
SQLite. Text output is limited to 10 MiB; the initial subtitle-only cache has a
program-owned 256 MiB budget, including files on disk. Full caches return explicit
failure; automatic eviction and user cache management remain planned. The proposed
shared generated-media budget in Section 2 remains a future configuration feature.

Startup removes orphan/partial files, fails interrupted pending work and invalidates
missing or replaced ready files. Valid ready assets survive restart and are reused.
Cache/database initialization failure disables embedded preparation while preserving
direct playback and external preparation/delivery. Shutdown aborts and awaits extraction before the
database closes. Cancelling frontend waiting does not cancel reusable server work.
The player polls only its selected pending track, displays preparing/failure/retry
feedback through Toast notifications, replaces the selected placeholder with the ready content URL, and ignores
late results after switching/off/unmount. Original-source cue timing and the existing
Vidstack/JASSUB rendering paths are retained. Browser acceptance used a generated
H.264 MP4 with an embedded `mov_text` track: opening CC made no cache file, selection
showed preparing feedback, extracted SRT rendered in the player, and captions off/on
removed/restored the overlay. Real MKV/SubRip preparation is also covered by an HTTP
integration test. This does not certify embedded fonts or every subtitle sample. Embedded fonts and bitmap extraction
remain planned; bitmap tracks are discoverable but cannot be selected for Web rendering.

Same-directory external subtitle discovery is implemented through `GET /api/files/:id/subtitles`, independently of library scans and playback-session persistence. Version-checked text delivery and player selection/off are implemented for direct playback through registered Vidstack text tracks and its built-in CC button / Captions menu. Retry file rebuilds the player and refreshes discovery; the current UI has no separate subtitle controls or feedback panel. The unified `SubtitleController` replaces selected placeholders with ready URL-backed Vidstack `TextTrack` instances, letting Vidstack load, parse and render VTT/SRT. A JASSUB 2.5.16 adapter is registered with Vidstack's `TextRenderer` interface for ASS/SSA; Vidstack owns renderer selection and lifecycle. Worker/WASM and the fallback font are bundled. Custom/embedded font loading remains planned. Parsing a format does not guarantee typography or effects. Package worker/WASM assets with the application and validate pinned versions. The supported V2 matrix is explicit:

| Input | Discovery / extraction | Browser rendering |
| --- | --- | --- |
| External VTT / SRT | Confined same-directory source; serve supported format without unnecessary conversion | Vidstack text subtitles |
| External ASS / SSA | Same-directory source; pass original ASS/SSA text directly to JASSUB | JASSUB renders supported styling and positioning with a fallback font; custom fonts remain planned |
| Embedded WebVTT / SubRip / ASS / SSA, including MKV | FFprobe descriptors; FFmpeg extracts selected stream to a standalone asset, retaining timing/styles where available | Same rendering path as an external file |
| Embedded font attachments | Extract referenced TTF/OTF attachments into private cache with opaque names | Supply only validated font assets to JASSUB; fallback font and warning if unavailable |
| Embedded PGS / VobSub | Identify and extract a supported native bitmap representation with FFmpeg; retain required paired files | Explicitly unsupported in Web V2; no OCR or silent conversion to text |
| Other codecs or malformed assets | Show descriptor and unsupported/extraction error | Video remains usable without the subtitle |

P08 remains partial for other extraction formats; P09 delivers ASS/SSA styling/fonts in V2 while bitmap rendering/burn-in remains unassigned. Do not mistake embedded extraction for native Vidstack demuxing of MKV or require video transcoding just to expose a subtitle.

For video stem `Episode 01`, match `Episode 01.<supported extension>` or dot-suffixed variants such as `Episode 01.zh-Hans.ass`. Compare the entire stem exactly, case-insensitive extension, and a dot boundary before suffixes. Display original filename/language/title; ambiguous matches start off and require selection. Include every discovered embedded track with its format/support status. Select only one renderer/track at a time; switching/off tears down the old overlay and works for original, prepared and real-time playback.

Resolve track and attachment IDs on the server, never accept paths or FFmpeg selectors from the client. Preserve original subtitle formats when directly supported. Normalize encoding where needed and reject undecodable inputs visibly. Bound text subtitle size (10 MiB), individual font size (20 MiB), total extracted fonts (100 MiB), task time, diagnostics and total cache usage; bitmap extraction follows the shared cache budget. Ignore attachment filenames as output paths and allow only validated font payloads. Deduplicate extraction by source version, stream/attachment ID and converter version; sidecars include their own source version. Serving through the asset registry rechecks validity and type. No extracted asset is a public static directory.

Keep cue time on the original source timeline. When real-time playback restarts at a source-time offset, map both plain-text cues and JASSUB's renderer clock to that offset; recreate or shift the track for the new generation without accumulating offsets. Test seek, resume, source switching, multiple simultaneous styled lines, font fallback, and CJK text. Missing or unsupported subtitles never force audio/video re-encoding; no automatic burn-in in V2.

## 7. Playback Plan and FFmpeg Transcoding (V2; P05–P07)

### Inspection and minimum necessary processing

Probe on demand, with bounded FFprobe work cached by source version. Return container, duration, video/audio descriptors, subtitle choices, target profile and a per-stream action/reason. Select default video/audio streams, falling back to the first usable stream; missing audio is valid. File extensions alone never determine compatibility. Match codec/profile/pixel format/audio/container and target browser capabilities; uncertain combinations are reported as uncertain, not claimed playable.

The first validation target remains Linux desktop Chromium/Chrome. Record OS, browser, FFmpeg/FFprobe, Vidstack, hls.js, JASSUB at acceptance. Availability of a binary alone does not certify its encoders/muxers. HDR conversion, hardware encoding and universal browser support remain unassigned.

| Compatibility with the chosen delivery format and browser | Audio/video action |
| --- | --- |
| Original is supported | Direct original; no media-processing job |
| Only container/packaging is unsupported | Remux; copy compatible streams |
| Audio alone unsupported | Copy video, encode audio |
| Video unsupported | Encode video; copy compatible audio or encode if needed |
| Subtitle needs extraction/format conversion | Process subtitle separately; do not encode otherwise compatible audio/video |

Use the same planner for pre-transcoding and real-time output, evaluating compatibility with MP4 or HLS respectively. Do not encode a copied stream just to force a uniform codec or segment length. Every actual encoding decision must carry a reason. FFmpeg's [stream-copy model](https://ffmpeg.org/ffmpeg.html) underpins the compatible-stream path.

### Pre-transcoding

**Prepare for Web** creates a reusable fast-start MP4. Use a versioned profile: preserve resolution, timeline and compatible streams; encode required video to H.264/yuv420p (initial CRF 20, medium), required audio to AAC (initial 192 kbit/s). These settings require sample validation. Deduplicate by source version, selected streams, profile and mode. Compatible originals return a direct-play result without creating a copy. Completed valid copies take priority over starting new real-time work.

Persist `queued → processing → ready | failed | cancelled` states in SQLite. Process one media job at a time. Write a private temporary output, require successful exit plus stream/duration/timeline validation, recheck source version, rename atomically, then commit the ready record. Only complete MP4s are playable with HEAD/Range. A percentage requires reliable duration/timestamps. On restart revalidate queued work, fail interrupted attempts with retry, reconcile partial/orphan files, and never offer them as ready. Copy deletion invalidates its registry entry, waits for open readers, removes files, and leaves originals/history intact.

### Real-time transcoding

Real-time mode processes an existing file **while it is being watched**; it is not a live-source ingestion feature. Use a session-scoped HLS stream with fragmented MP4 segments. Vidstack uses [hls.js](https://github.com/video-dev/hls.js) on the selected MSE-capable browser, with native HLS only on separately validated clients. For required encoding use a distinct versioned real-time profile, initially H.264/yuv420p CRF 23 / veryfast and AAC 192 kbit/s; copy streams instead wherever compatible. No ABR ladder is required. The automatic Web strategy chooses direct original, valid prepared copy, then necessary real-time conversion. Users can also explicitly choose real-time playback or pre-transcoding; a generic media error does not cause an infinite fallback loop.

1. Resolve the source/version and requested source-time position; allocate an opaque transcode session and generation. Return `starting`, not a playable URL until initialization and at least one complete segment exist.
2. FFmpeg emits an event playlist and approximately four-second segments. Write temporary segments and publish only complete ones; publish playlists atomically. Copied video cuts at existing keyframes, so segment durations may be longer. Assert independent segments only when actually guaranteed. See the [FFmpeg HLS muxer documentation](https://ffmpeg.org/ffmpeg-formats.html#hls-2).
3. Transition `starting → streaming → completed`, or `failed/stopped`. Streaming means completed segments are available while FFmpeg is still running; it never means partial segment bytes are playable. At EOF finalize the playlist. These temporary session files are not silently promoted to a durable prepared MP4.
4. Serve playlists and registered init/segment IDs through confined API routes. Playlists use only application-owned relative URLs; no arbitrary file path or external segment URLs. Playlists are no-store; segment URLs include session generation and identify immutable completed bytes.
5. The player displays source duration and position, not the growing HLS playlist duration. In-range seeks reuse generated segments. A seek beyond available coverage asks the backend to stop the old FFmpeg child and create a new generation near the target source keyframe. Return the actual source-time origin; seek/decode forward to the requested position. Old manifests/segments cannot update the new player state. Never require transcoding from time zero to satisfy a late-file seek.
6. Source time is `actual generation origin + local media time`; use it for progress saves, duration clamps, resume, subtitle clocks and the near-end rule. Reset timestamps consistently across audio/video; copied-video pre-roll must not shift subtitle timing. The adapter provides a full-source seek bar instead of relying on a growing playlist's default duration.
7. Renew a lease every ten seconds while the player is present; expire after thirty seconds without renewal. Stop promptly on exit, explicit stop or generation replacement; release all children/readers and reclaim temporary files after a short grace period. Pausing beyond thirty seconds stops processing but retains the source position; resume creates a generation. On server restart sessions expire and the client offers reopen/resume.
8. Bound buffered output and disk consumption by the configured cache budget. Initially pace real-time input near playback speed and stop/fail with actionable storage feedback if the session cannot fit; do not silently drop segments needed by the advertised playlist. Slow encoding may buffer: show that state and offer pre-transcoding, without claiming every source can run at real-time speed.

### Shared scheduling and failure handling

One media-processing slot is shared by pre-transcodes and real-time sessions. Real-time requests take priority: stop an active pre-transcode, discard its incomplete output, and requeue it with a visible interrupted-for-playback reason; it restarts after the session releases the slot. Do not claim partial MP4 resume. Bound the waiting queue at 20 and return retryable busy feedback. Same-source real-time retries share the current session; an explicit new playback session stops the previous one under the one-active-session scope. Subtitle extraction/probing has separate bounded concurrency (one each), size/time limits, and cannot start a second audio/video transcode.

Spawn fixed resolved binaries with argument arrays, no shell, bounded stderr, and validated confined inputs. Use distinct startup/stall watchdogs for real-time sessions and a bounded whole-job timeout for pre-transcodes; do not apply a short startup timeout to an entire film. Kill and await children on timeout/shutdown before cleanup. Check free disk space and handle ENOSPC during writes. Root changes conflict with active media work and require stopping/cancelling it first; source changes invalidate jobs and terminate sessions. All process errors remain actionable without modifying originals or durable viewing history.

## 8. External-Player Media Link (V2; C01)

Implemented: the Web player includes a secondary **Copy media link** action. It rechecks accessibility with `GET /api/files/:id`, validates that the returned route belongs to the selected file, and supports Clipboard API copying with a selectable read-only field in a shadcn Dialog (Radix UI) modal. Duplicate requests are suppressed, unmount cancels pending requests, and retries clear stale links. No new backend endpoint or configuration field is needed.

V2 generates a transferable link for a user to paste into an external player's Open URL command. It does not ask the browser or operating system to invoke another application. That feature is deferred as C02. No player-specific URL scheme or player adapter is required.

Resolve the selected opaque file ID through the existing file API and recheck resource access. Construct an absolute original-media URL by resolving the existing same-origin media route against the browser-visible application origin. This preserves SSH-forwarded origins and avoids server filesystem paths or internal hostnames. Display the URL and provide a copy action; if clipboard access is unavailable, leave the full URL selectable and provide a clear message. The native player fetches the original media directly using HTTP/Range. The browser does not proxy media bytes.

Validate link generation and resource access with spaces, Unicode, percent signs and ampersands, including an SSH-forwarded address. Do not claim the player opened or playback started. The link does not carry Web resume position, credentials, arbitrary commands or player options. Under the current local/loopback deployment assumption the endpoint is reachable without browser-only cookies or custom headers. Authenticated deployments need a separately designed expiring access mechanism before external links can be offered.

External playback is playback only. V2 reads no player state and does not update Web history. Optional external-player state reading (C03) and browser/OS invocation (C02) are later requirements. Remote control, subtitle transfer, and multiple-device management remain unassigned. The superseded bridge proposal is retained in [Historical Designs](history.md#superseded-v2-bridge-proposal); it is not part of the current architecture.

## 9. HTTP Contracts and Failure Semantics

Keep all existing V1 endpoints and their response shapes unless explicitly extended. New endpoints below are V2 proposals, not current API documentation. V2 extends GET/PUT settings with validated playback/cache preferences while retaining the resource-root field; older partial root updates preserve omitted preferences. A settings-only update must not clear scans or playback unless the root changes. All IDs are opaque, request schemas are strict, and public errors omit filesystem paths and credentials.

| Endpoint | Version | Purpose / result |
| --- | --- | --- |
| Existing `/api/health`, `/api/settings`, `/api/library`, `/api/library/scan`, `/api/directories/:id`, `/api/files/:id`, `/api/media/:id` | V1 retained | Health, configuration, scans, file lookup, original delivery |
| `GET /api/files/:id/subtitles` | V2 implemented | External candidates and embedded stream metadata/support status; safe per-file and probe warnings; no server paths or stream selectors |
| `GET /api/files/:id/subtitles/:trackId/content` | V2 implemented | UTF-8 text for Vidstack/JASSUB; version validation and resource confinement |
| `GET /api/files/:id/playback` | V2 | Source version, per-stream strategy, original/ready URLs, real-time capability, subtitle descriptors |
| `GET /api/history?view=continue\|recent` | V2 | Ordered availability-aware viewing entries |
| `POST /api/files/:id/playback-sessions` | V2 | Read history and issue a generation; fail closed for saving on store error |
| `PUT /api/playback-sessions/:id/progress` | V2 | Ordered, durable, idempotent update |
| `POST /api/files/:id/subtitles/:trackId/prepare` | V2 implemented, text only | Unified selected-track preparation: ready original external URL or reusable pending/ready embedded text asset |
| `GET /api/subtitle-assets/:id/status` | V2 implemented | Pending/ready/failed subtitle feedback |
| `GET /api/subtitle-assets/:id` | V2 implemented | Validated VTT/SRT/ASS/SSA or declared extracted format only when ready |
| `POST /api/files/:id/preparations` | V2 | Original result `200`, or deduplicated job `202` |
| `GET /api/preparations` | V2 | Queued/processing/ready/failed/cancelled jobs and safe diagnostics |
| `DELETE /api/preparations/:id` | V2 | Cancel queued/running pre-transcode and clean partial files |
| `GET /api/subtitle-assets/:id/fonts/:fontId` | V2 | Registered validated font asset |
| `POST /api/files/:id/transcode-sessions` | V2 | Create/reuse real-time session with source-time target |
| `GET /api/transcode-sessions/:id` | V2 | State, generation, source origin, coverage and playlist URL |
| `POST /api/transcode-sessions/:id/seek` | V2 | Restart outside-coverage seek with a new generation |
| `PUT /api/transcode-sessions/:id/lease`, `DELETE /api/transcode-sessions/:id` | V2 | Renew presence or stop and reclaim session |
| `GET /api/transcode-sessions/:id/:generation/playlist` and `/segments/:segmentId` | V2 | Atomic manifest and complete registered init/media segments |
| `DELETE /api/prepared-assets/:id` | V2 | Remove cached copy, not original/history |
| `GET /api/prepared-assets/:id/media` and `HEAD` | V2 | Registry-validated complete copy with Range behavior |

Use `400` for invalid shapes, `404` for unknown/missing references, `403` for access denial, `409` for stale versions/generations or conflicting work, `429` for bounded queue/rate limits, and `503` for unavailable tools/root/storage capabilities. Preserve V1's structured error envelope and request IDs. Return stable codes such as `SOURCE_CHANGED`, `PROGRESS_CONFLICT`, `PREPARATION_FAILED`, `SUBTITLE_UNSUPPORTED`, and `MEDIA_LINK_UNAVAILABLE`; HTTP success alone never means media decoded or a desktop player started.

## 10. Everyday Interface (V2; O16)

Keep existing directory/file URLs. Add `/tasks` and `/settings`; the shared shell contains Library, Media tasks, and Settings. Preserve the last directory when moving through these screens, and retain player return context. On root change, explicitly explain the reset to root and need to scan. React Router loaders/actions own server state; component state owns transient player and form state. Poll scans/preparations/transcode sessions only while active; stop timers on terminal state or unmount, cancel stale requests, and avoid reloading an active player for unrelated status changes.

| Screen | Layout and actions | Required states |
| --- | --- | --- |
| Library | Continue watching first, compact recent list, breadcrumbs, filename/size rows, scan status | Setup, unscanned, empty, loading, stale/partial scan, removed directory, retry |
| Player | Video as focus, full filename, return link, automatic resume, subtitle/off, source badge | Loading, unsupported media, ready-copy selection, real-time starting/buffering/seeking, missing file |
| Media tasks | Filename, state, reliable progress or indeterminate indicator, retry/cancel, play ready copy, delete copy, active real-time stop | Empty, queued, processing, ready, failed, insufficient space |
| Settings | Resource root, Web playback mode and cache budget in separate groups | Validation, saved, busy |

Use a restrained neutral palette with one accent for primary actions, semantic status colors accompanied by text/icons, the implemented [typography and layout rules](architecture.md#ui-conventions), and clear page/section hierarchy. Reuse Tailwind theme tokens and shadcn controls. Desktop uses a compact sidebar and broad content area; narrow screens use compact navigation and stacked controls. Long filenames wrap or truncate with an accessible full-name action; controls retain readable labels and visible keyboard focus. Announce status changes without repeatedly interrupting playback.

The primary file action is **Watch** or **Resume**. **Copy media link** is secondary and optional. Pre-transcoding is explicit; automatic Web mode may start only necessary real-time processing. Show Direct / Prepared / Real-time and the processing reason; subtitle/progress controls reflect actual API state. At 1280 px and 390 px widths, verify readable names, no page-wide overflow, focus order, control contrast, fullscreen exit, subtitle placement, and all loading/empty/error states. Vidstack accessibility must be tested and supplemented by the adapter where needed. No invented artwork, placeholder data, or controls for unassigned features.

## 11. Delivery Order, Acceptance, and Deferred Scope

| Stage | Target | Coverage and completion evidence |
| --- | --- | --- |
| 1. Source identity, settings and SQLite | V2 | Optional PATH tool discovery, Drizzle migrations, transaction failure, root/content isolation; A08–A10, A14–A15, A25–A28 |
| 2. Vidstack and viewing workflow | V2 | Native-player replacement plus progress/lists; A01–A10 regressions and A19 |
| 3. Subtitle service and renderer | V2, partial P08–P09 | External formats, MKV extraction/fonts, styled rendering and bitmap boundaries; A11–A12, A24 |
| 4. Pre-transcoding and real-time HLS | V2 | Stream preservation, seeking/source-time mapping, interruption and recovery; A13–A15, A22–A23 |
| 5. External-player media link | V2 | Correct origin-aware URL, clipboard/selectable fallback and access checks; A16–A18 |
| 6. Complete interface and integration | V2 | Design the shell early, finish all live workflows and visual review; A19–A21 plus A01–A18 and A22–A28 |

Use Vitest for generation/sequence ordering, source invalidation, cue conversion, job recovery, and media-link generation and encoding tests. Use real temporary files and HTTP streams for containment, ranges, asset deletion, disk-write failures, and subprocess cleanup. Frontend tests cover adapter cleanup, revalidation without reset, stale responses, and nonblocking failures. Code implementation must pass Biome check, lint, type checks, and relevant tests.

Record actual Linux/browser/player/tool versions and representative samples before marking V2 delivered: compatible original, container-only, audio-only, video conversion, external/embedded text subtitles, unsupported subtitles, long/Chinese filenames, and inaccessible files. Verify stream preservation using probes, and actual playback/seek/subtitle timing in the browser. Verify generated media URLs with representative paths and local/SSH-forwarded origins. Opening a native player is outside V2 acceptance.

Other unselected overall requirements retain **Target: Unassigned**: metadata/episode mapping, subscriptions and qBittorrent, tracker synchronization, watched markers, automatic scans, multiple roots, move relinking, original downloads, bitmap subtitle rendering/OCR/burn-in, audio/speed/offset tools, next episode, desktop control, multiple devices, LAN/public authentication, translated locales and a language selector, bridge integration, TanStack Query migration, and advanced log maintenance. C02 browser invocation and C03 external-player state reading are later requirements. SQLite + Drizzle is selected for V2; settings remain JSON.

### Implemented recent history

`GET /api/history?limit=100` returns recent file/progress records, with a limit from 1 to 100 (default 100). History includes records with a saved viewing timestamp, including completed files and zero positions. Results resolve current source versions within the active canonical root; missing or replaced sources are excluded while their durable records remain. The `/history` route loads this list with request cancellation and uses the existing player route for resume. There is no separate `/api/continue-watching` endpoint; opening a playback session returns the saved progress for immediate resume.

### Feedback presentation

Follow the [UI conventions](#ui-conventions) below: operation results and recoverable video/subtitle errors
use Toast notifications. Embedded subtitle preparation uses a persistent Toast,
replaced by failure feedback with retry or closed on completion/selection changes.
Video playback failures use Toast and the existing page Retry action. Manual
refresh failures use Toast while persistent library errors remain in context.
Form validation, scan status/counts/warning details, stale indicators, initial
page errors, setup and empty states remain in their corresponding page regions.

## Backend Data Structures

This document records implemented type ownership and data boundaries in
`backend/src`. Cross-module consumers import selected types through the owning module's `public.ts`; internal exports are not public module APIs or HTTP contracts.

### Ownership Rules

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

### Public HTTP Contracts

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

### Library and Configuration Data

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

### Playback Data

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

### Resource and Local Helper Types

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

## Playback Progress Storage

Status: the database foundation is implemented (schema, migrations, connection lifecycle, and repository). Playback application session authorization, source fingerprint collection, and available-source candidate filtering are implemented. Migration `0001_remove_progress_revision` removes the unused revision column while preserving existing progress. HTTP APIs are implemented with separate public contracts and presenters. Frontend playback session management is integrated, including resume, automatic saves, ordinary backward seeks to zero, and cleanup. Session management runs without player status messages. The dedicated Continue watching list UI remains planned; recent history is implemented.

This section specializes the V2 persistence design above for saved progress, resume, and Continue watching. Use SQLite at `dataDir/anishelf.sqlite`, Drizzle repositories, and reviewed versioned SQL migrations. User settings remain in `settings.json`; the library index remains rebuildable in memory.

### 1. Initial Tables

Use three durable tables. A source row represents one version of one file under one resource root. Each source has at most one current progress row. The application currently has no user accounts, so progress belongs to the shared server library.

#### `resource_roots`

| Column | SQLite type | Constraint / meaning |
| --- | --- | --- |
| `id` | TEXT | Primary key; hash of the canonical absolute root path |
| `canonical_path` | TEXT | NOT NULL, UNIQUE; server-internal canonical path |
| `created_at_ms` | INTEGER | NOT NULL; server Unix time in milliseconds |

Canonicalize using the resource-access root resolution. Returning to the same canonical root reuses its namespace. Root path changes create another namespace; automatic move/relink support is deferred. Never expose canonical paths in public DTOs.

#### `media_sources`

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

#### `playback_progress`

| Column | SQLite type | Constraint / meaning |
| --- | --- | --- |
| `source_id` | TEXT | Primary key; foreign key to `media_sources.id`, delete RESTRICT |
| `position_ms` | INTEGER | NOT NULL, >= 0; last accepted source-time position |
| `duration_ms` | INTEGER | Nullable; positive known duration, otherwise NULL |
| `last_viewed_at_ms` | INTEGER | Nullable until the first accepted save; server time |
| `generation` | INTEGER | NOT NULL, >= 1; identifies the current playback session |
| `last_sequence` | INTEGER | NOT NULL, >= 0; latest accepted update within this generation |

Require `position_ms <= duration_ms` when duration is known. Validate finite times and safe integer ranges before conversion from browser seconds. Reject invalid supplied durations; use NULL when duration is legitimately unknown. A new session may create an initial zero row with no viewing time, but that row must not enter viewing lists.

Index `media_sources(root_id, id)` and `playback_progress(last_viewed_at_ms DESC, source_id ASC)` for root filtering and stable ordering. Revisit query plans when real library sizes justify additional indexes.

### 2. Session and Update Rules

Keep active session tokens and their source/generation bindings in memory. Their loss on server restart deliberately requires reopening a session; durable generation values must never be reset. A separate persistent session table is unnecessary for W01/W02.

1. Resolve the current source safely and read its saved progress. On failure, keep playback usable, report the failure, and disable saving until a successful retry.
2. Open a session transactionally: create/reuse the source and progress rows, increment the generation for an existing row, reset `last_sequence` to zero, and return history plus a server-issued token. Opening alone preserves position, duration, and last viewing time. Publish the token only after commit.
3. Each save supplies the token, source version, generation, sequence, position, and duration. Check the active root and source validity before acceptance. Require the current generation and a strictly increasing sequence. Commit values and server viewing time atomically. Backward seeks, including seeking to zero, are ordinary newer updates within the current generation.
4. A retry of the latest accepted sequence is successful only when its normalized position/duration match the stored values. It leaves viewing time unchanged. A differing payload or an older sequence is rejected. This makes ambiguous network retries safe without an event-log table.

Opening another session for the same source supersedes the previous writer. Report that conflict; do not silently merge clients. This implements the selected stale-update protection without adding W06 reconciliation. Invalidate tokens on root switches and release them on exit; bound inactive session lifetime and memory usage.

Use approximately five-second periodic saves plus pause, completed seek, ended, and normal exit. Serialize client writes and retain the newest failed payload for retry. An ended event with known duration saves that duration as the position. Direct, prepared, and real-time playback all write source-time progress to the same row.

### 3. Continue Watching

Query records for the active root with positive position and a non-NULL viewing time. A record is finished when known remaining time is at most `min(30,000 ms, duration_ms * 0.05)`. Unknown duration does not imply completion. Derive this condition; do not store an `is_finished` or watched marker that can drift from the saved values or policy.

Order by `last_viewed_at_ms DESC`, then `source_id ASC`. Match candidates against the current scanned library and revalidate source versions before exposing actionable playback links. Exclude missing/replaced files from actionable Continue watching entries while retaining their durable records. Before a scan, return an explicit availability-unknown state.

Apply the display limit after availability filtering so unavailable candidates do not consume every visible slot. Read ordered candidates in bounded batches if necessary. Reuse current library metadata for filename, parent navigation, and playback URL; do not persist duplicate display metadata or URLs.

An eventual Recently watched list can reuse the same rows, ordering, and availability rules while including finished records. It requires no extra table and is not part of the initial W02 UI scope.

### 4. Storage Boundaries and Implementation Order

Do not initially add playback event logs, per-episode watched markers, user profiles, client reconciliation, probe/cache/job tables, or media BLOBs. Normal scanning and cache cleanup must never delete progress or source history.

Enable foreign keys, WAL, a finite busy timeout, and `synchronous=FULL`. Keep transactions short. Apply migrations before enabling dependent writes; preserve the database and surface failures instead of silently replacing it. Document WAL-aware backup before shipping persistence.

Implement in this order:

1. Database startup, reviewed migrations, and resource/source identity access.
2. Progress repository transactions and session lifecycle.
3. History/session/save APIs and Vidstack resume/save integration.
4. Continue watching queries and library UI.

Verify restart/rescan survival; root and source-version isolation; unknown duration; backward seeks; duplicate/delayed writes; failed reads without zero overwrite; durable save failures; and filtering/ordering around the near-end boundary. Code changes must pass Biome check and lint, with repository and API tests for these persistence rules.

## UI Conventions

Use Tailwind's default typography, spacing, width scale, and breakpoints, together
with the existing shadcn-style shared controls and light/dark theme. Vidstack
owns its control appearance. Choose additional styling when a concrete screen
requirement needs it.

### Shared Layout

`web/src/index.css` defines the recurring page compositions. It combines native
Tailwind utilities rather than duplicating their values as new theme tokens.

| Utility | Use |
| --- | --- |
| `page-container` | Align the header and content in the same centered container, with responsive side gutters. |
| `page-content` | Add responsive vertical padding to main content or a standalone error page. |
| `stack-page` | Separate major page sections, with more room from the default `sm` breakpoint. |
| `page-title` | Style the page's semantic `h1` and allow long titles to wrap. |
| `action-row` | Arrange related actions with wrapping on narrow screens. |

Use native utilities for local gaps, labels, supporting text, and form widths.
Shared Card components own their padding; sections inside a page do not add a
second outer gutter. Button, Input, and Card retain their base component sizing
and appearance. Use semantic headings regardless of their visual size.

### Content and Actions

Keep filenames intact and let them wrap. Library rows keep the icon beside the
name; file size sits below the name on narrow screens and in a separate column
from `sm`. Use tabular numerals for sizes and allow saved resource paths to break
without widening the page. The media viewport remains 16:9, capped at 75 vh.

Use the default Button variant for the main operation, such as starting a scan
or saving settings. Use outline buttons for refresh, retry, and return actions;
navigation uses the existing ghost and selected secondary variants. Keep visible
labels and hide decorative icons from assistive technology.

Use an icon with a visible text label for primary actions. In space-constrained
areas, use an icon-only button with a Tooltip available on hover and keyboard
focus, plus an accessible name. Choose recognizable icons; keep visible text
when an action would otherwise be ambiguous. Tooltips supplement the action
rather than being its only accessible label. When a loading spinner replaces
an action icon, use the same icon size and do not leave an empty icon slot.

### Feedback

- Loading: retain the current layout, delay spinners and skeletons to avoid brief
  flashes, and expose busy state. Skeletons follow the base control and heading
  dimensions. Keep Vidstack's own loading and control appearance.
- Setup and empty states: explain the missing resource directory or empty listing
  in context; setup links to Settings.
- Scanning and refreshing: display the actual status and available counts. Keep
  incompatible operations disabled while work is in progress.
- Warnings and stale results: show explanatory text, retain the available listing,
  and keep warning details expandable. Do not rely on color alone.
- Notifications: prefer Toast for operation success/failure, manual refresh failures,
  and recoverable video/subtitle failures. Video errors use the existing page Retry
  action; subtitle preparation failures may include a retry action in the Toast.
  Deduplicate notifications and close player notifications on retry, file changes,
  or departure. Keep subtitle preparation Toasts visible until completion, failure,
  or selection cancellation; do not automatically expire ongoing-task feedback.
- Contextual errors: keep form validation beside the corresponding form and keep
  initial page-loading failures, unavailable resources, setup, and empty states in
  the page. Use destructive text and `role="alert"` for inline errors. Persistent
  library errors and stale-state indicators remain visible even after a Toast closes.
- Saving: retain the input, disable the active form while saving, and show the
  saved path after success. Use Toast for request failures and inline feedback for validation errors.

### Maintenance and Validation

CSS and shared components are authoritative for style values. This document
records their use and the screen behavior they support. Add a shared utility or
component when a recurring requirement needs coordinated maintenance.

Check existing screens at narrow and desktop widths (for example, 390 px and
1280 px), in light and dark themes. Include long filenames and paths, empty and
loading states, warnings, and errors. Confirm readable content, no page-wide
horizontal overflow, visible keyboard focus, and reachable actions. DOM tests
cover interactions; browser inspection is required to validate geometry and
Vidstack's controls.

Extend these conventions as new workflows are implemented.

## Implemented Integration Reference

This section describes current integration behavior; it does not make planned
video preparation, HLS, font or bitmap workflows available. Runtime setup and
verification commands belong in [Development](development.md).

### Library access, index and scanning

`modules/media-source/infrastructure/access.ts` owns canonical-root confinement,
regular-file validation and safe file handles. Reject symlinks and paths escaping
the configured root. Resource IDs identify locations in the published catalog;
strong source versions come from safely opened metadata, not index timestamps.

`modules/library/infrastructure/index.ts` publishes a rebuildable in-memory
snapshot with ID and parent-child lookup. It naturally sorts directories before
files. A scan traverses into a separate result and only replaces the published
snapshot on successful completion; cancellation and failure preserve the prior
snapshot. Scanner traversal counts are copied into coordinator-owned lifecycle
state instead of exposing its mutable task state.

`ScanCoordinator` owns one active scan, the settings/scan exclusion gate and one
scheduled timer. Startup, manual and scheduled requests use the same lifecycle.
`scanIntervalMinutes=0` disables periodic scanning. Changing the interval resets
the timer; a successful root change resets the index and starts a scan. Same-root
saves preserve published results. Cancelling an HTTP request does not cancel
server work; scan cancellation is an explicit operation.

### HTTP boundary and original-media delivery

`bootstrap/http.ts` builds Fastify without listening, which permits injection
and route tests. Host validation accepts the configured loopback address or
localhost with its port; forwarded headers are not trusted. Mutation requests
validate Origin and browser metadata. There is no general CORS allowance.

TypeBox schemas in `contracts/schemas/` are authoritative for public requests and
responses. `contracts/http.ts` exports inferred types; presenters explicitly
project path-free DTOs. HTTP handlers enter the owning application and never open
files or access repositories directly. Every request has a generated UUID in
`x-request-id`; safe errors contain code, message and request ID. Unexpected
errors return generic messages, and serialized exceptions remain in server logs.

`GET /api/files/:id` validates current access and returns metadata with an original
media URL. `GET/HEAD /api/media/:id` opens a confined regular file and supports a
single byte range. Valid ranges produce 206; unsatisfiable ranges produce 416;
malformed or multipart ranges are ignored. HEAD and If-Range use the full response.
BigInt arithmetic prevents range integer overflow. Responses use no-store,
Accept-Ranges and a bounded Content-Length. Stream completion, disconnect and
errors release file handles; failures have structured error logs. Media bytes are
requested by the player directly, never fetched through the JSON API client.

### Browser routing and request lifecycle

React Router Data Mode composes `/`, `/directories/:id`, `/files/:id`, `/settings`
and `/history`. Route loaders forward cancellation signals; URL state restores
selection on direct navigation and browser back/forward. File links preserve the
originating directory through `?directory=<id>`, otherwise Back uses the file's
parent. Unknown routes have a root-navigation action.

`web/src/api/client.ts` uses same-origin paths/credentials and no-store requests.
It checks JSON/error envelopes and distinguishes HTTP, network and invalid-response
errors. Public success shapes are shared TypeScript contracts rather than a second
set of runtime validators. Cancellation is checked before fetch, after headers and
after parsing and is silently ignored by UI callers. A new request uses a new
AbortController; cancelled views cannot publish stale data.

The root loader fetches status and settings in parallel. Scan actions revalidate
active loaders; status polling runs while scanning and stops at terminal states.
Player identity stays stable during polling. Presentation intervals live in
`config/interaction-policy.ts`; media-controller timing and renderer budgets live
in `config/media-policy.ts`, with browser-safe shared business constraints.

### Playback controller and persistence lifecycle

`features/playback/session.ts` waits for metadata before restoring server progress
and only enables writes after successful restoration. Vidstack local resume is
disabled. Session failures leave direct playback usable. Save approximately every
five seconds and on pause, completed seek and ended; serialize writes and coalesce
samples. Ambiguous retries retain their sequence and payload. Errors stop automatic
writes until an explicit player retry.

Leaving a route captures progress before provider teardown and releases the token
in background cleanup without blocking navigation. Remounting the same file waits
for cleanup, including StrictMode replay. Pagehide uses keepalive for a final save,
but browser termination cannot guarantee delivery; server idle expiry bounds
abandoned sessions. Ordinary backward seeks, including zero, remain newer writes.
The recent-history UI is implemented; the dedicated Continue watching list remains
planned. Database schema and session rules are specified above.

### Media tools and subtitle delivery

`platform/media/` independently resolves and version-checks FFmpeg and FFprobe.
Child calls use argument arrays without a shell, disable interactive input and
allow only file/pipe protocols. Detection is bounded to 5 seconds and 64 KiB;
probe/extraction default to 30/60 seconds and bounded 10 MiB output. Cancellation
kills child work. Retained failure diagnostics are capped at 4 KiB. Tool failure,
timeout and output overflow map to TOOL_FAILED; malformed descriptors and invalid
paths/selectors have separate internal codes. Raw paths/selectors are trusted
backend inputs and never public client commands.

External subtitle discovery inspects only the video's directory. Match the exact
stem with a supported extension or dot-separated suffix: `Episode 01.zh-Hans.ass`
qualifies, while `Episode 010.srt` and `Episode 01-extra.ass` do not. Extensions
are case-insensitive, stems case-sensitive; empty suffix components are rejected.
Natural ordering is deterministic. Language tags are filename hints, not content
inspection. Candidates over the shared size limit are omitted with safe warnings;
matching symlinks/nonregular files are rejected. Sidecar changes need no video rescan.

External content delivery re-discovers opaque track IDs and checks video/subtitle
versions. It bounds reads, including file growth, and supports UTF-8 and BOM-marked
UTF-16LE/BE. Responses use text/plain, no-store and nosniff. Discovery is metadata-only;
embedded extraction begins only on selected-track preparation. Source changes
invalidate old work, pending files publish atomically, and persisted asset rows
support restart reuse. Probe and extraction slots are separate and deduplicated;
cache-budget checks/publication serialize to prevent oversubscription.

Vidstack text tracks and its CC menu own subtitle selection. One `SubtitleController`
handles preparation, switching, off, cancellation and retry for both subtitle origins. ASS/SSA uses
a TextRenderer adapter for the pinned JASSUB API, packaged worker/WASM and a
Liberation Sans fallback. Selection/off, retries and unmount dispose pending loads,
tracks and overlays. Missing CJK glyphs remain possible without embedded fonts.
Original media and sidecars are never modified.
