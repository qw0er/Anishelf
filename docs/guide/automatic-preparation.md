# Automatic preparation

Automatic preparation creates completed playback copies in the background without
requiring a browser to remain connected. Enable it and choose a preset under
Settings → Playback. It is disabled by default. Existing resources are included:
checks run at startup, after resource publications and settings changes, and every
six hours. Transient failures use persisted backoff from one minute to six hours.

The two settings are top-level fields in `<dataDir>/settings.json`:

```json
{
  "autoPreparationEnabled": false,
  "autoPreparationPresetId": "builtin:web"
}
```

## Built-in presets

| ID | Accepted media | Encoding profile |
| --- | --- | --- |
| `builtin:web` | MP4/WebM; H.264 or VP9, 8-bit or 10-bit YUV 4:2:0 SDR; unrestricted audio formats | `builtin:balanced` |
| `builtin:web-conservative` | MP4; H.264 Baseline/Constrained Baseline/Main/High, yuv420p SDR; AAC LC | `builtin:balanced` |

Both retain all audio tracks and accept all resources and viewing states. Neither
limits resolution, frame rate, channel count or sample rate. These are preparation
policies, not device capability certificates. Actual playback still checks the
client and selects among the original and available copies.

## Custom presets

Copy the [example](../examples/auto-preparation-presets-example.yaml) to
`<dataDir>/auto-preparation-presets.yaml`. Use Reload profiles in Settings after editing. Transcode profiles and these presets are validated and activated together. The file is
optional; missing files use built-ins. Invalid files fall back to built-ins and
show an issue in Settings. Saved missing preset IDs remain selected and pause
work rather than silently selecting a different policy.

The file contains `version: 1` and an optional `presets` list. Each preset requires
a unique `custom:` ID, a nonblank name and an existing `transcodeProfileId`.
`description`, `match`, `audio` and `accept` are optional. Unknown fields,
duplicate IDs/mapping keys, multiple YAML documents and invalid values are rejected.

`match.rootIds` selects opaque resource root IDs. `include` and `exclude` use Node
Glob matching against root-relative paths with `/` separators; exclusions win.
Empty lists impose no restriction. `viewingStates` accepts `unwatched`,
`in-progress`, and `completed`. These describe current source-version file progress,
not a work's Tracking status. No viewing record means unwatched; completion uses
the existing playback completion ratio (90% by default). A viewing lookup failure
defers the resource rather than assuming it is unwatched.

`audio.selection` defaults to `all`; alternatives are `default`, `languages` and
`none`. Language selection retains all tracks matching the nonempty `languages`
list, preserving source order. Match language tags case-insensitively using the
file's language codes. No match uses `fallback: default`, `all` or `skip`. Default
selection falls back to the first audio track. A video without audio remains valid.

`accept.containers`, `accept.video` and `accept.audio` are optional. Empty lists
impose no restriction. Video/audio entries are alternative candidates, with every
constraint inside one candidate required. `codecs` supports multiple codecs.
`profiles` and `maxLevel` require a single explicit codec because their meanings
are codec-specific. Profile names are normalized to lowercase with hyphens, such
as `constrained-baseline`, `high-10`, `main-10`, `lc`, and VP9 `0`.

Video candidates support `codecs`, `pixelFormats`, `profiles`, `maxLevel`,
`maxWidth`, `maxHeight`, `maxFrameRate`, `maxBitrateKbps`, and `dynamicRanges`
(`sdr`, `hdr10`, `hlg`). Audio candidates support `codecs`, `profiles`,
`maxChannels`, `sampleRates` in Hz, and `maxBitrateKbps`. Scalar constraints may be
omitted or null. Unknown facts needed by a constraint defer preparation. Untagged
conventional 8-bit video is treated as SDR; untagged high-bit-depth video is uncertain.

## Encoding, retention and recovery

`transcodeProfileId` references [transcode-profiles.yaml](transcode-profiles.md).
Acceptance never overrides encoding settings. Configure output transformations in
the encoding profile. Video adds optional `maxWidth`, `maxFrameRate`, `profile`,
`level`, and `maxBitrateKbps`; audio adds optional `channelCount`, `sampleRate`, and
`profile: lc` for AAC. Existing `maxHeight` and `channels: preserve | stereo` remain
available. Explicit channelCount cannot contradict stereo. Profile selection is
supported for libx264, libx265 and libvpx-vp9; level selection for libx264/libx265.
Unsupported encoder options are rejected. Hardware availability is checked at runtime.

Suitable originals and existing copies are reused. Otherwise, streams are copied
individually when accepted, allowed by the profile and supported by the output
container; other streams are encoded. Audio format acceptance does not imply
container support. A single copy may therefore contain both copied and encoded
audio tracks. Output order, languages and default audio flags are retained.
Actual FFprobe output must satisfy the execution plan and acceptance before publication.
HDR-to-SDR conversion is blocked because no validated tone-mapping policy exists.
Explicitly accepted HDR can be copied when packaging allows it.

Manual tasks have priority in the single worker queue. Switching presets or
disabling automation cancels queued automatic-only tasks, allows active work to
finish and retains completed copies. User cancellation or artifact deletion does
not suppress future automation: a subsequent eligible check can recreate it.
Incomplete automatic work is reevaluated after restart; completed output survives.
Cache and disk budgets remain enforced, with no automatic eviction of valid copies.

## Managing prepared copies

Open **Files → Prepared copies** to see generated copies, their source paths,
profiles, retained audio-track counts, sizes, generation times and availability.
Search filenames or paths, filter availability, and sort newest or largest first.
Click a filename to see its full source path and generation time. Use **Select**
to show checkboxes and batch commands; **Done** hides them and clears selection.
The list shows 50 copies per page; selection applies only to the current page and
clears when you change search, filtering, sorting or page.

The summary shows all copies in the current resource scope and the configured
cache budget, regardless of filters. When total budget usage differs, an additional
line includes other retained artifacts and invalidated files still held by readers.
Temporary conversion output is not part of the inventory.

Use **Play** for an available copy or **Show original** to open its location in
Files. Unknown availability requires playback/source inspection before it can be
confirmed; opening this management view does not probe or delete media.

Use **Delete copy** or **Delete selected** and review the count and estimated space.
Original media, history and settings are preserved. Copies in use or involved in
active preparation cannot be removed until that work finishes. A batch can partially
succeed: a toast reports the result and space totals refresh after cleanup. Success
notifications expire; failure notifications show per-copy reasons and a retry action
until dismissed. Filesystem failures retain the copy record for another attempt. Lowering
the budget never silently removes valid copies. Automatic preparation may recreate
a deleted copy if its source remains eligible.
