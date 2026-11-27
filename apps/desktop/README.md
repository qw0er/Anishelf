# Desktop workspace

This workspace uses TypeScript for the Electron main process and Vite with
React and TypeScript for the shared Anishelf interface.

From the repository root, run `npm run dev:desktop` to build the backend and
launch Electron. Renderer changes update through Vite at `127.0.0.1:5174`.
Main process and preload changes rebuild and restart Electron. Restart the
development command after changing server code to rebuild the backend. Run
`npm run start:desktop` for a regular build and launch.

The app starts the bundled backend by default and signs in automatically. In
**Settings → Desktop → Server connection**, choose **External server** to enter another
Anishelf server's address and password. Use HTTPS for remote servers. HTTP is
supported for `localhost`, `127.0.0.1`, and `[::1]`. Enter an origin without a
path, query, fragment, or credentials. The sign-in screen can also switch back to
the local backend when an external server is unavailable.

When connected to the bundled backend, **Settings → Library → Resource
directories** offers **Choose directory** to select a folder with the system
dialog. External servers use the text field because their paths refer to the
server machine.

`npm run dev:desktop` stores its profile in `.temp/desktop/` at the repository
root. For regular launches, the profile is stored in the `desktop` subdirectory
of the platform user data directory for `anishelf`. On Linux this defaults to
`~/.local/share/anishelf/desktop` and respects `XDG_DATA_HOME`. The bundled
backend keeps its database, settings and logs in the profile's `backend/`
subdirectory. Electron holds local device credentials in memory and encrypts
external device tokens on disk when secure storage is available.

The application header shares the desktop title bar with the window controls. The
window's normal size and position, maximized state, and fullscreen state are
saved in `window-state.json` in the desktop profile. If the saved position is no
longer visible on a connected display, the window opens at a default position.
On Wayland, the compositor controls window positioning.

In **Settings → Desktop → Window and tray**, enable **Keep running in the
tray when closing the window** to keep the window and bundled backend alive
after closing the window. The option is off by default. Use **Open Anishelf**
in the tray menu to show the window and **Quit Anishelf** to exit and stop the
bundled backend. On Linux, tray visibility depends on the desktop environment.
Launching Anishelf again brings the existing window back.

On macOS, Anishelf provides a native application menu bar with **About
Anishelf**, **Check for Updates…**, **Settings…** (`Cmd+,`), **Go** navigation
shortcuts (`Cmd+[` / `Cmd+]` and `Cmd+1` through `Cmd+6`), window recovery via
**Window → Show Main Window**, and project links under **Help**. Developer
tools in **View** are shown only in unpackaged builds, and both the macOS menu
bar and the tray menu follow the in-app language setting.

In **Settings → Desktop → Startup**, enable **Launch Anishelf when you sign in
to your computer** to start the desktop app when you sign in. The bundled
backend starts with it. When the tray is enabled, the window stays hidden in
the tray; otherwise it opens normally. Windows and macOS use the system login
item. Linux writes an XDG autostart entry to
`$XDG_CONFIG_HOME/autostart/app.anishelf.desktop.desktop` and uses the AppImage
path for AppImage builds. Launch at login is available in packaged builds.

The desktop platform adapter uses Electron for clipboard writes, media downloads,
and opening links and external players. External players are configured as command
players: enter a command name available on PATH or choose an executable, then one
argument per line. Built-in players detected on PATH or in common installation
locations appear directly in the playback menu.
Anishelf asks for confirmation before every launch and starts the process detached
without a shell. No URL protocol handler is needed. Custom player settings are
stored on this computer.

Choose **Download video** in the playback menu and select a save location.
The menu shows progress while the file downloads. Choose **Show in folder**
from the success notification to find the saved video, or **Retry** from a
failure notification to start the download again.

Choose **Cache episode** or **Cache video** from a media action menu to keep a
copy on this computer. Open **Files → Offline cache** to check progress, retry
interrupted downloads, play videos and remove cached files. The login and
connection error screens also link to the offline cache.

The desktop profile stores original video files, supported external subtitles
and the SQLite index in its `offline-cache/` subdirectory. Cached videos remain
available after a server switch or sign-out. The offline player remembers its
position on this computer. Remove completed caches from the offline list to
free disk space. Interrupted transfers can be restarted while their source
server is connected.

Desktop system media controls can show the current title and artwork and
control playback for streamed and cached videos. Anishelf uses the matched anime
cover when available during streaming and the app icon for other videos and
offline playback. The available controls depend on the operating system and
media format. Playback can be paused or resumed while the window is hidden in
the tray.

On Linux, Anishelf enables Chromium's `VaapiOnNvidiaGPUs` feature by default.
Hardware decoding depends on the driver and media format. To disable the
feature, launch Anishelf with `--disable-features=VaapiOnNvidiaGPUs`.

## Packaging

Run `npm ci` and then `npm run package:desktop` from the repository root.
The first package build may download Electron and platform packaging tools.
Output is written to `apps/desktop/release/`: Linux builds AppImage, deb, and rpm,
Windows builds an NSIS installer, and macOS builds a DMG. Build on the target
operating system and architecture. Pass electron-builder options after `--`, for
example `npm run package:desktop -- --dir` for an unpacked application.

On Fedora, the bundled FPM tool used for deb and RPM builds requires the
compatibility library `libcrypt.so.1`. Install it with
`sudo dnf install libxcrypt-compat` before packaging if it is not already present.

The package includes Electron, the Anishelf backend, SQLite and database
migrations. It runs without system Node.js. Install FFmpeg and FFprobe
separately for media probing and transcoding. If the executables are outside
PATH, set `ANISHELF_FFMPEG_PATH` and `ANISHELF_FFPROBE_PATH` to their absolute
paths in the desktop application's environment and restart Anishelf. Media
tools are detected when a feature first needs them. If the bundled backend
fails to start, check the diagnostic log shown in the error dialog.

Configure qBittorrent and Jackett connections in Settings as needed. For
qBittorrent on the same Windows machine, enter the full completed download
directory, such as `C:\Media`, and configure an incomplete directory outside
all watched roots. Every platform uses the Anishelf application
icon; Linux also gets the matching desktop entry. These builds are unsigned and
macOS builds are not notarized.

The release workflow builds installers for Linux x64, Windows x64 and macOS
arm64. A manual release workflow run keeps the installers as Actions artifacts
for seven days. For a version tag on `main`, the workflow also attaches them to
the GitHub Release.

The application icons in `assets/app-icon.png`, `linux-icon.png`,
`app-icon.icns` and `app-icon.ico` are rendered from
`apps/web/public/favicon.svg`. When the logo changes, re-render the 1024×1024
PNG and rebuild the 512×512 Linux icon, icns and ico files from it. The Linux
package icon uses a size listed in standard hicolor icon themes.
