# Transcode Profiles

Transcode profiles describe completed-file encoding. They do not select resources
or audio tracks: manual preparation and automatic preparation presets own those
choices. Built-in and administrator-authored profiles use the same v2 schema,
planner and FFmpeg compiler.

## Configuration and activation

Copy the [example](../examples/transcode-profiles-example.yaml) to
`<dataDir>/transcode-profiles.yaml`. Only `version: 2` is accepted. The application
never rewrites this file. Choose **Reload profiles** in Settings → Playback to
activate changes without restarting Backend. This command also reloads
`auto-preparation-presets.yaml`, checking references before replacing either catalog.
There is no automatic file watcher.

Missing files use built-ins. Invalid files at startup report an issue and retain
built-ins; a failed reload retains the entire last valid configuration. A saved
missing profile ID remains selected and unavailable until an existing profile is
selected. Already queued/running tasks retain their execution snapshots; completed
copies remain available after profile changes or removal.

## File structure

```yaml
version: 2
profiles:
  - id: custom:hevc-quality
    name: HEVC Quality
    description: High-quality 10-bit HEVC copy.
    container: mp4
    copyCompatibleStreams: false
    video:
      encoder: libx265
      codec: hevc
      pixelFormat: yuv420p10le
      maxHeight: 1080
      options:
        preset: slow
        crf: 20
        tune: animation
        x265-params: "aq-mode=3:psy-rd=2.0"
      filters:
        - "hqdn3d=1.5:1.5:6:6"
    audio:
      encoder: aac
      codec: aac
      channels: 2
      sampleRate: 48000
      options:
        b: 192k
    muxerOptions:
      movflags: "+faststart"
```

The file accepts at most 100 custom profiles; `profiles: []` is valid. IDs are
unique `custom:` identifiers with a lowercase letter followed by up to 63 lowercase
letters, digits or hyphens. Built-ins cannot be overridden. Names and descriptions
must be nonblank and at most 240 characters. Unknown structure fields, duplicate
mapping keys/IDs, multiple YAML documents and unsupported versions are rejected.

| Field | Contract |
| --- | --- |
| `container` | Required: `mp4`, `webm`, `matroska`, or `mov` |
| `copyCompatibleStreams` | Optional boolean; default `false` |
| `globalOptions` | Optional FFmpeg global option mapping |
| `inputOptions` | Optional input decoder/demuxer option mapping, before `-i` |
| `video` / `audio` | Required stream encoding descriptions |
| `muxerOptions` | Optional output muxer option mapping |

Every stream requires `encoder`, an open FFmpeg encoder name or `copy`. `codec` is
the expected FFprobe codec, not an encoder parameter. Omit it only when the running
FFmpeg inventory can reliably infer it; otherwise provide it explicitly.

| Stream fields | Contract |
| --- | --- |
| Video `pixelFormat` | Optional output pixel format; omission leaves encoder selection unknown |
| Video `maxWidth` / `maxHeight` | Optional even integer 2–8192; never upscale |
| Video `maxFrameRate` | Optional positive ceiling, at most 1000 fps |
| Audio `channels` | Optional target channel count 1–64; omission requests no downmix |
| Audio `sampleRate` | Optional target sample rate 1–768000 Hz |
| `options` | Optional parameter mapping using original FFmpeg names without `-` |
| `filters` | Optional ordered list, one single-input/single-output filter per entry |

Option values are strings, finite numbers, or `null` for a valueless flag. Quote
boolean-looking values as strings or use `0`/`1`; YAML booleans are not accepted.
Mappings retain authored order; use private option values such as `x265-params`
as a string. Duplicate option names are rejected rather than silently overwritten.
Video/audio options are automatically scoped to the corresponding output stream.
There is no hard-coded list of supported encoders or encoder quality parameters.

Input/output paths, stream mapping, progress, cancellation, limits, codec selection,
filters and structural output controls belong to the application. Options cannot
replace those controls (`i`, `map`, `c`, `f`, `progress`, `fs`, `vf`, `af`,
`pix_fmt`, `ac`, `ar`, `s`, `r`, etc.). Specify them through their structural fields;
conflicting declarations are rejected. Ordinary encoding settings such as `profile`,
`level`, `maxrate`, `bufsize`, `cpu-used`, and hardware quality settings belong in
`options` and are interpreted by FFmpeg.

## Filters and output facts

User filters run first, then application size/frame-rate or channel/sample-rate
constraints, followed by the final pixel format constraint. Use filter argument
quoting/escaping for literal separators. Embedded graphs, labels, additional inputs,
source/sink filters and timeline editing such as `trim`, `setpts`, `atempo`, `movie`
and `concat` are unsupported. Multi-pass jobs and arbitrary multi-input graphs are
outside this contract.

Custom filters can make output geometry and color characteristics unknown before
execution. Unknown browser compatibility does not prevent manual preparation.
Publication checks the actual FFprobe output, explicit output constraints, retained
tracks, duration and automatic-preset acceptance. Playback then negotiates the
actual completed asset with the client. Successful encoding is not a browser
playability guarantee. No configuration declaration certifies HDR-to-SDR conversion;
there is no automatically inserted tone mapping.

## Copying and built-ins

`encoder: copy` requires copying and rejects encoding parameters, filters or
transformations on that stream. If the stream cannot be copied, planning fails with
an explicit reason. `copyCompatibleStreams: true` permits opportunistic per-stream
copying when packaging, compatibility and required transformations allow it;
otherwise the named encoder is used. A user filter always requires encoding.

The global compatibility/fast preparation mode has been removed. Legacy
`preparationMode` settings are ignored and removed on the next settings write.
Built-ins encode by default:

| ID | Container | Video | Audio |
| --- | --- | --- | --- |
| `builtin:balanced` | MP4 | libx264, CRF 23, medium, High/5.1, yuv420p | AAC LC, 192k |
| `builtin:fast` | MP4 | libx264, CRF 23, veryfast, High/5.1, yuv420p | AAC LC, 192k |
| `builtin:efficient` | WebM | libvpx-vp9, CRF 32, cpu-used 4, b 0, yuv420p | Opus, 128k |
| `builtin:compact` | WebM | libvpx-vp9, CRF 32, cpu-used 2, b 0, yuv420p | Opus, 128k |

`defaultTranscodeProfileId` remains in `settings.json`, defaulting to
`builtin:balanced`. Cache budgets remain separate from encoding profiles.

## Runtime validation and API

Backend inspects the installed FFmpeg inventory and common, encoder and muxer help.
The catalog reports `recognized`, `unsupported`, or `unverified`, with field-level
issues. Recognized means advertised syntax, not a tested hardware/parameter
combination. Missing help, unknown options and private subparameters remain
unverified and may be tried; confirmed missing components or wrong scopes are
unsupported and cannot be newly selected. Actual execution remains authoritative.
Detection is cached by tool identity, concurrent requests share pending work, and
reload refreshes the relevant information. Failed option queries retry after the
existing tool-detection cooldown.

- `GET /api/transcode-profiles`: display metadata, active `revision`, per-profile
  `validation`, saved selection, availability and latest loading issue.
- `PUT /api/transcode-profiles/selection`: `{ profileId }`; use `null` for the default.
- `POST /api/transcode-profiles/reload`: `{ applied, catalog, issues }`. Expected
  configuration/read failures return `applied: false` with the previous catalog.

Task identity covers effective options, their order, filters, constraints and the
compiler version. Renaming a profile does not itself require another output.
Versioned complete execution snapshots use the existing database `extended_snapshot`
column; legacy relational projections remain version 1 and legacy records remain
readable. Restart still interrupts unfinished jobs rather than resuming a command.

## Migrating a v1 file

Change `version` to `2`, remove `usage`, and move encoder-specific fields into
`options`. Rename `cpuUsed` to `cpu-used`; express `bitrateKbps: 192` as `b: 192k`;
express `maxBitrateKbps` with explicit `maxrate` and `bufsize`; move `profile`,
`level` and `compressionLevel` into options (`compression_level` for the latter).
Replace `channels: stereo` with `channels: 2`; omit `channels: preserve` and replace
`channelCount` with `channels`. Video bounds and `sampleRate` remain structural.

Set `copyCompatibleStreams` deliberately: it now controls copying directly without
a separate global mode. Reload both profile files together after updating their
references. No automatic v1 file migration is performed.
