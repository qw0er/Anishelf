# Anishelf

Anishelf is a personal animation library browser and player. Configure an existing server-side media directory, scan it automatically at backend startup or manually, browse the actual directory hierarchy, and play files in a browser.

## Requirements

- Node.js 24 and npm.
- FFmpeg and FFprobe for media inspection and subtitle extraction; direct playback works without them.
- Read access to the media directory and write access to the application data directory.
- V1 supports local use and loopback backend addresses. For a remote server, use SSH port forwarding. LAN/public access and authentication are outside the current scope.

## Build and configure

Run these commands from the project root:

```sh
npm ci
npm run build
```

Startup options can be set with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Loopback listener IP (`127.x.x.x` or `::1`). |
| `ANISHELF_PORT` | `3000` | Listener port, from 1 to 65535. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory for Anishelf | Absolute writable application data directory. |
| `ANISHELF_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |
| `ANISHELF_LOG_DESTINATION` | `stdout` | `stdout` or `file`. |
| `ANISHELF_LOG_PATH` | Unset | Absolute log path, required only for file output. |
| `ANISHELF_FFMPEG_PATH` | `ffmpeg` from process PATH | Optional absolute FFmpeg executable path; resolved independently. |
| `ANISHELF_FFPROBE_PATH` | `ffprobe` from process PATH | Optional absolute FFprobe executable path; resolved independently. |

FFmpeg and FFprobe are discovered and version-checked independently at startup. Missing or unusable binaries produce warning logs and disable dependent tool operations; direct playback remains available. An explicit override never falls back to PATH. Install tools separately and ensure the service manager exposes their directory in PATH, or configure the absolute executable paths above. Restart after changing tool paths or installing tools. See [the media tool API](docs/architecture.md#media-tools-and-subtitle-delivery) for the current backend-only functions.

The default uses [platformdirs](https://www.npmjs.com/package/platformdirs) to choose the user data directory for the current operating system (for example, XDG data storage on Linux, Application Support on macOS, and Local AppData on Windows). `ANISHELF_DATA_DIR` overrides this choice. The directory is created at startup if needed. Paths are resolved independently of the working directory; `~` in an environment value is not expanded by the application.

On macOS, installations using the previous `~/.local/share/anishelf` default should set `ANISHELF_DATA_DIR` to that existing absolute path or move the existing data into the new platform-specific location before starting this version.

## Start the backend

The backend provides APIs and media only. It does not serve pages or require a frontend build to start.

**Use Caddy or another Web server to serve `web/dist` and reverse-proxy `/api`.** Use systemd or another process manager to start, restart, and collect logs from Node.js. The build outputs are `backend/dist` and `web/dist`; keep the backend runtime dependencies available, and deploy the frontend build to the Web server's static root.

After starting the backend and Caddy as described below, open <http://127.0.0.1:8080>. Save the absolute server-side media directory in the page; the first successful save creates `settings.json` in `dataDir` and starts a scan. Once configured, the backend scans the directory automatically at each startup, and changing the saved directory starts a scan. Scheduled scans run every 60 minutes by default. Configure **Automatic scan interval (minutes)** in Settings, or set it to 0 to disable scheduled scans. Manual scans remain available after adding or removing media.

Environment variable changes and manual JSON edits require a restart. Keep the writable application data directory separate from the media directory. Serve only the frontend build as static content.

### Manage the backend with systemd

Place the project at a fixed path, such as `/opt/anishelf`, install dependencies, and build it. Create a dedicated runtime user with media read access and data write access. Save this example as `/etc/systemd/system/anishelf.service`; adjust paths and confirm the Node.js executable with `command -v node`:

```ini
[Unit]
Description=Anishelf
After=network.target

[Service]
Type=simple
User=anishelf
Group=anishelf
WorkingDirectory=/opt/anishelf
Environment=ANISHELF_DATA_DIR=/var/lib/anishelf
# Optional when the tools are absent from the service PATH:
# Environment=ANISHELF_FFMPEG_PATH=/usr/bin/ffmpeg
# Environment=ANISHELF_FFPROBE_PATH=/usr/bin/ffprobe
ExecStart=/usr/bin/node /opt/anishelf/backend/dist/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now anishelf
sudo systemctl status anishelf
journalctl -u anishelf -f
```

Set `ANISHELF_DATA_DIR` in the service environment to your prepared persistent directory. stdout logs are collected by systemd. After updating the code, rebuild and run `sudo systemctl restart anishelf`.

### Serve pages and proxy APIs with Caddy

This example listens only on `127.0.0.1:8080`; the backend listens on `127.0.0.1:3000`. The Caddy runtime user must be able to read `web/dist` and traverse its parent directories.

```caddyfile
http://127.0.0.1:8080 {
    bind 127.0.0.1

    @api path /api /api/*
    handle @api {
        reverse_proxy 127.0.0.1:3000 {
            header_up Host {upstream_hostport}
            header_up Origin "^http://127[.]0[.]0[.]1:8080$" "http://127.0.0.1:3000"
        }
    }

    handle {
        root * /opt/anishelf/web/dist
        @navigation {
            not path /assets/*
            header Accept *text/html*
        }
        route @navigation {
            try_files {path} /index.html
        }
        file_server
    }
}
```

API requests retain the `/api` prefix, including media byte-range requests. Page navigation falls back to `index.html`; missing build assets return 404.

The backend validates Host and mutation Origin headers. The example sets the upstream Host and rewrites only the exact Caddy origin to the backend origin. Other origins remain unchanged and are rejected. When changing the Caddy port, update the exact Origin rule too. Access the application through <http://127.0.0.1:8080>.

Install Caddy, save the configuration, validate it, and start it:

```sh
caddy validate --config /absolute/path/to/Caddyfile --adapter caddyfile
caddy run --config /absolute/path/to/Caddyfile --adapter caddyfile
```

For persistent operation, use your system's Caddy service and its configured Caddyfile location. See the official [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) and [SPA configuration patterns](https://caddyserver.com/docs/caddyfile/patterns#single-page-apps-spas).

This example stays local. For a remote deployment, run `ssh -L 8080:127.0.0.1:8080 user@server` on the client and open the local 8080 address.

## Development

For frontend hot reload, start both the backend and Vite with one command:

```sh
npm run dev
```

Open <http://127.0.0.1:5173>. The command runs the backend watcher and Vite together; Vite proxies `/api` to port 3000. Set `ANISHELF_API_TARGET` if the backend uses another port. No frontend build is required for this workflow. Use `npm run dev:backend` or `npm run dev:web` to start only one service.

For LAN development, run `npm run dev:host`. Vite listens on `0.0.0.0:5173`; open `http://<server-lan-ip>:5173` from another device. The backend still listens on its configured loopback address. Vite forwards same-origin API mutations using the backend origin. This development server has no authentication; use it on a trusted network.

To build the frontend and backend, then serve the page directly from the backend, run:

```sh
npm run start:web
```

Open <http://127.0.0.1:3000>. `start:web` builds both workspaces before starting the backend in development mode, so it serves the newly built `web/dist` at the backend address. Page hosting is available only when `web/dist/index.html` exists. Built pages do not hot reload; rerun `npm run start:web` after changes to rebuild and restart. If a build fails, the backend will not start through this command; use `npm run dev` for frontend hot reload.

## Checks and documentation

```sh
npm run check   # Biome, architecture/unused checks, types and tests
npm run lint    # Biome, dependency boundaries and Knip
```

- [Requirements and active release acceptance](docs/requirements.md)
- [Architecture and implementation reference](docs/architecture.md)
- [UI design conventions](docs/design.md)
- [Development and operations](docs/development.md)
- [Complete historical records](docs/history.md)

Automated tests cover configuration, migrations, scanning, selection, preparation,
media delivery, access boundaries and frontend coordination. Real FFmpeg tests
validate completed outputs; actual browser decoding and responsive layout require
separate acceptance. See [refactoring acceptance](docs/refactoring-baseline.md).

### Unified configuration

The backend creates one `ConfigurationService` from validated startup environment variables, built-in TypeScript policies and explicit `settings.json` values. Policies cover current scanning, playback, subtitle handling, tool execution, HTTP and database limits. They are read-only and updated with the program; do not copy them into `dataDir` or add policy fields to `settings.json`.

`resourceRoot`, optional `scanIntervalMinutes` and optional `defaultTranscodeProfileId` are currently writable. Omitted intervals use the current built-in default; `0` disables scheduled scans. Explicit choices survive upgrades. Settings commit atomically before the effective snapshot changes. Existing root-only settings need no migration.

The Web build defines local playback and renderer policy and imports browser-safe shared scan/subtitle constraints. No client-configuration request is required. The [transcode profile foundation](docs/transcode-profiles.md) provides Balanced/Fast built-ins, optional `dataDir/transcode-profiles.json`, a catalog API and persistent selection. Profile execution, the UI selector, cache budgets and profile-content cache invalidation remain planned.

### External-player media links

In the file list, use the copy icon (hover for **Copy media link**), or select **Copy media link** on a file's Web player page to recheck the file and copy an absolute original-media URL. Paste it into an external player's Open URL command. If clipboard access fails, select the link in the result dialog to copy it manually.

Links use the browser's application origin, including an SSH-forwarded localhost port. Keep the forwarding connection active; localhost links work on the computer running that forwarding connection. The external player reads media directly over HTTP/Range. Copying does not launch a player or change Web progress, and external playback does not report progress to Anishelf. Missing files produce a link error; links do not contain server filesystem paths.
