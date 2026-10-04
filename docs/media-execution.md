# Internal media execution

Compatibility planning describes whether source video/audio should be copied or
encoded. It never selects output profiles, encoders or FFmpeg arguments. Execution
is a separate backend API, with no new HTTP endpoint or player integration.

An execution caller supplies a source version, explicit stream indexes and a
`MediaProcessingPlan`. No production transcoding adapter or executable default target is
provided. The separate [profile foundation](transcode-profiles.md) defines built-in
and external output policies, but has not yet been connected to this execution API. Construction requires a caller-supplied `MediaExecutionAdapter` whose
`execute()` method implements the concrete encoding parameters and arguments.
The former fixed MP4/H.264/AAC adapter and mode-based `process()` API were removed.
Concrete adapters can be implemented later without changing the planner. `null` audio selection produces video-only output.

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
owned until `release()`. Closing the service stops active work and releases outputs.

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
counts, codecs, container and duration. Results are source-version-bound temporary artifacts.
Persistent jobs, restart recovery, scheduling, HTTP progress, pre-transcode
playback and real-time HLS remain future integrations.
