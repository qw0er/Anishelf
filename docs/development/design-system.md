# Anishelf Design System

This document owns the shared UI principles, visual conventions, interaction,
feedback and accessibility rules. [Requirements](../requirements.md) owns product
scope, [Architecture](architecture.md) retains module boundaries, and
[Archived anime-library design](../history.md#anime-library-design) records the delivered poster
wall, work details, Files and Review screens. [History](../history.md#v2-design)
preserves earlier version-specific implementation design.

- [UI principles](#ui-principles)
- [Visual and interaction conventions](#visual-and-interaction-conventions)
- [Feedback and interface states](#feedback-and-interface-states)
- [Accessibility and responsive layouts](#accessibility-and-responsive-layouts)

## UI principles

Keep the interface simple and focused on the user's current task. Present the
information and actions needed to make the next decision; avoid dense screens,
duplicated status, decorative metrics, and controls for unsupported or unrelated
features.

Place persistent information in the page structure. Information that users need
to keep referring to, such as resource details, durable status, validation errors,
and setup guidance, belongs in the relevant page section or beside its control.
Present temporary information, such as operation progress, completion results,
and recoverable operation failures, in nonblocking floating UI such as Toasts or
floating task panels. Temporary feedback must not occupy page layout space or
insert banners, rows, or panels into the page structure. Choose placement by how
long the information remains relevant to the user's task, not by whether its data
is persisted in storage.

Establish a clear hierarchy. Web playback is the primary workflow, while optional
actions such as copying a media link remain visually secondary. Show a concise
summary by default and put diagnostic or less frequently needed detail behind a
clear, on-demand affordance. Reveal additional controls only when they are relevant
to the current page, item, or state. Do not hide information required to understand
an error, status, or consequential action.

Keep the active library workflow available while background preparation runs.
Show enough task status to understand what is happening and what can be done next;
avoid making progress monitoring a competing page or interrupting usable browsing
and playback.

## Visual and interaction conventions

Use Tailwind defaults, shared shadcn controls and Vidstack's native control styling.
Keep common page spacing and layout in shared CSS rather than duplicating theme
values. TanStack Query owns server data, request deduplication, polling and invalidation.
Routes preload the same query keys and preserve navigation/error UX; they do not own
a second mutable server snapshot. Components own transient form and player state.
Cancellation and stale-response guards prevent departed views from publishing results.

Keep lists compact with aligned actions. Truncate long names where needed and make
the full name available through an accessible Tooltip. Communicate status with shape
and text as well as color. Give icon-only controls accessible names and visible
keyboard focus.

When space allows, label buttons with an icon and text. When space is constrained,
use an icon-only button with a Tooltip that names the action. The Tooltip must not
replace the control's accessible name or visible keyboard focus.
Use short visible verbs such as Save, Edit, Test and Disconnect; retain the specific
action in the accessible name and Tooltip. Measure the action container, rather
than only the viewport, so bounded forms and side panels compact correctly.
Keep busy feedback on the action's existing icon and `aria-busy` state.

Labels, units and inputs should explain ordinary fields without repeating their
meaning in helper paragraphs. Keep non-obvious behavior in keyboard/touch-accessible
info Tooltips beside the label. Keep errors and required recovery steps visible.
Use inline native radios for short finite choices, including subscription source modes.
The viewing progress editor uses a status dropdown and a numeric stepper. Catalog filters use labeled dropdown selectors. Use the shared transcode-style radio
cards when choices have descriptions. Keep service-populated lists such as source
sites and resource directories as selectors; do not render an unbounded radio list.

Use one shared page container (72rem maximum) and title alignment for Library,
Files, Review, History and Settings. Use the shared page header for title,
description and page actions; keep scan/stale status beneath it. Settings uses
full-width section panels with a desktop description column and a bounded form
column, stacking on mobile. Do not narrow the entire Settings page.
Section descriptions are optional: omit text that only repeats the heading and
field labels. All five Settings tabs use the same spacing, concise action controls
and visible validation rules. Tab navigation retains every destination on narrow
screens through icons, Tooltips and accessible names.

Library settings uses 36px read-only directory fields matching the add-path input,
aligned add/remove actions, a single add-path row and a compact
cache-budget input. Long paths have a full-value Tooltip; directory rules and cache
semantics are available through label help. Scan locks and directory limits remain
visible. Playback lays out descriptive mode and profile cards in two columns when
space permits, stacking on narrow screens. Custom-player entries use separated rows
with their templates available on demand; name and template fields share a row on
wide screens. Keep browser-only storage scope visible.

Account settings places account identity and a concise Connected/Disconnected state
in the left title/description column, with authorization and credential-preview
actions together in the form column. Connection-check details use an info Tooltip;
reconnection requirements and failed connection checks stay visible. Credential instructions
belong in label help; account replacement consequences stay visible in confirmation.
Security places current password above a responsive new-password/confirmation pair,
with equal-height label rows so help icons do not offset the inputs,
then Change password and Sign out on one action row. Keep password-change consequences
visible and limits/link-access details available through info controls. Never hide
validation failures or change credential submission and confirmation semantics.

Downloads orders Watching automation first, then Subscription defaults, Jackett
sources and qBittorrent. Watching has no independent release-profile selector:
activation previews use the saved Subscription defaults profile, never an unsaved
draft or an older automation profile. Discard the visible confirmation when that
default changes. A preview and explicit confirmation still authorize the captured
scope; existing subscriptions retain their saved profile and starting episode.
Show Watching status in the left title/description column as Enabled or Disabled.
Keep blocking reasons beside that status; do not repeat the state above the form.
On mobile, the same header summary stacks above the controls. Show the two
starting-episode choices as the same bordered radio cards used by profile selection,
side by side where space allows.
The server accepts only the current subscription default for activation and fences
both pending confirmations and automatic acquisition when that default changes. The
existing `profile_changed` state prompts a fresh preview and confirmation.

Jackett and qBittorrent show a compact endpoint/source summary above their shared connection disclosure, field grid and
Save/Test/Disconnect action styling. Connection settings show a concise
configured/unconfigured summary. Open first-time
setup by default and disclose saved connection fields on demand. Connection Save appears only inside the editor; Test and management links remain available while collapsed. Disconnect and bundled-service switching belong in a More menu. Jackett keeps site
priority and its separate Save sites action available independently of connection editing; adding sites uses a bounded selector instead of a second list. Connection and site saves preserve the other editor’s draft; search
diagnostics remain collapsed. qBittorrent groups API access, destination and the
optional browser URL in one panel. Saved destinations show a directory/path summary with Edit and Validate actions; first-time setup opens the fields. Optional browser URL fields remain collapsed while the saved WebUI link stays accessible. Saved credentials remain blank; a short placeholder
explains keeping them, and label help explains when re-entry is required. Showing,
hiding and copying bundled credentials retain their existing lifetime and cache
restrictions. A saved connection is not evidence of successful network access.
Service-test counts and successful saves use Toasts, without adding persistent
confirmation rows; unresolved setup and validation failures stay in context.

Use 24px section gaps, compact list rows and consistent rounded-lg bordered
panels. Browsing lists use separators rather than a card around every row.
Poster grids have two mobile columns and adapt desktop columns to a minimum
card width. Reserve two title lines and one availability summary; keep cache
information on detail pages. Whole cards open work details with matching hover
and keyboard-focus feedback. Cards show format/year, a compact viewing-status
badge with cumulative progress (for example, `Watching 1 / 12`), and one local
availability line (`Local 0 / 12`). Unknown totals omit the denominator. Movies
use a single local-availability slot. Show an additional unwatched-availability
hint only when its count is positive. Card Tooltips and screen-reader text retain
the source and full meaning of the compact counts; do not add nested buttons to
whole-card links or repeat the remote-only availability sentence. When the server
resolves a next unwatched playback target, show a separate poster-corner Play
control as a sibling of the card link. Hide it when no target exists. Link directly
to the player only when the target has one available version; multiple versions
open the detail version chooser. Never auto-select a version on the card.

Catalog search submits with Enter or its search button. Sorting and discrete
filters apply immediately and reset pagination. Put secondary filters in an
expandable panel and show removable applied-filter labels. Preserve URL state,
return focus and scroll. Restore the last applied Library filters when returning
to Library in the same tab session; explicit URL filters take precedence. The
Library defaults its AniList viewing-state filter to Watching and offers All
viewing states as an explicit choice. The Library toolbar keeps search, Filters,
sort and the AniList action on one row. Sort opens a compact radio-choice menu with
the current choice marked; fixed filters use labeled dropdown selectors in the expandable
panel. Refresh uses an icon button with a Tooltip and an
accessible name. On narrow screens, compact action icons and a bounded sort
control preserve search space. AniList account actions share one row when space
allows and wrap naturally on narrower screens. The application header always stays on one line.
Navigation measures the full translated content against its available width and uses
text when it fits, otherwise icons with
Tooltips and accessible names. If icons still do not fit, scroll only the
navigation horizontally with its scrollbar hidden; keep the brand visible and preserve keyboard access.
Omit routine filesystem-monitoring confirmation; retain degraded-monitor warnings.

Work detail prioritizes the header and episode list. Align the cover and core
information at the top; the cover keeps its 2:3 aspect ratio and does not stretch
with the information column. Show the title, alternative titles, viewing state and
a short strip of format/year/release-status badges and inline labeled episode
counts and known dates. Bound the information column to a readable width; do not
spread metadata across equal columns spanning the page. Use readable release
status labels. Keep unknown dates in More metadata instead of empty header cells.
Place viewing state and the primary playback action together below a short divider;
the progress edit action is a small tertiary button. Alternative titles use two lines;
show an expansion control only when the rendered text exceeds that height, and
remeasure when its width changes. Keep provider attribution/links and secondary
metadata in More metadata on both local and remote-only details. Label the viewing
edit action "Edit progress". Long titles and actionable errors may grow the header naturally. AniList viewing state is a
compact row inside the title/metadata header on both local and remote details.
Local details place a primary `Play episode N` action directly below that row.
It targets the first available unwatched episode and opens the version chooser
when several versions are usable. Disable it with an explanatory Tooltip when
tracking progress is unavailable, the work is caught up, or no unwatched episode
is available locally. Remote-only details omit the action.
Use a status Badge, cumulative progress and the provider's total episode count;
unknown totals show only the watched count. Keep the cumulative-progress explanation
in a keyboard/touch-accessible Tooltip. Episode lists do not repeat the header's
progress summary or its explanatory paragraph. Put a positive unwatched-availability
count beside the episode heading with its own accessible explanation Tooltip;
omit zero counts. Episode rows use short Watched/Unwatched labels, with the AniList
source explained at the list/header level. Keep a fixed-size refresh button in the
summary and Library toolbar; its Tooltip contains the last update time and, only
when stale, the saved-data explanation. Refreshing changes only the existing icon
and aria-busy state, without an extra badge, spinner or cache-feedback row. Show a short loading skeleton until a
complete list snapshot establishes whether an entry exists. Reconnect guidance and
initial-read failures remain visible in the row. The summary wraps on narrow screens. An Edit AniList progress action opens a shared
dialog on local and remote-only details. Keep confirmed remote values and pending
intent visibly separate. Progress accepts explicit backward corrections; status
changes are explicit choices. Show revision/validation errors beside the form,
retry timing and conflict choices in the dialog, and submission lifecycle/results
in deduplicated app-level Toasts with a work-detail recovery action. Network failure
must retain editable input and persisted intent.

Anime details keep Web playback as the primary episode action. A single available
version orders controls as compatibility status, shared Files action menu, then Play.
Association correction is a menu item targeting the specific file review, composed
by Anime through the resource-action slot. The same menu includes Show in Files, which resolves the current parent directory
on demand and scrolls to, focuses and highlights the corresponding file row without
starting playback. The version chooser uses the same menu;
unavailable versions retain their correction link without file commands.
Multiple available versions open the version chooser; each available version has
its own Play and file-action controls. Unavailable versions expose no file commands.
The same menu provides external players, original links/downloads/playlists and
preparation controls, while Anime supplies the association-correction menu item.
App supplies the cross-feature composition through a typed resource-action slot;
Anime does not depend on App or Media/Playback UI internals. Compatibility queries
are bounded, account for resource scope and the selected source version, and known
source conflicts disable the affected menu. Web playback retains work, episode,
source-version and Library return context. Existing command feedback and logs apply.

Episode numbering guidance is an info icon beside the episode heading with a
keyboard/touch-accessible Tooltip. Files to review use a secondary compact disclosure
below the episode heading, with candidate links and pagination inside. Hide the
disclosure after a successful empty first-page response; omit page-size counts
rather than implying a total. Keep loading and errors visible while collapsed,
and retain pagination when a later page becomes empty. Candidate guidance belongs
in a Tooltip. Do not add persistent instructional footnotes or global review/Files
links below the episode list; corrections use the file action menu and
version chooser, and Files remains accessible through the main navigation.

Provider airing schedules use a compact table in the detail sidebar, beside the
episode list, with a loaded-record count. Keep the provider numbering explanation
in an accessible Tooltip. The table shows episode, local date/time and status in
aligned columns sorted by broadcast time; cap its height and scroll it rather than
pushing the remaining sidebar sections away. Cached records are unverified;
pagination must not imply a complete schedule or identify the next broadcast from
an unordered partial response. Loading, cache markers, partial warnings and read
failures remain visible in the panel.

Group secondary metadata, synopsis and relationships into on-demand sections; keep
the airing schedule visible in the sidebar and actionable errors and unresolved
candidates discoverable. Files identification uses a compact focusable status icon
with a Tooltip.
Review and associated work/episode links belong in the file action menu.
Keep action menus focused on choices and commands; put explanatory guidance in
Settings and report invocation failures through Toasts.
Keep compatibility and task status outside action menus. Put shared choices in
Settings. The preparation panel is a nonblocking active-task monitor, not a dedicated
page.

Settings ends with an About tab at `/settings?section=about`, using one compact
Settings panel. Keep the project description, links and license in the left column;
place the current version and Check action on one row in the right column. Collapse
separate Web/Backend commits and build dates under Build details, opening them when
builds differ; keep the mismatch warning visible. Update checks
are manual; keep the last successful result and its timestamp visible, distinguish
failed checks from current versions, and use the existing action spinner and Toasts.
Development, testing and prerelease builds never claim to be the latest stable build.

## Feedback and interface states

Empty page/list states use the shared icon-and-text placeholder, with a relevant
next action when available. Apply the same presentation to Library, History,
Files and Review; do not replace failure feedback with an empty-state message.


Use deduplicated Toasts for operation results and recoverable playback or subtitle
failures. Keep ongoing subtitle-preparation feedback visible until completion,
failure, or selection cancellation. Reuse existing retry actions.
Baseline anime identification uses one app-level, deduplicated loading Toast,
kept visible through matching and admission. Completion or failure updates the
same Toast with a timed result; page navigation does not restart notifications.
An idle monitor checks for new background runs without adding page-level text.
Successful incremental identification stays silent; failures remain visible through
the same deduplicated feedback. Files shows persistent filesystem-monitoring state
and recovery guidance. Only observed task states are shown; no synthetic progress
percentage is used.

Keep form validation, initial page errors, unavailable resources, scan/stale status,
setup guidance, and empty states in context. Provide useful next actions without
repeating the same information in multiple places. Do not imply a numeric completion
percentage when only a task state is known; use an indeterminate state instead.

Manual AniList-list and metadata refresh results, and Review confirmation,
rejection and removal results use Toasts. Review validation, missing-resource and
revision-conflict errors remain beside the form; transport and server-operation
failures use Toasts while retaining the form and its existing retry action.
A successful association Toast includes an Open anime action. Refresh feedback
checks failure envelopes even when HTTP succeeds. Cached background-refresh
failures notify once per failure identity across filters and detail navigation;
polling the same failure does not repeat notifications. Recovery clears that
identity, and an explicit retry can report a new result. Refresh buttons and small
busy indicators show work in progress immediately. Preserve existing content
during background refresh and transport failures; skeletons and inline read errors
are reserved for the first load without data. Authorization guidance remains inline;
stale-cache context belongs in the refresh Tooltip. Background failures use
deduplicated Toasts. No busy-state delay or selective data-update mechanism is added. The Library connection action is a labeled button that
opens Settings. Existing backend refresh and Catalog operation logs retain their
operation outcomes; UI placement changes do not add request payloads to logs.

Unrelated polling must not reset playback or subtitle renderers.

## Accessibility and responsive layouts

Support keyboard navigation, visible focus, accessible control labels, sufficient
text contrast, and status/error cues that do not rely on color alone. Keep controls
usable on desktop and narrow/mobile layouts without overlap or page-wide horizontal
overflow. Validate at 1280 px and 390 px widths, including long and Chinese filenames.

Keep labels and feedback in English. Preserve original filenames. Do not show
placeholder metadata, nonfunctional controls, invented posters, or incomplete
integrations as completed features.


## Player layout

Keep the player page focused on the picture. Combine the icon-only Back action and
an at-most-two-line title in one compact header; preserve its accessible name and
Tooltip. At mobile widths the video extends to the page edges, while desktop uses
the normal container. Keep the native Vidstack subtitle and playback controls.
Below the video, place current-file audio controls and a short More action together.
Only the active asset supplies audio labels and choices. Show the selected track as
text when only one track is playable or native audio switching is unavailable.
Switching audio stays within the current asset. Choose a different file version or
prepare another copy to access audio absent from the active file; source tracks
and retained-track checkboxes belong only to preparation.
Use 44px touch targets without large outlined buttons; allow wrapping when needed.

More owns manual playback retry, compatibility information, playback options and
existing external-player/link commands. Playback options discloses the full filename,
the current media version, a version selector and the manual preparation action. Compatibility information describes the active resource; original-file facts are disclosed separately. Keep the recovery controls visible
when playback is unavailable. Routine technical explanations must not occupy the
normal playback page. Progress editing and unmapped-target explanations use a compact
Progress disclosure; pending decisions, conflicts, failures and recovery actions remain
visible. Preserve command logging and log explicit manual playback retries without
media URLs or credentials.

## Episode Viewing and Playback Completion

Detail episode rows label supported targets as watched/unwatched **based on AniList
progress**; specials and fractional numbers show unknown. The summary distinguishes
cumulative watched progress from available unwatched episodes and local playback
history. Library cards use actual available episode targets for unwatched counts,
counting multiple resource versions once. Pending intent never changes confirmed
indicators. Keep these hints within the existing row/card hierarchy.

Eligible players show a nonblocking Tracking control in the player action row. It
provides Mark as watched, actual operation state and the same progress editor available
on details. Decision-required operations explain cumulative cross-gap changes and expose
explicit Confirm/Keep actions or an initial-status selector. Failures expose Retry;
conflicts expose Keep AniList value/Submit my change. Confirmed values and pending intent
stay visually distinct. Player and detail share operation queries, cache updates and
notifications, and both follow remote confirmation instead of stopping at queued.
Keep controls wrapping at narrow widths. Unmapped sources show no tracking command.

## Automatic Acquisition

The subscription interaction iteration was marked complete on 2026-10-24. Its
[final design and delivery evidence](../history.md#subscription-interaction-design) are
archived; this section remains the maintained UI convention.

Settings includes a compact RSS section with one global refresh interval in whole
minutes (1–1440, default 30). Keep edits local until Save, show the unit in the input
label, and use Toasts for save results. Saving applies without a restart.

Place the unified subscription summary inside the work metadata header, after the
viewing/playback actions. Use the Header row layout: subscription label, one primary
outcome, an on-demand Activity action and a secondary menu. Permit wrapping on mobile;
do not place a second subscription panel below the episode list. Normal controls
are Subscribe, Edit, Check updates and Unsubscribe; existing Pause/Resume stays in
the manual subscription menu. Automatic subscriptions show their group state and link
to Watching management; their editor is explicitly labeled Convert to manual subscription
and explains that saving ends automatic management. Automatic works share a group switch
and per-work exclusion controls. Completed subscriptions show Completed and expose an
explicit Resume action; regular automatic pause/resume remains group-managed.

The editor initially shows only the starting episode and a short effective-defaults
summary. Put profile/source overrides and RSS entry behind More options. Keep global
explanations, site order, credentials and refresh policy in Settings. A validated
destination and configured automatic sources are required, with a specific setup
message/action when missing. Saving does not require a successful resource search.

Open Activity in one responsive dialog. Show active downloads/imports and actionable
failures first, with actual progress and concise episode/status/action rows. Finished
history is secondary. Move grouped release decisions and full release names into
lazy-loaded Diagnostics; do not expose resource samples as a required selection.
Keep an attention indicator in the collapsed header row. Show Settings only for
configuration-related failures and acquisition/import retry or Review only when
appropriate. Use Toasts for operation results; retain form validation/conflicts
inline without discarding user input. qBittorrent WebUI owns transfer controls.


Keep an open subscription editor's input and disclosure state stable when background
queries report a new revision. Capture the accepted edit revision at opening; stale
saves fail inline without discarding input. Closing and reopening loads current values.
Check updates must attempt pending discovery immediately while respecting service
transport limits. Diagnostics shows the last source-check time, attempted sites,
outcomes, coverage warnings and rejection reasons only on demand.

When refreshed tracked detail data acquires a local work, replace the remote-only
route with its local detail route and expose the episode/resource controls immediately.
Preserve library return filters and query context. A remote-only message must not
remain visible after the authoritative detail response includes local resources.
