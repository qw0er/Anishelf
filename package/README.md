# Container packaging

## Published images

The GitHub Actions workflow in `.github/workflows/publish-image.yml` builds this
Dockerfile and publishes a multi-platform Linux image for AMD64 and ARM64 to
`ghcr.io/qw0er/anishelf` when a
version tag such as `v0.2.2` is pushed. It publishes the full version (`0.2.2`)
and the source commit (`sha-<full-commit-sha>`). Stable versions also update
`latest`; prereleases such as `v0.2.2-rc.1` publish `0.2.2-rc.1` without updating
`latest`. Image names follow the repository owner/name and are lowercased.
Both architectures share the same tags; Docker selects the matching image when
pulling. ARM64 builds use QEMU emulation on the AMD64 runner.

Commit the workflow before tagging the intended release commit:

```sh
git tag v0.2.2
git push origin v0.2.2
```

The workflow uses the repository's `GITHUB_TOKEN` with `packages: write`; no
additional registry secret is required. For anonymous pulls, set the GHCR
package visibility to public after the first publication. An existing package
must grant this repository Actions access if it was created separately.

```sh
docker pull ghcr.io/qw0er/anishelf:0.2.2
```

Use that image in place of `anishelf:local` in the run command below. Publishing
does not update running containers or run the project's check/test commands.
The Dockerfile builds both workspaces as part of image construction.

## Local build and deployment

Build from the repository root:

```sh
docker build -f package/Dockerfile -t anishelf:local .
```

The image includes Node.js 24, FFmpeg/FFprobe, production backend dependencies,
database migrations and the built frontend. The image sets `ANISHELF_FRONTEND_DIR=/app/web/dist`, so Node hosts both pages and APIs.
GPU acceleration requires additional host/device configuration.

The current backend accepts only loopback listeners. On Linux, use host networking
so the host's shared Caddy can reach `127.0.0.1:3000`; port publishing with `-p`
does not work with this listener configuration.

```sh
docker volume create anishelf-data
docker run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 \
  -e ANISHELF_PORT="${ANISHELF_PORT:-3000}" \
  --mount type=volume,source=anishelf-data,target=/data \
  --mount type=bind,source=/absolute/media/path,target=/media,readonly \
  anishelf:local
```

Open `http://127.0.0.1:3000` and configure `/media` as the media directory.
The current access policy supports local access or SSH forwarding.
To use a different port, set `ANISHELF_PORT=3001` in your shell before running
the command above, or replace its `-e` option with `-e ANISHELF_PORT=3001`.
The default is 3000; valid ports range from 1 to 65535. The listener and image
health check both use this variable. With host networking, the selected port is
also the host port: open `http://127.0.0.1:3001` and point Caddy's upstream to
`127.0.0.1:3001`. No image rebuild is required to change the port.

The process runs as the image's `node` user (UID/GID 1000). Media mounts must be
readable by that user. Bind-mounted data directories must also be writable by it.
On SELinux hosts, apply an appropriate container label to bind mounts.
Keep `/data` persistent across updates; it contains settings, SQLite and caches.
Stop the container and back up data before an update. Older images may require
restoring the matching backup after database migrations.
