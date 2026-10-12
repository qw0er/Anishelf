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

The diagram shows resource/playback module owners and the main system layers.
The new backend Identification owner is described below and is not yet shown in
the diagram. Solid arrows
show calls or mechanism use; dashed arrows show bootstrap assembly. Selected
cross-module relationships are summarized below the diagram rather than presented
as a complete dependency graph.

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
| Identification | Stateless local extraction, candidate ranking and episode association proposals |

These are the existing runtime owners. [Identification](identification.md) exposes
a stateless recognition Public API and a reserved consumer-owned Metadata port.
An application workflow uses Library publication/read APIs and Resource Access to
automatically supply validated sources. Identification has no HTTP, database or
Catalog dependency; production cloud matching and Catalog persistence remain pending.

## Dependency boundaries

Cross-module consumers use explicit Public APIs and consumer-owned ports, including
for type imports. Only bootstrap imports another module's implementations for
assembly. Runtime dependencies remain acyclic; shared source identities prevent
features from creating conflicting views of the same resource.

HTTP handlers call their own Application. Applications coordinate domain decisions,
ports and module Public APIs. Domain code and business contracts remain independent
of HTTP schemas, Applications and concrete infrastructure. Platform adapters supply
filesystem, database and process mechanisms without owning business workflows or
importing business modules. Configuration validates inputs before injection.

Frontend routes compose features through public entries. Shared query infrastructure
owns server data; components and playback controllers own transient interaction
and browser-media state. Shared UI conventions belong to the design system.

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
