# Sources Boundary and Lifecycle

Date: 2026-10-23. Sources hides RSS and Jackett behind one source configuration and
ID-based evidence/content capabilities. Protocol-specific configuration exists at
setup; business consumers do not construct protocol references or clients.

## Construction and capabilities

`createSourcesModule` is the production construction entry. It owns configuration
files, Jackett connection/client/transport, RSS transport/parser, request gate,
HTTP presentation, error translation and shutdown. Acquisition wires only the
returned capabilities; no adapter implementations or parsing functions escape.

| Capability | Consumer | Operations |
| --- | --- | --- |
| catalog | Subscriptions | configure(input), snapshot(sourceId) |
| content | Downloads | read(downloadReference, signal), isCurrent(downloadReference) |
| collection | Subscription refresh integration | collect(sourceId), returning a prepared publication |
| runtime | Acquisition composition | start(activeIds, poll), close() |
| management | Authenticated source setup | catalog operations, test(input or sourceId), connector settings/providers/probe |

The catalog and content contracts contain no adapter plans, validators, raw locators,
request gates, failed/publish/start/close methods or client classes. The narrowly
scoped transaction integration is in `sources/integration.ts`, outside the business
API. Only explicit module entries may be imported across this boundary.

## Source configuration

SourceInput is either `{kind: "feed", url}` or `{kind: "search", connectionRevision,
providerId, titles}`. These describe collection modes. RSS normalization and Jackett
query planning are private adapter work; consumer code passes setup data through
without branching on a protocol. configure validates and durably binds the source
without a network request, and returns its ID. Reusing the same definition retains
its stable ID. An initial snapshot has null checkedAt and empty entries.

The subscription form still enters an RSS URL but sends `source: {kind: "feed",url}`
in the shared subscription-save contract. Empty source input on edits is null and
retains the current binding. Saving a source alone grants no download permission.
The subscription transaction includes configure, subscription and accepted permission.
The external contract also accepts a configured search definition, but a search
subscription UI, Watching reconciliation and automatic source selection remain pending.

Connector configuration exposes service URL, credentials, connection generation and
selected provider IDs only at the setup interface. Transport authentication, request
syntax, capabilities pagination limits and download descriptors remain private. The
current connector is implemented using Jackett. Changing it fences old search source
bindings and download references rather than silently inheriting new credentials.

## Evidence and publication

snapshot(sourceId) performs no network request. The common collector coalesces
in-flight requests by source ID and permits at most two source collections. It owns
one result-provenance/revision fence. RSS and Jackett adapters return private prepared
writes and connection validity, rather than maintaining separate consumer-facing
publication lifecycles. FeedReader retains RSS parsing/conditional-response/retention
behavior; JackettSource retains query planning and Torznab result handling.

collect(sourceId) resolves the binding internally and returns a SourcePublication
containing a read-only snapshot and a synchronous commit(writeCandidates) operation.
Temporary results and diagnostic tests do not publish evidence or resolve their
unpublished downloads. Commit rechecks source validity, then publishes evidence,
durable download references and candidate writes in the same SQLite transaction.
A stale result or candidate write failure rolls everything back.

Subscriptions evaluates outside the transaction, then uses commit to check its own
subscription/reservation inputs and save its candidates. It neither manages
source publication internals nor calls a source failed/backoff method. Sources
records collection failures itself, only against the captured matching revision,
retaining earlier evidence and retry metadata. Shutdown and generation conflicts
cannot overwrite newer successful evidence. Subscription assessment errors remain
owned by Subscriptions.

The existing protocol storage is normalized by SourceEvidence: RSS validators and
observations remain in their relational tables, while query evidence and unchecked
bindings use the existing typed snapshot. This adapter is private. Physical table
layouts and migrations are unchanged; no second task/subscription database is added.

## Ownership, scheduling and shutdown

Acquisition supplies enabled subscription IDs and a subscription refresh operation
to the separate runtime capability. The scheduler ticks initially and every 30 seconds.
Successful refresh follows the configured interval (30 minutes by default); failure
backoff is capped at one hour and respects upstream retry hints. Live interval changes
reschedule successful evidence while preserving failure deadlines.

A source is collected only while a subscription owns it. There is no independent
recurring register/enable/remove feature. Pause/removal does not erase source evidence
or accepted download references. The legacy enabled column is retained but does not
drive scheduling. A changed connector generation suspends old bindings.

Downloads stops before Sources. Source shutdown aborts/drains collections, transport
and content reads before SQLite closes. Runtime methods do not escape through the
catalog/content/business management interfaces.

## Download content

ReleaseEvidence contains common attributes and an opaque nullable download reference.
The content capability returns only magnet content or torrent bytes. Private locator
records survive later result snapshots; arbitrary URL inputs and unpublished references
are rejected. Legacy accepted RSS references remain resolvable. Both protocols use
the same content interface, with source/connection validity checked before and after
reads. Downloads rechecks immediately before submission and owns canonical hash/path
validation and reservation. Submitted tasks reconcile without a live source service.

## HTTP surface

| Route | Meaning |
| --- | --- |
| POST /api/acquisition/sources | Configure either collection mode and return its source ID |
| GET /api/acquisition/sources/:id | Read saved evidence |
| POST /api/acquisition/sources/test | Test a definition or `{sourceId}` without publication/permission |
| GET/PUT/DELETE /api/acquisition/sources/connector | Read/update/clear connector configuration |
| POST /api/acquisition/sources/connector/providers | List configured service providers |
| POST /api/acquisition/sources/connector/probe | Check provider search support; not proof of a live search |

There are no separate RSS/Jackett business HTTP routes. Settings require authentication
and mutations require CSRF. Responses/logs exclude API keys, raw download addresses,
validators and torrent payloads. Diagnostic test responses expose download availability,
not private content references. Source configuration fields are accepted only at setup.

## Verification

Both feed and search tests exercise the same ID-based configure/collect/commit/content
contract, temporary diagnostics, failure ownership, transaction rollback and stale
connection rejection. Adapter fixtures retain HTTP/XML/credential/path coverage.
Integration tests cover source settings authentication/CSRF, common HTTP setup,
subscription saves/refresh, reservations, reopen/upgrade, coalescing and shutdown.
These fixtures do not establish real tracker/downloader/shared-storage/browser playback
acceptance. Retention/garbage collection of inactive evidence remains separate work.
