# Anishelf Development

[Architecture](architecture.md) · [Future clients](clients.md) · [Playback assets](playback.md) · [UI design](design-system.md) · [Database](database-design.md) · [Operations](../guide/operations.md)

The npm workspaces live in `apps/desktop/` (Electron shell), `apps/server/` (Fastify backend), `apps/web/`
(browser entry and PWA), `packages/client-ui/` (React app and tests),
`packages/client-core/` (shared API client), and `packages/contracts/`
(shared HTTP protocol). The packages export TypeScript directly. Node.js 24
loads server-side contract exports at runtime and Vite bundles the shared code
used by the Web app.

## Local development

Use Node.js 24 (`.nvmrc`) and FFmpeg/FFprobe for media integration work. From the
repository root:

```sh
npm ci
npm run dev
```

Open `http://localhost:5173`. The first Backend startup prints the login password.
Vite proxies `/api` to Backend at `127.0.0.1:3000`.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run dev:web` | Start the local backend watcher and Web Vite server |
| `npm run dev:desktop` | Start the local backend watcher and build and open Electron |
| `npm run dev:web:lan` | Start the local backend watcher and expose Vite on `0.0.0.0:5173` for trusted LAN development |
| `npm start` / `npm run start:web` | Build Backend and Web and serve the built Web UI at the backend address |
| `npm run start:desktop` | Build Backend and Electron, then launch both without watch mode |
| `npm run dev:backend` / `npm run start:backend` | Run only Backend with a watcher, or launch the existing backend build |
| `npm run dev:web:client` | Run only the Web Vite server |
| `npm run dev:desktop:client` / `npm run start:desktop:client` | Build and open only Electron, or launch the existing desktop build |
| `npm run check` | Biome, lint, architecture, type checks and tests |
| `npm run build` | Build the server, Web, and desktop apps |
| `node --import tsx scripts/manual-tests/anime-corpus.mts summary` / `generate <new-directory>` | Inspect integration fixtures or generate an exclusive placeholder directory |
| `node --import tsx scripts/manual-tests/anime-identification-corpus.mts test` | Audit the complete offline path-to-admission pipeline; unsafe admissions, comparable episode errors and reported regressions return nonzero |
| `node --import tsx scripts/manual-tests/anime-parsing-corpus.mts summary` / `test` | Inspect or evaluate the offline [filename/directory parsing corpus](../../apps/server/test/fixtures/anime-parsing/README.md); strict benchmark failures return nonzero |
| `node --import tsx scripts/manual-tests/anime-retrieval-corpus.mts summary` / `test` | Run the small [first-page candidate search replay](../../apps/server/test/fixtures/anime-retrieval/README.md) for common query cases |
| `node --import tsx scripts/manual-tests/anime-release-corpus.mts summary` / `test` | Evaluate [subscription release identity/episode eligibility and declared attributes](../../apps/server/test/fixtures/anime-releases/README.md) using real publication titles and explicit boundary cases |
| `node --import tsx scripts/manual-tests/acquisition-discovery-corpus.mts summary` / `test` | Run the small offline [subscription resource discovery corpus](../../apps/server/test/fixtures/acquisition-discovery/README.md) for Jackett query planning, pagination, deduplication, and coverage limits |
| `node --import tsx scripts/manual-tests/anime-ranking-corpus.mts summary` / `test` | Inspect or evaluate [work identification and candidate ranking](../../apps/server/test/fixtures/anime-ranking/README.md) over frozen evidence and candidate pools; strict Top-1 misses return nonzero |
| `node --import tsx scripts/manual-tests/anime-numbering-corpus.mts summary` / `test` | Inspect or evaluate [known-work episode numbering and directory conversion](../../apps/server/test/fixtures/anime-numbering/README.md) with independently comparable target labels |

## Development proxy and hosting

The Vite development proxy sends API requests to `http://127.0.0.1:3000`.
Set the desktop client's server address on its sign-in page.

| Setting | Use |
| --- | --- |
| `ANISHELF_FRONTEND_DIR` | Enable Backend Web hosting from an absolute directory containing a prebuilt `index.html` |
| `ANISHELF_PUBLIC_ORIGIN` | Set the browser-facing origin for domain access |
| `ANISHELF_TRUSTED_PROXIES` | Trust only the actual proxy chain; packaged containers include their private Web proxy |

Development retains password authentication and CSRF protection. The packaged
Web service serves the SPA and proxies the API on one origin. See
[HTTPS deployment](../guide/deployment.md#network).
Startup variables and saved settings are listed in [Configuration](../guide/operations.md).

## Source maintenance

| Change | Rule |
| --- | --- |
| Cross-module collaboration | Import only root public contracts; construction/HTTP entries are app-only |
| Composition | Each module owns its private assembly, adapters and lifecycle |
| Policy | Keep defaults/validation with the owning module; app aggregates policy |
| Resource/media workflows | Revalidate source identity/version; preserve cancellation and cleanup |
| Frontend integration | Preserve query keys, scopes, Providers and invalidation; compose cross-module UI through app slots |
| UI components | Use existing Tailwind/shadcn Base UI controls and the [design system](design-system.md) |
| Structural refactor | Run `npm run check` and `npm run build` |

Architecture rules and exceptions are in [module boundaries](architecture.md#source-organization-and-dependency-boundaries).
Add structured lifecycle/failure logs when changing business behavior.

## Database migrations

1. Change the owning module's schema and persistence mapping.
2. Run `npm run db:generate --workspace @anishelf/backend`.
3. Review and commit generated SQL and migration metadata with the change.
4. Verify upgrade preservation and restart behavior using a disk-backed fixture.

Ship `apps/server/migrations/` and the `packages/contracts/` workspace with
`apps/server/dist`. Startup applies committed migrations;
do not use destructive schema push at runtime. Back up before upgrades; rollback
requires a matching database backup. See [database design](database-design.md).

## Test organization

Keep tests in each workspace's `test/` directory, grouped by the capability they
verify. Backend tests use `modules/<owner>/<capability>/`, `platform/`,
`transport/` and `app/`. Web tests use `features/<owner>/`, `shared/` and `app/`.
App tests cover routing, composition and workflows spanning several capabilities.
Do not mirror every internal source layer or divide the entire suite into separate
unit/integration trees.

Within a capability, name files after the behavior under test, such as
`confirmation.test.ts`, `cancellation.test.ts` or `recovery.test.ts`. Split broad
suites by responsibility rather than equal line counts. Around 500 lines is a
useful review signal; files above 800 lines should normally be split. A cohesive
scenario or parameterized matrix can justify an exception.

Use a capability-local `support/` for fixture factories and lifecycle helpers.
Promote a helper to workspace `test/support/` only when unrelated capabilities
need it. Keep static records and binary samples in `fixtures/`. Fixtures must
reset mutable state between tests and own cleanup for databases, temporary files,
routers, timers and processes. Register suite lifecycle explicitly with helpers
such as `setupTestLifecycle()` or `setupAppTest()`; importing domain fixture data
must not implicitly register an application-wide test environment. The shared
query harness deliberately registers cache cleanup and browser CSRF bootstrap.

The Web app harness is in `test/app/support/`: state, default request handling,
router rendering and Anime/Review/Playback helpers are separate. Feature tests
should use their own fixtures unless application routing is part of the assertion.
Keep network access guarded even when a request is expected to fail.

After moving tests, update imports, dynamic imports, sample/migration URLs,
scripts and documented commands. Compare test inventories and run both suites;
file counts may change while scenario counts should stay the same. Test-only
TypeScript configuration disables declaration output checks because fixture
factories are internal test infrastructure.

## Test storage

| Test purpose | Storage |
| --- | --- |
| SQL queries, constraints, transactions | `ApplicationDatabase.openMemory()`; real SQLite with production migrations |
| RSS/scanner/change-processor logic | Suite-local `memfs`, reset before each test |
| Native watchers, confinement, permissions, atomic writes | Real temporary directories |
| Migrations, credentials, restart recovery | Disk-backed database/files |
| FFmpeg/FFprobe integration | Real files and child processes |

Do not mock the filesystem globally. Watcher tests assert final state and bounded
scan scope while allowing duplicate native events; canonicalize temporary paths.

## Test networking

| Test purpose | Mechanism |
| --- | --- |
| HTTP routes and cancellation | Fastify `app.inject()` |
| qBittorrent SDK mapping/errors/multipart | Undici `MockAgent`, real network disabled |
| Frontend requests | Rejecting fetch guard; mock every expected request |
| Cookie/wire behavior, disconnects, native timeout/stream cleanup | Ephemeral loopback server |

Use real sockets/processes where OS behavior is the subject. Frontend query tests
opt into `query-test-utils` for cache cleanup and CSRF bootstrap; standalone API
tests use `query-setup` when needed. Advance polling timers inside React `act`.

## Logging choice

| Concern | Convention |
| --- | --- |
| Development output | `pino-pretty` through the backend dev script |
| Production output | Structured Pino JSON; stdout by default, optional rotating files |
| Correlation | Stable `event`, module context, request/operation IDs and elapsed time |
| `info` | User-visible lifecycle, committed changes, task start/completion |
| `warn` / `error` | Actionable failures, authorization/conflicts, persistence or tool failures |
| `debug` / `trace` | Workflow decisions, provider pacing, requests, polling and reuse |
| Secrets | Omit credentials, tokens, cookies, raw private locators, provider payloads and tool arguments |

Construction/redaction live in `apps/server/src/platform/logging/`; owners create child
loggers. Avoid secrets in message strings or unrecognized fields. File output and
rotation settings are in [Operations](../guide/operations.md#operational-log-levels).

The Web console records connection and client startup, session loss and failed
sign-in, and requests to open links, launch external players or download files.
An action marked `requested` records the handoff attempt. Keep media URLs,
access tokens, passwords, clipboard contents, and filenames out of these logs.

### AniList account and request logging

Tracking and AniList use the shared logger with their module context. Log account
lifecycle and safe error codes; correlate provider attempts using generated request
IDs. Keep tokens, queries, variables, headers and raw provider errors out of logs.
Normal status reads do not emit business events.

## Verification and troubleshooting

| Check | Command |
| --- | --- |
| All checks and tests | `npm run check` |
| Production build | `npm run build` |
| Formatting | `npm run biome:check` |
| Dependency boundaries | `npm run architecture:check` and `npm run architecture:test` |
| Backend suite | `npm run test --workspace @anishelf/backend` |
| React client suite | `npm run test --workspace @anishelf/client-ui` |
| One backend file | `npm run test --workspace @anishelf/backend -- test/app/anime-detail.test.ts` |
| Deployment fixtures | `npm run test:deployment` |
| Complete identification audit | `node --import tsx scripts/manual-tests/anime-identification-corpus.mts test`; [corpus usage](../../apps/server/test/fixtures/anime-identification/README.md) |

After changing a client workspace or host, run `npm run check` and
`npm run build`. Start the production Web build with a temporary data
directory and a small, playable media library. In a clean browser profile:

1. Open a protected deep link while signed out. Sign in and confirm the
   destination is restored.
2. Browse a directory, open a file, play and seek, and confirm the saved
   position after leaving the player.
3. Open settings and verify the client and server build details. Change the
   interface language and reload to verify it is retained.
4. Confirm that the production service worker registers and controls the page
   after reload. Check the browser console for unexpected errors.

Both Vitest workspaces use up to eight workers based on available CPU parallelism.
Use `--maxWorkers` to override the count.
Tests exercising media tools, architecture fixtures or real HTTP need permission
to spawn child processes and bind localhost ports.

| Evidence | What it establishes |
| --- | --- |
| Unit/HTTP/DOM tests | Logic, contract and interaction regressions |
| Real media-tool fixtures | Processing behavior for tested files and installed tools |
| Browser checks | Actual decoding, subtitles, fullscreen, keyboard focus and responsive layouts |
| Live deployment checks | Runtime mounts, permissions, networking, SELinux and real-service behavior |

Before claiming UI acceptance, inspect narrow/wide layouts (390/1280 px), long names,
loading/errors and real playback. The offline corpus measures matching/admission,
not live provider search recall. Record evidence with the change; past acceptance
is in [History](../history.md). Correlate HTTP failures using `x-request-id`.

## Deployment installer maintenance

`scripts/installer/` is a standard-library-only Python implementation that renders
canonical `deployment/templates/` templates bundled at build time into a fresh private
bundle. Configuration is rendered in memory and written directly to the deployment
directory. `scripts/install.pyz` is a zipapp of that source and is the distributable
used by operators. Keep credential/bootstrap ownership in the
application and service containers; never source `.env` as shell code.

```sh
python3 scripts/build-installer.py
python3 -m unittest discover -s scripts/installer_tests -v
npm run test:deployment
```

Rebuild the `.pyz` after changing the installer source or `deployment/templates/` templates. The suite rebuilds the
archive and compares its contents with the committed artifact, so an out-of-date
package fails the tests. Fixtures use fake engines/systemd commands and inspect
rendered Quadlet templates directly, including media paths with spaces, Unicode
and SELinux options. The installer suite does not discover or invoke a real
Quadlet generator. These checks do not prove generator compatibility or live
Compose or SELinux behavior; run the relevant Linux/runtime checks separately when
changing those paths.

Quadlet `Volume=` values are literal mount specifications, including paths with
spaces. Do not surround the value with shell quotes: the generator handles
quoting for the generated Podman command, and literal quotes can become part of
the mount options.

For the opt-in real TLS/two-Caddy session regression:

```sh
ANISHELF_TEST_CADDY_BIN=/absolute/path/to/caddy npm run test --workspace @anishelf/backend -- test/transport/https-proxy.test.ts
```

It needs local sockets and child processes, keeps certificates temporary and does
not install a root CA. It is skipped unless the binary path is supplied.

## Continuous integration

| Workflow | Behavior |
| --- | --- |
| [Check project](../../.github/workflows/check.yml) | PRs/pushes to main; Node from `.nvmrc`, media tools, `npm ci`, check and build |
| [Publish images](../../.github/workflows/publish-image.yml) | Reuses checks; builds native AMD64/ARM64 Web and Backend images |

Version tags on commits in main publish release images. Manual runs from any branch
publish test tags.
See [image publication](../../deployment/README.md#publication-flow). CI does not establish browser
codec support or production deployment acceptance.

Automatic background copies: [configuration and behavior](../guide/manual-preparation.md).
