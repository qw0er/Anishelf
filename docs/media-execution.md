# Internal media execution

Compatibility planning describes whether source video/audio should be copied or
encoded. It never selects output profiles, encoders or FFmpeg arguments. Execution
is a separate backend API, with no new HTTP endpoint or player integration.

An execution caller supplies a source version, explicit stream indexes and a
`MediaProcessingPlan`. The current adapter supports the existing MP4 profile;
additional formats and hardware encoding require adapter implementation rather
than planner changes. `null` audio selection produces video-only output.

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
progress are required. Video encoding checks pixel format and pad/scale filters as needed.
Failures throw `MediaExecutionCapabilityError` with the detailed check, using
`CAPABILITY_MISSING` or `CAPABILITY_UNKNOWN`. No check chooses a substitute.

Build support cannot establish codec/container combinations, hardware availability
or real output validity. Execution still checks exit, file size, stream counts,
codecs and duration. Results are source-version-bound temporary artifacts.
Persistent jobs, restart recovery, scheduling, HTTP progress, pre-transcode
playback and real-time HLS remain future integrations.
