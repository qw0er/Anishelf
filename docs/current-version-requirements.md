# Anishelf Current Version Requirements

**Active iteration: V2 (planned, not implemented). Latest implemented version: V1.**

This overview keeps the complete release scope, feature inventory, quality boundaries and acceptance coverage visible together. Detailed behavior and all individual acceptance scenarios are retained in the [V2 requirements record](history/v2-requirements.md). The [current design](current-version-design.md) explains the architecture, and the [overall requirements](requirements.md) lists the complete product roadmap.

“Implemented in” means acceptance passed; “Target version” means planned delivery. V1 completion and manual browser acceptance are user-reported. V2 stays planned until its criteria pass. Maintain stable feature IDs, inherited behavior, partial-delivery boundaries and release history across iterations.

## 1. Goal and Operating Scope

Extend the existing file browser into an everyday Web viewing workflow:

**configure a resource directory → scan manually → select a file → play directly, use a prepared copy, or transcode in real time as needed → select subtitles → watch → save progress → return and resume**, with an option to generate and copy a media link for opening manually in an external player.

- Web playback is the default and primary experience. Selecting a file or continue-watching entry opens the Web player. Generating a transferable media link is a secondary action; invoking a player from the browser is deferred.
- Personal use, one server, one resource root with nested directories, and one active playback session.
- Keep original media read-only. Store viewing records, extracted/converted subtitles, and prepared copies separately from the resource root.
- Retain local/loopback operation and the existing deployment boundary. LAN authentication, public deployment, and client coordination remain unassigned.
- Use English for UI, user-facing messages, and documentation; preserve original filenames.
- Choose and record the target desktop browser/version and representative real media samples for V2 acceptance. File extensions alone do not prove compatibility.
- Continue using directories and files as organizational and playback units. Anime identification and episode associations are not prerequisites.

## 2. Complete Feature Inventory

| ID | Requirement | Iteration scope | Implemented in | Target version |
| --- | --- | --- | --- | --- |
| V01 | Resource directory configuration | Configure and persist one root; allow startup before setup; expose existence/readability errors | V1 | V1 |
| V02 | Manual scanning | Recursively discover supported video extensions; avoid duplicate paths; reflect additions/removals | V1 | V1 |
| V03 | Resource browsing | Actual hierarchy, original names, stable natural sorting, and parent navigation | V1 | V1 |
| V04 | Web playback | Stream original compatible files without downloading the whole file first; support seeking | V1 | V1 |
| V05 | Basic playback controls | Play, pause, seek, volume, fullscreen, and return to the original directory | V1 | V1 |
| V06 | Failure feedback | Distinguish missing/unreadable resources and unsupported media or playback failures | V1 | V1 |
| W01 | Saved progress and resume | Persist position, duration, and last viewing time on the server; restore position when reopening a file | — | V2 |
| W02 | Continue watching | Show available files with saved unfinished progress and open them for resume | — | V2 |
| P03 | External subtitles | ArtPlayer VTT/SRT/ASS/SSA discovery, selection and off | — | V2 |
| P08 | Embedded subtitle extraction | FFmpeg extraction from MKV/other containers; text tracks, fonts and supported bitmap assets; other formats unassigned | — | V2 (partial) |
| P09 | Styled subtitles and fonts | ASS/SSA rendering and extracted fonts; bitmap Web rendering remains unassigned | — | V2 (partial) |
| P05 | Playback strategy | Use original compatible media; choose the required preparation path for the target browser | — | V2 |
| P06 | Container-only preparation | Remux compatible audio/video when only the container is incompatible | — | V2 |
| P07 | FFmpeg pre-transcoding and real-time transcoding | Necessary streams only; reusable completed copies or segmented playback during processing; seeking, cleanup and recovery | — | V2 |
| C01 | External-player media link | Generate and copy a client-reachable original-media URL for the user to paste into a player | — | V2 |
| C02 | Browser invocation of an external player | Ask the browser/OS to open a player protocol or otherwise invoke a native player | — | Later |
| C03 | External-player state reading | Read position, playing/paused state and playback end when a future integration exposes them | — | Later |
| O14 | Multilingual foundation | English message catalog, stable keys and fallback; translated locales/selector deferred | — | V2 (partial) |
| O17 | External configuration | Separate default files and unified validated access | — | V2 |
| O16 | Complete everyday-use Web interface | Finished application navigation, resource browsing, continue watching, Web player, preparation feedback, and V2 settings with responsive and accessible states | — | V2 |

External configuration covers supported containers/MIME mappings, target transcode formats/profiles, subtitle policy and runtime limits in separate default files accessed through one layer. Multilingual readiness keeps English message resources and stable keys; future program titles, aliases and descriptions retain language tags and original language independently of IDs. [Expanded configuration and multilingual requirements](history/v2-requirements.md#external-configuration-and-multilingual-foundation-o17-partial-o14).

## 3. Viewing Workflow and Interface

Web viewing follows three paths: play a compatible original, prepare and reuse a completed Web copy, or process only incompatible streams while watching. Compatible streams are copied, and subtitles are handled independently. Progress and subtitle timing follow the original source across all three paths. The secondary external-player action generates and copies an original-media URL for manual opening.

| Area | Complete experience |
| --- | --- |
| Application shell | Library, Media tasks and Settings; clear navigation, current location and return context |
| Library | Real directory hierarchy, natural sorting, original filenames, manual scan/status, continue watching and recent viewing |
| Web player | ArtPlayer controls, resume/start over, subtitles/off, direct/prepared/real-time status and processing reasons, return to directory |
| Media tasks | Preparation and real-time states, useful progress/error feedback, retry/cancel/stop, play ready copy and delete cached copy |
| Settings | Resource root, Web playback preference and cache budget; validated saves and useful feedback |
| External-player link | Generate/copy a client-reachable original-media URL with selectable-text fallback |
| All screens | Finished English UI, responsive desktop/mobile layouts, keyboard access, visible focus, long/CJK filenames, and loading/empty/error/retry states |

[Detailed workflows, processing branches, subtitles and interface rules](history/v2-requirements.md#2-requirements-and-implementation-versions) retain the complete behavior; [interface acceptance](history/v2-requirements.md#3-complete-web-interface-o16) covers 1280 px and 390 px layouts and real API-backed actions.

## 4. Acceptance Coverage

V2 must pass all retained V1 scenarios and all planned V2 scenarios. This table covers every acceptance ID; the [version record](history/v2-requirements.md#4-acceptance-criteria-and-versions) retains each scenario and its exact passing result.

| Coverage | Acceptance IDs | Required outcome |
| --- | --- | --- |
| Inherited configuration, scans, browsing, streaming, controls, errors and confinement | A01–A07 | Preserve the implemented V1 foundation |
| History, resume, lists and update ordering | A08–A10 | Durable source-scoped progress without stale updates or accidental resets |
| External/embedded/styled subtitles and fonts | A11–A12, A24 | Selection, styling and timing work within declared format boundaries |
| Preparation and real-time playback | A13–A15, A22–A23 | Minimum necessary processing, source-time seeking, reuse, cleanup and restart recovery |
| External-player media links | A16–A18 | Correct reachable URL, copy/selectable fallback, safe access and unchanged Web history |
| Complete Web interface | A19–A21 | Web-first actions, finished workflows, responsive and accessible presentation |
| Tool discovery and persistence | A25–A26 | Optional PATH discovery, safe durable storage and asset reconciliation |
| Unified external configuration | A27 | Defaults, validation, custom-value preservation and profile-sensitive cache reuse |
| Multilingual foundation | A28 | English message keys/fallback and language-independent identity contracts |

Record actual browser/OS/tool versions and representative media before acceptance. Automated transport/UI checks do not certify decoding. Update implemented-version fields in both requirement documents only after acceptance, including partial P08/P09 and O14 boundaries.

## 5. Essential Quality Requirements

- Preserve V1 root confinement, bounded media streams, seeking, atomic scan publication, persistent settings, and read-only originals.
- Persist progress durably without requiring the in-memory index to survive restart; do not mix viewing records into rebuildable scan state.
- Restrict generated-asset access to known cache entries. Separate writable application data/cache from original media and frontend static assets.
- Bound shared pre-transcode/real-time concurrency and clean up children, leases and partial output during failure/shutdown.
- External-player support in V2 generates a transferable media URL only. Browser/OS invocation (C02) and native-state reading (C03) remain later requirements.
- External services and unassigned integrations must not become playback dependencies.
- FFmpeg/FFprobe executable overrides are optional; default discovery uses the server process PATH. Missing tools disable dependent features with actionable feedback.
- Keep user preferences in settings.json and administrator policy in separate configuration files accessed through the unified layer. Use SQLite through Drizzle ORM for application records and cache metadata; store media/subtitle/font payloads as files. Cache cleanup must not erase durable viewing records or user settings.

## 6. Deferred Product Scope

C02 browser invocation and C03 external-player state reading are later requirements. Other deferred items remain in the [Overall Requirements](requirements.md): anime metadata/episode mapping, next-episode automation, watched markers/tracking statuses, subscriptions/RSS, qBittorrent ingestion, external trackers, remote control/saved-position handoff, multi-client coordination, automatic scans, file management, dedicated original downloads, additional locale packs/language selection, and frontend query-library migration. Bitmap subtitle Web rendering/OCR/burn-in, unsupported extraction formats, hardware acceleration and HDR guarantees remain unassigned.

## 7. Release History and Document Navigation

| Version | State | Delivered or planned scope |
| --- | --- | --- |
| V1 | Implemented; manual browser acceptance user-reported | V01–V06 and A01–A07: configuration, manual scans, browsing, direct playback, controls, and failure feedback |
| V2 | Active plan; not implemented | W01–W02, P03, partial P08/P09, P05–P07 (including real-time transcoding), C01, partial O14, O16–O17, and A08–A28 |

For each subsequent iteration, preserve this history, advance the active-version label, retain first implementation versions on inherited requirements, and add explicit target versions and acceptance criteria for newly selected requirements.

Use this page for the overall release picture. Expand the [V2 requirements record](history/v2-requirements.md) for exact rules and scenarios, the [V2 design record](history/v2-design.md) for technical details, and [version/historical documentation](historical-design.md) for previous decisions. When requirements change during V2, update both the overview and the corresponding detailed rule; preserve version records when selecting the next release.
