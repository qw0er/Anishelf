# Development foundation

The backend currently provides a minimal executable entry point and contracts only.
Configuration loading, structured logging, HTTP routes, scanning, and playback are
not implemented. The entry point prints its status and exits; it does not listen
on a port.

Use Node.js 24 (see `.nvmrc`) and install the locked workspace dependencies with
`npm ci`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Watch the backend foundation entry point |
| `npm run dev:web` | Start the existing Vite frontend scaffold |
| `npm run typecheck` | Check both workspaces, including backend tests |
| `npm test` | Run backend tests with Node's test runner through tsx |
| `npm run check` | Run type checks and backend tests |
| `npm run build` | Build backend and frontend |
| `npm start` | Run the built backend entry point after building |

Backend contracts are in `backend/src/contracts`: validated configuration shapes,
internal library records and scan states, and JSON API DTOs. `errors.ts` defines
HTTP-independent error codes and `DomainError`; later HTTP handlers must map these
to safe public messages and status codes instead of serializing internal errors.
Types do not validate TOML, JSON, or HTTP input at runtime. Runtime validation
belongs to the corresponding later modules.

API DTOs omit internal relative paths. Diagnostic errors may retain a cause for
local logging. No shared frontend/backend runtime package is introduced; frontend
API integration and contract validation will follow when the HTTP module exists.

`scan: null` means no scan has run. Partial traversal is represented by a completed
scan with warnings; failed root traversal uses a failed scan while preserving the
previous snapshot. `scannedAt: null` identifies the initial empty snapshot.

The existing compiler versions, Node type versions, and frontend lint setup remain
unchanged in this foundation step; dependency/tooling consolidation is separate.
