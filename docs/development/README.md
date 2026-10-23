# Anishelf Development

This guide is for contributors working from the repository root. It owns local
build/run commands, module maintenance, tests, logging instrumentation and CI.
[Architecture](architecture.md), [UI design](design-system.md), [database design](database-design.md)
and [AniList API verification](anilist-api-verification.md) are developer references.
Installation, environment variables, resource settings, log inspection and backups
are in the [user and operations guide](../guide/operations.md#deployment-configuration).
[Requirements](../requirements.md) owns product scope; [History](../history.md) retains
completed iteration designs and evidence.

- [Local development](#local-development)
- [Source maintenance](#source-maintenance)
- [Test storage](#test-storage) and [networking](#test-networking)
- [Logging instrumentation](#logging-choice)
- [Development proxy](#development-proxy-and-hosting)
- [Database migrations](#database-migrations)
- [UI maintenance](#ui-maintenance)
- [Verification](#verification-and-troubleshooting) and [CI](#continuous-integration)

## Local development

Use Node.js 24 (see `.nvmrc`) and install the locked workspace dependencies with
`npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the backend watcher and Vite together; stop both with Ctrl+C |
| `npm run dev:host` | Start both services with Vite listening on 0.0.0.0:5173 for LAN development |
| `npm run dev:backend` | Watch only the backend HTTP entry point with readable, colored pino-pretty terminal logs |
| `npm start` | Build both workspaces, then start the backend in its normal runtime mode to serve `web/dist` |
| `npm run dev:web` | Start Vite on 127.0.0.1:5173 with an API proxy |
| `npm run typecheck` | Check both workspaces, including their tests |
| `npm test` | Run architecture fixtures, deployment checks and both workspace test suites |
| `npm run test:watch --workspace @anishelf/backend` | Watch backend tests with Vitest |
| `npm run biome:check` | Check formatting, lint rules, and import organization with Biome |
| `npm run biome:fix` | Apply safe Biome fixes |
| `npm run lint` | Run Biome lint, architecture checks and unused-code checks |
| `npm run architecture:check` | Check dependency directions, public entries and runtime cycles in both workspaces |
| `npm run architecture:test` | Verify architecture rules with allowed and forbidden dependency fixtures |
| `npm run anime:corpus -- summary` | Inspect the offline anime-identification corpus; see its [usage and provenance](../../backend/test/fixtures/anime-identification/README.md) for generation and evaluation |
| `npm run --silent anime:corpus -- match` | Evaluate production matching/admission against frozen candidates, including independently corroborated local numbering and separate base/scenario statistics; this does not measure live search recall |
| `npm run check` | Run Biome, lint, type checks, architecture fixtures and both workspace test suites |
| `npm run build` | Build backend and frontend |
| `npm run start:backend` | Run the built backend; host pages only when `ANISHELF_FRONTEND_DIR` is set |

The backend [Identification module](architecture.md#delivered-anime-library-workflow) documents stateless
recognition and automatic scan coordination. It has no task/review HTTP API or
active database dependency. [Metadata](architecture.md#internal-ownership) now provides persistent
AniList query/artwork caching and supplies cloud candidates. [Anime Catalog](architecture.md#delivered-anime-library-workflow)
provides durable associations, review decisions, previews/confirmation, corrections
and library HTTP queries. The Web Library, detail/playback and Review workflows are implemented.

The anime-identification corpus contains provider-backed work records, authentic
resource filenames and explicitly synthetic boundaries. It can generate a separate
placeholder library for scanning and later identification evaluation. These files
are not playable videos; the corpus does not declare the selected anime-library
iteration implemented or accepted.
The [Nyaa supplement](../../backend/test/fixtures/anime-identification/nyaa/README.md)
adds 268 locally sourced cases and five directory scenarios. Its curated captures
are offline test inputs; the complete unreviewed sample archive remains in the
ignored `.nyaa-corpus.local/` directory.

## Source maintenance

Follow [Architecture](architecture.md#source-organization-and-dependency-boundaries)
for module contracts and dependency directions. A business consumer imports only
a large module's root `public.ts`; importing a child's public entry across modules
is forbidden. Module creation and HTTP registration entries are app-only. Database
adapters may use root persistence entries. App cannot import child implementations.

Each backend module owns private composition and lifecycle. App aggregates global
policy, connects complete modules and quiesces producers before releasing source,
media-tool and database capabilities. Schema aggregation uses only root persistence
entries. Source moves must preserve existing database identities and migrations.

Frontend Resources, Media, Playback and Settings expose business contracts through
`public.ts` and app-only components through `ui.ts`. Cross-module menus and player
extensions belong to app and are supplied through component slots. Preserve query
keys, cancellation, Provider placement and cache invalidation when changing these
boundaries. Shared code cannot import modules or app.

Run `npm run check` and `npm run build` after structural changes. Architecture
fixtures spawn Node processes; media and HTTP suites also spawn tools and listen
on localhost. Run them in an environment permitting those operations.

## Test storage

Business tests use `ApplicationDatabase.openMemory()` when they need SQL queries,
constraints and transactions without persistence across connections. This uses
real SQLite and the production migrations; migration source files are still read
from disk. Each connection is isolated and closing it discards its data. Fixtures
that verify database restart recovery explicitly request a disk database.

The RSS, scanner and change-processor suites opt into `memfs` for asynchronous
filesystem calls. Their virtual filesystem resets before each test. This is local to those suites;
it does not intercept native filesystem access or external processes.

Keep real temporary directories for native filesystem monitoring, resource-access
integration, permissions, atomic publication, credential/configuration persistence,
SQLite migrations and restart recovery, and FFmpeg/FFprobe processing. These tests
verify operating-system behavior that an in-memory filesystem cannot establish.
Do not apply the filesystem mock globally.

## Test networking

HTTP route tests use Fastify `app.inject()` without binding a port, including
request cancellation via an injected `AbortSignal`. qBittorrent response mapping,
error handling and multipart field tests run the real SDK against an Undici
`MockAgent` with real network access disabled. The fixture restores the previous
dispatcher after each test. Frontend tests start with a rejecting fetch stub and
record unmocked paths. Teardown fails on these requests even if application error
handling catches the rejection, so omitted mocks cannot silently contact a server
or pass unnoticed. Mock expected error responses explicitly in the owning suite.

Keep loopback servers only for the SDK cookie/multipart wire smoke test, lost
socket responses, native request timeouts, in-flight cancellation/draining, and
streaming file-handle cleanup after a client socket disconnect. These fixtures
bind to `127.0.0.1` on an ephemeral port and close their connections after use.
They do not require a running backend or a real qBittorrent service.

## Filesystem monitor tests

Native watcher fixtures canonicalize temporary paths before deriving root identities,
including macOS `/var` aliases. Their assertions cover final file state, root
isolation and the absence of extra baseline scans, allowing duplicate native events.
The change-processor suite verifies exact subtree read scope using controlled change
batches against `memfs`, with a fresh in-memory filesystem for each test.

## Logging choice

The backend development script pipes stdout through `pino-pretty`, installed as a
backend development dependency. `npm run dev` displays colored level names,
timestamps in the system time zone, and readable structured context and errors.
Production startup and configured log files use the original JSON output.

`ApplicationLogging.create` creates one Pino logger. Pino `multistream` routes
stdout/file/both output, and `rotating-file-stream` owns file buffering, rotation,
retention and stream behavior. File modes create the parent directory and use mode
0600. Normal shutdown ends the owned file stream after business modules finish.
`flush` waits for queued file writes; `close` is idempotent. The application's
existing overall shutdown deadline still applies.

Logs retain ISO UTC timestamps, numeric Pino levels, the `anishelf` service field,
newline-delimited JSON, child context and secret-field redaction. Callers must
avoid secrets in unrecognized fields or message strings. File stream errors produce
a concise stderr diagnostic. Output failures otherwise follow dependency defaults;
there is no application queue, overflow protocol, stderr record replay, custom
reopening/recovery or SIGHUP handler. Restart after correcting a failed destination.

Construction and redaction live in `platform/logging/index.ts`; configuration lives
in `config.ts`. File rotation uses the configured size and hourly/daily interval.
`maxFiles` limits archives, excluding the active file and the library history file.
Use a dedicated path per process and preserve that history file across restarts.
See [Overall Requirements](../requirements.md#logging-maintenance-o11o13).

Biome respects `.gitignore` through `biome.json`; dependencies and build outputs
are excluded. `npm run biome:fix` does not apply unsafe fixes.

`ApplicationLogging` creates and exposes the Pino logger. Logging setup and output lifecycle live
in `platform/logging/`.

### Anime workflow logging

Anime uses the same Pino logger and output lifecycle. At `info`, automatic
identification records its publication revision, start/completion, parsed/reused
source counts, proposed/unresolved counts, metadata failures and elapsed time.
`catalog.automatic_admission_completed` summarizes admitted, skipped and failed
sources; skipped includes ambiguous evidence and preserved decisions, and is not
an error. Replaced publications and shutdown cancellations are `debug` events.

Committed changes emit `catalog.confirmed`, `catalog.rejected`,
`catalog.associations_removed`, `catalog.episode_edited` and
`catalog.metadata_updated`. Confirmation records include preview ID, revision and
replacement intent; idempotent retries emit `catalog.confirmation_reused` at
`debug` and do not repeat the committed-change event. Rejection/removal reasons,
episode labels, filenames, search text and provider payloads are not logged.

Manual refresh emits `catalog.refresh_requested` at `debug` and
`catalog.refresh_completed` at `info`; background refresh start/completion is
`debug`. Completion records indicate whether old metadata was retained. Provider
refresh start/success records include provider, kind, a hashed request identifier
and elapsed time. Refresh warnings include failure code, retry time and retained
cache availability. Routine cache reads are `trace`, avoiding polling noise at
normal log levels. The hash correlates attempts without logging the cache key,
which contains search criteria.

Artwork cache writes and budget evictions are `debug`; download/cache failures
are `warn` with failure code and retained-artwork availability. Records use
opaque asset/request IDs and omit provider URLs and image bytes. Expected missing
artwork and unresolved identification do not create per-file warnings.

### AniList account and request logging

Tracking and the shared AniList scheduler use child loggers with module values
`tracking` and `anilist`. Production Anime composition supplies the logger to both.
No separate output destination or log configuration is introduced.

| Level | Events and purpose |
| --- | --- |
| `info` | `tracking.account_previewed`, `tracking.account_connected`, `tracking.account_disconnected`: user-visible account lifecycle, with numeric account IDs and connection generations where relevant |
| `warn` | `tracking.authorization_required` with startup/check phase; `tracking.operation_failed`; `tracking.credential_cleanup_failed` with rollback/replacement/disconnect phase |
| `error` | `tracking.persistence_failed` when connection publication or disconnect persistence fails |
| `debug` | Tracking operation start/success/rejection/cancellation, preview expiration, successful connection checks and service shutdown; AniList request dispatch, cancellation, changed pacing and scheduler shutdown |
| `trace` | AniList request admission, budget waits, HTTP response status and successful completion |
| `warn` | `anilist.queue_full`, `anilist.rate_limited`, `anilist.request_retrying`, `anilist.request_failed`: bounded queue pressure, provider feedback, read retries and terminal request failures |

Tracking records retain the operation and safe application error code instead of
raw exception messages. Routine status reads do not emit business logs. Expected
stale-preview/connection rejections and shutdown cancellation stay at debug level;
connection checks do not repeat info-level connection events. Cleanup failures
that do not roll back an already committed replacement still emit a warning.

Scheduler records correlate one admitted request across attempts using a generated
`requestId`, independent of the HTTP `reqId`. Fields include query/mutation kind,
authenticated/priority booleans, attempt counts, queue depth, wait/duration and
numeric HTTP status/retry timestamps. Cancellation identifies admission/queued/
active stage and caller/shutdown reason; it never logs the caller's abort reason.

Token values, candidate IDs, login session IDs, account names, credential file
contents/paths, queries, variables, headers, response bodies and raw provider or
transport errors are excluded from these events. This field whitelist is tested
using a trace logger without relying on production redaction. Set
`ANISHELF_LOG_LEVEL=debug` or `trace` to inspect successful checks or scheduling;
the default info level retains lifecycle changes and operational warnings/errors.

## AniList Account Foundation

Settings now exposes the bundled Client ID 53902 PIN workflow, token preview,
explicit account confirmation, connectivity checks and local disconnect. Normal
users do not run the diagnostic CLI. Business endpoints live under
`/api/tracking/account` and reuse the existing session/CSRF guards.

SQLite stores the sanitized connection; private 0600 credential
files live under `<dataDir>/tracking-credentials/` in a 0700 directory. Back up the
SQLite database and private files consistently while stopped; a missing or
mismatched credential requires reconnection. Never log or check these files into
source control. Candidate tokens live only in bounded memory for five minutes.
List synchronization and updates are owned by Tracking, using the shared provider scheduler.

Anime composition supplies the same scheduler to Metadata and Tracking. Account
checks have priority with a three-request fairness limit; both consumers share
rate-header backoff and the default 2400 ms spacing. Shutting down Tracking
invalidates previews and active account checks before the shared scheduler closes.

Run `npm run test --workspace @anishelf/backend -- test/anilist-account.test.ts
test/anilist-wrapper.test.ts test/metadata.test.ts` and
`npm run test --workspace @anishelf/web -- test/anilist-account.test.tsx` for focused
regressions. Metadata cancellation tests use HTTP injection without listening on a port.
See [the design](../history.md#anilist-design-implemented-account-foundation) for
API/status and real-provider verification boundaries.

## Development Proxy and Hosting

`npm run dev` starts the backend watcher and Vite on port 5173. Vite proxies `/api`
to `http://127.0.0.1:3000`. Set `ANISHELF_API_TARGET=http://127.0.0.1:4000` when the
backend uses another port. Vite keeps a fixed port so allowed development origins
remain predictable. Production mutations require the same origin.

`npm run dev:host` exposes Vite on `0.0.0.0:5173` for trusted LAN development while
the backend stays on loopback. Open `http://<server-lan-ip>:5173`. The proxy rewrites
Origin only when it matches the incoming Host; unrelated origins reach backend
validation unchanged. Development uses the same password authentication and CSRF protection as production.
The first backend startup prints its random password; the Vite proxy keeps session
cookies and API requests on the browser origin.

Vite provides SPA fallback for direct routes. `npm start` builds both
workspaces and serves `web/dist` through the backend in its normal runtime mode.
The script explicitly sets `ANISHELF_FRONTEND_DIR` to the absolute `web/dist` path.
In any mode, Node enables static files and SPA fallback only when this environment
variable is set. Without it, the backend serves only APIs/media, even if a frontend
build exists. The configured directory must contain `index.html` or startup fails.
A shared Caddy can proxy the whole application. Configure `ANISHELF_PUBLIC_ORIGIN`
for its external origin and preserve Host/Origin headers; see the
[Caddy deployment example](../guide/deployment.md#network-and-qbittorrent). Backend listening
defaults to loopback for source installations and `0.0.0.0` in container images.
Container deployments use two images built from the same revision: Caddy serves
static files and proxies `/api` to the private backend over the Compose network.
Only the web container publishes host loopback port 3000 (container port 8080).
The backend image does not enable Node static hosting. The explicit public origin
supplies the external scheme and port for Host and mutation Origin validation.
Forwarded headers supply scheme/client address only from loopback proxies; they
do not authorize requests. Container forwarding may obscure the client IP without
affecting Host/Origin validation or authentication. Local health checks remain available.
Anishelf authenticates business routes and protects mutations with a CSRF token.
Caddy supplies TLS; no media-path bypass is needed. External-player URLs include
24-hour single-file authorization tokens. See [authentication operations](../guide/deployment.md#storage-updates-and-recovery).
Separately hosted frontend files must use
the same external origin for API requests.

The public origin adds one Host authority to the local allowlist; it does not
replace the configured loopback/localhost access or change the listener address.
For example, `https://example.com` accepts Host `example.com` or
`example.com:443`, while other external Hosts and ports fail with
`INVALID_REQUEST`. Production mutations with Origin must match the configured
scheme, hostname and port for public-Host requests, or the local request origin
for local-Host requests. GET, HEAD and OPTIONS only validate Host. Mutations
without Origin remain accepted unless their fetch metadata is cross-site;
development retains its fixed Vite Origin exceptions. Invalid mutation Origins
or cross-site metadata fail with `REQUEST_FORBIDDEN`. With the setting unset,
external domains remain rejected. Host/Origin validation provides no identity
verification; Anishelf owns application authentication and scoped media tokens.
Caddy supplies TLS and proxying without an anonymous media exception.

SIGINT/SIGTERM close HTTP, active application work and the database, with a
five-second shutdown limit; failure sets a nonzero exit code.

## Database migrations

The backend opens dataDir/anishelf.sqlite and applies committed SQL migrations from
backend/migrations. Ship that directory with backend/dist. The
[database design](database-design.md) owns schema constraints and supported upgrades.
Generate changes with `npm run db:generate --workspace @anishelf/backend`, review
SQL and metadata, and commit both. Never use destructive schema push at runtime.

Startup preserves existing files and fails if required persistence cannot open.
Before migration/recovery, follow the [backup instructions](../guide/operations.md#database-migrations-and-backups).
Do not treat disposable test databases as production recovery evidence.

## UI Maintenance

Follow the [Design system](design-system.md). Use the existing Tailwind/shadcn Base UI controls. Add a component from the root
with `npx shadcn@latest add button --cwd web`; review the generated source and
imports. CSS and shared components own style values; the design document describes
their usage. Vite reads tsconfig paths through resolve.tsconfigPaths. Biome supports
Tailwind directives. The active UI uses English; further localization is planned.

## Verification and Troubleshooting

Run `npm run check` for Biome, lint/architecture checks, typechecks and all tests.
`npm test` runs architecture fixtures, deployment checks, backend and web suites
in sequence and succeeds only when every stage passes. Both Vitest suites use at most four workers by default,
preventing nested workspace parallelism from oversubscribing the machine.
Use the Vitest CLI `--maxWorkers` option to override the limit when needed.
Both workspaces use the root TypeScript dependencies: `@typescript/native` aliases TypeScript 7 and provides
`tsc` for builds and typechecks; `typescript` aliases `@typescript/typescript6`
and provides the TypeScript 6 API required by dependency-cruiser. An unsupported
compiler or empty workspace scan fails explicitly.
Run workspace tests with `npm run test --workspace @anishelf/backend` or
`npm run test --workspace @anishelf/web`. Backend HTTP tests normally use Fastify
injection; stream/disconnect tests also require permission to bind a local port.
Media integration tests require FFmpeg/FFprobe and spawn real child processes;
codec cases are skipped when tools are unavailable.

Frontend base setup installs the offline fetch guard without loading QueryClient
or bootstrapping an authentication session. Tests using `query-test-utils` opt into
query-cache cleanup and CSRF bootstrap; standalone API tests import `query-setup`
when they require an authenticated transport. Pure logic tests use only base setup.
Application integration coverage is split into navigation, playback, catalog and
review suites with shared fixtures in `web/test/support/app-fixture.tsx`. Keep
cross-page flows there and boundary conditions in focused component/hook suites.
Polling and negative timing assertions should advance fake timers inside React
`act` rather than sleep against wall-clock time. Native filesystem and process
integration tests retain real timing where operating-system events are required.

DOM tests use React Testing Library and Happy DOM for interactions; they cannot
prove browser media decoding, fullscreen geometry or subtitle visibility. Inspect
390 px and 1280 px layouts, long names, keyboard focus, loading/error states and
real media playback. The recorded V1 manual acceptance is user-reported.
The retained V2 scenario implementation is recorded in History; new regression and browser acceptance evidence should be recorded separately.

Use x-request-id to correlate HTTP failures with backend logs. At info, key
business lifecycle events and warnings/errors remain visible. Enable debug for
workflow/tool details or trace for requests, polling, progress and byte ranges.
After changing executable paths or installing FFmpeg/FFprobe, restart the backend.
Ensure service managers expose the required PATH. Browser playback compatibility
still depends on the browser and codecs; discovery alone does not prove playability.

Server policy remains program-owned; browser media/interaction policies are local
code. Shared scan and subtitle constraints use browser-safe contract exports.
Deploy frontend/backend builds together when changing shared limits. Never bundle
server configuration or paths into the browser.

## Video compatibility checks

See [Video compatibility checks](../history.md#v2-video-compatibility-checks) for the negotiation API,
player behavior, conservative unknown states, and processing boundaries. Run
`npm run check` and `npm run build` after changes. FFmpeg tests need child-process
permissions; localhost acceptance needs listener permissions. Browser decoding
and output preparation still require real-sample validation.

## Completed-file delivery and offline HLS planning

Deploy Web/backend together: file metadata uses `originalMediaUrl`; playback
selection and preparation tasks expose file resources with URL, MIME type and
source timeline. Original Range delivery is unchanged. Only direct, prepared and
blocked playback decisions are public. Waiting is a separate selection flag.

HLS pure planning remains independently tested within Media Planning. It has no
HTTP target, runtime policy or executor. HLS/real-time resource, lease and artifact
placeholders were removed in batch 6. Add them alongside concrete implementation
and consumers. File/media-source execution tests do not certify HLS playback.

## Media model and planning refactor

Deploy the Web/backend together for batch 2. Compatibility descriptions/checks now
use `rulesVersion: "4"`. Audio descriptions appear once, with
`defaultAudioStreamIndex` and ordered `selectedAudioStreamIndices`; no `audio`,
`selectedAudio` or `selectedAudioTracks` aliases remain. Audio/video stream fields
are specific to their `kind`, queries contain decoding parameters only, and
`powerEfficient` is removed from submitted evidence. Refresh prior browser evidence.

Both `POST /api/media/plans` and `POST /api/playback/plans` are removed.
The browser uses `POST /api/playback/options` and `POST /api/playback/selection`. `MediaPlanningApplication` owns
inspection, compatibility decisions and read-only planning. Playback no longer
provides a planning API. Preparation receives a `PreparationPlanner` port directly
from bootstrap. Final resource choices remain separate from private execution
settings, and requests still do not create tasks or progress sessions.

No SQLite schema migration or task/artifact format conversion is needed for this
batch. Existing H.264/copy plan IDs and profile fingerprints retain their meaning;
corrected non-H.264 encode settings use a new resolver version. Existing valid
prepared files are not deleted or globally invalidated. Real FFmpeg regression
covers proportional-width rounding, exact output validation and stereo conversion;
persistence tests cover restart reuse and existing single-audio snapshot migration.

## Preparation lifecycle persistence

Tasks persist their immutable encoding specification as explicit columns and
ordered selections/filters. Progress updates only change lifecycle columns.
Old single-audio and serialized task formats are not supported.

Deploy Web/backend together: task status now includes `cancelling`, and public
progress contains `mediaTimeMs`, `percent` and `speed`. Full process telemetry stays
internal. The monitor continues polling during cancellation; terminal `cancelled`
means cleanup and persistence have completed. Task DTO/URL projection belongs to
transport, while the internal Preparation API returns task/artifact views.

Creation deduplicates without automatic retries. Retry needs fresh evidence for
the same derivation and cannot replace an invalidated artifact still held by a
reader. A cleanup failure rejects cancellation and stops new worker admission;
restart after resolving the storage/tool failure to reconcile temporary outputs.
Completed artifacts and original-source history remain separate.

Run the full check and build, including preparation concurrency, borrowing, startup
recovery, relational persistence, Range delivery and real FFmpeg regressions.
Race tests pause planning, validation, publication and release to verify that
unrelated controls proceed and terminal cancellation cannot precede cleanup.

## Playback selection and progress contracts

Batch 4 introduces `POST /api/playback/options` and
`POST /api/playback/selection`. The browser collects exact source/profile-bound
queries returned by options and submits original plus candidate checks. The server
owns copy eligibility, ordered-audio matching, profile priority, current availability
and final resource URLs. These requests cannot create or retry preparation tasks.
A failed resource can be excluded for the current intent. Explicit `tryOriginal`
uses selection without browser evidence, retaining source access/version checks.

Deploy Web and backend together. Session responses no longer contain `plan` or a
top-level `generation`; progress requests use `session.progress.generation`.
Selection responses do not authorize progress writes. Resource changes retain the
existing session token and original source timeline. No database migration or
artifact identity change is required; stored progress, settings and valid copies
remain intact.

Regression coverage includes exact/default/silent/custom-order audio selection,
unsupported output, runtime exclusions, stale evidence, root switches, deletion
between validation and selection, pending guidance, late browser responses,
explicit original attempts without inspection, and unchanged active selection on
background renders. Real FFmpeg preparation tests also select each processing
branch through HTTP and save using one progress generation. Browser decoding and
responsive visual acceptance remain separate from synthetic capability evidence.

## Embedded font cache

ASS/SSA selection can extract TTF/OTF attachments using the existing FFprobe tool;
no additional executable or system font installation is needed. Fontkit parses
font payloads in the backend. The database migration adds source-bound font sets
and attachment manifests; binary assets live in `dataDir/subtitle-fonts`.

The immutable subtitle policy currently permits 32 candidates per video, 24 MiB
per font, 64 MiB per set and 512 MiB in the font cache, with one active set extraction.
Font cache limits are separate from text-subtitle and prepared-media budgets.
HTTP clients cannot submit paths, stream indexes or extraction options. Browser
loading also enforces count and byte limits, waits at most 15 seconds for preparation
and uses a five-second font download deadline before showing fallback feedback.

Logs include font set/stream identities, sizes, status and failures; they do not
include font bytes or subtitle contents. Invalid cached fonts are removed during
startup or validation and cause a degraded set. Retry re-extracts a degraded set.
Automatic cache eviction is not implemented; cache-full feedback remains explicit.

`backend/test/fixtures/fonts` contains original synthetic TTF/OTF fonts, generated
with FontTools by the adjacent Python script. The application does not depend on
Python or FontTools. Real FFprobe tests embed these fixtures in temporary MKV files
and check byte equality, output bounds, invalid selections and cancellation.

### Embedded font acceptance (2026-10-07)

An isolated production build was exercised in the Codex in-app Chromium browser.
A generated H.264/AAC MKV carried regular/bold Noto Sans CJK SC OpenType fonts and
both synthetic test fonts (four attachments, 33,441,484 bytes total). Embedded ASS
and matching external ASS rendered CJK text, bold/italic styles and inline `\fn`
changes at 1280px and 390px viewport widths. A second MKV with PCM audio was
prepared through the Web pre-transcoding action; the player used its prepared-media
URL while rendering fonts from the original source. Subtitle off removed the
overlay; re-enabling and a paused seek repainted styled subtitles. Browser console
inspection found no warnings/errors during these sample checks.
Synthetic glyphs intentionally render
as hollow geometric boxes, making attachment-family selection visible.

This is sample-based acceptance. Exact missing-family/glyph diagnostics, all font
formats, all browsers and arbitrary complex ASS scripts remain outside this evidence.

## Continuous integration

[Check project](../../.github/workflows/check.yml) runs on pull requests targeting
`main` and pushes to `main`. It uses Ubuntu 24.04 and Node.js from `.nvmrc`,
installs FFmpeg/FFprobe and native build dependencies, and runs `npm ci`,
`npm run check` and `npm run build`. FFmpeg/FFprobe availability is checked
explicitly so missing executables fail setup rather than silently skipping
real media tests. The runner permits child processes and localhost listeners.

The container publication workflow reuses these checks after confirming that
the selected commit belongs to main history. Release tags publish version/commit
images, while workflow_dispatch from main publishes testing and test-<full-SHA>
without changing latest or package versions. Manual runs on other refs are skipped.
Checks run against the event commit; failure prevents both architecture builds and
image publication. See
[container packaging](../../package/README.md#publication-flow) for the release flow.
Local checks remain useful for immediate feedback. CI does not certify browser
codec support, visual rendering or production deployment behavior.

### FFmpeg capability table compatibility

Capability enumeration accepts FFmpeg 6.1.1's `File formats:` header and
`--` separator for muxer and demuxer tables, alongside newer table formats.
Regression tests cover MP4 muxing, Matroska/WebM aliases, legend exclusion and
rejection of missing separators or malformed rows. Unknown capabilities still
block execution; accepting the table format does not certify every encoder or
browser playback path.

### AniList list reads and Library display

Library defaults to local associated works. Choose **All works** to include the
connected account's remote-only titles, or filter by AniList viewing state. Cards
and details label cumulative AniList progress separately from local availability.
Remote-only details have no playback action until resources are associated through
the existing Catalog/Review workflow. No list read downloads resources or writes
viewing state to AniList.

GET `/api/anime/library` returns the combined, filtered page. GET
`/api/tracking/list` returns the complete cached snapshot; GET
`/api/tracking/entries/:mediaId` returns one cached entry. POST
`/api/tracking/refresh` waits for a deduplicated full refresh. Optional `generation`
values must match the current connection; HTTP mutations require the normal
Anishelf CSRF token. Snapshot data is stored in `tracking_list_cache`, keyed by
numeric account ID. Old snapshots are retained on disconnect but hidden, and only
the current account's cache is exposed. A refresh publishes only after all chunks
succeed. Failed refreshes retain previous data; a stale read normally retries
after the one-minute failure cooldown. Explicit refresh may retry immediately.

List logging adds `tracking.list_refresh_started` and
`tracking.list_refresh_cancelled` at debug, `tracking.list_refresh_completed` at
info with count/duration, and `tracking.list_refresh_failed` at warn with safe
code/retry time/cache-retention state. `tracking.authorization_required` also has
a `list` phase. `anime.library_read` is trace with scope/count/local state. These
events exclude tokens, titles and raw provider errors. Run
`npm test --workspace @anishelf/backend -- test/tracking-list.test.ts` for list
snapshot, provider, merge and diagnostic checks. The complete `npm run check`
needs permission to listen on localhost for existing HTTP disconnect tests.


### Manual AniList updates

Open **Edit AniList progress** on a local or remote-only work detail. Progress is
cumulative; explicit lower values are accepted. Choose a status when creating an
entry. The dialog separates confirmed values from durable pending intent and
exposes retry/conflict choices. App-level Toasts continue after navigation.

POST `/api/tracking/entries/:mediaId/updates` accepts connection `generation`, the
last operation `revision` (null for the first command), a remote `baseline` (null
for an absent entry) and `desired` progress/status fields. GET
`/api/tracking/operations?generation=...` exposes current-account operation state.
POST `/api/tracking/operations/:id/retry` requires generation/revision; POST
`/api/tracking/operations/:id/resolve` additionally accepts `keepRemote`. All commands
require the normal Anishelf session and CSRF. An accepted command is queued intent,
not remote success. Credentials and private attempted payloads are excluded from
HTTP responses.

`tracking_operations` stores one account/media record with desired values, baseline,
revision, immutable attempt, outcome and retry time. The worker allows five automatic
attempts, reads remote state before every attempt, and retains uncertain outcomes
across restart. Disconnect/another account fences delivery; reauthorization of the
same account permits reconciliation and recovery. Capacity is 100 unfinished and
1,000 retained operations per account, pruning only terminal records for admission.

`tracking.operation_state` logs operation/account/media IDs, revision, state, safe
failure code and retry time at info. `tracking.worker_failed` logs a sanitized
worker failure at error. Neither event includes credentials, desired values,
provider payloads or raw errors. Run `test/tracking-updates.test.ts` and
`test/anilist-account.test.ts` in the backend workspace and
`test/viewing-editor.test.tsx` in the web workspace for fixture coverage. These tests
do not mutate AniList; the subsequent user-confirmed ANI01–ANI10 acceptance is
recorded in [History](../history.md#anilist-accounts-archive-notes).


### Anime detail file actions

Single-version episodes expose the same file commands as Files beside Play. For
multiple versions, open the chooser and use the menu on the desired version. The
menu reuses external-player links, original media copy/download/playlist actions,
and preparation creation/cancellation/copy deletion. Commands target that row's
file ID; preparation compatibility is negotiated with the Catalog source version.
A known source conflict disables its menu until the source/Catalog state is
refreshed. Unknown compatibility still permits existing external-file workflows.
Web links retain the work, episode, expected source version and Library return URL.
Unavailable versions have no file menu. Detailed preparation task reads start only when the menu
opens; a batched summary read displays matching published copies immediately; compatibility checks use the existing bounded negotiation policy.

Existing media access and preparation command paths retain their safe request and
operation logs and Toast/retry behavior; no duplicate backend workflow or UI
payload logging is introduced. Frontend integration tests cover single-version
menu parity, version-specific copying, unavailable versions, stale-source disabling
and playback context. Browser checks use a local provider/API fixture, not real
media or external players.


## Playback Completion Verification

Automatic completion requires a playhead at or beyond 90 percent of the original
source duration, or a natural source end, plus at least 30 seconds of normal wall-clock
playback in the current session. Resume restoration, seeks, pauses and buffering do
not add normal time. Playback speed does not multiply wall time. Source-time mapping
continues to support prepared media; ending an intermediate segment is not a natural
source end. Unknown duration permits only the natural-end branch. Seeking near the
end and then playing normally for 30 seconds can qualify: this is a deliberate
cooperative-player policy, not a proof of viewing the whole episode. No persisted
coverage intervals or canonical-duration probe are required.

Player marks and detail edits use the same Tracking command lifecycle. Verify initial
status, explicit cross-gap confirmation, Keep then Mark, retry, conflict resolution,
manual backward correction, source/account changes and actual final provider results.
Command IDs make lost acknowledgements idempotent. Logs include command ID, origin,
operation ID/revision and delivery state; no credentials or opaque target context.
`playback.completion_handoff`, `playback.completion_admission_failed`,
`playback.completion_worker_failed` and `playback.completion_capture_failed` diagnose
automatic observation delivery; `tracking.operation_state` traces shared admission and
submission. Position saves remain independent.

Relevant suites: backend `playback-application`, `tracking-completion`, `tracking-updates`,
`database` and account HTTP; Web `playback-session`, `playback-evidence`,
`player-viewing-control`, `viewing-editor` and operation feedback. Database tests
cover the current relational format, restart persistence and unsupported-format rejection.
The user confirmed complete iteration acceptance on 2026-10-17. The fixture checks
remain distinct from that user-provided acceptance record.

A local browser acceptance on 2026-10-16 used a generated 45-second MP4, real
Playback/Tracking applications, real HTTP contracts and temporary SQLite with a
simulated AniList provider. Normal playback automatically advanced episode 4 and
showed remote confirmation. Episode 7 required explicit cross-gap confirmation;
Keep followed by Mark remained actionable. The player reused the detail editor
for a backward correction. The 390-pixel control layout had no horizontal overflow.
This verifies local media/command integration, not real AniList delivery.


## Scheduling verification

Backend queues use direct wakeups and timeouts only for retries, rather than
one-second or two-second idle scans. `tracking.worker_retry_scheduled` and
`playback.completion_retry_scheduled` debug records report the next delay without
credentials or opaque completion context. Storage scheduling failures retain the
existing error diagnostics and a bounded recovery delay.

Use fake clocks to verify idle queues perform no reads, retries run at their saved
deadlines, reconnection resumes authorization-blocked work, and notifications
received during an active handoff are not lost. Verify startup recovery and shutdown
cancellation alongside command coalescing and uncertain remote-write reconciliation.
Browser checks cover focus/visibility deduplication, hidden-tab suspension and the
five-minute visible-session fallback. See [Architecture](architecture.md#background-scheduling-and-browser-refresh)
for the active and idle refresh intervals.

### Unified anime information

Use the application detail endpoints in [Architecture](architecture.md#local-work-detail-query-naming)
for complete browser detail reads. Keep business commands with Catalog, Tracking
and Acquisition. Do not add independently maintained title, cover, year, format or
episode-count columns to their records; Metadata owns current work information.
Preserve confirmation/download evidence by versioned reference rather than treating
it as a current description. `anime.detail_read` and
`application.anime_detail_read` trace projection reads without private feed/task
payloads. Existing Metadata refresh logs describe current-information publication;
Catalog refresh no longer increments mapping revisions or rewrites descriptions.


## Deployment installer maintenance

package/install.sh is a standalone Bash entry point delivered from GitHub. It reads
interactive answers independently of script stdin, stages canonical package/deploy
assets from one GitHub commit (or an explicit local template directory), writes only
a fresh deployment bundle, and starts Docker/Podman Compose or installs rootless Quadlet
units. Engine detection auto-selects one available command and prompts only when both
exist. Podman alone exposes the Compose/Quadlet choice. Basic prompts retain default
network/image values unless the user opts into advanced settings. Rootless Podman
Compose rendering adds the canonical keep-id mapping and LinuxServer init users.
Keep template rendering narrow; source templates remain authoritative for service
ownership, credentials/bootstrap, namespaces, mounts and shutdown dependencies.

Run `bash -n package/install.sh` and `node --test package/install.test.mjs` after
changes; the latter is included in npm run test:deployment. Fixtures use real Bash
and temporary files with isolated fake runtime/network commands, exercising Compose
YAML, engine detection/provider failures, default/advanced prompts, optional units,
ports, namespace mapping, immutable template downloads, refusal
of existing files, cancellation/failures, startup sequencing and SELinux label/host
ownership preservation. They do not start a Docker daemon, execute Podman's generator
or prove SELinux enforcement on Linux. Perform a Linux/container runtime smoke check
before claiming those deployment paths live-verified. Do not log passwords, source
shell code from .env or disable host/container security labels in recovery paths.


### HTTPS proxy session regression

Container deployments must preserve the configured public HTTPS scheme through the
host TLS proxy, Web Caddy and HTTP Backend. Both application containers receive the
same public origin; Backend explicitly trusts its private Web network. Source
installations retain loopback-only proxy trust. Startup and session-transport warnings
must never include cookies, passwords or CSRF tokens.

The normal backend authentication tests cover trusted/untrusted container peers,
Secure cookies, login/session rotation and retained Origin/CSRF rejection. To exercise
real TLS and two real Caddy processes, install Caddy separately and run:

```sh
ANISHELF_TEST_CADDY_BIN=/absolute/path/to/caddy npm run test --workspace @anishelf/backend -- test/https-proxy.test.ts
```

This opt-in test needs child processes and localhost sockets; it is skipped when the
binary is not explicitly supplied. It reads the packaged Caddyfile, keeps certificates
in a temporary directory, never installs a root CA into the host trust store, and
checks that a forged forwarding header cannot change the configured HTTPS scheme.
It verifies local proxy/session behavior, not a live Podman/SELinux deployment.
