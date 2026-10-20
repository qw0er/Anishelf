# RSS subscriptions and automatic selection

Subscriptions, RSS discovery, recognition and automatic candidate selection feed
the implemented [durable download and verified ingestion workflow](current-architecture.md).
Discovery itself never calls downloader mutations. Only a separately confirmed
acquisition scope with a validated destination permits the download worker to add
tasks; transfer controls remain in qBittorrent WebUI.

## User workflow

Open a local or remote-only anime detail page. Under **RSS subscription**, enter
a public RSS URL and a starting episode (default 1), then choose **Check RSS**.
The preview displays the source origin, starting episode, known episode count,
already available episodes and number of observed releases. When a validated destination exists, the preview also displays the work-specific
download directory. Choose **Enable subscription** to confirm this scope and enable
automatic acquisition. Without that destination, confirmation enables discovery only.
Existing subscriptions need a fresh preview/confirmation before any download. Initial discovery includes the entries
currently returned by the feed; it cannot recover an absent historical backlog.

There are no subtitle-group, resolution, codec, language or keyword controls.
Choose a feed representing those preferences on the source website. One RSS is
configured per anime; equal canonical URLs share fetching and retained evidence.
The detail page supports pause/resume, edit, explicit refresh, removal and paged
results. Editing leaves the RSS field blank to retain its private saved value.

Selection is automatic. For each regular episode, keep an existing valid choice;
otherwise select the eligible release with the earliest known publication time,
then stable identity. Unknown dates sort last. Later releases do not automatically
upgrade or replace a valid choice. Other versions are skipped with a reason.
There is no per-release review or approval step. Uncertain identity/numbering,
season conflicts, packs, specials, unavailable download links and episodes before
the starting scope are skipped visibly. Confirmed accessible local episodes are
also skipped. Local file Review remains a separate existing workflow.

## Ownership and recognition

Acquisition owns subscription state, schedules, retained feed evidence and selected
or skipped decisions. Anime exposes `acquisition.target()` and `assess()` for
provider-qualified identities, metadata revisions and recognition. Catalog supplies
current accessible regular episodes without creating an empty local work.

`AnitomyIdentificationParser.extractRelease()` shares the existing adapter and
normalization, but extracts only leaf-title evidence: no invented SourceIdentity,
directory anchors, grouped-file inference or cross-release numbering offsets.
Existing title matching, explicit contradiction checks and episode proposals are
reused. Unknown episode count is allowed; known out-of-range numbering is skipped.

When qBittorrent is configured, discovery reads its task snapshot and excludes
known v1 hash matches and other versions of their confidently recognized episodes.
Read failures do not become empty snapshots: affected candidates are skipped with
`downloader_unavailable`. Unconfigured qBittorrent does not prevent discovery.
Hashless torrent enclosures are deduplicated by download URL during discovery.
The download worker independently parses torrent bytes and reserves the canonical
v1 hash and work/episode before submission. Feed-provided hashes are evidence, not verified
torrent contents. No downloader task is silently adopted or controlled.

## RSS adapter and network policy

The initial format is RSS 2.0. `fast-xml-parser` validates/parses bounded XML;
DOCTYPE/entity declarations are rejected, standard XML entity escapes are decoded,
and nesting is capped. Supported download evidence includes BitTorrent enclosures,
direct Magnet item links, Nyaa Magnet/hash extensions and Torznab Magnet/hash
attributes. This does not implement a Torznab search client. Item page links are
never fetched or treated as downloads. Atom, HTML scraping, website login and
automatic feed provisioning are outside this implementation.

The backend performs HTTP(S) requests with a 30-second deadline, at most three
redirects and a 5 MiB response limit. HTTPS redirects cannot downgrade to HTTP.
IP address validation rejects private, loopback, link-local and other non-public
destinations, including mapped addresses. DNS results are checked at connection
time and redirect targets are validated separately. Local/private RSS servers are
not supported by this initial adapter. Downloader LAN endpoints use their existing
separate policy. Requests carry no downloader credentials or browser cookies.
Compressed feed bodies are rejected; identity encoding is requested.

Conditional requests reuse ETag/Last-Modified. A 304 retains prior entries; invalid
XML and failed responses never publish partial evidence or erase old candidates.
GUID/page identifiers track observations; known hexadecimal v1 hashes, otherwise
download URLs, provide release identity. Complete URLs and payloads stay in private
SQLite data. Public views show only the source origin, title, episode and decisions;
URL paths/query credentials and torrent/Magnet addresses are not returned or logged.

## Persistence, scheduling and lifecycle

Migration `0018_rss_subscriptions` adds Acquisition-owned feeds, subscriptions and
candidates. The existing SQLite connection and migrations are reused. Feed evidence
and candidate reasons survive restart, pause and temporary source outages. Removing
a subscription deletes its candidates; an unreferenced feed is removed. Editing to
a different feed releases its old unreferenced feed. Keep private database backups
because RSS addresses may contain passkeys.

Enabled feeds run every ten minutes. A bounded worker checks due times every
30 seconds, with at most two feed fetches and coalesced concurrent requests.
Manual refresh has a 30-second cooldown. Failures retain previous data and back off
from two minutes to a maximum of one hour. Metadata failures are isolated per
subscription. Shutdown aborts requests and drains discovery before dependent
modules and SQLite close. Read-only views never trigger source requests or writes.

Limits are internal policy: 64 subscriptions, 1,000 items per feed response,
2,000 retained identities per feed, 32 five-minute preview tokens and 20 results
per page. Oversized batches/history fail visibly instead of silently dropping
unseen releases. Feed evidence retains these limits. Download terminal-detail retention and compact
suppression are managed separately by the acquisition worker.

Preview tokens bind the authenticated session, anime, feed evidence, starting scope,
subscription revision, metadata snapshot and local availability. Confirmation
rechecks revisions. Old polling results cannot overwrite a paused, edited or removed
subscription. Previewing changes no subscription or candidate rows. All mutation
routes use the existing authentication and CSRF boundary:

| Route | Purpose |
| --- | --- |
| `GET /api/acquisition/subscriptions?workKey=…&page=1` | Read one anime's persisted state and candidates |
| `POST /api/acquisition/subscriptions/preview` | Read and assess the proposed source/scope |
| `POST /api/acquisition/subscriptions/confirm` | Confirm the session-bound preview |
| `PATCH /api/acquisition/subscriptions` | Enable or pause with a revision |
| `POST /api/acquisition/subscriptions/refresh` | Explicitly refresh an enabled source |
| `DELETE /api/acquisition/subscriptions` | Remove with a revision |

Structured logs record hashed feed identifiers, state transitions, counts and safe
reason codes, never source URLs, entry titles, response bodies or credentials.
Local tests cover parsing, HTTP contracts, guarded transport, title/episode matching,
selection stability, deduplication, pause/restart, shared feeds, failures, stale
results, authentication/CSRF and the minimal detail-page form. This is not live
tracker certification or a real RSS-to-download-to-playback acceptance record.

## Activity and Download Recovery

The detail panel keeps subscription actions in a secondary menu. Activity is
collapsed by default and combines selected/skipped releases with managed acquisition
state, actual transfer percentage, import outcome and persistent errors. A visible
attention count exposes collapsed failures. Open WebUI for transfer pause/resume,
removal and deletion; Anishelf provides only scoped acquisition/import retry and
links to existing Review or Settings. Pausing subscriptions leaves existing tasks
running. External removal suppresses automatic re-adding across restart.
