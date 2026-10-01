# Anishelf Design System

Use Tailwind's default typography, spacing, width scale, and breakpoints, together
with the existing shadcn-style shared controls and light/dark theme. Vidstack
owns its control appearance. Choose additional styling when a concrete screen
requirement needs it.

## Shared Layout

`web/src/index.css` defines the recurring page compositions. It combines native
Tailwind utilities rather than duplicating their values as new theme tokens.

| Utility | Use |
| --- | --- |
| `page-container` | Align the header and content in the same centered container, with responsive side gutters. |
| `page-content` | Add responsive vertical padding to main content or a standalone error page. |
| `stack-page` | Separate major page sections, with more room from the default `sm` breakpoint. |
| `page-title` | Style the page's semantic `h1` and allow long titles to wrap. |
| `action-row` | Arrange related actions with wrapping on narrow screens. |

Use native utilities for local gaps, labels, supporting text, and form widths.
Shared Card components own their padding; sections inside a page do not add a
second outer gutter. Button, Input, and Card retain their base component sizing
and appearance. Use semantic headings regardless of their visual size.

## Content and Actions

Keep filenames intact and let them wrap. Library rows keep the icon beside the
name; file size sits below the name on narrow screens and in a separate column
from `sm`. Use tabular numerals for sizes and allow saved resource paths to break
without widening the page. The media viewport remains 16:9, capped at 75 vh.

Use the default Button variant for the main operation, such as starting a scan
or saving settings. Use outline buttons for refresh, retry, and return actions;
navigation uses the existing ghost and selected secondary variants. Keep visible
labels and hide decorative icons from assistive technology.

Use an icon with a visible text label for primary actions. In space-constrained
areas, use an icon-only button with a Tooltip available on hover and keyboard
focus, plus an accessible name. Choose recognizable icons; keep visible text
when an action would otherwise be ambiguous. Tooltips supplement the action
rather than being its only accessible label. When a loading spinner replaces
an action icon, use the same icon size and do not leave an empty icon slot.

## Feedback

- Loading: retain the current layout, delay spinners and skeletons to avoid brief
  flashes, and expose busy state. Skeletons follow the base control and heading
  dimensions. Keep Vidstack's own loading and control appearance.
- Setup and empty states: explain the missing resource directory or empty listing
  in context; setup links to Settings.
- Scanning and refreshing: display the actual status and available counts. Keep
  incompatible operations disabled while work is in progress.
- Warnings and stale results: show explanatory text, retain the available listing,
  and keep warning details expandable. Do not rely on color alone.
- Errors: use the existing destructive text color and `role="alert"`. Provide
  retry or return actions where supported; keep settings errors beside the form.
- Saving: retain the input, disable the active form while saving, and show the
  saved path after success. Display the returned error after a failed save.

## Maintenance and Validation

CSS and shared components are authoritative for style values. This document
records their use and the screen behavior they support. Add a shared utility or
component when a recurring requirement needs coordinated maintenance.

Check existing screens at narrow and desktop widths (for example, 390 px and
1280 px), in light and dark themes. Include long filenames and paths, empty and
loading states, warnings, and errors. Confirm readable content, no page-wide
horizontal overflow, visible keyboard focus, and reachable actions. DOM tests
cover interactions; browser inspection is required to validate geometry and
Vidstack's controls.

Extend these conventions as new workflows are implemented.
