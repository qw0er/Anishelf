# Automatic Source Discovery

Date: 2026-10-24. Manual and Watching-created subscriptions share one persistence,
source discovery, authorization, reservation, download and verified-ingestion workflow.
This document supersedes the stage-4 Find a source / save-preview interaction.

## User workflow

1. Configure ordered Jackett sites, subscription defaults and a validated download
   destination in Settings → Downloads.
2. Open Subscribe on a work, set the starting episode and save. Automatic source
   selection is the default. More options exposes profile overrides and RSS entry.
3. The subscription is persisted immediately, before a matching release exists.
   Background discovery searches configured sites in order and pins the first site
   with an eligible identity/episode/profile match. No release selection is required.
4. Empty results retain intent and show Waiting for releases. Failures are distinct.
   Check updates retries pending discovery immediately without waiting for the local
   five-minute discovery delay; Sources still owns transport limits and backoff.

The starting episode is fixed at creation. Watching uses confirmed progress plus one
or episode 1 at that point. Tracking changes do not move an existing subscription's
lower bound. Manual and Watching-created work share the same editor and actions.

A profile's deliberate waiting period does not disqualify an otherwise eligible
source. Discovery does not establish the persisted selection waiting clock. Normal
background collection establishes it after binding. Search uses up to four distinct
normalized metadata titles/aliases, retaining season and part information. Ambiguous
identities, packs, unsupported/out-of-scope episodes, locally available episodes and
known active torrent hashes do not qualify. Unknown downloader hashes fail discovery
rather than implying that there are no tasks.

A selected site/query stays pinned through empty results or outages. Collection does
not merge/rank sites or silently switch providers. An explicit editor save may keep
that source, restart automatic selection or replace it with RSS.

## Persistence, contracts and ownership

PUT /api/acquisition/subscriptions accepts an automatic choice, explicit source or
null (keep the current choice), starting episode, profile, expected subscription
revision and the validated destination/downloader stamp. Saving intent is local.
Pending intent stores accepted source generation, profile fingerprint and target.
Binding and permission are committed atomically only after rechecking those stamps
and the current subscription revision. Late edits, cancellation or pause fence old
results. A discovery result by itself never grants download permission.

Subscriptions owns metadata identity/profile assessment and ordered source selection.
It calls Sources' public API; transport, credentials and opaque download references
stay inside Sources. The optional POST /api/acquisition/subscriptions/search remains
a non-authorizing diagnostic operation. It is not required by the editor and has no
preview token or confirmation session. Watching activation separately retains its
session-bound global impact preview.

Each background attempt saves one bounded diagnostic snapshot on the subscription:
check time, provider IDs, outcomes, safe error/rejection codes and limited-coverage
flags. Migration 0011 adds this JSON field. The next check replaces it; deleting the
subscription deletes it. No credentials, raw responses or private locators are saved
there. Successful binding retains the last attempt; saving a new automatic scope
clears previous diagnostics. GET with diagnostics=false omits the snapshot and release
rows. Activity loads the snapshot and grouped release decisions only when Diagnostics
opens. Empty or truncated searches are never proof of full backlog coverage.

Source definitions and permission checks remain generation-bound. Destination/account
changes require validation and a newly accepted scope. Existing submitted transfers
continue independent reconciliation. Downloads resolves opaque content through Sources,
validates canonical hashes/paths and reserves work/episode before submission.

Structured events include acquisition.source_discovery_evaluated,
acquisition.source_discovery_failed, acquisition.subscription_discovery_deferred,
acquisition.subscription_source_bound and acquisition.subscription_saved. They exclude
API keys, cookies, raw service responses and private download locators.

## Verification boundary

Automated fixtures cover ordered selection, identity/profile/scope rejection,
non-authorizing diagnostic searches, pending intent across restart, fixed starting
scope, stale configuration/revision results, atomic binding/permission rollback,
manual refresh during local retry delay, persisted/lazy diagnostics and source pinning.
UI regressions cover ordinary management, editor input preservation during background
revision changes and remote-to-local detail transitions after refreshed data arrives.

These checks do not establish live AniList, Jackett, qBittorrent, shared-storage
verification/ingestion or browser playback acceptance. See Watching setup for the
remaining real-service acceptance boundary.
