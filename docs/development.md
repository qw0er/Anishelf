# Anishelf Development and Operations

- [Deployment configuration](#deployment-configuration)
- [Logging choice](#logging-choice)
- [Resource Settings and Startup](#resource-settings-and-startup)
- [Development Proxy and Hosting](#development-proxy-and-hosting)
- [Database Migrations and Backups](#database-migrations-and-backups)
- [UI Maintenance](#ui-maintenance)
- [Verification and Troubleshooting](#verification-and-troubleshooting)

Use this guide for local setup, deployment configuration, logging, verification
and maintenance. [History](history.md#v2-design) contains the archived V2 implementation design;
[Overall requirements](requirements.md) owns the feature inventory;
[current iteration requirements](current-version-requirements.md) owns selected scope and acceptance; [current iteration design](current-version-design.md)
defines the planned implementation. The [AniList API verification runbook](anilist-api-verification.md)
explains the isolated provider check and its evidence boundaries. Production
hosting instructions are in the [README](../README.md).

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
| `npm test` | Run architecture fixtures and both workspace test suites |
| `npm run test:watch --workspace @anishelf/backend` | Watch backend tests with Vitest |
| `npm run biome:check` | Check formatting, lint rules, and import organization with Biome |
| `npm run biome:fix` | Apply safe Biome fixes |
| `npm run lint` | Run Biome lint, architecture checks and unused-code checks |
| `npm run architecture:check` | Check dependency directions, public entries and runtime cycles in both workspaces |
| `npm run architecture:test` | Verify architecture rules with allowed and forbidden dependency fixtures |
| `npm run anime:corpus -- summary` | Inspect the offline anime-identification corpus; see its [usage and provenance](../backend/test/fixtures/anime-identification/README.md) for generation and evaluation |
| `npm run --silent anime:corpus -- match` | Evaluate production matching/admission against frozen candidates, including independently corroborated local numbering and separate base/scenario statistics; this does not measure live search recall |
| `npm run check` | Run Biome, lint, type checks, architecture fixtures and both workspace test suites |
| `npm run build` | Build backend and frontend |
| `npm run start:backend` | Run the built backend; host pages only when `ANISHELF_FRONTEND_DIR` is set |

The backend [Identification module](identification.md) documents stateless
recognition and automatic scan coordination. It has no task/review HTTP API or
active database dependency. [Metadata](metadata.md) now provides persistent
AniList query/artwork caching and supplies cloud candidates. [Anime Catalog](anime-catalog.md)
provides durable associations, review decisions, previews/confirmation, corrections
and library HTTP queries. The Web workflow remains pending.

The anime-identification corpus contains provider-backed work records, authentic
resource filenames and explicitly synthetic boundaries. It can generate a separate
placeholder library for scanning and later identification evaluation. These files
are not playable videos; the corpus does not declare the selected anime-library
iteration implemented or accepted.
The [Nyaa supplement](../backend/test/fixtures/anime-identification/nyaa/README.md)
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

## Deployment configuration

Startup requires no deployment file or application environment variables:

```sh
npm run build
npm run start:backend
```

For domain access behind an authenticated Caddy proxy, configure the public
origin when starting the built application:

```sh
ANISHELF_FRONTEND_DIR="$PWD/web/dist" \
ANISHELF_PUBLIC_ORIGIN=https://example.com \
npm run start:backend
```

Replace the example origin with your domain. For Docker CLI, Compose and both
rootful/rootless Quadlet configurations, use the complete
[container deployment examples](../README.md#deploy-with-a-container). Omit the
public-origin variable for local or SSH-only access.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Loopback IP address (`127.x.x.x` or `::1`); hostnames are not accepted. |
| `ANISHELF_PORT` | `3000` | Decimal integer listener port from 1 to 65535. |
| `ANISHELF_PUBLIC_ORIGIN` | Unset | One allowed external HTTP(S) origin; no wildcards, credentials, path, query or fragment. Local access remains available; proxy authentication is required. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory for Anishelf | Absolute directory; overrides the platform default. |
| `ANISHELF_INITIAL_RESOURCE_ROOT` | Unset | Absolute readable media directory used only when `settings.json` is missing; existing settings take precedence. |
| `ANISHELF_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |
| `ANISHELF_LOG_DESTINATION` | `stdout` | `stdout`, `file`, or `both`. |
| `ANISHELF_LOG_PATH` | `anishelf.log` in the platformdirs user log directory | Optional absolute path override for `file` / `both`; rejected with `stdout`. |
| `ANISHELF_LOG_MAX_SIZE_BYTES` | `10485760` | Positive safe integer rotation threshold in bytes; file modes only. |
| `ANISHELF_LOG_MAX_FILES` | `7` | Positive safe integer archive count, excluding the active file; file modes only. |
| `ANISHELF_LOG_ROTATE_INTERVAL` | `1d` | `1h` or `1d`; file modes only. |
| `ANISHELF_FFMPEG_PATH` | `ffmpeg` from process PATH | Optional absolute FFmpeg executable path; resolved independently. |
| `ANISHELF_FFPROBE_PATH` | `ffprobe` from process PATH | Optional absolute FFprobe executable path; resolved independently. |
| `ANISHELF_API_TARGET` | `http://127.0.0.1:3000` | Vite proxy target; match any custom backend listener. |
| `ANISHELF_FRONTEND_DIR` | Unset | Absolute build directory containing `index.html`; enables Node frontend hosting. Invalid or missing builds fail startup. |
| `NODE_ENV` | Unset | `development` enables the local Vite Origin allowlist. Built-page hosting is independent of this value. |

The same options apply to development and production; changes require restart.
Without an explicit data directory, `platformdirs` selects the current operating system's
user data location: XDG data storage on Linux, Application Support on macOS, and Local
AppData on Windows. Data is independent of the working directory. Paths must be absolute,
cannot contain NUL, and do not receive application-level tilde expansion. Explicitly
empty Anishelf variables are invalid rather than treated as defaults.
On macOS, installations using the previous `~/.local/share/anishelf` default should set
`ANISHELF_DATA_DIR` to that existing absolute path or move the existing data into the new
platform-specific location before starting this version.

For file logging, set `ANISHELF_LOG_DESTINATION=file` or `both`. The default path
is `join(userLogDir("anishelf", false), "anishelf.log")`; `ANISHELF_LOG_PATH`
optionally overrides it. It is independent of `ANISHELF_DATA_DIR`. See [Logging](../README.md#logging) for rotation, retention,
recovery and deployment examples.
Invalid startup parameters or unusable data directories fail startup with exit code 1
and a terminal diagnostic. All options are validated before creating the data directory.
The loader creates a missing directory with mode 0700 (subject to umask), preserves
permissions of existing directories, and checks writability. The persistent settings
manager creates `settings.json` on the first settings save, including a transcode
profile selection before a resource directory is configured, or initializes it
on startup when `ANISHELF_INITIAL_RESOURCE_ROOT` is supplied and the file is missing. See
[Transcode profiles](transcode-profiles.md) for the optional administrator-authored
`dataDir/transcode-profiles.json`, catalog API and persistent selection.

The optional `settings.json` field `transcodeCacheBudgetGiB` configures the total
prepared-media cache budget in whole GiB (default: 10). It is also editable in
Settings and through `PUT /api/settings`. Saved changes apply to subsequently
started tasks without a restart. Lowering the budget never deletes existing copies;
new output is blocked when retained copies already consume the budget. Active tasks
keep their initial output allowance, and free disk space remains an additional bound.

The task monitor initially requests the latest 10 records. Its **More** button
requests the latest 100 records. Both limits are declared in preparation policy;
this display window does not delete task history or cached media.

TOML loading and its parser dependency have been removed. To migrate, unset
`ANISHELF_CONFIG`, set `ANISHELF_DATA_DIR` to the old TOML `dataDir`, and translate
custom listener/logging values to the variables above. The loader rejects a remaining
`ANISHELF_CONFIG` with migration guidance rather than silently selecting a new data
directory. It does not read TOML or relocate existing data.

## Logging choice

The backend development script pipes stdout through `pino-pretty`, installed as a
backend development dependency. `npm run dev` displays colored level names,
timestamps in the system time zone, and readable structured context and errors.
Production startup and configured log files use the original JSON output.

`ApplicationLogging.create` creates one Pino logger with a stable output router.
Business modules and child loggers keep that instance through file rotation and
output failure. `stdout` writes synchronously to descriptor 1; `file` uses
`rotating-file-stream`; `both` sends each serialized record to both outputs.
The application owns `flush`, `reopen` and idempotent `close` lifecycle methods.
Normal shutdown closes logging after business modules; startup failure also closes
logging. Output shutdown has a two-second deadline.

Logs use ISO UTC timestamps, numeric Pino levels, the `anishelf` service field,
and newline-delimited JSON. Call sites supply event names. Common secret fields,
authorization/cookie headers, bodies, and config/settings objects are redacted;
callers must still avoid secrets under other keys or inside message strings.

Configuration lives in `platform/logging/config.ts`; construction and redaction
live in `index.ts`; output routing and lifecycle live in `output.ts`.
File rotation uses the configured byte threshold and hourly/daily interval;
`maxFiles` bounds archives, excluding the active file and `.txt` history. The
library preserves complete records across rotation and manages archive retention.
Retention warnings go to stderr; a failed archive deletion can temporarily exceed
the limit until later retention succeeds. Use a dedicated path per process and
retain the history file across restarts.

A file FIFO limits accepted serialized bytes, including the in-flight record, to
1 MiB. Records that exceed the available budget go directly to stderr rather
than increasing the queue. File errors from write callbacks, stream events and
synchronous setup/write operations all switch file output to stderr. The uncertain
in-flight record is not replayed; its byte count is reported as potential loss.
Remaining queued records go to stderr. stdout write failures, including EPIPE,
are caught directly rather than relying on Pino's internal broken-pipe handling.
The other output continues in `both` mode. When both outputs have failed,
subsequent records go to stderr once. Emergency diagnostics bypass Pino to avoid
recursive logging; stderr failure is contained but records are then lost.

Unix `SIGHUP` or `ApplicationLogging.reopen()` serializes file reopening with
in-flight writes, including explicit recovery from file failure. Signals are
unregistered on close. There is no automatic retry loop; restart to restore failed
stdout. Reopening does not replay previously lost records. A shutdown timeout
reports queued bytes that may be lost and destroys the file stream.

O11 and O12 are implemented. O13 remains partial: file output has bounded
asynchronous buffering and shutdown draining, but stdout/fallback writes remain
synchronous. See [Overall Requirements](requirements.md#logging-maintenance-o11o13).

Biome respects `.gitignore` through `biome.json`; dependencies and build outputs
are excluded. `npm run biome:fix` does not apply unsafe fixes.

`ApplicationLogging` creates and exposes the Pino logger. Logging setup and output lifecycle live
in `platform/logging/`.

### Operational log levels

Set `ANISHELF_LOG_LEVEL=debug` or `trace` before starting the backend to inspect
more detail. The default `info` level keeps normal operation concise:

| Level | Events |
| --- | --- |
| `info` | Authentication initialization, successful login/logout and password changes; startup/shutdown, scan lifecycle, settings saved, playback session opened, subtitle cache reconciliation and preparation start/completion |
| `warn` / `error` | Rejected authentication/password changes and login limits; credential/session storage failures, tool failures, discovery degradation, invalid cached assets, persistence failures, preparation failures and server errors |
| `debug` | Settings/playback requests, history reads, subtitle discovery and asset reuse, FFmpeg/FFprobe start/completion/cancellation, rejected HTTP requests |
| `trace` | HTTP request start/completion, progress saves, subtitle status polling, probe cache hits and media Range response metadata |

Structured records use `event`, module context, opaque resource/asset IDs and
elapsed milliseconds where applicable. HTTP records use route templates and
server-generated `reqId`, not raw URLs or query strings. Routine request logs
replace Fastify's default info-level access logs. Tool records omit arguments,
stdout and stderr; application failure records retain serialized errors. Session
tokens, complete settings objects and subtitle text are not included in events.

Authentication uses `auth.credentials_initialized`, `auth.login_succeeded`,
`auth.logout_succeeded` and `auth.password_changed` at info level. Invalid passwords
and rejected current-password checks use `auth.login_failed` and
`auth.password_change_rejected`; exceeded login budgets use
`auth.login_rate_limited` with the instance/source scope. These warnings do not
repeat for ordinary anonymous media or API requests. Successful login is logged
after the response completes and the session plugin has saved the session.

Credential/session failures use `auth.credentials_load_failed`,
`auth.credentials_write_failed`, `auth.password_verification_failed` and
`auth.session_store_failed`. Records retain the operation, known storage paths,
error category and filesystem/SQLite error code, including codes wrapped by the
database adapter. Raw exception messages, SQL parameters and causes are omitted
from these authentication diagnostics. Passwords, credential hashes, cookies,
CSRF tokens and media-link tokens are never included. Initial plaintext passwords
continue to appear only in the startup console, independently of these events.


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

SQLite migration 0011 stores the sanitized connection; private 0600 credential
files live under `<dataDir>/tracking-credentials/` in a 0700 directory. Back up the
SQLite database and private files consistently while stopped; a missing or
mismatched credential requires reconnection. Never log or check these files into
source control. Candidate tokens live only in bounded memory for five minutes.
No list synchronization runs in this delivery.

Anime composition supplies the same scheduler to Metadata and Tracking. Account
checks have priority with a three-request fairness limit; both consumers share
rate-header backoff and the default 2400 ms spacing. Shutting down Tracking
invalidates previews and active account checks before the shared scheduler closes.

Run `npm run test --workspace @anishelf/backend -- test/anilist-account.test.ts
test/anilist-scheduler.test.ts test/metadata.test.ts` and
`npm run test --workspace @anishelf/web -- test/anilist-account.test.tsx` for focused
regressions. Metadata HTTP-disconnect tests require localhost listening permission.
See [the design](current-version-design.md#implemented-account-foundation) for
API/status and real-provider verification boundaries.

## Resource Settings and Startup

When `settings.json` is missing and `ANISHELF_INITIAL_RESOURCE_ROOT` is set,
startup validates a readable, searchable directory separate from dataDir and
creates settings containing that root. Creation never replaces an existing file;
concurrent initializers load the file created first. Existing settings, including
a null root, take precedence over the initialization default. An empty or malformed
settings file still fails startup and is not repaired or replaced. Invalid path
syntax fails environment validation before dataDir creation; an inaccessible or
overlapping initial directory fails startup without creating settings. After
initialization, Settings remains editable and subsequent restarts preserve it.
Container examples set the initial root to `/media`.

Without an initialization default, a missing `settings.json` starts setup mode
with `resourceRoot: null`; HTTP remains
available until the resource directory is configured in Settings. The first
successful save creates the file in dataDir. Current user settings are the
absolute resource root and optional `scanIntervalMinutes`; zero disables scheduled
scanning. Manual edits require restart; UI saves take effect immediately.

Malformed/unreadable settings, unknown keys and invalid paths fail startup without
overwriting the file. Keep dataDir, the resource root and frontend assets separate;
dataDir and resourceRoot must not contain one another, including through symlinks.
An unavailable configured root preserves settings but disables scanning until it
is fixed. Missing FFmpeg/FFprobe disables dependent operations and logs a warning;
browsing and direct playback remain available.

Saving a real root change invalidates the old index and starts a scan; saving the
same root preserves results. Scans and saves exclude each other. Failed writes
preserve the prior settings and index. See the architecture's configuration and
scan rules for API/error details.

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
[Caddy deployment example](deployment.md#caddy-reverse-proxy). Backend listening
remains loopback-only. The explicit origin supplies the external scheme and port
for Host and mutation Origin validation; `trustProxy` trusts loopback proxies only and
forwarded headers supply the scheme and client address only when received from
a loopback proxy; they do not authorize requests. Local health checks remain available.
Anishelf authenticates business routes and protects mutations with a CSRF token.
Caddy supplies TLS; no media-path bypass is needed. External-player URLs include
24-hour single-file authorization tokens. See [authentication operations](deployment.md#authentication-and-password-recovery).
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
verification; Caddy owns external authentication and any explicitly configured
original-media exception.

SIGINT/SIGTERM close HTTP, active application work and the database, with a
five-second shutdown limit; failure sets a nonzero exit code.

## Database Migrations and Backups

The backend opens dataDir/anishelf.sqlite and applies committed versioned SQL
migrations from backend/migrations. Ship that directory alongside backend/dist.
Generate changes with `npm run db:generate --workspace backend`, review generated
SQL and metadata, and commit them; never use destructive schema push at runtime.

Database initialization failure preserves existing files and disables dependent
persistence; independent browsing/direct media delivery remain usable. No automatic
replacement or destructive recovery is performed.

For a simple backup, stop the server cleanly and copy the complete data directory
before migration or recovery. Do not copy only anishelf.sqlite while it is active:
WAL files may contain committed data. Settings, durable database records and
regenerable subtitle payloads have different lifetimes. Cache cleanup must not
remove history, settings or original media.

## UI Maintenance

Follow the [Design system](design-system.md). Use the existing Tailwind/shadcn Base UI controls. Add a component from the root
with `npx shadcn@latest add button --cwd web`; review the generated source and
imports. CSS and shared components own style values; the design document describes
their usage. Vite reads tsconfig paths through resolve.tsconfigPaths. Biome supports
Tailwind directives. The active UI uses English; further localization is planned.

## Verification and Troubleshooting

Run `npm run check` for Biome, lint/architecture checks, typechecks and all tests.
`npm test` runs architecture, backend and web tests concurrently, prefixes each
suite's output, and succeeds only when all three suites pass. Both workspaces use the root
TypeScript dependencies: `@typescript/native` aliases TypeScript 7 and provides
`tsc` for builds and typechecks; `typescript` aliases `@typescript/typescript6`
and provides the TypeScript 6 API required by dependency-cruiser. An unsupported
compiler or empty workspace scan fails explicitly.
Run workspace tests with `npm run test --workspace @anishelf/backend` or
`npm run test --workspace @anishelf/web`. Backend HTTP tests normally use Fastify
injection; stream/disconnect tests also require permission to bind a local port.
Media integration tests require FFmpeg/FFprobe and spawn real child processes;
codec cases are skipped when tools are unavailable.

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

See [Video compatibility checks](history.md#v2-video-compatibility-checks) for the negotiation API,
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

## Preparation lifecycle migration

Batch 3 adds `0005_preparation_lifecycle.sql`. Startup applies it transactionally:
it preserves task/source/profile identities, plan IDs, artifact IDs, sizes and MIME
types while replacing duplicated request/identity snapshots with encoding-settings
snapshot version 1. Source identity remains in the indexed source record. Completed
media bytes are retained and checked during normal reconciliation. Existing ordered
selections and earlier single-audio snapshot migration remain supported. Schema
metadata is tracked alongside the custom data-preserving SQL.

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
recovery, legacy snapshot migration, Range delivery and real FFmpeg regressions.
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

[Check project](../.github/workflows/check.yml) runs on pull requests targeting
`main` and pushes to `main`. It uses Ubuntu 24.04 and Node.js from `.nvmrc`,
installs FFmpeg/FFprobe and native build dependencies, and runs `npm ci`,
`npm run check` and `npm run build`. FFmpeg/FFprobe availability is checked
explicitly so missing executables fail setup rather than silently skipping
real media tests. The runner permits child processes and localhost listeners.

The container publication workflow reuses these checks after confirming that
the release tag belongs to `main` history. Checks run against the tagged commit;
failure prevents both architecture builds and image publication. See
[container packaging](../package/README.md#publication-flow) for the release flow.
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
do not mutate AniList; live writes and full ANI acceptance require separate evidence.


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
