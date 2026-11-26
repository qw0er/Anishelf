# Season packs and selective episode acquisition

Design and acceptance record for [S14](../implemented-requirements.md#selective-season-pack-acquisition-s14).

A subscription or one-off request specifies the episodes the user wants. A release
offers files that may satisfy some or all of that request. Plan the download from
the intersection, using the same rules for airing shows, finished shows and
individual episodes. A season pack is complete when its distinct regular episodes
cover the known season. The release title, publication date and video count alone
cannot establish that coverage.

## Pre-implementation behavior

| Stage | Previous behavior and consequence |
| --- | --- |
| Discovery | The release assessor accepts a single regular episode. A recognizable range can be discarded before inspection. Conversely, the real Frieren S2 release in the corpus with `Batch S02 S2` in its title was accepted as episode 3. [Release assessment](../../apps/server/src/modules/anime/release-assessment/application.ts) · [Release corpus, case `nyaa-2106580-title`](../../apps/server/test/fixtures/anime-releases/corpus.json) |
| Source choice | Subscription discovery returns the first configured site with an eligible release. One-off discovery searches across sites but filters by the requested episode number in the title. Either path can miss the best pack. [Subscription discovery](../../apps/server/src/modules/acquisition/subscriptions/application/discovery.ts) · [One-off discovery](../../apps/server/src/modules/acquisition/downloads/application/one-off.ts) |
| Transfer | An intent has one accepted episode and a unique torrent hash. It cannot reserve a whole pack or add another episode from a previously selected pack. [Download model](../../apps/server/src/modules/acquisition/downloads/domain/model.ts) · [Reservation constraints](../../apps/server/src/modules/acquisition/downloads/infrastructure/schema.ts) |
| Inspection and import | The torrent reader validates paths but returns the hash and submission source. The worker requests the file list after transfer completion. Import expects exactly one selected video and stops before identifying files in a multi-video download. [Torrent reader](../../apps/server/src/modules/acquisition/downloads/infrastructure/torrent.ts) · [Transfer observation](../../apps/server/src/modules/acquisition/downloads/transfers/application.ts) · [Import](../../apps/server/src/modules/acquisition/downloads/application/import.ts) |

## User-visible selection rules

| Request and library state | Expected choice |
| --- | --- |
| Airing show with one missing episode, or an explicit request for episode 3 | Prefer a matching single at the best eligible profile level. A pack can supply episode 3 if its file and associated subtitles can be selected individually. |
| Finished, 12 known episodes, all missing, subscription starts at 1 | Prefer a qualifying pack covering 1–12 over equivalent individual releases. Fall back to partial packs and singles for uncovered episodes during the same planning pass. |
| Episodes 1–8 available, or the subscription starts at 9 | Acquire only 9–12, including from a larger pack when selective download is available. A candidate that would also fetch earlier episodes is ineligible for this request. |
| Airing show missing 1–6, or unknown final episode count | A verified 1–6 pack can fill those gaps. Unknown totals allow confirmed episodes to be acquired and keep overall completion open. |
| Release includes specials, clean openings/endings or duplicate encodes | Select one eligible version per requested regular episode and matching subtitle sidecars. Extras do not count toward coverage. Archiving every file in a publication would require a separate, explicit user action. |

Tracking progress determines a starting episode only where the existing accepted
subscription policy uses it. Compute new work from that scope minus verified local
episodes and live episode claims, including downloads awaiting import. Completion
uses verified local coverage alone. Preserve airing delays, pause and Watching
controls, and the existing one-off retry behavior. [Subscription lifecycle and completion](../guide/watching-automation.md)

## From publication to file selection

1. **Shortlist publications.** Sources supplies titles, declared attributes, bounded search results and opaque download references. Plausible work identity plus a possible single, range or season qualifies for inspection. Treat `Batch`, `合集` and ranges as reasons to inspect, and `END` as compatible with a single finale. Continue to the next candidate when inspection fails. During initial automatic site discovery, compare useful coverage across permitted sites before binding one. Respect an existing pin or explicit RSS feed. Apply the same shortlist rule to one-off requests.
2. **Obtain a file list before downloading media.** Sources resolves its own reference to torrent bytes or a magnet. TorrentClients exposes metadata inspection by capability. Both routes produce the torrent identity and a manifest with each file's stable client index (or a validated mapping to it), relative path and byte size. Validate the source revision, hash, path components, manifest size and file indices before use. Support the torrent identities accepted by the existing reader first. Keep credentials and private download URLs inside their owning adapters.
3. **Map files to the known work.** Pass paths, parent directories and sibling context through the shared identification workspace. Record each regular video's episode set, version evidence, and associated subtitle files. Treat a release title as work/season context. Require consistent work and numbering evidence for selected files. A conflict affecting the work or season invalidates the affected mapping. Isolated extras with unknown numbering can be ignored. [Identification parser](../../packages/anime-identification/src/parser.ts) · [Episode mapping](../../packages/anime-identification/src/mapping.ts)
4. **Choose a feasible file set.** Apply hard profile requirements, the best unlocked level and its existing wait rules per episode. For a one-off, use the existing immediate selection policy. A pack cannot unlock a waiting level early for another episode. Retain the distinction between release declarations and file evidence. A declared subtitle language can satisfy the existing profile policy, while a manifest alone cannot verify embedded tracks. Reject contradictory file attributes for the affected version. Among equivalent quality choices, prefer the full pack for a whole missing season, then maximize newly covered episodes and minimize unnecessary files or bytes. Use existing seeder, revision and stable ordering for ties. Recompute the remaining gaps after each choice. [Selection profiles](../guide/acquisition-profiles.md)
5. **Authorize the exact files at submission.** Record the accepted work and metadata snapshot, target episodes, torrent identity, selected file indices, paths and sizes. Immediately before adding a torrent or enabling more files, check the current source, destination, client generation, authorization, local availability and reservations. Replan stale selections. Ranking and admission must agree on the accepted manifest mapping. Reapplying the old single-episode title check here would reject legitimate packs. [Submission admission](../../apps/server/src/modules/acquisition/downloads/application/admission.ts)

### Metadata availability and download client capabilities

qBittorrent 5.2.0 includes Web API support for inspecting uploaded torrent bytes
(`torrents/parseMetadata`), fetching magnet metadata (`torrents/fetchMetadata`),
and setting file priorities when adding the torrent. Probe these capabilities per
connection generation. Preserve the existing path validation for uploaded bytes.
On clients lacking metadata preview, supported torrent bytes can still be inspected
locally with the existing `parse-torrent` dependency. Require effective file
selection for any subset download. An uninspectable magnet or an unsupported subset
falls through to the next candidate. [qBittorrent Web API changelog, 2.11.9](https://github.com/qbittorrent/qBittorrent/blob/release-5.2.0/WebAPI_Changelog.md#2119)

Budget metadata requests per discovery pass and limit concurrent lookups. Share
pending lookups and reuse validated manifests by torrent identity within the
authorized connection/source scope. Cache raw manifest facts separately from
work-specific episode interpretations. Use a bounded wait and backoff for unavailable
metadata. On a timeout, continue evaluating other candidates. If all candidates
fail, subscriptions retry on schedule and one-off requests report the reason in
Activity. Ordinary discovery never creates a Catalog Review item.

### Mapping examples for implementation and tests

| Manifest evidence | Accepted interpretation |
| --- | --- |
| `S01E03.mkv`, `S01E03.zh.ass`, `NCOP.mkv` | Episode 3 and its external subtitle. The opening adds no episode. |
| Two encodes of `S01E03` | One episode. Select one version under the profile and bind subtitles to the selected version when identifiable. |
| `Season 1/01.mkv` through `12.mkv` for a confirmed 12-episode season | Complete regular season if the release, directory and file evidence identify that work and numbering. |
| Files 1–5 and 7–12, plus an extra video | Coverage excludes 6 even if the publication says “complete” and contains twelve videos. |
| One video explicitly covering E03–E04 | Both episodes can share a verified source when both are requested. A request for episode 3 alone falls through to a candidate that can deliver only 3. |
| Mixed seasons with repeated `01.mkv`, continuous episode numbers, or `Disc 1/00001.m2ts` | Accept only independently established mappings to the target season. Counts, disc segment order and guessed offsets supply no episode claims. |

## Reservation, submission and recovery

Downloads needs three separately addressable records. Follow the existing
[database design](database-design.md) when introducing tables and migrations.

| Record | Identity and responsibility |
| --- | --- |
| Request and episode claim | Retain the originating one-off command or subscription authorization. Enforce at most one live acquisition claim for a provider-scoped work and regular episode across both entry points. A one-off discovery claim can later bind to the selected transfer. Historical attempts must permit a new live claim after confirmed failure. |
| Managed transfer | One durable remote owner and canonical torrent identity within a downloader connection. Retain the validated destination, request provenance, desired file selection and last observed selection. Multiple episode claims can reference this transfer. |
| Transfer file and targets | Bind each selected file to the manifest and its role. Persist the accepted episode set, metadata snapshot, observed local source version and import outcome. A sidecar belongs to selected video files. A multi-episode video can provide more than one target. |

Reserve the chosen episodes and persist the desired selection in one database
transaction. A concurrent request for the same episode joins the existing work.
If another request claims part of a proposed pack, recompute the selectable
remainder. Persist a revision before the remote operation so retries and restart
can reconcile the same intent.

For a new transfer, apply the intended file priorities at add time and check the
observed selection. For a compatible Anishelf-owned transfer, add newly authorized
files to its existing selection and serialize changes per transfer. For example,
after E03 from a pack finishes, requesting E04 reuses the transfer and adds E04.
Retain its ownership mapping while the remote task remains reusable, even after
individual requests complete. Preserve files already selected by earlier requests.
Recheck ownership, destination and observed priorities before changing a transfer.
Respect external tasks and conflicting user edits in qBittorrent. Try another
candidate if the desired files cannot be selected safely.

Explicit episode requests use a verified pack when no eligible ordinary release
can serve the episode. Select one confidently mapped video and its matching
sidecars using qBittorrent's stable file indices. Stage the metadata before
adding the torrent with its initial priorities. Extensions enable only new
indices after comparing the current priorities with the last verified selection.

After an ambiguous add or priority update, keep the claims and read back the
remote task, ownership and selection before attempting another change. A timeout
does not establish failure. A confirmed rejection, removal or permanent inability
to deliver releases only the affected claims for replanning under current
authorization. A repairable local import failure retries import from the completed
file. Subscription pause or removal stops new adds and expansions under that grant.
Already submitted work follows the existing transfer and ingestion lifecycle.

## Verified import and operator feedback

Start with the existing stable transfer completion check for the selected files.
Take a consistent snapshot of the selection. For each planned video, verify task
ownership, destination containment, expected path and size, completion, and local
source version before committing its accepted targets to Catalog. Validate
selected sidecars against the manifest as well. Track progress per file and make
association retries idempotent. Recheck the selection revision if the transfer is
expanded during import. Eleven successfully imported episodes remain available
if the twelfth fails or the process restarts.

For a manifest-backed request, import can begin when its selected video and
sidecars are complete and visible in the validated destination. Other files may
still be downloading. Persist file progress and verified subtitle versions. The
Catalog commit rechecks the current selection and uses the same acquisition
receipt if an earlier attempt committed before Downloads recorded the outcome.

Keep Catalog Review for local association conflicts, such as a protected manual
mapping to a different episode. Let other files import and let the subscription
continue. Retain enough provenance to retry the unresolved file and suppress a
second download while that file can still satisfy the claim. After an explicit
rejection or reassignment, recompute which requested episodes still need a source.
Record the declined file and episode together so subsequent requests can try
another file or release.

Use existing Activity and Diagnostics views to show requested episodes, selected
files or coverage, transfer reuse, outstanding imports and actionable failure reasons.
Log metadata lookup outcomes, coverage and profile decisions, claim conflicts,
selection changes, reconciliation and per-file import failures. Include stable
request/transfer identifiers and reason codes. Keep source credentials, magnet
links and raw provider responses out of logs.

## Implementation order and acceptance

Each phase builds on the previous row. Enable automatic pack submissions only
after reservation, selective transfer and multi-file import work end to end.

| Phase | Deliverable | Acceptance before advancing |
| --- | --- | --- |
| 1. Correct single-episode discovery | Split “worth inspecting” from single-episode eligibility in subscription, one-off and submission checks. Exclude suspected packs from the existing single-video submission path. | Add the real Frieren S2 regression, explicit ranges, a valid single-episode finale and a fallback candidate. The pack cannot be submitted as episode 3. An eligible ordinary single can still win. |
| 2. Inspect and map manifests | Add the normalized metadata contract, qBittorrent capability checks and bounded lookup/cache. Reuse Anime identification for per-file mapping. Exercise the file-based decision before permitting pack transfers. | The same fixture through torrent bytes and a magnet yields equivalent coverage and sizes. Verify partial coverage, mixed seasons, duplicates, sidecars, unsafe paths, stale identities, unsupported clients and timeouts. |
| 3. Persist claims, transfers and files | Migrate current single-episode intents to one claim per accepted episode. Keep command IDs, owner markers, snapshot references, source identities, history and uncertain submissions. Bind legacy file records only where verified evidence exists. Route single-episode requests through the new storage. | Upgrade fixtures include discovering, submitted, unknown, available and pending Review intents. Restart and concurrent one-off/subscription requests produce one active claim. No migration resubmits a task or infers pack coverage. |
| 4. Submit and extend exact file selections | Implement add with initial priorities, readback, union with an owned transfer and restart reconciliation. Exercise with controlled requests before enabling automatic pack selection. | Request E03 then E04 from one torrent, including after E03 finished. Only the requested files and matching sidecars become selected. Simulate a lost response, competing writers, a foreign task, changed destination and changed authorization. |
| 5. Import and recover per file | Replace the single-video layout gate for manifest-backed plans. Integrate per-file verification, Catalog receipts, local Review and Activity outcomes. | Verify one pack with a broken file, duplicate import notifications, a protected manual decision and restart mid-import. Other valid files enter the library once. Retrying the broken import leaves prior successes intact. |
| 6. Enable coverage-based planning | Use verified coverage for source binding, pack preference, subset selection and fallback. Connect diagnostics, update the operator guides and record delivery against S14 after acceptance. | Run the scenario below against a supported qBittorrent instance. Cover airing, finished, partial-library, unknown-total, explicit starting episode, pinned source, profile waits and one-off requests. Run affected server/client tests, migration and architecture checks, and the repository Biome check. |

### End-to-end acceptance scenario

1. Start with an empty library, a finished 12-episode work and a pack with one video per episode and matching external subtitles. Request only E03. Verify qBittorrent has one managed task and only E03 and its subtitle are selected.
2. After E03 imports, subscribe from episode 1. Verify the planner reuses the task and enables the eleven missing episodes and their subtitles. A simultaneous request for E04 resolves to the same claim.
3. Restart Anishelf after qBittorrent accepts a selection change but before the local acknowledgement. Verify readback converges to the intended selection and no second transfer appears.
4. Cause one file to fail import. Verify the other eleven episodes are locally available, the subscription remains incomplete, and the failure is visible in Activity. Repair and retry that file. All twelve episodes must then be available, E03 must retain its original import, and the subscription must complete.


The scenario passed on qBittorrent 5.2.3 using locally generated torrent data and
a simulated local file failure. The test uses the real Web API for metadata preview,
file priorities, task ownership and readback. It checks episode availability in
the Catalog before and after import recovery.

To rerun the scenario, configure an isolated qBittorrent 5.2.0 or later instance
with its Web API enabled and a separate incomplete directory. The qBittorrent
process must be able to read and write the backend test's temporary directory.
Set `ANISHELF_TEST_QBITTORRENT_URL`, `ANISHELF_TEST_QBITTORRENT_USERNAME` and
`ANISHELF_TEST_QBITTORRENT_PASSWORD` before running the test.

```sh
npm run test --workspace @anishelf/backend -- test/modules/acquisition/downloads/season-pack-live.test.ts
```
