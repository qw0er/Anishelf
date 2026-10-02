# Anishelf Current Version Requirements

**V1 is implemented; V2 is in progress.** V1 manual browser acceptance is user-reported.
The direct-playback Vidstack adapter is implemented and checked with a temporary
H.264 sample. Saved progress, playback history/resume, and same-directory external
subtitle discovery, version-checked delivery, selection and rendering are implemented.
The FFmpeg/FFprobe utility layer supports media inspection and selected text-subtitle
extraction. Playback preparation, embedded-subtitle integration, and the other
unfinished requirements below remain part of the current V2 scope.

Startup options use defaults and environment variables. `ANISHELF_DATA_DIR` overrides the platform-specific user data directory selected by `platformdirs`. The [current design](current-version-design.md) specifies the V2 architecture.

## 1. Goal and Operating Scope

Extend the existing file browser into an everyday Web viewing workflow:

**configure a resource directory → scan automatically at startup and after root changes, or manually → select a file → play directly, use a prepared copy, or transcode in real time as needed → select subtitles → watch → save progress → return and resume**, with an option to generate and copy a media link for opening manually in an external player.

- Web playback is the default and primary experience. Selecting a file or a playback-history entry opens the Web player. Generating a transferable media link is a secondary action for manual use in an external player.
- Personal use, one server, one resource root with nested directories, and one active playback session.
- Keep original media read-only. Store viewing records, extracted/converted subtitles, and prepared copies separately from the resource root.
- Retain local/loopback operation and the existing deployment boundary.
- Use English for UI, user-facing messages, and documentation; preserve original filenames.
- Choose and record the target desktop browser/version and representative real media samples for V2 acceptance. File extensions alone do not prove compatibility.
- Continue using directories and files as organizational and playback units. Anime identification and episode associations are not prerequisites.

## 2. Requirements and Implementation Versions

| ID | Requirement | Iteration scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| V01 | Resource directory configuration | Configure and persist one root; allow startup before setup; expose existence/readability errors | V1 | V1 |
| V02 | Library scanning | Automatically scan at startup and after resource-root changes; allow configurable scheduled scans (60 minutes by default; 0 disables) and manual rescans; recursively discover supported video extensions; avoid duplicate paths; reflect additions/removals | V1 | V1 |
| V03 | Resource browsing | Actual hierarchy, original names, stable natural sorting, and parent navigation | V1 | V1 |
| V04 | Web playback | Stream original compatible files without downloading the whole file first; support seeking | V1 | V1 |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory | V1 | V1 |
| V06 | Failure feedback | Distinguish missing/unreadable resources and unsupported media or playback failures | V1 | V1 |
| W01 | Saved progress and resume | Persist position, duration, and last viewing time on the server; restore position when reopening a file | V2 | V2 |
| W02 | Playback history and continue watching | List recent available files with saved progress; resume unfinished files and reopen completed files | V2 | V2 |
| P03 | External subtitles | Vidstack VTT/SRT/ASS/SSA discovery, selection and off | V2 | V2 |
| P08 | Embedded subtitle extraction | FFmpeg extraction from MKV/other containers; supported text tracks, fonts and bitmap assets | V2 (partial) | V2 (partial) |
| P09 | Styled subtitles and fonts | ASS/SSA rendering and extracted fonts; provide clear feedback for unsupported Web rendering | V2 (partial) | V2 (partial) |
| P05 | Playback strategy | Use original compatible media; choose the required preparation path for the target browser | — | V2 |
| P06 | Container-only preparation | Remux compatible audio/video when only the container is incompatible | — | V2 |
| P07 | FFmpeg pre-transcoding and real-time transcoding | Necessary streams only; reusable completed copies or segmented playback during processing; seeking, cleanup and recovery | — | V2 |
| C01 | External-player media link | Generate and copy a client-reachable original-media URL for the user to paste into a player | — | V2 |
| O14 | English UI foundation | English message catalog, stable keys and fallback | V2 (partial) | V2 (partial) |
| O17 | Unified configuration | TypeScript policy defaults, validated user overrides and typed access | V2 (partial) | V2 |
| O16 | Complete everyday-use Web interface | Finished application navigation, resource browsing, playback history/resume, Web player, preparation feedback, and V2 settings with responsive and accessible states | V2 (partial) | V2 |

### Saved Progress, Resume, and Playback History (W01, W02)

- Save playback position, duration, and last viewing time to the server during playback at a bounded interval and on pause, seek completion, and normal player exit. Periodic saves bound progress loss when a tab closes unexpectedly.
- Restore the saved position after media metadata is available; clamp it to the playable duration. Seeking to zero uses the ordinary progress-save flow. Resume must not depend on audible autoplay being allowed.
- Show save/load failures and allow retry without blocking playback. A failed load must not silently overwrite an existing record with an initial zero position.
- Reject delayed or duplicate updates that would overwrite a newer accepted update. Seeking backward intentionally must remain possible; choosing the greatest position is not a valid conflict policy.
- Scope records to the resource root and source identity/version so switching roots or replacing content at the same path cannot apply unrelated progress. Unchanged files retain progress across rescans and server restarts.
- Removing a file from the index does not erase its viewing record. Missing or replaced resources are excluded from actionable history entries.
- Playback history is ordered by last viewing time and includes available files with saved progress, including completed files and records saved at position zero. Each entry can reopen the file with its original directory context; unfinished files resume from their saved position.
- The History page shows up to 100 recent files with saved position, known duration, and last viewing time. It provides refresh, empty, loading, and unavailable-history states.
- Original, prepared and real-time playback of the same source share a viewing record; HLS segment-relative timestamps map back to source time.

### Subtitles and Embedded Extraction (P03, Partial P08–P09)

- Support external WebVTT, SRT, ASS and SSA with Vidstack and a dedicated ASS/SSA renderer. Preserve ASS/SSA styling, positioning and fonts within the validated renderer capability; do not silently strip styling by converting every track to plain WebVTT.
- Discover same-directory matching filenames and language suffixes. Show multiple/ambiguous candidates for selection. Provide track selection and off controls; show language, title, format and unsupported status where available.
- Use FFprobe to enumerate subtitles packaged inside video containers, including MKV, and FFmpeg to extract a selected supported track to an independent cached subtitle asset. Extract embedded WebVTT, SubRip/SRT, ASS/SSA and associated supported font attachments. No audio/video transcode is required solely for extraction.
- Identify and extract supported embedded PGS/VobSub bitmap tracks in their native representation; report clearly when a track cannot be rendered in the Web player. Unsupported extraction codecs produce feedback; P08 remains partial.
- Apply the same playback path to external and extracted text subtitles. Keep cue timing and styled overlays aligned on original, pre-transcoded and real-time media, including resume and seeks that restart transcoding at an offset.
- Keep originals read-only; store extracted/converted assets separately. Enforce root confinement, regular-file checks, asset/attachment size limits and cache invalidation. Do not trust embedded attachment filenames as paths.
- Malformed, missing, unreadable, unsupported or unrenderable subtitles show useful errors without blocking video. Missing fonts show a fallback warning. P09 covers styled ASS/SSA and supported fonts; bitmap tracks report Web-rendering limitations.

### FFmpeg Pre-transcoding and Real-time Transcoding (P05–P07)

V2 implements both **Prepare for Web → wait for a reusable completed copy → play** and **Watch → transcode only as needed while playback proceeds**. Web playback remains primary. The automatic strategy prefers a compatible original, then an existing valid prepared copy, then necessary real-time processing. A user may choose direct-only or preparation-first behavior; pre-transcoding the library is never automatic.

| Source and target compatibility | Required processing |
| --- | --- |
| Original container/audio/video supported | Direct playback; no media transcode |
| Only delivery container unsupported | Remux with compatible audio/video copied |
| Audio alone unsupported | Copy video; encode audio only |
| Video unsupported | Encode video; copy audio if compatible, otherwise encode audio |
| Subtitle needs extraction or text-format conversion | Process only subtitle; keep compatible audio/video untouched |

- Use FFprobe inspection and validated browser/delivery capabilities, not filename extensions alone. Report the processing mode and per-stream reason. Copy compatible streams in both pre-transcoding and real-time paths.
- Pre-transcoding produces a reusable completed Web-compatible file, with seeking, deduplicated work, queued/processing/ready/failed/cancelled feedback, retry and cache deletion. Partial MP4 output must never be exposed as a ready file.
- Real-time playback begins from complete playable segments before the entire file is processed. Show starting, streaming/buffering, completed, stopped and failed states. Do not expose partially written segments.
- Support real-time pause/resume and seeking beyond the already generated range by restarting processing near the requested source position. Preserve source-time progress and subtitle synchronization; do not make the user wait for processing from the beginning.
- Share source history across original, prepared and real-time playback. Validate source version and profile before reuse; changed or unavailable originals invalidate derived playback.
- Bound total processing concurrency and cache storage. Give interactive playback priority over background preparation with explicit interruption/requeue feedback. Report insufficient compute/storage rather than claiming all inputs transcode at real-time speed.
- Stop/reclaim real-time processing on player exit, expired client lease, source invalidation, failure or shutdown. After restart, interrupted sessions cannot appear streaming or ready; reopening uses saved progress. Interrupted pre-transcodes remain retryable.
- Preserve original media and durable history when cancelling jobs, deleting/evicting cached assets or cleaning incomplete outputs. No multi-resolution ladder, hardware encoding, HDR guarantee, or automatic whole-library preparation is required in V2.

### External-Player Media Link (C01)

V2 offers a secondary **Copy media link** action for users who want to open the file manually in an external player. Web playback remains the primary workflow.

- Resolve the selected file through the existing API and recheck its accessibility. Generate a client-reachable absolute URL from the relative original-media route and the browser's application origin, including an SSH-forwarded origin. Never expose server filesystem paths or internal hostnames.
- Copy the URL to the clipboard and display it in a selectable field if clipboard access is unavailable. The user pastes it into the external player's Open URL command. The external player fetches media directly over HTTP/Range; the browser does not relay media bytes.
- Do not choose a player, register a protocol, open another application, or claim that playback started. Validate link formation with spaces, Unicode, percent signs, ampersands, and forwarded origins.
- External playback is **playback only**. It does not read or synchronize position, pause, completion or watched state; it does not update Web history or transfer saved position. The copy-link action does not require an Anishelf bridge.
- Web playback remains usable regardless of whether the user opens the copied link.

### Configuration and Multilingual Foundation (O17, Partial O14)

The current-function configuration foundation is implemented: one `ConfigurationService` validates built-in policy and explicit settings, supplies immutable snapshots, and preserves atomic writes. `GET /api/client-config` exposes only safe client policy and supported capabilities. Transcode profiles, cache budgets and profile-content cache invalidation remain planned until the corresponding V2 features exist.

- Use environment variables for startup options. Define media-format capabilities, subtitle support and limits, runtime defaults and built-in transcode profiles in TypeScript. Bundle the English catalog as a read-only resource. Do not copy these defaults into persistent policy files.
- Store only user choices in `settings.json`: resource root, Web playback mode, cache budget and selected profile IDs. Save custom profile definitions or parameter overrides only if V2 exposes editing them. Merge explicit user values with the current built-in defaults, validate the result and write settings atomically. Missing fields receive current defaults; explicit choices survive upgrades. Reject invalid settings with actionable diagnostics.
- Application modules consume one validated typed configuration view. Profile-content changes invalidate cached outputs. Configuration cannot bypass access checks or create unsupported browser, renderer or FFmpeg capabilities. Expose only safe client preferences and capabilities through the API.
- Use stable UI/error keys, a separate English catalog and English fallback. Ship English UI and preserve original filenames.

## 3. Complete Web Interface (O16)

Replace the basic V1 validation pages with a finished interface for everyday use. This is a V2 deliverable with real API-backed behavior, not a static mockup. Keep Web viewing prominent throughout the application.

| Area | Required experience |
| --- | --- |
| Application shell | Consistent navigation between Library, preparation tasks, and Settings; clear current location, page titles, and back navigation |
| Library | Clear directory/file presentation, breadcrumbs, parent navigation, readable original filenames including long/Chinese names, scan action/status, and access to playback history with progress and resume actions |
| Web player | Video as the main focus; Vidstack play/pause/seek/volume/fullscreen controls; subtitle selection/off, saved progress/resume, direct/prepared/real-time status and processing reason, and return to the original directory |
| Preparation tasks | Reachable pre-transcode queued/processing/ready/failed/cancelled and real-time starting/streaming/stopped states, affected filename, available progress feedback, failure reason/retry/cancel, real-time stop, and prepared-copy deletion; ready copies link to Web playback |
| Settings | Clearly grouped resource-directory configuration, Web playback mode, cache budget, and supported playback/configuration options; expose only settings supported by V2 |
| External-player link | Secondary **Copy media link** action with a selectable URL fallback, distinct from the primary Web playback action |

- Define and apply a consistent visual system for typography, spacing, colors, buttons, forms, and status indicators. Use deliberate layouts and readable hierarchy rather than the existing test-page arrangement.
- Provide designed initial setup, loading, empty library, no continue-watching entries, refreshing, success, partial-scan warning, unavailable resource, and recoverable failure states with useful next actions.
- Keep scan/transcoding/persistence feedback visible without interrupting usable browsing or active Web playback. Do not claim an unsupported numeric completion percentage; show an indeterminate state when only task status is known.
- Preserve the current directory and return context when moving between browsing and playback. Opening tasks/settings and returning must not unexpectedly discard the user's location. Explain any root-change reset.
- Support desktop and narrow/mobile layouts without overlapping controls or page-wide horizontal overflow. Validate at least 1280 px and 390 px viewport widths. Long filenames must remain identifiable and full names accessible.
- Provide keyboard navigation, visible focus, accessible control labels, sufficient text contrast, and status/error cues beyond color alone. Destructive cache actions must clearly identify that they delete a prepared copy.
- Keep labels and feedback in English. Do not show placeholder metadata, nonfunctional controls, invented posters, or incomplete integrations as completed features.
- This scope presents V2's real file-based workflow.

## 4. Acceptance Criteria and Versions

### Inherited V1 Baseline

These scenarios passed in V1 according to the user's manual acceptance report and remain regression requirements for V2.

| ID | Scenario | Passing result | Implemented in |
| --- | --- | --- | --- |
| A01 | Configure and scan nested media directories | Hierarchy appears and navigation works | V1 |
| A02 | Repeat scans; add/remove files and rescan | No duplicate entries; changes appear | V1 |
| A03 | Play a validated compatible sample | Audio/video start before the whole file is downloaded | V1 |
| A04 | Pause, seek to an unplayed position, adjust volume, enter fullscreen | Controls work and playback continues at the requested position | V1 |
| A05 | Unreadable directory, removed file, or unplayable media | Appropriate errors appear; browsing remains usable | V1 |
| A06 | Leave the player | Original directory is restored | V1 |
| A07 | Chinese/spaced paths and outside-root access attempts | Valid resources work; outside-root and symlink escapes are rejected | V1 |

### V2 Acceptance

Implementation versions are listed in Section 2. A dash below means that the acceptance scenario has not been recorded as complete.

| ID | Requirements | Scenario and passing result | Acceptance completed in | Target version |
| --- | --- | --- | --- | --- |
| A08 | W01 | Watch, pause, reopen, rescan, and restart: saved progress survives and resumes correctly; backward seeks, including zero, persist | — | V2 |
| A09 | W01, W02 | Playback history is ordered by last viewed time, includes completed and zero-position records, offers resume/replay, and excludes missing or replaced sources from actionable entries; changed roots/content cannot inherit unrelated progress | V2 | V2 |
| A10 | W01 | Delayed/duplicate updates cannot overwrite newer progress; failed loading does not write zero; persistence errors leave playback usable | — | V2 |
| A11 | P03, P08, P09 | Select/disable VTT/SRT/ASS/SSA external and extracted text tracks; preserve validated styles/fonts and timing across original/prepared/real-time playback | — | V2 |
| A12 | P03, P08 | Ambiguous matches require selection; malformed/unsupported/unavailable subtitles produce feedback; outside-root access is rejected; originals remain unchanged | — | V2 |
| A13 | P05, P06, P07 | Real samples exercise all four strategy branches; compatible streams are preserved in remux/audio-only cases; incompatible samples play and seek after preparation | — | V2 |
| A14 | P07 | Duplicate requests share work; repeated playback reuses output; source changes invalidate it; queued/processing/ready/failed states are accurate | — | V2 |
| A15 | P07, W01 | Failure, insufficient storage, interrupted jobs, restart, retry, and cache deletion do not expose partial output or alter originals/history | — | V2 |
| A16 | C01 | Generate a reachable original-media URL and copy it or show it in a selectable field; manually open it in a player through the local and SSH-forwarded application origins | — | V2 |
| A17 | C01, W01 | Missing/unavailable media produces a useful link error; copying the link never changes Web playback history or progress | — | V2 |
| A18 | C01 | Generated links contain only the validated application media route; spaces, Unicode, percent signs and ampersands resolve to the intended resource, including through SSH forwarding | — | V2 |
| A19 | O16, C01 | File/resume actions open Web playback; Copy media link is visibly secondary and never invokes another application | — | V2 |
| A20 | O16 | Complete setup, scan, browse, resume, subtitle selection, preparation/retry/cache deletion, and settings workflows through finished API-backed screens; navigation and directory return context remain correct | — | V2 |
| A21 | O16 | At 1280 px and 390 px widths, long/Chinese filenames, controls, and task feedback remain usable; keyboard focus, labels, contrast, and loading/empty/error states pass visual and interaction review | — | V2 |
| A22 | P05–P07, W01 | Real-time playback begins before full conversion; seek into ungenerated media, pause/resume and reopen preserve source-time position and subtitle alignment; compatible streams are copied | — | V2 |
| A23 | P07 | Exit, expired lease, repeated seeks, source changes, failure and restart stop old children and clean incomplete output; preparation yields to playback and can restart; no stale generation is served | — | V2 |
| A24 | P03, P08, P09 | MKV with multiple text tracks and fonts extracts/selects correctly; external and extracted ASS/SSA styles/CJK text render; supported bitmap tracks extract but display explicit unsupported-Web feedback | — | V2 |
| A25 | Configuration | With no tool paths configured, FFmpeg/FFprobe resolve independently from process PATH; valid overrides work, missing/invalid binaries show dependent-feature errors while direct playback remains usable | — | V2 |
| A26 | Persistence | User settings remain in settings.json; Drizzle migrations/transactions preserve history and enforce deduplication; restart reconciles SQLite and asset files; cache cleanup never removes durable records | — | V2 |
| A27 | O17 | Startup uses current built-in defaults for unset choices, preserves explicit settings across upgrades, rejects invalid overrides, supplies one validated view and invalidates cached output when the effective profile changes | — | V2 |
| A28 | O14 | English UI, player labels and errors resolve through message keys with fallback; language-independent IDs and original filenames remain stable | — | V2 |

Record browser/OS versions for Web playback, representative external-player URL checks, source codecs, subtitle formats, pre-transcode and real-time profiles, styled subtitle/font samples, and real-sample results. Automated tests do not certify browser decoding. V2 completion requires the new acceptance scenarios and retained V1 regression behavior; then update implemented-version fields, including the partial P08/P09 boundaries.

## 5. Essential Quality Requirements

- Preserve V1 root confinement, bounded media streams, seeking, atomic scan publication, persistent settings, and read-only originals.
- Persist progress durably without requiring the in-memory index to survive restart; do not mix viewing records into rebuildable scan state.
- Restrict generated-asset access to known cache entries. Separate writable application data/cache from original media and frontend static assets.
- Bound shared pre-transcode/real-time concurrency and clean up children, leases and partial output during failure/shutdown.
- External-player support generates a transferable media URL only; the user opens it manually in a player.
- External services must not become playback dependencies unless explicitly included in this scope.
- FFmpeg/FFprobe executable overrides are optional; default discovery uses the server process PATH. Missing tools disable dependent features with actionable feedback.
- Keep user preferences in `settings.json`, program policy in TypeScript and the English catalog in a bundled resource. Use SQLite through Drizzle ORM for application records and cache metadata; store media/subtitle/font payloads as files. Cache cleanup must not erase durable viewing records or user settings.
