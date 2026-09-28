# Development foundation

The backend provides deployment TOML loading, startup validation, module contracts,
persistent JSON settings, Pino logging, a Fastify HTTP application skeleton,
resource access, an in-memory index, and a manual scanner.
The entry point loads configuration and listens on the configured loopback address.
Only the health endpoint is implemented; library routes, playback, and
production UI asset serving follow in later modules.

Use Node.js 24 (see `.nvmrc`) and install the locked workspace dependencies with
`npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch the backend HTTP entry point in development mode |
| `npm run dev:web` | Start Vite on 127.0.0.1:5173 with an API proxy |
| `npm run typecheck` | Check both workspaces, including backend tests |
| `npm test` | Run backend tests once with Vitest |
| `npm run test:watch --workspace @anishelf/backend` | Watch backend tests with Vitest |
| `npm run biome:check` | Check formatting, lint rules, and import organization with Biome |
| `npm run biome:fix` | Apply safe Biome fixes |
| `npm run lint` | Run Biome lint rules only |
| `npm run check` | Run Biome checks, type checks, and backend tests |
| `npm run build` | Build backend and frontend |
| `npm start` | Run the built backend entry point after building |

Backend contracts are in `backend/src/contracts`: validated configuration shapes,
internal library records and scan states, and JSON API DTOs. `errors.ts` defines
HTTP-independent error codes and `DomainError`. HTTP handlers map errors to safe
public messages and status codes instead of serializing internal errors.
Deployment TOML and persistent JSON are validated at runtime. HTTP routes use
Fastify JSON Schemas, with type coercion and removal of unknown fields disabled.

API DTOs omit internal relative paths. Diagnostic errors may retain a cause for
local logging. No shared frontend/backend runtime package is introduced; frontend
API integration will follow with the library routes and frontend modules.

`scan: null` means no scan has run. Partial traversal is represented by a completed
scan with warnings; failed root traversal uses a failed scan while preserving the
previous snapshot. `scannedAt: null` identifies the initial empty snapshot.

Compiler and Node type versions remain unchanged. Both the root and frontend lint
commands use Biome; broader dependency/tooling consolidation is separate.

Vitest is the project test framework. Backend tests run in the Node environment;
compile-time contract assertions remain part of the TypeScript checks.

## Deployment configuration

Copy `exapmle/anishelf.example.toml` to a deployment-specific file and set `dataDir` to an
absolute path. Select the file through an absolute `ANISHELF_CONFIG` path:

```sh
ANISHELF_CONFIG=/absolute/path/to/anishelf.toml npm start
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANISHELF_CONFIG` | Yes, for backend startup | Absolute path to the deployment TOML. |
| `ANISHELF_API_TARGET` | No | Vite proxy target; defaults to `http://127.0.0.1:3000`. |
| `NODE_ENV` | No | `npm run dev` sets this to `development` to enable the local Vite Origin allowlist. |

Build first with `npm run build`. The same environment variable is required for
`npm run dev`. Changes are loaded on process restart.

`dataDir` is required. Defaults are `host = "127.0.0.1"`, `port = 3000`,
`logging.level = "info"`, and `logging.destination = "stdout"`. V1 accepts loopback
IP addresses (`127.x.x.x` or `::1`) only; use an IP rather than a hostname. Ports
must be integers from 1 to 65535. Paths must be absolute and cannot contain NUL.
Unknown settings are rejected to catch typos and misplaced persistent settings.

For file logging, set `logging.destination = "file"` and an absolute
`logging.path`. A path with stdout output is rejected. File output ensures its parent directory exists, then delegates file opening
and append writes to Pino.

Missing/unreadable deployment files, malformed TOML, invalid parameters, and
unusable dynamic data directories fail startup with exit code 1 and a terminal
diagnostic. TOML parser source excerpts and error stacks are not printed. The
loader creates `dataDir` if needed and checks that it is a writable directory;
it never rewrites the deployment TOML or creates `settings.json`.

## Logging choice

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

Destination selection lives in `logging/index.ts`. Deployment loading validates
logging configuration; the logger selects stdout or the configured file path and
ensures the file's parent directory exists. Pino handles opening and writing to
the destination. There is no custom file-descriptor management or error listener.

Asynchronous logging, rotation, retention, file reopening, signal handling, and automatic output
fallback are deferred to [Future Requirements](future-requirements.md#logging-maintenance-o11o13).

Biome respects `.gitignore` through `biome.json`; dependencies and build outputs
are excluded. `npm run biome:fix` does not apply unsafe fixes.

`ApplicationLogging` creates and exposes the Pino logger. All logging setup lives
in `logging/index.ts`.

## Persistent settings

Create `settings.json` inside the deployment `dataDir`:

```json
{
  "resourceRoot": "/absolute/path/to/media"
}
```

The startup loader reads this file without rewriting it. Missing/unreadable files,
malformed JSON, unknown fields, and missing/invalid paths fail startup. Deployment
parameters belong in TOML, not in this JSON. `dataDir` and `resourceRoot` must not
contain one another; existing symlinks are resolved for this check.

A valid path pointing to a missing, unreadable, or non-directory resource produces
`RESOURCE_ROOT_UNAVAILABLE` and a warning instead of failing startup. The
`checkResourceRoot` function can be called again after the directory is repaired.
Its user-facing error excludes filesystem paths. The HTTP error mapper provides
the corresponding safe response. Manual file edits require restart; updates through the manager take effect in its
in-memory settings after the file is saved.

`PersistentConfiguration.load(dataDir)` loads the manager. `.settings` returns a
read-only copy; `await manager.update({ resourceRoot: newPath })` validates and
replaces the complete settings. Writes use a temporary file and atomic rename.
Only a successful save publishes the new in-memory value. Failed saves preserve
the old value and use `CONFIG_WRITE_FAILED`; queued updates continue after failures.
Updates are serialized in call order within one manager instance. Use one manager
per application; cross-process coordination is outside the current scope.

The manager does not monitor manual file edits or automatically rescan the library.
Resource availability can be rechecked after updates. HTTP/settings UI integration
will use this interface when those modules are implemented.

## HTTP application skeleton

`createHttpApp` in `backend/src/http/app.ts` creates the Fastify instance without
starting a listener. It accepts the application Pino logger and deployment host/port,
so tests and future modules can register routes before startup.

`GET /api/health` returns `200` with `{"status":"ok"}`. This reports HTTP service
availability, not library readiness. A missing resource directory still allows the
server to start; invalid configuration prevents startup.

Every request gets a server-generated UUID, returned in `x-request-id` and used by
Pino request logs. Client request IDs are ignored. Errors, including unknown routes,
use `{ "error": { "code", "message", "requestId" } }`. Unexpected errors are logged
internally and return a generic 500 response without paths or stacks. JSON request
bodies are limited to 64 KiB. Future media responses are not subject to that limit.

Host must match the configured loopback IP or `localhost` with the listener port.
Forwarded headers are not trusted. State-changing requests reject foreign Origin
values and cross-site browser metadata; command-line clients without Origin are
allowed. No CORS plugin is enabled.

Run the backend and Vite in separate terminals with `npm run dev` and
`npm run dev:web`. Vite uses port 5173 and proxies `/api` to
`http://127.0.0.1:3000`. If the backend uses another address or port, set
`ANISHELF_API_TARGET=http://127.0.0.1:4000` when starting Vite. Development mode
allows mutation origins `http://127.0.0.1:5173` and `http://localhost:5173` through
the proxy. Production mode requires same-origin mutations. Vite refuses to silently
switch ports, keeping the allowed development origins fixed.

SIGINT and SIGTERM stop accepting requests and close the HTTP application.
Shutdown has a five-second limit; failures set a nonzero exit code. This closes the
HTTP server, not the synchronous Pino destination.

## Resource access

`ResourceAccess` in `backend/src/resources/access.ts` provides the shared read-only
filesystem policy for scanning and future media delivery. Create it with
`await ResourceAccess.create(persistentConfig.settings)`. Creation resolves and
checks the resource root; an unavailable root raises `RESOURCE_ROOT_UNAVAILABLE`.
Create a new instance after changing the root configuration.

- `readDirectory(relativePath = "")` lists directory entries; an empty path denotes
  the root. Entries include symlinks so the scanner can identify and skip them.
- `inspectFile(relativePath)` returns size, modification time, and MIME type after
  checking readability; it closes its temporary handle.
- `openFile(relativePath)` returns the same metadata and a read-only file handle.
  The caller must call `release()` after use, including on stream failure or
  cancellation. Releasing more than once is safe.
- `getVideoMimeType(path)` is the case-insensitive extension policy: MP4/M4V use
  `video/mp4`, WebM uses `video/webm`, and MKV uses `video/x-matroska`. Other types
  return `null`. Discovery does not guarantee codec compatibility.

Inputs are internal relative paths from scanning or the index, never arbitrary
HTTP paths. Access rejects absolute paths, traversal, symlink components, and
non-regular media files. The configured root may itself be a symlink; its canonical
target becomes the access boundary. Each operation rechecks path components and
canonical containment. Opening also checks the handle's file identity before
returning it and closes rejected handles. Missing resources use `RESOURCE_MISSING`,
read failures use `RESOURCE_UNREADABLE`, and policy violations use
`RESOURCE_ACCESS_DENIED`. Public messages exclude filesystem paths.

These checks reduce replacement races; they do not guarantee confinement against
hostile concurrent directory replacement. V1 assumes the local user controls the
media tree. No resource HTTP endpoints are implemented yet.

## In-memory library index

`LibraryIndex` in `backend/src/library/index.ts` stores a complete library snapshot.
`new LibraryIndex(rootName)` starts with the `root` directory, revision 0, and
`scannedAt: null`. It has no filesystem or HTTP dependency.

- `createResourceId(kind, relativePath)` creates stable opaque IDs. The root
  directory uses `root`; unchanged kinds and paths retain their IDs between scans.
- `replace(entries, scannedAt?)` builds and validates a complete candidate before
  publishing it and incrementing the revision. Entries must include the root;
  duplicate IDs/paths and invalid parent relationships fail with `SCAN_FAILED`,
  preserving the previous snapshot. Omitted old entries disappear on replacement.
- `getEntry`, `getDirectory`, and `getFile` resolve IDs. Unknown IDs and wrong-kind
  lookups raise `RESOURCE_NOT_FOUND`.
- `listChildren(directoryId)` returns immediate children, directories first, then
  numeric-aware name ordering with an exact-name tie-breaker. The collator uses
  the fixed `en` locale; input traversal order does not determine the listing.
- `revision`, `scannedAt`, and `snapshot` expose the current index state. Query
  records and snapshot maps are detached copies, so consumers cannot mutate the
  active index. Whole-snapshot access copies the index; directory queries only
  copy the requested children.

The scanner builds candidates separately and publishes successful scans through
`replace`. The index retains internal relative paths; future HTTP handlers must
convert records to the path-free API DTOs. Scan state, filesystem revalidation,
and HTTP integration belong to their respective modules.

## Manual library scanner

`LibraryScanner` in `backend/src/library/scanner.ts` receives the shared index, a
function returning the current persistent settings, and the application Pino logger:

```ts
const scanner = new LibraryScanner({
  index,
  settings: () => persistentConfig.settings,
  logger,
});
const scan = scanner.start();
```

`start()` returns a `running` state immediately. Repeated calls during an active
scan return the same scan ID without starting another traversal. `.state` returns
a detached copy of the latest scan state, or `null` before the first scan.
`waitForCompletion()` waits for active work and returns its terminal state.

Traversal uses batches of at most eight concurrent resource-access tasks. It
discovers real directories and MP4, M4V, WebM, and MKV files through `ResourceAccess`,
without reading video contents. Symbolic links and other file types are skipped.
`visitedCount` counts encountered directory entries, including skipped entries but
excluding the root itself; `matchedCount` counts successfully inspected videos.

The scanner publishes a complete candidate only after traversal finishes. Child
directory/file failures produce a completed partial scan with warnings; unavailable
subtrees are omitted. Warning counts include each failure, while distinct public
summary messages are bounded to five and exclude paths. Detailed Pino warnings
retain local diagnostic context. Losing the root fails the scan and preserves the
previous index, including when the root disappears during traversal. Changing the
configured root during a scan also prevents publication; the next scan reads the
new settings.

`cancel()` stops scheduling work, waits for outstanding filesystem operations, and
discards the candidate. `close()` also refuses future starts. Already-running
filesystem calls are allowed to settle; cancellation does not forcibly interrupt
them. Completed, failed, and cancelled scans are logged with scan ID and duration;
completion also records counts. Scans run only when requested, and scan state is
not persisted. Application shutdown and HTTP scan routes will integrate these
interfaces in the following modules.
