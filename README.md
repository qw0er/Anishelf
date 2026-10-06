# Anishelf

Anishelf is a personal anime library browser and player. Point it at an existing
media directory, browse its folder structure, and watch videos in your browser.

- Automatic and manual library scans.
- Saved playback progress and watch history.
- External subtitles and supported embedded text subtitles.
- Media compatibility checks and prepared copies for browser playback.
- Original-media links for external players.

## Requirements

- For container deployment, use Docker or Podman on Linux. The image includes
  Node.js, FFmpeg/FFprobe and the application; no source build is required.
- For running from source, install Node.js 24 and npm, plus FFmpeg and FFprobe
  for media inspection, subtitle extraction and preparation. Direct playback
  remains available without these tools when the browser supports the original media.
- Read access to the media directory and write access to a separate application
  data directory.

The backend currently listens only on loopback addresses. Remote use is available
through SSH port forwarding; authentication and public access are outside the
current scope.

## Run and use

To run a previously built application on Linux or macOS, start it from the
repository root:

```sh
ANISHELF_FRONTEND_DIR="$PWD/web/dist" npm run start:backend
```

On Windows PowerShell:

```powershell
$env:ANISHELF_FRONTEND_DIR = Join-Path (Get-Location).Path 'web/dist'
npm run start:backend
```

If you have not built the application yet, follow [Build](#build) first.

Open [Anishelf](http://127.0.0.1:3000), then:

1. Save the absolute media directory in Settings. For a container deployment,
   use the mounted path, such as `/media`.
2. Wait for the scan, browse folders and select a video to play.
3. Select subtitles or prepare a compatible copy when needed. Use **Copy media
   link** to open the original file in an external player.

The library scans on startup and periodically. Use a manual scan after changing
media files, or adjust the automatic scan interval in Settings; `0` disables
scheduled scans. Playback support depends on the browser and the media format.

For a remote server, forward its application port:

```sh
ssh -L 3000:127.0.0.1:3000 user@server
```

Open the same local address and keep the SSH connection active.

## Deploy with a container

The published image is `ghcr.io/qw0er/anishelf:latest`. On a Linux server:

```sh
docker pull ghcr.io/qw0er/anishelf:latest
docker volume create anishelf-data
docker run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 \
  -e ANISHELF_PORT=3000 \
  --mount type=volume,source=anishelf-data,target=/data \
  --mount type=bind,source=/absolute/media/path,target=/media,readonly \
  ghcr.io/qw0er/anishelf:latest
```

Replace `/absolute/media/path` with your server's media directory before running.
Open [Anishelf](http://127.0.0.1:3000) and save `/media` in Settings. When reusing
existing application data, change any saved host media path to `/media` too.
The persistent `/data` volume stores settings, the database and caches.

Host networking is required by the current loopback-only listener; do not use
`-p` port mappings. Change `ANISHELF_PORT` to select another unused host port and
use that port in the browser and SSH forwarding command above.

For Podman, replace `docker` with `podman`. On SELinux systems such as Fedora,
replace the media `--mount` option with
`-v /absolute/media/path:/media:ro,Z`. The container runs as UID/GID 1000;
ensure its user can read the media directory. See [container usage](package/README.md)
for additional mount details. If the registry requires authentication, run
`docker login ghcr.io` before pulling.

### Update

Pull the new image, then stop the application:

```sh
docker pull ghcr.io/qw0er/anishelf:latest
docker stop --time 15 anishelf
```

Back up the application data while the container is stopped. Then remove the old
container and rerun the deployment command above with the same data volume,
media mount and port:

```sh
docker rm anishelf
```

Keep the `anishelf-data` volume. Pulling an image alone does not update an existing
container. Startup applies database migrations; reverting to an older image may
also require restoring its matching data backup.

## Configuration

Set environment variables before starting the application. Restart after changes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANISHELF_HOST` | `127.0.0.1` | Loopback listener address: `127.x.x.x` or `::1`. |
| `ANISHELF_PORT` | `3000` | Listener port, from 1 to 65535. |
| `ANISHELF_FRONTEND_DIR` | Unset | Absolute frontend build directory containing `index.html`; enables page hosting. |
| `ANISHELF_DATA_DIR` | Platform-specific user data directory | Absolute writable directory for settings, the database and caches. |
| `ANISHELF_FFMPEG_PATH` | `ffmpeg` from PATH | Optional absolute FFmpeg executable path. |
| `ANISHELF_FFPROBE_PATH` | `ffprobe` from PATH | Optional absolute FFprobe executable path. |

Without `ANISHELF_FRONTEND_DIR`, the backend serves only APIs and media. A configured
frontend directory without `index.html` fails startup. Keep application data outside
the media and frontend directories, and preserve it across updates. Stop the
application and back up its data before upgrading.

## Build

Run from the repository root:

```sh
npm ci
npm run build
```

The build produces `backend/dist` and `web/dist`. Keep the backend's production
Node.js dependencies and `backend/migrations` available when deploying the build.

To build a container image instead:

```sh
docker build -f package/Dockerfile -t anishelf:local .
```

See [container usage](package/README.md) for mounts, ports and runtime commands.
The image includes Node.js, FFmpeg/FFprobe and the built application.
