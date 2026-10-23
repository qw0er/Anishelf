# Jackett Sources adapter (stage 2)

Historical stage-2 notes. The current API/lifecycle is documented in
[Sources boundary](source-lifecycle.md), and delivered stage-3 deployment/settings
are documented in [Jackett setup](jackett-setup.md). Manual acquisition is delivered
in [Search subscriptions](search-subscriptions.md). The old interface, HTTP routes,
persistence restrictions and pending-stage statements below describe that earlier
implementation and are superseded by those documents.

## Delivered scope

Sources now supports an RSS binding or a Jackett query behind the same opaque
`SourceReference` and `refresh(reference)` operation. Consumers receive immutable
release snapshots; protocol selection, credentials, validators and pagination
remain inside Sources. Composition supplies an explicit indexer and up to four
title aliases. Normalization preserves season and part tokens.

This stage provides connection configuration, configured-indexer discovery,
capability probes, bounded diagnostic searches and an internal torrent transport.
It does not create Jackett subscriptions or download permissions. Query snapshots
cannot be published into the existing RSS persistence model. The subscription,
permission and download-intent migration must land together in stage 4. Bundled
bootstrap, deployment provisioning and settings UI remain stage 3 work.

## Connection and HTTP contract

The authenticated API prefix is `/api/acquisition/sources/jackett`. Mutations and
POST diagnostics use the application's existing CSRF protection.

| Method and suffix | Request | Result |
| --- | --- | --- |
| GET | None | Safe settings, with `Cache-Control: no-store` |
| PUT | `generation`, `url`, `origin`, ordered `indexers`, optional `apiKey` | New safe settings |
| DELETE | `generation` | Cleared settings with a new generation |
| POST `/indexers` | `generation` | Configured indexer IDs and names |
| POST `/probe` | `generation`, `indexerId` | Search capability and page limit; `searchVerified: false` |
| POST `/search` | `generation`, `indexerId`, `titles` | Outcome, coverage and safe release summaries |

Settings contain `generation`, `url`, `origin` (`bundled` or `external`), `indexers`,
`hasApiKey`, `ready` and `error`. Readiness means that configuration has a key and
at least one enabled indexer; it does not assert upstream health. Omitting
`apiKey` preserves the saved key; explicit `null` clears it. `origin` records the
configuration's deployment origin and does not cause provisioning or failover.

Credentials live only in `<dataDir>/acquisition/jackett.json`, written through a
private temporary file and atomic rename (directory mode 0700, file mode 0600).
Every accepted save or clear advances generation. Stale writes fail with 409;
old source references, waiting requests and late responses cannot use the new
configuration. An unreadable configuration leaves the module unavailable without
blocking backend startup or silently overwriting the file.

Diagnostic search summaries include ID, title, publication time, size, nullable
seeders/peers and `downloadAvailable`. They omit raw GUIDs, locators and credentials.
`downloadAvailable` describes an available locator, not download authorization.
Internal evidence retains normalized GUID, source/generation, claimed hash and a
credential-free descriptor. Zero seeders differs from unknown seeders.

## Bounds and errors

Search uses individual `t=search` calls; aggregate `all` is used only for configured
indexer enumeration. Capability probes use `t=caps` and are cached for 15 minutes
within a connection generation. Successful caps do not establish working search.

- Up to four distinct title aliases, three pages per alias, and 1,000 processed items.
- Page size is at most 100 and respects smaller advertised default/maximum limits.
- XML bodies are limited to 5 MiB and 1,000 items; torrent bodies to 10 MiB.
- Requests have a 30-second deadline. RSS and Jackett share two discovery slots.
- Each indexer has at most one in-flight request and at least five seconds between
  request starts. Excess concurrent work fails with `source_busy`.
- HTTP retry hints and Torznab rate errors defer further requests. Long backoffs
  return `rate_limited` instead of accumulating sleeping requests.

An empty successful feed returns `no_match`. Repeated pages, missing pagination,
page limits and item limits set explicit limited coverage. A limited result must
not be interpreted as evidence that all remaining episodes are absent.

Safe error codes distinguish authentication failure, unsupported capability,
rate limiting, malformed responses, upstream failure, cancellation and timeout.
HTTP-200 Torznab error documents remain failures. API error messages and logs do
not include upstream response descriptions, XML, keys or download URLs. Search
logs include indexer, generation, count, coverage, duration or safe failure code.

## Transport boundary

Public RSS retains public-address DNS and redirect checks. The separate Jackett
transport can reach a saved internal service, but constructs only Torznab API and
indexer download routes under the saved origin and base path. API redirects are
rejected. Indexer IDs are validated and aggregate searches are rejected.

Current query-key and legacy path-key Jackett download URLs become descriptors
containing generation, indexer, opaque path and file name. Credentials are added
only while resolving against the matching saved generation. Duplicate locator
parameters, wrong indexers and embedded credentials in external locators are
rejected. External torrent redirects use the existing public-only RSS transport
without Jackett credentials. Magnet redirects are supported. Actual torrent
validation and submission remain responsibilities of the later download closure.

## Verification

`backend/test/jackett.test.ts` covers XML normalization/errors, search bounds,
credential isolation, private configuration, generations, cancellation, concurrency,
retry hints and torrent redirects/body limits. `backend/test/jackett-http.test.ts`
covers authentication, CSRF, stale writes, validation and safe HTTP projections.

On 2026-10-23 (Asia/Shanghai), a disposable Apple Container instance of
`ghcr.io/linuxserver/jackett:latest` reported Jackett **v0.24.2890**, image build
**v0.24.2890-ls13**. The implemented client discovered the configured Nyaa.si
indexer, parsed its capabilities and completed two real upstream searches:

- `Big Buck Bunny`: successful no-match response.
- `Sousou no Frieren`: 75 normalized results with magnet descriptors; missing
  pagination was correctly reported as limited coverage. No API key appeared in
  the normalized result.

This verifies adapter interoperability, not subscription/download/media playback
acceptance. No media was downloaded. The mutable test image is not a deployment
pin; stage 3 still needs a deliberately pinned deployment version. The temporary
container and credential files are removed after verification.

Protocol references: [Jackett](https://github.com/Jackett/Jackett) and the
[Torznab specification](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html).
