# Video compatibility checks

Compatibility checking combines version-bound source inspection with reports from
one browser. A single `inspect()` / `check()` exchange evaluates the original media
and optional concrete output candidates. It never starts FFmpeg or an external player.

## Inspection and negotiation

1. `GET /api/files/:id/compatibility` returns selected streams, detected container,
   source version, `descriptionId`, `rulesVersion: "3"`, original browser queries
   and `output: null`. Optional `profileId` and `target` query parameters add concrete
   output candidates; `target` defaults to `file` and requires a profile ID.
   Optional `sourceVersion` checks freshness. Paths, raw initialization data and
   encoder settings are not exposed.
2. The browser checks file queries with `canPlayType`, MSE queries with
   `MediaSource.isTypeSupported`, and complete configurations with
   `MediaCapabilities.decodingInfo`. Missing metadata is never invented.
3. `POST /api/files/:id/compatibility` requires `sourceVersion`, `descriptionId`,
   `output` (null or `{ profileId, target }`) and up to 16 evidence reports. The
   server rebuilds the description, verifies its source/root/profile/query-bound
   fingerprint, validates reports and rechecks the source/root. A changed source
   returns `409`; mismatched descriptions and obsolete payloads return `400`.

The resource URLs remain the same, but the former request/response shapes are
removed. There are no separate preparation describe/check methods or generic
`plans` field. The player submits a source-only check; future preparation callers
select an output context through this same exchange.

Reports are client capability evidence, not authority to access files or submit
processing parameters. They are never persisted or shared between clients. The
frontend keeps at most 64 successful configuration reports in memory and clears
that cache on recheck or actual playback failure. A query times out after three
seconds; navigation cancels pending work. The complete frontend check has a
30-second limit. Inspection unavailable/busy errors return a safe `503` while
original media delivery remains usable.

## Source descriptions

FFprobe supplies codec, profile, level, pixel format, component depth, HDR signals,
resolution, frame rate, bitrate, sample rate and channels. Content signatures identify
containers; extensions never establish compatibility. Default video/audio streams
are preferred, followed by the first candidate; cover-art streams are excluded and
video-only files are valid.

Selected H.264, HEVC, AAC and AV1 streams receive a second, bounded initialization
probe. AVC constraint bytes, HEVC configuration fields, AAC object types and AV1
configuration records produce codec descriptors. Initialization output is capped at
256 KiB and five seconds per stream; failure leaves the descriptor unknown rather
than breaking subtitle discovery. Embedded font attachments are never dumped.
VP8, basic 8-bit VP9 profile 0, Opus, Vorbis, MP3, AC-3 and E-AC-3 have explicit
family descriptors. Detailed VP9 profiles and unrecognized configurations remain
unknown; legacy WebM VP8/VP9 descriptors are not reused as MP4 descriptors.

Source-only inspection queries the original container and selected original streams.
It does not propose hypothetical MP4/WebM packaging. When an output profile is
explicitly selected, queries additionally cover copied streams in that container
and the four concrete copy/encode combinations. The bounded set has at most 16
entries. Exact encoded descriptors currently cover libx264/yuv420p High Level 5.1
and AAC-LC; missing encoded descriptors remain unknown. CRF bitrate is not invented.

## Decisions and execution

Every decision is `supported`, `unsupported`, or `unknown`, with a reason.
The result includes direct playback, container and source-stream decisions plus
optional output-copy and output-combination acceptance. It returns no generic
operation recommendations, raw evidence, private paths or encoding parameters.
File and Media Source output evidence are distinct and cannot be interchanged.

`MediaCompatibilityApplication` owns inspection, evidence validation and browser
acceptance. The pure `resolveExecutionPlan()` applies the selected profile policy
to an immutable checked snapshot and chooses explicit copy/encode operations.
Without an output context, an unsupported original resolves blocked. The processing
application checks server capabilities and validates actual output. Negotiation
does not enumerate tools or certify muxing, execution or browser playback.

Multiple audio/video tracks make native selection uncertain. HDR presentation
remains unverified and HDR conversion is blocked by the execution resolver.
`smooth: false` warns about performance without forcing conversion. Subtitle
compatibility remains independent of audio/video processing.

## Internal server media capabilities

`MediaTools.capabilities()` returns the complete advertised FFmpeg build inventory
through a backend-only API. There is no server-capability HTTP endpoint or browser
contract. It includes FFmpeg/FFprobe availability and version, a detection
timestamp, and twelve lists: codecs, encoders, decoders, muxers, demuxers, filters,
bitstream filters, protocols, devices, pixel formats, sample formats, and hardware
acceleration methods. Entries retain names, descriptions, FFmpeg flags, codec
identities and stream kinds where applicable. Comma-separated format/device
aliases are expanded into separate names; protocols retain input/output direction.

Each list reports `ready`, `failed`, `unavailable`, or `unknown`. A ready empty
list confirms absence; a failed/unknown list does not. The aggregate status is
`ready`, `partial`, `failed`, `unavailable`, or `unknown`. `ready` means all FFmpeg
lists were enumerated; FFprobe availability is reported separately.

Enumeration starts on the first internal capability request, shares concurrent
requests, and caches successful and failed categories for the service lifetime.
Restart after replacing binaries or fixing detection failures. Returned snapshots
are isolated from the cache. The media-tool policy permits two enumeration children
at a time, with a five-second timeout and 1 MiB output bound per command.

This is a build inventory (`scope: build`, `runtimeValidation: unverified`).
Hardware components may be compiled in without accessible hardware or suitable
drivers. Listing an encoder does not establish successful encoding, acceptable
speed, codec/container combinations, or playback of a particular source. Runtime
sample validation and real-time HLS execution remain separate work.

## Player behavior

The player waits for checking. A supported original is loaded automatically,
with a **Playback compatibility info** button below the player to open the result
dialog. Unknown, unsupported and failed checks automatically open the dialog and
offer **Try original file** and **Check again**. The dialog can be dismissed and
reopened with the information button. Trying the original file closes the dialog.
Details show original container and stream decisions. Runtime playback
errors reopen the dialog, retain accessibility rechecks, display actual failure
separately, and invalidate cached capability reports. Known video sources with zero decoded
video dimensions report a missing-picture error even if the browser plays audio
without raising a standard media error. No automatic conversion/fallback loop
runs. Playback-progress recovery with the same source version does not unload an
already mounted video.

## Verification

Automated coverage includes codec descriptors, all processing branches, absent
metadata/audio, multiple tracks/cover art, HDR guards, independent output contexts,
source-only queries, fingerprint-bound HTTP negotiation, obsolete payload rejection,
stale source versions,
server-inventory isolation and removal of its HTTP endpoint, browser API failures,
query timeout/cancellation, explicit original-file attempts, runtime failure,
navigation and playback-progress regressions.

Browser reports are not playback certification. Linux desktop Chromium/Chrome
remains the first release acceptance target. Record real browser/OS/tool versions
and representative source codecs before certifying it. Synthetic media checks on
another development platform do not replace that acceptance, or checks against
the user's real library. Preparation and HLS execution acceptance remain separate.

### Development sample check (2026-10-04)

The production frontend build was exercised in the Codex in-app browser on macOS
27.0.1 with FFmpeg/FFprobe 9.0.2. Its Chromium build number was not obtained;
this is a development smoke check, not release certification. An isolated temporary
library and data directory were used.

- Generated H.264 High/yuv420p plus AAC LC MP4: exact descriptors
  `avc1.64001e` and `mp4a.40.2`; browser reported support. Actual playback reached
  the eight-second end with decoded dimensions 640 × 360 and no media error.
- The same streams in MKV: browser reported support and playback started. This
  demonstrates why a hard-coded unsupported-MKV rule would be incorrect.
- FFV1 plus AAC MKV: unknown descriptor and explicit original-file attempt.
  The browser exposed playable audio with zero video dimensions and no standard
  media error. The added missing-picture check displayed explicit failure feedback.

Synthetic fixtures do not certify sound audibility, HDR presentation, prepared output,
all codec combinations, Linux behavior, or the user's actual library.
