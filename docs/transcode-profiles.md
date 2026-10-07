# Transcode profiles

The profile foundation provides a shared schema, four built-in preparation profiles,
optional administrator-authored profiles, a read-only catalog and a persistent user
selection. It does not certify browser playback or add a Settings selector yet. The internal
[compatibility negotiation, execution resolver and FFmpeg adapter](history.md#v2-internal-media-execution)
now translate selected profiles into explicit requests. The processing application
preflights server capabilities and validates completed output. [Persistent preparation tasks and cache delivery](history.md#v2-persistent-web-preparation) are implemented
in the backend; player integration and HLS remain planned.

## Built-in profiles

| ID | Display name | Format | Video settings | Audio bitrate |
| --- | --- | --- | --- | --- |
| `builtin:fast` | Fast | H.264 / AAC / MP4 | CRF 23, `veryfast` | 192 kbit/s |
| `builtin:balanced` | Balanced (default) | H.264 / AAC / MP4 | CRF 23, `medium` | 192 kbit/s |
| `builtin:efficient` | Efficient | VP9 / Opus / WebM | CRF 32, `cpuUsed: 4` | 128 kbit/s |
| `builtin:compact` | Compact | VP9 / Opus / WebM | CRF 32, `cpuUsed: 2` | 128 kbit/s |

All profiles are preparation-only, use `yuv420p`, preserve the original audio
channel count, allow compatible streams to be copied and impose no dimension
limit. H.264 uses `libx264`; VP9 uses `libvpx-vp9`; Opus uses `libopus`.
Fast prioritizes encoding speed. Efficient and Compact use the same VP9 CRF 32
and Opus 128 kbit/s settings, differing only in `cpuUsed` (4 and 2). Compact
prioritizes compression efficiency with slower video encoding. These policies do not guarantee
output size or speed, and CRF values are not comparable across codecs.

Copying must satisfy the selected profile's constraints, output packaging and
client compatibility together. The execution resolver encodes when a requested
size/channel transformation is necessary, even if the original stream can play.
`maxHeight` is a ceiling; it must not upscale smaller sources. `channels: "stereo"`
requests stereo output; `"preserve"` retains the selected source channel count.
If `copyCompatibleStreams` is false, the selected streams must be encoded.
Unverified compatibility must not be treated as permission to copy. HDR processing
and real-time HLS profiles are outside this foundation.

## External configuration

Create `transcode-profiles.json` directly in the application data directory.
There is no profile-path environment variable. The application does not create
this file or copy built-in definitions into it. A missing file means built-ins
only. Loading occurs at startup; restart after editing.

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "custom:small",
      "name": "Small Web copy",
      "description": "Limit encoded video to 720p for a smaller Web copy.",
      "usage": "preparation",
      "container": "mp4",
      "copyCompatibleStreams": true,
      "video": {
        "encoder": "libx264",
        "codec": "h264",
        "pixelFormat": "yuv420p",
        "crf": 25,
        "preset": "medium",
        "maxHeight": 720
      },
      "audio": {
        "encoder": "aac",
        "codec": "aac",
        "bitrateKbps": 128,
        "channels": "stereo"
      }
    }
  ]
}
```

Built-in and external definitions use `TranscodeProfileSchema`. Version 1 supports
MP4 (`mp4`), WebM (`webm`), Matroska (`matroska`) and QuickTime (`mov`) packaging
declarations. Existing H.264/AAC profiles keep their original structure.

External IDs must start with `custom:` followed by a lowercase letter and up to 63
lowercase letters, digits or hyphens. IDs must be unique; built-in profiles cannot
be overridden. Names and descriptions must contain non-whitespace text and have
at most 240 characters.

### Video encoder parameters

Every video variant declares `encoder`, its matching `codec`, `pixelFormat`, and
optionally `maxHeight`. Pixel formats are FFmpeg identifiers, such as `yuv420p`,
`yuv420p10le`, `nv12` or `p010le`; they are not restricted to 8-bit YUV 4:2:0.
Identifiers must start with a lowercase letter, followed by at most 63 lowercase
letters, digits or underscores. This syntax check does not certify that an encoder
supports that pixel format. `maxHeight` remains an even integer from 2 to 8192.

| Encoder | Codec | Required encoder-specific fields |
| --- | --- | --- |
| `libx264` | `h264` | Integer `crf` 0–51; string `preset` |
| `libx265` | `hevc` | Integer `crf` 0–51; string `preset` |
| `libsvtav1` | `av1` | Integer `crf` 0–63; integer `preset` 0–13 |
| `libaom-av1` | `av1` | Integer `crf` 0–63; integer `cpuUsed` 0–8 |
| `libvpx-vp9` | `vp9` | Integer `crf` 0–63; integer `cpuUsed` 0–5 |
| `h264_nvenc`, `hevc_nvenc`, `av1_nvenc` | `h264`, `hevc`, `av1`, respectively | Integer `bitrateKbps` 1–1,000,000 |
| `h264_qsv`, `hevc_qsv`, `av1_qsv` | `h264`, `hevc`, `av1`, respectively | Integer `bitrateKbps` 1–1,000,000 |
| `h264_videotoolbox`, `hevc_videotoolbox` | `h264`, `hevc`, respectively | Integer `bitrateKbps` 1–1,000,000 |

x264/x265 presets are `ultrafast`, `superfast`, `veryfast`, `faster`, `fast`,
`medium`, `slow`, `slower` or `veryslow`. VP9 uses the application's quality-mode
CPU speed subset, 0–5. Hardware variants currently expose bitrate control only;
software CRF/preset fields are rejected for them. New encoder families require
an explicit schema variant rather than arbitrary argument strings.

The parameters are based on [FFmpeg's encoder documentation](https://ffmpeg.org/ffmpeg-codecs.html).
Values are specific to the encoder: CRF values are not comparable across codecs,
and string x264 presets must not be reused for SVT-AV1.

### Audio encoder parameters

Every audio variant declares `encoder`, its matching `codec`, and `channels`
(`preserve` or `stereo`). Lossless variants do not accept lossy bitrate parameters.

| Encoder | Codec | Required encoder-specific fields |
| --- | --- | --- |
| `aac` | `aac` | Integer `bitrateKbps` 32–512 |
| `libopus` | `opus` | Integer `bitrateKbps` 6–510 |
| `libvorbis` | `vorbis` | Integer `bitrateKbps` 32–500 |
| `flac` | `flac` | Integer `compressionLevel` 0–12 |
| `alac` | `alac` | None |
| `pcm_s16le` | `pcm_s16le` | None |

For example, an AV1/Opus profile can use the same outer metadata as the first
example with these output fields:

```json
{
  "container": "webm",
  "video": {
    "encoder": "libsvtav1",
    "codec": "av1",
    "pixelFormat": "yuv420p10le",
    "crf": 35,
    "preset": 8,
    "maxHeight": 1080
  },
  "audio": {
    "encoder": "libopus",
    "codec": "opus",
    "bitrateKbps": 128,
    "channels": "stereo"
  }
}
```

This is an output-fields excerpt, not a complete profile file. A hardware HEVC
video declaration, for example, is:

```json
{
  "encoder": "hevc_videotoolbox",
  "codec": "hevc",
  "pixelFormat": "p010le",
  "bitrateKbps": 4000
}
```

### Validation boundaries

At most 100 custom profiles are accepted. Unknown properties, unsupported schema
versions, raw FFmpeg arguments, duplicate IDs, mismatched encoder/codec pairs and
invalid per-encoder parameters fail startup with `CONFIG_INVALID` diagnostics.
Unreadable files also fail startup. The loaded registry is immutable for the
lifetime of the configuration service.

Loading validates the application's supported declaration shapes, not the installed
FFmpeg build, device/driver availability, pixel-format support, container/stream
combinations, HDR handling or client decoding. It therefore accepts supported
hardware declarations on servers without that hardware. The compatibility application checks client evidence for concrete output
candidates. The pure execution resolver applies profile policy to those conclusions;
the processing application checks server requirements and validates actual output.
Encoded descriptors cover libx264/yuv420p High Level 5.1, libvpx-vp9/yuv420p VP9 and AAC-LC/Opus.
Other required encodings without an exact descriptor remain blocked, and hardware
execution is not certified. Catalog membership is never proof
that a profile can execute or play on the current client.

## Catalog and user selection

`GET /api/transcode-profiles` returns:

```json
{
  "profiles": [
    {
      "id": "builtin:balanced",
      "name": "Balanced",
      "description": "Prepare a Web copy with balanced encoding speed and size. Preserve compatible streams when possible.",
      "source": "builtin",
      "usage": "preparation"
    }
  ],
  "selectedProfileId": "builtin:balanced",
  "selectionAvailable": true
}
```

The example shows one catalog entry; a normal response includes all four built-ins and
all loaded custom profiles. Encoding parameters are never included. Here
`selectionAvailable` means the selected ID exists in the catalog, not that the
server or browser can execute or play it.

`PUT /api/transcode-profiles/selection` accepts only:

```json
{ "profileId": "custom:small" }
```

It returns the updated catalog after saving. Unknown IDs are rejected with
`INVALID_REQUEST`; arbitrary encoding fields are rejected by request validation.
This endpoint works before a resource directory is configured and preserves
existing settings. Send `{ "profileId": null }` to remove the explicit choice and
adopt the current built-in default, `builtin:balanced`.

`settings.json` stores only the optional `defaultTranscodeProfileId` alongside
existing user choices. Existing settings without this field adopt the default
without being rewritten. The settings GET/PUT contracts also support the optional
field; PUT continues to require a resource directory. Failed writes leave the
published settings and effective configuration unchanged.

If a saved custom profile disappears, preserve its ID and return
`selectionAvailable: false`. Unrelated settings saves preserve this choice. The
user can select another existing profile or reset to the default; the application
does not silently replace the missing choice. Profile-specific compatibility negotiation snapshots profile content and calculates a canonical policy
fingerprint, excluding display metadata. [Preparation](history.md#v2-persistent-web-preparation) now snapshots execution requests, persists tasks
and validates profile fingerprints for cache reuse. User-facing selection controls
remain separate integration work.
