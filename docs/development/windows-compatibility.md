# Windows Compatibility

[Back to Development](README.md) · [Architecture](architecture.md) · [Future clients](clients.md) · [Configuration](../guide/operations.md)

The backend (`apps/server`) was built for Linux and container deployments. The
desktop application (`apps/desktop`) now bundles that backend and runs it on the
user's machine, so Windows is a supported runtime for the bundled backend. This
document records the Windows compatibility audit of the backend and the Electron
host, the known blockers, and the remediation plan.

This is a **static audit**, not a Windows acceptance record. No Windows machine
was available for the review below; Windows-specific runtime behavior is derived
from Node.js, libuv, Electron and Microsoft documentation and must be confirmed
by the [verification checklist](#windows-verification-checklist) before a
capability is claimed. Each finding carries a confidence label.

Audit baseline: commit `f00eeb2b` (2026-11-14). The desktop icon packaging
defect found during the audit was fixed in that commit and is not repeated here.
The review did not modify repository code.

## Summary

The backend core (HTTP, database, authentication, network clients, media argument
construction and streaming) is largely platform-neutral: the problems are
concentrated in two systemic assumptions.

1. **The root-relative resource path has no canonical format.** The scanner and
   watcher store native separators (`\` on Windows), while identification,
   download ingestion, resource mutation and numbering consume POSIX `/` paths.
2. **POSIX filesystem primitives are used directly.** Directory and read-only
   handle fsync, hard-link publication, POSIX permission modes, retry-less
   rename/remove and process-group termination do not have the same behavior on
   Windows.

As a result, a default Windows setup can start, browse, stream and play, but
automatic anime identification/review, media preparation (transcoding), and
subscription/one-off acquisition are unavailable or fail deterministically.
Packaged Windows builds are also never executed in CI, so even startup is
unverified.

## Confidence labels

| Label | Meaning |
| --- | --- |
| Code | Confirmed by reading the repository; the failure does not depend on undocumented OS behavior |
| Docs | Confirmed against primary documentation (Node.js/libuv/Electron/Microsoft); needs one Windows run for the exact error |
| Win-verify | Behavior depends on the Windows installation, hardware or policy; must be tested on Windows |

## Support matrix

| Capability | Windows status | Notes |
| --- | --- | --- |
| Startup, HTTP API, SQLite, authentication, logging | Usable | Platform directories, loopback binding, SQLite WAL and log rotation are platform-neutral |
| Resource scanning, browsing, playback, subtitles | Mostly usable | Reparse points are skipped; paths longer than `MAX_PATH` fail |
| Anime automatic identification and review | Blocked | Native `\` paths are rejected by the identification boundary |
| Nested resource move and delete | Blocked | The mutation boundary rejects native `\` paths |
| Media preparation (transcoding) publication | Blocked | Publication fsyncs a read-only handle and a directory handle |
| FFmpeg/FFprobe detection and capabilities | Degraded | Works only when the inherited PATH resolves the tools; the desktop app cannot configure a path |
| qBittorrent subscriptions and one-off downloads | Blocked | The download path model is POSIX-only |
| Jackett and RSS discovery | Usable | Network layer has no OS assumptions |
| Packaged desktop application | Unverified | CI builds an installer but never launches it |

## Blockers

### W1 — The root-relative resource path has no canonical format

**Severity:** Blocker · **Confidence:** Code

**Evidence:** The scanner builds relative paths with the platform `join`, so they
contain backslashes on Windows
([scanner.ts:114](../../apps/server/src/modules/resources/library/infrastructure/scanner.ts#L114)).
Resource IDs are SHA-256 hashes of that exact string
([model.ts:73-L82](../../apps/server/src/modules/resources/library/domain/model.ts#L73-L82)).
Consumers instead require POSIX paths:

- the identification boundary rejects any `\` and validates `/` segments
  ([identification.ts:44-L52](../../apps/server/src/modules/anime/identification/application/identification.ts#L44-L52));
- the resource mutation boundary rejects `\`
  ([mutations.ts:20-L31](../../apps/server/src/modules/resources/library/infrastructure/mutations.ts#L20-L31));
- download ingestion joins with `posix.join`
  ([import.ts:41-L44](../../apps/server/src/modules/acquisition/downloads/application/import.ts#L41-L44));
- numbering context groups by `lastIndexOf("/")`
  ([numbering-context.ts:14-L19](../../apps/server/src/modules/anime/identification/domain/numbering-context.ts#L14-L19)).

**Impact:**

- Automatic identification fails for every file in a subdirectory with
  `INVALID_REQUEST`; the run is marked failed and retries forever, leaving the
  catalog and review queue empty. Files directly under a resource root still
  identify because their relative path has no separator.
- Ingestion registers the same file once as `dir/file` (POSIX) and once as
  `dir\file` (native). Resource IDs differ, so the file appears twice and the
  acquisition association is orphaned after the next full scan.
- Move/delete of any nested file or directory is denied; only entries directly
  under a root work.
- Episode grouping across subdirectories is wrong once identification accepts
  native paths.

**Fix:** Define one canonical, platform-independent logical path form (POSIX
`/`) for resource IDs, persistence, contracts and business validation, and
convert only at the filesystem boundary (`join(root, ...rel.split("/"))`). The
scanner and watcher should store the canonical form; resource access and
mutations should accept it and reject only the foreign separator. Because file
IDs hash the path, plan the transition explicitly: normalize stored
`media_sources`/review evidence paths on read, or accept a one-time re-scan and
re-review.

**Verification:** Platform-injected unit tests that run the scanner, mutation,
identification and ingestion paths with `win32` path behavior; one Windows run of
scan → identify → ingest → move → delete on a nested library.

### W2 — Prepared-media publication cannot succeed on Windows

**Severity:** Blocker · **Confidence:** Docs

**Evidence:** Preparation adopts the processed file with `link`, opens it
`O_RDONLY` and fsyncs it, then opens the cache directory and fsyncs that
directory ([files.ts:78-L93](../../apps/server/src/modules/media/artifacts/files.ts#L78-L93)).
On Windows, `FlushFileBuffers` requires a handle with write access and does not
support directory handles; the Unix directory-fsync durability idiom has no
Windows equivalent.

**Impact:** Every preparation task fails after a completed transcode (possibly
hours of work), the artifact is never registered, and orphaned cache files
remain until the next startup. Media preparation is effectively unusable on
Windows. The same publication path is exercised by the repository's real
filesystem tests, so a Windows test run would fail there too.

**Fix:** Introduce a small platform filesystem helper: `syncDirectory()` is a
no-op on `win32`; file durability uses a writable handle (or is skipped where the
cache can be rebuilt); `link` falls back to rename/copy; publication retries on
Windows sharing violations.

**Verification:** Platform-injected test where handle/directory sync rejects with
`EPERM` and publication must still succeed; one Windows end-to-end preparation
run.

### W3 — The acquisition download path model is POSIX-only

**Severity:** Blocker · **Confidence:** Code (qBittorrent echo format: Win-verify)

**Evidence:** Download destinations must start with `/`, must not contain `\`,
and are normalized with `posix`
([paths.ts:5-L30](../../apps/server/src/modules/acquisition/downloads/domain/paths.ts#L5-L30)).
This predicate is used when saving a destination, when validating it against
qBittorrent and when binding a task
([destination.ts:166-L183](../../apps/server/src/modules/acquisition/downloads/application/destination.ts#L166-L183),
[submission.ts:93-L134](../../apps/server/src/modules/acquisition/downloads/transfers/submission.ts#L93-L134)).
qBittorrent reports `temp_path` and `save_path` as filesystem paths
([client.ts:44-L63](../../apps/server/src/modules/acquisition/torrent-clients/qbittorrent/client.ts#L44-L63)),
which on Windows are drive-lettered or UNC paths.

Additionally, `validateDownloadRoot` compares a native `relative()` result with
the POSIX separator
([library.ts:93-L105](../../apps/server/src/modules/resources/library/application/library.ts#L93-L105)),
so a valid sibling directory outside the roots is rejected on Windows.

**Impact:** A Windows user cannot save or validate a download destination, so
`validated` stays false, `authorized()` stays false, and subscriptions and
one-off downloads cannot be enabled. If a destination were migrated from a Linux
deployment, the qBittorrent path echo can never match the expected POSIX string,
so task binding loops on `task_path_changed`. The missing
downloader-path ↔ server-path mapping also affects cross-machine setups that the
current single-path model cannot express.

**Fix:** Introduce a platform-aware absolute download-path codec: accept drive
and UNC paths, normalize separators, compare case-insensitively on Windows, and
send the downloader's native form when calling qBittorrent. Keep torrent-internal
file paths POSIX (they are metadata paths) and convert them to native relative
paths only at the resource boundary. Add an explicit downloader-root ↔
server-root mapping for non-identical namespaces.

**Verification:** Table-driven tests for `C:/`, `C:\`, UNC, case variants and
rejections; one Windows run configuring qBittorrent, validating the destination,
downloading, and ingesting a completed file.

### W4 — Windows builds are never executed or validated

**Severity:** Blocker · **Confidence:** Code

**Evidence:** The only unit-test job runs on Ubuntu
([check.yml:17](../../.github/workflows/check.yml#L17)). The Windows runner builds
the installer and only asserts that exactly one `.exe` exists
([publish-image.yml:67-L140](../../.github/workflows/publish-image.yml#L67-L140)).
Dependency staging is incidental: `prepare-package.mjs` writes production
dependencies into the staged `package.json` but never copies `node_modules`
([prepare-package.mjs:76-L111](../../apps/desktop/prepare-package.mjs#L76-L111)),
relying on electron-builder finding hoisted modules from the workspace root;
missing dependencies are not fatal by default.

**Impact:** A Windows release can ship an installer whose bundled backend cannot
load, and every blocker above remains invisible to CI. The reported "Windows
build" currently establishes packaging, not support.

**Fix:** Add a `windows-latest` check job (type check plus backend and desktop
unit tests, FFmpeg installed), stage production dependencies explicitly, make
missing dependencies fatal, and add a packaged-application smoke test that starts
the backend, calls `/api/health` and exits non-zero on failure.

**Verification:** The new CI job fails when a win32 branch is deliberately
broken and passes on the fixed tree; the smoke test launches the unpacked build.

## High risk

### W5 — The desktop host drops FFmpeg path configuration

**Severity:** High · **Confidence:** Code (PATH inheritance: Docs)

**Evidence:** The bundled backend environment is constructed from scratch and
forwards only `PATH` and `PATHEXT`
([desktop.ts:11-L24](../../apps/server/src/desktop.ts#L11-L24)), so documented
variables such as `ANISHELF_FFMPEG_PATH` are ignored. No desktop setting or UI
exists for media tool paths; the package ships without FFmpeg and the README only
says to install it separately
([README.md:70-L84](../../apps/desktop/README.md#L70-L84)).

**Impact:** A GUI-launched Electron process inherits the environment block
captured at sign-in. Installing FFmpeg with winget/Chocolatey/Scoop or manually
often does not update that block, and an install outside PATH can never be
configured. Probe, preparation and subtitle extraction then fail with a message
that references the "server" and a variable the desktop app discards.

**Fix:** Forward a documented whitelist of user environment variables (at least
the FFmpeg/FFprobe paths and log level) while overriding security-sensitive
deployment values; add a Desktop → Media tools setting with file pickers and a
recheck action; probe well-known install locations as a fallback; expose the
detected path, version and last error.

**Verification:** Desktop unit test of the constructed environment; manual
Windows check with FFmpeg outside PATH.

### W6 — Backend readiness depends on media-tool detection and can miss the desktop timeout

**Severity:** High · **Confidence:** Code (timing: Win-verify)

**Evidence:** Startup awaits FFmpeg/FFprobe detection before listening
([start-backend.ts:55-L78](../../apps/server/src/app/bootstrap/start-backend.ts#L55-L78),
[media-tools.ts:6-L27](../../apps/server/src/app/bootstrap/media-tools.ts#L6-L27)),
detection has a 30-second timeout
([policy.ts:8](../../apps/server/src/platform/media/policy.ts#L8)), and the
desktop gives up after 20 seconds
([local-backend.ts:6](../../apps/desktop/src/main/server/local-backend.ts#L6)).

**Impact:** A slow first run (Defender scanning the unsigned build, a PATH entry
on a disconnected network share, a slow shim) blocks the HTTP listener and the
desktop reports "Local backend startup timed out" although media is optional.

**Fix:** Decouple media detection from readiness (lazy or background), or clamp
the detection timeout below the desktop readiness budget; allow a longer
first-run timeout with one retry; log stage timings.

**Verification:** Slow-spawn fixture asserting readiness is independent of media
detection; cold Windows launch measurements.

### W7 — Media process lifecycle has no Windows tree kill and cleanup has no lock retries

**Severity:** High · **Confidence:** Code (locking: Docs/Win-verify)

**Evidence:** FFmpeg is spawned without a process group or Job Object and stops
via `SIGTERM`/`SIGKILL`
([processing-process.ts:122-L138](../../apps/server/src/platform/media/processing-process.ts#L122-L138));
on Windows both are forced termination of that single process. The desktop kills
only the backend utility process after its shutdown budget
([local-backend.ts:100-L124](../../apps/desktop/src/main/server/local-backend.ts#L100-L124)).
Startup removes the processing cache without retries
([files.ts:27-L37](../../apps/server/src/modules/media/preparation/execution/infrastructure/files.ts#L27-L37)),
preparation initialization failures are swallowed
([create.ts:74-L88](../../apps/server/src/modules/media/preparation/create.ts#L74-L88))
and the rejected initialization promise is memoized
([preparation.ts:97-L105](../../apps/server/src/modules/media/preparation/application/preparation.ts#L97-L105)).

**Impact:** A crashed or force-quit backend can leave `ffmpeg.exe` running; on
Windows the orphan holds the `.pending` file open, so the next startup's cache
cleanup fails with `EBUSY`/`EPERM`. Preparation initialization then rejects for
the whole session — preparation remains unavailable until the app is restarted
again. POSIX is immune because unlinking an open file succeeds.

**Fix:** Track media child PIDs and terminate the tree on shutdown (Job Object on
Windows, process group on POSIX); use `rm` with `maxRetries` and tolerate
per-entry cleanup failures; retry initialization on a later request instead of
caching rejection.

**Verification:** Windows test that holds a cache file open and asserts
initialization still succeeds with a warning; force-kill scenario leaves no
orphaned `ffmpeg.exe`.

### W8 — Atomic-write primitives assume POSIX semantics

**Severity:** High · **Confidence:** Code (Windows locking: Docs/Win-verify)

**Evidence:** Create-only publication uses hard links
([persistent.ts:316-L347](../../apps/server/src/modules/system/configuration/infrastructure/persistent.ts#L316-L347),
[credentials.ts:96-L118](../../apps/server/src/modules/system/authentication/infrastructure/credentials.ts#L96-L118),
[files.ts:78-L95](../../apps/server/src/modules/media/artifacts/files.ts#L78-L95)).
Settings, credentials, cooldown/bootstrap state and artifact publication rename a
temporary file over the target, and library mutations remove files, without
retrying Windows sharing violations.

**Impact:** Hard links require local NTFS (same volume); they fail on exFAT,
FAT32, SMB and some redirected data directories, breaking first-run settings or
credential creation. A rename/remove that races with antivirus, the indexer or
another open handle fails with `EPERM`/`EBUSY`, surfacing as generic save or
write failures. A currently streamed prepared file can also block replacement.

**Fix:** Add `platform/filesystem` helpers: retry rename/remove/link on
`EBUSY`/`EPERM`/`EACCES`/`ENOTEMPTY` with bounded backoff; fall back from hard
links to copy or rename with an exclusive-create fallback for create-only
publication.

**Verification:** Injected one-time `EBUSY`/`EPERM` tests; Windows run with
Defender enabled while toggling settings.

### W9 — Permission modes are a no-op and access checks ignore ACLs

**Severity:** High · **Confidence:** Docs

**Evidence:** Storage rules promise `0o700` directories and `0o600` files
([storage.ts:1-L10](../../apps/server/src/platform/storage.ts#L1-L10)) and are
enforced with `chmod` for credentials, tracker tokens, qBittorrent/Jackett
configuration and prepared artifacts. On Windows `chmod` only toggles the
read-only attribute; `fs.access(R_OK|X_OK)` does not evaluate ACLs.

**Impact:** Credential files are protected only by the inherited ACLs of the
data directory. If the data directory is shared or redirected, the documented
privacy guarantee does not hold — and a root that is unreadable by ACL still
passes the readiness check, so the library silently scans as empty or partially
unreadable.

**Fix:** Document that file modes are POSIX-only; rely on the per-user data
directory ACL on Windows (or apply an explicit ACL if shared data directories are
supported). On Windows, probe readability by opening/creating a file rather than
relying on `access`. Never chmod a path to a non-writable mode on Windows, since
that maps to the read-only attribute and breaks later replacement.

**Verification:** Windows ACL test; unit test that an `access`-visible but
unopenable root reports a root issue.

### W10 — Junctions and cloud placeholders are rejected as symlinks

**Severity:** High · **Confidence:** Docs

**Evidence:** Resource access and the scanner reject any path component whose
`lstat` reports a symbolic link
([access.ts:314-L331](../../apps/server/src/modules/resources/resource-access/infrastructure/access.ts#L314-L331),
[scanner.ts:115](../../apps/server/src/modules/resources/library/infrastructure/scanner.ts#L115)).
libuv maps every Windows reparse point (symlinks, directory junctions, OneDrive
and Dropbox placeholders) to a symbolic-link entry.

**Impact:** A library stored under OneDrive/Dropbox, or containing a junction
that points to another drive, is silently skipped — users see an empty or
incomplete library and downloads placed through such a junction never ingest.

**Fix:** Distinguish real symlinks from other reparse points; allow components
whose `realpath` stays inside the root (the final containment check already
guards escapes), or add a documented policy switch and a distinct scan warning.

**Verification:** Windows-only test with an in-root junction and a cloud-backed
root.

### W11 — Windows logoff and shutdown bypass graceful backend shutdown

**Severity:** High · **Confidence:** Docs

**Evidence:** The main process handles only `before-quit`, `SIGTERM` and `SIGINT`
([index.ts:107-L112](../../apps/desktop/src/main/index.ts#L107-L112)); Electron
documents that `before-quit` is not emitted when Windows shuts down, restarts or
logs off, and Windows-only `session-end`/`query-session-end` window events are
not handled.

**Impact:** On sign-out/restart the backend is terminated with the session:
SQLite WAL is not checkpointed cleanly, buffered file logs are lost, and active
preparation is killed mid-write, leaving cache files for the next startup to
recover. With the tray enabled, a hidden window can make sign-out appear stuck.

**Fix:** Handle `session-end` (and bounded `query-session-end`) to run the normal
close path, including media child termination; keep the existing bounded timeout.

**Verification:** Windows sign-out with a preparation task running; log shows the
graceful stop, no orphan FFmpeg, and the next start opens the database cleanly.

### W12 — Packaged startup failures are undiagnosable

**Severity:** High · **Confidence:** Code (GUI stdio: Docs)

**Evidence:** The backend utility process is forked without captured stdio
([local-backend.ts:26-L30](../../apps/desktop/src/main/server/local-backend.ts#L26-L30)),
startup failures are written to stderr
([backend-process.mjs:37-L41](../../apps/desktop/backend-process.mjs#L37-L41)),
and the user only sees one generic dialog
([application.ts:90-L104](../../apps/desktop/src/main/application.ts#L90-L104)).
A windowed Windows build has no console, and there is no main-process log file.

**Impact:** Missing modules, native-module load failures, unwritable data
directories and migration failures all produce the same message with no path to
diagnose. Support and CI triage become guesswork.

**Fix:** Pipe the child's stdout/stderr into a rotated main-process log, log
startup stages, and show the log path (with an open-folder action) in the error
dialog.

**Verification:** Rename `better-sqlite3` in an unpacked Windows build and
confirm the log records the module error and the dialog exposes the path.

## Medium and low risk

| ID | Severity | Area | Finding | Evidence | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| W13 | Medium | Paths | No long-path handling: paths over `MAX_PATH` (260) fail for scanning, playback and FFmpeg | `join`-built paths throughout; only the download directory name is length-capped | Add `toLongPath()` at filesystem boundaries, cap generated directory names, map `ENAMETOOLONG` to an actionable warning |
| W14 | Medium | Configuration | `ANISHELF_INITIAL_RESOURCE_ROOTS` splits on `:`, so `C:\Media` is unusable | [deployment.ts:73-L84](../../apps/server/src/modules/system/configuration/infrastructure/deployment.ts#L73-L84) | Split by platform delimiter or accept repeated/JSON values; document Windows form |
| W15 | Medium | Configuration | Windows absolute-path validation is too permissive: `\Media`, `\\?\C:\…` and `/data` pass `isAbsolute` and resolve against the current drive | [persistent.ts:114-L129](../../apps/server/src/modules/system/configuration/infrastructure/persistent.ts#L114-L129), [deployment.ts:26-L31](../../apps/server/src/modules/system/configuration/infrastructure/deployment.ts#L26-L31) | Add a strict Windows absolute-path validator (drive letter or UNC; reject device namespaces and root-relative forms) and log resolved values |
| W16 | Medium | Storage | On FAT/exFAT volumes `st_dev`/`st_ino` can be zero or non-unique, weakening source versioning and replacement checks | [access.ts:184-L203](../../apps/server/src/modules/resources/resource-access/infrastructure/access.ts#L184-L203) | When either field is zero, add a cheap content fingerprint to `sourceVersion` and skip the dev/ino equality check |
| W17 | Medium | Acquisition | libtorrent rewrites Windows-illegal and reserved torrent file names, but ingestion looks up the metadata name | [import.ts:41-L44](../../apps/server/src/modules/acquisition/downloads/application/import.ts#L41-L44), `paths.ts` | Resolve the on-disk entry by listing the parent and matching normalized names; reject unsupported names with a clear error |
| W18 | Low | Filesystem | Sidecar subtitle discovery compares names case-sensitively, unlike NTFS | [discovery.ts:54-L58](../../apps/server/src/modules/media/subtitles/infrastructure/discovery.ts#L54-L58) | Compare case-insensitively on Windows |
| W19 | Low | Networking | qBittorrent URLs keep `localhost`, which may resolve to IPv6 while qBittorrent listens on IPv4; self-signed HTTPS and proxies have no configuration | qBittorrent connection setup and transport | Normalize same-host aliases to `127.0.0.1`, support a CA/proxy setting or document `NODE_EXTRA_CA_CERTS` |
| W20 | Low | HTTP | The SPA catch-all decodes the path and passes it to the static plugin, reaching its Windows-absolute branch; malformed escapes return 500 | [static.ts:26-L42](../../apps/server/src/transport/static.ts#L26-L42) | Pass the encoded pathname through, reject backslash/absolute decoded paths, wrap decoding in a 400 |
| W21 | Low | API/UI | Native separators leak into responses and displays, so the same resource shows `dir/file` or `dir\file` by origin | Prepared-media `sourcePath`, library `relativePath` presenters | Project all display paths through the canonical logical form (fixed by W1) |
| W22 | Low | Developer workflow | Documentation commands are POSIX-only: inline `NODE_ENV=…`, `$PWD`, and `npm test` requiring `python3` | [package.json:40](../../package.json#L40), [package.json:45](../../package.json#L45), [apps/server/package.json:9](../../apps/server/package.json#L9) | Use `cross-env` or a Node wrapper, compute paths in Node, and gate the Python installer tests to Linux |
| W23 | Low | Tests | The suite encodes POSIX assumptions: `/tmp` literals, `0o600` assertions, privileged symlinks, and a test that asserts `C:\` download paths are rejected | `apps/server/test/**` | Add platform-injected path tests, use junctions where the intent is a link, guard mode assertions, and update the assertion together with W3 |
| W24 | Low | Documentation | Support status contradict implementation: requirements C07 says the desktop app is not started, the future-clients design still describes a separately running server, deployment docs are Linux-only | [requirements.md:211](../requirements.md#L211), [clients.md:1-L4](clients.md#L1-L4), [clients.md:87-L94](clients.md#L87-L94) | Update the requirements status, describe the bundled backend, and link this document from the relevant indexes |
| W25 | Low | Operations | No Windows installation/operations guidance: SmartScreen for unsigned installers, profile and log paths, uninstall/data retention, startup entry cleanup; no headless backend path for Windows (the installer refuses non-Linux) | [README.md:70-L84](../../apps/desktop/README.md#L70-L84), installer runtime | Add a Windows section to the desktop guide and state the supported deployment model explicitly |
| W26 | Low | Desktop integration | Windows-only integration is unverified: launch-at-login reports enabled after Windows Startup Apps disables it, built-in player presets are PATH-only (VLC/PotPlayer installers usually are not), no `setAppUserModelId`, all-platform SQLite prebuilds are packaged | `login-item.ts`, `player-presets.ts`, `prepare-package.mjs` | Read `executableWillLaunchAtLogin`, resolve presets from App Paths/install dirs, set the AppUserModelID, prune non-target prebuilds |
| W27 | Low | Diagnostics | Media-tool status, searched PATH and last detection error are not exposed over HTTP/UI; messages reference a "server" in a bundled app | `tool-discovery.ts`, client locale strings | Add a read-only diagnostics endpoint and a Settings → Media tools section with a recheck action |

## Cross-platform foundations

The following were checked and need no redesign; keep them working while fixing
the findings.

- **HTTP security:** Host/Origin validation, loopback detection (including
  `[::1]` and IPv4-mapped addresses), desktop CORS and device-token authentication
  are URL-based and OS-neutral.
- **Database:** SQLite WAL, `busy_timeout`, migrations and the in-memory test
  database work on Windows; only non-local data directories are a risk.
- **Logging:** structured Pino output and the rotating file stream (close before
  rename) are portable; only the Pino file mode is a no-op.
- **Resource path validation:** configuration roots use the platform
  `isAbsolute`; containment uses `relative()` (case-insensitive on Windows), and
  the scanner/index consistently use `join`/`dirname`/`basename`.
- **Media tool arguments:** FFmpeg receives an argv array without a shell;
  progress and probe JSON parsing tolerate line endings; `windowsHide` is set;
  range streaming uses file handles and manual headers.
- **Configuration directories:** `platformdirs` resolves the per-user data and
  log directories on Windows; the desktop profile and backend data/log paths are
  user-writable without elevation.
- **Loopback networking:** binding `127.0.0.1` and an ephemeral port does not
  prompt Windows Firewall; no inbound rule is required.
- **Desktop mechanics:** ESM main process, asar, `utilityProcess` argv/IPC,
  better-sqlite3 Node-API prebuilds, migration and build-info paths and the
  single-instance/normal-quit flow are platform-neutral (mechanisms validated on
  macOS in the same Electron/Node versions).
- **External players:** spawning is shell-free with explicit argv; Windows
  executables are validated as `.exe`/`.com`.
- **Desktop platform adapters:** tray, window state, update asset naming and the
  platform-specific branches already exist; the gap is verification, not absent
  implementation.

## Remediation plan

| Order | Work | Fixes | Verification |
| --- | --- | --- | --- |
| 1 | Canonical logical resource paths: internal POSIX form, boundary conversion, stored-path normalization | W1, W21; enables W17/W18 fixes | win32-injected scan/identify/ingest/mutate tests; Windows library walkthrough |
| 2 | `platform/filesystem` helpers: sync directory, durable file publish, retrying rename/remove, hard-link fallback | W2, W8, part of W9 | Injected `EPERM`/`EBUSY` tests; Windows preparation and settings runs |
| 3 | Platform-aware download path codec and downloader↔server path mapping | W3, part of W14 | Path table tests; Windows qBittorrent round trip |
| 4 | Desktop host hardening: environment whitelist, media-tool settings and diagnostics, process-tree termination, `session-end`, main log, startup timeout | W5, W6, W7, W11, W12, W27 | Desktop unit tests; Windows crash/logoff/force-kill scenarios |
| 5 | Windows CI: type check, backend and desktop unit tests with FFmpeg, explicit dependency staging, packaged-app smoke test | W4, W22, W23 | New job green; smoke test fails on a deliberately broken build |
| 6 | Documentation and status: requirements, clients design, Windows install/operations guide, launch-at-login and preset behavior | W24, W25, W26 | Docs review against the implemented behavior |

Steps 1–3 unlock the functional blockers and should land before Windows is
announced as supported. Step 5 is required to keep it supported; add it with the
first fix rather than after.

## Windows verification checklist

Run these on a clean Windows 11 machine or VM with the current release
candidate. Record the build, version and date with the results.

1. Install the unsigned `.exe` (document the SmartScreen step), launch, and
   confirm `desktop.backend_ready` in the backend log.
2. Add a media root with a nested directory, scan, and confirm the review queue
   receives entries (currently expected to stay empty — W1).
3. Move and delete a nested resource from the UI (currently expected to be
   denied — W1).
4. Install FFmpeg in a non-PATH location, confirm detection fails, then point the
   app at it through the new setting (W5).
5. Prepare one small file with the default profile; confirm a ready artifact and
   that a restart keeps it (W2).
6. Configure a same-machine qBittorrent, save and validate the destination,
   download one episode and confirm ingestion (W3).
7. Inspect the installed `app.asar` for backend production dependencies and the
   unpacked better-sqlite3 binary.
8. Kill the backend utility process from Task Manager, then confirm restart,
   logs and no orphan `ffmpeg.exe`.
9. With the tray enabled and a preparation task running, sign out of Windows;
   confirm graceful stop, no shutdown prompt and a clean next start (W11).
10. Verify loopback-only listening (`netstat`), no firewall rule, launch-at-login
    after Windows disables it in Startup Apps, VLC/PotPlayer preset detection,
    and the external-player command line token exposure.

## Reporting status

The status matrix above describes the audited baseline. When a finding is fixed,
change its severity in this document to `Fixed` (with the commit) and update the
[verification checklist](#windows-verification-checklist) with the Windows
evidence. A capability is only "supported on Windows" after it has passed on
Windows hardware and has a regression test in a Windows CI job.
