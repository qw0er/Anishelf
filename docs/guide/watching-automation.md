# Subscriptions and Watching

Subscribe manually from a work's details, or opt into automatic creation from your
the connected account’s Watching entries, including Rewatching where supported. Manual subscriptions are independent; Watching subscriptions belong to an automatic group. Both share source selection, download and import processing.

## Setup

1. In **Settings → Downloads**, configure [Sources](jackett-setup.md), their order,
   the downloader, a validated destination and subscription defaults.
2. On a work, choose **Subscribe**, review the starting episode and save.
3. For Watching automation, choose progress plus one or episode 1 and select
   **Enable**. Review the work count, starting policy and
   download destination in the confirmation dialog. Expand **Work details** to see
   the starting episode and status of each work. Confirm within five minutes in
   the same login session.

Watching automation appears first in Downloads. Select **Save** to review and
confirm changes to an enabled setup.
Use **Subscriptions** in the main navigation for the subscription inventory and
per-work inclusion or exclusion; work subscription states open structured details. Its activation preview uses the
current global release profile in **Subscription defaults**. Every automatic
subscription follows that default, including subscriptions created before an upgrade.
Changing it re-evaluates unreserved choices without another activation preview;
existing previews remain valid and confirmation uses the current default. Reserved
and submitted downloads retain their selection. An unavailable default blocks new
choices; choose an available profile in Settings to recover. Manual subscriptions
retain their explicit profile or follow-default behavior.

Watching is off by default. Its preview creates no subscriptions/downloads. Changed
account/site/target scope requires a new preview. Invalid or fractional progress,
or progress of at least 10000, cannot create a progress-based subscription.

Watching and Rewatching share active membership, including previews and the 500-work
limit. Library’s Watching filter includes both; the Rewatching filter stays exact.
Progress belongs to the current viewing pass: progress 3 selects episode 4 next,
subject to local availability and version selection. Progress-only synchronization
preserves Rewatching and never resets progress automatically. Local playback positions
and history remain independent. Existing files are reused under the usual coverage
and duplicate-acquisition checks.

## Everyday behavior

| Action / state | Result |
| --- | --- |
| Subscribe | Save intent immediately; no preliminary search needed |
| More options | Override profile, use an explicit RSS feed or edit the source |
| No eligible releases | Retain intent and retry discovery; distinguish empty results from service failures |
| Successful discovery | Pin the first eligible configured site; later outages do not switch it |
| Starting episode | Fixed at creation, even while waiting for discovery |
| Manual pause/resume/edit | Independent controls; manual pause survives edits |
| Automatic subscription | Managed on the Subscriptions page; exclude/include individual works |
| Convert to manual | Review and save the work editor; automatic management ends and the saved settings take precedence |
| Unsubscribe | Record a Watching recreation exclusion; submitted transfers/imports continue |
| Disable Watching | Stop automatic creation, discovery, refresh and new submissions; manual subscriptions and submitted downloads/imports continue |
| Leave/rejoin the active group | Pause/resume automatic acquisition; preserve the starting episode and follow the current default |
| Switch between Watching and Rewatching | Keep the same automatic subscription, starting episode and source configuration |
| Account or accepted scope changes | Stop automatic acquisition until a fresh preview is confirmed; never adopt another account’s subscriptions |
| Full local coverage | Mark completed and stop acquisition for either subscription type; keep configuration and history |

Watching and pending-source discovery each run every 30 seconds, at most five works
per pass. Unresolved discovery retries after five minutes; **Check updates** bypasses
that local wait and collection cache while respecting transport limits. Source refresh defaults to 30
minutes. Limits are 64 subscriptions and 500 current Watching or Rewatching works.

## Airing-aware searches

Manual and Watching subscriptions both wait when fresh, consistent metadata shows
that the first missing episode in their accepted range has not aired. With a precise
airing instant, the planned resource check is 15 minutes after that instant. There
are no periodic pre-airing resource searches. A fresh not-yet-released status without
an exact time waits for updated information; a calendar date never becomes midnight
or an assumed broadcast time. Metadata is re-evaluated every 30 seconds using its
cache, and upcoming/releasing detail metadata is revalidated at least every six hours.

**Check updates** can search before airing and bypasses ordinary collection-cache
reuse. Source cooldowns, rate limits, coalescing and download authorization still
apply. Source evidence refreshed for another consumer can supply eligible early
resources without an extra request. Airing timing never authorizes or rejects a
release by itself, and reserved or submitted downloads retain their choices.

Already aired gaps continue normal discovery or source polling even if a later
episode is upcoming. Only verified local episodes cover a gap; tracking progress,
reservations and incomplete downloads do not. An accepted starting episode beyond
the known next episode does not acquire an extrapolated broadcast time.

Missing, stale, contradictory or unavailable airing information restores bounded
ordinary retries instead of suspending searches indefinitely. This deliberate fallback
can search before the last reported broadcast time when that information is no longer
reliable. Diagnostics distinguish fallback from a confirmed future airing window.
Changes to the airing time replan the deadline; restarts do not add another delay.
All instants are compared as epoch milliseconds and displayed in the browser's local
IANA time zone, including the zone label and daylight-saving offset.

Completion requires every episode from the saved starting episode through a known
integer total to be verified and locally available. Unknown totals, tracking progress,
downloading and pending imports do not establish completion. Completed subscriptions
are not recreated or reopened merely by entering Rewatching. **Resume subscription**
explicitly resumes acquisition without immediately completing the same range again. A later increase in the metadata
episode total rechecks coverage and can reopen acquisition, subject to manual pause
and automatic-group controls. Removing files alone does not resume a completed subscription.
Coverage is checked every 30 seconds using metadata and local availability; completed
subscriptions stop source polling, not metadata checks.

Use **Activity** for active tasks and recovery, **History** for past work, and
**Diagnostics** for the latest source attempts, results and skip reasons. Transfer
controls and seeding stay in qBittorrent WebUI. Imported files appear in the local
episode view after verification.

## Recovery and upgrade

| State | Action |
| --- | --- |
| Waiting for releases | Wait for retry, or use Check updates |
| Discovery unavailable | Check service/site connectivity; intent is retained |
| Source/target changed | Review and save against current configuration |
| Global default profile unavailable | Choose an available release profile in Settings |
| Pinned source unavailable | Repair it or explicitly edit the source |
| Download/import failure | Use Activity's retry, Review or Settings action |
| Automatic creation excluded | Include the work again on the Subscriptions page |
| Capacity reached | Free subscription capacity or reduce Watching scope |
| Automatic subscription paused before migration | Confirm Watching settings and explicitly include the excluded work again |

Migration `0010_unified_subscriptions` retains pins, starting bounds, candidates,
manual permissions and task history. Old automation grants are disabled and formerly
managed subscriptions require review. See [History](../history.md#automatic-acquisition-archive-notes)
for archived design and acceptance evidence.

Migration `0012_subscription_lifecycle` moves Watching-created records into the automatic
group, preserves manual subscriptions and maps old automatic pauses to exclusions.
Ambiguous account ownership stays stopped until an explicit activation preview binds
an unowned record; known ownership is never reassigned across accounts. Review automatic
settings after upgrade, especially if an old automatically created record was edited
manually without changing its creation marker.

Migration `0021_watching_default_profile` removes saved automatic profile bindings
without changing account ownership, accepted starting episodes, sources, exclusions,
pauses, completion, authorizations or history. Manual profile overrides are retained.
Default changes invalidate old unreserved choices immediately. The 30-second
subscription cycle re-evaluates cached source entries and retries pending discovery;
it does not silently switch an already selected source or broaden accepted scope.

Migration `0022_subscription_airing_schedule` adds nullable advisory search timing.
Existing subscriptions are evaluated lazily without changing their revision, accepted
starting episode, ownership, pause/completion state, authorization or candidate history.

## Accepted download targets

Anishelf keeps the work, episode and metadata snapshot accepted when a subscription
release is reserved or an individual episode's release is selected. After verifying
client task ownership, completion, confined file access, size and source version,
a task with exactly one selected video is associated directly with that target.
Missing names, parser failures and contradictory filename titles or episode numbers
are advisory; they do not block ingestion. The retained snapshot supports ingestion
without another metadata request, including after restart or cache pruning.

Routine scans reuse confirmed download associations for the same source version.
An accepted download can correct an association explicitly created by automatic
identification. Manual confirmations and rejections, conflicting download targets,
and legacy decisions whose origin is unknown remain protected. Multiple selected
videos and season packs without explicit episode mappings still require Review.
Transfer completion remains distinct from verified library availability and playback.

Local Review diagnostics show the accepted episode, release and any filename hint.
Catalog contention retries with backoff. Changed files or failed ownership and path
checks retain their verification/recovery behavior. Editing a confirmed association
is a manual decision that takes precedence over subsequent download retries.

Migration `0023_accepted_acquisition_targets` adds accepted targets to download tasks
and decision provenance to local Review. Existing decisions are conservatively
marked as legacy. Older tasks fill their accepted target from cached metadata where
possible, otherwise by fetching the already-known work ID rather than searching by
filename. A pending system review caused only by the old filename-target rule is
retried once if it has no manual decision or associations. Other reviews keep their
existing recovery controls. Task snapshot pins are released when task history is
pruned; Catalog retains its own confirmed-decision references independently.
