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

Public JSON contracts live in `backend/src/http/contracts.ts`; HTTP presenters
explicitly convert business results into those contracts. Configuration types
live in `backend/src/config/model.ts`, library models and business scan state in
`backend/src/library`, and backend playback data in `backend/src/playback/model.ts`.
See [backend data structures](backend-data-structures.md) for type ownership and
usage. `errors.ts` defines
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

Destination selection lives in `logging/index.ts`. Deployment loading validates
logging configuration; the logger selects stdout or the configured file path and
ensures the file's parent directory exists. Pino handles opening and writing to
the destination. There is no custom file-descriptor management or error listener.

Asynchronous logging, rotation, retention, file reopening, signal handling, and automatic output
fallback are deferred to [Overall Requirements](requirements.md#logging-maintenance-o11o13).

Biome respects `.gitignore` through `biome.json`; dependencies and build outputs
are excluded. `npm run biome:fix` does not apply unsafe fixes.

`ApplicationLogging` creates and exposes the Pino logger. All logging setup lives
in `logging/index.ts`.

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
`LibraryApplication.updateSettings` to exclude simultaneous scans and saves, including
the asynchronous scan preflight. Successful root changes clear the index and latest
scan state; failed saves and unchanged roots preserve both. Runtime callers must use
the application use case rather than writing directly through the manager.

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

`ResourceAccess` in `backend/src/resources/access.ts` provides the shared read-only
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

`LibraryIndex` in `backend/src/library/index.ts` stores a complete library snapshot.
`new LibraryIndex(rootName)` starts with the `root` directory, revision 0, and
`scannedAt: null`. It has no filesystem or HTTP dependency.

- `createResourceId(kind, relativePath)` in `library/model.ts` creates stable opaque IDs. The root
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

The scanner builds candidates separately. `LibraryApplication` publishes successful
candidates through `replace`; failure or cancellation keeps the previous index.
The index retains internal relative paths. Application query results explicitly
project public DTO fields before HTTP serialization.

## Library application and traversal

`LibraryApplication` in `backend/src/application/library.ts` owns library use cases
and task state. Assemble it with one index, persistent settings store, and logger:

```ts
const library = new LibraryApplication({
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

`LibraryScanner` in `backend/src/library/scanner.ts` is a traversal worker. Its
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
duration, and counts. Scans run only on request and are not persisted.

`checkResourceRoot` in `resources/access.ts` uses the same root-resolution policy
as `ResourceAccess.create`. Persistent configuration handles settings validation
and persistence; it does not probe runtime library availability.

Biome import restrictions enforce these boundaries: HTTP modules call the application
and use public contracts; the application cannot import HTTP/Fastify; lower-level
modules cannot import application/HTTP; public contracts cannot import backend
implementation modules. Keep changes within those directions and run both
`npm run biome:check` and `npm run lint`.

## Library browsing HTTP endpoints

The entry point passes the shared application to `createHttpApp({ library })`.
No automatic scan runs at startup. Closing the HTTP application closes the library
application, which cancels scanning and waits for outstanding library operations.

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
`@anishelf/backend/http/contracts`. The
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
passes the URL to `components/art-player.tsx`, a React adapter for the bundled,
exact-version ArtPlayer npm dependency. The underlying video uses the original
same-origin HTTP Range URL and metadata preload; media is not fetched into a Blob.
The user starts playback with ArtPlayer controls. The adapter enables native
fullscreen and adds keyboard focus/activation for play and fullscreen. When the
video is focused, Space toggles playback, Left/Right seek by five seconds, and
Up/Down adjust volume. Independent resume storage, automatic media reconnects,
and the ArtPlayer context menu are disabled. Errors trigger an access
recheck to distinguish unavailable files from generic browser playback failures.
Back returns to the selected directory and pauses/unloads the video; Retry file
reloads metadata and the media element. Scanning does not reset an open player.
The router cancels obsolete metadata/list requests. Pending navigation shows a
loading message and a cancellation link while retaining the current view.
Route error elements provide error messages, retries, and return links. Polling
timers are cleaned up when scanning stops or the layout unmounts. Playback cleanup
creates a fresh instance and destroys the previous instance when React
StrictMode replays effects during development. Leaving the player aborts pending
access rechecks, pauses playback, and destroys the instance to release its source,
event listeners, and player DOM. Subtitle rendering, saved progress, and
transcoding remain planned V2 capabilities.

Icons are named imports from `lucide-react`, following the
[Lucide React guide](https://lucide.dev/guide/react/getting-started). Buttons retain
visible text labels and decorative icons are hidden from assistive technology.
The interface uses Tailwind defaults and existing shared controls. The
[design system](design-system.md) records recurring page compositions, responsive
content handling, and feedback conventions. Loading and error screens share the
page layout; ArtPlayer retains its own control styling. Interaction tests cover scan publication,
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
saves, start-over, and ordered Continue watching candidates. Callers must supply a
canonical root and a source version derived from safely opened file metadata.
Registration does not perform filesystem access. Candidate queries do not assert
availability; the application must validate the active scan and source version
before producing playback links. Playback application sessions and filesystem identity collection are implemented
as described below. HTTP endpoints are registered; player integration remains planned.

The connection enables foreign keys, a five-second busy timeout, WAL, and FULL
synchronous mode. Generation opening and save decisions use short immediate
transactions. Accepted saves increment revision; duplicate retries leave viewing
time unchanged. Start-over conditionally replaces the current generation in one
statement. Server restart loses application session tokens; callers must open a new
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

`backend/src/application/playback.ts` coordinates `LibraryApplication` and
`PlaybackRepository`. The startup entry point constructs it with the database
repository when available and closes it before closing the database. HTTP routes
call these use cases; the Web player is not connected yet.

- `open(fileId)` safely resolves the current source, registers its identity,
  successfully reads history, opens a new generation, and returns a random session
  token, saved progress, file DTO, source version, and original-media direct plan.
  It supersedes any earlier application session for the same source.
- `save(input)` validates integer millisecond values, checks the token and generation,
  revalidates the current root/file version, and delegates the ordered save to the
  repository. Stale updates produce `PLAYBACK_CONFLICT`.
- `startOver(input)` resets progress using the current generation. The most recent
  successful reset request ID and response are retained per session for retry;
  retrying it does not reset the database again. Clients must serialize resets.
- `continueWatching(limit)` filters ordered repository candidates against the
  current scan and safely inspected source versions. The display limit is applied
  after filtering, with database candidates read in batches of 100. An unscanned
  library returns `availability: "unknown"` with no actionable entries.
- `release(token)` discards a session; `close()` invalidates all sessions.

`ResourceAccess.inspectSource` computes a `stat-v1` fingerprint using decimal
bigint size, mtime/ctime nanoseconds, device, and inode values from an opened file,
then releases the handle. Canonical root paths stay internal. This detects ordinary
replacement and is not a content hash. `LibraryApplication` exposes source/root
resolution and a root epoch that changes on settings root switches, including a
switch away and back to the same directory.

Sessions expire after 30 minutes of inactivity; saves and reset retries renew
activity. Pruning occurs during session operations and at most 1,000 sessions are
retained. No session survives restart. Repository errors are logged and wrapped
as `PLAYBACK_PERSISTENCE_FAILED`; an unavailable database produces
`PLAYBACK_UNAVAILABLE`. Failed history loading never creates a writable session.
Playback plans currently support original-media direct playback only; subtitle,
prepared-copy, and real-time selection remain future integration work.


## Playback HTTP API

`backend/src/http/playback.ts` registers the following routes when a
`PlaybackApplication` is supplied to `createHttpApp`. The production startup
entry point supplies it even when the database is unavailable, so dependent
operations return a typed 503 instead of appearing to be missing endpoints.
Closing the HTTP app closes playback sessions before the database connection.

| Method | Path | Input | Successful response |
| --- | --- | --- | --- |
| POST | `/api/playback/sessions` | `{ fileId }` | 201: `{ token, generation, sourceVersion, file, plan, progress }` |
| PUT | `/api/playback/sessions/:token/progress` | `{ generation, sourceVersion, sequence, positionMs, durationMs }` | 200: `{ status: "saved" or "duplicate", progress }` |
| POST | `/api/playback/sessions/:token/start-over` | `{ generation, requestId }` | 200: `{ progress }` |
| DELETE | `/api/playback/sessions/:token` | Session token in path | 204 with no body; repeated release is harmless |
| GET | `/api/continue-watching` | Optional `?limit=20`, range 1–100 | 200: `{ availability, items: [{ file, progress }] }` |

Opening is a POST because it creates a writable session and advances generation.
It includes saved history; no separate history read endpoint is required for the
initial resume flow. The current plan is `{ mode: "direct", playbackUrl }`.
Session tokens are server-issued UUIDs. The route token is authoritative; an
additional body token or source ID is rejected. Mutations retain the existing
Host, Origin, and Fetch Metadata checks. Playback responses use `Cache-Control:
no-store`.

Public `progress` contains `positionMs`, nullable `durationMs`, nullable
`lastViewedAtMs`, `revision`, `generation`, and `lastSequence`. Millisecond
values, generations, and sequences must be safe JSON integers; unknown duration
is explicitly `null`, while known duration must be positive. Extra request
properties and missing required fields are rejected. The list limit is parsed
from a validated decimal query string without enabling global AJV coercion.
Public file metadata is projected by the existing file presenter; internal source
IDs, root identities, filesystem paths, and storage records are not returned.

Clients retain the token, source version, and generation from session creation,
and serialize progress writes with increasing sequence numbers. A successful
start-over returns a new generation and resets the sequence; use a stable reset
`requestId` when retrying the same operation. That ID is independent of the
server-generated `x-request-id` used for HTTP diagnostics. Save the final position
before releasing the session; release itself does not write progress.

`PLAYBACK_CONFLICT` returns 409 for expired, superseded, or incompatible sessions
and stale saves. `PLAYBACK_UNAVAILABLE` returns 503 when persistence is unavailable.
`PLAYBACK_PERSISTENCE_FAILED` returns 500 for repository failures, without exposing
internal causes. Missing/inaccessible source errors retain their existing status
and codes. Invalid JSON shapes and numbers return `INVALID_REQUEST` (400).
An unscanned library returns `availability: "unknown"` with an empty list; a checked
list excludes missing/replaced and near-end files while preserving their history.
