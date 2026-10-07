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
[Requirements](requirements.md) owns scope, status and acceptance. Production
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
| `npm test` | Run backend and frontend API client tests once with Vitest |
| `npm run test:watch --workspace @anishelf/backend` | Watch backend tests with Vitest |
| `npm run biome:check` | Check formatting, lint rules, and import organization with Biome |
| `npm run biome:fix` | Apply safe Biome fixes |
| `npm run lint` | Run Biome lint and dependency-cruiser architecture checks |
| `npm run architecture:check` | Check dependency directions, public entries and runtime cycles in both workspaces |
| `npm run architecture:test` | Verify architecture rules with allowed and forbidden dependency fixtures |
| `npm run check` | Run Biome checks, type checks, and both workspace test suites |
| `npm run build` | Build backend and frontend |
| `npm run start:backend` | Run the built backend; host pages only when `ANISHELF_FRONTEND_DIR` is set |

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
| `info` | Startup/shutdown, scan lifecycle, settings saved, playback session opened, subtitle cache reconciliation and preparation start/completion |
| `warn` / `error` | Tool failures, discovery degradation, invalid cached assets, persistence failures, preparation failures and server errors |
| `debug` | Settings/playback requests, history reads, subtitle discovery and asset reuse, FFmpeg/FFprobe start/completion/cancellation, rejected HTTP requests |
| `trace` | HTTP request start/completion, progress saves, subtitle status polling, probe cache hits and media Range response metadata |

Structured records use `event`, module context, opaque resource/asset IDs and
elapsed milliseconds where applicable. HTTP records use route templates and
server-generated `reqId`, not raw URLs or query strings. Routine request logs
replace Fastify's default info-level access logs. Tool records omit arguments,
stdout and stderr; application failure records retain serialized errors. Session
tokens, complete settings objects and subtitle text are not included in events.

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
validation unchanged. This development server has no authentication.

Vite provides SPA fallback for direct routes. `npm start` builds both
workspaces and serves `web/dist` through the backend in its normal runtime mode.
The script explicitly sets `ANISHELF_FRONTEND_DIR` to the absolute `web/dist` path.
In any mode, Node enables static files and SPA fallback only when this environment
variable is set. Without it, the backend serves only APIs/media, even if a frontend
build exists. The configured directory must contain `index.html` or startup fails.
A shared Caddy can proxy the whole application. Configure `ANISHELF_PUBLIC_ORIGIN`
for its external origin and preserve Host/Origin headers; see the
[Caddy deployment example](../README.md#caddy-reverse-proxy). Backend listening
remains loopback-only. The explicit origin supplies the external scheme and port
for Host and mutation Origin validation; `trustProxy` remains disabled and
forwarded headers cannot authorize requests. Local health checks remain available.
Caddy authenticates all routes by default. An optional
[original-media exception](../README.md#external-players-without-authentication)
allows `/api/media/*` without credentials for external players; anyone with a
media URL can then access that file. All other routes remain authenticated.
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
Architecture tests run before workspace tests. TypeScript 6 is shared by both
workspaces so dependency-cruiser can use its supported compiler API; an unsupported
compiler or empty workspace scan fails explicitly.
Run workspace tests with `npm run test --workspace @anishelf/backend` or
`npm run test --workspace @anishelf/web`. Backend HTTP tests normally use Fastify
injection; stream/disconnect tests also require permission to bind a local port.
Media integration tests require FFmpeg/FFprobe and spawn real child processes;
codec cases are skipped when tools are unavailable.

DOM tests use React Testing Library and Happy DOM for interactions; they cannot
prove browser media decoding, fullscreen geometry or subtitle visibility. Inspect
390 px and 1280 px layouts, long names, keyboard focus, loading/error states and
real media playback. The recorded V1 manual acceptance is user-reported; broader
V2 acceptance remains governed by the requirements checklist.

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
