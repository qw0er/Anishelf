# Configuration and Operations

[Deploy, maintain, update or uninstall](deployment.md) · [First use](README.md#first-use)

## Deployment configuration

| Configuration | Where | Takes effect |
| --- | --- | --- |
| Container images, ports, mounts | Compose `.env`/YAML or installed Quadlet units | Recreate containers / reload and restart Quadlet |
| Backend startup options | Environment variables below | Backend restart |
| Media roots, preparation mode/cache, subscription defaults | Anishelf Settings | On save; active tasks retain their initial limits |
| Custom acquisition/transcode profiles | YAML in the app data directory | Backend restart |

Containers use `/data/app` for state and `/data/media` for initial media. Source
installations default to the OS user data directory; set `ANISHELF_DATA_DIR` to keep
an existing location. Paths must be absolute. Existing `settings.json` takes
precedence over initializers; malformed settings block startup without replacement.

### Environment variables

Compose's host `ANISHELF_PORT` controls Web publication; Backend's environment
variable of the same name controls its own listener. Use the canonical deployment
templates for container wiring.

| Variable | Backend default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` / `ANISHELF_PORT` | `127.0.0.1` / `3000` | Listener; image uses `0.0.0.0` |
| `ANISHELF_PUBLIC_ORIGIN` | Unset | Optional fixed external HTTP(S) address; standard HTTPS proxy mode; passed to both Web and Backend |
| `ANISHELF_ALLOWED_HOSTS` | Unset | Optional Backend exact hostname/IP allowlist, comma-separated, without ports or wildcards; blank accepts any valid Host |
| `ANISHELF_WEB_TRUSTED_PROXIES` | `127.0.0.1/32 ::1/128` | Advanced automatic/multi-origin HTTPS or original client IP: Web external proxy IPs/CIDRs, space-separated; use the source address seen by Web |
| `ANISHELF_TRUSTED_PROXIES` | `loopback` | Trusted proxy IPs/CIDRs; packaged containers also trust `uniquelocal` |
| `ANISHELF_DATA_DIR` | OS user data directory | Persistent app state |
| `ANISHELF_INITIAL_RESOURCE_ROOTS` | Unset | Up to 64 colon-separated media paths; initializes missing settings only |
| `ANISHELF_QBITTORRENT_API_URL` | Unset | API form hint; does not save credentials or connect |
| `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL` | Unset | Browser WebUI link for missing settings only |
| `ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE` | Unset | Initial deployment credentials; manual connection/disconnect takes precedence |
| `ANISHELF_BUNDLED_JACKETT_CONFIG_FILE` | Unset | Read-only native Jackett config for bundled connection import |
| `ANISHELF_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` |
| `ANISHELF_LOG_DESTINATION` | `stdout` | `stdout`, `file`, `both` |
| `ANISHELF_LOG_PATH` | OS user log directory + `anishelf.log` | Absolute override for file/both output |
| `ANISHELF_LOG_MAX_SIZE_BYTES` | `10485760` | File rotation size (10 MiB) |
| `ANISHELF_LOG_MAX_FILES` | `7` | Retained archives, excluding the active file |
| `ANISHELF_LOG_ROTATE_INTERVAL` | `1d` | `1h` or `1d` |
| `ANISHELF_FFMPEG_PATH` / `ANISHELF_FFPROBE_PATH` | Executables from PATH | Optional absolute executable paths |
| `ANISHELF_FRONTEND_DIR` | Unset | Enable Node hosting of a build containing `index.html` |
| `ANISHELF_API_TARGET` | `http://127.0.0.1:3000` | Vite development proxy target |
| `NODE_ENV` | Unset | `development` enables local Vite Origin exceptions |

Invalid startup options fail with a terminal diagnostic. Log path/rotation options
require file/both output. Legacy TOML is no longer read: unset `ANISHELF_CONFIG`,
keep its former data directory through `ANISHELF_DATA_DIR`, and translate listener/log
options to environment variables.

## Resource settings and startup

In **Settings**, add absolute paths visible **inside Backend**, then save directories.
Container mounts and Settings must refer to the same files.

| Action / condition | Result |
| --- | --- |
| Save roots | Validate, persist and scan automatically; later changes use filesystem monitoring |
| Empty list | Setup mode; no scan |
| Duplicate, nested or symlink-aliased roots | Rejected, as is overlap with app data |
| Add a container media root | Mount it read-only first, then add its container path in Settings |
| Root unavailable | Preserve its previous index; healthy roots still update |
| Remove a root | Hide its resources; preserve associations/history and original files |
| Files missing after mount/network changes | Check access and run a manual scan to reconcile |

Startup `ANISHELF_INITIAL_RESOURCE_ROOTS=/media/anime:/media/movies` only seeds
missing settings. Use Settings for later edits; direct settings-file edits require
restart. Network filesystems need deployment-specific watcher checks. See
[monitoring architecture](../development/architecture.md#resource-directory-isolation).

## Preparation modes

| Setting | Behavior |
| --- | --- |
| Compatibility (default) | Encode both video and audio using the selected profile |
| Fast | Preserve browser-supported streams when the profile allows it |
| Cache budget | Default 10 GiB; limits new output, without deleting existing copies when lowered |
| Output profile | Built-in or [custom transcode YAML](../examples/transcode-profiles-example.yaml) |

Playable originals use direct playback. Mode/profile changes affect new requests;
existing copies remain available and are checked against the playback device.
Compatibility mode still depends on the device's actual codec support.

## Subscription settings

| Setting | Behavior |
| --- | --- |
| Source refresh interval | Default 30 minutes; range 1–1440; applies on the next scheduler check |
| Failed-source retries | Keep their backoff deadline when the interval changes |
| Default selection profile | Global choice with optional per-subscription override |
| Watching creation | Optional, default off; creates ordinary subscriptions |

Use [Jackett setup](jackett-setup.md), [subscription controls](watching-automation.md)
and [selection profiles](acquisition-profiles.md) for these workflows.

## Operational log levels

| Level | Use |
| --- | --- |
| `info` | Startup, login/account lifecycle, saved settings, scans and task completion |
| `warn` / `error` | Authorization, storage, provider, tool and task failures |
| `debug` | Workflow decisions, cache reuse and media-tool lifecycle |
| `trace` | Requests, polling, progress and Range delivery |

Read container logs with the [maintenance commands](deployment.md#maintenance).
For persistent file logs, set `ANISHELF_LOG_DESTINATION=both` and
`ANISHELF_LOG_PATH=/data/app/anishelf.log`. Default rotation is daily or at 10 MiB,
with seven archives. File-output failures emit stderr diagnostics.

Use request IDs and event names to correlate failures. Do not share initial-password
log lines, credentials, session cookies or CSRF tokens in reports.

## Database migrations and backups

Startup migrates `<dataDir>/anishelf.sqlite`. A failure preserves data and blocks
startup. Stop the stack and back up the **complete** app data plus optional service
state before upgrading. Active SQLite WAL files may contain committed data; copying
only the database is insufficient. Protect credential backups and preserve ownership.

[Deployment storage/recovery](deployment.md#backup-and-recovery) lists volumes
and password reset commands. Restore matching app/database versions for rollback;
reverting an image alone does not undo migrations.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Startup fails | Read Backend diagnostic; check data permissions, migrations and executable paths |
| Login fails behind HTTPS | Standard mode: match `PUBLIC_ORIGIN` in Web/Backend; automatic mode: verify Web external proxy trust; Backend must trust the private Web hop |
| Access address rejected | Check explicit `ANISHELF_ALLOWED_HOSTS`; domains/IPs work automatically when unset; `http.host_rejected` identifies this check |
| Request origin rejected | Match the browser address and trusted protocol; inspect proxy configuration and `http.origin_rejected` |
| Forgotten Anishelf password | Use [password recovery](deployment.md#maintenance), then restart Backend |
| Files absent | Check mounted paths, Settings roots, access and scan state |
| Acquisition stalled | Open work Activity/Diagnostics; use the [recovery table](watching-automation.md#recovery-and-upgrade) |
| Jackett lists sites but finds no releases | Run title-search diagnostics; connection/capability checks alone do not prove results |
| Download complete but unavailable | Check shared destination mapping and import/Review outcome |
| Playback fails | Check actual browser/codecs and preparation output; discovery does not establish playability |
