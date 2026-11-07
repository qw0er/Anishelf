# Known-work episode numbering and directory conversion corpus

This independent offline benchmark runs the existing production `proposeMapping`
and `applyNumberingContext` functions. Work identity is supplied as stage input;
the evaluator does not search for or select an animation work, parse filenames,
consult provider APIs, run IdentificationApplication or apply Catalog admission.
Production algorithms and the existing complete identification audit are unchanged.

## Commands

From the repository root:

```sh
npm run anime:numbering -- summary
npm run --silent anime:numbering -- test > /tmp/anishelf-numbering-report.json
npm run test --workspace @anishelf/backend -- test/modules/anime/identification/numbering-corpus.test.ts
```

`test` is the default command. JSON reports use stdout; structured lifecycle/error
logs use stderr. A labelled mismatch or runtime error returns exit status 1;
invalid command arguments return 2. Unlabelled cases do not count as passing.

The independent Vitest suite runs in normal tests/CI. It checks all 272 comparable
labels against the production mapping functions, plus fixture integrity, negative
directory rules, separate target/resolution/offset accounting, input isolation,
missing outputs and runtime failures. The standalone command emits the detailed
report for inspection. No collection, extraction or label refresh runs in either.

## Stage boundary: season, Part and episode numbers

Season/Part extraction belongs to parsing. Choosing the correct season/Part work
belongs to candidate ranking and work recognition. This stage assumes that work
has already been selected and maps file-local evidence to its regular, special or
whole-movie slots. It does not invent a season ordinal or a cross-Part offset from
related-work order, and it does not claim that a plausible target permits admission.

For directory conversion, the production context function still performs its own
title/season validation and re-ranks the single supplied work after an adjustment.
These internal safeguards are retained. No competing work search/ranking is run.
Results are assembled with one selected work, frozen ranking facts and a fresh
mapping proposal; only then is the production context function applied.

## Standalone fixtures and provenance

Version `2026-11-07.1` contains a manifest and storage shards in this directory:

| Group | Paths | Comparable labels | Initial passes |
| --- | ---: | ---: | ---: |
| Base identification files | 369 | 223 | 223 |
| User-reported files | 10 | 10 | 10 |
| Existing directory scenarios | 50 | 27 | 27 |
| Existing synthetic rule regressions | 24 | 12 | 12 |
| Total | 453 | 272 | 272 |

`corpus.json` owns versions, extraction provenance, selected-work projections and
the case-file manifest. Storage shards are not evaluation splits. The loader reads
only this directory; source snapshot paths are historical provenance identifiers,
not runtime file dependencies. Shared TypeBox evidence/work schemas are reused by
the ranking evaluator, without depending on its fixtures or running its algorithm.

Base inputs and reported evidence reuse the existing frozen parser snapshots.
Scenario/rule evidence was frozen once using the production parser, grouped by
batch and immediate parent directory. Standalone base files remain independent;
reported siblings and directory scenarios retain explicit batches. Identical paths
in separate batches never share anchors. Work projection and ranking facts are
frozen before evaluation and never depend on expected target numbering.

The 12 synthetic assertions are extracted from existing
`identification-general-rules.test.ts` and `anitomy-adapter.test.ts` regressions.
Their remaining 12 files provide anchor context only; no extra expected answers
were inferred. Existing end-to-end parser, ranking and admission tests remain intact.
The 38 release-title inputs remain outside this file/directory benchmark.

Frozen parser/ranking facts are not independently verified extraction truth.
They isolate this stage from future upstream changes but can retain upstream
errors. Known work identity is an explicit controlled-input assumption. There is
no claim of live identification accuracy or an independent held-out sample.

## Independent target labels

| Basis | Labelled rows | Contract |
| --- | ---: | --- |
| Frozen season-local labels | 46 | The existing 40 independently corroborated base labels plus six repeated scenario uses; target numbers are copied verbatim |
| Corroborated unchanged numbering | 190 | Original file numbers and labelled provider sorts agree; captured regular-episode local numbers also agree, and numbers fit the selected work's known count |
| Whole movie | 14 | The reviewed work is a movie; mapping is its whole-work slot, not provider episode sort 1 |
| User report | 10 | Independently labelled filename-local numbers from the original report; no verified provider episode catalog is claimed |
| Existing rule regression | 12 | Original positive or unresolved assertions for ranges, local tokens, zero and directory anchors |

`labelEvidence` preserves independent production-numbering provenance.
`numberingEvidence` preserves provider sorts, provider-local values and the
selected work's episode count used to assess unchanged-number comparability.
Load-time checks reject inconsistent proof and labels. No offset is derived from
a provider relation or by subtracting provider sorts from provider-local numbers.

**Bangumi sort values are not automatically season-local target numbers.**
Fifty-five inherited unchanged-number cases lack corroborated local equality or
violate the selected work's count bounds. They remain in the corpus as unscored
diagnostics, with their frozen facts, rather than becoming false mapping failures
or receiving invented local targets. This exclusion uses source facts and count
bounds, not production mapping output. The original identification answers are
not rewritten. One additional case has unverified zero numbering.

The other unscored inputs are 113 files without independently known work identity
and 12 anchor-only files. Together these make 181 unscored rows. Missing identity
does not cause the evaluator to guess a work or run a mapping against the first
candidate. `review`/`ignore` source decisions are not negative mapping labels.

## Targets, unresolved suggestions and offsets

Each labelled case owns:

- `targets`: ordered `{ kind, number }` slots, including the target kind;
- `resolved`: whether the mapping supplies nonempty targets with no unresolved
  numbering questions;
- optional `offset`: a specific directory conversion, or null to assert that no
  conversion is justified.

Targets and resolution are scored independently. Episode zero may supply a
special suggestion while remaining unresolved. An in-scope alternative may
propose a converted target and offset while still requiring an explicit choice.
Neither case is treated as a resolved association merely because targets exist.

Directory regressions cover agreeing independent anchors, conflicting anchors,
cross-directory and unrelated files, duplicate versions of one anchor and
ambiguous in-scope alternatives. Output retains anchor file IDs and source
versions. Existing guards are exercised directly; no replacement conversion
algorithm or custom mapping implementation is introduced.

## Reports and initial observation

Reports include overall, per-group, per-basis and per-tag counts; target,
resolution and offset denominators; row-level raw/selected numbers, season/Part
evidence, targets, unresolved reasons, conversion provenance and runtime errors.
An error stays in the denominator; missing or foreign context outputs are errors.

The initial run had 272/272 comparable cases pass, all six explicitly labelled
offset checks pass, 181 unscored inputs and no runtime errors. This does not mean
that all 453 paths are correctly mapped or that unscored ambiguities are solved.
The 50 directory scenarios repeat base samples; neither they nor multiple
episodes/releases from one work are independent generalization observations.

## Maintenance

Keep selected work, extraction/ranking facts, context batches and target labels
separate. Increment the fixture version for changes and retain source versions and
review rationales. Add expected targets only with independent local-number
evidence; preserve unknown systems. Refresh snapshots explicitly, not during tests.
Do not convert failed outputs into expected labels or add assertions to anchor-only
files from their current predictions. If upstream evidence is corrected, document
that change separately from a mapping-rule improvement.
