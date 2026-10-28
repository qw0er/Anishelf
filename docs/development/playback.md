# Playback Assets and Listening Intent

[Architecture](architecture.md) · [UI design](design-system.md) · [Database](database-design.md)

## Ownership

Resources owns source identity, source versions and confined file access. Media
owns actual inspections, preparation commands, published copies and their media
catalog. Playback selects among existing assets and owns source-level progress.
The HTTP presenter constructs delivery URLs. Opening playback never starts FFmpeg.

A source identifies the original file and its canonical timeline. Each original
or completed prepared file is a distinct media asset. An asset has its own
revision, inspected container, video, audio tracks, duration, size and timeline
mapping. Prepared assets retain an ordered mapping from output audio tracks to
source stream indices. Source stream 7 can therefore correspond to output stream
1 without confusing the user's listening preference with a container index.

Preparation publishes validated FFprobe output with the completed artifact.
Published output facts never come from the current encoding profile. Profile
fingerprints still deduplicate future preparation work and fence unfinished
commands; editing or removing a profile does not invalidate completed bytes.
Source/version/access changes and missing cache files retain their existing
validation and invalidation rules.

`PreparationApi.catalog` exposes published bytes and pending audio scopes without
execution plans or mutable task state. `MediaApi.listPlaybackAssets` combines that
inventory with the original inspection. Playback has no profile-catalog dependency.

## Listening and retention

Playback intent is automatic audio or one explicit source stream index. Automatic
intent resolves to the source's default audio track, or the first track when no
explicit default exists. It does not require a copy retaining every source track.
An explicit no-audio asset link can use `audio=none`; ordinary muting remains a
player control. Multiple track indices are accepted only by preparation commands.

A candidate must contain the requested source track. Additional retained tracks
are allowed when the browser can select the corresponding output position. A
browser without native audio selection cannot reliably play a non-default track
from a multi-audio asset; a single-track prepared copy is offered instead. An
explicit English preference never silently selects a Japanese-only copy.

Prepared-copy watch links pin the artifact, source version and one source audio
track. The player applies native track selection using output positions and maps
subsequent native changes back to source intent.

## Negotiation and active playback

`POST /api/playback/options` returns actual asset inspections and bounded browser
queries. `POST /api/playback/selection` accepts evidence identified by asset and
description revisions. The server reloads current assets, rejects stale or
ambiguous evidence, and returns choices plus one active binding or a typed blocked
reason. Only the selected asset's media facts and assessment drive the player and
its primary compatibility report. Original-file diagnostics are disclosed
separately.

Default selection prefers a supported original that satisfies the listening
intent, then a supported existing copy. Explicit asset selection can request a
trial despite uncertain browser reports; it cannot bypass missing-track or
unavailable native selection constraints. When original inspection is unavailable,
a minimal explicitly unverified original asset permits a manual trial without
inventing codec or track facts.

File availability, browser capability predictions and runtime errors are separate.
Network failures preserve the selected resource and capability evidence. Decode
or unsupported-source failures can exclude that asset for the current attempt;
they do not invalidate every resource derived from the original or write a
persistent browser incompatibility verdict.

## Frontend lifecycle

The playback controller owns URL intent, resource resolution and progress binding.
The on-page audio control reads only the active asset, including its actual codecs
and output tracks. It offers switching only when native audio selection is
available; otherwise it displays the selected track. Audio changes pin the current
asset, so they cannot implicitly choose a different file. Source-only languages
are available through preparation or an explicit file-version change, not through
the current player's audio control. Automatic audio remains an initial resolution
policy rather than an extra track in the active file.
Media's preparation control owns task queries and emits only an assets-changed
notification. A blocked resolver can retry or poll pending work; active playback
ignores unrelated invalidation. The version chooser refreshes its inventory
independently when opened, so new copies can appear without replacing the current
player. Explicit retry or changed intent creates another resolution attempt.

The video adapter consumes one concrete active binding and reports runtime events.
It never re-queries original-file metadata to explain a prepared-copy failure.
Progress, chapters and subtitle discovery retain source identity. Media time is
mapped to source time before progress is saved, preserving resume across asset
switches and preventing multiple histories for one original file.

## Persistence and diagnostics

Migration `0016_prepared_media_descriptions` adds a nullable validated JSON
inspection snapshot to `prepared_artifacts`. Existing rows and files survive.
An existing entry without output metadata is inspected once on demand and saved;
metadata recovery is serialized. Tool unavailability defers inspection without
removing the copy. These snapshots contain probe facts, not settings or credentials.

Log `playback.asset_selected` with source identity, selected asset and mapped audio
indices. Log output-description recovery separately. Runtime diagnostics identify
the failed asset and error category without media URLs, cookies or filesystem paths.

Acceptance covers automatic single-track copy reuse, explicit language mismatch,
source/output audio index mapping, stale evidence and access fencing, actual AAC
versus original Opus display, prepared-copy restart recovery, unchanged active
playback during background work, and network failures leaving capability evidence
intact. Real FFmpeg tests exercise publication, byte seeking and restart reuse.
