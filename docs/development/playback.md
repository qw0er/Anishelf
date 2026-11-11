# Playback and manual media preparation

[Architecture](architecture.md) · [UI design](design-system.md) · [Manual preparation](../guide/manual-preparation.md)

## Ownership

Resources owns original-file identities, source versions and confined reads. Media owns
inspection, explicit preparation commands and published files. Playback owns the
selected resource binding, source-level progress, sessions and completion observations.
Movi Player owns browser decoding, rendering, audio/subtitle tracks and controls.

Media contains `inspection`, `preparation/planning`, `preparation/execution`,
`artifacts`, `subtitles` and a catalog read model. Planning compiles user intent; it
never queries browser capabilities or decides whether a file needs preparation.
Execution remains a private preparation collaborator. Artifacts owns publication,
reader leases and deletion; tasks retain the source/plan provenance needed to validate
those files. Existing queue, recovery and free-space safeguards are retained.

## Resource binding

`POST /api/playback/options` lists original and published assets. `POST
/api/playback/selection` binds the original by default, or exactly the requested
`assetId`. Both accept the source version and optional source audio index. Neither
accepts browser evidence, failed-resource lists or native track-selection flags.
An explicit unavailable asset or absent requested track returns a blocked binding;
it never silently changes the file. A failed server probe does not prevent an
unverified original trial. Access/version failures still prevent delivery.

Each completed asset describes actual inspected bytes, independent of current
profile settings. Output audio positions map back to source stream indices.
Movi's core audio track IDs identify FFmpeg stream indices in the loaded asset;
the adapter maps those through the asset's audio inventory back to source indices.
Language-keyed selection is not used, so same-language tracks remain distinct.
Version links remain source/version-bound.

Runtime failures retain the selected binding and show an explicit retry action.
They do not start processing or persist a browser incompatibility verdict.
Background publication never replaces active playback. The version menu refreshes
its own inventory when opened, and users explicitly choose newly prepared copies.

## Frontend lifecycle

`PlaybackClock` exposes time and duration in milliseconds, playback state, events
and play/seek operations without an HTMLVideoElement dependency. Movi's core uses
seconds; the adapter converts at this boundary and translates its state and seek
events into the application lifecycle. Source/media time mappings preserve
one resume history across originals and prepared copies. Title and audio changes do
not recreate the selected file's player; navigation detaches listeners and destroys it.

Normal-play evidence is sampled independently of network saves. Pauses, buffering,
seeks and rate changes break continuity. Saves occur every 15 seconds; seeks are
coalesced for 500 milliseconds, while pause, natural end and page hiding flush.
Writes remain serialized with generation/sequence checks, bounded requests and
exponential retries. Closing a page while offline can lose unsynchronized progress.
Only natural source completion can mark the whole source watched.

## Subtitles

Movi owns track selection and renders supported SRT, WebVTT and bitmap tracks.
JASSUB renders selected ASS/SSA tracks with their styles, positioning and effects.
The backend reads complete sidecar text and extracts embedded ASS/SSA with eligible
font attachments from the selected asset on demand. The browser uses a bundled
fallback font when the requested font is unavailable. See the
[Movi integration](movi.md#subtitle-rendering).

Sidecar URLs carry video and subtitle versions. Embedded reads also carry the
asset ID and revision. Legacy prepared copies without subtitle tracks still
support matching sidecars. The styled path renders the complete ASS/SSA track
at the current time, including cues that started before a seek.

## Manual preparation

`GET /api/files/:id/preparation-source` returns version-bound input facts for a
manual command. `POST /api/files/:id/preparations` accepts `sourceVersion`,
`profileId` and optional `audioStreamIndices`. Missing audio selection retains all;
`[]` creates silent output. There is no direct-play shortcut or browser negotiation.
Retry revalidates source/configuration; a changed plan creates a replacement task.

The default profile is Balanced (`builtin:balanced`), using Matroska. New commands
retain subtitle tracks, font attachments, chapters and track metadata. A custom container with
embedded subtitles/attachments is conservatively rejected unless it is Matroska;
no content is silently dropped or converted. Output inspection validates preservation
before publication. Profile changes never invalidate completed bytes.

Preparation retains deduplication, queue/concurrency limits, cancellation, atomic
publication, disk space checks, reader leases and source invalidation. Startup does not
implicitly rerun interrupted commands. Automatic preparation is removed.

Migration 0020 adds the persisted subtitle-preservation flag, cancels unfinished
legacy automatic tasks, removes automatic demand storage and clears retired subtitle
cache records. Existing manual tasks, completed files and progress are preserved.
Retired generated subtitle/font directories are cleaned on startup.

## Runtime distribution and validation

See [Movi Player integration](movi.md) for pinned resources and build instructions.
Acceptance covers real file playback, Range/seek, audio identity, sidecars, progress,
manual preparation/recovery and preservation of subtitle/font/chapter data.
Native browser prediction APIs are not acceptance evidence. Validate real media and
record browser/device limitations rather than claiming universal compatibility.
