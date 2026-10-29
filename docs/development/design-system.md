# Anishelf Design System

This document owns visual foundations, reusable UI patterns and page-specific
interaction rules. [Requirements](../requirements.md) owns product scope;
[Architecture](architecture.md#frontend-ownership) owns data and module boundaries;
[History](../history.md) records delivered iterations. Keep implementation history
and backend policy out of this document.

These rules guide new and revised UI; they do not assert that every existing screen
already conforms. Reuse the current Tailwind, shadcn/Base UI and Vidstack stack.

- [UI principles](#ui-principles)
- [Visual and interaction conventions](#visual-and-interaction-conventions)
- [Shared components](#shared-components)
- [Feedback and interface states](#feedback-and-interface-states)
- [Page patterns](#page-patterns)
- [Player layout](#player-layout)
- [Episode viewing and playback completion](#episode-viewing-and-playback-completion)
- [Automatic acquisition](#automatic-acquisition)
- [Accessibility and responsive layouts](#accessibility-and-responsive-layouts)
- [Maintenance and acceptance](#maintenance-and-acceptance)

## UI principles

- **Content first.** Posters, titles and playable episodes lead. Use neutral surfaces,
  restrained decoration and clear alignment; avoid decorative metrics and nested cards.
- **One clear next action.** Web playback is primary. Keep secondary commands and
  diagnostics available on demand without hiding consequential information.
- **Consistent meaning.** The same kind of status, action or field uses the same
  presentation. Browsing, dense lists and forms may have different layouts.
- **Progressive disclosure.** Show the summary needed for a decision first. Expand
  secondary metadata, configuration and diagnostics only when relevant.
- **Continuity.** Background work must not interrupt usable browsing, reset input,
  replace existing content with a skeleton or reset playback/subtitle renderers.

## Visual and interaction conventions

Define shared values in [index.css](../../web/src/index.css); use Tailwind's scale
instead of introducing isolated values in feature components. The following are
baseline choices, with purposeful exceptions such as posters and player controls.

| Foundation | Convention |
| --- | --- |
| Page geometry | Shared 90rem maximum content container; 16px mobile padding, 24px tablet/desktop; desktop shell reserves 11rem for navigation |
| Spacing | Prefer 4, 8, 12, 16, 24 and 32px; page sections use 24px gaps, related controls 8px |
| Typography | Page titles 24px semibold; section titles 16–18px semibold; body 14–16px; supporting labels 12px; avoid smaller arbitrary sizes |
| Controls | Standard inputs/buttons 36px high; provide at least 44px touch targets on touch layouts |
| Shape | Shared `rounded-md` controls and `rounded-lg` panels; pills for compact badges; preserve the cover's 2:3 ratio |
| Surfaces | Neutral page, content and floating surfaces; bordered panels, separators between ordinary list rows; shadows primarily for floating UI |
| Color | Semantic theme tokens for text, surfaces, emphasis and feedback, with light/dark equivalents; reserve strong emphasis for primary actions and selection |
| Density | Browse with room for artwork; use compact aligned rows for files/settings; vary layout without redefining controls |

Use neutral gray surfaces and a graphite emphasis color. Light mode pairs `#FAFAFA`
backgrounds with `#FFFFFF` content and `#27272A` primary actions; dark mode pairs
`#0F0F10` with `#171719` and `#E8E8EA`. Navigation shares the page background,
with neutral selected surfaces and dark/light text rather than accent-filled blocks.
Poster artwork and semantic success, warning and error colors are the only saturated
color in the interface; keep warning/error colors separate from the graphite emphasis.

Use shared success, warning, error and information styles rather than repeating
feature-local color recipes. Business code maps a state to its meaning; shared UI
owns its visual treatment. Include text or a recognizable shape as well as color.

Use short action verbs such as Save, Edit, Test and Disconnect. Prefer icon and text
when space permits. Compact to a named icon with a Tooltip based on the action
container's available width, not only the viewport. Keep busy feedback on the
existing icon with `aria-busy`; do not add duplicate spinners or status rows.

## Shared components

Shared primitives live in `web/src/shared/components/ui/`; page-level shared
components live in `web/src/shared/components/`. Prefer these over new dependencies
or custom controls, and retain Vidstack's native player control styling.

| Pattern | Shared responsibility |
| --- | --- |
| Page header | Title, optional description and page actions with consistent alignment |
| Button / action button | Visual priority, size, focus, disabled and busy states; responsive icon labels |
| Status badge | Fixed typography, padding and semantic tones; feature owns label and state mapping |
| Section / panel | Heading, optional description, content spacing and action placement |
| Form field | Label, help affordance, input alignment and visible validation error |
| Toolbar | Search, filters, sort and actions, including compact layouts |
| List row | Primary/secondary information, status, aligned trailing actions and separators |
| Menu | Consistent leading icon per item, aligned labels, submenu affordance and destructive styling |
| Empty / error state | Consistent icon, concise explanation and relevant recovery action |

Implemented shared foundations include `StatusBadge`, `InlineError`, `LoadingState`,
Button sizes (`default`, `sm`, `icon`) and the `form-control`, `field-label`,
`field-error`, `section-title`, `panel-inset` and `list-row` utilities.
`Card` owns composed sections; `surface-panel` owns a single padded content surface.
Both use 16px padding on narrow layouts and 20px from the small breakpoint.
Icon buttons use 36px geometry; coarse-pointer controls have at least 44px targets
that occupy layout space rather than overlapping adjacent actions.

The remaining patterns are consolidation targets, not an inventory of already
implemented components.
Extract stable repeated patterns as pages are revised. Resolve overlapping `Card`,
`surface-panel` and hand-built panel uses into clear roles before adding another
wrapper. Keep feature-specific workflows within their owning feature.

Expose a small set of meaningful variants. Callers control placement and layout;
shared components control typography, colors, internal spacing and interaction
states. Repeated style overrides should become a shared rule. Do not build a
universal component with unrelated boolean options or add variants for one-off use.

Forms use labels and units to explain ordinary fields. Put non-obvious guidance in
keyboard/touch-accessible label help; keep validation and required recovery visible.
Use inline native radios for short choices, shared radio cards for descriptive
choices and selectors for service-populated lists. Avoid unbounded radio lists.

## Feedback and interface states

Choose placement by how long information matters to the task, not by whether it is
stored. Durable information belongs in context; temporary operation feedback uses
nonblocking floating UI and must not insert banners or rows into the page layout.

| Situation | Presentation |
| --- | --- |
| Initial load without data | A short skeleton matching the expected content |
| Confirmed empty result | Shared icon-and-text placeholder, with a next action when available |
| Initial read failure | Visible error and recovery action; never an empty-state substitute |
| Validation, unavailable resource, setup blocker or conflict | Beside the relevant field/item, preserving editable input |
| Background refresh | Keep existing content; indicate activity on the initiating control |
| Operation result or recoverable transport failure | Deduplicated Toast with a useful retry/recovery action |
| Ongoing preparation | Nonblocking floating task monitor; actual state, never invented percentages |
| Persistent scan/monitor issue | In-context status and recovery; omit routine monitoring confirmation |

Refresh Tooltips contain the last update time and stale-data explanation only when
needed. Authorization/reconnection guidance stays visible. Background failures
notify once per failure identity across polling, filters and navigation; recovery
clears that identity and explicit retry may report a new failure. Inspect failure
envelopes even when HTTP succeeds.

Baseline identification uses one app-level loading Toast through matching and
admission, updated with a timed completion/failure result. Navigation must not restart
it. Successful incremental identification is silent; failures remain discoverable.
Subtitle preparation stays visible until completion, failure or selection cancellation.

Review operations and manual metadata/list refreshes use Toasts; Review validation,
missing-resource and revision-conflict errors stay inline. Retain input and retry on
transport failure. Successful association offers an Open anime action.

## Page patterns

### Navigation and Library

Use the shared container/header for Library, Files, Review, History and Settings.
Desktop uses a persistent 11rem sidebar: Library and History first, Files/Review
separated below, Settings and appearance controls at the bottom. Mobile uses a
compact brand/preferences row and a separate horizontally scrollable navigation
row. Retain accessible labels, focus and all destinations at every width.

The Library has a distinct title area and a search-led toolbar with a bottom
separator. Search fills a row on mobile; filters, sort and account actions wrap
below it. On wider screens they share a row. Search submits with Enter or its
button; sort and discrete filters apply immediately and reset pagination. Preserve
URL state, focus and scroll, including tab-session filter restoration and explicit
URL precedence. Default viewing state is Watching with All available. Secondary
filters expand into labeled selectors and removable applied-filter labels.

Poster grids have two mobile columns and adaptive desktop columns with a 10.5rem
minimum card width. Use borderless card links, rounded artwork, captions below and
restrained artwork elevation on hover; respect reduced motion. Reserve two title lines and one local-availability line. Cards show
format/year, viewing state with cumulative progress and local availability. Omit
unknown denominators; movies have one local slot. Show unwatched availability only
when positive. Keep source/count explanations in accessible Tooltips and cache
information on detail pages.

Whole-card links open details with matching hover/focus feedback. An available next
unwatched target adds a separate sibling Play control, never a nested button. One
available version links to playback; multiple versions open the detail chooser.
Do not auto-select a version or show Play without a resolved target.

### Work details

Prioritize the top-aligned cover, readable title/metadata column and episode list.
Use an optional short banner above a solid information surface: 112px on mobile
and 176px on larger screens, with a subtle bottom fade. Never place text over the
image. Missing or failed banners collapse completely.
On mobile use a small cover beside the information to reduce vertical overhead.
The cover must not stretch with the text. Alternative titles occupy two lines with
expansion only on actual overflow, remeasured when width changes. Show format/year,
readable release status, labeled episode counts and known dates. Put unknown dates,
provider links/attribution, secondary metadata, synopsis and relationships in
on-demand sections. Long titles and actionable errors may grow the header.

Keep playback first and viewing state next below a short divider, with matching
visual and keyboard order. Edit progress is a
tertiary action. Local works offer Play episode N for the first available unwatched
episode, opening the chooser for multiple versions. Disable with an explanation
when progress is unavailable, caught up or no unwatched local episode exists;
remote-only details omit playback. Once authoritative data includes local resources,
replace the remote route with local details while retaining Library/query context.

Episode rows use compact Watched/Unwatched labels, with AniList source/numbering
explained at the heading level. Show a positive unwatched-availability count beside
the heading; do not repeat the header's progress summary. Order single-version
controls as compatibility, shared file menu, then Play. In a version chooser, each
available version owns its Play/menu actions. Unavailable versions retain association
correction but expose no file commands.

The shared file menu offers external players, original links/downloads/playlists and
preparation. Anime supplies file-specific correction and Show in Files actions through
app composition. Show in Files resolves the current parent, then scrolls to, focuses
and highlights the file without playing it. Keep compatibility/task status outside
menus and disable commands for known source conflicts.

Place files to review in a compact disclosure below the episode heading. Keep loading
and errors discoverable while collapsed; hide after a successful empty first page.
Retain pagination when later pages empty and do not imply a total from page size.
Guidance belongs in accessible help, not persistent footnotes or duplicate navigation.

Show the airing schedule in a sidebar table with episode, local date/time and status,
sorted by broadcast time, with bounded scrolling and a loaded-record count. Keep
loading, unverified-cache markers, partial warnings and failures visible. Partial
pagination must not imply completeness or identify the next broadcast from unordered
records. Explain provider numbering through accessible help.

### Files, Review and History

Use compact rows, aligned trailing actions, separators and the shared empty/error
patterns. Truncate long names with accessible full-value Tooltips. Files identification
uses a focusable status icon; Review and associated work/episode links live in the
file menu. Keep correction/recovery actions specific to the affected resource.

### Settings

Use a sticky 8.5rem left category navigation with a 1rem content gap on desktop and a compact horizontal category
row on mobile. Bound the content column to 68rem. Separate settings sections with
dividers rather than repeated card outlines. Stack descriptions above forms on
narrow content containers; use description/form columns only when the content
container reaches 52rem. Stretch both regions to their grid tracks; do not mix
viewport-based flex/grid overrides. Preserve drafts when
switching categories. Omit descriptions that
repeat labels. All tabs share spacing, validation and action conventions; retain
every destination on narrow screens through icons, Tooltips and accessible names.

| Section | Specific rules |
| --- | --- |
| Library | 36px read-only directory fields aligned with the add-path row; full-path Tooltips, compact cache budget; directory rules in help, locks/limits visible |
| Playback | Descriptive mode/profile cards in two columns when possible; custom players in separated rows, name/template side by side on wide layouts; templates on demand and browser-only storage scope visible |
| Account | Identity and Connected/Disconnected state in the description column; authorization/credential actions together; check details in help, failed checks/reconnection visible; replacement consequences in confirmation |
| Security | Current password above a responsive new-password/confirmation pair; equal label heights; Change password and Sign out on one row; consequences visible, limits/link guidance in help |
| Downloads | Order Watching, Subscription defaults, Jackett, qBittorrent; keep global source/profile policy here |
| RSS | One global interval in whole minutes (1–1440, default 30); local draft until Save, unit in label, Toast result, no restart |
| About | `/settings?section=about`; description/links/license left, version and Check right; build details collapsed unless builds differ, mismatch visible |

Connection panels share one structure: a compact endpoint/configuration summary,
disclosure, field grid and a single action row inside the editor. That row keeps
Save, Cancel and Test (where the service supports it) together and places More last
so secondary service actions never split primary actions. Open first-time setup by
default; disclose saved fields on demand. External service links stay outside the
editor. Disconnect, removal and bundled-service switching use More; both Jackett and
qBittorrent can reselect bundled credentials there when the deployment provides them.
Configuration alone never implies successful connectivity.

Jackett and qBittorrent use the same panel structure and action order. Jackett site
priority and Save sites remain independent of connection editing; adding sites uses a
bounded selector. Each save preserves the other draft. Keep search diagnostics
collapsed. qBittorrent groups API access, destination and optional browser URL. The
download destination always shows its fields with Save, discard-on-Cancel and
Validate instead of switching between a summary and an editor. The optional browser
URL field collapses while the saved WebUI link remains. Saved credentials stay blank
with a keep-existing placeholder and re-entry help; preserve bundled credential
visibility/copy lifetime and cache restrictions.

Connection-test counts and save success use Toasts; unresolved setup/validation
failures stay visible. About checks are manual: retain the last successful result
and timestamp, distinguish failed checks, and never label development/test/prerelease
builds as the latest stable version.

## Player layout

Keep the picture primary. Use a compact header with named Back icon and at most two
title lines. Mobile video extends to page edges; desktop uses the shared container.
Retain native Vidstack subtitles/controls. Place current-file audio, the Tracking
control and More on one action row below the video, wrapping with 44px touch targets
rather than large outlined buttons. Only the active asset supplies audio choices; show
plain selected-track text when switching is unavailable or only one track is playable.
Source-track retention belongs to preparation, not playback audio selection.

More contains manual retry, compatibility, Playback options and existing external
player/link commands. Playback options discloses the full filename, current version,
version selector and manual preparation. Compatibility describes the active resource;
original-file facts are separate. Keep recovery controls visible when playback fails;
normal playback should not carry routine technical explanations.

Unmapped explanations use a compact disclosure. Keep pending decisions, conflicts,
failures and recovery visible. Progress editing stays on details; the player offers no
progress editor. Preserve playback context and existing command logging; log manual
retries without media URLs or credentials.

## Episode Viewing and Playback Completion

Use confirmed AniList cumulative progress for supported episode Watched/Unwatched
labels; specials/fractional episodes are unknown. Distinguish this from local history
and available unwatched counts; count each episode target once across file versions.
Unknown provider totals show only the watched count. Pending intent never changes
confirmed indicators. A complete initial snapshot must establish entry presence
before showing an absent state.

Local and remote details share Edit progress; eligible players expose a nonblocking
Tracking control with Mark as watched and operation state. Progress editing is not
offered in the player: arbitrary progress and status corrections stay on details.
The player's operation state covers only the current episode's open work: pending
decisions, conflicts, failures and recovery. A completed result leaves the control,
is announced once as a notification and is never replayed from stored history.
Unmapped sources have no tracking command. Support explicit backward corrections and
explicit status choices. Cross-gap decisions explain cumulative changes with
Confirm/Keep or an initial-status selector; failures offer Retry, conflicts offer Keep
AniList value or Submit my change.

Preserve editable input and persisted intent on failure. Keep revision/validation,
retry timing and conflict choices in the dialog; submission lifecycle/results use
deduplicated app-level Toasts with detail recovery. Player/detail share queries,
notifications and confirmed results rather than treating queued intent as success.

## Automatic Acquisition

Place the subscription summary in the metadata header after viewing/playback: label,
one primary outcome, Activity and secondary menu. Wrap on mobile; do not duplicate
it below episodes. Keep an attention indicator when action is needed.

| Situation | Controls and behavior |
| --- | --- |
| Manual subscription | Subscribe, Edit, Check updates, Unsubscribe; Pause/Resume in the menu |
| Automatic subscription | Group state and Watching management link; per-work exclusion; editor explicitly says Convert to manual subscription and explains the consequence |
| Completed subscription | Completed with explicit Resume; normal automatic pause/resume remains group-managed |
| Editor | Starting episode and effective-default summary first; profile/source/RSS overrides under More options; specific setup action when destination/sources are missing |
| Activity | One responsive dialog; active downloads/imports and actionable failures first, finished history secondary; actual progress and concise episode/status/actions |
| Diagnostics | Lazy-loaded grouped release decisions, full names, source-check times/sites/outcomes, coverage warnings and rejection reasons; resource samples are not required selection |

Watching shows Enabled/Disabled and blocking reasons in the description column,
stacked above controls on mobile. Use shared descriptive radio cards for starting
episode choices. Activation previews use saved Subscription defaults, with no
independent profile selector. Discard confirmation when that default changes; prompt
fresh preview/confirmation on `profile_changed`. Confirmation authorizes captured
scope; existing subscriptions retain their saved profile and starting episode.

Keep editor input/disclosure stable across background revisions. Capture revision at
opening, show stale-save conflicts inline and load current values on reopening.
Saving does not require successful search. Check updates attempts pending discovery
while respecting transport limits. Offer Settings for configuration failures and
retry/Review only where applicable. qBittorrent WebUI owns transfer controls.

## Accessibility and responsive layouts

Provide keyboard operation, visible focus, accessible names, sufficient contrast and
non-color status/error cues. Tooltips supplement accessible names; they never replace
visible required recovery information. Help must work with keyboard and touch.
Avoid overlapping controls and page-wide horizontal overflow.

Keep labels and feedback in English; preserve original filenames. Never present
placeholder metadata, invented posters, nonfunctional controls or incomplete
integrations as completed functionality.

## Maintenance and acceptance

1. Reuse a foundation/component/page pattern before adding a new visual treatment.
   Document a purposeful exception with its owning pattern; do not copy page-specific
   implementation history into shared rules.
2. Validate new shared patterns on Library, a work detail or Settings before broad
   migration. Maintain a development component showcase as consolidation proceeds;
   it is a verification aid, not a shipped feature requirement.
3. Review light/dark screenshots at 390px, 768px and 1280px, including long titles,
   Chinese filenames, empty/loading/error states and keyboard focus. Compare matching
   viewport/data states; tests alone do not establish visual acceptance.
4. Preserve URL/query context, cancellation, form drafts and accessibility. Follow
   [frontend ownership](architecture.md#frontend-ownership) for state/composition and
   [logging conventions](README.md#logging-choice) for changed business behavior.
   Visual-only changes must not add payload/credential logging.
5. Run Biome for code changes and appropriate interaction checks; report browser
   verification separately. Update this English document when a shared rule changes.
