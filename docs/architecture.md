# Anishelf Architecture


This document retains the architecture overview, module ownership and cross-module constraints.
Version-specific detailed design is archived in [History](history.md#v2-design).
[Requirements](requirements.md) owns product goals and future scope;
[Development](development.md) owns setup and operations;
[Design system](design-system.md) owns shared UI conventions;
[History](history.md) preserves V1/V2 requirements, acceptance and detailed designs.
Schemas, database definitions and module Public APIs are authoritative for fields,
routes, types and policy values.

Direct playback, saved progress/history, external and embedded text subtitles,
compatibility negotiation, persistent preparation and prepared-copy playback are
implemented. Real-time HLS, embedded fonts, automatic cache eviction and user-editable
cache budgets remain later requirements. The History page covers continue watching through recent records and resume;
no separate Continue watching UI is required. Offline HLS per-track
planning and source-time mapping have independent tests. Unimplemented HLS and
real-time ports, HTTP variants and artifact models have been removed.

## Modules and boundaries

Anishelf is a React/Node.js application with one backend process. Business modules
collaborate through in-process Public APIs; HTTP is the browser/server boundary.
Bootstrap assembles dependencies and owns startup/shutdown. It closes durable
preparation and subtitle owners before shared processing/inspection and closes
persistence last. Production supplies one shutdown sequence to HTTP composition.

![Anishelf module overview](architecture.svg)

The diagram separates implemented owners from future delivery work.

| Module | Owns |
| --- | --- |
| Configuration | Effective immutable policy, user settings and transcode profile catalog |
| Library | Published in-memory index, scans and root-switch coordination |
| Resource Access | Confined file access, source identities, root epoch and source registry |
| Media Inspection | Shared source-version-bound inspection cache and probe concurrency |
| Media Planning | Source/output descriptions, browser evidence validation, expected output specifications and read-only execution decisions |
| Media Processing | Execution preflight, FFmpeg work and validated temporary outputs |
| Playback Selection | Read-only candidate inspection, browser-evidence validation and final original/prepared resource choice |
| Playback | Progress-write sessions, durable progress and history |
| Preparation | Persistent tasks, queue, reusable artifacts and cache delivery |
| Subtitles | Discovery, selected-track preparation, delivery and asset lifecycle |

Cross-module imports, including types, use explicit module entries: `public.ts`
for service contracts and pure decisions, `policy.ts` for defaults/validation, and
Resource Access's `files.ts` for the confined-filesystem capability. Public service
contracts are explicit interfaces rather than aliases derived from Applications.
Policy/service entries do not load Application or infrastructure implementations.
Only bootstrap may import implementations from other modules for assembly.
Consumer-owned ports declare the smallest needed behavior and data. Preparation and
Media Planning share immutable work specifications; they do not derive those from
HTTP types. Playback Selection's copy port contains eligibility and resource metadata,
not a preparation task or execution plan. Bootstrap projects the provider view into
that port. Shared source identities and negotiation values live in focused business
contracts, with compile-time checks against their separate HTTP schemas.
Domain code, ports and shared business types cannot import `contracts/http.ts`.
HTTP handlers call their own Application; Applications coordinate domain logic,
adapters and other modules' Public APIs. Domain code does not depend on HTTP,
Applications or concrete infrastructure. Platform adapters provide filesystem,
database and media-process mechanisms without owning business workflows or
importing business modules. Platform owns the input types it needs; Configuration
validates and injects those inputs. Runtime environment capture belongs to Platform.
Frontend features likewise expose `public.ts`; routes compose them.

Resource Access receives an indexed-source catalog port from bootstrap rather
than importing Library. Playback, inspection and subtitles consume the same
read-only source capability. The shared source registry prevents each feature
from inventing its own source identity. Runtime dependencies remain acyclic. Boundary checks include type-only imports;
type-only cycles are distinguished from runtime initialization cycles.
`npm run architecture:check` enforces these constraints with dependency-cruiser.
`npm run unused:check` runs Knip across both workspaces, including tests and
package entry points, to prevent unused files, exports and dependencies. Both are
part of lint. Reusable exports under `web/src/components/ui` are exempt from
unused-export checks; their files and dependencies remain checked. TypeScript
uses one supported 6.0 version across workspaces.
See [Refactoring baseline](refactoring-baseline.md) for preserved behaviors and
the refactoring implementation/status inventory.

## External-player playlists

File actions and the player's More playback options menu also offer **Download
video**. The action rechecks file access through the shared original-media link
resolver, then follows a same-origin anchor with the original filename in its
`download` attribute. The browser streams the original bytes using the existing
GET/HEAD/Range route and the deployment's authentication policy. No full-file
Blob, transcoding, prepared copy or playback-history update is involved.

The Web file page and file action menu offer **Download playlist (.m3u)** alongside
**Copy media link**. Both recheck file access and accept only the expected original-media
route. The frontend generates a UTF-8 extended M3U containing one entry, using the
application origin and the current filename with control characters removed from metadata.
The browser downloads the playlist; the user opens it in a compatible external player,
which must be able to reach that origin. The playlist references the original media,
not a prepared copy, and does not carry selected sidecar subtitles, audio selections,
resume positions or browser credentials. Downloading never writes playback progress
or claims that an external player has started.

## Browser invocation of external players

`web/src/config/external-player-policy.ts` owns platform detection, the compatibility
matrix, protocol templates, browser-storage key and custom-entry limits. Platform
matching uses user-agent/client platform hints, with Android preceding Linux and
an iPadOS desktop-mode touch check preceding macOS. This is a compatibility hint,
not installed-player detection; unknown platforms expose custom entries only.

| Client platform | Built-in players |
| --- | --- |
| macOS | IINA, Infuse, mpv |
| Linux | mpv |
| Windows | mpv |
| Android | VLC, MX Player (free edition), mpv-android |
| iOS / iPadOS | Infuse, VLC, Outplayer |

Library file actions and the file player's **More playback options** dropdown contain
an **Open in external player** submenu. Opening it rechecks access using the existing
file query and accepts only the original-media route. Entries are disabled during
validation or after failure, with an explicit retry. Ready entries are native anchors:
the user's click follows the external URL directly, preserving browser user activation.
Android uses an explicit VIEW Intent with the package name and media MIME type, since
Anishelf's media routes have no filename extension. The submenu also links to Settings.

Custom players are added/deleted in Settings and persisted under
`anishelf.external-players.v1` in the current origin's localStorage. They apply to
this browser and are not server settings. Mounted consumers update after local edits
and other-tab storage events; failed writes retain the existing list. Invalid stored
data is reported and retained instead of silently overwritten. Templates require
`{url}` (the original absolute URL) or `{urlEncoded}` (encodeURIComponent of that URL),
with optional `{mimeType}`. Unknown placeholders, control/whitespace characters,
script/data/file URLs and ordinary Web navigation schemes are rejected.

The target application must be installed. Desktop mpv additionally requires an
OS-registered handler and a version supporting `mpv://`; browser/handler compatibility
must be tested on each target platform. MX Player Pro can be configured with a custom
Intent using its own package. A browser may prompt before opening an application.
Invocation does not report successful playback or update Anishelf's history, and
does not send cookies, resume positions, selected audio tracks or sidecar subtitles.
Copy media link and M3U download remain available in the same dropdown.

Protocol references: [IINA source](https://github.com/iina/iina/blob/develop/iina/AppDelegate.swift),
[Infuse API](https://support.firecore.com/hc/en-us/articles/215090997-API-for-Third-Party-Apps-Services),
[mpv protocols](https://mpv.io/manual/stable/#protocols),
[Android browser Intents](https://developer.chrome.com/docs/android/intents),
[VLC Android manifest](https://github.com/videolan/vlc-android/blob/master/application/vlc-android/AndroidManifest.xml),
[MX Player Intents](https://sites.google.com/site/mxvpen/api), and
[mpv-android manifest](https://github.com/mpv-android/mpv-android/blob/master/app/src/main/AndroidManifest.xml).

## Reverse proxy request validation

Configuration validates the optional `ANISHELF_PUBLIC_ORIGIN` at startup. HTTP
transport accepts its Host authority and validates mutation Origin against the
configured external scheme and port. Listener configuration remains loopback-only,
and local requests keep their listener-bound Host/Origin validation. Forwarded
headers are not trusted; cross-site mutation metadata is still rejected. A reverse
proxy owns authentication and TLS for external access. This setting does not add
application accounts or authentication.

The setting allows a single external origin without wildcards or domain lists.
Host validation permits that origin's hostname and effective port in addition to
the existing loopback/localhost authority on the listener port. When unset, only
local authorities are accepted. Host is checked on every request. Production
mutation Origins, when present, must match the origin selected by the accepted
Host; absent Origin remains allowed unless fetch metadata indicates cross-site
access. GET, HEAD and OPTIONS skip Origin and fetch-metadata checks. Development
retains the fixed Vite Origin allowlist. This allowlist does not prove that a
request has passed proxy authentication; authentication is a proxy responsibility.

## Initial resource configuration

Configuration validates `ANISHELF_INITIAL_RESOURCE_ROOT` as an optional absolute
path. When persistent settings are missing, Configuration checks media-directory
access and separation from the data directory before publishing a complete
settings file without replacement. Existing settings always take precedence;
malformed or unreadable settings fail instead of being overwritten. The initial
root is a deployment default for first setup, while persistent settings remain
the owner of subsequent user choices. Without the variable, missing settings
continue to enter setup mode.


## Video chapters

Media Inspection reads embedded chapter titles and time ranges with FFprobe and
shares the existing source-version-bound probe cache. The version-validated
`GET /api/files/:id/chapters?sourceVersion=...` endpoint returns source times in
milliseconds; no embedded chapters returns an empty array. Probe failure or
contention returns `MEDIA_INSPECTION_UNAVAILABLE`, separately from empty results.

Web playback registers a Vidstack chapters text track and uses the default layout's
chapter menu, timeline segments and current chapter title. Missing titles use
`Chapter N`. Chapters load independently of playback and subtitles; failures offer
a retry without stopping video. Both original and prepared playback use source
chapters mapped through the selected resource's timeline. Prepared files still
omit embedded chapters; navigation does not require rebuilding them. External
chapter files, editing, automatic opening/ending detection and thumbnails are not
implemented.
