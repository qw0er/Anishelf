# Refactoring baseline

This baseline records the current product behavior and the scope of batch 1.
It is not evidence of successful decoding on every browser. Requirements still
own product scope; architecture owns implementation decisions.

## Behavior to preserve

| Capability | Current behavior | Regression evidence |
| --- | --- | --- |
| Configuration | Validate before creating the data directory; atomically save explicit settings; failed saves preserve the prior snapshot | deployment, configuration, persistent, settings-http |
| Library | Publish complete snapshots; coalesce scans; preserve stale data on failure; root switches invalidate active identities | scanner, library-index, application, library-http |
| Resource access | Originals are read-only; confined regular-file access rejects traversal and symlinks; opened handles survive root switches | resources, resource-access-application, media-http |
| Original playback | Inspect source, collect browser evidence, check compatibility; unknown support allows an explicit attempt; actual failure remains distinct | media-compatibility, video-feedback, app |
| Prepared playback | Reuse a valid completed file with matching source, profile and ordered audio selection; viewing never creates a preparation task | preparation, preparation-real, web preparation and app |
| Audio selection | Missing selection means all source audio streams, an empty array means none, and a nonempty array preserves explicit order; default disposition is descriptive | media-execution-planning, media-compatibility, audio-playback |
| Subtitles | Discover metadata without extracting; prepare only the selected track; external files and embedded assets retain their separate lifecycles | subtitles-http, subtitle-preparation, subtitle-controller, external-subtitles |
| Progress | Originals and copies share original-source time; saves are serialized/coalesced; identical retries retain sequence; old generations cannot overwrite new sessions | playback-application, playback-http, playback-session |
| History | Recent history includes completed and zero-position records; unavailable sources remain durable; an unscanned source is unknown | database, playback-application, app |
| Preparation lifecycle | Explicit creation and retry; bounded queue; cancellation awaits execution cleanup; startup marks unfinished tasks interrupted rather than resuming silently | preparation, media-processing-application, media-processing-process |
| Artifact lifecycle | Validate bytes before ready metadata; borrowed/invalidated bytes remain accounted for; deleting a borrowed copy is busy; startup reconciles orphan or missing files | preparation, preparation-real |

The evidence column names existing test files, not guarantees that every test
covers every listed invariant. Batch 1 does not change public HTTP fields, task
snapshots, migration SQL, source identity, execution-plan fingerprints or artifact
IDs. Existing settings, playback records and valid outputs retain their formats.

## Implementation status and HLS decision

| Status | Capabilities |
| --- | --- |
| Connected product functionality | Configuration, scans, browsing, original playback, saved progress/history, original external-player links, text subtitles, persistent preparation, prepared-file playback |
| Independently testable foundation | File/media-source output planning and media execution, HLS per-track planning and source-time mapping; see media-execution-planning, media-processing-application and hls-models tests |
| Reserved contracts | HLS resource/lease contracts, prepared/processed HLS artifact variants and real-time session/lifecycle contracts |
| Not implemented | HLS packaging and browser delivery, live execution/resource acquisition, embedded fonts, automatic cache eviction |

Retain HLS pure planning as an independently tested foundation. It is not a
product playback or preparation target. Batch 1 separates pure planners from the
processing application; it does not add HLS execution or delivery. Removal of
unused reserved variants remains a later cleanup batch. The current internal HLS
planning branch is preserved to avoid changing established planning behavior.

## Dependency and composition changes

- Platform owns `LoggingConfig`, `MediaToolsConfig`, the minimum subtitle
  extraction policy and immutable runtime/executable-search context. It imports
  no business modules. Configuration validates and injects these inputs.
- `public.ts` exposes explicit service contracts, business models and pure
  decisions. It does not re-export an application or a concrete repository.
- `policy.ts` exposes defaults and validation without loading applications or
  filesystem/media executors. `ports.ts` holds shared capabilities and results
  where several consumers need them.
- Resource Access's `files.ts` is a separate confined-filesystem entry used by
  library workflows. `ResourceFiles` describes the capability; only this entry
  and bootstrap expose/assemble the implementation. Domain code cannot import it.
- Inspection and processing errors/results live with their contracts. Consumers
  no longer load an application just to identify a busy error.
- Bootstrap assembles implementations. Startup validates configuration, creates
  tools and persistence, starts the library scan, assembles shared inspection and
  execution, reconciles preparation/subtitle assets, then opens HTTP listening.
- After HTTP shutdown, bootstrap closes preparation, playback, subtitles and
  library before shared processing, inspection and the database. HTTP fixtures
  have a default shutdown sequence; production injects the complete one so shared
  owners are not closed twice.

Planning ownership in Playback, task/DTO coupling, frontend candidate selection,
per-file task queries and duplicated snapshot fields remain unchanged for their
scheduled batches.

## Automatic architecture checks

`npm run architecture:check` scans both TypeScript workspaces with dependency-cruiser.
`npm run lint` includes that check; `npm test` first runs its positive/negative
fixtures via `npm run architecture:test`.

The rules reject unresolved imports, runtime dependency cycles, Platform imports
of business/bootstrap/transport modules, Domain imports of implementations,
implementation imports from service/policy/port entries, cross-module/feature
imports bypassing approved entries, and Web imports outside browser-safe backend
contracts. Type-only edges are included in boundary checks; type-only cycles are
not runtime initialization cycles. Unsupported TypeScript analysis or an empty
workspace scan fails the check instead of reporting a false success.

The root and Web workspaces use TypeScript 6.0.x (`~6.0.2`, currently resolved
to 6.0.3). Dependency-cruiser 18.5 does not
support the TypeScript 7 compiler API; using the supported shared compiler allows
real TypeScript analysis. Application typechecking and production builds must
also pass with this compiler.

## Baseline test repairs and validation limits

The pre-change full check found six existing test failures: a stale migration
count, two probe-concurrency fixtures assuming a limit of one while the default
is two, a stale profile-catalog projection, a directory concurrency assertion,
and obsolete unsupported-playback text. Those assertions/fixtures are updated to
the existing behavior. Production concurrency and UI text are unchanged.

A localhost test also failed with sandbox `EPERM`; process/listener tests require
an environment that permits both operations. Live browser decoding, real library
upgrade and responsive UI inspection are separate acceptance steps; this batch
makes no new claims about them. Real FFmpeg tests can skip when tools are absent;
report skipped cases alongside the final test result.

## Batch 1 verification

`npm run check` passes in an environment allowing child processes and localhost
listeners: Biome check/lint, architecture scan, both workspace typechecks,
12 architecture-rule tests, 515 backend tests and 153 Web tests. One Linux-only
permission test is skipped on macOS. Real FFmpeg execution/preparation regression
tests ran rather than skipping for missing tools. `npm run build` also passes;
Vite retains its existing large-chunk warning. No live browser playback or
responsive-layout certification was performed for this structural batch.

## Batch 2: media model, output specifications and planning ownership

Implemented after the dependency baseline:

- Replace Media Compatibility with Media Planning, owning inspect/check/plan and
  pure file/HLS execution decisions. Preparation consumes a provider-independent
  planning requirement; Playback retains sessions, progress and history.
- Store audio descriptions once, alongside default and ordered selected indexes.
  Normalize omitted selection to all audio streams, preserve empty and custom-order
  selections, and remove single-track fallbacks.
- Distinguish audio/video descriptions, send only decoding parameters in browser
  queries, remove unused power-efficiency evidence, and explicitly model checked
  internal decisions.
- Share expected output dimensions/codecs/channels and H.264 constraints between
  negotiation, planning and execution validation. Preserve actual FFmpeg width
  rounding and require exact known output dimensions before publication.
- Update the browser contract to rules version 4 and planning route to
  `/api/media/plans`; retain existing task/artifact snapshots and unchanged output
  identities. Corrected non-H.264 encoding has a new resolver version.

Task snapshot consolidation, preparation lifecycle state unions, unified playback
resource selection/session semantics and frontend query-state ownership remain in
later batches. HLS generation/delivery remains unimplemented.

## Batch 3: preparation tasks and artifact lifecycle

Implemented after Media Planning consolidation:

- A command facade, scheduler, worker, artifact lifecycle manager and recovery
  coordinator have separate ownership. Explicit synchronous storage ports support
  queue admission and state updates without importing repository implementation.
- Immutable specifications carry the sole source/output authority; execution
  requests are derived. Persisted snapshot migration removes duplicated identity
  and request fields without changing plan or artifact IDs.
- Internal state unions and a visible `cancelling` state distinguish cancellation
  intent from completed cleanup. Terminal acknowledgement follows processor
  completion/release, prepared-file cleanup and durable state.
- Slow planning, file validation and queries no longer share a global command
  queue. Gates protect one artifact at a time; synchronous commits preserve
  deduplication/capacity and SQL owns queue counts/selection and byte totals.
- Transport owns URLs and public progress. Borrowed invalidated bytes remain
  accounted for, deletion remains busy while borrowed, and retry cannot overwrite
  the same artifact until all old handles release.
- Startup recovery preserves valid completed files, cleans orphan/partial data and
  marks interrupted attempts retryable without automatically restarting them.

Frontend directory summaries/query-state ownership are implemented in batch 5 below. HLS delivery and automatic eviction remain outside the
implemented product scope.

## Batch 4: unified playback selection and progress sessions

- Add a read-only Playback Selection owner and explicitly inject planning, copies,
  source validation and selected-profile preference. It owns final resource choice;
  the browser submits capabilities for server-provided candidates.
- Bind copies to canonical root, source version and exact ordered audio selection;
  validate the task's output combination, profile/artifact availability and source
  epoch before projection. Preserve explicit original attempts without inspection.
- Delete browser candidate sorting, mode/combination derivation and URL fallback
  chains. Runtime failures exclude only the failed resource for the current intent.
- Progress sessions no longer return plans or duplicate generation. Durable storage
  is unchanged; delivery selection does not create a new writer. Sequential saves,
  coalesced samples and original-sequence retries remain in the progress controller.
- Poll selection only when blocked on pending tasks; task refresh and matching
  progress-session arrival cannot replace an active delivery resource.
- Update HTTP contracts, bootstrap, consumers, lifecycle feedback and English docs.
  Existing valid artifacts and progress rows require no migration.

Directory summaries, unified task query caching and component coordination are
implemented in batch 5 below. HLS delivery, automatic cache eviction and real-time acquisition remain
outside implemented scope. Synthetic browser evidence does not certify native
browser decoding; live browser/media and responsive checks are separate acceptance.

## Batch 5: frontend query ownership and component coordination

- Introduce TanStack Query throughout server reads/commands: library status/settings,
  route data/history, profile catalogs, preparations, browser negotiations, playback
  selection, subtitle discovery and selected-track status. Progress authorization and
  serial save/release remain imperative protocol operations.
- Router loaders preload shared query entries; mounted pages observe cache updates.
  Central keys include relevant root/library/source/profile/ordered-audio scope.
  Preserve cancellation, bounded timeouts and stale-result isolation; shared request
  cancellation respects other consumers. Disable generic retry/focus/reconnect work.
- Delete manual global/file task merging and per-feature server caches/timer loops.
  Preparation mutations invalidate lists and summaries centrally. Poll only pending
  work; active delivery is not owned by task refresh.
- Add root-filtered SQL preparation summaries for directory batches (500 IDs maximum)
  and a recent metadata-only task projection. Publication is not playback certification;
  rows open validated file-task details only on menu demand. Startup recovery and
  explicit playback/resource checks retain artifact validation.
- Extract `usePlaybackController`, audio selection and compatibility diagnostic views.
  Validate default/silent/ordered route audio centrally, rejecting malformed indices.
  Unchanged media/subtitle instances survive background task and scan publications.
- Keep the public Planning HTTP projection until the cleanup batch, as requested.
  Completed-file playback remains implemented; HLS, eviction and real-time execution
  remain outside this batch.

Validation includes duplicate observer deduplication, directory request counts,
shared preload cancellation, bounded negotiation concurrency, terminal polling,
summary/detail validation separation and existing serial progress/lifecycle regressions.
Live native decoding and responsive browser acceptance remain separate checks.
