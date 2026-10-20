# qBittorrent adapter

The server-side adapter and manual connection settings are the first automatic-acquisition
code foundation. It uses `@ctrl/qbittorrent` behind an Acquisition-owned interface;
SDK types and response bodies do not become browser or workflow contracts.
The protocol baseline is qBittorrent 5.x with WebAPI v2, based on the
[official API documentation](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29).
The local contract fixture identifies itself as 5.0.5 / 2.11.4. Other major
versions are rejected. Real-instance compatibility has not been certified.

## Construction and capabilities

`backend/src/modules/acquisition/create.ts` exposes `createQbittorrentClient()`.
Pass a server-reachable HTTP(S) base URL, username, password and logger. A reverse
proxy prefix is supported, for example `http://downloader/qbt/`. URLs containing
credentials, query strings or fragments are rejected. Credentials remain in memory;
this layer does not persist configuration or read the browser's `qbittorrentWebUiUrl`.
The caller owns the instance and must await `close()` during shutdown or replacement.

The returned interface provides:

- `probe()`: authenticated application/API versions, default save path and incomplete
  directory preferences. These are observations, not proof of shared storage.
- `tasks()` and `task(hash)`: validated full snapshots and explicit lookup, including
  hashes, raw transfer state, progress, size, speed, paths, category and tags.
- `files(hash)`: validated file indexes, downloader-relative paths, sizes, priorities
  and completion fractions. These paths are untrusted and are not local file access.
- `add()`: one v1-compatible Magnet or at most 10 MiB of supplied torrent bytes,
  with explicit save path, category, tags and initial paused state. Automatic torrent
  management is disabled so it cannot silently override the requested save path.
- `pause()`, `resume()`, `recheck()` and `remove()`: single-hash operations.
  `remove()` always sends `deleteFiles=false`; destructive data deletion is not exposed.

Hashes must be individual hexadecimal v1/v2 identifiers; `all`, hash lists and
wildcards are rejected. The adapter itself does not resolve canonical torrent identity. The acquisition
worker parses torrent bytes, reserves identities and reconciles by hash before
binding an accepted request to a durable intent.

## Transport, failures and lifecycle

The SDK owns cookie authentication, session renewal after explicit authentication
rejection, multipart encoding and 5.x command names. Initial login is shared by
concurrent callers. There are no transport retries after ambiguous failures;
the SDK permits one reauthentication/replay after a 401/403 rejection.
The selected SDK sends HTTP Basic credentials alongside its SID cookie on API
requests. Base64 encoding does not encrypt credentials; the configured endpoint's
transport determines network confidentiality.

## Manual account settings

Settings now contains API URL, Username and Password fields. Users enter their
own qBittorrent account credentials; these are independent from Anishelf login.
For Compose, use `http://qbittorrent:8080` as the backend-reachable API URL and
keep the browser WebUI URL separately configured. The address field accepts the
base URL, not an `/api/v2` suffix. Saving does not contact the downloader or start
any tasks. **Test connection** explicitly tests the saved account and reports
authentication, unsupported-version and connectivity failures.

The application bootstrap registers Acquisition and its authenticated,
CSRF-protected `/api/acquisition/qbittorrent` GET/PUT/DELETE and `/check` POST
routes. Public responses include URL, username, generation and a
`passwordConfigured` flag; passwords are never returned. Passwords are not stored
in ordinary settings, browser query caches or mutation variables. The password
input is cleared after save. Omitting it or submitting an empty value preserves
the saved password only when URL and username are unchanged. Changing either
requires a new password. **Remove API connection** removes saved credentials
without deleting downloader tasks or media.

Acquisition stores the recoverable plaintext password in
`ANISHELF_DATA_DIR/acquisition/qbittorrent.json` (Compose:
`/data/app/acquisition/qbittorrent.json`), with directory mode `0700` and file
mode `0600`. These permissions are not encryption; protect the application volume
and backups. Writes use a temporary file, fsync and atomic rename. Restart reloads
the account without a network call. Malformed private configuration reports an
unavailable state and can be replaced without blocking local playback.

Updates and removal require the displayed configuration generation. Successful
changes replace the generation and abort active checks; old check results cannot
be published against a new account. Closing Acquisition aborts checks before other
modules and persistence close. The connection layer does not submit downloads.
The separate [RSS discovery worker](rss-subscriptions.md) reads task snapshots for
duplicate exclusion when an account is configured.

Undici supplies connection pooling and response-size enforcement. The wrapper adds
an operation deadline (30 seconds by default), caller cancellation, shutdown abort,
endpoint confinement, redirect rejection and a 5 MiB default response limit.
It requests identity encoding and rejects compressed responses to keep the size
bound enforceable. Limits are constructor overrides, not new user settings.
`close()` aborts and drains pending operations, destroys connections and clears
the local SDK session. It does not revoke the server session with a logout request.

`QbittorrentError` contains a stable code and an outcome:

| Outcome | Meaning |
| --- | --- |
| `read` | Observation failed; it must not become an empty or missing-task snapshot. |
| `not-sent` | No mutation was dispatched, for example invalid input or failed initial login. |
| `rejected` | An explicit authentication/client rejection or recognized negative add receipt. |
| `unknown` | A dispatched mutation has an uncertain outcome; reconcile before any resend. |

A successful command is an API receipt, not verified remote state. qBittorrent
can silently ignore unknown hashes. A successful add is not a durable task binding,
and transfer completion does not establish file access, ingestion or playability.
The adapter logs only operation names and sanitized failure codes/outcomes; URLs,
passwords, cookies, Magnet links, response bodies and original SDK errors are excluded.

## Validation and remaining work

`backend/test/qbittorrent-client.test.ts` runs the actual SDK against a local HTTP fixture.
It covers authentication, prefix preservation, snapshots and files, multipart
requests, safe removal, rejected and uncertain commands, cancellation, shutdown,
timeouts, response limits, redirects, malformed responses and log redaction.
Run it in an environment permitting localhost listeners.

`backend/test/qbittorrent-connection.test.ts` and Web connection tests cover manual
save/retention/removal, private permissions, restart, failed writes, generation
conflicts, stale checks, authentication/CSRF, redaction and password input/cache behavior.

The [current workflow](current-architecture.md) implements destination validation,
durable intent/reservations, restart reconciliation, compact per-work observations
and verified ingestion. Settings selects one resource root and corresponding
qBittorrent completed path; each anime gets a stable subdirectory. The download
worker uses the adapter's add/read capabilities. Pause/resume/removal/data deletion
remain in WebUI, with external removals suppressed until explicit retry in Anishelf.
Real qBittorrent compatibility, real torrent downloads and ACQ01–ACQ11 acceptance
remain unverified by local contract fixtures.


The optional deployment API URL hint prefills the form without creating an
account. Saved account settings override it. Compose uses an optional downloader
profile and isolated application/media/config/incomplete storage; see
[deployment configuration](deployment.md#configure-and-start). The browser WebUI
link remains separate and defaults to blank.
