# Desktop development

Run `npm run dev:desktop:all` from the repository root to start the backend,
desktop Vite server and Electron. The desktop renderer mounts
`@anishelf/client-ui` directly. It has its own HTML entry, router and platform
adapter. It does not use the Web workspace or register a service worker.

The development renderer runs at `http://127.0.0.1:5174` and proxies `/api` to
the backend using the existing cookie and CSRF flow. To use another loopback port, set
`ANISHELF_DESKTOP_URL` for both Electron and the renderer server.

```sh
npm run dev:desktop:all
ANISHELF_DESKTOP_URL=http://127.0.0.1:5180 npm run dev:desktop:all
```

Use `npm run dev:desktop:renderer` to run only the desktop Vite server and
`npm run dev:desktop` to open Electron against a running renderer.

## Run the built desktop application

With an Anishelf server already running, build and launch the desktop app from
the repository root:

```sh
npm run build --workspace @anishelf/desktop
npm run start:desktop
```

Electron serves `dist/renderer/` through a gateway listening on
`127.0.0.1:5175`. The gateway serves React routes and streams `/api` responses,
including byte ranges for media. Electron stores preferences in a separate
partition per server origin.

The default backend is `http://127.0.0.1:3000`, with `ANISHELF_PORT` overriding
its port. Set `ANISHELF_API_TARGET` to change the target in development or built
mode. Built mode also accepts `--server=https://server.example.com`, which takes
precedence over the environment variable. If the gateway port is in use, set
`ANISHELF_DESKTOP_GATEWAY_PORT` to another port. Keep the port stable to retain
preferences scoped to the renderer's origin.

### Remote server

```sh
npm run start:desktop -- --server=https://server.example.com
```

The server needs HTTPS and the device session API. The shared login screen signs in
with the server password. The main process keeps the device token and attaches
it to trusted gateway requests, including media ranges. The operating system's
credential encryption protects the token at rest when available. Without it,
the session lasts until the desktop app exits. Signing out revokes the device
session. Loopback HTTP uses the existing cookie and CSRF flow.

### Managed local server

From a checkout, build the backend and desktop workspaces, then launch:

```sh
npm run build --workspace @anishelf/backend
npm run build --workspace @anishelf/desktop
npm run start:desktop:local
```

Electron starts the backend with Node.js, waits for `/api/health`, and stops the
process on exit. The backend listens on `127.0.0.1`, uses the `server` directory
under Electron's application data by default, and needs FFmpeg and FFprobe. Run
from a terminal to see the initial password printed by the backend on first
start. `ANISHELF_DATA_DIR` can select an existing data directory.

To run a separate backend launcher, set `ANISHELF_DESKTOP_BACKEND_EXECUTABLE`
to its absolute path before launching the app. The launcher inherits the
loopback address and data directory through `ANISHELF_HOST`, `ANISHELF_PORT`,
and `ANISHELF_DATA_DIR`.
