# Automatic Acquisition: Current Iteration Requirements

Date: 2026-10-20. Implementation is delivered; real deployment acceptance remains
pending. No release number is assigned. The current iteration completes automatic
acquisition using one RSS feed per anime and one qBittorrent instance.

## Workflow

Choose an anime → preview its RSS and starting episode → confirm automatic
acquisition and its destination → select one eligible release per regular episode
→ submit reliably → observe qBittorrent → verify completed files → associate actual
resources → expose playback through the existing episode list.

The delivered RSS discovery and account settings remain part of this workflow.
Anishelf owns acquisition intent and verified ingestion. qBittorrent WebUI owns
transfer controls, seeding, task removal and downloaded-data deletion. There is no
global Downloads page or duplicate transfer-management interface in Anishelf.

## Subscription and Selection

- Keep the existing RSS URL, starting episode, explicit scope preview and
  enable/pause controls. RSS does not guarantee a complete historical backlog.
- Select one supported regular-episode release automatically; preserve a valid
  previous choice, otherwise use publication time and stable identity. Skip
  uncertain identity/numbering, packs, specials and unsupported links visibly.
- Exclude accessible local episodes and known downloader tasks. Reserve canonical
  torrent hashes and work/episode identities before automatic submission.
- Existing subscriptions remain discovery-only until a fresh scope preview is
  confirmed. A new confirmation enables acquisition only when a validated download
  destination is included in that preview. Configuration changes invalidate it.
- Pausing stops future submissions while existing transfers and imports continue.
  AniList status changes do not enable, pause, cancel or delete acquisition.

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
| ACQ01 | Old subscriptions require confirmation; new previews show scope and destination; paused/out-of-range episodes are not submitted. |
| ACQ02 | Supported RSS releases select automatically; uncertain titles, episodes and unsupported torrents remain unsubmitted with reasons. |
| ACQ03 | Repeated discovery, concurrency, timeout and restart do not create duplicate managed downloads. |
| ACQ04 | Destination and connection errors remain distinct; progress is truthful; transfer controls operate through WebUI. |
| ACQ05 | A completed mapped file becomes a real episode source and plays through existing media checks. |
| ACQ06 | Missing/unreadable/mismatched files are not available; import retry does not redownload. |
| ACQ07 | Disconnect, restart and externally removed/paused tasks preserve intent and user actions. |
| ACQ08 | Activity explains selected, skipped, uncertain and failed outcomes with appropriate recovery actions. |
| ACQ09 | WebUI task removal/data deletion and Anishelf library associations remain separate; suppression prevents automatic re-adding. |
| ACQ10 | Tracking reads/status changes cause no acquisition changes; subscription pause preserves existing tasks. |
| ACQ11 | Safe correlated logs and actionable errors preserve local browsing/playback during remote failure. |

Automated fixtures cover implementation behavior. Real RSS, supported qBittorrent,
shared-storage paths and browser playback remain required for ACQ01–ACQ11 acceptance;
these scenarios are not recorded as accepted by code delivery alone.

## Deferred

Advanced release filters, manual release approval/dismissal, multi-source search,
season packs, quality upgrades, multiple clients, seeding/bandwidth/storage policy,
per-anime destination selection and automatic file renaming remain outside this
iteration. See [current architecture](current-architecture.md) for implementation.
