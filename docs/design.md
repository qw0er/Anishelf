# Anishelf Design

- [UI principles](#ui-principles)
- [Visual and interaction conventions](#visual-and-interaction-conventions)
- [Feedback and interface states](#feedback-and-interface-states)
- [Accessibility and responsive layouts](#accessibility-and-responsive-layouts)

This document owns visual and interaction design guidance. [Requirements](requirements.md)
owns product scope and acceptance; [Architecture](architecture.md) owns implementation
decisions and module boundaries; [Development](development.md) owns setup and maintenance.

## UI principles

Keep the interface simple and focused on the user's current task. Present the
information and actions needed to make the next decision; avoid dense screens,
duplicated status, decorative metrics, and controls for unsupported or unrelated
features.

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
values. Routes own server loading; components own transient form and player state.
Cancellation and stale-response guards prevent departed views from publishing results.

Keep lists compact with aligned actions. Truncate long names where needed and make
the full name available through an accessible Tooltip. Communicate status with shape
and text as well as color. Give icon-only controls accessible names and visible
keyboard focus.

When space allows, label buttons with an icon and text. When space is constrained,
use an icon-only button with a Tooltip that names the action. The Tooltip must not
replace the control's accessible name or visible keyboard focus.

Keep compatibility and task status outside action menus. Put shared choices in
Settings. The preparation panel is a nonblocking active-task monitor, not a dedicated
page.

## Feedback and interface states

Use deduplicated Toasts for operation results and recoverable playback or subtitle
failures. Keep ongoing subtitle-preparation feedback visible until completion,
failure, or selection cancellation. Reuse existing retry actions.

Keep form validation, initial page errors, unavailable resources, scan/stale status,
setup guidance, and empty states in context. Provide useful next actions without
repeating the same information in multiple places. Do not imply a numeric completion
percentage when only a task state is known; use an indeterminate state instead.

Unrelated polling must not reset playback or subtitle renderers.

## Accessibility and responsive layouts

Support keyboard navigation, visible focus, accessible control labels, sufficient
text contrast, and status/error cues that do not rely on color alone. Keep controls
usable on desktop and narrow/mobile layouts without overlap or page-wide horizontal
overflow. Validate at 1280 px and 390 px widths, including long and Chinese filenames.

Keep labels and feedback in English. Preserve original filenames. Do not show
placeholder metadata, nonfunctional controls, invented posters, or incomplete
integrations as completed features.
