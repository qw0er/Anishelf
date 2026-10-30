# Anishelf Development

[Architecture](architecture.md) · [Playback assets](playback.md) · [UI design](design-system.md) · [Database](database-design.md) · [Operations](../guide/operations.md)

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
| `npm run dev` | Backend watcher plus Vite; Ctrl+C stops both |
| `npm run dev:host` | Expose Vite on `0.0.0.0:5173` for trusted LAN development |
| `npm run dev:backend` / `npm run dev:web` | Run one workspace |
| `npm start` | Build both workspaces and serve `web/dist` through Backend |
| `npm run start:backend` | Run built Backend; frontend hosting requires `ANISHELF_FRONTEND_DIR` |
| `npm run check` | Biome, lint, architecture, type checks and tests |
| `npm run build` | Build both workspaces |

## Development proxy and hosting

| Setting | Use |
| --- | --- |
| `ANISHELF_API_TARGET` | Override Vite's Backend target when its port changes |
| `ANISHELF_FRONTEND_DIR` | Enable Node SPA hosting; must point to a build containing `index.html` |
| `ANISHELF_PUBLIC_ORIGIN` | Set the browser-facing origin for domain access |
| `ANISHELF_TRUSTED_PROXIES` | Trust only the actual proxy chain; packaged containers include their private Web proxy |

Development retains password authentication and CSRF protection. Production serves
Web and API on one origin. See [HTTPS deployment](../guide/deployment.md#network-and-qbittorrent).
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

Ship `backend/migrations/` with `backend/dist`. Startup applies committed migrations;
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

Construction/redaction live in `backend/src/platform/logging/`; owners create child
loggers. Avoid secrets in message strings or unrecognized fields. File output and
rotation settings are in [Operations](../guide/operations.md#operational-log-levels).

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
| Web suite | `npm run test --workspace @anishelf/web` |
| One backend file | `npm run test --workspace @anishelf/backend -- test/app/anime-detail.test.ts` |
| Deployment fixtures | `npm run test:deployment` |
| Identification corpus | `npm run --silent anime:corpus -- match`; [corpus usage](../../backend/test/fixtures/anime-identification/README.md) |

Both Vitest workspaces default to four workers; use `--maxWorkers` when needed.
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
canonical `package/deploy/` templates bundled at build time into a fresh private
bundle. Configuration is rendered in memory and written directly to the deployment
directory. `scripts/install.pyz` is a zipapp of that source and is the distributable
used by operators. Keep credential/bootstrap ownership in the
application and service containers; never source `.env` as shell code.

```sh
python3 scripts/build-installer.py
python3 -m unittest discover -s scripts/installer_tests -v
npm run test:deployment
```

Rebuild the `.pyz` after changing the installer source or `package/deploy/` templates. The suite rebuilds the
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
See [packaging](../../package/README.md#publication-flow). CI does not establish browser
codec support or production deployment acceptance.
