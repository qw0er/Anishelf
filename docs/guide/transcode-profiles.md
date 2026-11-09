# Transcode Profiles

Transcode profiles describe completed-file encoding. They do not select resources
or audio tracks: manual preparation and automatic preparation presets own those
choices. Built-in and administrator-authored profiles use the same v2 schema,
planner and FFmpeg compiler.

## Configuration and activation

Copy the [example](../examples/transcode-profiles-example.yaml) to
`<dataDir>/transcode-profiles.yaml`. Only `version: 2` is accepted. The application
never rewrites this file. Restart Backend after editing this file or
`auto-preparation-presets.yaml`. Both files are read at startup, with preset
references checked against the loaded transcode profiles. There is no automatic
file watcher or manual reload command.

Missing files use built-ins. Invalid files at startup report an issue and retain
built-ins. A saved
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

Copying is decided separately for video and each retained audio track. Two paths
can avoid encoding:

1. **Compatibility copying:** `copyCompatibleStreams: true` preserves a stream
   supported by browser evidence (manual preparation) or the automatic preset,
   when packaging and required transformations allow it. The encoding codec can
   differ because it is only the fallback for this path.
2. **Target matching:** independently of that switch and browser evidence, copy a
   stream already matching the target codec and every explicitly declared output
   constraint. Missing optional constraints impose no restriction; unknown source
   values for declared constraints require encoding.

Target codec is always compared, including when inferred from the encoder. Video
compares only explicitly supplied `pixelFormat`, `maxWidth`, `maxHeight` and
`maxFrameRate`; audio compares explicit `channels` and `sampleRate`. Bounds allow
smaller dimensions/frame rates; they do not require exact equality. No defaults
are inserted for omitted structural fields.

Both paths require a supported target container and no necessary transformation.
A user filter always requires encoding. The entire `options` mapping applies only
when encoding, including `profile`, `level`, `crf`, `preset`, `tune`, `b` and private
encoder parameters. These options do not constrain copying. For example, AAC 128k
can be copied with `options.b: 192k`, and H.264 Main can be copied with encoding
fallback options `profile: high` and `level: 5.1`. Copying preserves the source
profile, level and bitrate. To require processing even when formats match, specify
the actual transformation/filter.

An MKV containing matching H.264 and AAC can therefore be remuxed into MP4 even
with `copyCompatibleStreams: false` and unknown/rejected browser evidence. Only
nonmatching tracks are encoded. Automatic preparation additionally requires each
copied stream to satisfy `preset.accept`. Rejected or unknown acceptance falls back
to encoding; for example, an AAC LC acceptance rule requires encoding an HE-AAC
source even when the target codec is AAC. Forced copying blocks instead of falling
back. Known conflicts with the encoded output still block planning, and actual
output must pass acceptance again before publication. Browser support is checked
separately against the finished asset, not certified by target matching.

`encoder: copy` requires copying and rejects encoding parameters, filters or
transformations on that stream. It checks packaging and any explicit codec
constraint without requiring browser evidence; an impossible copy blocks the plan.

The global compatibility/fast preparation mode has been removed. Legacy
`preparationMode` settings are ignored and removed on the next settings write.
Built-ins disable compatibility copying, but still copy matching target streams.
Their encoding parameters, used only when encoding is needed, are:

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
Backend restart refreshes the relevant information. Failed option queries retry after the
existing tool-detection cooldown.

- `GET /api/transcode-profiles`: display metadata, active `revision`, per-profile
  `validation`, saved selection, availability and latest loading issue.
- `PUT /api/transcode-profiles/selection`: `{ profileId }`; use `null` for the default.

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

Set `copyCompatibleStreams` deliberately: it controls compatibility-based copying
without a global mode. Target-matching copying remains available when it is false. Restart Backend after updating both profile files and their
references. No automatic v1 file migration is performed.
