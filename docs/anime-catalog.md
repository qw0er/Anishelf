# Anime Catalog Module

Anime Catalog owns the durable local anime library: works, episodes, provider
links, source associations, review decisions and user corrections. Metadata owns
provider snapshots and caching; Identification remains stateless and returns
suggestions. Catalog never confirms suggestions automatically or changes original
files, playback progress, preparation or subtitles.

## Assembly and persistence

Bootstrap constructs `AnimeCatalogApplication` when SQLite and Metadata are
available. It injects Resource Access, the Catalog repository and a consumer-owned
Metadata port. Identification coordination supplies complete, revision-checked
publications through `onPublication`, including empty roots. No partial/cancelled
recognition pass is published to Catalog. Module dependencies use Public APIs.

`application/catalog.ts` is the public facade. Internal use cases are composed
around one `CatalogContext`, which owns lifecycle, active-root checks and source
validation:

| Component | Responsibility |
| --- | --- |
| `CatalogQueries` | Local work list/detail projections and availability counts |
| `ReviewApplication` | Recognition publication, review queries, rejection and explicit source unlinking |
| `AssociationApplication` | Bounded transient previews, mapping confirmation and replacement |
| `WorkApplication` | Manual work/episode edits and provider snapshot refresh |

Mapping validation lives in `domain/mapping.ts`; provider-to-local projection is
shared by confirmation and refresh. All use cases share the same Catalog store.
Confirmation still commits works, episodes, associations, review decisions and
operation keys in one transaction. Closing the facade closes the shared context
and clears association previews. These internal components do not introduce new
cross-module APIs, HTTP routes or persistence boundaries.

Migration `0008_anime_catalog.sql` adds:

| Table | Owner / purpose |
| --- | --- |
| `catalog_works` | Stable local work IDs, manual title/aliases, cached search/display projection and revision |
| `catalog_provider_links` | Unique qualified provider reference and selected retained detail snapshot |
| `catalog_episodes` | Stable local episode IDs, kind, preserved number/label and provenance |
| `catalog_associations` | Unique source/episode links, release tokens, explicit offset, correction reason and operation key |
| `catalog_reviews` | Latest recognition evidence/proposals, published availability, decision, reason and revision |
| `catalog_operations` | Committed confirmation keys, request fingerprints and replayable results |

Sources reuse Resource Access's existing registry. Catalog never creates a second
root/file/version identity system. A provider reference reuses the same local work
across directories and roots. Root-specific queries include only works with source
associations in the active root; switching roots does not delete saved state.

Completed publications update evidence and source availability while preserving
confirmed/rejected decisions and associations. Replacing a file creates a new
source and pending review; the old source keeps its historical links and becomes
unavailable. Identical versions regain availability when rediscovered. Startup
scans rebuild availability and recognition; works and decisions survive restart.

## Preview, confirmation and corrections

1. Read a review item's opaque ID and revision. Candidate search and explicit
   provider lookup use Metadata's existing HTTP endpoints.
2. Submit a qualified provider reference and selected source rows. Each row has
   explicit regular/special/movie targets, a correction reason and an optional
   regular-number offset. Only selected rows are affected; unresolved rows remain
   in Review. One source can map to several episodes.
3. Catalog loads selected work details, validates sources and returns a preview
   with raw numbering, resulting targets, existing affected links, work revision
   and expiry. A preview creates no works or associations.
4. Confirm with the preview ID, a stable operation key and explicit `replace` flag.
   Catalog revalidates source versions/root epoch, checks work/review revisions,
   retains the selected Metadata snapshot and commits all records in one short
   SQLite transaction. Existing links require `replace: true`.

The initial limits are 100 source rows, 100 targets per row, 50 items per page,
100 concurrent previews and a 15-minute preview lifetime. Offsets apply only to
explicit integer regular targets. Targets outside a known work count, zero,
negative numbers, duplicate targets and implicit specials are rejected. Specials
require a preserved identity and explicit label; movies use `movie/whole`.

Known regular counts create `count-derived` numbered slots, bounded at 10,000.
These are local placeholders, not provider episode titles or identities. Confirmed
slots have `confirmed` provenance. Unknown counts create only explicitly confirmed
episodes. Count-derived labels are honest `Episode N` fallbacks.

Episode label/identity edits retain their local ID and require the work revision.
An existing target identity cannot be overwritten; reassign source associations
through a replacement preview instead. Shared episode edits affect its associated
versions. Manual titles and aliases take precedence over provider titles. Refresh
updates only the provider projection and snapshot link, preserving local fields,
episode IDs, associations and source history. Provider failures expose Metadata's
refresh error and preserve the last valid Catalog state.

Committed confirmation retries return the original result even after restart.
Reusing an operation key for different input fails. Previews are bounded in-memory
state: expiry, restart, root switching, source replacement, intervening decisions
or metadata eviction require a new preview. Previews do not pin transient metadata;
confirmation pins it before the transaction. Failed commits release newly unused
pins; successful snapshot replacement releases the previous work-owned pin.

Rejecting an unassociated source persists its reason. Removing associated links is
an explicit operation, records a rejected decision and preserves original files,
local records and playback history. Later scans do not undo either decision.

## Queries and HTTP

| Method / route | Purpose |
| --- | --- |
| `GET /api/catalog/works` | Paginated local search, format/year/availability filters, title/recent sorting |
| `GET /api/catalog/works/:id` | Cached metadata, ordered episodes and source versions |
| `GET /api/catalog/works/:id/artwork/:kind` | Validated cover/banner bytes from the retained snapshot; active-root access |
| `GET /api/catalog/reviews` | Paginated pending/confirmed/rejected decisions and recognition evidence |
| `POST /api/catalog/previews` | Preview selected mappings and replacements |
| `POST /api/catalog/confirmations` | Atomically confirm/reassign selected rows |
| `POST /api/catalog/reviews/:id/reject` | Persist rejection and reason |
| `POST /api/catalog/reviews/:id/remove` | Explicitly remove source associations |
| `PATCH /api/catalog/works/:id` | Correct local title and aliases |
| `PATCH /api/catalog/works/:id/episodes/:episodeId` | Correct episode label/identity with work revision |
| `POST /api/catalog/works/:id/refresh` | Refresh selected provider details, preserving local decisions |

Response schemas are in `contracts/schemas/anime-catalog.ts`; browser types are
exported through `contracts/http.ts`. DTOs expose opaque IDs and relative paths,
not canonical roots or raw provider transport payloads. Responses use `no-store`.
Conflicts return 409, missing active-root records 404 and invalid input 400.

Availability filters use the latest complete publication. Returned source versions
and availability counts additionally revalidate actual sources; these are point-in-time
checks, and existing playback access validation remains authoritative. Missing
local versions, unavailable associated files and unknown provider information
remain distinct. Airing data and streaming links remain Metadata evidence; Catalog
does not infer canonical episode identities or claim unaired state from absence.
Available episode counts deduplicate versions; `availableRegularEpisodes` is
separate so specials do not inflate a regular-count denominator.

Listing/details use local Catalog and retained Metadata snapshots without provider
requests. Descriptions remain untrusted provider text for the frontend's sanitizing
renderer. Metadata routes continue to provide candidate search, relations, airing
and opaque cached artwork delivery. Catalog does not create playback sessions;
version DTOs identify sources for existing playback APIs and do not imply seek
boundaries in multi-episode files.

## Verification and remaining iteration work

`backend/test/anime-catalog.test.ts` exercises actual SQLite migrations, scanners,
Resource Access, Metadata persistence and HTTP. It covers previews/corrections,
multiple versions, idempotency, transactional rollback, stale decisions, restart,
provider failures, root switching and replaced/missing sources. These fixture files
are intentionally non-playable and do not certify browser playback.

The Web poster library and work detail are implemented at `/` and `/anime/:id`.
Files remains at `/directories/root`. The wall uses local search, format/year/
availability filters, title/recent sorting and 24-item pages. Query keys include
resource root and scan revision; URL filters, scroll restoration and returning
card focus retain browsing context. Missing artwork falls back to the real title.

Cards/detail expose same-origin cover/banner URLs. HTTP owns URL projection;
Catalog supplies artwork presence and Metadata loads images from the retained
snapshot through `snapshotArtwork`, without querying AniList for each card.
Image downloads remain lazy and bounded by Metadata's existing cache policy.
Artwork failure never blocks metadata or playback. Snapshots remain usable offline;
uncached images fall back to titles.

Details show metadata unknowns, cached/stale status, explicit refresh/retry,
sanitized provider Markdown/HTML, spoiler tags hidden by default, cached relations
with pagination, and separate regular/special/movie groups. Episode rows distinguish
available, unavailable and missing versions. Multiple usable versions open an
accessible selector with original filenames, paths and name-derived release evidence.
Single usable versions open the existing player directly. Version URLs pin the
selected source version so a replaced file cannot silently satisfy the selection.
Player return links retain the work, episode and library filters; ordinary Files
playback still returns to its original directory. Multi-episode files use their
normal timeline, and source progress remains authoritative.

[Scoped verification and screenshots](acceptance/anime-library/README.md) cover
real H.264/AAC version playback, subtitle selection, source seeking/history and
1280/390 px layouts. Files identification presentation and Review UI remain pending.
Full CAT01–CAT08 acceptance and representative recognition accuracy remain iteration
work; this slice does not automatically confirm identification proposals.

## Module boundary

This implementation is private to the Anime large module. External consumers use
its root Public API; Anime composition owns internal construction, recognition
coordination and provider/Catalog adapters. App uses only the module creation,
HTTP and persistence entries. See [Architecture](architecture.md) for boundaries.
