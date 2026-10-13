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

The diagram groups all thirteen runtime modules by capability. Groups organize
source files; they do not introduce services or grant access to another module's
implementation. Solid arrows show layer calls or mechanism use; dashed arrows
show application assembly. The collaboration table below identifies the main
module interfaces rather than every import.

Bootstrap constructs modules, injects dependencies and owns startup/shutdown.
Background-work owners stop before shared media services and persistence close.
The HTTP layer validates requests and projects public responses; business workflows
remain in Applications. A reverse proxy owns TLS and authentication for external
access; transport request validation does not replace authentication.

## Module ownership

| Module | Owns |
| --- | --- |
| Configuration | Validated policy, persistent user settings and transcode profiles |
| Library | Published resource index, scans and resource-root switching |
| Resource Access | Confined file access, shared source identities and source validity |
| Media Inspection | Source-bound media metadata and shared inspection caching |
| Media Planning | Compatibility interpretation, output specifications and read-only execution decisions |
| Media Processing | Execution preflight, media-tool work and validated temporary outputs |
| Playback Selection | Browser-evidence validation and selection of original or prepared resources |
| Playback | Progress sessions, durable viewing progress and history |
| Preparation | Persistent tasks, scheduling, reusable artifacts and prepared-media delivery |
| Subtitles | Track discovery, selected-track preparation, delivery and asset lifecycle |
| Metadata | Provider queries, normalized snapshots, persistent cache, refresh and artwork |
| Identification | Stateless local extraction, candidate ranking and episode association proposals |
| Anime Catalog | Durable local works/episodes, review decisions, confirmed associations, corrections and library projections |

These are the existing runtime owners. [Identification](identification.md) exposes
a stateless recognition Public API and a consumer-owned Metadata port.
[Metadata](metadata.md) implements AniList access behind its own Public API, and
bootstrap adapts cached summaries into recognition candidates.
An application workflow uses Library publication/read APIs and Resource Access to
automatically supply validated sources. Identification has no HTTP, database or
Catalog dependency. Production cloud matching is connected when Metadata storage
is available. [Anime Catalog](anime-catalog.md) consumes complete publications,
preserves manual decisions and owns confirmation/query HTTP APIs. The Web workflow
remains pending.

## Source organization and dependency boundaries

The backend source has six responsibility roots:

| Root | Responsibility |
| --- | --- |
| `app` | Startup/shutdown, module assembly in `bootstrap`, schema aggregation and cross-module workflows |
| `modules` | Independently owned business capabilities, grouped by `system`, `resources`, `media`, `playback` and `anime` |
| `contracts` | Browser-safe public protocol shapes, schemas and stable shared protocol constants |
| `platform` | Database connection capabilities, filesystem/process mechanisms, media tools and logging |
| `shared` | Small internal concepts and tools: source identities, errors, readonly policy utilities, sorting and fingerprints |
| `transport` | HTTP mechanisms, security, errors, streaming and projections genuinely shared by several handlers |

The groups contain Configuration; Library and Resource Access; Inspection,
Planning, Processing, Preparation and Subtitles; Playback and Playback Selection;
and Identification, Metadata and Anime Catalog, respectively. Module grouping is
not a new API boundary. Every module still exposes its own `public.ts`.

Cross-module consumers use explicit Public APIs and consumer-owned ports,
including for type imports. Only `app` imports module implementations to assemble
them. Modules cannot import `app`; platform and shared cannot import business
modules. Public and policy entries cannot load Application or adapter implementations.
Runtime dependencies remain acyclic.

`persistence.ts` is a separate, restricted database-adapter entry. It exports table
definitions needed by migrations, cross-module foreign keys and adapter queries;
it does not expose repositories or business operations. Only module database
adapters and application assembly may import these entries. Applications, domain
code, HTTP handlers and business Public APIs cannot use them. Each module owns
its schema beside its repository; `app/schema.ts` aggregates these entries for
Drizzle initialization and migration tooling. `platform/database` owns the
schema-independent table/transaction connection capability. Existing migrations
and database identities are unchanged by source reorganization.

HTTP handlers call their own Application. Module-specific presenters live beside
the handlers; common file, media and compatibility projections remain in transport.
Applications coordinate domain decisions, ports and module Public APIs. Domain
code and business contracts do not derive types from HTTP schemas. Configuration
owns settings and profile types; Planning owns negotiation and planning results;
Processing owns execution requests and handles; Preparation owns durable task
snapshots. Platform media owns encoder settings, low-level execution specifications,
process events and FFmpeg capability inventories.

Internal layout follows actual complexity. Media Inspection has a root-level
Application, ports and policy rather than an otherwise empty domain directory.
Module policy definitions live directly in `policy.ts`. Preparation scheduling,
execution and artifact lifetimes, subtitle/font lifetimes, recognition rules and
Catalog use cases retain separate implementations because they have distinct
responsibilities.

### Module collaboration

| Consumer | Public capability or injected port |
| --- | --- |
| Library | Configuration settings; Resource Access root validation/opening capability injected by app, plus public MIME classification |
| Resource Access | Configuration settings and an app-supplied resource catalog port; owns source identity/epoch validation |
| Inspection | Resource Access source resolution and an injected media probe |
| Planning | Inspection results, Resource Access validity and Configuration profiles; returns read-only decisions |
| Processing | Inspection and Resource Access; executes through an injected platform media adapter |
| Preparation | Planning and Processing APIs, Configuration profiles and Resource Access; owns jobs and artifacts |
| Playback Selection | Planning, Resource Access and a consumer-owned prepared-copy port implemented through Preparation in app |
| Playback | Resource Access and its own persistence port; owns progress sessions independently of selection |
| Subtitles | Resource Access, Inspection and injected media tools; owns subtitle/font assets |
| Automatic identification workflow | Library publication/read API, Resource Access and Identification; forwards complete proposals to Catalog through app wiring |
| Identification | Injected parser and consumer-owned Metadata port, adapted from Metadata Public API by app |
| Anime Catalog | Identification proposal types, Metadata snapshots/pins and Resource Access registration/validity |

Application assembly owns construction and degraded-startup handling. The main
entry connects modules and preserves shutdown order: automatic identification,
Catalog, Metadata, Preparation, Playback, Subtitles, Library, media execution,
Inspection, database, then logging.

### Frontend ownership

Web source uses `app`, `features` and `shared`, with the browser entry and global
styles at the source root. `app` owns routes, layout, Providers and cross-feature
coordination. Routes and sibling features consume only feature `public.ts` entries.
Features cannot import app implementations; shared cannot import features or app.

Features own endpoint requests, query keys, polling, policies, components and
controllers. Library owns browsing/scans; Resource Access owns file reads reused
by browsing and playback; History owns its page and queries; Settings owns resource,
transcode-profile and external-player controls. Playback, Preparation and Subtitles
own their respective interactions. Media Compatibility owns browser capability
checks and compatibility negotiation. Settings profile controls receive preparation
actions from app so Settings and Preparation do not create a runtime dependency
cycle.

Shared code owns HTTP request/error handling, QueryClient and cancellation helpers,
query scope, UI primitives, navigation URL helpers, translations and general tools.
Query key values and source scopes remain unchanged: source refreshes do not reset
an unchanged player's transient state. App owns cross-feature cache invalidation;
features expose only the entries other consumers actually need.

Dependency-cruiser checks these directions, private module access (including type,
re-export and literal dynamic imports), persistence entry restrictions, unresolved
imports and runtime cycles. Fixture tests cover both permitted and rejected access.

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
