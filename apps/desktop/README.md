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

The profile is stored in the `desktop` subdirectory of the platform user data
directory for `anishelf`. On Linux this defaults to
`~/.local/share/anishelf/desktop` and respects `XDG_DATA_HOME`. The bundled
backend keeps its database, settings and logs in the profile's `backend/`
subdirectory. Electron holds local device credentials in memory and encrypts
external device tokens on disk when secure storage is available.

The window's normal size and position, maximized state, and fullscreen state are
saved in `window-state.json` in the desktop profile. If the saved position is no
longer visible on a connected display, the window opens at a default position.
On Wayland, the compositor controls window positioning.

In **Settings → Desktop → Window and tray**, enable **Keep running in the
tray when closing the window** to keep the window and bundled backend alive
after closing the window. The option is off by default. Use **Open Anishelf**
in the tray menu to show the window and **Quit Anishelf** to exit and stop the
bundled backend. On Linux, tray visibility depends on the desktop environment.
Launching Anishelf again brings the existing window back.

The desktop platform adapter uses Electron for clipboard writes, media downloads,
and opening links and external players. External players are configured as command
players: enter a command name available on PATH or choose an executable, then one
argument per line. Detected players whose commands are on PATH appear directly in
the playback menu.
Anishelf asks for confirmation before every launch and starts the process detached
without a shell. No URL protocol handler is needed. Custom player settings are
stored on this computer.

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
separately for media probing and transcoding. Configure qBittorrent and Jackett
connections in Settings as needed. Linux uses the Anishelf icon and matching
desktop entry. Windows and macOS use the default Electron icon. These builds
are unsigned and macOS builds are not notarized.

The release workflow builds installers for Linux x64, Windows x64 and macOS
arm64. A manual release workflow run keeps the installers as Actions artifacts
for seven days. For a version tag on `main`, the workflow also attaches them to
the GitHub Release.
