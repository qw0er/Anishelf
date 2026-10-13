# Anishelf Architecture

This document describes the overall system structure, module ownership and
architectural constraints. [Requirements](requirements.md) owns the feature
inventory; [Current iteration requirements](current-version-requirements.md) owns
selected scope and acceptance. [Current iteration design](current-version-design.md)
defines the proposed anime-library implementation. [History](history.md) preserves
version-specific
designs, including the [archived implementation details](history.md#architecture-detail-snapshot-2026-10-11).
[Design system](design-system.md) owns shared UI conventions, while
[Development](development.md) and [Deployment](deployment.md) cover setup and
operations. Source contracts and database schemas remain authoritative for exact
fields, routes and policy values.

## System structure

Anishelf is a React Web application backed by one Node.js process. HTTP separates
the browser from the backend; business modules collaborate through in-process
Public APIs. The backend uses SQLite for durable application state, the filesystem
for original media and generated assets, and FFprobe/FFmpeg for media inspection
and processing. Original resources remain read-only.

![Anishelf overall architecture](architecture.svg)

The diagram shows five encapsulated business modules and their thirteen internal
owners. A module owns its public contract, private assembly and lifecycle. Solid arrows show layer calls or mechanism use; dashed arrows
show application assembly. The collaboration table below identifies the main
module interfaces rather than every import.

Bootstrap constructs modules, injects dependencies and owns startup/shutdown.
Background-work owners stop before shared media services and persistence close.
The HTTP layer validates requests and projects public responses; business workflows
remain in Applications. A reverse proxy owns TLS and authentication for external
access; transport request validation does not replace authentication.

## Internal ownership

| Module | Owns |
| --- | --- |
| Configuration | Validated policy, persistent user settings and transcode profiles |
| Library | Published resource index, scans and resource-root switching |
| Resource Access | Confined file access, shared source identities and source validity |
| Media Inspection | Source-bound media metadata and shared inspection caching |
| Media Planning | Compatibility interpretation, output specifications and read-only execution decisions |
| Media Processing | Execution preflight, media-tool work and validated temporary outputs |
| Playback Selection | Browser-evidence validation and selection of original or prepared resources |
| Progress | Progress sessions, durable viewing progress and history |
| Preparation | Persistent tasks, scheduling, reusable artifacts and prepared-media delivery |
| Subtitles | Track discovery, selected-track preparation, delivery and asset lifecycle |
| Metadata | Provider queries, normalized snapshots, persistent cache, refresh and artwork |
| Identification | Stateless local extraction, candidate ranking and episode association proposals |
| Anime Catalog | Durable local works/episodes, review decisions, confirmed associations, corrections and library projections |

These are the existing runtime owners. [Identification](identification.md) exposes
a stateless recognition Public API and a consumer-owned Metadata port.
[Metadata](metadata.md) implements AniList access behind its own Public API, and
Anime assembly adapts cached summaries into recognition candidates.
An Anime workflow uses Resources publication/read and source-access APIs to
automatically supply validated sources. Identification has no HTTP, database or
Catalog dependency. Production cloud matching is connected when Metadata storage
is available. [Anime Catalog](anime-catalog.md) consumes complete publications,
preserves manual decisions and owns confirmation/query HTTP APIs. The Web workflow
remains pending.

## Source organization and dependency boundaries

The backend source has six responsibility roots:

| Root | Responsibility |
| --- | --- |
| `app` | Connect complete modules, assemble global policy, own protocol setup and staged shutdown |
| `modules` | Five independently encapsulated business modules |
| `contracts` | Browser-safe protocol shapes, schemas and shared protocol constants |
| `platform` | Database connection capabilities, media tools, filesystem/process mechanisms and logging |
| `shared` | Small internal concepts: identities, errors, readonly utilities, sorting and fingerprints |
| `transport` | HTTP mechanisms, security, errors, streaming and genuinely shared projections |

### Large modules

| Module | Internal owners | External responsibility |
| --- | --- | --- |
| System | Configuration | Deployment/settings/profile capabilities and immutable effective settings |
| Resources | Library, Resource Access | Directory/file reads, scans, root switching, publications, confined source access and registration |
| Media | Inspection, Planning, Processing, Preparation, Subtitles | Compatibility, published-copy views, media information, preparation and subtitle HTTP services |
| Playback | Progress, Playback Selection | Resource selection, sessions, durable progress and history |
| Anime | Identification, Metadata, Anime Catalog | Recognition coordination, provider cache/query capabilities, review and durable association decisions |

The five directories are API boundaries, not categorization folders. External
consumers cannot import any child entry, including a child's `public.ts`.
Internal owners still collaborate through their own Public APIs and ports;
module composition owns the only implementation-access exception.

| Root entry | Allowed consumer |
| --- | --- |
| `public.ts` | Sibling modules, app and boundary presenters: selected business capabilities/types only |
| `create.ts` | App only: construction, policy inputs and module lifecycle capabilities |
| `http.ts` | App only: module HTTP registration; internal registrations stay private |
| `persistence.ts` | App and database adapters only: schema, foreign-key contracts and repository-port factories |

Only root entries cross a large-module boundary. Public entries cannot expose
Application/repository constructors or load assembly implementations. Root
contracts select actual capabilities rather than wildcard-exporting child APIs.
Returned business APIs are method capability objects, not Application instances.
Media's compatibility facade publishes an independent immutable view without
canonical roots or private encoder profiles. Its prepared-copy view contains
only the eligibility/identity facts needed by Playback.

App also cannot access child implementations. Each module constructs its own
services, adapters and HTTP handlers. HTTP registration closures retain private
owners; app connects registrations to protocol setup. Domain and port types do
not derive from HTTP schemas. Platform/shared cannot depend on business modules,
and modules cannot import app.

### Module collaboration

| Consumer | Dependency |
| --- | --- |
| System | Platform configuration mechanisms; app supplies only settings-validation policy |
| Resources | System settings and profile selection; confined source capabilities are constructed internally |
| Media | Resources source validity/access, System settings/profiles, injected platform media tools |
| Playback | Resources identities/access; Media compatibility checks and published-copy views; System selected profile |
| Anime | Resources publications and bounded reads/access; System deployment settings |
| Anime internal recognition | Parser and Metadata candidate port, both adapted inside Anime |

Playback consumes Media's `inspectCompatibility`, `checkCompatibility`,
`listPlaybackCopies` and `getPlaybackCopy`; it does not know about Planning or
Preparation APIs. Anime owns automatic recognition and proposal-to-Catalog
publication; app does not coordinate its child services.

Module owners define policy defaults and validation. App aggregates them into
its global policy and passes the relevant sections through root create entries.
System no longer imports or publishes other modules' policies. Shared sorting
is an independent concept, not a dependency on Library's policy implementation.

Each durable child owns tables beside its repository. Root persistence entries
provide schema and structural storage ports; they do not publish repository
classes. `app/schema.ts` aggregates root schema entries for Drizzle initialization
and migration tooling. Database connections remain in app/platform. Existing
table, column, index, foreign-key and migration identities are preserved.

### Lifecycle

`quiesce()` stops producers without invalidating source access needed by cleanup.
App first quiesces Anime recognition, Media preparation and Resources scans. It
then closes Playback, Anime, Media and Resources, followed by database and logging.
Each owner manages its private teardown order; Media stops preparation before
closing subtitle assets, execution and inspection. Repeated/concurrent Media and
Anime shutdown calls share one completion. App attempts all cleanup even if an
owner fails, then reports an aggregate error.

### Frontend ownership

Web source retains `app`, `features` and `shared`; features now contains four
encapsulated modules:

| Module | Internal features |
| --- | --- |
| Resources | Directory browsing/scans and shared file reads |
| Media | Browser compatibility, preparation and subtitles |
| Playback | Player and history |
| Settings | Resource/profile settings and external-player preferences |

Root `public.ts` exposes selected data operations, queries, hooks and contracts;
root `ui.ts` exposes components only for app composition. Business facades import
specific internal definitions so importing a public data operation does not load
an internal UI barrel. Internal features remain private outside their owner.
Settings is small enough to keep its implementation directly inside its module
rather than an extra single-child directory.

App supplies Resources' file-action slot using Playback and Media UI entries.
It supplies Playback's preparation/subtitle slots using Media UI. Those components
retain their Providers and query scope when mounted. Directory compatibility
queries belong to Media; Resources consumes the root capability. Profile controls
receive preparation actions from app, avoiding Settings-to-Media dependencies.

Dependencies are one-way: Media uses Settings; Resources uses Media; Playback
uses Resources, Media and Settings. Shared HTTP/query mechanisms, cancellation,
UI primitives, navigation helpers and translations import neither app nor features.
Query keys, scopes, polling, cancellation and cache invalidation retain their
existing behavior. The Anime Web workflow remains pending.

Dependency-cruiser checks both large-module and internal feature boundaries,
app-only entry restrictions, persistence restrictions, protocol independence,
unresolved imports and runtime cycles. Tests cover type imports, re-exports,
literal dynamic imports, facade projection, UI composition and staged teardown.

## Core collaboration

Library publishes scanned resources; Resource Access validates their identity and
confines access to the configured root. Inspection, playback, preparation and
subtitles use that shared source capability. Source changes and root switches
invalidate dependent work and prevent stale resources from being delivered.

Playback Selection combines source inspection, browser evidence and available
prepared artifacts to choose an original resource, a prepared resource or a blocked
result. Selection is read-only. Preparation is an explicit workflow that uses
Media Planning and Media Processing to produce validated, reusable artifacts;
opening a playback session does not start processing.

The browser streams the selected resource directly through media responses with
GET/HEAD/Range support. Playback sessions own progress and history independently
of selection and preparation. Source time remains the shared reference for progress,
chapters and subtitles, including when playback uses a prepared copy. Subtitle
assets are prepared and delivered independently of the video resource.

Persistent task and asset owners reconcile durable state with files at startup and
revalidate source identity before reuse or delivery. Media-tool execution and
resource lifetimes remain bounded, with cancellation and cleanup owned by the
workflow that acquired them.
