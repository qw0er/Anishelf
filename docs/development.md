# Development foundation

The backend currently provides deployment TOML loading, startup validation, and
module contracts. Pino structured logging is implemented. Persistent JSON settings, HTTP routes,
scanning, and playback are not implemented. The entry point validates deployment
configuration, prepares the dynamic data directory, logs startup/shutdown, and exits;
it does not listen on a port.

Use Node.js 24 (see `.nvmrc`) and install the locked workspace dependencies with
`npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch the backend foundation entry point |
| `npm run dev:web` | Start the existing Vite frontend scaffold |
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
HTTP-independent error codes and `DomainError`; later HTTP handlers must map these
to safe public messages and status codes instead of serializing internal errors.
The deployment loader validates TOML at runtime. Persistent JSON and HTTP input
validation will be implemented in their corresponding modules.

API DTOs omit internal relative paths. Diagnostic errors may retain a cause for
local logging. No shared frontend/backend runtime package is introduced; frontend
API integration and contract validation will follow when the HTTP module exists.

`scan: null` means no scan has run. Partial traversal is represented by a completed
scan with warnings; failed root traversal uses a failed scan while preserving the
previous snapshot. `scannedAt: null` identifies the initial empty snapshot.

The existing compiler versions, Node type versions, and frontend lint setup remain
unchanged in this foundation step; dependency/tooling consolidation is separate.

Vitest is the project test framework. Backend tests run in the Node environment;
compile-time contract assertions remain part of the TypeScript checks.

## Deployment configuration

Copy `anishelf.example.toml` to a deployment-specific file and set `dataDir` to an
absolute path. Select the file through an absolute `ANISHELF_CONFIG` path:

```sh
ANISHELF_CONFIG=/absolute/path/to/anishelf.toml npm start
```

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
