# Video compatibility checks

Compatibility checking is implemented independently of media preparation. It combines
version-bound source inspection with reports from the current browser and returns
explainable decisions for the original file, prepared MP4, and an MSE/fMP4 delivery
candidate. It never starts FFmpeg conversion or an external player.

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

Short codec-family queries for proposed H.264/AAC output are preliminary checks.
The actual CRF-generated bitrate, profile/level and packaging must be probed after
processing; no ungenerated output is certified playable.

## Decisions and recommendations

Every decision is `supported`, `unsupported`, or `unknown`, with a reason. Native
file, MP4 and MSE results are separate. Audio/video copying is recommended only
when the target query is supported and the codec belongs to the explicitly modeled
MP4 packaging candidates. Other combinations remain unknown rather than being
silently re-encoded. The candidates are not a muxing certification: completed
output still requires validation.

| Evidence | Recommendation |
| --- | --- |
| Original combination supported | Direct playback; no processing required |
| Original rejected, target audio/video supported | Remux with both streams copied |
| Target audio rejected, video supported | Encode audio only |
| Target video rejected, audio supported | Encode video only |
| Both target streams rejected | Encode audio and video |
| Required target information missing | Unknown; permit an explicit original-file attempt |

The response contains selected stream descriptions, separate original stream
results, per-target copy/encode actions, output-codec evidence, performance hints,
and service capability inventory. FFmpeg's MP4 muxer, libx264 and AAC encoder are
queried once per service lifetime. Missing inventory is unknown; missing required
capabilities block the recommendation. Binary availability alone proves nothing
about encoders. HDR encoding is blocked by the current profile. MSE/HLS execution
is unavailable until its delivery adapter is implemented. Other preparation plans
remain unverified and are not yet connected to HTTP processing or the player.

Multiple audio/video tracks make native track selection uncertain. HDR display
behavior is also unverified, even when a codec query succeeds. `smooth: false`
warns about performance without forcing conversion. Subtitle compatibility remains
independent and never forces audio/video encoding.

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
metadata/audio, multiple tracks/cover art, HDR, rejected output codecs, unavailable
encoders, safe HTTP negotiation, stale source versions, browser API failures,
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
