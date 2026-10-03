# Development foundation

The backend provides environment-based startup configuration, startup validation, module contracts,
persistent JSON settings, Pino logging, a Fastify HTTP application skeleton,
resource access, an in-memory index, a traversal worker, and library application use cases.
The entry point loads configuration and listens on the configured loopback address.
Health, resource settings, library browsing, file metadata, and media delivery endpoints are
implemented. The frontend includes resource directory setup, browsing, and playback;
Frontend hosting in the backend is available only in development mode when `web/dist/index.html` exists. Production serves only APIs and media; use Caddy or another Web server for `web/dist`. The user has reported completing manual browser acceptance; browser and sample codec details are not recorded here. See the root README for deployment and the recommended Caddy setup.

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
| `npm run lint` | Run Biome lint rules only |
| `npm run check` | Run Biome checks, type checks, and both workspace test suites |
| `npm run build` | Build backend and frontend |
| `npm start` | Run the built backend entry point after building |

Public JSON schemas live in `backend/src/contracts/schemas`; `backend/src/contracts/http.ts`
derives their TypeScript types with TypeBox `Static`. HTTP presenters
explicitly convert business results into those contracts. Configuration types
live in `backend/src/modules/configuration/domain/model.ts`, library models and business scan state in
`backend/src/library`, and backend playback data in `backend/src/modules/playback/domain/model.ts`.
See [backend data structures](backend-data-structures.md) for type ownership and
usage. `shared/errors.ts` defines
HTTP-independent error codes and `DomainError`. HTTP handlers map errors to safe
public messages and status codes instead of serializing internal errors.
Startup environment variables and persistent JSON are validated at runtime. HTTP routes use
Fastify JSON Schemas, with type coercion and removal of unknown fields disabled.

API DTOs explicitly define their public fields. Applications provide path-free
business information, and HTTP presenters select public fields. Diagnostic errors may retain a cause for
local logging. The frontend API client re-exports these contracts through type-only
imports; backend runtime code is not bundled into the frontend.

`scan: null` means no scan has run. Partial traversal is represented by a completed
scan with warnings; failed root traversal uses a failed scan while preserving the
previous snapshot. `scannedAt: null` identifies the initial empty snapshot.

Compiler and Node type versions remain unchanged. Both the root and frontend lint
commands use Biome; broader dependency/tooling consolidation is separate.

Vitest is the project test framework. Backend and API client tests run in the Node environment;
compile-time contract assertions remain part of the TypeScript checks.

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
manager creates `settings.json` when the user first saves a resource directory.

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

## Persistent settings

Start the backend with `npm run dev:backend` and start the frontend with `npm run dev:web`
in another terminal. Open `http://127.0.0.1:5173`, enter the server's absolute media
directory path in **Resource directory**, and choose **Save directory**. The backend
creates `settings.json` inside `dataDir` on the first successful save:

```json
{
  "resourceRoot": "/absolute/path/to/media"
}
```

A missing `settings.json` enters setup mode with `resourceRoot: null`; HTTP remains
available and scanning is disabled until a directory is configured. No manual JSON
creation is required. Existing unreadable files, malformed JSON, unknown fields,
and invalid paths still fail startup without overwriting the file. `null` is the
explicit unconfigured value. Deployment parameters come from defaults and environment variables. `dataDir` and
`resourceRoot` must not contain one another; existing symlinks are resolved for this
check.

`GET /api/settings` returns the current `{ resourceRoot: string | null }`.
`PUT /api/settings` accepts `{ resourceRoot: string }`, validates the absolute path
and directory separation, and atomically persists it before changing memory.
Mutations use the same Host/Origin checks as scanning. Invalid input returns 400,
a scan or another save in progress returns 409, and a disk write failure returns
500 while retaining the prior settings and index. Changing the root clears the old
index and scan state; a successful UI save returns to the root page and unloads
previous media. Choose **Scan library** to discover files in the new directory.
Saving the same path preserves the existing scan results.

A valid path pointing to a missing, unreadable, or non-directory resource produces
`RESOURCE_ROOT_UNAVAILABLE`; settings are saved but scanning remains disabled. Fix
the directory and refresh or update the path in the UI. Manual JSON edits require
restart; UI updates take effect immediately after a successful save.

`PersistentConfiguration.load(dataDir)` loads the manager. `.settings` returns a
read-only copy; `await manager.update({ resourceRoot: newPath })` validates and
replaces the complete settings. Writes use a temporary file and atomic rename.
Only a successful save publishes the new in-memory value. Failed saves preserve
the old value and use `CONFIG_WRITE_FAILED`; queued updates continue after failures.
Updates are serialized in call order within one manager instance. Use one manager
per application; cross-process coordination is outside the current scope.

The manager does not monitor manual file edits or automatically rescan the library.
Resource availability can be rechecked after updates. The settings HTTP routes use
`SettingsApplication.updateSettings` and the scan coordinator to exclude simultaneous scans and saves, including
the asynchronous scan preflight. Successful root changes clear the index and latest
scan state; failed saves and unchanged roots preserve both. Runtime callers must use
the application use case rather than writing directly through the manager.

## HTTP application skeleton

`createHttpApp` in `backend/src/bootstrap/http.ts` creates the Fastify instance without
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

Run `npm run dev` to launch the backend watcher and Vite together. Vite uses port 5173 and proxies `/api` to
`http://127.0.0.1:3000`. If the backend uses another address or port, set
`ANISHELF_API_TARGET=http://127.0.0.1:4000` when starting Vite. Development mode
allows mutation origins `http://127.0.0.1:5173` and `http://localhost:5173` through
the proxy. Production mode requires same-origin mutations. Vite refuses to silently
switch ports, keeping the allowed development origins fixed.

For LAN development, `npm run dev:host` starts both services with Vite listening
on `0.0.0.0:5173`. Access `http://<server-lan-ip>:5173`. The backend remains on
its configured loopback address. The Vite proxy rewrites an Origin only when it
exactly matches the incoming HTTP Host, using the backend target origin;
unrelated origins are preserved for backend validation. Use this unauthenticated
development server only on a trusted network.

SIGINT and SIGTERM stop accepting requests and close the HTTP application.
Shutdown has a five-second limit; failures set a nonzero exit code. This closes the
HTTP server, not the synchronous Pino destination.

## Resource access

`ResourceAccess` in `backend/src/modules/media-source/infrastructure/access.ts` provides the shared read-only
filesystem policy for scanning and media delivery. Create it with
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
media tree. Browsing endpoints query the index; file metadata and media endpoints
recheck current filesystem access.

## In-memory library index

`LibraryIndex` in `backend/src/modules/library/infrastructure/index.ts` stores a complete library snapshot.
`new LibraryIndex(rootName)` starts with the `root` directory, revision 0, and
`scannedAt: null`. It has no filesystem or HTTP dependency.

- `createResourceId(kind, relativePath)` in `modules/library/domain/model.ts` creates stable opaque IDs. The root
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

The scanner builds candidates separately. `ScanCoordinator` publishes successful
candidates through `replace`; failure or cancellation keeps the previous index.
The index retains internal relative paths. Application query results explicitly
project public DTO fields before HTTP serialization.

## Library application and traversal

`LibraryApplication` in `backend/src/modules/library/application/library.ts` exposes library use cases. `ScanCoordinator` owns task state and scheduling;
`SettingsApplication` coordinates root changes. Assemble them through bootstrap:

```ts
const library = createLibraryModule({
  index: new LibraryIndex(),
  configuration: persistentConfig,
  logger,
});
const app = createHttpApp({ config, logger, library });
const scan = await library.startScan();
await library.waitForCompletion();
```

- `getSettings()` returns a settings copy; `updateSettings(input)` commits settings
  before clearing the previous root's snapshot and scan state when needed.
- `startScan()` shares asynchronous root preflight across concurrent callers,
  rejects an unconfigured/unavailable root before starting, and returns the scan
  state once traversal has been scheduled. While a scan runs, starts reuse its ID.
- `.state` returns a detached copy of the latest scan state;
  `waitForCompletion()` waits for pending preflight and traversal.
- `getStatus()`, `getDirectory(id)`, and `getFile(id)` return public read models.
  Status captures settings, revision, and task state together before checking
  current root availability. File metadata is rechecked on disk.
- `openMedia(id)` resolves an indexed entry and captures its root before yielding,
  then opens a read-only handle. The caller owns that handle and must release it.
  HEAD, ranges, streaming, and disconnect cleanup belong to the HTTP media module.
- `cancelScan()` cancels pending preflight/traversal and waits for outstanding work.
  `close()` also rejects new operations and waits for settings saves to settle.

Settings saves are excluded from both scan preflight and traversal. Scans are
excluded while settings are being saved. This rule applies to direct application
calls as well as HTTP requests. An in-flight media lookup uses its captured root;
an existing stream keeps its file handle across a root change. A new lookup uses
the current index, which is cleared after a changed root is committed.

`LibraryScanner` in `backend/src/modules/library/infrastructure/scanner.ts` is a traversal worker. Its
`scan(resources, rootName, progress, signal)` method returns candidate entries, or
`null` on cancellation. It has no settings store, index instance, or task state.
The application provides a fixed `ResourceAccess`, progress record, and abort signal.
Traversal uses batches of at most eight concurrent resource-access tasks. It
identifies real directories and MP4, M4V, WebM, and MKV files without reading video
contents. Symbolic links and other file types are skipped. `visitedCount` counts
encountered entries excluding the root; `matchedCount` counts inspected videos.

Child failures produce a partial candidate with warnings. Counts include each
failure, while distinct public messages are bounded to five and omit paths.
Detailed Pino warnings retain local context. Losing the root fails traversal;
changing settings outside the application during a scan also prevents publication.
Cancelled traversal waits for outstanding filesystem calls and discards its candidate.
The application logs scan start, completion, failure, and cancellation with scan ID,
duration, and counts. The configured resource root is scanned automatically during
startup and after the application saves a changed resource root; scans remain asynchronous
and are not persisted.

`checkResourceRoot` in `modules/media-source/infrastructure/access.ts` uses the same root-resolution policy
as `ResourceAccess.create`. Persistent configuration handles settings validation
and persistence; it does not probe runtime library availability.

`npm run architecture:check` resolves imports and enforces module public APIs,
layer rules and cycle prevention. Biome supplies additional editor feedback: HTTP modules call the application
and use public contracts; the application cannot import HTTP/Fastify; lower-level
modules cannot import application/HTTP; public contracts cannot import backend
implementation modules. Keep changes within those directions and run both
`npm run biome:check` and `npm run lint`.

## Library browsing HTTP endpoints

The entry point passes the shared application to `createHttpApp({ library })` and
starts a scan when a resource root is configured. The library application also
starts a scan after saving a changed root. Scans run in the background; an
unavailable startup root is logged without preventing HTTP startup. Closing the
HTTP application closes the library application, which cancels scanning and waits
for outstanding library operations.

| Endpoint | Response |
| --- | --- |
| `GET /api/settings` | `200` with `{ resourceRoot: string \| null }` |
| `PUT /api/settings` | `200` with saved settings; `400` invalid input, `409` busy, `500` write failure |
| `GET /api/library` | `200` with `ready`, `revision`, `scan`, `error`, and `stale` |
| `POST /api/library/scan` | `202` with `{ scan }`; `409` before setup or during save; unavailable root before scanning returns `503 RESOURCE_ROOT_UNAVAILABLE` |
| `GET /api/directories/:id` | `200` with `{ directory, children }`; unknown or file IDs return `404 RESOURCE_NOT_FOUND` |

`ready` reports current root availability, independently of whether a scan has
completed. `revision: 0` and `scan: null` identify the initial library. Recoverable
root errors and the latest failed scan are returned in the library response;
`stale` is true when an existing published snapshot accompanies such an error.
The previous snapshot remains browsable during scans and after failures. A
successful rescan clears the failed state and publishes a new revision.

Scan requests accept no body or an empty JSON object. Concurrent requests reuse
the root availability check and active scan. Extra query parameters are ignored.
Nonempty scan bodies and malformed directory IDs return `400 INVALID_REQUEST`. Directory
IDs are opaque lookup keys, never filesystem paths. The root ID is `root`.
Listings include only direct children, directories first and naturally sorted,
with parent IDs for navigation. DTOs omit internal relative paths and index maps.

While a scan is running, poll `/api/library`; after completion fetch the current
directory again. A deleted directory returns 404 after publication, allowing the
client to return to `root`. HTTP tests cover temporary real filesystem trees,
concurrent scans, repeat/add/remove scans, navigation, root recovery, failed and
partial scans, request validation, safe errors, and application shutdown.

## File metadata and media delivery

After scanning, use a file ID from a directory listing to request
`GET /api/files/:id`. It returns `{ file, playbackUrl }`; `file` contains the same
public fields as a directory file entry, with size, modification time, and MIME
type refreshed from the currently opened file. Internal filesystem paths are
omitted. The relative, same-origin `playbackUrl` is `/api/media/:id` and can be
assigned directly to a video element's `src`. It does not certify that the browser
supports the file's codecs. No conversion or codec probing is performed.

`GET /api/media/:id` streams from a read-only file handle without loading the full
file into memory. Full responses use `200`; satisfiable single byte ranges use
`206` with `Content-Range` and the selected `Content-Length`. Open-ended and suffix
ranges are supported. Unsatisfiable ranges return an empty `416` response with
`Content-Range: bytes */<size>`. Malformed and multipart ranges are ignored, as is
Range when `If-Range` is present without a verifiable validator.

`HEAD /api/media/:id` returns full-file headers without a body and ignores Range.
Media responses include the extension-mapped `Content-Type`, `Accept-Ranges:
bytes`, and `Cache-Control: no-store`; metadata responses also disable caching.
Empty files return an empty `200` for full requests and `416` for valid ranges.
Handles are released on metadata checks, HEAD, range rejection, completed
streams, and client disconnects. Stream errors are logged; Fastify terminates
already-started responses rather than appending JSON to media bytes.

Both routes validate opaque IDs and use the existing root confinement policy.
Unknown IDs or directory IDs return `404 RESOURCE_NOT_FOUND`; deleted indexed
files return `404 RESOURCE_MISSING`; unreadable files and symlink replacements
return `403`. An unavailable resource root returns `503`. These checks are made
again for media requests because a file may change after its URL is obtained.
HTTP tests cover response bytes and headers, ranges, special-character filenames,
current metadata, safe errors, and handle cleanup including a real HTTP disconnect.
Real browser playback and codec compatibility are checked with representative media
acceptance samples. The user has reported completing browser acceptance; these HTTP
tests validate delivery rather than decoding.

## Frontend API client

`web/src/api/client.ts` directly exports `getLibrary(options?)`,
`startScan(options?)`, `getDirectory(id, options?)`, and `getFile(id, options?)`, each returning the
corresponding typed response. IDs are URL-encoded. Requests use same-origin `/api`
paths, same-origin credentials, and `cache: "no-store"` so polling and directory
refreshes do not reuse stale browser cache entries. Scan requests send no body.

`getFile` returns `{ file, playbackUrl }` after the backend checks current file
accessibility. Assign `playbackUrl` directly to the video element's `src`; the
JSON client does not fetch media bytes.

`web/src/api/contracts.ts` re-exports the existing backend contracts with
`export type` from the npm workspace package subpath
`@anishelf/backend/contracts/http`. The
web workspace declares the backend as a development dependency; its type-only
exports resolve directly to source and do not require a backend build first.
Success responses use those TypeScript contracts; there is no
additional runtime validation of every successful response field. JSON parsing
and public error envelopes are checked at runtime.

All methods accept `{ signal: AbortSignal }`. Abort the old controller when a
view changes directory or unmounts; use a new controller for the next request.
Cancellation is checked before fetching, after headers, and after JSON parsing.
It rejects with an `AbortError`, including when the controller has a custom
abort reason. `isRequestCancelled(error)` identifies cancellation that the UI
should silently ignore. Cancelling a scan HTTP request does not cancel the
server's scan; its progress remains available from `getLibrary`.

```ts
import { getDirectory, ApiClientError, isRequestCancelled } from "./api/client.js";

const controller = new AbortController();
try {
  const listing = await getDirectory("root", { signal: controller.signal });
  // Render listing.directory and listing.children.
} catch (error) {
  if (!isRequestCancelled(error)) {
    if (error instanceof ApiClientError) {
      // Display error.message; retain error.code/status/requestId for diagnostics.
    } else {
      throw error;
    }
  }
}
// On navigation or unmount: controller.abort().
```

`ApiClientError` distinguishes `http`, `network`, and `invalid_response`. Valid
server errors preserve their public message, code, HTTP status, and request ID.
Network failures and malformed error responses use displayable fallback messages
without exposing raw response bodies. A recoverable library error inside a 200
response remains a normal `LibraryResponse`, not a rejected request.

Run client tests independently with `npm run test --workspace @anishelf/web`.
Tests mock the global `fetch` and restore it after each test.
The root `npm test` and `npm run check` run both workspace suites. UI interaction
tests use React Testing Library in Happy DOM; API client tests remain in Node.

## Functional frontend page

`web/src/App.tsx` renders the shared functional test layout with an `Outlet`.
React Router Data Mode uses `createBrowserRouter` and `RouterProvider`, with route
definitions in `web/src/routes/library.tsx`. Loaders in `routes/loaders.ts` fetch
library status, directory listings, and file metadata without automatically
scanning, forwarding `request.signal` to the API client.

The scan button submits a route action through `useFetcher` and is disabled while
starting, running, or when the root is unavailable. Action completion revalidates
the active loaders. During scanning, `useRevalidator` refreshes status and the
current view once per second and stops after a terminal status. The page shows
visited and matched counts, scan warnings, errors, and whether the previous index
is stale. Refresh retries status and the current view after a failure. Scan action
errors remain visible in the layout without replacing the current page.

`components/library-browser.tsx` shows directories, original filenames, and file
sizes. Folder clicks enter a directory; parent navigation returns one level.
Empty, loading, and error states have feedback, and a removed directory offers a
return to the root. The component renders directory loader data.
Routes in `web/src/routes/library.tsx` map `/` to the root listing,
`/directories/:id` to a directory, and `/files/:id` to the player. Links encode
resource IDs as path segments; file links append `?directory=<id>` to preserve
the originating directory. A file URL without that query returns to the parent
reported by file metadata, or the root while metadata is unavailable. Unknown
page paths show a not-found message and a root link.

Directory/file selection is derived from the URL, so direct links, reloads, and
browser back/forward navigation restore the selected view. Playback position is
still transient and is not restored after navigation or reload. App-level scan
state and polling remain mounted across route changes. Vite development and
preview servers provide the SPA fallback for direct route requests. The backend can
serve `web/dist` with the same fallback in development mode when a build exists;
without one, Vite development remains available. Production page hosting and SPA
fallback belong to Caddy or another Web server. Unknown API paths retain JSON
errors; missing assets return HTTP errors.

`components/file-player.tsx` receives file loader metadata and playback URL and
passes the URL to `components/video-player.tsx`. The adapter uses the pinned
`@vidstack/react` 1.15.6 dependency with bundled default layout styles.
`MediaPlayer` and `MediaProvider` own media state and provider lifecycle; the
default video layout provides accessible controls and keyboard interaction.
Native video receives the original same-origin HTTP Range URL and metadata
preload; media is not fetched into a Blob. A direct-video loader routes the
extensionless `/api/media/:id` URL to the native provider without an extra MIME
probe. Unsupported formats retain the browser playback error path.

Playback starts from user input. Local resume storage is disabled, and server
progress remains the only resume record. Provider setup passes its video element
to the progress controller; provider changes detach it. Layout-effect cleanup
captures progress before provider teardown. Errors recheck file accessibility to
distinguish unavailable files from generic playback failures. Back returns to the
selected directory and unloads video; Retry file reloads metadata and remounts the
player. Scan polling does not reset an open player. Router cancellation, loading,
and route error handling retain their existing behavior. Subtitle integration
and transcoding remain planned V2 capabilities.

`hooks/use-playback-session.ts` adapts the player and router to
`playback/session.ts`. Opening a file creates a server session and reads saved
progress. The controller waits for video metadata, restores the saved source-time
position, and enables writes only after restoration succeeds. Vidstack does not
maintain a separate local resume record. Playback remains usable when session
creation fails, with progress saving disabled until an explicit retry.

While playing, progress is saved approximately every five seconds, plus pause,
completed seek, and ended events. Writes are serialized; queued samples are
coalesced to the newest position. Each payload carries the session generation,
source version, and an increasing sequence. An ambiguous failed request keeps its
sequence for an identical retry. Errors stop automatic writes; Retry file recreates the player and session.
Session status and persistence errors are not displayed in the player.
Seeking to zero saves an ordinary position update within the same generation.

Route departure proceeds immediately. Unmount captures the final position,
finishes outstanding saves in the background, and releases the token; failed
saves do not block navigation. Remounts for
the same file wait for this cleanup, including StrictMode effect replay. Each
request has a five-second timeout. A `pagehide` event attempts a final fetch with
`keepalive`; closing a tab or terminating a browser cannot guarantee delivery, so
server idle expiry handles abandoned tokens. Continue watching list UI remains
planned.

Icons are named imports from `lucide-react`, following the
[Lucide React guide](https://lucide.dev/guide/react/getting-started). Buttons retain
visible text labels and decorative icons are hidden from assistive technology.
The interface uses Tailwind defaults and existing shared controls. The
[design system](design-system.md) records recurring page compositions, responsive
content handling, and feedback conventions. Loading and error screens share the
page layout; Vidstack retains its own control styling. Interaction tests cover scan publication,
navigation, direct route entry, history back/forward, playback setup/cleanup,
retries, access errors, and stale request cancellation. These DOM tests do not
validate actual media decoding.

## Frontend UI foundation

Use Tailwind CSS 4 with the `@tailwindcss/vite` plugin and shadcn/ui components.
The setup follows the official [Tailwind Vite guide](https://tailwindcss.com/docs/installation/using-vite)
and [shadcn Vite guide](https://ui.shadcn.com/docs/installation/vite).
`web/src/index.css` imports Tailwind and animation utilities and defines semantic
light/dark theme tokens. Biome enables its Tailwind CSS directive parser so these
styles remain part of the normal check and lint commands.

`web/components.json` configures shadcn for React, TypeScript, CSS variables, and
local `components/ui` source files. The `@/` alias is defined in tsconfig paths.
Vite uses its native `resolve.tsconfigPaths: true` option to read these mappings
without a separate Vite alias or alias plugin. The initial Card component was added with the official CLI;
class merging uses shadcn's `cn` package. Add future components from the root:

```sh
npx shadcn@latest add button --cwd web
```

The Vite welcome page, counter, sample logos, hero image, icon sprite, and
`App.css` have been removed. The current page is the functional test UI described
above. The active UI, client error messages, and browser metadata use English.
Localization is deferred to [O14 in Overall Requirements](requirements.md#interface-localization-o14).
`web/public/favicon.svg` is the flat television-on-a-shelf application icon used
in the browser tab; it contains editable vector shapes and no external
images, fonts, gradients, or scripts.

## Playback Database Foundation

The backend opens `dataDir/anishelf.sqlite` at startup using better-sqlite3 and
Drizzle ORM. It applies the committed SQL migrations in `backend/migrations`
relative to the module location, so both `tsx` source execution and compiled
`backend/dist` execution use the same migration directory. Ship that directory
alongside `dist`; do not use runtime schema push. Generate future migrations with
`npm run db:generate --workspace backend`, then review and commit SQL and metadata.

`ApplicationDatabase` owns the connection and exposes `playback`, a synchronous
repository for source registration, progress reads, generation opening, conditional
saves and ordered Continue watching candidates. Callers must supply a
canonical root and a source version derived from safely opened file metadata.
Registration does not perform filesystem access. Candidate queries do not assert
availability; the application must validate the active scan and source version
before producing playback links. Playback application sessions and filesystem identity collection are implemented
as described below. HTTP endpoints and frontend playback session management are integrated; Continue watching list UI remains planned.

The connection enables foreign keys, a five-second busy timeout, WAL, and FULL
synchronous mode. Generation opening and save decisions use short immediate
transactions. Duplicate retries leave viewing time unchanged. Migration
`0001_remove_progress_revision` preserves existing progress while removing its
unused revision column. Server restart loses application session tokens; callers must open a new
generation before resuming writes.

Normal HTTP shutdown closes the connection. Database initialization failure logs
`database.unavailable`, preserves existing files, and leaves independent library
and direct-playback functionality available. No database recovery by replacement
is attempted.

For a simple backup, stop the server cleanly and copy the complete data directory
before migration or recovery. Do not copy only `anishelf.sqlite` while the server
is running: committed data can reside in its WAL. Future online backup tooling
must use SQLite's backup API. Never remove source/progress rows as cache cleanup.

## Playback Application

`backend/src/modules/playback/application/playback.ts` coordinates `MediaSourceApi` and
`PlaybackRepository`. The startup entry point constructs it with the database
repository when available and closes it before closing the database. HTTP routes
call these use cases; the Web player opens sessions and saves progress.

- `open(fileId)` safely resolves the current source, registers its identity,
  successfully reads history, opens a new generation, and returns a random session
  token, saved progress, file DTO, source version, and original-media direct plan.
  It supersedes any earlier application session for the same source.
- `save(input)` validates integer millisecond values, checks the token and generation,
  revalidates the current root/file version, and delegates the ordered save to the
  repository. Stale updates produce `PLAYBACK_CONFLICT`.
- `continueWatching(limit)` filters ordered repository candidates against the
  current scan and safely inspected source versions. The display limit is applied
  after filtering, with database candidates read in batches of 100. An unscanned
  library returns `availability: "unknown"` with no actionable entries.
- `release(token)` discards a session; `close()` invalidates all sessions.

`ResourceAccess.inspectSource` computes a `stat-v1` fingerprint using decimal
bigint size, mtime/ctime nanoseconds, device, and inode values from an opened file,
then releases the handle. Canonical root paths stay internal. This detects ordinary
replacement and is not a content hash. `MediaSourceApplication` exposes source/root
resolution and a root epoch that changes on settings root switches, including a
switch away and back to the same directory.

Sessions expire after 30 minutes of inactivity; saves renew
activity. Pruning occurs during session operations and at most 1,000 sessions are
retained. No session survives restart. Repository errors are logged and wrapped
as `PLAYBACK_PERSISTENCE_FAILED`; an unavailable database produces
`PLAYBACK_UNAVAILABLE`. Failed history loading never creates a writable session.
Playback plans currently support original-media direct playback only; subtitle,
prepared-copy, and real-time selection remain future integration work.

## Playback HTTP API

`backend/src/modules/playback/http/playback.ts` registers the following routes when a
`PlaybackApplication` is supplied to `createHttpApp`. The production startup
entry point supplies it even when the database is unavailable, so dependent
operations return a typed 503 instead of appearing to be missing endpoints.
Closing the HTTP app closes playback sessions before the database connection.

| Method | Path | Input | Successful response |
| --- | --- | --- | --- |
| POST | `/api/playback/sessions` | `{ fileId }` | 201: `{ token, generation, sourceVersion, file, plan, progress }` |
| PUT | `/api/playback/sessions/:token/progress` | `{ generation, sourceVersion, sequence, positionMs, durationMs }` | 200: `{ status: "saved" or "duplicate", progress }` |
| DELETE | `/api/playback/sessions/:token` | Session token in path | 204 with no body; repeated release is harmless |
| GET | `/api/history` | Optional `?limit=100`, range 1–100 | 200: `{ availability, items: [{ file, progress }] }` |

Opening is a POST because it creates a writable session and advances generation.
It includes the selected file's saved progress; `/api/history` lists recent
viewing records. The current plan is `{ mode: "direct", playbackUrl }`.
Session tokens are server-issued UUIDs. The route token is authoritative; an
additional body token or source ID is rejected. Mutations retain the existing
Host, Origin, and Fetch Metadata checks. Playback responses use `Cache-Control:
no-store`.

Public `progress` contains `positionMs`, nullable `durationMs`, nullable
`lastViewedAtMs`, `generation`, and `lastSequence`. Millisecond
values, generations, and sequences must be safe JSON integers; unknown duration
is explicitly `null`, while known duration must be positive. Extra request
properties and missing required fields are rejected. The list limit is parsed
from a validated decimal query string without enabling global AJV coercion.
Public file metadata is projected by the existing file presenter; internal source
IDs, root identities, filesystem paths, and storage records are not returned.

Clients retain the token, source version, and generation from session creation,
and serialize writes with increasing sequence numbers. Save the final position
before releasing the session; release itself does not write progress.

`PLAYBACK_CONFLICT` returns 409 for expired, superseded, or incompatible sessions
and stale saves. `PLAYBACK_UNAVAILABLE` returns 503 when persistence is unavailable.
`PLAYBACK_PERSISTENCE_FAILED` returns 500 for repository failures, without exposing
internal causes. Missing/inaccessible source errors retain their existing status
and codes. Invalid JSON shapes and numbers return `INVALID_REQUEST` (400).
An unscanned library returns `availability: "unknown"` with an empty list; a checked
list excludes missing/replaced and near-end files while preserving their history.

## TypeBox HTTP Contracts

`backend/src/contracts/schemas` is the source of public JSON shapes and runtime request
constraints. `common.ts` defines IDs, bounded integers, health and error responses;
`library.ts` defines library, scan, file and settings shapes; `playback.ts` defines
playback requests and responses. All public object schemas reject additional
properties. `contracts/http.ts` exports only `Static<typeof Schema>` type aliases,
keeping existing type import paths available to the Web client. Business models
remain independent of TypeBox and HTTP schemas.

The server uses `@fastify/type-provider-typebox` with TypeBox 1.x. JSON API route
modules accept `HttpInstance`, whose provider generic preserves inference across
module boundaries. Encapsulated playback routes select the provider again with
`withTypeProvider`. Route handlers infer body, params, query and response types
from their schemas; do not add separate request interfaces or handwritten route
generics. Shared schemas are composed directly, so they need no schema registry or
runtime reference resolution.

AJV remains the runtime validator, with `coerceTypes: false` and
`removeAdditional: false`. TypeBox builds JSON Schema and does not replace the
validator. Query strings such as the list limit are explicitly converted only
after validation. All successful JSON API responses now have response schemas;
HTTP Range media remains a binary stream with parameter validation and no JSON
response schema. Presenters still select safe public fields before serialization.

The stable error-code vocabulary is declared once in `shared/errors.ts` and is used by
both `DomainError` and the public error schema. The existing centralized error
handler retains its status mapping and safe messages. Compile-time contract
checks verify inferred request/response types and error codes. Existing HTTP
regression tests cover validation, null duration, extra fields, session conflicts,
DTO isolation and binary Range behavior.

## Scheduled library scans

`ScanCoordinator` owns a single scan timer. `settings.json` optionally stores
`scanIntervalMinutes`: an integer from 0 to 10080; 0 disables scheduling. Missing
values use the TypeScript default of 60 minutes, including legacy settings files.
The Web Settings page exposes this preference and `GET`/`PUT /api/settings`
accept and return it. A root-only update preserves the existing interval.

The timer waits for the configured interval after each scan completes, fails, or
is cancelled. Manual and automatic scans share the same preflight, concurrency
exclusion, and atomic publication. Saving settings resets the timer; interval-only
changes preserve the current index and do not immediately scan. No timer runs
before a root is configured, while saving/scanning, or after shutdown. Failed
preflight attempts are logged and retried after the configured interval. Disabling
scheduled scans does not disable startup scans, root-change scans, or manual scans.

## Media tool layer

`backend/src/platform/media/index.ts` exports an infrastructure API independent of HTTP and the player. Startup creates the tool layer, resolves FFmpeg and FFprobe independently, checks `-version`, retains their absolute paths and logs availability. Version detection does not certify every encoder or muxer. Missing tools do not fail startup or direct playback; dependent methods throw `MediaToolError` with `TOOL_UNAVAILABLE`. Explicit paths never fall back to PATH. Install the tools separately and set the service PATH or the optional deployment overrides above.

```ts
import { MediaTools } from "./media/index.js";

const tools = await MediaTools.create(config.mediaTools);
const info = await tools.probe(absoluteMediaPath, abortSignal);
const subtitle = await tools.extractSubtitle(absoluteMediaPath, streamIndex);
const webvtt = await tools.extractSubtitle(absoluteMediaPath, streamIndex, {
    format: "webvtt",
    signal: abortSignal,
});
```

`probe` uses FFprobe JSON format/stream output and returns container names, duration in seconds, file size in bytes, bitrate in bits/second, tags and stream descriptors. Streams include absolute indices, type, codec, profile, dimensions, pixel format, frame-rate ratio, audio sample rate/channels/layout, optional duration/bitrate, language/title tags and default/forced dispositions. Unknown numeric/string properties become `null`; missing tags become an empty object. Descriptors identify codecs and do not claim browser compatibility. See the official [FFprobe documentation](https://ffmpeg.org/ffprobe.html).

`extractSubtitle` verifies that the selected absolute stream index identifies a subtitle track, then maps only that stream through FFmpeg. Default extraction copies SubRip, ASS/SSA and WebVTT without audio/video transcoding; output formats are `srt`, `ass` (including SSA input) and `webvtt`. Explicit conversion supports these output formats, including `mov_text`/plain text input when an output format is provided. ASS extraction retains available style definitions; conversion to SRT/WebVTT may lose styling. Bitmap and other unsupported subtitle codecs throw `UNSUPPORTED_SUBTITLE`. Selection follows FFmpeg's [explicit stream mapping](https://ffmpeg.org/ffmpeg.html#Stream-selection).

Results contain `streamIndex`, `format` and UTF-8 `text`. The layer writes no media or subtitle files, overwrites no input, and creates no public assets. Application callers own persistence, source-version validation and resource-root/canonical-path authorization. This is a trusted backend API and accepts absolute local regular files; never expose raw paths or stream selectors directly to clients. The current layer has no HTTP endpoint or player integration. Font attachments, bitmap extraction, cache management and transcoding remain future work.

Child processes use argument arrays without a shell, disable interactive FFmpeg input, and limit protocols to `file,pipe`. Probe time is bounded to 30 seconds, extraction to 60 seconds, and output to 10 MiB per process stream. Version checks use 5 seconds / 64 KiB. An optional `AbortSignal` cancels and kills child work. Process failure, timeout, cancellation or output overflow rejects with `TOOL_FAILED`; retained failure diagnostics are capped at 4 KiB. Malformed descriptors reject with `INVALID_MEDIA`, and invalid input paths/indices with `INVALID_INPUT`. Treat causes as internal diagnostics, not API response content.

The media-tool tests generate a real small MKV and verify probe metadata, selected SRT/ASS/WebVTT extraction and VTT cue timing when both executables are available. This integration case is skipped on machines without the tools; parsing, deployment and process-boundary tests still run.

## External subtitle discovery

`GET /api/files/:id/subtitles` discovers external subtitle candidates for an indexed video on demand. It works without FFmpeg, FFprobe or SQLite. `SubtitleApplication.discoverSubtitles` coordinates source validation and the independent `modules/subtitles/infrastructure/discovery.ts` module; HTTP routes do not access the filesystem directly. The video scanner and library snapshot remain video-only.

Only the video's immediate directory is inspected. Match the full video stem exactly, followed either by a supported extension or a dot-separated suffix: `Episode 01.srt`, `Episode 01.zh-Hans.ass`, and `Episode 01.en.forced.vtt` match `Episode 01.mkv`. `Episode 010.srt` and `Episode 01-extra.ass` do not. Extensions are case-insensitive; stems are case-sensitive and are not Unicode-normalized. Empty suffix components are rejected. Candidates use deterministic natural filename ordering. The first suffix component is exposed as a canonical language tag only when it has a plausible two/three-letter language prefix and passes `Intl.getCanonicalLocales`; this is a filename hint, not content inspection. Preserve the full suffix as `label`, including unknown tags.

The response contains the video's `sourceVersion`, `tracks`, and `warnings`. Each track contains `id`, `name`, `format` (`vtt`, `srt`, `ass`, or `ssa`), nullable `language` and `label`, `sizeBytes`, and its own `sourceVersion`. IDs hash the canonical root, video-relative path and subtitle-relative path; they stay stable when a sidecar is edited, while its version changes. IDs address the version-checked content endpoint; they are not filesystem paths. No absolute or relative server paths are returned. Different videos with the same stem in one directory can discover the same sidecars, with video-scoped IDs.

Resource access reuses regular-file checks, canonical root confinement, no-symlink traversal, nonblocking/no-follow opens and file-handle identity checks. Matching directories are ignored. Matching symlinks and other nonregular files are rejected with per-file warnings. Unreadable or disappearing candidates also produce warnings without hiding other candidates. Files exceeding 10 MiB produce `SUBTITLE_TOO_LARGE` and are omitted from tracks; exactly 10 MiB is allowed. Warnings expose only a filename and safe code, never internal errors or paths. Directory-level failures use the existing resource HTTP errors. A root change or changed video version during discovery returns `PLAYBACK_CONFLICT` (409); a missing video returns the existing missing-resource error.

Responses use `Cache-Control: no-store`. Every request inspects current sidecars, so additions/removals need no video rescan. Candidate lists are not persisted, source files are not modified, and no cache files or database records are created. Discovery verifies file access and metadata only: encoding and content delivery are validated by the content endpoint; cue parsing and rendering are handled independently by the player. Custom fonts and embedded extraction integration remain planned. Clients should request discovery independently so failures do not block direct playback.

### External subtitle playback

`GET /api/files/:id/subtitles/:trackId/content?sourceVersion=...&subtitleVersion=...` re-discovers the opaque track, validates both versions, opens it through confined resource access, and returns UTF-8 `text/plain` with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Reads are bounded to 10 MiB, including file growth. UTF-8 and BOM-marked UTF-16LE/BE are supported; undecodable input fails visibly. Missing tracks return 404; stale versions return 409. Original files are never modified and no subtitle cache or SQLite records are created.

The frontend discovers independently of playback and starts with subtitles off. Candidates are declared with `<Track src>` pointing at the version-checked text URL. Vidstack loads, parses and renders VTT/SRT; application code does not parse captions or insert cues. The built-in CC button and Settings → Captions menu own selection/off; no separate subtitle selector, refresh button, loading status, or error panel is rendered. Retry file recreates the player and re-discovers candidates. Failed selections turn off without blocking video. ASS/SSA uses a JASSUB adapter registered through Vidstack's official `TextRenderer` interface, so Vidstack controls attach, track changes and detach. The built-in `LibASSTextRenderer` targets an older event/method API incompatible with the pinned JASSUB 2.5.16; the adapter bridges that API and tears down pending loads/workers. ASS/SSA text is passed directly to JASSUB with packaged worker/WASM and a preloaded Liberation Sans fallback. Custom fonts are not loaded and missing CJK glyphs remain possible. Unsupported browser rendering capabilities disable the selected subtitle. Vidstack controls remain available in fullscreen. Switching/off clears the previous cues/overlay; leaving the player removes the registered tracks and renderer.

### Program policy ownership

Keep program-owned defaults in `backend/src/modules/configuration/domain/policy.ts`; pass the effective read-only view into application services and adapters. Subtitle read chunks, default conversion, task slots and name sorting belong here. An omitted history limit must reach the application default rather than a literal in the route. Probe and extraction slots remain separate; same-key work is deduplicated, and occupied slots return busy feedback without creating a queue. Publication serializes the cache budget check and asset commit across extraction workers.

Use `web/src/config/interaction-policy.ts` for presentation timings, seek steps and player loading. Use the browser-safe `@anishelf/backend/contracts/subtitles` export for supported subtitle formats, MIME mappings, conversions; never import server configuration into the browser. `@anishelf/backend/contracts/defaults` supplies Vite/startup defaults and the matching development-origin allowlist.

Stable IDs and processing versions belong to `modules/subtitles/domain/identity.ts`; stable paths and private modes belong to `platform/storage.ts`. Fixed SQLite, logging and static-hosting constraints belong to `platform/adapter-policy.ts`. Changes to persistent names, ID hashes or versions need compatibility and cache-invalidation review. Protocol values, byte-order marks and overflow-detection arithmetic remain implementation constants. These definitions are program-maintained and are not user settings.

## Module boundaries after the feature refactor

Business code lives in `backend/src/modules/<feature>`. Each module exposes a
small `public.ts`; importing another module's internal files is forbidden even
for type-only imports. `bootstrap/` is the explicit assembly exception. HTTP
routes call their own Application rather than adapters or other modules.
`npm run lint` includes the architecture checker; `npm run architecture:test`
exercises rejection cases. Run `npm run check` and `npm run build` for acceptance.

The shared JavaScript TypeScript compiler API is loaded from the Web workspace
by the checker because the root workspace uses the native TypeScript compiler.
Browser imports use only `@anishelf/backend/contracts/http`,
`@anishelf/backend/contracts/subtitles` and `@anishelf/backend/contracts/defaults`.
There is no catch-all backend `public/` directory. The error vocabulary is also
browser-safe; domain error instances remain server-only.

`bootstrap/library.ts` connects `SourceCatalog` to `LibraryIndex`. Playback and
subtitles receive `MediaSourceApi`, so neither can scan, change settings or depend
on Library internals. `MediaSourceApplication` owns the sole root epoch. The
root-switch use case holds the scan coordinator's exclusion gate while committing
settings, then invokes the bootstrap callback to invalidate the epoch and reset
the index. Failure leaves the prior state intact.

The source registry is shared by the playback and subtitle repositories through
an explicit capability, not through a playback-repository dependency. Table names,
source IDs, migrations and on-disk formats are unchanged. Background operations
retain their existing timers, cancellation, bounded concurrency and polling; no
queue broker or event bus is required.

Web feature internals live together with their controllers and hooks. Other
features use `features/<name>/public.ts`. `SubtitleTracks` and
`useSubtitleDiscovery` cover external and embedded subtitles.
