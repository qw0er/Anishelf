# Video compatibility checks

Compatibility checking is implemented independently of media preparation. It combines
version-bound source inspection with reports from the current browser and returns
explainable decisions for the original file and operation-only recommendations
for file and Media Source playback. It never starts FFmpeg conversion or an external player.

## Inspection and negotiation

1. `GET /api/files/:id/compatibility` resolves a confined library source and uses the
   shared inspection cache. It returns the source version, selected media streams,
   detected container, and bounded browser queries. Paths, tags, raw initialization
   data, and FFmpeg commands are not exposed.
2. The browser checks file queries with `canPlayType`, MSE queries with
   `MediaSource.isTypeSupported`, and complete configurations with
   `MediaCapabilities.decodingInfo`. Missing dimensions, bitrate, or frame rate are
   never filled with invented defaults. Container-only queries remain probabilistic.
3. `POST /api/files/:id/compatibility` accepts the source version and up to 16 query
   reports. The server validates query IDs, duplicates and status/reason consistency,
   regenerates the query descriptions, and revalidates the original source/root
   before returning a decision. A changed source returns `409`.

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

The browser queries only the unchanged source streams. MP4 and WebM MIME types
are evidence candidates for file and Media Source delivery, not output selections.
Each delivery type checks video, audio (if present), and their combination. No
hypothetical H.264/AAC output, bitrate, pixel format, profile or level is invented.
The bounded query set contains at most 16 entries.

## Decisions and recommendations

Every decision is `supported`, `unsupported`, or `unknown`, with a reason. The
original file and the two delivery types (`file`, `media-source`) are evaluated
separately. The compatibility contract uses `rulesVersion: "2"`.

| Evidence | Recommendation |
| --- | --- |
| Original combination supported | Direct playback; no processing required |
| Original rejected, unchanged streams and their combination accepted in another packaging candidate | Remux with both streams copied |
| Audio rejected in all evidence candidates, video accepted | Encode audio only |
| Video rejected in all evidence candidates, audio accepted | Encode video only |
| Both streams rejected in all evidence candidates | Encode audio and video |
| Missing or uncertain evidence | Unknown; permit an explicit original-file attempt |
| Streams individually accepted, combined packaging unconfirmed | Unknown; do not certify remuxing |

An accepted candidate establishes browser evidence for retaining a stream. A
stream is rejected only when all its candidates are rejected; otherwise it remains
unknown. No codec whitelist forces accepted source streams into a fixed MP4
profile. Candidate and combined-query acceptance still do not certify muxing or
actual playback.

Plans contain only the delivery type, mode, source-stream compatibility decisions,
`copy`/`encode`/`none`/`unknown` actions and reasons. They do not select a container,
output codec, encoder, encoding profile or parameters, and do not report server
inventory, hypothetical output compatibility, or executor availability. Selected
source descriptors remain in the response as input information. Planning neither
enumerates server tools nor depends on installed encoders. A future executor must
choose output packaging/codecs/encoders, check server and client capabilities for
that concrete choice, and validate the generated output before serving it.

Multiple audio/video tracks make native track selection uncertain. HDR display
behavior is unverified even when a codec query succeeds. HDR encoding may be
recommended when the source is rejected; the future executor decides whether it
can implement that recommendation. The existing explicit MP4 primitive still
rejects HDR encoding. `smooth: false` warns about performance without forcing
conversion. Subtitle compatibility remains independent of audio/video planning.

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
Details show container, stream and target-delivery decisions. Runtime playback
errors reopen the dialog, retain accessibility rechecks, display actual failure
separately, and invalidate cached capability reports. Known video sources with zero decoded
video dimensions report a missing-picture error even if the browser plays audio
without raising a standard media error. No automatic conversion/fallback loop
runs. Playback-progress recovery with the same source version does not unload an
already mounted video.

## Verification

Automated coverage includes codec descriptors, all processing branches, absent
metadata/audio, multiple tracks/cover art, HDR recommendations, independent
delivery evidence, source-only queries, safe HTTP negotiation, stale source versions,
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
