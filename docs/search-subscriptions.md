# Search subscriptions (stage 4)

Date: 2026-10-23. Manual RSS and search subscriptions share the existing acquisition,
authorization, reservation, download and verified-ingestion workflow. Watching
reconciliation and real-service playback acceptance remain later work.

## User workflow

1. Configure Jackett sites and their order in Settings. Configure and validate the
   downloader destination.
2. Open an anime's **Subscribe** or **Manage** dialog. Choose **Search configured
   sites**, a starting episode and a release selection profile.
3. Select **Find a source**. Review each attempted site's outcome, rejection reasons
   and limited-coverage indicator. The first site with a verified matching regular
   episode satisfying the scope and profile becomes the proposed source.
4. Select **Save and enable subscription** to accept acquisition to the displayed
   destination. Searches alone never grant permission or submit downloads.

A profile's deliberate waiting period does not disqualify an otherwise matching
source; its releases are marked as waiting. Preview does not start or persist that
waiting clock. Normal background collection establishes the clock after saving.
Changing the starting episode, profile or source mode clears the preview and requires
another search. Search uses up to four distinct normalized metadata titles/aliases;
season and part information are retained. Ambiguous identities, packs, unsupported
episodes, locally available episodes and known active torrent hashes do not qualify.
If the downloader cannot provide active hashes, discovery fails rather than assuming
there are no tasks.

The selected site and title query are persisted as the subscription source definition.
Later empty results or failures retry that site; collection never moves to another
site or merges results across sites. Editing a saved search subscription defaults to
**Keep current source**. An explicit new discovery and save, or an RSS replacement,
is required to change it. Existing manual RSS entry remains available.

## Contract and ownership

`POST /api/acquisition/subscriptions/search` accepts `workKey`, nullable current
subscription `revision`, `startEpisode` and optional `profileId`. It requires the
same authentication and CSRF protection as other acquisition mutations and returns
`Cache-Control: no-store`.

The result contains a nullable proposed `source`, bounded safe release summaries
and ordered provider attempts (`matched`, `no_match`, `no_eligible`, `unavailable`).
Attempts include safe error/rejection codes and whether search coverage is limited.
A failed or incomplete site is never reported as proof that all releases are absent.
Provider failures are visible; later configured providers may still qualify during
this explicit discovery operation. No provider beyond the first qualifying one is
searched. Discovery permits two concurrent operations, with one per work, and uses
the existing bounded Sources requests and rate limits.

Subscriptions owns metadata identity/profile assessment and ordered source selection.
It calls only the common `SourcesApi` and its connector setup interface; protocol
clients, authentication and download locators stay inside Sources. A preview may
create private pending cache/backoff bindings, but does not publish release evidence,
download references, subscription candidates, permissions or intents.

The existing save endpoint accepts the returned search definition. Save remains a
local atomic subscription/permission write, with destination and downloader generation
checks. There is no separate preview token or confirmation session. Background refresh
fetches the pinned definition and atomically publishes evidence, durable opaque download
references and assessed candidates. Source definitions and permission source identities
already support this through the existing schema; no additional migration is needed.

Discovery checks the captured connector and subscription revisions before and after
asynchronous work. Changing either rejects a late result. Saving an obsolete search
definition also fails. Connector changes are surfaced as `source_changed` on saved
subscriptions; the user must choose and save a source again. Existing submitted
transfers continue through reconciliation independently of Jackett.

Downloads consumes the same opaque content reference used for RSS. Sources resolves
private authenticated torrent routes into bytes or magnet content; Downloads validates
canonical hash/paths, reserves the work/episode and rechecks source currency before
submission. Old unsent references cannot inherit changed connector credentials.
Destination/account changes still require validation and a new accepted scope.

Structured events include `acquisition.source_discovery_evaluated`,
`acquisition.source_discovery_failed`, `acquisition.subscription_saved` and the existing
source/candidate/download lifecycle events. They exclude API keys, cookies, raw service
responses and private download locators.

## Verification boundary

Automated tests cover ordered selection, no-match and identity/scope rejection,
profile waiting, provider failures, non-authorizing previews, stale revisions,
pinning and no fallback, HTTP authentication/CSRF/input validation, UI activation and
preview invalidation. An integration fixture uses actual Sources persistence/content,
Subscriptions and Downloads with a fake Jackett adapter and qBittorrent client: it
resolves a private reference, submits once, reconciles and invokes ingestion. Changing
the connector before submission prevents the request.

These fixtures are not live tracker/downloader/shared-storage/browser acceptance.
Stage 5 must verify search → explicit activation → qBittorrent → actual file verification
and ingestion → browser playback, including restart and relevant failure recovery.
