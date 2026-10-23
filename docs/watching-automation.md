# Watching Automation

Watching automation is disabled by default. It uses the authenticated Tracking
account's complete confirmed list; pending local progress commands cannot authorize
a download. Anishelf owns policy and ingestion. Jackett supplies release evidence,
and qBittorrent continues to own transfers and seeding.

## Setup and activation

1. Connect the Tracking account. Configure Jackett and explicit source sites in
   Settings, in the order they should be searched.
2. Configure the qBittorrent connection, select a resource root and download path,
   then validate the destination. The downloader's incomplete path must be separate
   from watched resource roots.
3. In Settings → Downloads → Watching automation, choose a release profile and
   starting policy. The default is confirmed progress plus one; From episode 1 is
   available. Profiles load at startup; custom-profile hot reload remains deferred.
4. Select **Preview Watching automation**. Review the destination, site order and
   every current Watching work. Previewing refreshes Tracking but performs no
   per-title source searches and grants no download permission.
5. Select **Confirm and enable Watching automation** within five minutes, in the
   same authenticated session. Changed scope/configuration requires a new preview.
   Future Watching entries inherit the accepted policy without per-title approval.

Starting episodes in the preview are estimates until successful admission. If
source discovery remains unresolved, a later retry uses current confirmed progress.
After admission the starting episode is frozen, including across grant renewal and
restart. Progress is viewing state, not evidence of local files. Noninteger,
negative or excessive progress (at least 10000) cannot create a progress-based
subscription; correct Tracking or explicitly choose From episode 1.

A 30-second worker admits at most five works per pass. Unresolved discovery retries
after five minutes. There are at most 64 subscriptions in total and at most 500
current Watching entries in an activation scope. Capacity failures are visible;
freeing subscription capacity allows a later retry. Retained ownership/exclusion
records for old works do not consume the current Watching limit.

## Controls and policy

- **Disable Watching automation** stops new managed acquisitions immediately.
  Submitted transfers, verification and ingestion continue. Manual subscriptions
  retain their own settings.
- **Pause automated acquisition** persists a per-work manual pause. Returning to
  Watching does not clear it; use Resume automated acquisition.
- **Exclude from automation** persists an opt-out. Removing a managed subscription
  also creates this opt-out. Only explicit inclusion permits recreation.
- Paused, Dropped, Completed, Planned and Rewatching suspend managed acquisitions.
  Returning to Watching resumes only eligible work without manual pauses/exclusions.
- Missing entries in a healthy complete list suspend acquisition. Stale, partial,
  failed or disconnected reads block new acquisition while retaining subscriptions.
- Existing manual subscriptions are never adopted. Editing and saving a managed
  subscription requires explicit consent to convert it to manual ownership. This
  form also supports per-work source and starting-episode changes.

The management list links each work to its detail page. Subscription details show
why automation is suspended and link back to Settings.

## Recovery

| State | Action |
| --- | --- |
| No eligible source | Check work identity and release preferences; the worker retries without guessing an identity or downloading a pack. |
| Discovery unavailable | Check site/downloader connectivity and credentials; failed site reads remain distinct from no eligible results. |
| Tracking unavailable | Reconnect if necessary; the Tracking owner controls retry/backoff. Stale results grant no permission. |
| Tracking account changed | Preview and confirm for the current account. A subscription owned by another account stays blocked until explicitly removed or converted to manual. |
| Source/profile/destination changed | Review configuration, validate the destination if needed, then preview and confirm again. |
| Pinned site removed | Open the work's subscription, explicitly choose a new source and consent to manual management. Automation never silently picks another site for existing work. |
| Subscription limit | Remove an unwanted subscription; reconciliation retries after capacity is freed. |
| Work limit | Reduce current Watching scope below 501 entries before activating. |

After explicit source-grant renewal, an existing pin can use the newly accepted
connector generation only if that same site is still configured. Old unsent
permissions do not automatically inherit new credentials. New accounts do not
inherit another account's grants. Repeated polling/restarts preserve ownership,
reservations and externally removed-task suppression.

## Verification boundary

Automated fixtures cover policy, revision/session/CSRF checks, rollback, ownership,
source renewal, scope freezing, backoff, shutdown and the real Downloads application
with fixture transfers/resources/ingestion callbacks. A narrow browser preview uses
isolated fixture data. These checks do not enable the user's account.

The user reported live acceptance of the preceding manual search → activation →
qBittorrent → verified ingestion → playback flow. Live Watching acceptance remains
pending: explicitly activate a reviewed real scope, add a new Watching work, verify
its source and episode, observe one transfer and verified local playback, then check
suspension/re-entry and manual overrides. Keep that evidence separate from fixtures.
