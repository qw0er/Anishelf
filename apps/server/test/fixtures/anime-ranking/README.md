# Anime work identification and candidate ranking corpus

This independent offline benchmark calls the production `rankCandidates` function
with frozen extraction evidence and complete fixed candidate pools. It evaluates
which work ranks first and where the independently labelled work appears. It does
not run filename/directory extraction, provider search, IdentificationApplication,
episode mapping, directory numbering conversions or Catalog admission. Runtime
ranking and recognition/admission policies are unchanged.

## Commands

From the repository root:

```sh
node --import tsx scripts/manual-tests/anime-ranking-corpus.mts summary
node --import tsx scripts/manual-tests/anime-ranking-corpus.mts test > /tmp/anishelf-ranking-report.json
npm run test --workspace @anishelf/backend -- test/modules/anime/identification/ranking-corpus.test.ts
```

`test` is the default command. Reports use stdout; structured lifecycle and error
logs use stderr. The strict benchmark exits with 1 for any labelled Top-1 miss or
runtime error, 2 for invalid arguments, and 0 otherwise. A Top-5 hit alone does not
make a case pass. Unknown labels are not counted as successes. Known ranking
misses are reported, not approved as a passing baseline.

Normal Vitest/CI tests validate every fixture's structure and cross-references,
smoke-test production ranking for each pool, and exercise metric denominators,
label isolation, ties, mutation protection and error handling. The complete strict
benchmark is opt-in and is not included in `npm test` or `npm run check`.

## Standalone data

Version `2026-11-07.1` extracts the following from the existing identification data:

| Group | Inputs | Independently labelled work IDs | Candidate pool |
| --- | ---: | ---: | --- |
| Base | 369 | 278 | All 20 frozen AniList projections, for every case |
| User reports | 10 | 10 | Both screenshot-derived candidates for the reported scenario |

`corpus.json` contains versions, extraction provenance, complete candidate pools
and a case-file manifest. `cases-base-1.json` through `cases-base-3.json` and
`cases-reported.json` contain paths, frozen extraction evidence, source references,
tags, rationales and work-identity labels. The base files are storage shards, not
development/holdout splits. Each stays below Biome's file-size limit.

The loader reads only this fixture directory. Original provider snapshots and the
other corpora are not runtime dependencies. `snapshotId` and original corpus
versions are provenance identifiers, not files to load. Each pool is fixed before
evaluation and supplied in full without answer-based filtering or alias injection.
Reported work IDs remain fixture-local, with incomplete provider provenance.

The 38 release-title inputs and 50 repeated/relocated application-scenario
resources remain outside this benchmark. Neither their parsing-context labels nor
additional independent work-identity labels are invented here. The existing
`node --import tsx scripts/manual-tests/anime-identification-corpus.mts test` retains the complete parser-to-admission workflow.

## Input evidence and labels

The frozen evidence was captured from `AnitomyIdentificationParser` version
`anitomy-ng@1.0.10:anitomy-title-sources-v6`. Base paths were parsed independently;
reported sibling files were parsed together, matching the original evaluation's
grouping. No expected work ID was supplied to extraction.

**These inputs are parser snapshots, not independently verified parsing truth.**
Freezing them isolates ranking changes from future extraction changes, but does
not remove inherited extraction errors. A work-ranking miss can still reflect
bad frozen evidence. A future benchmark with reviewed title/season/part inputs
must label that provenance separately, without silently replacing this snapshot.
The ranking algorithm's existing title normalization and ordinal parsing helpers
still run: they are part of work matching, not a new extraction pass over files.

Positive work IDs come from the original reviewed `match` labels or user reports,
not the ranker's output. The remaining 91 base cases had `review`, `ignore` or
`unidentified` decisions with no labelled work. Their `expected.workId` is null;
they are diagnostic-only, not negative work-identification labels. Their original
decisions are retained as provenance and do not impose a rejection requirement.
No provider episode sorts or target episode mappings are evaluated.

## Metrics and scope

The JSON report includes overall, base/reported and per-tag denominators, Top-1,
Top-5, reciprocal rank, missing targets, score ties and runtime errors. Rows retain
candidate IDs, scores, reasons, identity conflicts, unresolved evidence and ranking
assumptions. Scores are not probabilities.

The production ranker returns at most ten candidates. Mean reciprocal rank is
computed over that returned list; an absent target or runtime error contributes
zero while remaining in the labelled denominator. Null identity labels are
excluded from accuracy denominators. A runtime error still fails an unlabelled
case. Unknown/duplicate output references and non-finite scores are errors.

Top-1 uses the actual deterministic output order, including tie-breaking. Equal
top scores are reported separately and do not establish a confident identity.
A correctly ranked work with identity conflicts is still only a ranking hit.
Neither a ranking hit nor a high score grants automatic work confirmation or
episode admission. The Catalog recognition threshold/margin and admission policy
remain covered by their existing tests and the complete identification benchmark.

Fixed pools cannot measure live search recall, pagination, network freshness,
false-positive confirmation rate or production accuracy. The corpus is small and
curated, repeats works/episodes, and lacks an independent held-out work split.

## Initial observation

The unchanged ranker produced no runtime errors:

| Group | Labelled | Top-1 | Top-5 | Top-score ties |
| --- | ---: | ---: | ---: | ---: |
| Base | 278 | 250 | 278 | 30 |
| User reports | 10 | 10 | 10 | 0 |
| Combined | 288 | 260 | 288 | 30 |

There were 28 Top-1 misses and 91 unscored cases. Combined mean reciprocal rank
was approximately 0.9514. These are observations for the frozen inputs and pools,
not acceptance thresholds or a claim that all cases pass.

## Maintenance

Version evidence, candidates and independently reviewed labels together. Preserve
source URLs, primary-title/alias roles and unknown fields. Never select a pool
using the expected answer, manufacture a series ordinal from relation order, or
copy ranking predictions into labels. Adding explicit rejection labels requires
separate reviewed identity evidence; source `review`/`ignore` decisions alone are
insufficient. Parser snapshot refreshes must be explicit reviewed fixture changes
and must not run during `test` or `summary`. Keep extraction snapshots labelled as
such even when a labelled work is known.
