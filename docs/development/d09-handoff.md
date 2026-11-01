# D09 implementation handoff

Date: 2026-11-01 (Asia/Shanghai)
Workspace: `/home/qwer/Project/Code/Anishelf`, branch `next`.

## Implemented

- Missing regular episodes expose **Download this episode** in More. Available local episodes hide this acquisition action.
- `POST /api/acquisition/downloads/episodes` durably accepts one episode before background discovery. No subscription is created or changed and no publication picker is shown.
- Shared release ranking keeps global hard requirements and priorities, bypasses subscription waiting, and searches every configured source. Empty or failed discovery stops until explicit Activity retry.
- One-off authorization, discovery, configuration fences and accepted identity survive restarts. Activity and per-task recovery work without a subscription. Unknown submissions reconcile before any explicit resend and cannot switch publications after configuration changes.
- Local and remote details share an aired-episode timeline. Unknown totals use confirmed broadcast progress. Playable local files remain visible, while future/unknown empty placeholders and future broadcast records are hidden.
- Known airtimes invalidate detail/schedule queries; refreshed evidence is required before adding rows. Failed refreshes preserve confirmed rows.
- Migration `0018_individual_episode_downloads.sql` preserves existing subscription downloads and adds one-off authorization plus discovering state.
- English architecture, database, UI guidance and requirements documentation, Chinese/English strings and lifecycle logs are updated. D09 is marked complete; D10 remains partial.

## Validation already completed

- Full `npm run check` passed, including Biome, architecture, unused exports, type checking, installer/deployment tests, backend tests and Web tests.
- Full-suite summaries recorded before the final narrow retry-fence refinement:
  - Tests  1504 passed | 6 skipped (1510)
  - Tests  466 passed (466)
- Production `npm run build` passed. Vite reported the existing large-chunk advisory.
- After the final retry-fence refinement, all 16 tests in `backend/test/modules/acquisition/downloads/one-off.test.ts` passed, including shutdown/restart and repeated uncertain-publication recovery. Biome was applied to the changed code.
- Browser checks used temporary local fixture data at 390, 768 and 1280 pixels in light/dark themes. Verified More, background acceptance, unsubscribed Activity, Chinese/long text, keyboard opening/Escape, focus restoration and no horizontal overflow. Temporary preview and browser tab were closed.

## Remaining verification

The user requested stopping additional checks and completing this handoff within two minutes.

- The full check/build were not repeated after the last small refinement: `uncertainSubmission` and `reconcileOnly` in one-off authorization retain the original publication across repeated recovery attempts and clear on confirmed binding. Focused tests for that final code passed.
- No live Jackett/qBittorrent download or production deployment was performed. Browser acceptance used mocked API data; transport integration and acquisition behavior were tested separately.
- Empty/error presentation has automated coverage but was not exhaustively inspected in the manual browser session.

No known failing tests remain. Continue only the outstanding validation if requested; avoid repeating unrelated investigations. Existing working-tree changes belong to this task and must be preserved.

## Review entry points

- `backend/src/modules/acquisition/downloads/application/one-off.ts`: durable acceptance, discovery, explicit recovery and configuration fences.
- `backend/src/modules/acquisition/release-selection.ts`: shared selection with optional waiting.
- `web/src/features/anime/catalog/episode-timeline.ts` and `use-episode-timeline.ts`: shared visible episodes and broadcast-boundary refresh.
- `web/src/features/acquisition/episode-download-menu.tsx`: More command and Activity notification.

No Git commit was made. Suggested commit message:

```text
feat(acquisition): add one-off episode downloads and aired episode timelines
```
