# Future Desktop and Mobile Client Design

This is a proposed design for the future requirements in [Desktop and Other
Clients](../requirements.md#27-desktop-and-other-clients), not a description of
implemented functionality or a committed release schedule. Desktop and mobile have
separate hosts and playback integrations while sharing business behavior and the
existing React interface where practical. A TV application is out of scope.

## Shared application available today

Use [the Web entry](../../apps/web/src/main.tsx) as the reference host. It calls
`initializeClient` with a server connection, build information, changelog,
`ClientPlatform` implementation and navigation callbacks. Once initialization
completes, the host creates a router from `createClientRoutes()` and mounts
`ClientApp` with that router. Import `@anishelf/client-ui/styles.css` through
the host's build pipeline. The public entry and stylesheet are the supported
imports for application hosts.

There is one active client runtime per renderer. Dispose it before initializing
another connection and recreate the router with the new runtime. Disposal
cancels requests and playback and clears the session and query cache. The host
owns the authentication transition. Web keeps same-origin cookies and CSRF,
and reloads the page on login, logout or session loss. Connecting a native host
to a remote server still requires a client authentication adapter, a native
transport, and authenticated media delivery.

Implement clipboard access, downloads, external links, preference storage and
lifecycle events at the host boundary. React DOM layout and the current Movi
player remain in the shared renderer. The Web host also owns service worker
registration and browser build configuration.

## Device session API

Device sign-in and bearer requests require HTTPS through the deployment's
trusted proxy. Use the native HTTP transport without browser session cookies.
Web login and its CSRF flow remain available separately.
The server applies the same login limits across both entry points.

| Method and path | Behavior |
| --- | --- |
| `POST /api/auth/device-sessions` | Send `{ name, password }`. Returns `201` with the bearer token and device metadata. |
| `GET /api/auth/device-sessions/current` | Return the authenticated device's metadata. |
| `DELETE /api/auth/device-sessions/current` | Revoke the calling device. |
| `GET /api/auth/device-sessions` | List active devices. Accepts a browser session or a bearer token. |
| `DELETE /api/auth/device-sessions/:id` | Revoke one device. Browser callers must supply CSRF. |

Send `Authorization: Bearer <token>` on device API requests. A token lasts 30
days and is bound to the current server password. Changing or resetting the
password invalidates all device sessions. Store the token per server in the
host's credential storage. On expiry or revocation, discard it and sign in
again. Never put it in a URL or a log.

Bearer authentication also works for protected media requests when the caller
can send the header, including byte range requests. The existing browser
endpoint for issuing original-media links remains restricted to browser
sessions. A renderer or native player that cannot attach a header still needs
a separate media delivery strategy.

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
