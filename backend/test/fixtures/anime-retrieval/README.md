# Small candidate retrieval replay

Six controlled-input examples cover full titles, a short title, Japanese/romaji
queries, explicit season and Part hints, and an actual empty response. This is a
small regression library, not an exhaustive provider database.

```sh
npm run anime:retrieval -- summary
npm run anime:retrieval -- test
npm run test --workspace @anishelf/backend -- test/modules/anime/identification/retrieval-corpus.test.ts
```

The same `identificationSearchQueries` function is used by production
IdentificationApplication and this evaluator. Extraction preserves its existing
ordering, deduplication, season/Part rules and three-query limit; no search policy
was changed. Inputs are manually supplied title/ordinal evidence, isolating this
stage from filename parsing. Expected query lists pin these few common regression
contracts, not an assertion that every alternative query wording is invalid.

## Real response collection

Eight first-page responses were fetched from the public
[AniList GraphQL API](https://graphql.anilist.co) on 2026-11-07, at least 1.2 seconds
apart. `corpus.json` records the exact GraphQL selection, query/page/perPage,
retrieval timestamps, original response SHA-256 fingerprints, returned IDs/title
fields in their original order and page metadata. No results are filtered by the
expected identity. These are small, real API selections rather than full provider
schema recordings; raw HTTP bodies are not committed, so response fingerprints
cannot be recomputed from the projected record alone.

Positive identity labels reuse independently reviewed work IDs from the existing
title-enrichment fixtures:

| Case | Identity evidence |
| --- | --- |
| Full, short, multilingual title | [Frieren](https://anilist.co/anime/154587) |
| Season 2 | [SPY x FAMILY Season 2](https://anilist.co/anime/158927) |
| Part 2 | [Mushoku Tensei Part 2](https://anilist.co/anime/127720) |
| Empty query | Exact captured response to the deliberately nonsensical string; no claim that a work is globally absent |

Production query generation is evaluated against exact recordings. A new query
without a recording is a missing-data failure, never an invented empty response
or a fallback candidate pool. Expected IDs are used only after retrieval. Reports
show actual queries, missing recordings and the deduplicated candidate IDs before
any ranking cutoff. The initial run passed all six cases, with five of five
positive cases recalled and no missing recordings.

## Deliberate limits

This replays only first-page ID results (production default: ten items per request), not the HTTP
adapter, metadata enrichment, pagination strategy, rate limits or live search
recall. No ranking, admission or episode mapping is scored. The broad queries may
already recall a sequel; the dataset does not claim that the season/Part query is
always necessary. Normal tests and commands never refresh or contact the API.
The default tests also exercise missing recordings and label-independent pools.

Keep the library small: add a captured response when a concrete failure or query
change needs one. Preserve ordering and all returned IDs, review target identities
independently, and increment the fixture version. Do not silently replace expected
answers with production predictions. Versioned captures describe that collection
date, not current website behavior.
