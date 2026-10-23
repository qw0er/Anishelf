# Watching Subscription Creation

This is a maintained operator guide for the iteration marked complete on 2026-10-24.
Requirements/design and verification evidence are [archived](../history.md#automatic-acquisition-archive-notes).

Watching is an optional way to create ordinary subscriptions. It is disabled by
default. Manual and Watching-created subscriptions share the same source discovery,
editor, pause/resume, cancellation, download and import workflow.

## Setup

In Settings → Downloads, configure Sources and their order, validate the downloader
and destination, then choose subscription defaults. In Watching automation, choose
confirmed progress plus one or episode 1, preview the scope, and confirm within five
minutes in the same authenticated session. The preview creates no subscriptions or
downloads; changed account/site/profile/target scope requires a new preview.

Existing Watching entries and future additions are eligible for creation. Existing
subscriptions are always preserved. Starting episode is fixed when the subscription
is created, even if source discovery must wait. Invalid, fractional or excessive
progress (at least 10000) does not create a progress-based subscription.

## Everyday behavior

- Click Subscribe on a work to create a subscription without a preliminary search.
  Automatic source selection uses the configured sites/profile; More options exposes
  an explicit RSS feed, per-work profile and source changes.
- Empty discovery shows Waiting for releases and retries. Service failures remain
  distinct from healthy absence. No match does not remove the subscription.
- Successful discovery pins the first configured site with an identity/episode/profile
  eligible release. A later site outage does not silently switch the pin.
- Watching checks every 30 seconds and creates at most five subscriptions per pass.
  Subscriptions separately resolves at most five pending sources per 30-second pass;
  unresolved discovery retries after five minutes. Check updates retries pending
  discovery immediately, subject to Sources transport limits. Configured source refresh is
  30 minutes by default. Capacity is 64 subscriptions and 500 current Watching works.
- Turning Watching off stops new subscription creation. Existing subscriptions keep
  working. Changing Tracking status, progress or account does not overwrite or stop
  existing subscriptions; use their ordinary controls.
- Edit, pause/resume and unsubscribe work identically regardless of origin. A manual
  pause survives edits. Unsubscribe records automatic-recreation exclusions, which
  can be cleared in Watching settings. Existing transfers/imports continue.

The Header row in work details shows one short state, Activity and an actions menu.
The editor initially shows starting episode and effective defaults. Activity shows
active downloads/imports and actionable failures. History and grouped Diagnostics
are secondary; release filenames and skipped reasons do not fill the page by default.
Diagnostics also shows the most recent source check, attempted sites and their
outcomes/coverage. It survives restart. Use qBittorrent WebUI for transfer controls
and seeding. Refreshed work details switch to the local episode view after ingestion.

## Recovery and upgrade

| State | Action |
| --- | --- |
| Waiting for releases | No action required; discovery will retry. |
| Discovery unavailable | Check site/downloader connectivity; existing intent is retained. |
| Source/profile/target changed while waiting | Review and save the subscription against the current configuration; late results cannot inherit stale permission. |
| Established pinned source changed | Explicitly edit the source; do not expect automatic source replacement. |
| Download/import failure | Open Activity and use the relevant retry/Review/Settings action. |
| Automatic creation excluded | Explicitly include the work again in Watching settings. |
| Subscription/work limit | Free subscription capacity or reduce Watching scope. |

Migration `0010_unified_subscriptions` preserves pins, starting scope, candidates,
manual permissions and submitted task history. Previous automation grants controlled
ongoing enablement; they cannot silently become independent subscription permission.
Previously managed subscriptions therefore start paused with authorization required,
and old Watching grants are disabled. Review/save each retained subscription and
resume it explicitly, or unsubscribe. Confirm Watching again only if future automatic
creation is wanted. This migration does not enable the real account.

## Verification record

The iteration is complete by the user's decision on 2026-10-24. Automated and
isolated-browser evidence, earlier user-reported manual acceptance and limits on
real Watching/source/downloader/playback verification are recorded in
[History](../history.md#automatic-acquisition-archive-notes). Deployment checks remain
useful after changing services, storage mappings or browser/media combinations.
