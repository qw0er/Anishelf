# Playback and manual media preparation

[Architecture](architecture.md) · [UI design](design-system.md) · [Manual preparation](../guide/manual-preparation.md)

## Ownership

Resources owns original-file identities, source versions and confined reads. Media owns
inspection, explicit preparation commands and published files. Playback owns the
selected resource binding, source-level progress, sessions and completion observations.
`libmedia-react-player` owns client decoding, rendering, track selection and
player controls.

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
The player reports the loaded file's stream index. Anishelf uses the asset's
audio inventory to map that index back to the source and to distinguish tracks
with the same language. An explicit silent selection is stored as `audio=none`.
Version links remain source/version-bound.

Runtime failures retain the selected binding and show an explicit retry action.
They do not start processing or persist a browser incompatibility verdict.
Background publication never replaces active playback. The version menu refreshes
its own inventory when opened, and users explicitly choose newly prepared copies.

## Frontend lifecycle

Anishelf opens a progress session and resolves the selected asset before starting
the player. It maps the last source position to the asset clock and passes it as
`initialPositionMs`. The restore result and ready event must come from the same
player session before autoplay or progress saving can begin. A failed restore
keeps the last confirmed position available for retry. Title and audio changes
reuse the selected asset's player. A different asset or a manual media retry
starts a new player binding, while callbacks from the previous binding are ignored.

Normal-play evidence is sampled independently of network saves. Pauses, buffering,
seeks and rate changes break continuity. Saves occur every 15 seconds; seeks are
coalesced for 500 milliseconds, while pause, natural end and page hiding flush.
Writes remain serialized with generation/sequence checks, bounded requests and
exponential retries. Closing a page while offline can lose unsynchronized progress.
Only natural source completion can mark the whole source watched.

## Subtitles

The player reads embedded tracks from the selected media asset. It renders
embedded PGS, VobSub and DVB in Matroska, and uses JASSUB for styled ASS/SSA with
attached fonts. Selecting an embedded bitmap or styled track starts a separate
reader with the same media credentials. The player caches the result for the
current session. JASSUB failures leave the selected ASS/SSA track available
through the player's basic subtitle renderer.

Anishelf reads matching SRT, WebVTT, ASS and SSA sidecars through the existing
version-bound subtitle API. It passes each complete file as a Blob and applies
the asset's media origin minus the source origin as the subtitle offset. A
failed or timed-out sidecar read leaves the other tracks available.

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

The shared client pins `libmedia-react-player@1.4.1`. The playback route loads
the package on demand. Vite emits the decoder, renderers and Workers as
same-origin assets and excludes those assets from the Web shell's precache.
The desktop renderer uses the standard application scheme, CSP and device
authentication.

The player package reports HEVC Main 10 with AAC in Matroska verified in Chrome
and packaged Electron. Player-level tests also exercised styled ASS with attached
fonts, timed text sidecars and embedded PGS. Full Anishelf validation in the
packaged desktop client, including authenticated HTTP range seeks, remains pending.

Exercise real files in both clients when validating release builds. Cover
authenticated range reads and seeking, same-language audio selection, embedded and
sidecar subtitles, progress restoration, and preparation and retry. Inspect
prepared files for preserved subtitles, fonts and chapters.
