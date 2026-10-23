# Shared Sources contract

Date: 2026-10-23.

Discovery, subscription management and Downloads consume protocol-neutral source
references, evidence and download references. RSS and Jackett configuration remains
specific to their adapters at the composition/configuration boundary. Consumers do
not receive URLs, credentials, indexer plans or adapter download descriptors.

This delivers source collection and the consumer boundary. The HTTP preview form
still configures RSS; a Jackett query subscription UI, service provisioning,
ordered indexer selection and Watching automation remain separate work. The internal
Discovery confirmation and subscription persistence can now accept query sources.
No new live search-to-playback acceptance is claimed.

## Evidence and management

- Composition creates `rssReference(url)` or
  `jackettReference({ generation, indexerId, titles })`. Both return an opaque
  `SourceReference` containing only an ID. Jackett identities include normalized,
  ordered aliases, explicit indexer and connection generation.
- `register(reference)` enables recurring collection for either source **before or
  after** its first refresh. The private binding survives restart. Registration
  does not create an anime subscription or authorize downloads.
- `snapshot(id)` reads saved evidence without network requests. Evidence contains
  common release attributes, an opaque nullable `download` reference and optional
  coverage information. There are no public `downloadUrl`, generation, indexer or
  locator fields. Coverage types belong to the shared domain, not an adapter.
- `reference(id)` resolves a saved binding. `refresh(reference)` always requests a
  network update. Identical concurrent refreshes share the in-flight read. Completed
  cached evidence is read through `snapshot`; refresh never silently returns it.
- Refresh is temporary until `publish(result)`. Publication checks the captured
  base revision, instance provenance, removal epoch and applicable connection
  generation. Failure updates also advance revisions. Copies, saved projections
  and stale results cannot publish. Repeated publication of the same revision is
  allowed. Source evidence and private download references publish transactionally;
  RSS confirmation continues to include subscription/candidates and authorization
  in the existing shared admission transaction.
- `setEnabled(id, false)` disables explicit recurring collection while preserving
  saved evidence. Enabling resumes the same binding and validates its generation.
- `remove(id)` releases explicit recurring management for **both** protocols and
  invalidates pending publication in that application instance. It preserves saved
  evidence, bindings and accepted download references. Evidence retention has no
  automatic expiry or garbage collection in this iteration.

Enabled subscriptions independently own collection via `start(activeIds, poll)`.
Releasing an explicit registration does not pause an enabled subscription. Removing
or replacing a subscription only releases that subscription's ownership; Discovery
never deletes protocol storage. Unbound managed sources refresh and publish within
Sources. The subscription callback retains its assessment/publication sequence.
Diagnostics and temporary previews do not register or publish themselves.

The legacy `feedId` field/`feed_id` column now identifies either source type; its
name is retained in existing contracts. Its foreign key targets `acquisition_sources`,
not the RSS feed table. A query subscription requires no synthetic RSS row or URL.

## Download references

`ReleaseEvidence.download` is an opaque string or null. Download selection, intent
reservation and explicit retry carry this value unchanged. The private descriptor
is retained in Sources independently of subsequent result snapshots, so accepted
work does not lose its locator when search results change.

Bootstrap supplies Downloads with a consumer-owned `TorrentReader`. Its `read`
operation delegates to `SourcesApi.readDownload(reference, signal)`, returning only
magnet content or torrent bytes. Sources performs public-address-checked reads for
RSS/public torrent URLs and saved-origin authenticated resolution for Jackett.
Arbitrary URLs are rejected at this consumer boundary. Preview-only references are
unresolvable until their evidence is published. Persisted legacy RSS evidence can
also resolve its derived opaque reference without making an arbitrary locator a
valid input.

Downloads retains parsing, canonical hash comparison, torrent path validation,
reservation and submission. It never branches on RSS, Jackett, authentication or
locator types. Authenticated proxy URLs never reach qBittorrent. Existing acquisition
permission checks gate pending work and submission admission; source publication
alone grants no permission. After asynchronous admission, Downloads checks the
reader's `isCurrent` immediately before submission. Jackett references, including
magnets, are fenced by their original connection generation; changed credentials
cannot be inherited by unsent work. Resolution also rechecks after network reads.
Already submitted tasks continue to reconcile without consulting source services.

Source reads accept cancellation, allow at most two concurrent resolutions and
are drained during shutdown. Credentials and raw locators are absent from logs.

## Scheduling and recovery

One scheduler checks active sources every 30 seconds, including an initial tick,
and processes at most two at once. Existing bounded adapter transports and the
shared discovery request gate remain in place. Successful evidence uses the
configured refresh interval (30 minutes by default). Live interval changes reschedule
saved successful evidence. Failures use exponential backoff capped at one hour and
honor later upstream retry timestamps.

Failure updates retain usable entries, coverage and successful checked time while
recording their age, error and next attempt. An initial failure for either protocol
stores an empty snapshot with null checked time, so it can retry after restart.
Success clears failure state. Changed Jackett generations suspend old collection
without rebinding it; saved evidence remains inspectable but old download references
cannot resolve. Shutdown cancels transport work and drains source workers/readers.

## Storage and upgrade

- `0004_source_lifecycle` adds management metadata and private query evidence in
  `acquisition_sources`. Stable management fields are columns. Bindings and query
  evidence are typed JSON. RSS validators and retained observations remain in their
  relational tables; the consumer cannot observe that storage difference.
- `0005_source_download_references` adds `acquisition_source_downloads`, owned by
  Sources. It moves raw URLs from previously accepted download intents into private
  locator records and replaces their intent values with opaque legacy references.
- `0006_protocol_neutral_sources` backfills RSS bindings, upgrades the previous
  RSS-only management shape and changes the subscription foreign key. Subscriptions,
  candidates, source IDs, feed validators and download authorization are preserved.
  Old orphaned RSS registration rows without a recoverable URL are removed.

Jackett credentials stay in the private configuration file. Source publication and
reference writes use the same database connection as subscription confirmation.
Download locator records and inactive evidence remain until a later retention policy
is introduced; unregistering management does not invalidate accepted tasks.

## Verification

Focused tests cover the same pre-refresh registration, initial failure, recovery,
retention and read contract for RSS and Jackett; opaque evidence and preview isolation;
SQLite reopen; stale and changed-generation rejection; cancellation/draining;
authenticated torrent content entering canonical validation; the post-admission
reference fence; query-backed subscription persistence; and a database upgrade from
migration 0004 preserving RSS subscriptions/candidates/validators and URL intents.
Existing RSS confirmation, scheduling and acquisition regression tests remain in the
focused suite. Biome, lint and both workspace type checks are required. Controlled
adapters establish these contract properties, not new real-service deployment or
browser playback acceptance.
