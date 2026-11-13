# External players

Anishelf hands media to external players in two host-specific ways:

- **Web** saves URL templates and opens a custom-scheme URL. The target app must
  support that scheme.
- **Desktop** saves an executable and its arguments, then starts the process
  directly. No protocol handler is required.

Both use the original media URL with an expiring access token. External playback
never updates Anishelf progress or history.

## Web

In **Settings → External players**, add a name and URL template, then select the
entry from a file's **Open in external player** menu. Custom entries are saved in
the current browser and apply to this origin on every platform.

| Placeholder | Value |
| --- | --- |
| `{url}` | Complete original-media URL |
| `{urlEncoded}` | Complete media URL encoded with `encodeURIComponent` |
| `{mimeType}` | Video MIME type, or `video/*` |

Built-in entries depend on the detected client platform.

| OS | Player | Template |
| --- | --- | --- |
| macOS | [IINA](https://iina.io/) | `iina://open?url={urlEncoded}` |
| macOS, iOS/iPadOS | [Infuse](https://firecore.com/infuse) | `infuse://x-callback-url/play?url={urlEncoded}` |
| iOS/iPadOS | [VLC](https://www.videolan.org/vlc/download-ios.html) | `vlc-x-callback://x-callback-url/stream?url={urlEncoded}` |
| iOS/iPadOS | [Outplayer](https://apps.apple.com/app/outplayer/id1449923287) | `outplayer://x-callback-url/play?url={urlEncoded}` |
| Android | [VLC](https://www.videolan.org/vlc/download-android.html) | `intent:{url}#Intent;action=android.intent.action.VIEW;package=org.videolan.vlc;type={mimeType};end` |
| Android | [mpv-android](https://github.com/mpv-android/mpv-android/releases) | `intent:{url}#Intent;action=android.intent.action.VIEW;package=is.xyz.mpv;type={mimeType};end` |
| Android | [MX Player](https://play.google.com/store/apps/details?id=com.mxtech.videoplayer.ad) | `intent:{url}#Intent;action=android.intent.action.VIEW;package=com.mxtech.videoplayer.ad;type={mimeType};end` |
| Android | MX Player Pro | `intent:{url}#Intent;action=android.intent.action.VIEW;package=com.mxtech.videoplayer.pro;type={mimeType};end` |

Android uses an explicit VIEW intent with the package name and media MIME type
because Anishelf's media routes have no filename extension. Browsers on other
platforms can also open a custom template when the target application registers
that scheme.

Templates require `{url}` or `{urlEncoded}`. Unknown placeholders, whitespace and
control characters, script/data/file URLs and ordinary Web navigation schemes are
rejected.

## Desktop

Anishelf detects built-in players by their command names on `PATH`.
Detected players appear directly in the **Open in external player** menu, like Web
presets. Built-in presets use a command name such as `mpv`, resolved from `PATH`
when launching. Open **Settings → External players**
to add custom command players:

| OS | Detected players |
| --- | --- |
| macOS | IINA, mpv, VLC |
| Linux | mpv, VLC, Celluloid, Haruna |
| Windows | mpv, VLC, PotPlayer |

Enter a command name available on `PATH`, such as `mpv`, or select **Choose** to
pick an executable file. A path containing a separator is checked when saved; a
bare name is resolved from `PATH` when launched. On macOS choose the binary inside
the application bundle, for example
`/Applications/IINA.app/Contents/MacOS/iina` or
`/Applications/VLC.app/Contents/MacOS/VLC`.

Enter one argument per line. The same placeholders apply:

```text
--no-terminal
{url}
```

A command player must contain `{url}` or `{urlEncoded}` in its arguments. On
Windows an executable path must end in `.exe` or `.com`.

Choosing an entry from **Open in external player** shows a native confirmation
dialog with the exact command. The access token is masked in the dialog. After
confirmation Anishelf starts the process detached with no shell, so arguments are
passed literally and the player keeps running when Anishelf closes.

Desktop player settings are stored on this computer in a plain
`<Electron userData>/external-players.json` file, not in browser storage or on the
server. Uninstalling or moving a configured executable makes launch fail; remove
and re-add the entry.

## Media links

**Copy media link**, **Download video** and **Download playlist (.m3u)** remain
available on file pages and in the playback menu. They recheck file access and
reference the original media. The playlist does not include selected subtitles,
audio tracks or resume positions, and downloading it does not start playback.
