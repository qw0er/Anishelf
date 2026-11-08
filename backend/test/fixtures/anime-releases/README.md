# Subscription release-title corpus

This small offline library evaluates production `AnimeReleaseAssessment` and
`releaseAttributes`, using exact publication titles and independently reviewed
declarations. It does not fetch RSS/Jackett, choose sources, rank downloads, inspect
media or submit a torrent. Production algorithms are unchanged.

```sh
node --import tsx scripts/manual-tests/anime-release-corpus.mts summary
node --import tsx scripts/manual-tests/anime-release-corpus.mts test > /tmp/anishelf-release-report.json
npm run test --workspace @anishelf/backend -- test/modules/anime/identification/release-corpus.test.ts
```

## Inputs and provenance

Version `2026-11-07.1` reuses all 38 real publication-title records from the
identification corpus `2026-10-11.2`: 33 Nyaa and five DMHY titles. Exact title
strings, source IDs and public URLs are copied unchanged. This is reuse of existing
frozen provenance, not a fresh network capture. Eight constructed boundaries from
existing RSS/parser and acquisition-profile tests are explicitly marked synthetic.
The loader reads only this directory's JSON; normal tests never access websites.

Known subscription targets are frozen work projections, supplied as inputs rather
than selected from a candidate pool. Eight authentic titles lack a verified target
in the existing work projections; these receive attribute checks only, without
inventing an identity or treating unknown identity as a rejection label.

The real sample is dominated by batches, movies and ancillary publications. All
30 known-target authentic cases are labelled ineligible for the current
single-regular-episode subscription policy. Positive single-episode eligibility
and mapped-episode labels come from three synthetic cases, not a claimed real
positive recall benchmark. Add sourced real singles when concrete regressions
require them; this initial library does not claim complete coverage.

## Independent expected values

Labels were written from publication text and subscription scope, not production
predictions. Local-library `match/review/ignore` decisions were not copied into
subscription eligibility: a valid movie association is not a valid single TV
episode download. For ineligible releases a diagnostic proposed episode may still
exist, so it is not automatically labelled null.

Attribute arrays compare as unordered sets, with Unicode compatibility, surrounding
whitespace and case normalization. Omitted fields are unreviewed; an empty array
asserts absence of an explicit supported declaration. Revision is a scalar.

- Subtitle language follows explicit subtitle declarations, including French and
  Spanish cases even though the current implementation may not recognize them.
  `Multi-Subs` alone supplies no language. Audio language never implies subtitles.
- Subtitle format means delivery mode (hard/soft/external), not ASS/SRT codec.
  `ASSx3` alone does not prove internal versus external delivery.
- Resolution is declared height: `1920x804` labels 804 rather than guessing 1080.
- Codec, source and publisher/group are literal declarations, including suffix
  publisher names. Unknown DCPrip classification and nonstandard `_rev3` revision
  are not invented from current parser behavior.
- Joint-group boundaries retain the combined name and component names according
  to the existing release attribute contract.

Required metadata ports throw if accidentally used. `assessReleaseTitle` uses
release-title extraction, with no local ancestor-directory context. Unknown-target
attribute cases invoke the same production extraction/attribute functions directly.

## Results and execution

Reports separate authentic/synthetic groups and independent denominators for
eligibility, episode and each attribute. Attributes remain scored even when the
release is ineligible. Runtime failures stay in labelled denominators. The strict
command exits 1 on a mismatch or error, 2 for invalid arguments. JSON uses stdout;
structured progress/error logs use stderr.

The initial unchanged implementation passed 38/46 cases: 30/38 authentic cases and
8/8 constructed cases, with no runtime errors. Differences include explicit
subtitle languages, publisher suffixes, BDMV/MPEG2 recognition, and a Batch title
being accepted as episode 3. The latter is an unexpected eligible assessment, not
evidence that this batch contains only episode 3. Do not replace labels with these
predictions to obtain a passing result.

Normal CI checks fixture integrity, denominator/error handling, synthetic
boundaries and actual attribute evaluation. The complete strict report remains
opt-in while these mismatches are unresolved. These cases do not measure actual
media codecs/subtitles, live resource availability or downloader correctness.

Preserve source spelling and public provenance, keep authored cases separate,
review new fields independently, and increment the fixture version for changes.
Do not silently reinterpret subscription scope to match the current output.
