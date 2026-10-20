# Container packaging

## Images and build targets

`package/Dockerfile` defines two runtime targets for Linux AMD64 and ARM64:

| Target | Release image | Contents |
| --- | --- | --- |
| `backend` | `ghcr.io/qw0er/anishelf-backend` | Node.js 24, production backend dependencies, migrations, FFmpeg/FFprobe |
| `web` | `ghcr.io/qw0er/anishelf-web` | Caddy 2, built frontend and `package/Caddyfile` |

The backend image contains no frontend build and does not set
`ANISHELF_FRONTEND_DIR`. The web image contains no Node runtime, application
credentials or media mounts. Both run as UID/GID 1000. Caddy listens on port 8080
and proxies `/api` to the `backend` service on port 3000; browser requests remain
on one origin. Each image has a health check.

Build from the repository root:

```sh
docker build -f package/Dockerfile --target backend -t anishelf-backend:local .
docker build -f package/Dockerfile --target web -t anishelf-web:local .
```

Use [compose.yaml](../compose.yaml) to build and run the pair together. Set
the backend's `ANISHELF_PUBLIC_ORIGIN` to your
browser-facing origin before starting. The default is `http://localhost:3000`.
Copy [.env.example](../.env.example) to `.env` to configure tags, ports, browser
origin and an optional host media path. Web and Backend share `ANISHELF_TAG`.
qBittorrent is optional via `COMPOSE_PROFILES=qbittorrent`; its third-party image
is pulled rather than built by this project. Set the optional deployment API URL
hint to prefill the account form; credentials still require an explicit save.
The browser WebUI URL is optional and defaults to blank.

Backend exclusively mounts `anishelf-app:/data/app` and reads
`anishelf-media:/data/media:ro`. qBittorrent has write access to media and separate
config/incomplete volumes, with no application-state mount. Set its save path to
`/data/media` and incomplete path to `/data/incomplete`. Its startup wrapper
initializes only those mount roots before executing the image's normal `/init`.
`ANISHELF_MEDIA_PATH` can replace the named media volume with an absolute host
directory. The new layout does not automatically migrate earlier shared volumes.
See [deployment guidance](../docs/deployment.md) for storage, TLS and migration.

## Publication flow

`.github/workflows/publish-image.yml` publishes both images when a tag matching
`v*.*.*` points to a commit in `origin/main` history. Ordinary branch pushes do
not publish images, and changing `package.json` does not create a release tag.

1. `check-main` verifies the tagged commit belongs to `main` history.
2. `verify` calls the reusable project check workflow on that commit, including
   checks, tests and builds. Failures block publication.
3. `build` builds each component natively on AMD64 (`ubuntu-24.04`) and ARM64
   (`ubuntu-24.04-arm`). Each target/architecture has a separate build cache and
   digest artifact; images are pushed to GHCR by digest.
4. After all four builds succeed, `publish` creates a multi-platform manifest
   for each component from its two architecture digests and inspects it.

Both image repositories receive full version tags, `sha-<full-commit-sha>` and,
for stable releases, `latest`. Prereleases do not update `latest`. Deploy matching
version or commit tags for the frontend and backend; shared contracts are built
from the same source revision. The old `ghcr.io/qw0er/anishelf` image is no longer
published by this workflow.

The workflow uses `GITHUB_TOKEN` with `packages: write`. Set both GHCR packages
public after their first publication if anonymous pulls are required. Publication
does not create a GitHub Release or update running containers.

```sh
docker compose pull
docker compose --profile qbittorrent stop
# Back up anishelf-app and other persistent data before continuing.
docker compose up -d --no-build
```

For source installations before the split images have been published, use
`docker compose up -d --build` instead. Keep a matching release pair and a data
backup available for rollback.
