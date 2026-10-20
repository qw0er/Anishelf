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

Use [compose.yaml](../compose.yaml) to build and run the pair together. Replace
the media bind source and set the backend's `ANISHELF_PUBLIC_ORIGIN` to your
browser-facing origin before starting. The default is `http://localhost:3000`.
Compose also starts qBittorrent and seeds its browser WebUI link with `ANISHELF_INITIAL_QBITTORRENT_WEBUI_URL` on fresh
installations. This third-party image is pulled rather than built by this project.
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
docker compose stop
# Back up anishelf-data before continuing.
docker compose up -d --no-build
```

For source installations before the split images have been published, use
`docker compose up -d --build` instead. Keep a matching release pair and a data
backup available for rollback.
