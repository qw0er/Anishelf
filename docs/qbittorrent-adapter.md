# qBittorrent adapter

The standalone server-side adapter is the first automatic-acquisition code
foundation. It uses `@ctrl/qbittorrent` behind an Acquisition-owned interface;
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
wildcards are rejected. Submission does not resolve or verify canonical torrent
identity: the future workflow must parse torrent bytes, reserve identities and
reconcile by hash before binding an accepted request to an intent.

## Transport, failures and lifecycle

The SDK owns cookie authentication, session renewal after explicit authentication
rejection, multipart encoding and 5.x command names. Initial login is shared by
concurrent callers. There are no transport retries after ambiguous failures;
the SDK permits one reauthentication/replay after a 401/403 rejection.

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

No adapter is instantiated by application bootstrap yet. Credential settings,
path mapping/probes, durable intent and command storage, reconciliation workers,
RSS/subscriptions, HTTP/UI controls and verified ingestion remain future work.
No live qBittorrent, real torrent download or complete ACQ acceptance was run for
this foundation. D01–D07 are not complete.
