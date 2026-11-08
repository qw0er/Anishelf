# Transcode Profiles

Transcode profiles describe how completed-file preparation encodes video and audio
into a reusable Web copy. They control the output container and stream encoders;
they do not decide which files are prepared, when preparation runs, or which copy a
browser plays.

Use the [commented example](../examples/transcode-profiles-example.yaml) as a
copy-ready template. This guide explains the file contract, built-ins, validation and
selection behavior.

## Built-in profiles

| ID | Container | Video | Audio |
| --- | --- | --- | --- |
| `builtin:balanced` (default) | MP4 | H.264 (`libx264`), CRF 23, `medium` | AAC, 192 kbit/s |
| `builtin:fast` | MP4 | H.264 (`libx264`), CRF 23, `veryfast` | AAC, 192 kbit/s |
| `builtin:efficient` | WebM | VP9 (`libvpx-vp9`), CRF 32, `cpuUsed` 4 | Opus, 128 kbit/s |
| `builtin:compact` | WebM | VP9 (`libvpx-vp9`), CRF 32, `cpuUsed` 2 | Opus, 128 kbit/s |

All built-ins target `yuv420p`, preserve the source channel layout, and allow
compatible stream copying. They are preparation-only profiles. Built-ins cannot be
overridden, but they can be selected or left unused.

## File location and loading

1. Copy the example to `<dataDir>/transcode-profiles.yaml`.
2. Edit the profile list.
3. Restart Backend to load the file.

| Situation | Behavior |
| --- | --- |
| No custom file | Built-in profiles remain available |
| Invalid or unreadable file | Log the configuration issue, show it in Settings, and continue with built-ins only |
| Valid file | Built-ins are listed first, followed by custom profiles in file order |
| File edited | Changes apply only after a Backend restart |

The file is an immutable startup snapshot. The application never creates or rewrites
it, and there is no profile-path override. The legacy `transcode-profiles.json` name
is no longer read; convert existing JSON content to YAML.

## Quick start

```yaml
version: 1
profiles:
  - id: custom:small
    name: Small Web copy
    description: Limit encoded video to 720p for a smaller Web copy.
    usage: preparation
    container: mp4
    copyCompatibleStreams: true
    video:
      encoder: libx264
      codec: h264
      pixelFormat: yuv420p
      crf: 25
      preset: medium
      maxHeight: 720
    audio:
      encoder: aac
      codec: aac
      bitrateKbps: 128
      channels: stereo
```

A file with `profiles: []` is valid and simply leaves only the built-ins. The file
accepts at most 100 custom profiles.

## File fields

All profile fields are required except the optional video controls listed below. No
defaults are inserted for omitted fields.

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | Integer, required | Must be `1` |
| `profiles` | Array, required | At most 100 custom profiles; empty is valid |
| `profiles[].id` | String, required | Unique `custom:` ID followed by a lowercase letter and up to 63 lowercase letters, digits or hyphens |
| `profiles[].name` | String, required | Nonblank display name, 1–240 characters |
| `profiles[].description` | String, required | Nonblank description, 1–240 characters |
| `profiles[].usage` | String, required | Must be `preparation` |
| `profiles[].container` | String, required | `mp4`, `webm`, `matroska` or `mov` |
| `profiles[].copyCompatibleStreams` | Boolean, required | Allow stream copying when preparation mode and packaging permit it |
| `profiles[].video` | Object, required | One video encoder variant, described below |
| `profiles[].audio` | Object, required | One audio encoder variant, described below |

Unknown fields, duplicate profile IDs, unsupported versions and invalid YAML are
rejected. Custom IDs cannot replace built-ins. Raw FFmpeg arguments are not accepted;
encoder behavior is limited to the typed options below.

## Video encoders

The `encoder` and `codec` values must form one of the matching pairs in this table.
Encoder-specific parameters are required for that pair; parameters from another
encoder family are rejected.

| Encoder | Codec | Required encoder-specific fields |
| --- | --- | --- |
| `libx264` | `h264` | Integer `crf` 0–51; string `preset` |
| `libx265` | `hevc` | Integer `crf` 0–51; string `preset` |
| `libsvtav1` | `av1` | Integer `crf` 0–63; integer `preset` 0–13 |
| `libaom-av1` | `av1` | Integer `crf` 0–63; integer `cpuUsed` 0–8 |
| `libvpx-vp9` | `vp9` | Integer `crf` 0–63; integer `cpuUsed` 0–5 |
| `h264_nvenc` | `h264` | Integer `bitrateKbps` 1–1,000,000 |
| `hevc_nvenc` | `hevc` | Integer `bitrateKbps` 1–1,000,000 |
| `av1_nvenc` | `av1` | Integer `bitrateKbps` 1–1,000,000 |
| `h264_qsv` | `h264` | Integer `bitrateKbps` 1–1,000,000 |
| `hevc_qsv` | `hevc` | Integer `bitrateKbps` 1–1,000,000 |
| `av1_qsv` | `av1` | Integer `bitrateKbps` 1–1,000,000 |
| `h264_videotoolbox` | `h264` | Integer `bitrateKbps` 1–1,000,000 |
| `hevc_videotoolbox` | `hevc` | Integer `bitrateKbps` 1–1,000,000 |

`pixelFormat` is required for every variant. It uses an FFmpeg identifier such as
`yuv420p`, `yuv420p10le`, `nv12` or `p010le`: a lowercase letter followed by up to
63 lowercase letters, digits or underscores. The syntax check does not certify that
the selected encoder or hardware supports that pixel format.

x264/x265 `preset` values are `ultrafast`, `superfast`, `veryfast`, `faster`, `fast`,
`medium`, `slow`, `slower` and `veryslow`. SVT-AV1 uses an integer preset; VP9 and
AOM use `cpuUsed`. Hardware variants currently expose bitrate control only, so
software CRF and preset options are rejected for them. CRF values and `cpuUsed`
ranges are codec-specific and are not comparable across encoders.

### Optional video controls

| Field | Values | Constraint |
| --- | --- | --- |
| `maxHeight` | Even integer 2–8192 | Height ceiling; output is never upscaled |
| `maxWidth` | Even integer 2–8192 | Width ceiling; output is never upscaled |
| `maxFrameRate` | Positive number up to 1000 | Frame-rate ceiling |
| `maxBitrateKbps` | Integer 1–1,000,000 | Encoder VBV limit with a 2× buffer |
| `profile` | Encoder-specific | `libx264`: `baseline`, `main`, `high`, `high10`, `high422`, `high444`; `libx265`: `main`, `main10`, `mainstillpicture`; `libvpx-vp9`: `0`–`3` as strings |
| `level` | Numeric string | `libx264` and `libx265` only |

Profile names must already be lowercase. A profile or pixel-format combination that
the installed encoder cannot produce is rejected at runtime, not by YAML validation.

## Audio encoders

Every audio variant requires a matching `encoder`/`codec` pair and
`channels: preserve | stereo`.

| Encoder | Codec | Required encoder-specific fields |
| --- | --- | --- |
| `aac` | `aac` | Integer `bitrateKbps` 32–512 |
| `libopus` | `opus` | Integer `bitrateKbps` 6–510 |
| `libvorbis` | `vorbis` | Integer `bitrateKbps` 32–500 |
| `flac` | `flac` | Integer `compressionLevel` 0–12 |
| `alac` | `alac` | None |
| `pcm_s16le` | `pcm_s16le` | None |

Lossless variants do not accept bitrate fields. Optional audio controls are:

| Field | Values | Constraint |
| --- | --- | --- |
| `channelCount` | Integer 1–64 | Cannot conflict with `channels: stereo`; `stereo` implies 2 channels |
| `sampleRate` | Integer 1–768000 Hz | Validated against the actual output |
| `profile` | `lc` | AAC only |

`channels: preserve` keeps the source layout for each encoded track;
`channels: stereo` downmixes encoded audio to two channels.

## Selection and preparation mode

Selection is stored separately in `<dataDir>/settings.json`, not in the profile file.

| Setting | Default | Effect |
| --- | --- | --- |
| `defaultTranscodeProfileId` | `builtin:balanced` | Profile used by new manual and automatic preparation requests |
| `preparationMode` | `compatible` | `compatible` encodes both video and audio when preparation is needed; `fast` permits copying compatible streams when the profile's `copyCompatibleStreams` is true and packaging/client checks pass |
| `transcodeCacheBudgetGiB` | 10 GiB | Prepared-media cache budget; not a profile parameter |

A playable original still uses direct playback. Mode and profile changes affect new
preparation requests only; existing tasks and completed copies are unchanged. If a
saved custom profile disappears, its ID is preserved and
`selectionAvailable` becomes `false` until an available profile is selected.

`copyCompatibleStreams` is a permission, not a guarantee. Copying also requires
compatible packaging, client evidence and no required size or channel
transformation. Compatibility mode does not bypass the profile's audio encoding.

## Validation and runtime limits

Schema validation certifies declaration shape only. It does not verify installed
FFmpeg encoders, hardware or drivers, pixel-format support, container/encoder
combinations, HDR handling or browser playback. Runtime planning, preflight and
output validation may still reject a structurally valid profile or fail a task.

| Limitation | Behavior |
| --- | --- |
| Missing encoder or hardware | Task fails during preflight or execution |
| Unsupported container/stream combination | Streams are encoded instead of copied, or the task fails |
| HDR source | HDR-to-SDR tone mapping is blocked; accepted HDR can be copied when packaging allows it |
| Existing prepared copy | Reused when eligible; profiles are not re-applied to completed files |
| Profile content changed | New preparation identity through a fingerprint that excludes display metadata; existing copies remain playable |

## API and diagnostics

`GET /api/transcode-profiles` returns display metadata: profile ID, name,
description, container, video/audio encoder, source and usage, plus
`selectedProfileId`, `preparationMode` and `selectionAvailable`. Full encoding options
are intentionally omitted.

`PUT /api/transcode-profiles/selection` accepts `profileId` (an existing ID, or
`null` to reset to the default) and an optional `preparationMode`. Unknown IDs are
rejected. Profiles are immutable startup snapshots, so encoding-policy changes
require a new file and a restart.

Use Diagnostics for configuration and media-tool failures. See
[Configuration](operations.md#preparation-modes) for preparation settings,
[Automatic preparation](automatic-preparation.md) for preset-based background work,
and [Prepared copies](automatic-preparation.md#managing-prepared-copies) for
inventory and cleanup.
