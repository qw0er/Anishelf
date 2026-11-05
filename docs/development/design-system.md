# Anishelf Design System

This document owns design principles and the reasoning behind interface decisions.
[Requirements](../requirements.md) owns product behavior and scope;
[Architecture](architecture.md#frontend-ownership) owns data and module boundaries;
[History](../history.md) records delivered iterations. Component APIs, library
choices and exact layout values belong in implementation, rather than this document.

## UI principles

- **Content first.** Let artwork, titles and playable episodes lead. Use clear
  alignment, restrained decoration and enough space to understand related content.
- **One clear next action.** Make primary actions apparent. Disclose secondary
  commands and diagnostics when relevant without hiding consequential information.
- **Consistent meaning.** Give equivalent states, actions and fields consistent
  meaning across the application, while allowing each task an appropriate density.
- **Continuity.** Background work must preserve usable content, input, focus,
  navigation context and playback.

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

Place information according to how long it matters to the task. Durable information
belongs beside the affected content. Temporary feedback should be nonblocking and
should not displace the page.

- Initial loading should communicate the expected content without inventing data.
- Empty results should explain the situation and offer a useful next action.
- Read failures should remain distinguishable from confirmed empty results and
  provide a recovery action.
- Validation, setup blockers and conflicts should appear beside the affected input
  or item while preserving user work.
- Background refresh should retain existing content and avoid resetting interaction.
- Operation feedback should be concise, deduplicated and offer recovery when useful.
- Ongoing work should report its actual state, without invented percentages.
- Persistent issues, authorization failures and reconnection needs must remain
  visible in context; routine success does not need persistent emphasis.

Deduplicate repeated background failures across refreshes and navigation, and allow
new failures to be reported after recovery.

## Page patterns

### Navigation and Library

Keep page identity and navigation consistent and accessible at every screen size.
Preserve URL context, focus and scroll during browsing.

Library browsing is search-led. Give artwork room, keep titles readable and make
playback discoverable. Avoid nested interactive targets. Distinguish viewing progress
from local availability, and omit unknown counts rather than inventing values.

### Work details

Prioritize the work's identity, playback and episodes. Reveal secondary metadata and
diagnostics when needed. Keep version-specific actions and recovery beside their
content, and preserve the Library context when navigating to details.

Make the next announced broadcast easy to find. Separate future plans from aired
history, show time-zone context and distinguish cached or unverified information.
Do not imply availability or announce dates without evidence.

### Files, Review and History

Favor efficient scanning and consistent action placement. Keep full names accessible
when visually shortened. Make correction and recovery specific to the affected
resource, and clearly communicate the scope of destructive operations before
confirmation. Preserve retryable input when an operation fails.

Distinguish actionable review work from historical decisions. Explain the scope and
consequences of re-identification before it starts. Keep background operations
nonblocking, prevent conflicting changes and report meaningful outcomes without
replacing the user's current context.

### Settings

Organize settings by user intent, with readable explanations and clear relationships
between choices. Keep navigation usable on narrow screens and preserve drafts when
changing categories. Avoid explanations that merely repeat labels.

Keep primary actions together and secondary commands discoverable. Distinguish saved
configuration from verified connectivity, and keep unresolved setup failures visible.

## Player layout

Keep the picture primary and playback interaction familiar. Make continuation to the
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

Treat search and filters as one coherent way to narrow the inventory. Keep their
relationship clear, allow independent conditions to combine and make resetting them
easy. Distinguish an empty inventory from a search with no matches, offering a useful
next action in each case.

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

Preserve navigation context, cancellation, drafts and accessibility. Follow
[frontend ownership](architecture.md#frontend-ownership) and
[logging conventions](README.md#logging-choice) for changed business behavior.
Visual-only changes must not add payload or credential logging.

Run Biome for code changes and appropriate interaction checks. Report browser
verification separately. Keep this English document focused on durable design intent.

## Work titles

Make the selected primary title and its source clear. Keep alternative titles as
internal matching and search evidence so they do not compete with the work's identity.
