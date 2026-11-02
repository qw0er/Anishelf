# Anishelf Design System

This document owns visual foundations, reusable UI patterns and exceptional
page-level presentation rules. [Requirements](../requirements.md) owns product
behavior and scope; [Architecture](architecture.md#frontend-ownership) owns data
and module boundaries; [History](../history.md) records delivered iterations.
These rules guide new and revised UI; they do not assert that every screen already
conforms. Reuse the existing Tailwind, shadcn/Base UI and Vidstack stack.

## UI principles

- **Content first.** Let artwork, titles and playable episodes lead. Use neutral
  surfaces, clear alignment and restrained decoration; avoid nested cards and
  decorative metrics.
- **One clear next action.** Make primary actions apparent and disclose secondary
  commands and diagnostics when relevant, without hiding consequential information.
- **Consistent meaning.** Present the same kind of status, action or field
  consistently, while allowing browsing, lists and forms different densities.
- **Continuity.** Background work must not interrupt usable content, reset input,
  replace existing content with a skeleton or reset playback/subtitle renderers.

## Visual and interaction conventions

Define shared values in [index.css](../../web/src/index.css) and prefer Tailwind's
scale over feature-local values. Exceptions, such as poster artwork and player
controls, should have a clear purpose.

| Foundation | Convention |
| --- | --- |
| Geometry | A shared 90rem maximum content container, with 16px mobile and 24px wider padding; desktop navigation reserves 11rem |
| Spacing | Prefer 4, 8, 12, 16, 24 and 32px; use 24px between page sections and 8px between related controls |
| Typography | Page titles 24px semibold; section titles 16–18px semibold; body 14–16px; supporting labels 12px |
| Controls | Standard inputs and buttons are 36px high; touch targets occupy at least 44px without overlapping neighbors |
| Shape and surface | Use shared rounded controls and panels, neutral surfaces, borders and row separators; reserve shadows mainly for floating UI |
| Color | Use semantic theme tokens with light and dark equivalents; graphite is the primary emphasis, while saturated colors convey artwork or feedback |
| Density | Give artwork room in browse views; use compact aligned rows for files and settings |

Use shared semantic styles for success, warning, error and information. Feature
code maps state to meaning; shared UI owns its presentation. Communicate status
with text or a recognizable shape as well as color.

Use short action verbs and prefer an icon with text when space permits. Compact
secondary actions to named icons with Tooltips based on available container width.
Keep busy feedback on the existing control without duplicate spinners or status rows.

## Shared components

Shared primitives live in `web/src/shared/components/ui/`; other shared components
live in `web/src/shared/components/`. Reuse installed shadcn components on the
existing Base UI stack; add an official component before considering an independent
implementation. Retain Vidstack's native player controls. Feature wrappers may
compose primitives but should not duplicate their visual or interaction foundations.

Shared components own internal spacing, typography, semantic variants, focus,
disabled and busy states. Callers own placement and feature-specific state. Extract
stable repeated patterns as pages are revised; avoid one-off variants and universal
components with unrelated options.

Use consistent patterns for page headers, sections, forms, toolbars, list rows,
menus, status badges and empty/error states. Forms need labels, units where useful,
visible validation and accessible help for non-obvious guidance. Use Radio Group for
short choices, Native Select for ordinary selectors and Collapsible for independent
disclosures. Preserve editable contents while collapsed and avoid unbounded radio lists.
Dialogs should fit the viewport and scroll when necessary.

## Feedback and interface states

Place information according to how long it matters to the task. Durable information
belongs in context; temporary operation feedback uses nonblocking floating UI and
must not insert banners or rows into the page layout.

| Situation | Presentation |
| --- | --- |
| Initial load without data | Short skeleton matching the expected content |
| Confirmed empty result | Shared icon and concise explanation, with a next action when available |
| Initial read failure | Visible error and recovery action, not an empty state |
| Validation, setup blocker or conflict | Beside the relevant field or item, preserving input |
| Background refresh | Keep existing content; indicate activity on the initiating control |
| Operation result or recoverable transport failure | Deduplicated Toast with useful recovery where applicable |
| Ongoing preparation | Nonblocking task monitor showing actual state, not invented percentages |
| Persistent issue | In-context status and recovery; omit routine success confirmations |

Keep authorization, reconnection and actionable failures visible. Deduplicate
background failure notifications across polling and navigation, and clear their
identity on recovery. Preserve input and offer retry when an operation fails.

## Page patterns

### Navigation and Library

Use a consistent container and header across primary pages. Desktop navigation is
persistent; mobile navigation remains accessible and horizontally scrollable when
needed. Preserve URL context, focus and scroll during browsing.

Library browsing is search-led. Give posters a consistent 2:3 ratio, readable
captions and restrained hover/focus feedback. Whole-card links and separate playback
controls must not be nested interactive elements. Present viewing progress and local
availability distinctly, and omit unknown counts rather than inventing values.

### Work details

Prioritize the cover, title, playback and episode list. Keep secondary metadata and
diagnostics on demand. Show actionable failures near the affected content. Use the
shared file menu and keep version-specific actions with their version. Preserve the
Library context when navigating between remote and local details.

The broadcast-plan panel prioritizes announced future airtimes and highlights the
next broadcast. Keep aired history in an independent collapsed disclosure, newest
first. Include the local time zone and weekday, preserve cached plans with their
verification state, and do not infer unannounced future dates. Future plans do not
create download actions in the episode list.

### Files, Review and History

Use compact rows, aligned actions, separators and shared empty/error patterns.
Truncated names need accessible full values. Keep correction and recovery actions
specific to the affected resource. Destructive file operations require a clear
confirmation; folder deletion must explicitly include its contents. Keep errors and
retryable input in the dialog.

The pending Review queue and work-detail review candidates include only currently
available files. Preserve unavailable sources and their decisions as history;
rediscovering an unchanged file can restore its pending review.

Available pending resources expose Force re-identification beside the source
summary. Its help text explains that the whole directory is evaluated and clear
matches are added automatically. Keep progress on the button, disable competing
review mutations while it runs, refresh suggestions on completion and preserve
editable input on failure. Report completion through a deduplicated Toast.

The pending Review list header also exposes Re-identify all pending resources.
It includes every page, runs in the background and retains the list and pagination
while the button shows activity. Completion reports associated, still-pending,
failed and skipped resource counts through one Toast, including after navigation.

### Settings

Use category navigation that remains accessible on narrow screens. Separate sections
with dividers, use a bounded content column and stack descriptions above forms when
space is limited. Preserve drafts when changing categories and omit descriptions that
repeat labels.

Connection editors share a consistent summary, disclosure, fields and action order.
Keep primary actions together and secondary actions in a menu. Configuration must
not imply successful connectivity; unresolved setup and validation failures remain
visible.

## Player layout

Keep the picture primary and retain native Vidstack subtitles and controls. Use a
compact header and a wrapping toolbar for common playback actions. Make the next
episode action prominent when available; place secondary commands and technical
details on demand. Keep recovery controls visible on failure without adding routine
technical explanations to normal playback.

Playback options and audio choices must remain usable with keyboard and touch, and
long labels must not crowd actions. Keep fullscreen prompts inside the player.
Preserve playback and navigation context; logs must not contain media URLs or
credentials. See [playback requirements](../requirements.md#23-web-playback-and-subtitles)
for continuation behavior and [viewing requirements](../requirements.md#24-viewing-history-and-tracking)
for progress and tracking behavior.

## Automatic acquisition

Episode rows use a single compact line: episode identity, one primary action or
acquisition status, and relevant secondary actions. Omit per-row viewing labels,
local availability labels and version counts; viewing progress belongs above the
list. Available episodes expose a light Play action, opening version selection
when needed. Missing regular episodes expose Download directly. Preserve playback
when another version has an acquisition task.

Align primary actions and acquisition state in the same trailing 8rem column,
with the icon and label centered together as one group. Center text-only task
state in that same column. Place file status indicators and More before
that column, so auxiliary controls never shift Play relative to Download. Rows
without auxiliary controls retain the primary column position. Truncate long
labels inside the column while retaining their accessible names.

Show durable acquisition state beside its episode: Searching, Waiting, actual
reported percentage (Downloading when unknown), Processing, Paused or Needs
attention. Processing compresses verification and ingestion for the row only;
task details retain the real stages. Download completion does not imply playback
availability. Opening the status shows only that episode's tasks, errors and
recovery actions. Keep rows stable during polling and preserve cached content on
refresh failures. Do not display an invented percentage or a disabled Play action
beside a missing episode's download action.

Acceptance uses a deduplicated Toast with a View task action. Keep subscription
intent near the work's playback actions without download counts or progress.
Subscription details own discovery, configuration failures, history diagnostics
and source information; episode task details own transfer and import recovery.
Keep actionable subscription failures visible and preserve editor input across
background updates. See [subscription requirements](../requirements.md#25-subscriptions-and-resource-discovery)
for lifecycle and acquisition behavior.

## Accessibility and responsive layouts

Support keyboard operation, visible focus, accessible names, sufficient contrast and
non-color status cues. Tooltips supplement accessible names and must not replace
visible recovery information. Help must work with keyboard and touch. Avoid
overlapping controls and page-wide horizontal overflow.

Localize labels and feedback while preserving original filenames. Do not present
placeholder metadata, invented posters, nonfunctional controls or incomplete
integrations as completed functionality.

## Maintenance and acceptance

1. Reuse shared foundations and patterns before adding a visual treatment. Document
   purposeful exceptions with their owning pattern, not implementation history.
2. Validate new shared patterns on representative browsing, detail or settings views
   before broad migration. A development component showcase is a verification aid.
3. Review light and dark layouts at 390px, 768px and 1280px, including long titles,
   Chinese filenames, empty/loading/error states and keyboard focus. Tests alone do
   not establish visual acceptance.
4. Preserve navigation context, cancellation, drafts and accessibility. Follow
   [frontend ownership](architecture.md#frontend-ownership) and
   [logging conventions](README.md#logging-choice) for changed business behavior.
   Visual-only changes must not add payload or credential logging.
5. Run Biome for code changes and appropriate interaction checks; report browser
   verification separately. Update this English document when a shared rule changes.
