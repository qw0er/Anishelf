# Filename and directory parsing corpus

This standalone offline benchmark runs the production
`AnitomyIdentificationParser` directly, plus the existing `releaseAttributes`
revision extractor. Production parsing algorithms are unchanged. No work matching,
provider search, episode conversion, Catalog admission or media inspection runs.

## Commands

From the repository root:

```sh
node --import tsx scripts/manual-tests/anime-parsing-corpus.mts summary
node --import tsx scripts/manual-tests/anime-parsing-corpus.mts test > /tmp/anishelf-parsing-report.json
npm run test --workspace @anishelf/backend -- test/modules/anime/identification/parsing-corpus.test.ts test/modules/anime/identification/parsing-labels.test.ts
```

`test` is the default command. It writes JSON to stdout and structured logs to
stderr. Any labelled mismatch or runtime error returns status 1; invalid arguments
return 2. Unknown labels are not counted as passing. `summary` reports field
coverage, including nonempty versus explicitly empty numeric labels, without
running the parser or fetching sources.

Normal Vitest/CI tests validate fixture integrity, field-scoring contracts,
representative real-source positives, context isolation and failure accounting.
The complete strict benchmark is opt-in: its known differences are not accepted
as passing outcomes or silently replaced by parser predictions.

## Versioned inputs and independent review

Version `2026-11-07.2`, schema 2, retains all 379 paths from version
`2026-11-07.1` and adds 30 paths:

| Group | Paths | Source and label treatment |
| --- | ---: | --- |
| Legacy | 311 | Existing inherited annotations, still only partially reviewed |
| Reviewed existing | 68 | Existing exact paths with newly reviewed title/source and other lexical labels; previous labels remain in `inheritedExpected` |
| Web records | 18 | Newly fetched public Anime Tosho file records; exact `h2#title` paths, source URLs, retrieval timestamps and response SHA-256 fingerprints |
| Synthetic context | 12 | Explicitly authored directory/numbering variants motivated by captured examples; `derivedFrom` links their source cases |
| Total | 409 | Five paths remain entirely unlabelled |

The original extraction versions remain historical provenance: identification
`2026-10-11.2` and user reports `2026-11-02.1`. Other stage snapshots and integration
answers were not rewritten. The loader reads only this directory's `corpus.json`.

New expected fields were authored from literal filename/directory text, not from
parser output or metadata work titles. Required title clauses preserve intrinsic
numbers such as `Steins;Gate 0` and `86 - Eighty Six`; explicit Season/Part markers
are separately labelled. Paths without literal work names do not acquire names
from a webpage's series breadcrumb or embedded media metadata.

Reviewed entries record the review date, method and reasoning. Replacing an old
annotation set archives it in `inheritedExpected`; unreviewed legacy fields are
not automatically promoted into reviewed assertions. For example, a conflicting
filename/parent season now expects both pieces of evidence rather than silently
choosing a season from an inherited scalar label.

## Network collection and provenance

See the [source catalog](sources.md) for all 18 fetched records. Only public HTML
filename metadata was requested. No torrent payload, tracker, peer, subtitle,
attachment, screenshot or video was downloaded. The source record's exact
observed path is preserved; a missing release-root directory is never invented.

`responseSha256` fingerprints the original fetched HTML bytes. Only selected
factual fields are retained, so that raw-response fingerprint cannot be recomputed
from the reduced JSON projection. It is distinct from a media file hash and is
not evidence that the media contents were inspected. These source pages are
metadata observations, not a canonical episode-identity oracle.

All tests and normal commands are offline. Collection and source/label refreshes
are explicit maintenance actions, never part of CI. Web inputs must match their
captured source path and URL; forged paths, missing reviews, duplicate source IDs
and dangling synthetic-source references are rejected.

## Parsing label contract

Only present fields are scored. An empty array means a reviewed absence; an
omitted field means unknown or not reviewed.

| Field | Contract |
| --- | --- |
| `titles.required` | Every clause must match a title surface. A clause is a string or an explicitly reviewed list of acceptable surface variants |
| `titles.forbidden` | None of these complete surfaces may appear as title candidates; used for group names, container directories, technical tags and episode-name residue |
| `titles.exact` | Additionally disallow any title surface outside the listed required variants; an empty exact requirement asserts no work title |
| `titleSources` | Required/forbidden title clauses bound to `basename` or `ancestor` and distance. Immediate parent has distance 0. A correct title at the wrong source is still wrong |
| `rawEpisodes` | Ordered original filename number tokens, represented numerically for comparison; zero padding is ignored, decimals remain, and unknown tokens remain visible |
| `selectedEpisodes` | Filename-encoded number choice before any work/provider mapping; no offset or range expansion |
| `numbering` | `single`, `range`, `ambiguous` or `unknown`; independent from raw-number accuracy |
| `seasons`, `parts`, `years` | All explicit path evidence, compared as sorted numeric arrays; conflicting values remain visible |
| `contentKind` | Coarse regular/special/ancillary/unknown classification; historical credit/trailer annotations share `ancillary` |
| `revision` | Existing production declared-revision extraction and its default revision 1 |
| `unscored.contentType: movie` | Fourteen original movie labels remain explicit but unscored; extraction has no movie content-kind category |

Title comparison normalizes Unicode compatibility forms and whitespace only.
There is no fuzzy comparison, translation, alias injection, general punctuation
stripping or numeric-title deletion. Allowed variants are explicit per-case
clauses: for example, retaining `Part 2` inside a title and extracting it as a
separate field are compatible representations. Such a clause does not waive the
independent Part assertion or allow dropping intrinsic title digits.

Title requirements are partial constraints, not a claim that every returned title
was exhaustively labelled. Reports therefore use clause counts and violations,
not an invented title precision/recall estimate. Full extraction evidence remains
available for diagnosing unlabelled fields and permitted extra candidates.

Standalone cases run independently. Explicit batches are additionally separated
by immediate parent directory before `parseTogether`, matching production context
boundaries. Paths in different directories cannot lend each other sibling title
hints merely because a test batch contains both.

## Coverage and observed results

The unchanged parser produced these results for version `2026-11-07.2`:

| Field | Labelled paths | Correct |
| --- | ---: | ---: |
| Raw numbers | 401 | 357 |
| Selected numbers | 95 | 94 |
| Numbering classification | 96 | 95 |
| Seasons | 265 | 217 |
| Part/Cour | 98 | 98 |
| Years | 98 | 96 |
| Title constraints | 98 | 90 |
| Title source constraints | 87 | 85 |
| Coarse content kind | 271 | 265 |
| Revision | 90 | 90 |

Part coverage includes eight nonempty and 90 explicitly empty labels. Year
coverage includes 14 nonempty and 84 empty labels; these are not 98 independent
positive Part/year examples. Title checks contain 102 required clauses (100 met)
and 105 forbidden clauses (seven violated). Source checks contain 95 required
clauses (93 met) and five forbidden clauses (none violated).

Across 404 scored paths there were 303 passing paths, 101 mismatches, five
unscored paths and no runtime errors. The 101 mismatches include 92 legacy cases
with inherited contracts and nine newly reviewed cases: four reviewed-existing,
two web records and three synthetic contexts. These counts are observations,
not acceptance thresholds or a claim that every mismatch is an algorithm defect.

New diagnostics include loss of the intrinsic `0` in a directory title, generic
containers such as `Movies`/`NC`/`Part 2` being retained as work titles, missing
standalone year-directory evidence, a descending range leaking into a title, and
ambiguous numbering being reduced to one token. No production parsing rule was
changed to make these tests pass.

## Remaining limits and maintenance

There are still 311 legacy paths without the expanded title/source review.
Ancillary subtype accuracy (credit versus trailer) and movie identity are not
measured by coarse content kind. The source pages cannot establish actual media
contents, and partial lexical labels cannot establish correct work identity or
canonical episode mappings.

The sample is curated, repeats some works/releases, and includes authored
contexts. It is not a statistically representative or independently held-out
accuracy estimate. Keep numeric-title, bilingual, punctuation, negative-container,
ordinal, year and numbering-system cases when expanding coverage.

Preserve exact source inputs, factual collection metadata and review rationale.
Mark every invented directory or boundary perturbation as synthetic. Increment
the corpus version for path/label changes. Record acceptable variants explicitly,
without weakening comparisons globally to fit current predictions. Never generate
expected titles or number choices from the parser under evaluation.
