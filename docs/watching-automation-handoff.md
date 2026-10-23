# Watching Automation Handoff

Superseded on 2026-10-24 by [unified subscriptions](subscription-interaction-redesign.md)
and the [current Watching guide](watching-automation.md). The following is the historical
2026-10-23 delivery record, not current creation/status policy.

Date: 2026-10-23 (Asia/Shanghai).
Workspace: `/Users/qwer/Project/Code/Anishelf`.
Branch: `next`. Continuation baseline: `7c92d72`.

**Status: implementation continuation completed; changes are uncommitted. Live
Watching acceptance remains pending. The aggregate `npm test` command is not green
on this macOS host because two deployment tests fail at a filesystem ownership operation.**

The user explicitly requested continuation of the earlier paused handoff. No real
Watching grant was confirmed, no account automation was enabled, and no production
containers or data were modified. The browser test used isolated fixture data and
its temporary page/server were removed/stopped after verification.

## Preserved decisions

- Automation defaults to disabled and requires explicit activation with a complete,
  session-bound, five-minute scope preview.
- Global disable and per-work exclusion/manual pause are independent. Existing
  manual subscriptions are never adopted. Submitted transfers and ingestion
  continue when managed acquisition is suspended.
- Confirmed Tracking progress plus one is the default starting policy; episode 1
  is the alternative. Starting scope freezes only at successful admission.
- Custom acquisition-profile hot reload remains future requirement O20. Packs,
  quality upgrades and cross-site ranking remain outside this iteration.
- The user reported successful live acceptance of the preceding manual search →
  activation → qBittorrent → verified ingestion → browser playback pipeline.
  That report is separate from fixture proof and pending real Watching acceptance.
- English documentation, safe logs, Biome/lint required. Do not commit; provide a
  suggested Git commit message in chat.

## Completed continuation

1. Unresolved source discovery no longer persists a premature starting episode.
   Retries derive the current confirmed lower bound; admitted work retains its
   frozen scope across progress changes/restarts/grant renewal. Preview text now
   explains that unadmitted starting episodes are estimates.
2. Negative, fractional or excessive progress cannot create a progress-based grant
   for a fabricated/clamped episode. Preview shows a nullable lower bound and an
   actionable `invalid_progress` decision. Invalid entries do not exhaust each
   pass's five-admission budget or starve valid work.
3. Renewed source grants explicitly retain the same pinned site under the newly
   accepted connector generation only if it is still configured. Removed sites
   remain blocked with `source_reselection_required`; the operator guide explains
   explicit source selection/manual conversion. Existing pins are not silently
   replaced by another site.
4. Another account's owned subscription is reported as `different_account_owner`;
   confirming the new account cannot adopt it or activate the old owner's scope.
5. Current Watching scope remains bounded to 500. Retained old ownership/exclusion
   tombstones no longer prevent overrides on new works. The 64-subscription limit
   is reported as `subscription_limit` before discovery; reconciliation retries
   when capacity is freed. Both limits have user-facing recovery guidance.
6. Tracking projects explicit `refreshAllowed`, keeping authorization failure,
   disconnection, coalescing and retry policy with the Tracking owner. The worker
   honors that projection. Watching shutdown stops waiting on shared refreshes via
   the existing abortable helper; Anime subsequently drains Tracking before SQLite
   closes. Late discovery still rechecks policy/member/snapshot revisions.
7. Added decision logs with work/account identifiers and sanitized reason codes.
   Watching mutation responses now also use `Cache-Control: no-store`.
8. Watching copy and manual-conversion copy use the translation catalog; reason
   formatting lives outside the component module. Mutation responses update the
   shared query cache before invalidation. Long action labels wrap on narrow
   layouts; per-work detail links support actionable recovery.
9. Updated current requirements/architecture, database ownership documentation and
   the [operator guide](watching-automation.md). Migration metadata was formatted
   to pass Biome; parsed JSON content is unchanged. No SQL migration changed in
   this continuation.

## Verification

Final checks against the completed code:

| Check | Result |
| --- | --- |
| `npm run biome:check` | Passed |
| `npm run lint` | Passed, including architecture and unused checks |
| `npm run typecheck` | Passed for backend, frontend and tests |
| Backend full suite | 81 files; 1186 passed, 1 skipped |
| Frontend full suite | 48 files; 373 passed |
| `npm run architecture:test` (through aggregate test invocation) | 64 passed |
| `npm run build` | Passed; existing frontend chunk-size warning remains |
| `git diff --check` | Passed |
| Narrow browser fixture | Reviewed preview/confirmation, disable and management controls |
| Aggregate `npm test` | Stops at the two deployment tests described below |

Added regression coverage includes default-off/non-authorizing previews;
login/CSRF/session-bound confirmation; expiry, single-use and stale revisions;
account ownership; invalid progress/batch fairness; source-generation renewal;
limits and tombstones; refresh eligibility/backoff and shutdown; atomic rollback of
subscription/authorization/ownership; explicit frontend activation/overrides and
manual-conversion consent.

Managed-work integration uses the real Watching, Subscriptions and Downloads
applications plus SQLite and fixture source/downloader/resource collaborators. It
proves global disable and Tracking Paused changes after reservation block an unsent
submission. Separate cases prove those same changes after submission still allow
the transfer to reach actual resource-refresh/Anime-ingestion fixture callbacks,
with no duplicate add. This is application integration evidence, not live services.

### Host-specific deployment test limitation

Both tests in `package/qbittorrent-init.test.mjs` fail at
`chown(credentialsDir, owner, owner)` with `EPERM`, including outside the sandbox.
The fixture passes `process.getuid()` as the owner, and the initializer uses that
number for both UID and GID. On this macOS account that group change is not
permitted. The test run stops before backend/frontend suites, so those suites were
run separately with the required localhost/subprocess permissions and passed.
Deployment code was not changed or bypassed. Rerun the deployment tests in the
supported Linux/container ownership environment before claiming an entirely green
aggregate suite.

## Remaining external acceptance

Live ACQ12–ACQ15 still require a real connected Tracking account, supported Jackett
site, qBittorrent, mapped storage and browser playback. Explicitly review/confirm
the real scope before enabling it, then verify a new Watching work, source/episode
selection, one download, actual ingestion/playback, status suspension/re-entry,
manual overrides, outages and restart. See [the operator guide](watching-automation.md).
Do not infer that acceptance or production activation from passing fixtures.

Suggested commit message (do not commit automatically):

`fix(acquisition): complete Watching automation admission and validation`
