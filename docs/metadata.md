# Metadata Module

Metadata owns anonymous provider reads, normalized anime metadata, persistent
snapshots, refresh state and artwork caching. AniList is the first provider;
provider-qualified references and the `MetadataProvider` port allow additional
adapters. Metadata does not own local works, associations, episode corrections,
resource access or playback progress.

## Public API and assembly

`MetadataApi` exposes:

| Operation | Result / purpose |
| --- | --- |
| `providers()` | Adapter version and supported capabilities |
| `search({ query, provider?, page?, perPage? }, options?)` | Cached paginated work summaries |
| `get(reference, options?)` | Cached work details; `refresh: true` explicitly revalidates |
| `relations(reference, page?, perPage?, options?)` | Same-provider anime relations; manga nodes excluded |
| `airing(reference, page?, perPage?, options?)` | Provider-paginated airing entries, not canonical episode identities |
| `snapshot(id)` | Read a specific persisted projection version without cloud access |
| `retain(id, ownerId)` / `release(id, ownerId)` | Idempotent Catalog-owned retention pins |
| `artwork(reference, kind, options?)` | Cover/banner status and opaque local asset ID |
| `readArtwork(id)` | Cached image bytes and validated MIME type |
| `snapshotArtwork(id, kind)` | Artwork from a retained detail snapshot without a provider metadata request |

A reference is `{ provider, mediaType: "anime", id }`. IDs are opaque outside the
adapter; AniList's GraphQL integer conversion is adapter-owned. `ReadOptions`
accepts `signal`, `refresh` and `cachedOnly`. Cached-only reads never contact the
provider; an absent snapshot returns a typed not-found failure.

`bootstrap/metadata.ts` creates the module using the application database and
reconciles artwork before use. Startup itself makes no provider request. The
bootstrap consumer adapter supplies Metadata search results to Identification
following a completed Library scan. Only extracted title queries reach AniList;
source paths and resource versions remain local. Series season/part are left
unknown rather than inferred from calendar seasons or sequel relations.

If SQLite or cache initialization is unavailable, production falls back to local
Identification; Metadata routes are registered only when the module is available.
Shutdown stops identification, cancels/drains metadata and artwork work, and then
closes the shared database.

## Normalized projections

Search returns references, title variants, year, format, status, episode count,
calendar season and cover URL. Detail additionally supplies synopsis, banner,
fuzzy dates, duration, origin/source, genres, spoiler flags, studios, score,
provider update time, source URL and external streaming entries.

Titles retain `romaji`, `english`, `native` or `alias` provenance. English titles
are marked `en`; romanized/native titles and aliases have unknown language rather
than an assumed Japanese or Chinese language. Dates and unavailable scalar fields
stay nullable. `unavailableFields` records queried fields explicitly returned
null, including lists represented as empty normalized arrays. Missing required
projection fields are invalid responses, not silently downgraded details.
Descriptions remain provider text, not trusted rendered HTML. Clients must hide
spoiler-tag content by default when the future detail UI is implemented.

`episodeCatalog: "unavailable"` is explicit: streaming links and airing numbers
are not a canonical episode catalog. Relations never imply episode offsets.
AniList returns the relation edge set without remote pagination arguments; the
adapter bounds the response and locally pages the anime nodes. Airing and search
use provider pagination and validate the returned page information. No catalog
crawl, user authorization, mutations, staff or character requests are performed.

## Persistent cache and refresh

Migration `0007_metadata` adds provider snapshots, retention pins and artwork
records, independently of resource roots. Snapshots store normalized data and the
bounded queried provider projection, not a full provider database copy. Keys
include provider/adapter/projection version, operation, title or qualified
reference, page and page size. Reference property order and unrelated route
parameters do not change cache identity. Snapshot IDs include cache key and
normalized content; changed content creates a new version. Fetch/access/expiry
timestamps and refresh failures are persisted. Catalog can retain and read the
exact version used by a confirmed association without replacing its decisions.

| Projection | Freshness / retention |
| --- | --- |
| Successful search | 24 hours |
| Successful empty search | 15 minutes; request failures are never negative-cache entries |
| Finished details | 7 days |
| Other details and relations | 24 hours |
| Airing pages | 15 minutes |
| Unpinned search snapshots | At most 1,000, LRU |
| Other unpinned snapshots | At most 2,000, LRU |
| Pinned snapshots | Exempt from transient eviction; owners release explicitly |

Fresh reads return clones. Expired snapshots return immediately with `stale` and
`refreshing` and start a coalesced background revalidation. Explicit refresh waits
for the same operation. Failure preserves the usable snapshot and reports
`refreshError`; background retries wait at least a minute or until provider reset.
A cache miss propagates the typed provider failure. Refresh never accesses local
association or progress tables. Refresh happens on use, not from a periodic
whole-catalog job. Identification's current process-local group reuse still avoids
re-identifying unchanged directory contexts; Metadata refresh does not itself
trigger a new recognition pass.

One subscriber cancellation does not cancel others. Once all foreground
subscribers leave, unneeded query work is canceled; stale background revalidation
is owned by the module lifetime. Shutdown cancels even uncooperative transports
through an abort race. At most 100 distinct refreshes are pending at once.

## Provider transport and artwork

All production AniList operations share one provider instance. Its queue is
serialized and starts requests at least 2.4 seconds apart (25/minute initial
policy), adapting downward from rate headers. `Retry-After`, remaining capacity
and reset timestamps control further requests. Queries have an 8-second network
and body timeout, at most three attempts for temporary failures, and exponential
backoff with jitter. Invalid responses, invalid requests and not-found failures
do not loop. The 2 MiB response limit also applies to streamed bodies without a
Content-Length header. HTTP success with GraphQL errors is not success; partial
error data never replaces a valid snapshot. These choices follow the documented
[AniList rate behavior](https://github.com/AniList/docs/blob/master/docs/guide/rate-limiting.md).

Artwork downloads happen on cover/banner use, not during title search. Only HTTPS
`s4.anilist.co` URLs and redirects to that host are accepted. Downloads are
serialized separately, limited to 16 pending operations, 5 MiB per image and an
8-second timeout. `file-type` validates PNG/JPEG/WebP/AVIF/GIF bytes; arbitrary
URLs, SVG and filesystem paths cannot be served. A private temporary file is
renamed atomically into `cache/metadata-artwork`; asset IDs hash identity, URL and
content. A 128 MiB LRU budget is independent of snapshot retention. Missing,
incomplete and orphan files are reconciled on startup. Failed replacement keeps
an existing usable image when available. Individual canceled image readers detach;
module-owned bounded cache downloads drain or cancel at shutdown.

Provider failures are typed and use safe recovery messages. HTTP maps uncached
not-found to 404, invalid input to 400, rate limiting to 429 (with Retry-After when
known), invalid provider output to 502, and unavailable/busy/storage failures to
503. Detailed causes stay in server logs; queried raw payloads are not HTTP data.

## HTTP and verification

| Method / route | Purpose |
| --- | --- |
| `GET /api/metadata/providers` | Provider capabilities |
| `GET /api/metadata/search?query=...&page=1&perPage=10` | Search cached/provider candidates |
| `GET /api/metadata/:provider/:id` | Cached/provider detail |
| `POST /api/metadata/:provider/:id/refresh` | Explicit detail refresh |
| `GET /api/metadata/:provider/:id/relations` | Relations page |
| `GET /api/metadata/:provider/:id/airing` | Airing page |
| `GET /api/metadata/:provider/:id/artwork/:kind` | Fetch/retrieve cover or banner status |
| `GET /api/metadata/artwork/:id` | Read an opaque cached image asset |

Read routes accept `cachedOnly=true`; relation/airing routes accept pagination.
Search allows page sizes up to 50; relations/airing up to 25. Retention and snapshot
version reads are internal module APIs, not arbitrary browser pin operations.
HTTP query subscriptions cancel on disconnect. Browser response types are derived
from the schemas in `contracts/http.ts`. The Anime Web feature now consumes Catalog projections for poster/detail display
and Metadata for cached relations. Catalog confirmation and Review UI remain pending.

Tests use realistic injected GraphQL transports plus actual SQLite, restart,
HTTP and filesystem integration. They exercise normalization/unknowns, stale and
negative-cache behavior, coalescing, cancellation, retention/LRU, provider errors,
retry/rate limits, response bounds, asset validation/fallback/reconciliation,
versioned keys and Identification integration. One-page live AniList search,
detail, relation and airing smoke requests were also validated during this change;
these are provider-interface checks, not full anime-library acceptance.

## Module boundary

This implementation is private to the Anime large module. External consumers use
its root Public API; Anime composition owns internal construction, recognition
coordination and provider/Catalog adapters. App uses only the module creation,
HTTP and persistence entries. See [Architecture](architecture.md) for boundaries.
