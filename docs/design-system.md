# Anishelf Design System

This document owns the shared UI principles, visual conventions, interaction,
feedback and accessibility rules. [Requirements](requirements.md) owns product
scope, [Architecture](architecture.md) retains module boundaries, and
[Archived anime-library design](history.md#anime-library-design) records the delivered poster
wall, work details, Files and Review screens. [History](history.md#v2-design)
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

Use one shared page container (72rem maximum) and title alignment for Library,
Files, Review, History and Settings. Use the shared page header for title,
description and page actions; keep scan/stale status beneath it. Settings uses
full-width section panels with a desktop description column and a bounded form
column, stacking on mobile. Do not narrow the entire Settings page.

Use 24px section gaps, compact list rows and consistent rounded-lg bordered
panels. Browsing lists use separators rather than a card around every row.
Poster grids have two mobile columns and adapt desktop columns to a minimum
card width. Reserve two title lines and one availability summary; keep cache
information on detail pages. Whole cards open work details with matching hover
and keyboard-focus feedback.

Catalog search submits with Enter or its search button. Sorting and discrete
filters apply immediately and reset pagination. Put secondary filters in an
expandable panel and show removable applied-filter labels. Preserve URL state,
return focus and scroll. The Library toolbar keeps search, Filters, sort and the
AniList action on one row. Refresh uses an icon button with a Tooltip and an
accessible name. On narrow screens, compact action icons and a bounded sort
control preserve search space. AniList account actions share one row when space
allows and wrap naturally on narrower screens. The application header always stays on one line.
Navigation uses text when its container is wide enough, otherwise icons with
Tooltips and accessible names. If icons still do not fit, scroll only the
navigation horizontally; keep the brand visible and preserve keyboard access.

Work detail prioritizes the header and episode list. AniList viewing state is a
compact row inside the title/metadata header on both local and remote details.
Use a status Badge, cumulative progress and the provider's total episode count;
unknown totals show only the watched count. Keep the cumulative-progress explanation
in a keyboard/touch-accessible Tooltip. Keep a fixed-size refresh button in the
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
version orders controls as compatibility status, shared Files action menu, then
Play. The version chooser uses the same order.
Multiple available versions open the version chooser; each available version has
its own Play and file-action controls. Unavailable versions expose no file commands.
The same menu provides external players, original links/downloads/playlists and
preparation controls, while association corrections remain in the Anime context.
App supplies the cross-feature composition through a typed resource-action slot;
Anime does not depend on App or Media/Playback UI internals. Compatibility queries
are bounded, account for resource scope and the selected source version, and known
source conflicts disable the affected menu. Web playback retains work, episode,
source-version and Library return context. Existing command feedback and logs apply.

Episode numbering guidance is an info icon beside the episode heading with a
keyboard/touch-accessible Tooltip. Files needing review use a compact disclosure
with a current-page count, candidate links and pagination inside. Keep loading
and errors visible while collapsed; candidate guidance belongs in a Tooltip.

Provider airing schedules use a compact disclosure with a loaded-record count.
Keep the provider numbering explanation in an accessible Tooltip. Expanded records
show episode, local date/time and status in aligned rows sorted by broadcast time.
Cached records are unverified; pagination must not imply a complete schedule or
identify the next broadcast from an unordered partial response. Loading, cache
markers and read failures remain visible while collapsed.

Group secondary metadata,
synopsis, schedules and relationships into on-demand sections; keep actionable
errors and unresolved candidates discoverable. Files identification uses a compact focusable status icon with a Tooltip.
Review and associated work/episode links belong in the file action menu.
Keep action menus focused on choices and commands; put explanatory guidance in
Settings and report invocation failures through Toasts.
Keep compatibility and task status outside action menus. Put shared choices in
Settings. The preparation panel is a nonblocking active-task monitor, not a dedicated
page.

## Feedback and interface states

Empty page/list states use the shared icon-and-text placeholder, with a relevant
next action when available. Apply the same presentation to Library, History,
Files and Review; do not replace failure feedback with an empty-state message.


Use deduplicated Toasts for operation results and recoverable playback or subtitle
failures. Keep ongoing subtitle-preparation feedback visible until completion,
failure, or selection cancellation. Reuse existing retry actions.
Automatic anime identification uses one app-level, deduplicated loading Toast,
kept visible through matching and admission. Completion or failure updates the
same Toast with a timed result; page navigation does not restart notifications.
An idle monitor checks for new background runs without adding page-level text.
Only observed task states are shown; no synthetic progress percentage is used.

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


## Episode Viewing and Playback Completion

Detail episode rows label supported targets as watched/unwatched **based on AniList
progress**; specials and fractional numbers show unknown. The summary distinguishes
cumulative watched progress from available unwatched episodes and local playback
history. Library cards use actual available episode targets for unwatched counts,
counting multiple resource versions once. Pending intent never changes confirmed
indicators. Keep these hints within the existing row/card hierarchy.

Eligible players show a nonblocking completion panel below the player. Distinguish
saved evidence, queued intent, unavailable admission and confirmed submission; the
existing operation Toasts report remote delivery outcomes. Advancing across skipped
episodes requires labeled Confirm/Keep actions; a new AniList entry also requires
an initial-status selector. Errors retain actionable retry. Keep controls wrapping
at narrow widths, and stop player outcome polling at queued/unchanged states. An
unmapped source does not create a tracking prompt or unrelated completion polling.
