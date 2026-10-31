# External players

In **Settings → External players**, add a name and URL template. Select the entry
from a file's **Open in external player** menu. Custom entries are saved in the
current browser. Install the player and any custom handler on the browser's device.

| Placeholder | Value |
| --- | --- |
| `{url}` | Complete original-media URL |
| `{urlEncoded}` | Complete media URL encoded with `encodeURIComponent` |
| `{mimeType}` | Video MIME type, or `video/*` |

## App-provided templates

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

## Custom handlers required

Register a handler using the platform instructions below before using these templates.

| OS | Player | Template |
| --- | --- | --- |
| Linux, Windows, macOS | [mpv](https://mpv.io/installation/) with the custom handler below | `mpv:{url}` |
| Linux, Windows, macOS | [VLC](https://www.videolan.org/vlc/) with a custom handler | `vlc:{url}` |
| Windows | PotPlayer with a custom handler | `potplayer:{url}` |

For desktop VLC or PotPlayer, use the setup below with the corresponding scheme
and executable path. PotPlayer takes the URL directly; omit the `--` argument.

## Linux

Use `mpv:{url}` and register this handler. Adjust `/usr/bin/mpv` if needed.

```sh
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
cat > "$HOME/.local/bin/anishelf-mpv" <<'SH'
#!/usr/bin/env bash
exec /usr/bin/mpv -- "${1#*:}"
SH
chmod +x "$HOME/.local/bin/anishelf-mpv"

cat > "$HOME/.local/share/applications/anishelf-mpv.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Anishelf mpv Handler
Exec="$HOME/.local/bin/anishelf-mpv" %u
MimeType=x-scheme-handler/mpv;
NoDisplay=true
Terminal=false
EOF

update-desktop-database "$HOME/.local/share/applications"
xdg-mime default anishelf-mpv.desktop x-scheme-handler/mpv
```

## Windows

Use `mpv:{url}`. Save this as `C:\Tools\mpv-handler.py` and adjust the mpv path.
Python 3.9 or later is required.

```python
import subprocess
import sys
subprocess.Popen([r"C:\Tools\mpv\mpv.exe", "--", sys.argv[1].split(":", 1)[1]])
```

Save the following as `anishelf-mpv.reg`, adjust the Python and script paths, and
import it. This registers `mpv:` for the current user.

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Classes\mpv]
@="URL:Anishelf mpv Handler"
"URL Protocol"=""

[HKEY_CURRENT_USER\Software\Classes\mpv\shell\open\command]
@="\"C:\\Tools\\Python\\pythonw.exe\" \"C:\\Tools\\mpv-handler.py\" \"%1\""
```

## macOS

For IINA or Infuse, install and launch the app, then use its template above.

For custom mpv handling, use `mpv:{url}`. In Script Editor, export this AppleScript
as an **Application** named `Anishelf mpv Handler.app` in `~/Applications`.
Adjust the mpv path.

```applescript
on open location incomingURL
    set mediaURL to text ((offset of ":" in incomingURL) + 1) thru -1 of incomingURL
    do shell script "/opt/homebrew/bin/mpv -- " & quoted form of mediaURL & " >/dev/null 2>&1 &"
end open location
```

Add this entry inside the main `<dict>` in the application's
`Contents/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLName</key>
        <string>Anishelf media</string>
        <key>CFBundleURLSchemes</key>
        <array><string>mpv</string></array>
    </dict>
</array>
```

Re-sign and launch the application to register it:

```sh
codesign --force --sign - "$HOME/Applications/Anishelf mpv Handler.app"
open "$HOME/Applications/Anishelf mpv Handler.app"
```

## Android and iOS/iPadOS

Install a player from the table and add its template. Accept the browser's
application-opening prompt. Mobile apps provide their own handlers; no desktop
script is needed.

## URL format

The custom desktop handlers above remove the scheme prefix and pass the remaining
URL to the player. Use `{url}`, not `{urlEncoded}`, with these handlers.
For VLC, replace the `mpv` names and scheme in the registration with `vlc`; for
PotPlayer, use `potplayer`. Set the handler's executable to the installed player.
Add these templates as custom entries;
Anishelf's built-in desktop mpv preset currently uses `mpv://{url}`.

Avoid `mpv://https://...`: browsers can parse `https` as the outer hostname and
remove the following colon as an empty port separator. `mpv:https://...` preserves
it. For players accepting a media URL in a query parameter, use `{urlEncoded}`.

External playback uses the original file and does not update Anishelf progress.
