# Current Iteration Requirements

## 1. Goal and Status

Deliver an anime library from existing local resources using external metadata, automatic admission of successful identification and manual correction. Completed scans automatically identify new or changed local resources and admit unambiguous work/episode matches. The user can resolve ambiguous titles and episode numbers, browse confirmed anime by episode and choose a file version for existing Web playback.

This iteration is selected and not yet complete or accepted. The backend
[Identification module](identification.md) implements stateless local recognition
and candidate-specific proposals. An application coordinator automatically processes
published scans. [Metadata](metadata.md) supplies cached AniList search, details,
relations, airing and artwork. [Anime Catalog](anime-catalog.md) implements backend persistence, review decisions,
confirmation/correction operations and library queries. The Web poster library, work detail and version playback are implemented;
Automatic admission and the Web Review/correction workflow are implemented. Files-specific inline identification presentation remains pending. No release number is assigned. The [overall requirements](requirements.md) own feature identifiers and later scope; [History](history.md#v2-requirements) records the retained V2 scope as implemented. The anime-library acceptance below remains pending.

External metadata access belongs to this iteration. Personal tracker authorization, list import and progress synchronization are later capabilities and must not be prerequisites for identifying local files.

The [current iteration overall design](current-version-design.md) selects
`anitomy-ng` for local extraction and AniList as the first metadata provider,
with provider extensibility and persistent metadata/artwork caching. The default
interface becomes a poster-based anime library; directory browsing remains the
resource-management and identification entry, alongside a review workflow.
The poster library, detail/playback, automatic admission and Review/correction workflows are implemented.

## 2. Selected Requirements

| IDs | Required behavior |
| --- | --- |
| M01, M02 | Search one external anime metadata provider and retrieve details, stable provider IDs, covers, titles/aliases, descriptions, airing information, episode data and same-provider work relations where available. Clearly distinguish unknown data from confirmed values. |
| M05, M07 | Persist metadata snapshots and available language information. Show refresh/failure status, allow retry and retain cached browsing during provider outages. Use stable local identities independent of provider IDs and display language. |
| L07 | Parse filenames and directory names for title, year, season/part, episode numbers/ranges, release group and available language/quality/version evidence. Preserve originals and raw parsed values. |
| L08, M04 | Generate ranked external-metadata candidates with understandable match reasons. Allow candidate search, preview, confirmation, rejection, reassociation and episode corrections. Provide a review list for unidentified or ambiguous resources. |
| L09 | Distinguish regular episodes, specials, continuous numbering and multi-episode resources. Use available external episode/work relations and user corrections to map numbering; missing or conflicting evidence remains unresolved. |
| L10 | Associate different resource versions with the same episode and allow explicit selection for playback. One file may map to multiple episodes without implying unsupported per-episode seek boundaries. |
| M03 | Provide an anime library and detail view showing metadata, ordered episodes, associated versions and unavailable/unresolved resources. Reuse existing playback, subtitles, preparation and source-level progress. |

## 3. User Workflow

1. Scan existing resources using the current library workflow. Published scans automatically trigger local identification; no separate Identify action is required.
2. Identification parses file and directory evidence and uses Metadata to generate ranked candidates and candidate-specific episode proposals. A directory supplies context but is not assumed to contain only one anime.
3. Anime Catalog automatically accepts clear matches. Failed or ambiguous identification stays in Review: select a suggested work, search for another title or look up an AniList ID/URL, preview the targets and confirm. Mixed directories are handled per source.
4. Use Review for pending, associated or rejected sources; previously identified content can be reassociated explicitly. Use Catalog-owned correction operations to review episode mappings, including specials, continuous numbering, ranges and season/part boundaries. Correct individual mappings or apply an explicit numbering offset with a preview of affected files.
5. Save confirmed associations and open the anime detail view. Select an episode and resource version for playback.
6. Rescan or refresh metadata without silently overwriting confirmed manual choices. Unidentified files remain accessible through the existing file browser.

## 4. Identification and Persistence Rules

- Keep anime entries, episodes, source files, file-to-episode associations and provider identifiers distinct. Retain both parsed release numbering and confirmed episode numbering.
- Candidate scoring may use title/alias similarity, year, season/part, format and episode evidence. Scores are not probabilities. Close candidates or conflicting evidence require review; unknown episode numbers must not be silently classified as a special episode.
- Manual confirmation and corrections take precedence over later automatic identification. Replacing them requires an explicit user action with affected resources visible.
- Repeated identification must not duplicate local anime, episodes or associations. Persist confirmed associations and metadata across restart; interrupted work can be retried without duplicating results.
- Refreshing provider metadata must not erase user corrections, file associations or viewing history. Changed or unavailable sources must not inherit unrelated progress or be presented as playable without existing access validation.
- Preserve existing source-level playback progress when establishing or changing associations. Episode watched-state aggregation and completion detection belong to W03–W05 in the next core stage.
- Cached metadata and original file playback remain usable during provider outages. New uncached searches can fail with actionable retry feedback; incomplete episode relations remain explicit.
- Identification consumes validated source identities and name/path strings. The coordinator accesses originals without renaming, moving or deleting them. Resource-root confinement and source-version access checks continue to apply.
- Start with AniList through an extensible provider adapter and use `anitomy-ng` for extraction. Validate both against representative resources; retain explicit unknowns where AniList cannot provide complete episode data or numbering relations.

## 5. Acceptance Criteria

Full iteration acceptance and representative recognition accuracy remain pending. Acceptance must include representative Chinese, Japanese and English filenames, directory-only titles, mixed-work directories, specials, continuous numbering, season/part ambiguity, multi-episode files and multiple versions. Record parser/provider versions, sample expectations, unresolved cases and actual results.

The [offline identification corpus](../backend/test/fixtures/anime-identification/README.md)
provides sourced filenames, frozen provider records, expected associations, review
cases and directory recipes for this evaluation. Corpus integrity and scanner
checks do not establish identification accuracy or complete the acceptance criteria.

| ID | Requirements | Passing result |
| --- | --- | --- |
| CAT01 | M01, M02, M07 | Search, preview and establish a local anime entry with provider ID, available aliases/language information and episode/work data; missing fields are shown as unknown. |
| CAT02 | L07, L08 | Filename and directory evidence produce explainable candidates; a mixed directory can be split into different works; close or conflicting candidates enter review. |
| CAT03 | L09 | Regular, special, continuous and multi-episode numbering map correctly for confirmed samples; ambiguous mappings remain unresolved and accept corrections. |
| CAT04 | L08, M04 | Manual title and episode corrections, including offset previews, survive rescan, metadata refresh and restart; reassociation preserves existing source history. |
| CAT05 | L10, M03 | Anime detail lists episodes and versions; selecting a valid version opens existing Web playback with working directory return, subtitle/preparation access and source progress. |
| CAT06 | M05 | Provider failure leaves cached details and original playback usable; failed search/refresh exposes retry feedback and retains the last valid snapshot. |
| CAT07 | L08, M01–M05 | Repeated or interrupted identification does not duplicate entries/associations; saved mappings survive restart and unavailable files are not presented as playable. |
| CAT08 | L07–L10 | Identification leaves original names/bytes unchanged and preserves root confinement; unidentified files remain browsable and playable through the existing path. |

## 6. Subsequent Core Stages

| Order | Scope | Required capabilities |
| --- | --- | --- |
| 2 | Episode viewing and tracking (W03–W05) | Planned/watching/completed/paused/dropped statuses, completion detection, manual watched corrections, watched counts, available unwatched episodes and known missing episodes; multiple file versions do not inflate counts. |
| 3 | Automatic acquisition (S01–S07, D01–D07) | Per-anime subscription controls, starting episode/backlog preview, RSS discovery, release matching/filtering and deduplication, explainable review, qBittorrent connection/task controls, verified completion/ingestion and restart/disconnection recovery. |
| 4 | Tracker integration (T01–T05, S08) | AniList authorization/disconnection, selected list import, title/episode mapping, progress/status synchronization, conflict preview, retry and expired-authorization feedback; importing lists does not implicitly enable downloading. |

These stages are priorities, not implementation claims or assigned release numbers. Multiple metadata providers/cross-provider mappings (M06), automatic file organization (L13), moved-file relinking (L11), playback enhancements and additional clients remain outside this iteration.
