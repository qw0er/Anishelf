# Real-source title enrichment corpus

This dataset freezes public AniList GraphQL and Bangumi v0 API facts collected on
2026-11-05. It covers 49 anchor works and 89 labelled cross-source pairs: 49
same-work positives, 38 different-work negatives, and two unresolved scope cases.
Eight anchors reproduce reported failures; 41 extend coverage beyond those reports.

The corpus is deliberately separate from filename identification and episode
numbering fixtures. A same-work label permits supplemental names only. It does
not authorize identity merging, field composition, or episode mappings.

## Evidence and labels

- `snapshots/` retains selected factual response fields, provider IDs, source and
  request URLs, UTC capture timestamps, and SHA-256 fingerprints of the complete
  HTTP response bodies. Descriptions, images, credentials, and personal data are
  excluded. These are projections, not complete raw-response archives; the original
  response hash cannot be recomputed from the reduced projection.
- `seeds.json` records reviewed anchor IDs and explicitly requested additional
  candidates. Initial seeds from the identification corpus were fetched again;
  existing application cache contents were not used as source evidence.
- `cases.json` records independent expected labels, source snapshot keys, candidate
  IDs, coverage tags, evaluation splits, family groups and review rationales.
  Positive correspondence was reviewed from the two captured source records, not
  inferred from the current matching algorithm or merely from search rank.
- `catalog.md` links both official entries for every positive anchor. Candidate
  details include sequels, companion shorts, PVs, films and same-title adaptations.
  The manga entry sharing the student-council title is an explicit wrong-medium
  negative. Related material is not automatically a same-release match.

The two unresolved cases involve overlapping material in a compilation or advance
screening. They must not become positives without an explicit release-scope policy.

## Coverage and evaluation

Coverage includes TV, TV_SHORT, OVA, ONA, MOVIE and MUSIC; completed, releasing and
announced works; missing episode counts; ordinary and large date disagreements;
original-title language/word-order differences; punctuation; movie prefixes;
season/cour/stage differences; grouping 120 short segments as 24 TV episodes;
identical titles for different adaptations; and search pagination/retrieval gaps.
For example, SAO Ordinal Scale's correct movie was absent from the first three
native-query results and was retrieved directly by its reviewed official ID.

`regression` retains reported families. `development` contains established corpus
families. `holdout` contains additional families; do not tune rules on its results.
All pairs from a family share a split to avoid season/sequel leakage. The candidate
pool is deliberately bounded: captured details cover pinned IDs and the first
three search hits, not an exhaustive provider catalog. A captured search's total,
limit, offset and result IDs record this limitation. These are not complete query
replays for all English/romaji variants. The manual matcher test below isolates candidate verification; retrieval recall
requires separately captured query/page replays.

The integrity test validates coverage, source references and label completeness.
It does **not** claim that the current enrichment algorithm passes the positives.
Use positive recall and false-positive counts per tag when optimizing that
algorithm; preserve all known negatives and unresolved boundaries.

## Offline use

```sh
node --import tsx scripts/manual-tests/title-enrichment-corpus.mjs summary
npm run test --workspace @anishelf/backend -- test/modules/anime/metadata/title-corpus.test.ts
```

Normal tests never contact either website. Dataset labels remain independent of
the production matching policy.

## Explicit collection

```sh
node scripts/collect-title-enrichment.mjs
```

Collection intentionally has no package.json entry. Invoke the maintenance script
directly when refreshing source evidence. The collector makes sequential public requests at least 1.1 seconds
apart, identifies itself with the project User-Agent, and observes server retry
responses. It emits structured collection/retry progress logs. Existing snapshots
are reused; a missing pinned candidate can be appended. It never silently rewrites
case labels. For a genuinely fresh version, archive the existing snapshot directory
and review newly collected facts and labels together. Network collection is an
explicit maintenance action, not part of CI or ordinary tests.

## Manual production-algorithm test (opt-in)

```sh
node --import tsx scripts/manual-tests/title-enrichment-corpus.mjs test > /tmp/anishelf-title-matcher-report.json
node --import tsx scripts/manual-tests/title-enrichment-corpus.mjs test --split development
node --import tsx scripts/manual-tests/title-enrichment-corpus.mjs test --split regression
node --import tsx scripts/manual-tests/title-enrichment-corpus.mjs test --split holdout
```

This command runs the current `MetadataNameEnrichment` implementation against the
frozen corpus. It uses the production AniList and Bangumi adapters to project real
name roles, formats, counts and dates; only unrelated display fields absent from
snapshots receive neutral defaults. No alternate matching algorithm is implemented.
The selected peer is taken from the algorithm's verified proof, not guessed from
whether a Chinese title appeared in the output.

The fake SourceMetadataApi supplies a complete **controlled candidate pool** for
any query: all captured anime candidates for the anchor on Bangumi, and the anchor
plus independently captured related AniList anchors. Expected case labels and
counterpart IDs are used only for assertions after matching, never to select the
pool. Source responses are marked fresh to isolate matching. Non-anime subjects
are excluded at the protocol type gate; their negative cases validate exclusion,
not a decision inside the name verifier. Pool sizes and exclusions are reported.

This is not a replay of the original web searches: unrecorded queries, pagination,
ranking, missing detail captures, rate limits and real network freshness are not
being evaluated. The `search-pagination` tag describes the captured source evidence;
a result in this manual test cannot establish that production retrieval succeeds.

The JSON report includes per-case accepted peer ID, pass/fail, actual rejection
logs, per-candidate decision states/reasons and candidate counts; positive recall, false-positive rate, unresolved accepted
cases, wrong-counterpart selections and runtime errors; and breakdowns by split and
coverage tag. A positive must select its labelled counterpart. Negatives and
unresolved pairs must not be accepted. Any failed case, unsafe counterpart selection,
or runtime error produces exit code 1; only a completely passing run returns 0.

The evaluator lives under `test/manual/` without a `.test.ts` suffix. It is not
included in default `npm test`, `npm run check`, builds, collection, summary commands
or CI. It performs no live requests and writes no snapshots, labels or application
data. Execute it explicitly when ready to evaluate or optimize the algorithm.


## Verification-policy evaluation (2026-11-06)

The previous strict date/format/count policy accepted 16/49 positive pairs (32.7%)
and accepted none of the 38 negative or two unresolved pairs. The
`names-evidence-v2` policy was developed on the development and regression families;
holdout results were measured separately and were not used to tune the matcher. All split runs and the final combined
run passed:

| Split | Positive recall | Negatives accepted | Unresolved accepted |
| --- | --- | --- | --- |
| Development | 24/24 | 0/19 | 0/1 |
| Regression | 9/9 | 0/6 | 0/0 |
| Holdout | 16/16 | 0/13 | 0/1 |
| Combined | 49/49 | 0/38 | 0/2 |

No wrong-counterpart selections or runtime errors occurred. This is a small,
reviewed, controlled-pool verification benchmark, not a production success rate.
It does not cover live query recall, first-page truncation, network freshness or
rate limits. Expanding replay coverage and independent negative families remains
necessary before claiming broader production recall. `--split` changes assertions
and evaluated anchors, not candidate membership; it never uses expected labels to
construct the pool. Manual evaluation remains outside default tests and CI.
