# Internal media execution

Compatibility negotiation reports browser acceptance for original media and, when
an output profile is explicitly selected, its concrete output candidates. The execution
resolver applies that profile's policy and constructs concrete encoding requirements;
the FFmpeg adapter compiles arguments. The [preparation owner](preparation.md)
now exposes persistent tasks and completed-media HTTP delivery. Player integration
and real-time HLS remain separate work.

`MediaCompatibilityApplication` owns browser negotiation for both original media
and profile-selected output candidates. `resolveExecutionPlan()` is a pure resolver
that applies profile policy to checked compatibility conclusions and produces an
explicit `MediaExecutionRequest`. `MediaProcessingApplication` rechecks the source,
preflights FFmpeg requirements and executes the request through
`FfmpegExecutionAdapter`. There is no separate execution-planning Application.

`createMediaExecutionModule()` composes the compatibility and processing
applications from configuration, inspected sources and discovered tools. It is an
internal factory used by the production bootstrap for preparation HTTP workflows.
The player still uses the original-media path.
The GET/POST compatibility routes use the same unified exchange with rules version 3;
the former request shapes and generic operation recommendations have been removed.

The preparation exchange has three steps:

1. `compatibility.inspect({ fileId, sourceVersion, output })` returns a
   source/root-bound `descriptionId`, selected streams and browser queries.
   `output: null` checks only the original media. An explicit
   `{ profileId, target }` adds the profile fingerprint and concrete copy/encode
   candidates in that profile's container. `file` and `media-source` use distinct
   evidence. Missing profiles fail explicitly; no substitute is selected.
2. `compatibility.check({ fileId, sourceVersion, descriptionId, output, evidence })`
   rebuilds the description, verifies its fingerprint and validates evidence,
   then rechecks source freshness. It returns an immutable checked snapshot with
   original decisions and optional output-combination acceptance, plus private
   source-root and profile data. The HTTP presenter exposes only public conclusions;
   internal snapshots must not be serialized directly. Unknown or incomplete
   descriptors remain unknown even if the client reports support. No generic
   processing plan or raw evidence is returned.
3. `resolveExecutionPlan(checked)` synchronously applies size/stereo/forced-encoding
   policy and maps compatible streams to copy or required encoding. It requires
   support for the chosen combination and returns `direct`, `blocked` or
   `processing` with per-stream reasons and an immutable request. It performs no
   source access, browser negotiation, profile lookup or server capability checks.
   `processing.start(request)` owns server preflight, immediately before execution.
   A source-only check can resolve direct; otherwise an output context is required.
   Missing/unknown inventory rejects completion with the detailed capability error;
   a resolved plan alone does not establish that the server can execute it.

The profile-content fingerprint covers delivery and encoding policy, independent
of JSON key order and display metadata. The execution ID additionally includes
compiler version, canonical source root, source version, selected streams and
operations. The description ID also binds browser queries and the current root
epoch. These identities support future deduplication; they do not persist tasks.

Encoded browser descriptors currently cover `libx264`/`yuv420p` High Level 5.1
(`avc1.640033`) and AAC-LC (`mp4a.40.2`). The adapter explicitly applies those
profile/level choices, and publication validates the H.264 descriptor. Dimensions
and frame rate must be known and fit the H.264 level when encoding. CRF output
bitrate is unknown, so it is not fabricated for MediaCapabilities. Other typed
profiles can copy supported streams, but required encodings without an exact
implemented output descriptor remain blocked. HDR conversion is also blocked.
Browser reports are evidence, not playback certification.

The production adapter compiles all declared encoder-specific parameter variants
for trusted explicit callers. It maps only selected absolute stream indexes,
omits subtitles/attachments/chapters, uses local file/pipe protocols, preserves
copied streams, and emits fast-start MP4/MOV for file delivery or fragmented
MP4 for MSE delivery. The latter is still a completed private artifact: incremental
segment publication, HLS sessions and real-time profiles are separate future work.
Encoding filters are generated from typed policy: downscale only when necessary, pad odd dimensions, convert pixel
format and declare implicit video/audio conversion dependencies for preflight.
It accepts no arbitrary administrator argument strings or filter graphs.
`null` audio selection produces video-only output.

A planner-driven caller can execute the resulting request:

```ts
const output = { profileId: selectedProfileId, target: "file" } as const;
const description = await compatibility.inspect({ fileId, sourceVersion, output });
const evidence = await queryClientCapabilities(description.queries);
const checked = await compatibility.check({
  fileId,
  sourceVersion,
  descriptionId: description.descriptionId,
  output,
  evidence,
});
const result = resolveExecutionPlan(checked);
if (result.kind === "processing") {
  const handle = processing.start(result.request);
  const media = await handle.completion;
  await processing.release(media.id);
}
```

Trusted internal callers may still supply an explicit execution contract directly:

```ts
const execution = processing.start({
  fileId,
  sourceVersion,
  plan: explicitlySelectedPlan,
  videoStreamIndex: selectedVideoIndex,
  audioStreamIndex: selectedAudioIndexOrNull,
  onEvent(event) {
    // Backend telemetry: state changes and child/progress events.
  },
});
const result = await execution.completion;
// result.id === execution.id; result.path is private backend storage.
await processing.release(result.id);
```

The request's plan is cloned before asynchronous work. A caller can read
`execution.state` or subscribe to `onEvent`. States are `checking`, `starting`,
`running`, `validating`, `ready`, `failed`, and `cancelled`. `ready` requires valid
output, atomic publication and source-version revalidation. Child closure is not
artifact readiness. Errors reject the completion promise. Observer exceptions
are isolated. `await execution.stop()` waits for termination and cleanup;
completion still rejects when cancelled. A result already completed remains
owned until `release()`. Preparation adopts published bytes through its own cache
link before releasing execution ownership. Closing the processor stops active
work and releases its temporary outputs; it does not delete adopted prepared copies.

Progress includes media time, frames, output bytes, encoding speed, percentage
and the FFmpeg end marker. Unreported fields are `null`. Percentage is present
only with a positive inspected duration; it is bounded to 100 and is not a
readiness signal. Stdout is consumed record by record; stderr retains a bounded
diagnostic tail. Startup timeout, stall, overall timeout, cancellation, spawn
failure, nonzero exit and malformed/oversized progress have distinct reasons.
Stall detection requires media time, frames or bytes to advance, rather than
just receiving another heartbeat. Defaults are 30 seconds startup, 90 seconds
stall, two seconds termination grace and six hours overall per operation.

Execution checks reuse `MediaTools.capabilities()`'s lifetime cache. The pure
`checkExecutionCapabilities()` helper returns each requirement and an aggregate
`supported`, `missing` or `unknown` result. Failed enumeration remains unknown.
Copied streams do not require encoders or decoders; unselected audio is ignored.
Demuxer aliases are alternatives. File protocol input and output directions and pipe protocol output for
progress are required. Encoded streams check the caller-selected encoder and
optional pixel format. Filters are checked exactly as declared by the adapter,
including any implicit conversion filters it requires. There are no assumed
padding, scaling or tone-mapping choices.
Failures throw `MediaExecutionCapabilityError` with the detailed check, using
`CAPABILITY_MISSING` or `CAPABILITY_UNKNOWN`. No check chooses a substitute.

The injected adapter receives the confined input, private output path, selected
indexes, cloned plan, abort signal, timeout, output budget and progress observer.
It must enforce those limits and settle only after child closure. The generic
`startMediaProcess()` helper is available for implementing that lifecycle; it
accepts arguments supplied by a trusted backend adapter and selects no encoders.
Application validation independently probes output, checks packaging and selected
stream codecs/counts, enforces size and duration bounds, and revalidates the source.
The declared FFmpeg muxer and expected FFprobe format alias are separate
fields (`container` and `outputFormat`); they need not have the same name.
Runtime policy contains only concurrency, deadlines, storage and validation bounds.
Pending and published files have neutral `media.pending` and `media` names.

Build support cannot establish codec/container combinations, hardware availability
or real output validity. Adapters must check child exit; the application checks file size, stream
counts, codecs, container, pixel format, configured height/channel constraints,
exact planned H.264 descriptor and available video/audio durations. Results are source-version-bound temporary artifacts.
The [playback planning foundation](playback-planning.md) now consumes the public
compatibility API and this resolver through `PlaybackApplication.plan()`. It
returns a read-only proposal without creating history or acquiring output.
The [preparation owner](preparation.md) adds persistent jobs, restart recovery,
a bounded queue, polled progress and reusable completed-media HTTP delivery.
The Web file page and task screen integrate explicit prepared playback; automatic
playback selection and real-time HLS remain future integrations.


## Verification

The real-FFmpeg test generates a short H.264/AAC Matroska sample and executes
remux, audio-only encoding, video-only encoding and both-stream encoding. It
compares compressed packet SHA-256 hashes for copied streams, probes completed
outputs, exercises output-budget rejection and confirms cancellation waits for
child exit. It also probes fragmented MP4 and verifies copied video packet hashes.
The test skips when FFmpeg/FFprobe are unavailable; synthetic browser
evidence drives branch selection and does not establish actual browser playback.
Compatibility/resolver tests cover direct/blocked results, profile constraints,
changed policy, source/selection handling, shared evidence validation and immutable
snapshots. Processing tests cover server capability failures.
