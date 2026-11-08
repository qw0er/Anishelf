# Subscription resource discovery corpus

This small offline corpus checks how subscription acquisition finds downloadable
resource candidates through Jackett. Run it with:

```sh
node --import tsx scripts/manual-tests/acquisition-discovery-corpus.mts summary
node --import tsx scripts/manual-tests/acquisition-discovery-corpus.mts test
```

The six cases cover multilingual follow-up searches, finding a resource on a later
page, deduplication across title queries, empty results, repeated pages, and missing
pagination metadata. The evaluator runs the production title selector, Jackett
client, HTTP transport, and Torznab parser against an Undici MockAgent with network
connections disabled. It checks request order, candidate order, download locator
availability, outcomes, and coverage limitations. Unrecorded requests fail.

## Data provenance and limits

The three exact publication titles and original publication URLs are reused from
the [identification corpus](../anime-identification/corpus.json). Each entry records
its source case ID. **The search responses, page layouts, and title-to-result
relationships are constructed protocol fixtures, not captured live search
responses.** Download locators use reserved example.org URLs and are never fetched.

An unrelated title intentionally appears among results: discovery gathers candidates;
the subsequent release assessment decides whether they belong to the subscription.
Batch titles are retained for the same reason. Passing this corpus establishes
search orchestration behavior, not real-site recall accuracy or eligibility.

This first version does not cover all indexers, live search quality, RSS ingestion,
release identification, resource preference ranking, or submitting downloads.
It requires no Jackett installation, credentials, or large external database.

## Adding a case

Add publication records to `entries` with source URLs and source case IDs. Add a
case with metadata titles, a page-size limit, recorded query/offset responses,
expected ordered candidate IDs, outcome, and coverage. Use `total: null` to omit
pagination metadata. Keep expectations independent from response contents and
explicitly document whether future responses are constructed or captured.

The CLI emits structured start/completion/failure logs on stderr and a JSON report
on stdout. The corpus also runs in the backend test suite.
