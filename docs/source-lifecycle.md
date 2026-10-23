# Shared Sources Contract

Date: 2026-10-23. Sources serves Subscriptions and Downloads through protocol-neutral
references, evidence and a content reader. This contract reflects the responsibility
refactor; standalone recurring registration is no longer an application capability.

## Binding and collection ownership

- Composition translates RSS configuration through rssReference(url), or a Jackett
  query through jackettReference({generation,indexerId,titles}). Consumers receive
  opaque SourceReference IDs; credentials and protocol configuration stay private.
- bind(reference) durably stores a subscription's binding without any network request.
  An initial empty snapshot has null checkedAt and is immediately due. Subscription,
  binding and accepted permission are saved in one synchronous transaction.
- Enabled subscriptions provide active IDs to start(activeIds,poll). Only these IDs
  trigger recurring collection. Pause/removal releases that subscription's ownership;
  another enabled subscription sharing the source can still collect it.
- There is no register/setEnabled/remove API for independent recurring management.
  The legacy acquisition_sources.enabled column is retained for database compatibility
  and no longer controls scheduling. Stored evidence and locators are retained.
- One-off search/testing does not create a subscription or recurring ownership.
  Query subscription persistence is supported internally, while the external form
  continues to configure RSS. Watching and a Jackett subscription UI remain pending.

## Evidence and publication

snapshot(id) reads local evidence only. reference(id) resolves saved configuration.
refresh(reference) performs a bounded remote update; identical in-flight reads are
coalesced. Returned evidence contains common release attributes, opaque nullable
content references and optional search coverage, without raw URLs or credentials.

A refreshed result is temporary until publish(result). Publication validates instance
provenance, the captured source revision and the applicable connection generation.
Copies and stale results cannot publish; coalesced results can publish the same
revision. Source evidence and durable locators publish in a transaction.

Subscriptions performs asynchronous assessment before committing. Its outer shared
transaction rechecks subscription/source/reservation snapshots and publishes evidence
and candidate decisions together. Changed subscriptions or failed writes leave no
partial candidate publication. Independent source-removal epochs are unnecessary;
subscription revision checks fence pause/replacement/removal.

failed(previous,code,retryAt) updates only the matching saved revision, retains usable
evidence and advances retry state. Initial failures are durable even before a first
successful RSS or query response. Success clears failure state. RSS stores validators
and retained entries in its existing relational tables; Jackett stores query evidence
in the existing typed snapshot. Pending RSS evidence can use the source snapshot until
its first successful feed publication.

## Download content

ReleaseEvidence.download is opaque. Selection and accepted tasks carry it unchanged.
Sources retains private locator records independently of later evidence snapshots.
Downloads receives a TorrentReader whose read delegates to readDownload(reference,
signal), returning only magnet content or torrent bytes. Arbitrary URL inputs and
unpublished references are rejected. Legacy accepted RSS locators remain resolvable.

Public RSS/torrent addresses use checked public transport. Jackett content uses the
saved origin/authentication policy. Download references retain their original
connection generation, including magnets; changed accounts cannot be inherited by
unsent work. Resolution checks validity before and after network reads, and Downloads
checks validity immediately before submitting. Already submitted tasks reconcile
without a live source service. Downloads owns hash/path validation and reservation.

## Scheduling, retry and shutdown

The scheduler ticks initially and every 30 seconds and processes at most two sources
at once. Successful refresh follows the configured interval (30 minutes by default).
Live interval changes reschedule successful evidence; failure deadlines retain
exponential backoff capped at one hour and honor later upstream hints. A changed
Jackett generation suspends old collection without silently replacing its binding.

Source download reads accept cancellation, permit at most two simultaneous reads and
are drained at shutdown. Closing Acquisition stops Downloads, cancels Subscriptions,
then aborts/drains source requests and readers before the database closes. Logs omit
credentials and raw locators.

## Storage and verification

Migrations 0004 through 0006 remain unchanged. Bindings, evidence, subscriptions,
candidates, validators, opaque download references and authorization survive upgrade.
The existing feedId/feed_id fields identify either protocol. Retention/garbage
collection of inactive evidence and private locators remains separate work.

Tests cover both protocols, inactive bindings, durable initial failure, caller-owned
collection, reopen, coalescing/stale rejection, generation changes, download-reference
isolation, authenticated content validation, shutdown and migration preservation.
Subscription tests cover direct saves, background refresh, pause and transactional
publication. Real source/downloader/shared-storage/browser playback acceptance
remains distinct from these fixtures.
