# Anime Identification Corpus

An offline, versioned resource corpus for evaluating filename parsing, work
matching and episode associations against the implemented anime-library workflow.
Version `2026-10-11.2` was collected and reviewed on **2026-10-11**.

## Use the corpus

From the repository root:

```sh
npm run anime:corpus -- summary
npm run anime:corpus -- generate /tmp/anishelf-anime-corpus
npm run test --workspace @anishelf/backend -- test/anime-corpus.test.ts
```

The destination's parent directory must already exist. Generation creates a new
root exclusively and refuses an existing directory, including an existing symlink.
It never merges into, clears or overwrites a collection. For a persistent local
copy, use a new `.anime-corpus.local` directory in the repository; `*.local` is
already ignored by Git. Point a separate test instance's resource root at the
output to browse it. Do not change the main instance's root just to run tests.

The generated library has 419 placeholder files: 369 individual file cases and
50 files in fifteen curated scenario layouts. Thirty-eight release-title cases are text-only
inputs and are not materialized. `fixture-manifest.json` maps generated paths to
case IDs and marks the library `playable: false`.

Three added filename inputs use TS/M2TS extensions. They are retained for
identification evaluation, but the current scanner whitelist skips them; the
scanner regression checks that only the supported 416 generated video paths
are discovered. Subtitle-only and other ancillary inventory records remain
in the Nyaa capture without being materialized as fake videos.

**Placeholders are not videos.** They validate filesystem discovery and naming,
not FFprobe, subtitles or playback. No anime media was downloaded. Playback
acceptance needs separate original synthetic video fixtures.

## Production matching audit

Run the actual Identification application, candidate ranking, episode proposal and
Catalog automatic-admission predicate against the frozen AniList projections:

```sh
npm run --silent anime:corpus -- match > /tmp/anishelf-matching-report.json
```

The audit covers all 369 filename cases and 50 directory-scenario resources (419
inputs). Publication labels are excluded because they are not playable files.
Filename evaluation includes unsupported scanner extensions; this does not imply
that production scans discover those files. Scenarios run as sibling batches;
standalone cases run independently. All 20 works compete for every metadata query,
including related seasons, using only AniList titles/synonyms, format, year and
count. No expected answer filters candidates, no Bangumi aliases are injected,
and no series ordinal is invented. This measures ranking and admission with a
fixed candidate universe, not AniList search recall, network behavior, or database
confirmation. The existing Catalog tests cover persistence separately.

The report includes ranked candidates, scores, conflicts, mapping targets,
admission blockers, missed matches and unexpected admissions. Bangumi continuous
sort values are not converted into season-local numbering. Episode accuracy is
only compared for unchanged positive integer release numbers or whole movies;
other mappings are explicitly `not-comparable`. Corpus `match` means resolvable,
not necessarily safe for automatic admission; a missed admission is an audit gap,
not automatically a defect.

This audit runs only when explicitly invoked through `anime:corpus -- match`;
`npm test` does not run it. There is no frozen outcome baseline: inspect the report
against the original corpus expectations when assessing a matcher change.
The first audit observed 186 admissions, 166 consistent with the corpus
work/decision expectation, 20 unexpected admissions and 140 unresolved expected
matches. These counts describe that run, not approved outcomes or passing
criteria. Unexpected admissions included ancillary files and conflicting-season
evidence and need investigation.

## Contents and provenance

| Item | Count | Meaning |
| --- | ---: | --- |
| Work records | 20 | Separate seasons, parts, spin-offs and movies count separately |
| Authentic file cases | 353 | 118 Mikan paths and 235 Nyaa paths decoded from torrent metadata |
| Authentic publication titles | 38 | 5 DMHY titles and 33 Nyaa titles, retained as title inputs |
| Synthetic boundary cases | 16 | Explicitly authored filenames using verified work titles |
| Total identification cases | 407 | Each has an ID, expectations, tags, requirements and rationale |
| Directory scenarios | 15 | Curated layouts and pending application-level acceptance assertions |
| Provider snapshots | 20 | One projected Bangumi/AniList pair per work |

- [corpus.json](corpus.json) owns sources, cases, expected results and scenarios.
- [Catalog](catalog.md) links each work to both providers and its offline snapshot.
- `provider-snapshots/*.json` preserve selected public title/alias, language,
  format, date, count, episode and related-work fields. Bangumi and AniList remain
  separate within each snapshot. A curated cross-provider pairing is test data,
  not a production cross-provider mapping capability.
- `sources[].url` points to the publication detail page. Authentic file sources
  also include the torrent metadata URL and SHA-256 of the retrieved bytes.
  No torrent files, tracker lists, magnets, media or private account data are
  committed. Only metadata was read; no BT client or peer connection was used.
- Provider snapshots are **field projections**, not raw API responses, captured
  search rankings or API-schema mocks. The Bangumi subject response hash refers
  to the original response, not the projected JSON. Long descriptions, reviews,
  comments, ratings and images are not copied; cover URLs remain metadata only.

The source sites were [Mikan](https://mikanani.me/),
[DMHY](https://dmhy.org/) and user-supplied Nyaa RSS/torrent results.
Public metadata came from [Bangumi](https://bangumi.tv/) and
[AniList](https://anilist.co/), using their anonymous public APIs. Nyaa input was
provided locally: no live Nyaa request was made while importing these samples.
The [Nyaa supplement](nyaa/README.md) documents the 60-search batch, selection,
integrity checks, unresolved mappings and complete local candidate archive.
Do not attribute Mikan filenames to Nyaa merely because a torrent contains a
Nyaa tracker.

Mikan search results and category pages are discovery evidence, not an identity
oracle. Some captured publications span seasons or contain another work. Those
contradictions are retained instead of silently rewritten.

## Expectation contract

The corpus is a test-only interface, independent of future application HTTP or
persistence schemas. A parser/matcher adapter translates its output to this shape.

| Field | Contract |
| --- | --- |
| `input.kind: file` | `relativePath` is the complete authentic or explicitly synthetic path; filenames and ancestor directories are evidence |
| `input.kind: release-title` | `text` is a publication label; never assume it is a playable filename or one multi-episode file |
| `expected.decision` | `match`: resolvable work and episode association; `review`: insufficient/conflicting evidence; `unidentified`: no usable identity; `ignore`: ancillary asset excluded from regular episode identification |
| `expected.workId` | Curated local work key, separate from provider IDs; null when no association should be established |
| `expected.episodes` | Ordered **Bangumi episode `sort` values** within that work's frozen snapshot; null when unresolved or ignored |
| `expected.parsed.rawEpisodes` | Numbers expressed by the filename, before any offset; decimal values are retained |
| Other parsed fields | Optional assertions for season, release revision and content type; omitted fields are not scored |
| `rationale` | Why the identity/mapping is resolvable or requires review; offsets must be explicit |

`match` describes the corpus answer, **not a confidence threshold or permission
to auto-confirm in the application**. The application applies its own conservative admission policy. Related candidates may be shown for `review` cases, but no
confirmed work/episode association should be created from conflicting evidence.
`ignore` applies only to identification: the original remains discoverable.

Provider `sort` values are not necessarily season-local episode ordinals. For
example, Frieren S2 local episode 10 maps to sort 38; Apothecary S2 local episode
13 maps to sort 37. Raw values remain 10 and 13. Episode 0 is regular in the
captured Mushoku S2 record, whereas S00 release numbering alone does not identify
a special. Bangumi's regular and total episode counts differ when extras exist;
use explicit episode types, not `totalEpisodeCount`, to validate regular mappings.
Movie sort 1 identifies the single movie without claiming a parsed episode token.

The loader validates every positive mapping against a captured type-0 episode.
Snapshots retain complete episode listings for these works. Native title, format
and start year establish the curated provider pair; date differences of one day
are preserved. Season/part boundaries and unknown special identities require
manual review when the captured evidence does not resolve them.

## Evaluate a parser or matcher

Write one result per case to JSON. The version fields identify the actual parser
and matcher dependency/build versions, not the fixture generator. For example:

```json
{
  "corpusVersion": "2026-10-11.2",
  "parserVersion": "your-parser-version",
  "matcherVersion": "your-matcher-version",
  "results": [
    {
      "id": "directory-only-cn",
      "decision": "match",
      "workId": "frieren",
      "episodes": [1],
      "parsed": { "rawEpisodes": [1] },
      "candidateWorkIds": ["frieren", "frieren-2"]
    }
  ]
}
```

```sh
npm run --silent anime:corpus -- evaluate /tmp/predictions.json > /tmp/anime-report.json
```

The command exits with status 1 if any case fails or is missing. The example above
is deliberately incomplete and cannot pass the corpus. A stale corpus version,
duplicate result IDs, unknown result IDs or invalid schema is rejected.

The report records versions, snapshot date, per-case expected/actual values,
field failures, unsafe confirmations and per-tag totals. Decision, work identity,
episode mapping and parsed-field accuracy have separate denominators. Candidate
Top-1/Top-5 counts are evaluated only when `candidateWorkIds` is supplied; omitted
candidate output is reported separately, never counted as a successful search.
An incorrect work or episode confirmation, including forcing a review case into
a match, counts as unsafe. Missing results fail instead of reducing the denominator.

No parser/provider was selected by building this corpus. There is currently no
real parser accuracy baseline. Evaluator tests use intentionally incorrect and
missing predictions to verify reporting; they do not claim identification success.

## Directory scenarios and acceptance status

The generator creates isolated `cases/case-<ordinal>/...` paths and
`scenarios/<scenario-id>/...` layouts. Ordinal wrappers are neutral containers and do not disclose the expected work.
Adapters must use the case input path rather than infer answers from wrappers. Scenario placement is authored test context; preserve the
individual provenance when a file is placed in a different curated directory.

The fifteen recipes cover mixed works, directory-only titles, multiple versions,
season/part boundaries, specials/credits, a multi-episode file, unresolved files,
manual corrections, source lifecycle and provider outages. Their `acceptance`
arrays state application behaviors to verify after implementation. The five added Nyaa recipes cover local/continuous numbering, mixed TV/movie
batches, nested credits, movie variants/trailers and contradictory season paths.
Acceptance assertions are not executed automatically by directory generation.

Current automated checks validate the corpus and snapshots, actual scanner
traversal of generated paths under the existing video-extension policy, repeated scans, unchanged placeholder bytes,
path/reference constraints, captured Nyaa path/title/URL/hash agreement, refusal to overwrite existing roots and evaluator
failure accounting. **CAT01–CAT08 remain pending** for the anime-library feature,
including confirmation, rescan/refresh/restart persistence, provider failure,
source replacement and version playback. Existing scanning passing is not proof
of these workflows.

## Maintenance

For collecting additional RSS titles and torrent file inventories, use the
[Python metadata collector](../../../../scripts/nyaa/README.md). Its output
is raw provenance for review, not an automatically approved expected answer.

1. Add exact source URLs and record whether the input is a file path, publication
   title or synthetic variation. Keep the original spelling and directory context.
2. Verify work identity against provider native titles, format, dates, episodes
   and relations. Preserve conflicting fields; do not automatically accept the
   first search result or copy predictions into expected answers.
3. Add selected public metadata fields with collection date and stable IDs.
   Keep unknowns explicit. Metadata refresh is a reviewed fixture change, not
   part of an offline test run.
4. Record raw parsed numbers separately from confirmed provider sorts. Explain
   offsets and mark unsupported special/part mappings for review.
5. Increment `version` when inputs, snapshots or answers change. Preserve case IDs
   for unchanged samples. Run the corpus test, Biome, lint and typecheck.

This is a curated regression corpus with repeated versions of some episodes,
not a statistically representative random sample. It is also the initial
selection/evaluation set; future reported generalization accuracy needs a
separate held-out set of works and release groups.
