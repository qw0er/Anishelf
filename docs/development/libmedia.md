# libmedia integration

Anishelf uses `@libmedia/avplayer-ui` 1.3.1, with no Vidstack or JASSUB fallback.
The published ESM distribution already contains its compiled TypeScript runtime;
Vite does not compile upstream source or merge its webpack chunks.

## Reproducible assets

`node scripts/libmedia-assets.mjs` runs before Web development/build. It copies the
npm-lockfile-verified player chunks, cheap polyfill and LGPL license into the ignored
`web/public/libmedia/1.3.1` directory. A module-script loader imports the unmodified
ESM entry so Vite's development transforms do not intercept upstream chunks.

Decoder/resampler/stretch resources come from upstream commit
`a5c817679b1a0f825330350121560ecbe6128c37` (v1.3.1). Each asset is checked against
`scripts/libmedia-assets.json` before reuse or download. TLS and SHA-256 verification
remain enabled for every source. Build-time downloads use raw.githubusercontent.com,
with the GitHub Contents API (api.github.com) as a fallback when the raw download
fails or does not match the pinned hash. Downloads log the asset and source, and
downloads use Node’s built-in `fetch` with up to four concurrent workers. Each
attempt has a 120-second timeout covering both headers and body. Network errors
and transient HTTP failures are retried up to twice, with a one-second delay.
No system `curl` executable is required. Playback
fetches only same-origin versioned resources. Deploy the entire generated directory.

Only playback resources are shipped: H.264, HEVC, AV1, VP8/9, AAC, MP3, Opus,
Vorbis, FLAC, AC3/EAC3, DTS and PCM decoders, resampling and pitch-preserving speed
processing. Encoding/transcoding tools, wasm64 and unrelated codecs are excluded.
Baseline Wasm is the conservative default. No cross-origin-isolation headers are
added; SharedArrayBuffer is not a prerequisite. WebCodecs/native acceleration is
used when available, with client software fallback. Device performance still limits
high-resolution/high-bitrate playback; server manual copies remain available.

The optional non-shared Worker pipeline is disabled for 1.3.1: its subtitle renderer
receives packet pointers belonging to a different heap, causing invalid timestamps.
Decoding therefore uses the main-thread pipeline on this deployment. This increases
main-thread work and should be revisited when upgrading upstream, with real ASS and
sidecar fixtures. Subtitle decoder callbacks return no Wasm URL because the renderer
uses the player JavaScript chunks.

Font attachments are registered with the browser FontFace API before playback.
The adapter reads the pinned cheap runtime's main heap through codec metadata and
uses fontname to resolve internal family names, rather than guessing from filenames.
It bounds registrations to 32 attachments and 32 MiB, skips malformed fonts, and
removes registered faces on teardown. Recheck this version-specific heap access on
every upstream upgrade. No font or subtitle extraction service is involved.

Sidecars are fetched through version-bound authenticated content URLs and passed to
the player as Files with their declared subtitle extension. The extension is required
by upstream's text-format detector. The selected stream is resolved by its global ID:
external subtitles can reuse a local stream index already used by the main media.

To update, pin the npm UI version, update the matching upstream asset revision and
reviewed SHA-256 manifest, then run a clean install/build and real-browser checks.
Never update expected hashes merely to bypass a mismatch.

## Licenses and browser behavior

libmedia/UI is LGPL-3.0-or-later; its underlying decoder and utility licenses must
accompany redistribution. The bundled license and upstream source are available at
https://github.com/zhaohappy/libmedia/tree/a5c817679b1a0f825330350121560ecbe6128c37.
No GPL x264/x265 encoding Wasm is distributed. Server FFmpeg retains its existing
packaging/licenses.

UI controls remain upstream-owned. The app supplies a responsive shell, its version
selector, preparation commands and viewing/continuation controls. The loading
implementation log is hidden; actual failures use application notifications.
Test both wide and narrow screens. Client subtitle rendering is not certified for
every ASS effect, bitmap codec, HDR display or device merely by library support.

Upstream 1.3.1 may omit an already-active embedded subtitle after seeking into its
display interval; subsequent subtitle events render normally. This is an upstream
renderer/demuxer limitation, not a server compatibility decision. Do not claim full
subtitle fidelity or bitmap-subtitle support from the successful ASS smoke check.

## Verification

Run `node --test scripts/libmedia-download.test.mjs` to check primary downloads,
API fallback, transient retries, checksum rejection, retry limits and concurrency
without contacting upstream servers.

Chromium smoke checks cover authenticated MKV/AC3 playback, ASS text rendering,
embedded TTF registration, sidecar ASS rendering, two audio streams, seeking and Range responses. The full
application check verifies pause saves, reload/resume and natural-end persistence
in milliseconds, with no compatibility, extraction or automatic-preparation requests.
FFmpeg integration tests verify retained subtitles, attachments, chapters and
dispositions, and reject incomplete output. Unit tests cover font bounds/cleanup,
resume/play ordering, replay from completed history and source-to-player audio identity.

These checks do not certify Safari, Firefox, mobile hardware, HDR, all ASS effects
or every decoder. Test those environments before making broader compatibility claims.
