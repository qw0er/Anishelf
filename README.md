# Anishelf

Anishelf is a personal animation library browser and player. Configure an existing server-side media directory, scan it manually, browse the actual directory hierarchy, and play files in a browser.

V1 supports one resource root, recursive manual scanning, natural sorting, native playback controls, and failure feedback. Original media is read-only. Scanning includes `.mp4`, `.m4v`, `.webm`, and `.mkv`, case-insensitively; playback depends on the browser and media codecs. Subtitles, transcoding, playback history, accounts, and download management are deferred.

## Requirements

- Node.js 24 and npm.
- Read access to the media directory and write access to the application data directory.
- V1 supports local use and loopback backend addresses. For a remote server, use SSH port forwarding. LAN/public access and authentication are outside the current scope.

## Build and configure

Run these commands from the project root:

```sh
npm ci
npm run build
cp exapmle/anishelf.example.toml /tmp/anishelf.toml
```

Edit the configuration and set `dataDir` to an actual absolute path:

```toml
host = "127.0.0.1"
port = 3000
dataDir = "/absolute/path/to/anishelf-data"

[logging]
level = "info"
destination = "stdout"
```

The `/tmp` configuration is for a quick local trial. For a persistent deployment, use a location such as `/etc/anishelf/anishelf.toml` and a persistent data directory such as `/var/lib/anishelf`.

## Production startup

```sh
NODE_ENV=production ANISHELF_CONFIG=/etc/anishelf/anishelf.toml npm start
```

The production backend provides APIs and media only. It does not serve pages or require a frontend build to start. When `NODE_ENV` is unset, the backend also provides only APIs and media.

**Use Caddy or another Web server to serve `web/dist` and reverse-proxy `/api`.** Use systemd or another process manager to start, restart, and collect logs from Node.js. The build outputs are `backend/dist` and `web/dist`; keep the backend runtime dependencies available, and deploy the frontend build to the Web server's static root.

After starting the backend and Caddy as described below, open <http://127.0.0.1:8080>. Save the absolute server-side media directory in the page, then click **Scan library**. The first successful save creates `settings.json` in `dataDir`. Restarting preserves the directory setting, but requires a new manual scan. Rescan after adding or removing media.

Deployment TOML changes and manual JSON edits require a restart. Keep the writable application data directory separate from the media directory. Serve only the frontend build as static content.

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
Environment=NODE_ENV=production
Environment=ANISHELF_CONFIG=/etc/anishelf/anishelf.toml
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

Set `dataDir` in the deployment TOML to your prepared persistent directory. stdout logs are collected by systemd. After updating the code, rebuild and run `sudo systemctl restart anishelf`.

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
ANISHELF_CONFIG=/absolute/path/to/anishelf.toml npm run dev
```

Open <http://127.0.0.1:5173>. The command runs the backend watcher and Vite together; Vite proxies `/api` to port 3000. Set `ANISHELF_API_TARGET` if the backend uses another port. No frontend build is required for this workflow. Use `npm run dev:backend` or `npm run dev:web` to start only one service.

For LAN development, run `ANISHELF_CONFIG=/absolute/path/to/anishelf.toml npm run dev:host`. Vite listens on `0.0.0.0:5173`; open `http://<server-lan-ip>:5173` from another device. The backend still listens on its configured loopback address. Vite forwards same-origin API mutations using the backend origin. This development server has no authentication; use it on a trusted network.

To build the frontend and backend, then serve the page directly from the backend, run:

```sh
ANISHELF_CONFIG=/tmp/anishelf.toml npm run start:web
```

Open <http://127.0.0.1:3000>. `start:web` builds both workspaces before starting the backend in development mode, so it serves the newly built `web/dist` at the backend address. Page hosting is available only when `web/dist/index.html` exists. Built pages do not hot reload; rerun `npm run start:web` after changes to rebuild and restart. If a build fails, the backend will not start through this command; use `npm run dev` for frontend hot reload.

## Checks and documentation

```sh
npm run check   # Biome, type checks, backend and frontend tests
npm run lint    # Biome lint
```

- [V1 requirements and acceptance criteria](docs/current-version-requirements.md)
- [Overall design](docs/current-version-design.md)
- [Development, configuration, and API details](docs/development.md)
- [Future requirements](docs/future-requirements.md)

The user has reported completing manual browser acceptance. Automated tests cover configuration, scanning, navigation, media delivery, access boundaries, frontend interactions, and development-only page hosting. Actual media decoding is validated by manual browser acceptance.
