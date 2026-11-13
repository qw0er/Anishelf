# Desktop development

Run `npm run dev:desktop:all` from the repository root to start the backend
watcher, build the desktop application and launch Electron. With a backend
already running, use `npm run dev:desktop`. Rebuild after editing the renderer
and relaunch Electron to pick up the changes.

## Run the built desktop application

Start Backend separately with `npm start` or use an existing deployment.
Build and launch Electron from the repository root:

```sh
npm run build --workspace @anishelf/desktop
npm run start:desktop
```

Electron loads the local `dist/renderer/` build at `anishelf://desktop/`.
The Electron protocol loads app assets and the renderer uses hash routes.
Chromium sends API, artwork, subtitle and media requests directly to the
configured backend, including byte ranges. Backend accepts the fixed desktop
origin for its API. The desktop app needs no HTTP listener or port for its UI.

The default backend is `http://127.0.0.1:3000`. Set `ANISHELF_PORT` to change
the default port or `ANISHELF_API_TARGET` to choose an origin. A
`--server=https://server.example.com` argument takes precedence:

```sh
npm run start:desktop -- --server=https://server.example.com
```

Both local and remote connections use device sessions. Remote connections
require HTTPS. The main process stores the device token using operating system
credential encryption when available and otherwise keeps it in memory. Electron
adds the credential to requests for the configured API. Signing out revokes
the device session. Settings and credentials are scoped to the selected server.
The renderer uses a preload IPC bridge for credential storage, clipboard access,
external links and players, and starting native media downloads.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/main/index.ts` | Electron startup, session setup and composition |
| `src/main/server/` | Server address, request credentials and device-token storage |
| `src/main/renderer/` | BrowserWindow and local asset protocol |
| `src/main/native/` | Opening links and players, and native media downloads |
| `src/main/ipc.ts` | IPC handler registration and sender validation |
| `src/ipc/desktop.ts` | Shared bridge types and method names |
| `src/preload/index.cts` | Sandboxed context bridge compiled to a single CommonJS preload |
| `src/renderer/` | React startup, direct API authentication and the desktop platform adapter |

The main entry and its IPC registration connect the main-process modules.
The preload and renderer consume the shared IPC contract through type imports.
The renderer uses Chromium for API and media requests. Run
`npm run architecture:check` to verify the import boundaries.
