# Movi Player integration

Anishelf pins `movi-player` 0.4.1 and uses its built-in player controls and subtitle
renderer. The application retains resource selection, viewing progress, continuation,
manual preparation and external-player actions. The public integration is documented
in [Movi's element reference](https://moviplayer.com/docs/api/element); the pinned
npm package's types and implementation define the actual supported behavior.

## Local runtime assets

The slim element is loaded lazily from the npm package. Vite resolves the exported
`movi-player/movi.wasm` with `?url`, emits a hashed same-origin asset and supplies
its URL through `wasmurl`. Development and production use the same installed npm
artifact. No resource download script, CDN loader, global constructor or copied
numbered JavaScript chunks are involved. After `npm ci`, development startup and
build do not download additional playback resources.

The large engine JavaScript chunks are named with the `movi-player-` prefix and
excluded from the PWA shell precache. The WASM is also outside the shell precache;
playback loads these resources only when needed. Deploy the complete Web build.
Offline page-shell availability does not imply offline media playback.

No cross-origin-isolation headers are added. The application does not enable
Movi's own history resume, playlist or automatic continuation. Existing Anishelf
sessions and source-time mappings remain the source of truth.

## Adapter and lifecycle

Movi's clock uses seconds. `PlaybackClock` converts positions and duration to
milliseconds and maps the core's state/seek events to the existing session events.
Initial restoration finishes before playback begins, including playback initiated
by built-in controls. A completed history entry replays from the start.

Audio selection uses numeric core track IDs and the asset inventory's source-index
mapping, rather than language helpers that cannot distinguish two same-language
tracks. Title and audio changes keep the existing resource binding and session.
Movi can replace its core on reload/recovery, so listeners and the clock are rebound
to the current core after loading; stale async work is cancelled on teardown.

Fullscreen remains application-owned through `movi-fullscreen-request` and
`setHostFullscreen`. The existing continuation portal stays in the application DOM
so its styles and controls remain usable in fullscreen. Unsupported native element
fullscreen uses a viewport-fill application shell. Chapter and subtitle menus are
provided by Movi.

## Subtitle limits

Embedded subtitles use Movi's built-in decoder and renderer. Its ASS/SSA support
does not preserve full styling, positioning, karaoke or embedded font attachments.
Anishelf deliberately does not add JASSUB or another renderer. Preserving font
attachments in original/prepared bytes is independent of browser rendering.

External VTT/SRT is supplied through Movi's native subtitle interface. The published
0.4.1 external-file interface does not parse ASS/SSA, so `ass-compiler` 0.1.16 parses
those tracks in the browser. Timed dialogue text is registered as generated Movi
cues; override tags, drawings and effects are discarded. Newlines and hard spaces
are retained, invalid/empty cues are skipped and subtitle text is treated as
untrusted text. Each sidecar receives an independent key, including tracks sharing
a language. Users can select a track or turn it off through the built-in menu.

Discovery and content requests retain same-origin authentication and video/subtitle
version fencing. A missing or malformed sidecar does not block video playback.
There is no server extraction, conversion or font-preparation endpoint.

## Licenses and validation

Movi's npm package declares Apache-2.0; `ass-compiler` declares MIT. The playback
WASM also contains third-party components, including FFmpeg. Their redistribution
terms and attribution still apply; the top-level Apache license does not establish
the license of every embedded component. Server FFmpeg retains its existing
packaging and license requirements.

Run `npm run check` and `npm run build`. Adapter tests cover clock conversion,
resume/play ordering, replay, audio identity, subtitle parsing and lifecycle
cleanup. Existing session, source-timeline, history and continuation tests remain
engine-independent regression coverage.

Real-browser acceptance must cover both Vite development and production builds:
authenticated MKV playback, Range reads/seeks, two audio tracks, embedded and sidecar
subtitles, chapters, pause/reload/resume, replay and natural-end persistence. Check
390 px and 1280 px layouts, keyboard access and fullscreen continuation controls.
Record actual browser/device results. A passing build or library format list does
not certify Safari, Firefox, mobile hardware, HDR, bitmap subtitles or every codec.

## Recorded smoke validation

On 2026-11-10, Chromium 156.0.8078.79 on Debian 13 exercised the actual Anishelf
`VideoPlayer`, CSS and i18n in a temporary Vite harness, using both development and
production builds. A generated 640x360 H.264 Matroska fixture contained two Japanese
AAC audio tracks and two chapters. Same-origin fixture delivery required an
authentication cookie and returned HTTP 206 for range requests; the packaged WASM
loaded from the same origin.

Playback advanced after restoring a 3-second position, selecting the second
same-language audio track retained numeric track identity, and a seek to 12 seconds
completed. External ASS dialogue rendered as two plain-text lines; external VTT
remained independently selectable. The chapter inventory retained both chapter
names/times. Screenshots at 1280 px and 390 px showed no page-width overflow, and
the application continuation control remained visible inside fullscreen. The
optional Google Fonts request from upstream is suppressed by the application.

An embedded ASS track with successive four-second cues rendered later cues after
track selection and seeking. A separate fixture with one cue spanning the whole
20-second file did not redisplay that cue when selecting it around a restored
position, including after seeking back to zero. This is an observed limitation of
the pinned built-in subtitle path; do not infer complete embedded-subtitle
continuity from the successful sidecar checks.

The production harness also used the real `usePlaybackSession` hook and mocked
auth/session HTTP storage. Pause saved a nonzero millisecond position; reloading
restored that saved position; natural end saved the full 20-second source duration
with `naturalEnd: true`; the built-in Play/Pause control replayed a completed entry
from zero. These checks exercise the frontend session code with real decoding,
not the backend's persistence or a full library/navigation workflow. Other codecs,
full embedded subtitle fidelity, Safari, Firefox, real mobile devices, HDR and
bitmap subtitles remain unverified by this smoke check.
