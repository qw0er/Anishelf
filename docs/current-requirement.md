# Automatic Acquisition: Current Iteration Requirements

Date: 2026-10-23. RSS/manual search acquisition and opt-in Watching subscription creation
are implemented. The user reported live acceptance of the preceding manual pipeline;
real Watching-account acceptance remains pending.
No release number is assigned. Use one selected subscription source per anime and one
qBittorrent instance.

Jackett connection/search and [shared source evidence persistence and recurring
collection](source-lifecycle.md) are implemented. Source consumers now use opaque evidence/download references and a common reader;
feed and query definitions share the subscription-save contract. The
[manual search subscription workflow](search-subscriptions.md), including
ordered indexer discovery and source pinning, is implemented. Manual end-to-end playback acceptance was reported by the user; this is separate
from the automated fixtures and pending live Watching acceptance. [Stage 3 setup](jackett-setup.md) provides
connector/site settings, diagnostics,
optional deployment and private first-run bootstrap/provisioning.

## Workflow

Target workflow: enable Watching automation with resource sites, release preferences,
destination and backlog policy → add an anime to AniList Watching → discover a
matching source and maintain its subscription → select an eligible release → download
through qBittorrent → verify and associate the completed file → expose the episode
in the library. Routine Watching additions require no manual per-anime RSS entry
or per-release approval.

Implemented manual setup: choose an anime → enter an RSS URL or discover a search
source using configured site order → choose a starting episode → save and enable
acquisition against the displayed validated destination → collect and select one eligible release per regular episode in the background
→ submit reliably → observe qBittorrent → verify completed files → associate actual
resources → expose playback through the existing episode list.

The delivered RSS discovery and account settings remain part of this workflow.
Anishelf owns acquisition intent and verified ingestion. qBittorrent WebUI owns
transfer controls, seeding, task removal and downloaded-data deletion. There is no
global Downloads page or duplicate transfer-management interface in Anishelf.

## Unified Subscription Creation and Discovery

- Manual and Watching-created subscriptions have the same management behavior.
  A user can subscribe before any release exists. Save the fixed starting episode,
  profile and accepted destination; discover the source asynchronously. Explicit
  RSS and per-work source/profile overrides remain available.
- Automatic discovery searches configured sites in order, verifies work/episode and
  profile eligibility, then pins one source. Empty results retain intent. Failed
  site reads remain distinct from healthy absence; neither may guess a download.
- Watching is default-off and uses an explicit session-bound activation preview.
  It creates missing subscriptions using confirmed progress plus one or episode 1.
  Existing subscriptions are never adopted or overwritten. Turning it off stops
  future creation; subsequent Tracking status/account changes do not stop existing
  subscriptions. Tracking-driven ongoing enablement is outside this creation-only
  policy.
- Users edit, pause/resume and unsubscribe identically regardless of creation origin.
  Unsubscribe records an automatic-recreation exclusion. Existing transfers/imports
  continue. Scope/source/target changes require current validation/permission and
  fence late discovery results. No separate ownership-conversion consent exists.
- Settings owns global setup/help. The work header shows one compact subscription
  summary with Activity and an actions menu. The editor initially shows starting
  episode and effective defaults; More options exposes overrides. Activity contains
  active/error task rows, secondary History and lazy grouped Diagnostics.
- Upgrading old automation grants does not expand their permission. Migration 0010
  preserves old pins/scope, pauses previously managed subscriptions and requires
  explicit save/resume under the unified model. Existing manual permissions remain.

See [current architecture](current-architecture.md#unified-subscriptions-and-watching-creation),
[the interaction delivery record](subscription-interaction-redesign.md) and
[Watching setup](watching-automation.md).

## Destination and Placement

Settings selects one configured resource root and its qBittorrent absolute POSIX
path. Validate the saved account, root access and a separate enabled incomplete
directory. Show configured mapping and proven file visibility separately.

Each work receives a persisted `Title [provider-id]` directory. Sanitize path
components, bound names, preserve readable Unicode and distinguish work identities.
Subsequent metadata renames do not move existing directories. Different seasons
with different work identities get separate directories. Preserve the torrent's
internal structure and original filenames.

Pass the work directory explicitly as the save path and disable automatic Torrent
management for the added task. qBittorrent places incomplete data outside watched
roots and moves completed data into the selected destination. Anishelf neither
moves nor renames originals. Different backend/downloader paths use the configured
prefix mapping; the deployment must provide equivalent shared storage.

## Reliable Download and Import

- Persist intent before external submission. Verify torrent identity with a parser;
  support v1 and hybrid torrents containing v1 metadata, not pure v2 torrents.
- Recheck authorization, scope, availability and configuration before sending.
  Bind an observed canonical hash with the managed category and intent tag.
- Repeated polling, retries and restart retain one reservation. Reconcile uncertain
  submissions before further action; no automatic resend after an unknown result.
  Explicit recovery queries the downloader before attempting to add again.
- Retain stale observations during outages. An externally removed task is suppressed
  across restart until explicit retry; paused tasks are never automatically resumed.
- Completion requires selected-file progress, supported single-video layout,
  confined file access, matching size/version and repeated downloader checks.
- Refresh Resources only for affected paths. Anime validates the actual file
  against the accepted work/episode and owns its association. Preserve manual
  decisions; conflicting files enter existing local Review.
- Mark available only after confirmed association and current source access.
  Import retries do not submit another download or trigger transcoding.

## User Feedback and History

The anime detail RSS panel has compact status and secondary subscription actions.
A collapsed Activity section combines selected/skipped releases and acquisition
outcomes. Display real download percentages and separate downloaded, verifying,
Review, import-failed and available states. Errors remain discoverable when the
section is collapsed. Open WebUI for transfer management; show Retry acquisition,
Retry import, Review or Settings only when relevant. Do not add speed/seeding
statistics, another task monitor or a global download page.

Persist task outcomes independently of subscriptions. Keep detailed terminal
history for 90 days, then remove private release payload/title detail while retaining
compact identities, source associations and suppression. Old expired evidence
cannot be resubmitted without a fresh release. Structured logs correlate intent,
command and ingestion outcomes without credentials or complete private URLs.

## Acceptance

| ID | Required evidence |
| --- | --- |
| ACQ01 | Old subscriptions require explicit activation; direct saves bind the displayed scope and destination without remote reads; paused/out-of-range episodes are not submitted. |
| ACQ02 | Supported RSS releases select automatically; uncertain titles, episodes and unsupported torrents remain unsubmitted with reasons. |
| ACQ03 | Repeated discovery, concurrency, timeout and restart do not create duplicate managed downloads. |
| ACQ04 | Destination and connection errors remain distinct; progress is truthful; transfer controls operate through WebUI. |
| ACQ05 | A completed mapped file becomes a real episode source and plays through existing media checks. |
| ACQ06 | Missing/unreadable/mismatched files are not available; import retry does not redownload. |
| ACQ07 | Disconnect, restart and externally removed/paused tasks preserve intent and user actions. |
| ACQ08 | Activity explains selected, skipped, uncertain and failed outcomes with appropriate recovery actions. |
| ACQ09 | WebUI task removal/data deletion and Anishelf library associations remain separate; suppression prevents automatic re-adding. |
| ACQ10 | With Watching automation disabled, Tracking reads/status changes cause no ongoing subscription changes; the disabled Watching worker creates no subscriptions; user pause preserves existing tasks. |
| ACQ11 | Safe correlated logs and actionable errors preserve local browsing/playback during remote failure. |
| ACQ12 | Enabling Watching automation previews existing entries and backlog scope; a newly Watching anime discovers a matching source without manual RSS entry, downloads a new episode and exposes it only after verified ingestion. |
| ACQ13 | Configured release preferences determine eligible sources/releases; no-match, ambiguous identity and site authentication/network failures remain visible without guessed downloads. |
| ACQ14 | Repeated refreshes, restart and remote outages preserve subscription intent, user settings and accepted scope without duplicate subscriptions/downloads; account changes do not reuse grants for new automatic creation. |
| ACQ15 | Watching creates missing subscriptions only; later status changes and automation disable do not change existing subscriptions; user overrides, transfers/imports and external-removal suppression survive reconciliation. |

Automated fixtures cover implementation behavior. Real RSS, supported qBittorrent,
shared-storage paths and browser playback remain required for ACQ01–ACQ11 acceptance;
these scenarios are not recorded as accepted by code delivery alone.

ACQ12–ACQ15 have automated implementation coverage and still require live acceptance with a real AniList account,
supported resource site/feed, qBittorrent and shared media storage. Existing RSS
fixtures do not establish acceptance of the Watching workflow. Current import
supports one selected episode video; season-pack ingestion remains deferred.

## Deferred

Manual release approval/dismissal, ranking across multiple sources, season packs,
quality upgrades, multiple clients, seeding/bandwidth/storage policy,
per-anime destination selection and automatic file renaming remain outside this
iteration. See [current architecture](current-architecture.md) for implementation.

The in-app editor for hand-written configuration files (including custom acquisition
and transcode profile YAML) is deferred under [O19](requirements.md#configuration-file-editor-o19).
Current profile loading and selection do not include file editing in the UI.


## Bundled qBittorrent Setup

The bundled deployment initializes a new qBittorrent configuration before the
service starts. It creates a random permanent password using qBittorrent's native
PBKDF2 representation, enables `/data/incomplete`, and sets `/data/media` as the
completed directory. A private connection volume carries the initial credentials;
Backend mounts it read-only. Development Compose, published Compose and Quadlet
share the same initialization script. Existing qBittorrent configurations are never
overwritten. Interrupted credential publication resumes from the pending file.

Acquisition imports deployment credentials only when no local connection record
exists. Saved manual configuration, including an explicit removal, wins on restart.
The worker retries initial setup without blocking application startup, selects the
resource root by its actual `/data/media` path, and reuses the existing destination
revision while retrying validation. Existing destinations from another connection
generation require explicit reconfiguration. Automatic setup grants no subscription
permission and does not assert completed-file visibility.

Authenticated users can request bundled WebUI credentials through a dedicated
CSRF-protected POST endpoint with `Cache-Control: no-store`. Normal connection
responses never include passwords. The UI keeps revealed credentials outside query
and mutation caches, hides them after 30 seconds or on backgrounding, and provides
copy controls. The separately configured browser WebUI URL remains independent of
the internal API address. Users changing credentials in WebUI must update the
Anishelf connection and reconfirm destination-bound permissions. Initialization,
validation, connection replacement and credential access emit sanitized events.
