# Desktop workspace

This workspace uses TypeScript for the Electron main process and Vite with
React and TypeScript for the shared Anishelf interface.

From the repository root, run `npm run dev:desktop` to launch Electron with a local
backend watcher. Renderer changes update through Vite; main process and preload
changes rebuild and restart Electron. Vite listens on `127.0.0.1:5174`. Run
`npm run start:desktop` to build and launch Electron with a
local backend without watch mode. If Electron opens while the backend is still
starting, retry from the app once the backend is ready.

Use `npm run dev:desktop:client` to run only Electron in development mode, or
`npm run start:desktop:client` to launch an existing desktop build. Open
the sign-in page to enter the server address and password together. The app
checks the connection and signs in before saving the address in the desktop
profile. Open **Server connection** from Settings or the page load error screen
to return to the same form.

The app uses the saved address on startup. The default is
`http://127.0.0.1:3000`. Use HTTPS for remote servers. HTTP is supported for
`localhost`, `127.0.0.1`, and `[::1]`. Specify only the origin, without a path,
query, fragment, or credentials.

The desktop client uses the server's device sessions. Electron keeps the token
in the main process and uses the system credential store to encrypt it on disk.
When secure storage is unavailable, the session lasts until the app exits.

Electron stores its profile and device sessions in the `desktop` subdirectory
of the platform user data directory for `anishelf`. On Linux this is
`$XDG_DATA_HOME/anishelf/desktop`, with `~/.local/share/anishelf/desktop` as the
default. The previous Electron profile is left in place. Sign in again and
reapply any local preferences when using the new profile.

The window's normal size and position, maximized state, and fullscreen state are
saved in `window-state.json` in the desktop profile. If the saved position is no
longer visible on a connected display, the window opens at a default position.
On Wayland, the compositor controls window positioning.

The desktop platform adapter uses Electron for clipboard writes, media downloads,
and opening links and external players. External players are configured as command
players: enter a command name available on PATH or choose an executable, then one
argument per line. Detected players whose commands are on PATH appear directly in
the playback menu.
Anishelf asks for confirmation before every launch and starts the process detached
without a shell. No URL protocol handler is needed. Custom player settings are
stored on this computer.
