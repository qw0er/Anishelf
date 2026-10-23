# Configuration and Operations

Use this guide to configure and maintain an installed Anishelf instance. For container
installation, HTTPS and service management, start with [Deployment](deployment.md).
For developing the application itself, use [Development](../development/README.md).
Commands for source installations run from the repository root.

- [Startup configuration](#deployment-configuration) and [environment variables](#environment-variables)
- [Resource directories](#resource-settings-and-startup)
- [Logs](#operational-log-levels)
- [Database migrations and backups](#database-migrations-and-backups)

## Deployment configuration

Startup requires no deployment file or application environment variables:

```sh
npm run build
npm run start:backend
```

For domain access behind a Caddy TLS proxy, configure the public
origin when starting the built application:

```sh
ANISHELF_FRONTEND_DIR="$PWD/web/dist" \
ANISHELF_PUBLIC_ORIGIN=https://example.com \
npm run start:backend
```

Replace the example origin with your domain. For separate backend and Caddy web
development containers, use the repository-root [compose.yaml](../../compose.yaml)
with `docker compose up -d --build`. Published-image deployment is in the
[deployment guide](deployment.md#docker-compose). Set the backend
public origin to the browser-facing address; Compose defaults to `http://localhost:3000`.
Source installations can omit the public origin for local access to the backend port.

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Listener IPv4/IPv6 literal; the container image uses `0.0.0.0`. |
| `ANISHELF_PORT` | `3000` | Decimal integer listener port from 1 to 65535. |
| `ANISHELF_PUBLIC_ORIGIN` | Unset | One allowed external HTTP(S) origin; no wildcards, credentials, path, query or fragment. Local access remains available; Anishelf authentication remains required. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory for Anishelf | Absolute directory; overrides the platform default. |
| `ANISHELF_QBITTORRENT_API_URL` | Unset | Optional HTTP(S) backend address without credentials, query or fragment. Prefills the API account form only when no account is saved; never logs in or saves credentials automatically. Blank means unset. |
| `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL` | Unset | Absolute HTTP(S) browser address without embedded credentials; seeds `qbittorrentWebUiUrl` only when `settings.json` is missing. Blank means unset. No connection probe or API login. |
| `ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE` | Unset | Absolute path to deployment-generated initial credentials; missing files are retried without blocking startup. Saved manual connections/disconnects take precedence. |
| `ANISHELF_INITIAL_RESOURCE_ROOTS` | Unset | One readable absolute media path or up to 64 paths separated by `:`, used only when `settings.json` is missing; existing settings take precedence. |
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
optionally overrides it. It is independent of `ANISHELF_DATA_DIR`.
Logs rotate daily or at 10 MiB, retaining seven archives by default; failed file
output falls back to stderr. In containers, use a persistent path such as
`ANISHELF_LOG_PATH=/data/app/anishelf.log` with `ANISHELF_LOG_DESTINATION=both`,
or read default stdout logs with `docker compose logs -f backend web`.
Invalid startup parameters or unusable data directories fail startup with exit code 1
and a terminal diagnostic. All options are validated before creating the data directory.
The loader creates a missing directory with mode 0700 (subject to umask), preserves
permissions of existing directories, and checks writability. The persistent settings
manager creates `settings.json` on the first settings save, including a transcode
profile selection before a resource directory is configured, or initializes it
on startup when `ANISHELF_INITIAL_RESOURCE_ROOTS` is supplied and the file is missing. See
[Transcode profiles](../examples/transcode-profiles-example.yaml) for the optional administrator-authored
`dataDir/transcode-profiles.yaml`, catalog API and persistent selection.

The optional `settings.json` field `transcodeCacheBudgetGiB` configures the total
prepared-media cache budget in whole GiB (default: 10). It is also editable in
Settings and through `PUT /api/settings`. Saved changes apply to subsequently
started tasks without a restart. Lowering the budget never deletes existing copies;
new output is blocked when retained copies already consume the budget. Active tasks
keep their initial output allowance, and free disk space remains an additional bound.

The optional `settings.json` field `rssRefreshIntervalMinutes` controls normal RSS
polling for all enabled subscriptions (default: 30 minutes; integer range: 1–1440).
Edit it in the RSS section of Settings or through `PUT /api/settings`. An absent
field uses the built-in default; saving the displayed value persists that choice.
The scheduler applies saved changes at its next check (normally every 30 seconds),
measuring the new interval from each feed's last successful check. A shorter interval can make a
feed immediately due. Failed feeds retain their existing retry deadline and
exponential backoff; a successful fetch resumes the configured cadence. Conditional
HTTP requests and manual refresh remain available.

The task monitor initially requests the latest 10 records. Its **More** button
requests the latest 100 records. Both limits are declared in preparation policy;
this display window does not delete task history or cached media.

TOML loading and its parser dependency have been removed. To migrate, unset
`ANISHELF_CONFIG`, set `ANISHELF_DATA_DIR` to the old TOML `dataDir`, and translate
custom listener/logging values to the variables above. The loader rejects a remaining
`ANISHELF_CONFIG` with migration guidance rather than silently selecting a new data
directory. It does not read TOML or relocate existing data.

## Resource Settings and Startup

Settings displays up to 64 paths in a list. Delete removes a draft entry; the input
and Add directory button append a new absolute server path. Save directories
persists the whole draft list; failed saves retain it for retry. It persists
`resourceRoots: string[]`; `[]` means setup mode. Duplicate, nested, symlink-aliased
paths and overlap with dataDir are rejected. Legacy `resourceRoot` string/null
settings load into the array format; the next save writes that format. Existing
settings always win over startup initializers, including an explicitly empty list.
Malformed or unreadable files fail startup without replacement.

For fresh deployments, `ANISHELF_INITIAL_RESOURCE_ROOTS` accepts one absolute path
such as `/media/anime`, or multiple paths separated by colons, such as
`'/media/anime:/media/movies'`. Up to 64 paths are supported. Surrounding whitespace
is trimmed; empty entries (including a trailing separator) are rejected. Paths
containing colons cannot be expressed with this initializer. The former singular
variable and JSON-array input are no longer supported. All initial directories must be readable and separate from the
data directory. Creation never overwrites an existing settings file, including
under concurrent initialization. Without an initializer, setup remains available. Native filesystem monitoring replaces
scheduled scans; obsolete `scanIntervalMinutes` settings are removed on load.
See [Filesystem monitoring](../development/architecture.md#resource-directory-isolation) for incremental updates and recovery.

Scans and resource-setting writes exclude each other. Configuration changes revoke
active access references, remove inactive scopes and remount unchanged entries,
then scan automatically. Reordering paths retains file IDs. An unavailable root
retains its old entries while healthy roots update; all-root failure preserves the
whole previous index. Removing a root hides its resources without deleting accepted
Catalog associations or playback history. Empty configurations do not start a scan.
Manual settings-file changes require restart; Web saves take effect immediately.

Resources registers scoped source identities directly. The database stores the
current relational format only; old database formats are rejected without upgrade
or automatic replacement. Missing media tools do not block direct playback.

## Operational log levels

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


## Database Migrations and Backups

Startup applies committed SQL migrations to dataDir/anishelf.sqlite. Back up before
updating the application; deploy its backend/migrations directory with backend/dist.
A failed database initialization preserves existing files and blocks startup. Do not
replace the database to bypass a migration error. Reverting application images does
not reverse a database migration: restore the matching stopped-instance backup.
SQL generation and schema review belong to the [developer migration guide](../development/README.md#database-migrations).

For a simple backup, stop the server cleanly and copy the complete data directory
before migration or recovery. Do not copy only anishelf.sqlite while it is active:
WAL files may contain committed data. Settings, durable database records and
regenerable subtitle payloads have different lifetimes. Cache cleanup must not
remove history, settings or original media.


## Troubleshooting

- If startup fails, inspect the terminal diagnostic and configured log destination.
  Check directory access, supported database format and media-tool executable paths.
- If files are absent, check each configured resource root and its scan state. A
  failed root keeps previous records; it does not prove its files are accessible.
- If acquisition stalls, use the work's Activity and Diagnostics, then the
  [Watching recovery table](watching-automation.md#recovery-and-upgrade) or
  [Jackett connection diagnostics](jackett-setup.md#external-connection).
- For account recovery, use [password recovery](deployment.md#storage-updates-and-recovery).
  Protect backups containing credentials and keep the database/private files consistent.
- Unsupported browser/media combinations require checking actual file compatibility;
  library discovery or completed downloads alone do not establish playability.

Detailed instrumentation and fixture coverage are developer documentation. The
[verification guide](../development/README.md#verification-and-troubleshooting) distinguishes
local tests from real-service and real-media acceptance.

## Preparation modes

In Settings, choose a preparation mode independently of the output profile.
Compatibility is the default: preparation encodes both video and audio using the
selected profile, without audio-only or video-only transcoding. The profile still
controls the container, codecs, and encoding parameters; compatibility mode does
not guarantee support on every device. Fast preparation preserves streams supported
by the requesting browser when the profile allows it, reducing processing time but
potentially limiting playback on other devices. Already playable originals still
use direct playback. Mode changes apply to new preparation requests; existing tasks
and prepared files remain available and are checked against the playback device.

The choice is saved as `preparationMode` (`compatible` or `fast`) in `settings.json`.
