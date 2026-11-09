# Feedback Consistency Handoff

Date: 2026-11-09. Inspection baseline: `main` at `76e9f87`.

## Objective and status

Apply the unified [feedback and interface state rules](design-system.md#feedback-and-interface-states)
throughout the web client. Preserve existing page structure, usable content, drafts,
focus, scroll and control placement when feedback changes.

The design rules have been updated. The implementation audit is a source review of
shared feedback utilities and the Playback, Tracking, Resources, Preparation,
Acquisition, Settings, authentication and Review entry points. No implementation
fixes, runtime failure injection or browser acceptance checks were performed in this
handoff. Findings below are repair targets, not a claim that every page or every
possible failure path has been verified. Recheck the branch and worktree before
starting; source locations may change.

## Authoritative presentation rules

The design system owns policy; this handoff identifies implementation gaps.

- Operation results use one global toast. Success expires after six seconds;
  failure and partial success remain until dismissed or resolved. Offer Retry when
  a safe retry exists. Do not repeat the result in a page summary or dialog.
- Input validation belongs beside its field, with space reserved for ordinary
  validation feedback and the draft preserved. Do not also emit a toast.
- Current state updates in the existing button, status area or content container.
  Keep persistent authorization or setup issues discoverable there. Do not remove
  essential recovery information merely because it is inline.
- Initial read failure belongs inside the existing content container with Retry.
  Background failure retains usable data and uses a deduplicated toast.
- Ordinary activity uses the initiating button's busy state; long tasks use the
  existing task list or status area. Dialogs support decisions before an operation.

## Findings

### F01 — Failure toasts expire throughout the application

**Confirmed in source.** [Toaster](../../web/src/shared/components/ui/toast.tsx)
applies one default timeout to all types.
[Interaction defaults](../../web/src/shared/config/interaction-defaults.ts) define
six seconds for ordinary messages and ten seconds for errors, but error type alone
does not select the latter. Many callers omit a timeout entirely.

Affected shared paths include [background refresh errors](../../web/src/shared/hooks/use-refresh-error.ts),
[anime refresh failures](../../web/src/features/anime/shared/refresh-feedback.ts),
[tracking commands](../../web/src/features/anime/tracking/use-tracking-mutation.ts),
and [preparation commands](../../web/src/features/media/preparation/use-preparations.ts).
Explicit ten-second failures also occur in [playback progress saving](../../web/src/features/playback/player/hooks/use-playback-session.ts),
[tracking operation feedback](../../web/src/features/anime/tracking/operations.ts),
[identification feedback](../../web/src/features/anime/identification-status.tsx)
and [subtitle preparation](../../web/src/features/media/subtitles/components/subtitle-tracks.tsx).

Fix the shared lifecycle first, then migrate callers and explicit overrides. Treat
partial success by its outcome, not just by a `warning` type: not every informational
warning represents partial failure. Ensure recovery closes stale failures and a
later failure can notify again after recovery or explicit retry.

### F02 — Validation produces duplicate feedback

**Confirmed in source.** Invalid input already renders a field error, then its blur
handler adds an error toast in these settings:

- [qBittorrent WebUI URL](../../web/src/features/acquisition/webui-settings.tsx).
- [Jackett management URL](../../web/src/features/acquisition/source-settings.tsx).
- [RSS refresh interval](../../web/src/features/acquisition/rss-settings.tsx).
- [Prepared-media cache budget](../../web/src/features/settings/components/resource-settings.tsx).

Keep field validation and its accessible association; remove the duplicate toast.
Distinguish invalid input from a valid value whose save request failed.

### F03 — Operation failures are inserted into forms or dialogs

**Confirmed in source.** These components render operation results as conditional
inline error blocks rather than using the global result channel:

- [Player viewing control](../../web/src/features/anime/tracking/player-viewing-control.tsx):
  combines mutation failure and operations-query failure in one paragraph. Some
  mutation errors also generate a toast in `useTrackingMutation`.
- [Tracking account settings](../../web/src/features/anime/tracking/account-settings.tsx):
  account-command errors add a paragraph and a refresh action.
- [Watching settings](../../web/src/features/acquisition/watching-settings.tsx):
  preview, confirmation, disable and override failures share an inline message.
- [Subscription form](../../web/src/features/acquisition/subscription-form.tsx):
  every save failure uses the same inline conflict message, including failures
  that do not establish a revision conflict.
- [Resource operation dialog](../../web/src/features/resources/library/components/resource-operations.tsx):
  move/delete execution failures append an error paragraph to the confirmation UI.

Classify failures by meaning before moving them. Actual field validation remains
beside the field; operation failures use a toast. Preserve retryable inputs and
necessary confirmation decisions. Do not blindly retry destructive commands.

The player text “Could not load or update the tracking service completion.” is a
specific starting point: its fallback is used for operations-query failure, so it
does not establish that progress upload failed. Separate read and submission copy,
and distinguish local playback-position saving from external tracking synchronization.
Update both English and Chinese translations.

### F04 — Update-check failure is reported twice

**Confirmed in source.** [About settings](../../web/src/features/settings/components/about-settings.tsx)
emits an error toast and conditionally adds “last check failed” to the page.
Use one failure toast. Retain useful version information and release links in their
existing state area; those are content, not duplicate failure messages.

### F05 — Background failure can replace an existing form

**Confirmed branching behavior; reproduce in the browser.** These paths select an
error-only branch on `isError` without first checking for usable cached data:

- [Download destination settings](../../web/src/features/acquisition/destination-settings.tsx).
- [WebUI settings](../../web/src/features/acquisition/webui-settings.tsx), configuration query.
- [RSS settings](../../web/src/features/acquisition/rss-settings.tsx), configuration query.

Retain the mounted form and draft after background failure. Use the error-only
content state only when no usable data exists. Verify focus and draft retention,
not just the continued presence of text on screen.

### F06 — Background errors append new content regions

**Confirmed in source; visual displacement is unmeasured.** These components render
conditional inline read errors even when prior data is still available:

- [Prepared-media inventory](../../web/src/features/media/preparation/components/prepared-media-page.tsx).
- [Subscriptions inventory](../../web/src/features/acquisition/subscriptions-page.tsx).
- [Download activity](../../web/src/features/acquisition/download-activity.tsx).
- [Airing plans](../../web/src/features/anime/catalog/components/airing-status.tsx).

Separate initial failure from background failure. Keep toolbars and existing rows
in place; background failure uses the shared deduplicated toast. Do not interpret
a read failure as an empty result or remove current object-state information.

### F07 — Validation space is generally not reserved

**Confirmed in source; check representative layouts.** Many forms conditionally
mount error paragraphs. The shared [FieldError](../../web/src/shared/components/ui/field.tsx)
returns `null` without a message, and the `field-error` utility in
[index.css](../../web/src/index.css) only styles text.

Examples include [login](../../web/src/app/auth/login-page.tsx),
[security settings](../../web/src/app/auth/security-settings.tsx), the settings in
F02, and [Review validation](../../web/src/features/anime/review/components/review-editor.tsx).
Keep a stable field-error slot sized for ordinary localized feedback. Do not hide
or truncate longer recovery instructions merely to enforce a fixed height. An
empty reserved slot must not announce an empty alert.

### F08 — Some Review failures have no visible outlet

**Confirmed conditional path; endpoint reachability is not runtime-tested.**
[Review feedback](../../web/src/features/anime/review/feedback.ts) suppresses toasts
for HTTP 400, 404, 409 and 422, assuming the caller displays those failures inline.
[ReidentifyAllAction](../../web/src/features/anime/review/components/reidentify-all-action.tsx)
uses this helper but renders no corresponding inline error. If one of those
responses occurs, no failure feedback is produced there.

Ensure each caller has one visible failure channel. HTTP status alone must not
classify every failure as field validation. Also review `WatchingSettings` in
management mode: its combined mutation-error block is inside `!management`, so
management actions need a visible failure path of their own.

### F09 — In-progress work still occupies toasts

**Confirmed in source.** Tracking pending/submitting operations, automatic
identification and subtitle preparation use persistent activity toasts in the
files listed under F01. Move activity to existing controls or status areas where
available, while retaining operation-result notifications. Do not introduce a new
temporary panel to replace an activity toast. Where no suitable existing state
area exists, resolve that placement before removing the only activity indication.

## Useful existing patterns

- `SourceSettings` and `QbittorrentApiSettings` already separate initial read
  failures from background failures using cached data and `useRefreshError`.
  Reuse that distinction after correcting the shared timeout behavior.
- Prepared-media deletion already provides one result toast, persistent failures,
  retry and unmount cleanup. It is a partial reference: lengthy per-copy reasons
  are currently rendered directly in the toast, whereas the design calls for
  lengthy batch details to be available on demand.
- Existing refresh and tracking helpers retain failure identities. Preserve
  deduplication across refreshes and navigation when consolidating presentation.

## Suggested implementation order

1. Fix the missing failure outlets in F08 and establish shared result lifecycles
   in F01. Avoid a repository-wide replacement of all error messages.
2. Separate player read, local-save and external-sync failures; remove duplicate
   operation and validation messages in F02–F04.
3. Correct background-read branches in F05–F06 without remounting usable content.
4. Add reusable validation spacing, then migrate representative forms in F07.
5. Move activity feedback in F09 and make lengthy batch failure details available
   on demand. Keep task controls and status discoverable throughout.

Keep query identity, cancellation, tracking command identity and retry semantics
intact. Use existing shared components and localization. Follow the repository's
logging conventions for changed business behavior; log useful operation context
without credentials, media URLs or sensitive payloads. Do not commit changes.

## Verification and acceptance

For implementation changes, run `npm run biome:check`, web type checking, and the
focused tests covering changed behavior. Relevant existing suites include:

- Playback: `player-viewing-control`, `save-recovery`, `playback-preferences` and
  `external-subtitles` under `web/test/features/playback/`.
- Tracking/Review: `tracking-operation-feedback`, `viewing-editor`,
  `identification-notifications` under `web/test/features/anime/`, and
  `web/test/app/review/app-review.test.tsx`.
- Settings/Acquisition: `about-settings`, `anilist-account`, `authentication`,
  `source-settings`, `rss-settings` and `watching-settings` in their feature folders.
- Preparation: `web/test/features/media/preparation.test.tsx`.

Use focused failure-injection tests where necessary to verify lifecycle, missing
feedback and draft preservation. Tests requiring child processes or localhost must
run in an environment that permits those operations.

Browser acceptance must cover light/dark themes, narrow/wide layouts and both
languages, including the following sequences:

1. Invalid input, blur and correction: one field message, no toast, stable controls.
2. Valid input followed by save failure: draft preserved, one persistent toast;
   retry succeeds and the stale failure closes.
3. Background refresh failure with cached data: data, focus and scroll remain;
   repeated polling and navigation do not replay the same failure.
4. First-load failure and empty results: distinct states, useful recovery, stable
   task container and toolbar placement.
5. Success, total failure and partial success: correct expiry, one notification,
   recoverable actions and accessible batch details.
6. Tracking authorization loss, operation conflict and long-running work: current
   state and required decisions remain discoverable without new result blocks.
7. Leaving a resource scope closes its notifications; recovery allows a later
   failure to notify again. Cancellation must not emit a failure toast.

Report automated checks and browser verification separately. This documentation
change itself was checked with `git diff --check`; no implementation tests were run.
