# Sources Boundary and Lifecycle

Date: 2026-10-23. Sources hides RSS and Jackett behind one source configuration and
ID-based source API. Protocol-specific configuration exists at
setup; business consumers do not construct protocol references or clients.

## Construction and API

`createSourcesModule` is the production construction entry. It owns configuration
files, Jackett connection/client/transport, RSS transport/parser, request gate,
HTTP presentation, error translation and shutdown. It returns one `api` object,
one internal `runtime` object and HTTP registration. Adapter implementations never escape.

Subscriptions and Downloads share the same `SourcesApi`; there are no separate
catalog, collection, content or management facades. Consumers call the operations
needed for their responsibilities through that single interface.

| SourcesApi operation | Purpose |
| --- | --- |
| snapshot(input or sourceId) | Read saved evidence, or describe a definition as pending without network/persistence |
| fetch(input or sourceId) | Prepare evidence and return snapshot/commit for atomic candidate publication |
| readContent(reference, signal) | Read magnet content or torrent bytes |
| isContentCurrent(reference) | Check a download reference before submission |
| test(input or sourceId) | Diagnose a source without publishing results |
| connector.settings/save/clear/providers/probe | Configure and inspect the source connector |

`SourcePublication` is part of `public.ts` alongside `SourcesApi`. Its synchronous
commit preserves the transaction shared by source evidence and subscription candidates.
It does not require a separate collection facade. Runtime start/close remains in
`sources/integration.ts` and is owned by Acquisition composition. Private adapter
plans, validators, raw locators and client classes remain hidden.

## File organization

The module root contains only `public.ts`, `create.ts`, `persistence.ts` and
`integration.ts`. Public configuration and connector types live in `public.ts`.
`application/` contains collection orchestration, context, scheduling and download
content resolution (`content.ts`). `domain/` contains models, collection limits and
the private prepared-read contract. `infrastructure/` contains persistence contracts,
repositories and the shared request gate. RSS and Jackett adapters remain private
in their respective directories. Moving these files does not change runtime behavior,
HTTP contracts, database tables or existing structured lifecycle logs.

## Source configuration

SourceInput is either `{kind: "feed", url}` or `{kind: "search", connectionRevision,
providerId, titles}`. These describe collection modes. RSS normalization and Jackett
query planning are private adapter work; consumer code passes setup data through
without branching on a protocol. Fetch accepts a definition directly and internally
identifies or creates the cache/backoff record; no registration call is required.
An existing source ID may also be reused. Snapshot accepts either form; a definition
with no saved evidence returns a pending snapshot without network or database writes.

The subscription form still enters an RSS URL but sends `source: {kind: "feed",url}`
in the shared subscription-save contract. Subscriptions stores that definition in
`source_input` alongside its stable evidence identity. Empty input on edits retains
the saved definition. Saving a subscription and permission is local and does not
create a Sources record. Refresh passes the saved definition directly to fetch.
The contract accepts search definitions; search subscription UI, Watching reconciliation
and automatic source selection remain pending.

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

fetch(input or sourceId) resolves the definition internally and returns a SourcePublication
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
bindings use the existing typed snapshot. This adapter is private. Migration 0007 stores source definitions on subscriptions and removes the source-row
foreign key. Existing RSS/search bindings backfill those definitions. Evidence and
accepted download references remain unchanged.

## Ownership, scheduling and shutdown

Acquisition supplies enabled subscription IDs and a subscription refresh operation
to the internal runtime. The scheduler ticks initially and every 30 seconds.
Successful refresh follows the configured interval (30 minutes by default); failure
backoff is capped at one hour and respects upstream retry hints. Live interval changes
reschedule successful evidence while preserving failure deadlines.

A source is collected only while a subscription owns it. There is no independent
recurring register/enable/remove feature. Pause/removal does not erase source evidence
or accepted download references. The legacy enabled column is retained but does not
drive scheduling. A changed connector generation suspends old bindings.

Downloads stops before Sources. Source shutdown aborts/drains collections, transport
and content reads before SQLite closes. Runtime methods do not escape through the
business API.

## Download content

ReleaseEvidence contains common attributes and an opaque nullable download reference.
readContent returns only magnet content or torrent bytes. Private locator
records survive later result snapshots; arbitrary URL inputs and unpublished references
are rejected. Legacy accepted RSS references remain resolvable. Both protocols use
the same content interface, with source/connection validity checked before and after
reads. Downloads rechecks immediately before submission and owns canonical hash/path
validation and reservation. Submitted tasks reconcile without a live source service.

## HTTP surface

| Route | Meaning |
| --- | --- |
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

Both feed and search tests exercise direct fetch without registration and the same commit/content
contract, temporary diagnostics, failure ownership, transaction rollback and stale
connection rejection. Adapter fixtures retain HTTP/XML/credential/path coverage.
Integration tests cover source settings authentication/CSRF, common HTTP setup,
subscription saves/refresh, reservations, reopen/upgrade, coalescing and shutdown.
These fixtures do not establish real tracker/downloader/shared-storage/browser playback
acceptance. Retention/garbage collection of inactive evidence remains separate work.


## Stage 3 service setup

[Jackett setup](jackett-setup.md) adds external connector settings, an optional
management link, ordered enabled providers, separate connection/capability/search
diagnostics and optional Compose/Quadlet deployment. A background worker reads the
native Jackett config volume read-only, imports private credentials and initializes
the default site only after observing native config creation. Existing installations
require manual site setup. Credentials are imported only before any connector configuration has been saved;
explicit disconnects are retained. `connector.useBundled(generation)` and
`POST /api/acquisition/sources/connector/bundled` provide explicit re-selection.
The Sources consumer API and evidence/publication/content boundaries are unchanged.
