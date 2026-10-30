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

### Files, Review and History

Use compact rows, aligned actions, separators and shared empty/error patterns.
Truncated names need accessible full values. Keep correction and recovery actions
specific to the affected resource. Destructive file operations require a clear
confirmation; folder deletion must explicitly include its contents. Keep errors and
retryable input in the dialog.

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

Place the subscription summary near the work's viewing and playback actions, with
one clear primary outcome and an attention indicator when action is needed. Keep
activity and diagnostics available on demand. Show actual progress and actionable
failures, and preserve editor input across background updates. See
[subscription requirements](../requirements.md#25-subscriptions-and-resource-discovery)
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
