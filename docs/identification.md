# Identification Module

Identification is a stateless recognition module. It converts validated local
source identities into extraction evidence and possible work/episode associations.
It does not own scanning, queues, durable tasks, HTTP routes, confirmation,
rejection, manual corrections or anime-library persistence.

## Recognition API

`IdentificationApi.identify(sources, signal?)` accepts existing Resource Access
`SourceIdentity` records and returns one `IdentificationResult` per source:

| Field | Meaning |
| --- | --- |
| `source` | The input root/file/path/version identity; internal, not an HTTP DTO |
| `evidence` | Original strings, ordered elements, parser/normalization versions, context fingerprint and interpreted numbering |
| `status` | `parsed` for local-only extraction, `proposed` when candidates exist, `unresolved` when configured metadata search yields no candidate |
| `metadataStatus` | `not-configured`, `searched` or `failed` |
| `proposals` | Ranked metadata candidates, each with its own episode mapping proposal |
| `unresolved` | Missing, ambiguous or conflicting evidence and recoverable matching failures |

`parsed` means extraction completed, not that the work or episode was confirmed.
Missing Metadata is a normal local-only mode and never a failed parsing task.
Production supplies cached AniList candidates through the [Metadata module](metadata.md)
when its storage is available. Without Metadata, local parsing still succeeds.
Identification does not invent works, episode titles or provider identifiers.

The parser adapter uses pinned `anitomy-ng@1.0.10`. It separately retains basename,
ancestor, path and same-directory batch results, including repeated/unknown element
kinds. Leaf numbering alone supplies episode tokens; folder batch ranges never
become a file's episode range. The adapter does not reparse filenames or correct
parser tokens. Multiple episode tokens remain ambiguous rather than being inferred
as a range; content classification uses only parser-provided type elements.
Parser omissions or truncations remain visible in the original evidence and
require user review.

The consumer-owned Metadata port exposes bounded `search(query, signal)`. Metadata owns
provider transport, snapshots, cache, retries and provider-wide limits. If an
adapter is configured, Identification sends extracted titles rather than local
paths, deduplicates queries within each call, ranks candidates using `fast-fuzzy`
and records matching/conflicting reasons. Every candidate gets a separate mapping
proposal without requiring a user-selection step. Scores are not probabilities,
and none of these results commits an association. A failed provider request keeps
local extraction and returns an explicit recoverable matching outcome.

Numbers remain raw evidence until interpreted. Regular single numbers and
whole-work movie slots can be proposed. Dual numbering, decimals, unidentified
specials, ancillary files, descending/oversized ranges and counts outside the
selected candidate's scope remain unresolved. Multi-episode files never imply
per-episode seek boundaries. AniList calendar seasons and sequel relations must
not be treated as series ordinals or episode offsets.

Initial recognition bounds are 500 sources per call, parser groups of 50, three
title queries per source, 100 distinct queries per call, ten ranked candidates,
100 expanded episodes and 15-second metadata calls. Callers own cancellation and
retry. No mutable task/result state survives between recognition calls.

## Automatic application workflow

`workflows/automatic-identification.ts` coordinates the automatic workflow outside
Identification. `bootstrap/identification.ts` constructs recognition and this
coordinator independently of SQLite or HTTP availability.

1. Subscribe to Library's published-snapshot/root-reset notifications and inspect
   an already-published startup scan when assembling the application.
2. Enumerate the publication through revision-checked `LibraryApi.readFilePage()`
   pages. Resource Access resolves confined identities and actual source versions.
3. Group files by directory and split groups into deterministic batches of 50.
   Compare recognition version and complete group identities/versions with a
   process-local cache. New/replaced sources and changed group membership cause
   re-identification of affected contexts; unchanged groups are reused.
4. Call Identification and revalidate the source versions/root epoch before
   accepting results. New publications cancel the previous pass and coalesce
   into the latest scan. Failed/cancelled scans do not publish new work.
5. Expose the current validated result projection internally. The optional
   `onPublication` sink delivers the complete successful pass and canonical root
   to [Anime Catalog](anime-catalog.md); production connects it when storage and
   Metadata are available. Empty publications also reconcile disappeared sources.
   Provider failures retain extraction and are retried on a later completed scan.

Automatic parsing happens after manual, scheduled and startup scans publish their
results. It requires no Identify button or `/api/identifications` call. The library
can exceed 500 files because coordination uses multiple bounded recognition calls.
Root resets clear the visible projection, vanished files leave it on the next
scan, and replaced files receive their actual new source version. Original names
and bytes remain untouched. Shutdown unsubscribes and cancels coordination before
Library closes.

The coordinator's cache and result projection are in memory. Restart reconstructs
them from the published scan. [Anime Catalog](anime-catalog.md) owns durable works, episodes, review decisions,
confirmed associations and user corrections, preserving them when consuming
automatic proposals. Identification has no dependency on Catalog. The Review UI
remains pending.

The former task/review HTTP API, repository, ORM definitions and uncommitted
Identification migration have been removed. Identification requires no database.

## Structure and verification

```text
identification/
  public.ts                     Recognition API and result types
  ports.ts                      Parser and consumer-owned Metadata capabilities
  policy.ts                     Recognition bounds and versions
  application/identification.ts Stateless extraction/matching orchestration
  domain/model.ts               Evidence and proposal types
  domain/matching.ts            Candidate ranking
  domain/mapping.ts             Candidate-specific numbering proposals
  infrastructure/parser.ts      anitomy-ng adapter
```

```sh
npm run test --workspace @anishelf/backend -- test/identification.test.ts
npm run biome:check
npm run lint
npm run typecheck
npm test
```

Tests cover all 369 corpus filenames for evidence preservation, numbering safety,
automatic proposal generation through injected Metadata fixtures, provider failure,
cancellation, bounded input, actual scanner/source integration, incremental scans,
directory context changes, replacement/deletion, restart reconstruction, root
switching and libraries larger than one batch. Corpus extraction checks do not
prove identification accuracy. Catalog has its own persistence/transaction checks. Review UI and playable fixtures
remain separate iteration acceptance work. Metadata has its own provider and persistence checks.
