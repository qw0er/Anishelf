# Playback plans and resource ownership

This foundation defines decisions and resource references for P05–P07. The
production bootstrap injects the same compatibility Application into playback
planning and the compatibility HTTP routes. `PlaybackApplication.plan()` is an
internal, read-only use case consumed by the [preparation owner](preparation.md).
It does not create tasks, start FFmpeg, publish
files, acquire real-time sessions, or open a progress generation. The existing
HTTP session endpoint continues to open direct playback only.

## Planning contract

The caller first obtains a compatibility description through the existing
`inspect()` exchange and collects browser evidence. It passes the resulting
`CompatibilityCheckRequest` and `fileId` to `playback.plan()`.

Planning resolves the confined source, checks the evidence through
`MediaCompatibilityApi.check()`, verifies the checked source/root against the
resolved source, calls `resolveExecutionPlan()`, and revalidates the source and
root epoch after asynchronous work. It returns a deeply immutable result:

| Kind | Meaning |
| --- | --- |
| `playable` | Browser evidence accepts the original; a direct plan references the original HTTP media route |
| `blocked` | The selected output cannot be planned; the plan includes the resolver's reason |
| `processing-required` | The selected output requires work; includes delivery target, processing mode, per-stream reasons, derived identity, and a private execution request |

`processing-required` establishes neither server execution support nor an
available playback resource. Server preflight still belongs to processing.
`media-source` currently describes a fragmented MP4 candidate, not HLS acceptance
or a running stream. HLS packaging, negotiation and real-time execution require
separate integration. Automatic original/cache/real-time selection and saved
playback preferences are also later work.

The private planning result must never be serialized directly. It contains typed
encoder settings. HTTP callers continue to use the existing compatibility
contracts, which reject arbitrary processing arguments; no planning HTTP route
is introduced by this foundation.

## Playback resource contract

`PlaybackPlan` and the browser-safe `PlaybackPlanSchema` define five resource
references. They are distinct from planning intents:

| Mode | Required reference | Owner guarantees before returning it |
| --- | --- | --- |
| `direct` | Original media URL | Resource access authorizes the original on each media request |
| `prepared` | Artifact ID and media URL | Preparation has validated and atomically published the completed artifact |
| `preparing` | Task ID, without a media URL | Preparation has accepted an actual task; its status is queried separately |
| `realtime` | Session ID, media URL and segment generation | Real-time playback has acquired a session with playable published segments |
| `blocked` | Reason, without a media URL | There is no playable resource for this decision |

Only `direct` is currently returned by the playback session HTTP endpoint. Its
schema intentionally remains restricted to that implemented mode. The other
variants remain contracts for playback integration. Preparation tasks/artifacts
are implemented through their own API; real-time sessions are still planned. `PreparedPlaybackResource` and `RealtimePlaybackResource` carry
private source-bound identity for those integrations; they contain no local path.
Future HTTP presenters must explicitly project public references.

## Identity and ownership

| Resource | Responsibility | Lifetime and release |
| --- | --- | --- |
| Original source | Resource access owns confinement, version and root-epoch checks | Originals are read-only; every derived owner revalidates before use/publication |
| Compatibility snapshot | Compatibility owns source/profile/query-bound browser evidence | Client-specific; never persist it as universal browser support |
| Execution request | Processing owns preflight, child execution and full-file validation | Explicit one-run work; `stop()` waits for cleanup |
| Prepared task/artifact | Preparation owns deduplication, queueing, persistence, publication, retry, eviction and deletion | A playback borrower must not call processing `release()` to delete a reusable artifact |
| Real-time session | Real-time playback will own children, leases, segment generations and incomplete-output cleanup | Exit, expiry, seek replacement, source change and shutdown reclaim session resources |
| Playback history | Playback owns source registration, generation/sequence validation and durable progress | Releasing or deleting derived resources never deletes source history |

`DerivedMediaIdentity`, shared by planning and persistence, binds root ID, file ID, source version, profile-content
fingerprint, execution-plan ID and selected absolute stream indexes. The existing
execution-plan ID already incorporates the resolver version, canonical root,
source version, delivery target, profile fingerprint and copy/encode operations.
Display metadata does not invalidate output; encoding and delivery policy changes do.
This identity is a future deduplication/reuse key, not a task ID or artifact ID.
Cache lookup must also check publication, file availability and current client
compatibility. An identity match alone cannot establish playback readiness.

Durable progress remains keyed by the registered original source, regardless of
which artifact or session delivers the bytes. Progress positions and durations
are always source-time values. Real-time `sourceStartMs` describes the actual
source offset represented by the output; the future timeline adapter must also
account for output timestamps and keyframe alignment. It must not blindly add
that offset to a timeline that already preserves source timestamps.

A real-time segment generation changes when processing restarts, so old segments
and delayed responses can be rejected. It is independent of the playback history
generation, which protects durable progress writes. Switching a delivery resource
must not reset progress or silently create a new history generation.

## Verification and next integration

Planning tests exercise original/blocked/processing decisions, immutable identity,
source-root changes during awaited negotiation, and planning without a progress
repository. Contract tests reject URLs on pending tasks and private execution
fields. Existing playback tests verify that direct sessions and history retain
their behavior. These tests do not certify prepared or real-time browser playback.

The [preparation owner](preparation.md) now implements persistence and exposes
actual task/artifact references through its HTTP API. Prepared-player integration
and real-time sessions follow separately. Both must
enter through owning Applications and cross-module public APIs; neither HTTP
handlers nor compatibility negotiation may own FFmpeg children or asset files.
