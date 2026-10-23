# Subscription Interaction Redesign Plan

Date: 2026-10-24 (Asia/Shanghai).
Status: implemented on 2026-10-24. The user selected the Header row layout.
Application regression and responsive fixture verification are recorded below.

## Problem and intended experience

The current subscription UI exposes configuration explanations, automation ownership,
site-search attempts, matching releases, subscription enablement and download activity
as overlapping blocks. Users must discover a currently eligible source before a
search-based subscription can be saved. The resulting release samples look like a
selection task even though no release selection is required.

A user should be able to subscribe to a work, leave the page, and return to a short,
truthful status. Global configuration belongs in Settings. Work details show only
this work's subscription, current acquisition outcome and any action actually needed.
Playback and the existing episode list remain primary.

## Product decisions

- One subscription model and one editor for both manual and Watching-created work.
  Creation origin is optional detail, not a different management mode.
- Watching creates missing subscriptions with accepted defaults. Existing subscriptions
  are skipped; later user edits are never overwritten. Closing Watching automation
  stops future creation. Following later Tracking status changes is not included in
  the creation-only model. This changes current behavior and must be stated
  in the final implementation and settings copy.
- User cancellation removes the subscription and suppresses automatic recreation
  for that work/account until explicit opt-in. Existing transfers/imports continue.
- Normal subscription actions are Subscribe, Edit and Unsubscribe. Existing manual
  pause/resume can remain in the secondary menu; do not add a second automation pause.
- Source discovery is background work after subscription creation. An unreleased
  work or temporary absence of eligible releases does not prevent subscribing.
- A valid destination/account and usable defaults are required. Missing local setup
  produces one specific Settings action; a remote source outage does not erase intent.
- Global activation preview is a separate product decision. This UI refactor does
  not silently remove its authorization boundary. If retained, show a compact impact
  summary with the full affected-work scope available on demand.

## Information ownership

| Information | Home |
| --- | --- |
| Jackett connection, site order, default profile, refresh interval, destination, Watching policy and their explanations | Settings → Downloads |
| Subscribe/unsubscribe, effective work status and a relevant recovery action | Compact subscription row in work details |
| This work's source/start/profile overrides | Short subscription editor; secondary controls collapsed |
| Current transfer/import outcomes and actionable failures | On-demand Activity |
| Site attempts, release names, skipped reasons, preference-level evidence and timestamps | On-demand diagnostics inside Activity |
| Operation success/failure | Existing deduplicated Toasts |

Do not repeat full destination paths, profile descriptions, pause policy or global
setup instructions in the work header, editor and Activity. Preserve a concise
current target summary in the editor because it is relevant to the save decision;
full path/account details remain available on demand.

## Work detail layout

Use one compact subscription row beside/below the existing work actions, retaining
Play as the primary action. Do not append a second large subscription panel below
the episode list.

- Unsubscribed: `Subscription` and `Subscribe`.
- Subscribed: `Subscribed` + one short outcome + `Activity` and an actions menu.
- The menu contains Edit, Check updates, existing Pause/Resume where appropriate,
  and Unsubscribe. Remove duplicate Manage/Edit entry points.
- A background lookup does not expand the row or reset playback.
- If no subscription or activity history exists, omit the Activity entry.
- After unsubscribe, retained running tasks and failures remain accessible through
  Activity; do not imply that cancellation removed qBittorrent tasks or media.
- Use English product labels, original release filenames, accessible icon labels,
  shared controls and visible keyboard focus. Long text truncates with an accessible
  full-text affordance. Validate at 1280 px and 390 px.

## Subscription editor

The initial view contains a starting episode and one line showing effective defaults
(profile/source mode/destination label), plus Subscribe or Save changes.

`More options` reveals this work's profile override, source mode and custom RSS URL.
Automatic source selection is the normal path. RSS remains directly available for
users who already have a feed. Editing an existing selected source preserves it unless
explicitly changed. Source replacement requires a deliberate edit, not a silent
response to a temporary outage.

Remove the mandatory Find a source action, search-attempt lists, resource samples,
long dialog description, repeated RSS help and per-save ownership-conversion consent.
Optional source testing can live in diagnostics. A disabled save control must have a
specific visible reason, such as missing destination setup, not a generic paragraph.
Keep validation and stale-version conflicts beside the form, retaining entered values.

## Status and Activity

Subscription intent, discovery and task states remain separate internally. Present
one primary summary, using this display priority:

1. A current failure requiring user action: short reason plus the relevant action.
2. Active transfer/import: actual progress or the observed verification stage.
3. User-paused subscription: Paused; running tasks remain visible in Activity.
4. Source discovery: Finding a source.
5. Healthy empty discovery: Waiting for releases.
6. Healthy established subscription: Checking for updates, or Subscribed when idle.

A network failure is not Waiting for releases. Download complete is not Available;
only verified association/access makes an episode available. Do not claim caught-up
or complete backlog coverage from an empty or truncated site search.

Activity opens on demand in a bounded responsive dialog on desktop and mobile,
using one shared implementation. Default content shows active work and actionable failures
as compact episode/status/action rows. Finished history is a secondary disclosure or
paged view. Link available episodes to the existing playback/version flow rather
than duplicating playback controls.

Diagnostics is a separate disclosure within Activity. Group rejected observations
by reason/count, then reveal full release rows only when requested. Keep task and
release pagination independent and lazy-load diagnostic details. An active download
is represented once even when release evidence also exists. A collapsed Activity
entry still displays a needs-attention indicator. Map failures to relevant actions;
do not attach a generic Settings link to every error.

## Settings changes

Keep global setup in Settings → Downloads, ordered by task:

1. Sources: connection and ordered sites.
2. Download destination: connection, validated root/path and downloader WebUI.
3. Subscription defaults: profile, starting policy and refresh interval.
4. Watching creation: enablement and automatic-creation exclusions.

Use one short description per section. Put uncommon protocol/policy explanations in
help details or documentation. Do not duplicate the complete list of managed works
in Settings when work details already own their management; show an exclusion list
only where it is necessary to restore automatic creation.

## Backend and contract prerequisites

This is not a CSS-only change. The current subscription requires a resolved feed/source
identity and permission tied to it. Introduce a persisted, revisioned pending source
choice (`automatic` or explicit RSS), with nullable resolved binding, without a fake
feed ID. Persist user intent and the accepted target/start/profile scope at creation.

Discovery resolves a permitted configured site asynchronously. Bind the result and
its scoped authorization atomically after rechecking intent revision, account/source
configuration, destination and cancellation. No discovery result alone authorizes a
download. Edits, deletion and account changes fence late completions. Keep existing
source pinning, reservations, unknown-submission recovery, external-removal suppression
and ingestion behavior. Invalid or ambiguous matches remain unresolved.

Watching calls this same create operation; it does not need to find a source first.
Persist a concrete starting episode when the unified subscription is created, so an
existing subscription's scope does not move while discovery is pending. Watching
uses confirmed progress at that creation point. This deliberately replaces the
current pre-subscription discovery/admission-time calculation.

Replace automation-owned effective enablement with ordinary subscription controls.
Retain only the creation provenance and recreation-suppression records needed by the
creation-only policy. Migrate existing accepted lower bounds, pins, user pauses,
exclusions and download intent provenance without expanding permissions. Outstanding
automation-owned scope may not silently become independent manual authorization;
validity of the accepted grant must be checked during migration/explicit renewal.

Expose a compact subscription/discovery/activity summary for work details and fetch
full task history/diagnostics only on demand. UI states should derive from structured
application outcomes, not duplicated frontend guesses or raw error strings.

## Delivery sequence

1. Settle and document the unified creation-only model, cancellation suppression,
   starting-episode freeze point and grant migration. Update requirements/design.
2. Implement pending subscriptions and shared creation/resolution with safe logs and
   revision fencing. Cover no-result creation, cancellation/edits during discovery,
   atomic authorization and existing download/import regressions.
3. Replace the editor with the short default-first form and optional overrides.
4. Replace overlapping work-detail blocks with the compact row and one Activity
   entry. Move release evidence and search attempts into lazy diagnostics.
5. Simplify/reorder Settings, remove superseded copy/contracts and perform responsive,
   keyboard and real-service acceptance. Run Biome, lint, type checks and relevant
   application/frontend/architecture regression.

The first deliverable must make subscription creation possible before a matching
release exists. Merely hiding today's Find a source button or its explanatory text
would leave the underlying workflow problem unchanged.

## Acceptance criteria

- Both manually and automatically created subscriptions have the same editor/actions.
- Subscribing without any current release succeeds and survives navigation/restart.
- Normal creation has one save action and no preliminary search/preview of releases.
- The editor's initial state has no instructional paragraphs or global credentials/
  configuration form. Overrides remain available on demand.
- A healthy subscribed work adds only one compact summary row to the detail page;
  download history and skipped release evidence are not expanded by default.
- Failures remain discoverable while Activity is closed and expose an appropriate
  recovery action when opened. Temporary success/failure feedback uses Toasts.
- Manual edits are preserved; deletion does not trigger automatic recreation;
  accepted source/start/target changes cannot inherit stale download permission.
- In-flight transfers, import recovery and playback remain functional across edits,
  pause, unsubscribe and Watching-creation disablement.
- No page-wide horizontal overflow at 390 px or 1280 px; controls work with keyboard
  and touch. Polling preserves inputs, disclosure state and current playback.


## Delivery record

- Added migration `0010_unified_subscriptions`: nullable resolved source identity,
  persisted automatic discovery scope and optional Watching creation provenance.
- Shared subscription creation persists a fixed starting episode immediately.
  A bounded Subscriptions worker resolves sources later, with revision/configuration
  checks and atomic permission binding. Empty results retain the subscription.
- Watching now creates ordinary subscriptions and preserves existing ones. Its global
  control affects future creation, not ongoing subscription execution. Cancellation
  creates account/work recreation exclusions, including when Tracking is disconnected.
- Old automatically managed subscriptions retain pins/start/provenance but start
  paused without download authorization after migration. Save the reviewed scope
  and resume explicitly; old automation grants are disabled instead of being widened.
- Implemented Header row in local and remote work headers; editor defaults are short,
  overrides are disclosed, and Activity/History/Diagnostics are separated. Initial
  detail queries omit release evidence; diagnostics are fetched on demand. Activity
  ordering prioritizes failures and active tasks before finished history.
- Existing manual pauses survive edits; manual and Watching-created work use the same
  editor without a conversion checkbox. Settings now presents Sources, downloader,
  subscription defaults and Watching creation in that order.
- Full backend/frontend regression, Biome/lint/type/build checks and 390/1280 px
  isolated browser checks are used for delivery verification. Fixture proof does not
  establish real Jackett/qBittorrent/shared-storage/playback acceptance. No real
  account automation was activated during this refactor.
- Final regression: 82 backend files (1,178 passed, one skipped), 48 frontend files
  (369 passed) and 64 architecture checks passed. Biome, lint, type checks and the
  production build passed. The build retains its existing large-chunk warning.
