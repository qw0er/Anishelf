# Provider-independent anime integration

## Scope and invariants

Metadata and Tracking own their contracts. AniList remains the production implementation; one active tracking provider/account and cumulative episode progress remain the supported product model. Remote state is authoritative. Local playback/history never depend on provider availability. Multi-account fan-out, cross-provider title matching and episode-number conversion remain Later/Unassigned.

External work references have provider, media type and opaque string ID. Tracking transports these as canonical encoded keys (`provider:anime:id`); accounts and remote entries use `provider:id`. Components are URI encoded independently. Keys are compared as complete values, never as unqualified IDs. Metadata and tracking registrations are independent. Local Catalog IDs remain unchanged.

Tracking owns watching/planned/completed/paused/dropped/rewatching status semantics and cumulative completed episode counts. Provider descriptors declare supported states and maximum progress. Providers without these semantics must reject the operation. Remote modification time is nullable and measured in milliseconds; cache freshness and operation intent order use local timestamps. Read-before-write conflict detection compares intended fields, not timestamps. AniList has no conditional writes; concurrent changes between read and save remain possible.

## Boundaries

AniList protocol code owns GraphQL, numeric validation, authorization policy and shared request pacing. Consumer infrastructure adapters explicitly map IDs, states, times and failures. Tracking application/domain never import AniList. The runtime facade is constructed by a provider-neutral factory; production composition injects adapters and configuration. Authorization uses an opaque credential string, with a provider-supplied display label and optional authorization URL. This delivery supports credential entry; other interactive authorization protocols require their own implementation.

Target resolution is a consumer-owned port. Exact reference matches in the active provider resolve directly. Different namespaces return unmapped; invalid or unsupported episode numbering returns unsupported; multiple confirmed associations return ambiguous. No title/season heuristics or automatic cross-provider mapping are introduced. Mapping revision, source version, account generation, manual intent version and command deduplication retain their existing fences. Library joins use the same canonical reference identity and never create Catalog entries for remote-only items. Unknown/unmapped viewing state is distinct from a loaded absent entry.

Metadata defaults and artwork host allowlists are injected during assembly. Manual lookup sends an opaque ID or supported work URL to the selected metadata adapter through `/api/metadata/reference`; frontend business code does not parse provider URLs. Provider adapters normalize schema differences; raw provider data remains isolated. Artwork requests remain HTTPS-only, with bounded responses and redirect validation. Cache identity includes provider and projection versions.

## AniList SDK integration

The AniList protocol adapters use `@api-wrappers/anilist-wrapper` 4.0.1.
Search, viewer lookup and entry saves use its services with explicit field selections.
Details retain `description(asHtml: false)`, `source(version: 3)` and main-studio
arguments; relations retain `relationType(version: 2)`. Those queries, airing
pagination, complete chunked list reads and account/media entry lookups use the
wrapper's raw GraphQL service because convenience methods do not preserve all
required arguments and projections. Runtime response and identity checks remain
in the protocol adapters; generated TypeScript types are not runtime validation.

`infrastructure/wrapper.ts` creates an operation-scoped SDK and supplies a custom
transport that delegates to the existing shared `AniListScheduler`. Its decoded
result is presented to the SDK as a GraphQL response. SDK retries are disabled
(`maxAttempts: 1`); only the scheduler contacts AniList, attaches credentials,
limits response bytes, observes rate-limit headers and owns cancellation,
priority, deadlines and retries. Mutations still have one transport attempt;
uncertain delivery is reconciled by Tracking. Original scheduler exceptions are
preserved across api-core wrapping. Tokens and signals are captured per operation,
so simultaneous public and account calls do not share mutable SDK credentials.

Existing request/outcome diagnostics remain at the scheduler and consumer layers.
The scheduler logs its effective pacing and query/mutation attempt limits without
credentials or payloads. No new database format or provider identity is introduced.

## Persistence and migration

Migration 0017 converts numeric account/media/entry identities to canonical AniList keys in columns and nested JSON, normalizes viewing statuses and remote timestamps, and versions pending playback observation contexts. Operation IDs, revisions, attempted desired fields, receipts, manual versions, retries and history are preserved. Uncertain submissions reconcile before dispatch. SQL changes run under the migration transaction. Existing immutable credential files are read through an exact legacy AniList account binding; new files use version 2 and opaque credentials. No credential file rewrite is required, so interrupted SQL migrations cannot partially migrate secrets. Backups must include both the SQLite database and tracking-credentials directory. Restore both together to roll back an upgrade; downgrade-in-place is unsupported.

## Verification and observability

A deterministic non-AniList provider must exercise opaque IDs, different state encoding, nullable remote timestamps, capability rejection, account isolation, restart reconciliation and HTTP contracts. Migration fixtures cover nested attempts/contexts, receipts, history and reopen. Existing playback/manual intent regressions remain required. Provider and resolution outcome are logged without credentials, request headers or response payloads. Architecture checks reject protocol imports and provider-specific business branches.

## Implementation map

- `shared/external-reference.ts`: canonical work keys and scoped account/entry IDs; exported to Web through `contracts/references`.
- `tracking/domain`: product viewing semantics, provider descriptors, namespaced opaque identities and nullable millisecond remote timestamps.
- `tracking/ports.ts`: account/list/update and target-resolution ports. `tracking/application/targets.ts` implements exact-reference resolution.
- `composition/tracking.ts` and `composition/metadata.ts`: provider-neutral factories. `composition/anilist.ts` selects production adapters and policy. The protocol scheduler remains shared by all AniList clients.
- `anime-library/application/library.ts`: exact reference joins, stable remote identities and explicit tracked/untracked/unknown/unmapped availability.
- `contracts/schemas/tracking*`: synchronized HTTP identity, capability, state and target-resolution contracts. Web cache keys include scoped account IDs and generations.
- `0017_tracking_provider_identity.sql`: transactional data/schema migration; malformed operation JSON aborts the upgrade instead of replaying uncertain intent. Invalid/legacy observation versions terminate delivery with an explicit outcome.

## Adding a provider

Implement the consumer account/list/update ports, explicitly translate wire states and timestamps, and supply a descriptor to the Tracking factory. Credentials are opaque serialized strings; validation belongs to the adapter. Register metadata independently with a default provider and artwork host allowlist; optionally parse provider URLs in the metadata adapter. Add deterministic fixtures proving the supported cumulative-progress semantics. Select adapters at assembly; no provider selection UI or simultaneous-account synchronization is implemented.

## Upgrade and restore

Stop Anishelf and back up the SQLite database together with `tracking-credentials/` before upgrading. Retain the complete data directory when practical. Startup applies migration 0017 once, with no remote writes during migration. Saved uncertain attempts reconcile through the existing worker after startup. To restore an older version, stop the process and restore the matching database and credential backup together before starting that version. Do not open an upgraded database with an older executable.

## Acceptance coverage

`tracking-provider.test.ts` exercises a second deterministic provider through real factories, repositories, HTTP commands, Library projection, mapping outcomes, capability rejection, account changes and restart. Its IDs contain delimiters and Unicode, its wire states differ, and remote timestamps can be absent. `tracking-provider-migration.test.ts` upgrades a pre-0017 database, validates immutable attempts/receipts/observations/history and old credentials, reopens the database, restores a paired backup, and proves failed migrations roll back and retry. Existing Tracking regressions retain manual-over-automatic ordering and uncertain-delivery behavior. These tests do not certify a second remote service or replace a live AniList account acceptance run.

## Verification record (2026-10-18)

Biome check, lint (including architecture and unused exports), both workspace type checks and both production builds passed. The final full suite recorded 939 backend passes, one skip and one failure; all 322 Web tests passed. The remaining failure is `multiple native monitors isolate equal paths and keep healthy roots updating during recovery` in `backend/test/filesystem-monitor.test.ts`. It was independently reproduced from an unchanged HEAD source snapshot with child-process/localhost permissions; Resources and that test were not changed by this refactor. The same baseline run also reproduced the unrelated-directory native-monitor assertion. Therefore `npm run check` is not fully green despite all provider-related tests passing. No live remote account or production database was used for acceptance.

## SDK replacement verification (2026-10-19)

Biome check, lint (including architecture and unused exports), both workspace type
checks and production builds passed. The full suite passed 947 Backend tests,
324 Web tests and 59 architecture tests. Wrapper regressions cover concurrent
credential/public-request isolation, priority and cancellation context forwarding,
original failure identity and retry timestamps, one-attempt mutations through the
real scheduler, and cancellation before dispatch. Existing metadata, authorization,
list and Tracking regressions also pass. No live AniList credential was used;
real-provider read/write acceptance remains pending.
