# Anishelf Development and Operations

- [Deployment configuration](#deployment-configuration)
- [Logging choice](#logging-choice)
- [Resource Settings and Startup](#resource-settings-and-startup)
- [Development Proxy and Hosting](#development-proxy-and-hosting)
- [Database Migrations and Backups](#database-migrations-and-backups)
- [UI Maintenance](#ui-maintenance)
- [Verification and Troubleshooting](#verification-and-troubleshooting)

Use this guide for local setup, deployment configuration, logging, verification
and maintenance. [Architecture](architecture.md) owns implementation details;
[Requirements](requirements.md) owns scope, status and acceptance. Production
hosting instructions are in the [README](../README.md).

Use Node.js 24 (see `.nvmrc`) and install the locked workspace dependencies with
`npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the backend watcher and Vite together; stop both with Ctrl+C |
| `npm run dev:host` | Start both services with Vite listening on 0.0.0.0:5173 for LAN development |
| `npm run dev:backend` | Watch only the backend HTTP entry point with readable, colored pino-pretty terminal logs |
| `npm run start:web` | Build both workspaces, then start the backend in development mode to serve `web/dist` |
| `npm run dev:web` | Start Vite on 127.0.0.1:5173 with an API proxy |
| `npm run typecheck` | Check both workspaces, including their tests |
| `npm test` | Run backend and frontend API client tests once with Vitest |
| `npm run test:watch --workspace @anishelf/backend` | Watch backend tests with Vitest |
| `npm run biome:check` | Check formatting, lint rules, and import organization with Biome |
| `npm run biome:fix` | Apply safe Biome fixes |
| `npm run lint` | Run Biome lint and module/feature boundary checks |
| `npm run check` | Run Biome checks, type checks, and both workspace test suites |
| `npm run build` | Build backend and frontend |
| `npm start` | Run the built backend entry point after building |

## Deployment configuration

Startup requires no deployment file or application environment variables:

```sh
npm run build
npm start
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Loopback IP address (`127.x.x.x` or `::1`); hostnames are not accepted. |
| `ANISHELF_PORT` | `3000` | Decimal integer listener port from 1 to 65535. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory for Anishelf | Absolute directory; overrides the platform default. |
| `ANISHELF_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |
| `ANISHELF_LOG_DESTINATION` | `stdout` | `stdout` or `file`. |
| `ANISHELF_LOG_PATH` | Unset | Absolute log path; required with `file`, rejected with `stdout`. |
| `ANISHELF_FFMPEG_PATH` | `ffmpeg` from process PATH | Optional absolute FFmpeg executable path; resolved independently. |
| `ANISHELF_FFPROBE_PATH` | `ffprobe` from process PATH | Optional absolute FFprobe executable path; resolved independently. |
| `ANISHELF_API_TARGET` | `http://127.0.0.1:3000` | Vite proxy target; match any custom backend listener. |
| `NODE_ENV` | Unset | `development` enables the local Vite Origin allowlist and optional built-page hosting. Other values provide only APIs and media. |

The same options apply to development and production; changes require restart.
Without an explicit data directory, `platformdirs` selects the current operating system's
user data location: XDG data storage on Linux, Application Support on macOS, and Local
AppData on Windows. Data is independent of the working directory. Paths must be absolute,
cannot contain NUL, and do not receive application-level tilde expansion. Explicitly
empty Anishelf variables are invalid rather than treated as defaults.
On macOS, installations using the previous `~/.local/share/anishelf` default should set
`ANISHELF_DATA_DIR` to that existing absolute path or move the existing data into the new
platform-specific location before starting this version.

For file logging, set `ANISHELF_LOG_DESTINATION=file` and `ANISHELF_LOG_PATH`.
The logger ensures the parent directory exists, then delegates append writes to Pino.
Invalid startup parameters or unusable data directories fail startup with exit code 1
and a terminal diagnostic. All options are validated before creating the data directory.
The loader creates a missing directory with mode 0700 (subject to umask), preserves
permissions of existing directories, and checks writability. The persistent settings
manager creates `settings.json` on the first settings save, including a transcode
profile selection before a resource directory is configured. See
[Transcode profiles](transcode-profiles.md) for the optional administrator-authored
`dataDir/transcode-profiles.json`, catalog API and persistent selection.

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

`ApplicationLogging.create` synchronously creates a Pino logger with one fixed
stdout or file destination. Pino writes directly to that destination. Business
modules receive `.logger`; child loggers add context. The logger is created once
and lives until process exit. Log writes are synchronous; no application-level
flush or close interface is provided. The operating system releases file
descriptors when the process exits.

Logs use ISO UTC timestamps, numeric Pino levels, the `anishelf` service field,
and newline-delimited JSON. Call sites supply event names. Common secret fields,
authorization/cookie headers, bodies, and config/settings objects are redacted;
callers must still avoid secrets under other keys or inside message strings.

Destination selection lives in `platform/logging/index.ts`. Deployment loading validates
logging configuration; the logger selects stdout or the configured file path and
ensures the file's parent directory exists. Pino handles opening and writing to
the destination. There is no custom file-descriptor management or error listener.

Asynchronous logging, rotation, retention, file reopening, signal handling, and automatic output
fallback are deferred to [Overall Requirements](requirements.md#logging-maintenance-o11o13).

Biome respects `.gitignore` through `biome.json`; dependencies and build outputs
are excluded. `npm run biome:fix` does not apply unsafe fixes.

`ApplicationLogging` creates and exposes the Pino logger. All logging setup lives
in `platform/logging/index.ts`.

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

A missing `settings.json` starts setup mode with `resourceRoot: null`; HTTP remains
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

Vite provides SPA fallback for direct routes. `npm run start:web` builds both
workspaces and serves web/dist through the backend in development mode. Production
serves APIs/media only; use Caddy or another server for static files and SPA fallback.
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

Use the existing Tailwind/shadcn Base UI controls. Add a component from the root
with `npx shadcn@latest add button --cwd web`; review the generated source and
imports. CSS and shared components own style values; architecture documents their
usage. Vite reads tsconfig paths through resolve.tsconfigPaths. Biome supports
Tailwind directives. The active UI uses English; further localization is planned.

## Verification and Troubleshooting

Run `npm run check` for Biome, lint/module-boundary checks, typechecks and all tests.
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

See [Video compatibility checks](architecture.md#video-compatibility-checks) for the negotiation API,
player behavior, conservative unknown states, and processing boundaries. Run
`npm run check` and `npm run build` after changes. FFmpeg tests need child-process
permissions; localhost acceptance needs listener permissions. Browser decoding
and output preparation still require real-sample validation.
