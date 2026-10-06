# Anishelf

Anishelf is a personal anime library browser and player. Point it at an existing
media directory, browse its folder structure, and watch videos in your browser.

- Automatic and manual library scans.
- Saved playback progress and watch history.
- External subtitles and supported embedded text subtitles.
- Media compatibility checks and prepared copies for browser playback.
- Original-media links for external players.

## Requirements

- Node.js 24 and npm.
- FFmpeg and FFprobe for media inspection, subtitle extraction and preparation.
  Direct playback remains available without these tools when the browser supports
  the original media.
- Read access to the media directory and write access to a separate application
  data directory.

The backend currently listens only on loopback addresses. Remote use is available
through SSH port forwarding; authentication and public access are outside the
current scope.

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

## Run and use

After building, run from the repository root on Linux or macOS:

```sh
ANISHELF_FRONTEND_DIR="$PWD/web/dist" npm run start:backend
```

On Windows PowerShell:

```powershell
$env:ANISHELF_FRONTEND_DIR = Join-Path (Get-Location).Path 'web/dist'
npm run start:backend
```

Open [Anishelf](http://127.0.0.1:3000), then:

1. Save the absolute media directory in Settings. In the container example,
   use `/media`, the container's mounted path.
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
