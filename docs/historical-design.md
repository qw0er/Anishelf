# Anishelf Version Details and Historical Designs

The [current requirements](current-version-requirements.md) and [current design](current-version-design.md) contain the V2 plan. This page links historical records.

| Version record | Status and use |
| --- | --- |
| [V1 requirements](history/v1-requirements.md) | Historical release scope and acceptance criteria restored from `45962af` |
| [V1 design](history/v1-design.md) | Historical technical design restored from `45962af` |
| [V1 deferred requirements](history/v1-future-requirements.md) | Historical roadmap restored from the same release commit |
| [Superseded V2 bridge proposal](#superseded-v2-bridge-proposal) | Historical unimplemented alternative; outside the current scope |

Completed-version bodies and superseded proposals are historical reference and do not imply current support.

## V1 Source Snapshot

The previous release is identified by commit `45962af7675ff904c5b62c00dafea9d104d01422` (`Bump version`). Each V1 document is restored from that commit into its own file:

| Archived file | Original Git path |
| --- | --- |
| [V1 requirements](history/v1-requirements.md) | `docs/current-version-requirements.md` |
| [V1 design](history/v1-design.md) | `docs/current-version-design.md` |
| [V1 deferred requirements](history/v1-future-requirements.md) | `docs/future-requirements.md` |

Historical wording, exclusions, acceptance proposals and status statements describe the source commit. Later acceptance reports do not rewrite this snapshot. Only archive-relative links and source provenance are added. Current scope and status are maintained in the overview documents.

## Superseded V2 Bridge Proposal

This unimplemented proposal previously made a paired bridge the local-launch mechanism. It is retained for reference only; V2 now only generates/copies a transferable original-media URL; browser invocation is deferred. Pairing, polling, IPC observation and bridge routes are deferred.

Use a small user-started Node.js bridge on Linux with a locally configured absolute mpv executable. The bridge initiates authenticated short polling to the application via the configured loopback origin (including an SSH-forwarded origin); it opens no browser-facing listening port. This avoids browser local-network/CORS dependencies and keeps the server from trying to launch a desktop process remotely.

Pairing flow: the bridge requests a short-lived one-time code, displays it locally, and the user enters it in Settings. The UI shows the pending bridge and requires explicit pairing. Codes expire after five minutes, are rate-limited, and are consumed once. The bridge receives a random credential after pairing; store only its hash on the server and a user-private credential file locally. Permit one paired bridge. Disconnect revokes it and clears pending launches. Reject incorrect Host/Origin on browser mutations; credential-based bridge routes are separate and expose no general command execution.

Every two seconds the paired bridge polls for launch work and reports availability/capabilities. Consider it unavailable after ten seconds without contact. **Open in local player** validates current resource access and creates a request with a 30-second expiry, opaque request ID, source version, and server-generated relative original-media route. The bridge combines this route with its locally configured, paired origin; it never accepts a browser-supplied absolute URL. Validate route shape, disallow redirects to other origins, and recheck source version before dispatch. Credentials travel in authorization headers to the coordinator and never in media URLs or logs.

The bridge durably records a launch request ID before spawning, so retries cannot launch it twice. An uncertain crash after that record requires an explicit new user launch rather than automatic replay. Use a fixed executable and validated argument array, no shell, no user-provided options or playlists, and a private mpv IPC socket. Restrict mpv configuration/scripts and media protocols to the supported loopback HTTP workflow. mpv's [official embedding guidance](https://mpv.io/manual/stable/) recommends structured IPC rather than parsing terminal output; its IPC must remain private.

Expose `requested`, `accepted`, `started`, `failed`, and `expired` launch feedback. Acknowledgement means accepted only. Use mpv IPC loading/initial playback events and bounded startup timeout to distinguish process creation from media start; propagate inaccessible media or missing executable failures. Actual audio/video and seeking still require manual acceptance. This narrow startup observation does not implement desktop progress tracking or remote controls. Launching locally leaves Web history unchanged and does not transfer saved position or external subtitles. Web playback stays usable if pairing or launch fails.
