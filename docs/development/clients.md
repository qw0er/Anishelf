# Future Desktop and Mobile Client Design

This is a proposed design for the future requirements in [Desktop and Other
Clients](../requirements.md#27-desktop-and-other-clients), not a description of
implemented functionality or a committed release schedule. Desktop and mobile have
separate hosts and playback integrations while sharing business behavior and the
existing React interface where practical. A TV application is out of scope.

## Responsibilities

| Component | Proposed responsibility |
| --- | --- |
| Server | Existing Fastify business services, media access, library, acquisition and playback/history APIs |
| Shared Web UI | Library, detail, search, history and settings, adapted for desktop and touch layouts |
| Desktop | Full application with a managed local server or a connection to a remote server |
| Mobile | Remote-server client; no bundled server required |
| Player adapter | Translate common playback commands and events to the active Web or native player |

Keep host-specific APIs behind interfaces so React pages and server contracts do not
rely directly on a particular desktop or mobile framework. Player adapters should
cover media selection, play/pause, seeking, tracks, subtitles, position, completion
and errors, while exposing unsupported capabilities explicitly. Existing APIs and
browser-oriented playback assumptions need review before they can support native
clients; this document does not assume those interfaces already exist.

## Desktop

The preferred starting point is Electron with the existing React UI and Fastify
backend. Package the backend as a separately managed process for local operation,
and allow the user to select a remote server instead. Local operation needs a
platform-appropriate data directory, database and native dependency packaging,
FFmpeg availability, startup readiness, shutdown and recovery. Test packaging on
Windows, macOS and Linux before claiming support.

Start with the existing Web player. A later native playback integration should
first evaluate mpv in a separate window, including commands, events, subtitles,
track selection and progress reporting. If an embedded native video view becomes
necessary, prototype composition and controls before choosing an integration;
Qt WebEngine with libmpv remains an alternative worth evaluating. Changing hosts
would still require rewriting host-specific process, window and packaging code.

## Mobile

The preferred starting point is Capacitor with the React UI in a WebView, connecting
to a remote server. Begin by validating the existing Web player on real Android and
iOS devices. For native playback, use a platform bridge and a separate full-screen
player view. Evaluate Android Media3/ExoPlayer and iOS AVPlayer first; evaluate
LibVLC and MobileVLCKit if real media tests show insufficient compatibility.
Existing player plugins should be assessed against the required events, track and
subtitle behavior, maintenance and licensing before adoption. Picture-in-picture,
background playback and offline viewing remain optional later work.

## Playback and server integration

Clients should report or otherwise establish actual player capabilities and prefer
original media when feasible. Where a compatible prepared version exists, offer it
when needed; remuxing or conversion should preserve streams where possible. Network
limits, runtime failures and unsupported subtitles can change the appropriate choice.
Do not assume every native player can decode a particular codec, render styled ASS
subtitles or use every server preparation path. More granular conversion and
network-aware selection require separate design and implementation; current
full-file preparation does not imply adaptive streaming or playback during conversion.

Design authenticated media and subtitle access for native players explicitly:
WebView cookies cannot be assumed to transfer to a native engine. Preserve access
control, HTTPS, range requests, source identity and expiry across player requests;
avoid exposing credentials in player arguments or logs. Define lifecycle and error
handling for cancellation, expired authentication, player exit and server changes.
Log useful lifecycle and failure events without media URLs, tokens or other secrets.

Progress events must use shared playback semantics, including resume, end and track
changes. Design ordering, duplicate handling and concurrent updates before claiming
cross-client synchronization (W06); an external player that cannot report state
cannot provide automatic progress synchronization. Refresh the UI after native
playback and handle interrupted sessions without treating an unconfirmed position as
confirmed server state.

## Proposed stages and validation

1. Deliver desktop local and remote operation with Web playback; validate lifecycle,
   packaging, authentication and real media across the three desktop platforms.
2. Deliver mobile remote connection and Web playback; validate touch layouts,
   authentication, lifecycle and real media on Android and iOS.
3. Add desktop mpv and mobile native playback independently, after validating
   authentication, range requests, subtitle and audio tracks, seeking, errors,
   background transitions and progress reporting with representative media.
4. Design cross-client conflict handling and continuation, then consider optional
   system integration and offline viewing as separately scoped work.

The ordering is a proposal rather than a release commitment. Test original and
prepared media, MKV, multiple audio tracks, external and embedded subtitles, styled
ASS fonts, network interruption and authentication expiry on actual devices. Record
observed limitations per platform and player; successful Web playback does not prove
native playback compatibility.
