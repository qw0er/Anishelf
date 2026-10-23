# Acquisition Responsibility Refactor

Date: 2026-10-23. Status: implemented; see the
[current architecture](current-architecture.md) for behavior and verification limits.

## Final decision

Use Sources, Subscriptions and Downloads as the three business units, with a
qBittorrent protocol adapter. Sources owns evidence and content access. Subscriptions
owns per-anime intent, selection and permission. Downloads owns the complete accepted
task through submission, remote observation, ingestion and recovery.

The earlier Fulfillment and independent Imports proposals are withdrawn. Transfer
and import are stages inside Downloads; splitting their persisted state into
independent business modules would increase coordination without a separate product
capability. The previous workflows directory and cross-application context inheritance
are removed. Renaming Discovery alone would not fix its mixed responsibilities;
subscription commands/authorization now stay together, while task execution stays in
Downloads.

## Entry point and call chain

```text
Detail form -> Acquisition.subscriptions.save
  -> validate source syntax, profile, scope, target/account and expected revision
  -> transaction: bind source + save subscription + save permission
  -> return enabled subscription, without remote I/O

Background Subscriptions -> Sources refresh -> Anime assessment -> existing selection
  -> transaction: publish evidence/download references and candidate decisions
Downloads -> read valid selection/permission -> reserve -> validate torrent -> submit
  -> observe -> Resources verify/refresh -> Anime ingest -> record outcome
```

Saving does not wait for source or Anime services. Initial failures are visible and
retryable. The form displays the validated destination and submits its revision and
account generation. No preview/token/confirm flow remains. Existing discovery-only
subscriptions stay unauthorized until explicitly saved against a current target.

## Preserved behavior

- Selection profiles, schema, defaults, conditions, anyOf, waiting clocks, seed
  policies, ranking, fingerprints and reservation locking are unchanged.
- Keep canonical hash/episode deduplication, pending mutation persistence, uncertain
  submission reconciliation, external pause/removal handling and command idempotency.
- Keep actual-file validation, Review, import-only retry, late-write rejection and
  terminal reservation retention.
- Keep stored IDs/tables/migrations. Authorization mappings move to Subscriptions;
  source and subscription writes still use the same SQLite connection.

## Removed complexity

- Independent recurring source registration/enable/remove; enabled subscriptions
  supply collection ownership. Evidence and accepted locators remain durable.
- Preview state, expiration, tokens, endpoints and frontend confirmation steps.
- Discovery/workflows top-level responsibilities and reverse authorization callbacks.
- Repeated torrent resolution in a single execution and Activity queries used only
  to obtain reserved candidate IDs.

Sources still needs adapter-specific validators and connection fences. Downloader
SDK requests and Sources transport retain their own trust/cancellation policies.
This refactor does not implement Watching automation, a Jackett subscription UI,
service provisioning or a standalone search product. Source capability probe and
search routes remain available; merging their product UI is separate work.

## Validation

Run Biome, lint, type checks and the test suite with required child-process/local
socket permissions. Focus on direct activation, transactional rollback, asynchronous
collection, stale-result rejection, unchanged selection decisions, restart/upgrade,
unknown submission and import retry. Keep mocked evidence distinct from real-service
and browser/media acceptance.
