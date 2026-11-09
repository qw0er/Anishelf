# Anishelf Design System

This document owns design principles and the reasoning behind interface decisions.
[Requirements](../requirements.md) owns product behavior and scope;
[Architecture](architecture.md#frontend-ownership) owns data and module boundaries;
[History](../history.md) records delivered iterations. This document defines semantic
roles, usage rules and baseline visual scales. Component APIs, library wiring and
exact responsive layout values belong in implementation.

## UI principles

- **Content first.** Let artwork, titles and playable episodes lead. Use clear
  alignment, restrained decoration and enough space to understand related content.
- **One clear next action.** Make primary actions apparent. Disclose secondary
  commands and diagnostics when relevant without hiding consequential information.
- **Consistent meaning.** Give equivalent states, actions and fields consistent
  meaning across the application, while allowing each task an appropriate density.
- **Continuity.** Background work must preserve usable content, input, focus,
  navigation context and playback. Feedback must preserve the page structure and
  control positions, avoiding abrupt layout changes as messages appear or disappear.

## Visual and interaction conventions

Establish a readable hierarchy between page identity, content, actions and supporting
information. Group related controls closely and separate unrelated tasks. Use space
purposefully; avoid decorative metrics, repeated headings and unnecessary containers.

Keep visual foundations consistent across pages. Use neutral surfaces and restrained
emphasis so artwork and actionable feedback remain prominent. Support both light and
dark themes. Communicate state through text or recognizable shapes as well as color.

Use concise action verbs and make consequences understandable before activation.
Secondary actions may become more compact when space is limited, but must remain
identifiable and accessible. Show activity at its initiating action without redundant
feedback or layout shifts.

Keep button labels and compact status text short enough to scan at a glance. Avoid
repeating the surrounding context, management mode or full explanations in every row.
Use a brief action verb or state label; put detailed causes, timing and consequences
in the associated details or help. Preserve meaningful distinctions between states
and keep actionable failures discoverable. Do not rely on truncation to make verbose
copy fit, and account for longer translations when reviewing labels.

### Typography and text roles

Choose typography by information role, not by individual page. Shared styles own
the scale; equivalent roles must use the same size, weight and color treatment.
The following values are project design baselines, not accessibility requirements.
Implement font sizes in relative units and preserve browser text scaling.

| Role | Baseline size / line height | Weight | Use |
| --- | --- | --- | --- |
| Page title | 24 / 32 px | 600 | Management page identity |
| Work title | 24–36 px / 1.25 | 600 | Artwork-led work details; responsive sizing |
| Section title | 16 / 24 px | 600 | Task panels, settings groups and inventory sections |
| List primary text | 14 / 20 px | 500 | Filenames and work names in management rows |
| Interface body | 14 / 20 px | 400 | Menus, fields and ordinary list content |
| Reading body | 16 / 26 px | 400 | Synopses and extended explanations |
| Supporting text | 14 / 20 px | 400 | Field descriptions and failure reasons |
| Compact metadata | 12 / 16 px | 400 | Short timestamps, sizes, counts and states |
| Control label | 14 / 20 px | 500 | Buttons and field labels |

Use one section-title treatment throughout management pages. A larger section title
may distinguish major sections on artwork-led detail pages, but must not become an
alternative chosen arbitrarily for ordinary panels. Keep HTML heading levels tied
to document structure independently of visual size.

Use normal foreground text for primary content, a shared secondary foreground for
supporting information, and semantic colors for feedback. Do not create hierarchy
by repeatedly reducing font size or opacity. Compact metadata must not carry primary
actions, essential instructions or failure explanations. Use normal letter spacing
for Chinese body text and comfortable line heights for multiline content.

Allow filenames and paths to wrap where useful. When a title is visually shortened,
provide an accessible way to inspect its complete value, including on touch devices.
Do not truncate essential recovery instructions or action labels.

### Interface language

Use a stable vocabulary across pages and translations. Distinguish deleting a file,
removing a configured directory and cancelling a subscription; these actions have
different consequences and must not share an ambiguous generic label.

| Copy role | Rule | Examples |
| --- | --- | --- |
| Name | Use a concise noun or noun phrase | Download directory, Prepared copies |
| Action | Use a verb, adding an object when needed | Refresh, Add directory, Retry download |
| State | Report a short factual condition | Waiting, Preparing, Failed |
| Explanation | Describe the cause, consequence or next step | This file is playing and cannot be deleted yet. |

Omit an action's object only when the surrounding context makes it unambiguous.
Keep distinctions such as Refresh metadata and Re-identify when they explain what
will happen. Show consequential information beside the affected content or in the
confirmation flow; tooltips must not be its only presentation. Keep terminology
consistent without forcing all languages into identical sentence structures.

### Icon roles and action presentation

Use the shared Lucide icon family with consistent stroke treatment. Select icons by
meaning and reuse that mapping across pages. Baseline sizes are 16 px for actions
and inline states, 20 px for navigation, and 24–32 px for empty-state illustrations.
Exceptions belong to shared components or distinct contexts such as the player,
rather than individual page overrides.

Keep common action mappings stable: RefreshCw for refresh, Search for search, Play
for playback, Trash2 for deletion, and Ellipsis for additional commands. Related but
different operations must retain explicit labels when the icon alone is ambiguous.

Add icons when they improve recognition or scanning. Do not decorate every heading,
metadata value or explanation. Plain state text is sufficient when an additional
icon or colored badge would not help users understand or act.

| Presentation | Use when | Examples |
| --- | --- | --- |
| Text only | The label is clear and an icon adds little | Save, Cancel, View details |
| Icon and text | A recognizable icon helps identify a frequent or important action | Play, Add directory, Download |
| Icon only | The action is familiar, compact and unambiguous in context | Toolbar refresh, Close, More actions |

Keep visible labels for primary actions and unfamiliar domain operations such as
Re-identify and Prepare copy. On narrow screens, reflow controls or move secondary
commands into a labeled menu before removing meaningful labels. Do not automatically
convert every action to an icon-only button.

Icon-only controls need an accessible name and a tooltip available on hover and
keyboard focus. Touch users must still be able to identify the action through its
context or an accessible labeled alternative. Hide decorative icons from assistive
technology when adjacent text already names the action.

Size the interaction target independently of the glyph. A 16 px icon normally sits
inside a 36 px control; prefer targets of at least 44 px for touch interaction.
Preserve sufficient spacing and visible keyboard focus in compact toolbars.

### Action emphasis and busy feedback

Normally give each independent task region one primary action. Use neutral or
outlined controls for secondary actions and quiet controls for routine toolbar
commands such as refresh and more actions. Keep destructive actions explicit in
menus and confirmations without making every inventory row visually alarming.

Use the same busy behavior for equivalent actions. Ordinary asynchronous buttons
show a spinner in the icon position while retaining their label and width. Refresh
controls rotate the refresh icon consistently. Respect reduced-motion preferences,
expose busy state accessibly, and prevent conflicting or duplicate activation.
Do not rely on animation alone to communicate ongoing work.

### Surface hierarchy

Give surfaces consistent meaning across pages. Choose a surface according to the
task it contains, and use shared theme roles rather than page-specific neutral
colors or arbitrary opacity variations.

- **Page background.** Provides the canvas for page identity, navigation and layout.
  Keep page titles and page-wide actions outside task panels.
- **Task panel.** Groups an independently understandable management task or form.
  Distinguish it from the page background with a subtle neutral tone, a light border
  and consistent corner treatment in both light and dark themes.
- **Supporting region.** Holds secondary explanations, previews or supplementary
  details within a task. Prefer spacing and dividers; use a subdued surface only
  when the additional grouping helps comprehension.

Keep search, filters, list-scoped commands, results and pagination for one inventory
within one continuous task panel. Use spacing or dividers between these parts so
the relationship between controls and affected content remains clear. Ordinary rows
share the panel surface; avoid giving every row its own card or nesting panels for
routine field groups. Preserve the task's surface and control placement across
loading, empty and error states, while hiding commands that do not apply.

Use hover, selection, focus and semantic feedback colors to express interaction or
state. Keep these meanings distinct from structural surface grouping. Emphasize the
primary action through its control rather than coloring the entire task region.
Surface tones should remain restrained, with sufficient contrast for text, controls
and focus indicators; grouping must also remain understandable through layout and
boundaries.

Artwork-led browsing can sit directly on the page background. Apply task panels
where they clarify an independent operation, preserving a consistent surface
hierarchy without forcing every page into the same layout.

## Reuse and consistency

Reuse established visual and interaction patterns so users can transfer what they
learn between pages. Shared patterns should carry consistent focus, disabled, busy
and feedback behavior. Extract stable repetition without forcing unrelated tasks
into the same presentation.

Match the interaction to the decision. Simple choices should be quick to scan;
choices with meaningful consequences need visible explanations. Independent filters
must remain independently adjustable and work together. Secondary details may be
revealed on demand while preserving editable content. Keep overlays usable within
the available viewport.

## Feedback and interface states

Use one application-wide presentation scheme: operation results go to toasts,
input errors stay beside fields, and current state updates in its existing place.
Pages must follow these roles rather than choose their own feedback surfaces.

| Information | Presentation | Layout rule |
| --- | --- | --- |
| Operation success, failure, partial success or background failure notification | Global toast | Overlay the page without moving content |
| Input validation error | Error area beside the affected field | Reserve space for ordinary validation feedback and preserve the draft |
| Current loading, task, connection, authorization or content availability state | Existing button, status area or content container | Update in place; do not insert a new banner or panel |

### Toast behavior

- Report an operation's result once, through one toast. Update that toast as the
  operation's state changes; do not repeat its result in an inline summary or dialog.
  Input validation stays beside the field instead of producing a duplicate toast.
- Dismiss success after six seconds. Failure and partial-success toasts remain until
  dismissed or the issue is resolved. Offer one Retry action when retry is possible.
- State the result and the necessary reason concisely. Reveal lengthy batch failure
  details on demand, and keep technical diagnostics in logs.
- Deduplicate repeated background failures across refreshes and navigation. Allow
  failures to be reported again after recovery. Close scope-specific notifications
  when leaving their resource scope; navigation alone must not repeat a global error.

### Stable state and recovery

Show ordinary activity at the initiating button using the shared busy behavior.
Long-running work uses the existing task list or status area, without adding a
temporary progress panel or inventing percentages. Current object or page state may
remain visible in its designated area; operation result messages belong in toasts.
Keep unresolved setup, authorization and connection states discoverable there, with
the relevant recovery action.

Keep the task container and toolbar placement stable across initial loading, empty
results and read failures. Show initial loading or failure inside that container;
distinguish a failure from an empty result and provide Retry. Empty results explain
the situation and offer a useful next action. Background refresh retains existing
content, drafts, focus and scroll; report refresh failure through a toast rather
than replacing usable content or adding a banner.

Reserve dialogs for decisions that require confirmation before an operation, with
its scope and consequences explained. Do not open a dialog just to report a result.

## Page patterns

### Navigation and Library

Keep page identity and navigation consistent and accessible at every screen size.
Preserve URL context, focus and scroll during browsing.

Library browsing is search-led. Give artwork room, keep titles readable and make
playback discoverable. Avoid nested interactive targets. Distinguish viewing progress
from local availability, and omit unknown counts rather than inventing values.

Place the poster grid directly on the page background, using artwork and spacing to
organize browsing without an enclosing task panel.

### Work details

Prioritize the work's identity, playback and episodes. Reveal secondary metadata and
diagnostics when needed. Keep version-specific actions and recovery beside their
content, and preserve the Library context when navigating to details.

Let artwork and descriptive content integrate with the page background. Use task
panels for operation-heavy episode and resource sections, keeping each section's
controls with its affected content.

Make the next announced broadcast easy to find. Separate future plans from aired
history, show time-zone context and distinguish cached or unverified information.
Do not imply availability or announce dates without evidence.

### Files, Review and History

Favor efficient scanning and consistent action placement. Keep full names accessible
when visually shortened. Make correction and recovery specific to the affected
resource, and clearly communicate the scope of destructive operations before
confirmation. Preserve retryable input when an operation fails.

Use a continuous task panel for file browsing and history inventories, grouping
their search, filters, rows and pagination. Apply the same structure to original
files and prepared-copy management. Review may use separate panels for its work
list and identification editor because they support distinct tasks; organize the
editor's internal details with spacing and dividers before adding nested surfaces.

Distinguish actionable review work from historical decisions. Explain the scope and
consequences of re-identification before it starts. Keep background operations
nonblocking, prevent conflicting changes and report meaningful outcomes without
replacing the user's current context.

Files keeps original browsing and prepared-copy storage management in adjacent
views with a shared navigation context. Keep storage usage as subdued supporting text
beside page identity. Use compact search/filter controls consistent with original
file browsing. Distinguish no copies from no matching copies: provide a route to
original files for the former and a filter-reset action for the latter. Empty results
should not show selection commands or pagination. Manage actual copies independently of the
background task monitor. Show unfiltered storage totals and make unverified
availability explicit; a listing must not silently invalidate or clean up copies.

Keep prepared-copy selection and refresh visually secondary within the search and
filter toolbar. Use a quiet selection toggle and an accessible refresh icon with
in-place busy feedback. Let controls reflow on narrow screens while keeping search
and filter labels readable; avoid a separate row of prominent routine commands.

Use compact prepared-copy rows with filename and supporting size, configuration
and availability; reveal the full source path and generation time on demand. Keep
common actions compact and accessible. Hide checkboxes and batch commands until
users enter selection mode, and clear selection when they leave it. Selection
is limited to the current page and resets when search, filters or pagination change.
Before cleanup, show the selected count and estimated space, preserve originals,
and explain possible automatic regeneration. Deletion feedback follows the global
feedback rules, retaining access to per-copy failure reasons. Active preparation
and readers must explain why removal is blocked.

### Settings

Organize settings by user intent, with readable explanations and clear relationships
between choices. Keep navigation usable on narrow screens and preserve drafts when
changing categories. Avoid explanations that merely repeat labels.

Use one task panel per independent configuration task. Keep explanations and fields
together, and separate internal field groups with spacing or dividers rather than
additional cards.

Keep primary actions together and secondary commands discoverable. Distinguish saved
configuration from verified connectivity, and keep unresolved setup failures visible.

Persist single-value choices immediately; feedback follows the global feedback rules.
Keep failed drafts editable so users can correct and retry without re-entering them.
Reserve explicit Save actions for forms whose values must be submitted together, such
as connection credentials, download destinations and resource directories whose save
starts a library scan.

## Player layout

Keep the picture primary and playback interaction familiar. Size the player from the
source video's aspect ratio, and reduce its width when viewport height is the limiting
dimension instead of cropping the frame. Make continuation to the
next episode prominent when available. Expose common actions directly and reveal
technical details when needed. Keep recovery visible without crowding normal viewing.

Keep playback and audio choices usable with keyboard and touch. Long labels must not
crowd actions. Preserve playback and navigation context, including in fullscreen.
Logs must not contain media URLs or credentials. See
[playback requirements](../requirements.md#23-web-playback-and-subtitles) and
[viewing requirements](../requirements.md#24-viewing-history-and-tracking).

## Automatic acquisition

Make each episode's identity, primary action and acquisition state easy to scan.
Keep action placement stable when secondary commands appear or disappear. Avoid
repeating information that is better understood at work level.

Distinguish download completion from playback availability. Preserve playback when
another version is being acquired. Report real acquisition state and keep recovery
specific to the affected episode. Preserve existing content during refreshes and
never imply progress or availability without evidence.

Keep subscription intent near work-level actions. Separate subscription discovery,
configuration and source diagnostics from episode transfer and import recovery.
Keep actionable failures visible and preserve editor input during background updates.
See [subscription requirements](../requirements.md#25-subscriptions-and-resource-discovery).

### Subscription presentation and management

Present one understandable subscription summary per work. Prioritize actionable
failures and stopped states over management metadata. Make details and secondary
commands discoverable without competing with the work's main actions.

Keep the work title and subscription scope together. Use short, specific state labels
and an explicitly labeled details action; status text should remain readable without
being the only way to discover details. Show the affected work in detail and editing
views. Place exclusion and other secondary management commands in the affected row's
menu, with a discoverable restoration route. Distinguish temporary source failures
from configuration blockers without making routine waiting states look like errors.

Treat search and filters as one coherent way to narrow the inventory. Keep their
relationship clear, allow independent conditions to combine and make resetting them
easy. Distinguish an empty inventory from a search with no matches, offering a useful
next action in each case.

Group subscription search, filters, list-scoped commands, rows and pagination in
one continuous task panel, following the same inventory pattern as Files and
History. Ordinary subscription rows share the panel surface.

Keep one inventory for manual and automatic subscriptions, with exclusions and restore
actions associated with the affected work. Keep automation health visible without
letting configuration dominate inventory management. Automation policy and connection
setup belong in Settings.

Explain the consequences of starting-episode policies before users choose. Activation
previews should remain bounded and preserve policy input when cancelled. Background
refreshes should preserve content and ongoing interaction.

## Accessibility and responsive layouts

Support keyboard operation, visible focus, accessible names, sufficient contrast and
non-color status cues. Provide labels, useful units, visible validation and accessible
help. Supplemental hints must not replace essential recovery information, and help
must work with keyboard and touch.

Use [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/) as the accessibility target.
Normal text, including secondary text, needs at least 4.5:1 contrast; large text as
defined by WCAG needs at least 3:1. Necessary non-text control and state indicators
need at least 3:1 against adjacent colors. Check both light and dark themes.
Pointer targets must meet the 24 by 24 CSS px minimum or a documented exception
under [Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum);
the larger touch-target baseline above is a project usability preference.

Adapt grouping and density to available space while preserving reading order and
relationships. Keep touch targets usable, avoid overlapping controls and prevent
page-wide horizontal overflow.

Localize labels and feedback while preserving original filenames. Do not present
placeholder metadata, invented artwork, nonfunctional controls or incomplete
integrations as completed functionality.

## Maintenance and acceptance

Validate shared patterns in representative contexts before broad adoption. Review
light and dark themes across mobile, tablet and desktop sizes, including long titles,
Chinese filenames, empty/loading/error states and keyboard focus. Automated checks
alone do not establish visual acceptance.
Verify text resizing to 200%, complete long-title access, icon-only accessible names,
reduced-motion busy feedback and consistent typography roles across these contexts.
Keep text roles, icon mappings and action behavior in shared styles and components;
validate Files and Subscriptions as the initial examples before broader adoption.
These rules are acceptance targets, not a claim that existing pages already comply.

Verify that operation results use one toast, validation preserves drafts, and state
changes keep the task container, toolbar and unrelated controls in place. Check
success expiry, persistent failures, retry and background-error deduplication.

Review Files and Subscriptions together as representative management inventories
before extending the surface pattern to other pages. Verify that equivalent tasks
use the same surface roles, controls remain visibly associated with their content,
and supporting regions remain distinct from hover, selection and feedback states.

Preserve navigation context, cancellation, drafts and accessibility. Follow
[frontend ownership](architecture.md#frontend-ownership) and
[logging conventions](README.md#logging-choice) for changed business behavior.
Visual-only changes must not add payload or credential logging.

Run Biome for code changes and appropriate interaction checks. Report browser
verification separately. Keep this English document focused on durable design intent.

## Work titles

Make the selected primary title and its source clear. Keep alternative titles as
internal matching and search evidence so they do not compete with the work's identity.

Title presentation follows the global Settings preference (Chinese, original,
English or romaji), independently of interface language. Default to original and
use the original or another available title when the preferred one is missing.
Apply the same choice to cards, details, search, related works and Review. Local
file availability must not determine whether a work can receive a preferred title.
When background enrichment finds a missing title, update the existing card without
resetting its loading state, navigation context or unrelated page controls.
