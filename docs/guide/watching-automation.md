# Subscriptions and Watching

Subscribe manually from a work's details, or opt into automatic creation from your
AniList Watching list. Both produce the same editable subscription.

## Setup

1. In **Settings → Downloads**, configure [Sources](jackett-setup.md), their order,
   the downloader, a validated destination and subscription defaults.
2. On a work, choose **Subscribe**, review the starting episode and save.
3. Optionally enable **Watching automation**: choose progress plus one or episode 1,
   preview the scope and confirm within five minutes in the same login session.

Watching automation appears first in Downloads. Its activation preview uses the
saved release profile in **Subscription defaults**; there is no separate automation
profile to configure. Save a changed default before previewing again. Existing
subscriptions retain their saved profile and starting episode.
Changing that default stops future automatic creation until you preview and confirm
the new scope; a preview prepared against the old default cannot be confirmed.

Watching is off by default. Its preview creates no subscriptions/downloads. Changed
account/site/profile/target scope requires a new preview. Invalid or fractional
progress, or progress of at least 10000, cannot create a progress-based subscription.

## Everyday behavior

| Action / state | Result |
| --- | --- |
| Subscribe | Save intent immediately; no preliminary search needed |
| More options | Override profile, use an explicit RSS feed or edit the source |
| No eligible releases | Retain intent and retry discovery; distinguish empty results from service failures |
| Successful discovery | Pin the first eligible configured site; later outages do not switch it |
| Starting episode | Fixed at creation, even while waiting for discovery |
| Pause/resume/edit | Same controls for every subscription; manual pause survives edits |
| Unsubscribe | Record a Watching recreation exclusion; submitted transfers/imports continue |
| Disable Watching / change Tracking status, progress or account | Stop/alter future creation; existing subscriptions continue with their saved settings |

Watching and pending-source discovery each run every 30 seconds, at most five works
per pass. Unresolved discovery retries after five minutes; **Check updates** bypasses
that local wait while respecting transport limits. Source refresh defaults to 30
minutes. Limits are 64 subscriptions and 500 current Watching works.

Use **Activity** for active tasks and recovery, **History** for past work, and
**Diagnostics** for the latest source attempts, results and skip reasons. Transfer
controls and seeding stay in qBittorrent WebUI. Imported files appear in the local
episode view after verification.

## Recovery and upgrade

| State | Action |
| --- | --- |
| Waiting for releases | Wait for retry, or use Check updates |
| Discovery unavailable | Check service/site connectivity; intent is retained |
| Source/profile/target changed | Review and save against current configuration |
| Pinned source unavailable | Repair it or explicitly edit the source |
| Download/import failure | Use Activity's retry, Review or Settings action |
| Automatic creation excluded | Include the work again in Watching settings |
| Capacity reached | Free subscription capacity or reduce Watching scope |
| Previously managed subscription paused after migration | Review/save and resume; confirm Watching again if future creation is wanted |

Migration `0010_unified_subscriptions` retains pins, starting bounds, candidates,
manual permissions and task history. Old automation grants are disabled and formerly
managed subscriptions require review. See [History](../history.md#automatic-acquisition-archive-notes)
for archived design and acceptance evidence.
