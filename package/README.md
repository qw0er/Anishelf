# Container packaging

## Published images

The GitHub Actions workflow in `.github/workflows/publish-image.yml` builds this
Dockerfile and publishes a multi-platform Linux image for AMD64 and ARM64 to
`ghcr.io/qw0er/anishelf` when a
version tag such as `v0.2.2` is pushed and its commit belongs to `main` history.
Tags on commits outside `main` skip the build and publication job; ordinary branch
pushes do not trigger publication. It publishes the full version (`0.2.2`)
and the source commit (`sha-<full-commit-sha>`). Stable versions also update
`latest`; prereleases such as `v0.2.2-rc.1` publish `0.2.2-rc.1` without updating
`latest`. Image names follow the repository owner/name and are lowercased.
Both architectures share the same tags; Docker selects the matching image when
pulling. ARM64 builds use QEMU emulation on the AMD64 runner.

Commit the workflow and push the intended release commit to `main` before tagging:

```sh
git switch main
git push origin main
git tag v0.2.2
git push origin v0.2.2
```

The workflow uses the repository's `GITHUB_TOKEN` with `packages: write`; no
additional registry secret is required. For anonymous pulls, set the GHCR
package visibility to public after the first publication. An existing package
must grant this repository Actions access if it was created separately.

```sh
docker pull ghcr.io/qw0er/anishelf:latest
```

Deployment instructions for Docker, Compose, Podman and Quadlet are in the
[top-level README](../README.md#deploy-with-a-container), including the public-origin
configuration required for [Caddy domain access](../README.md#caddy-reverse-proxy).
Publishing does not
update running containers or run the project's check/test commands.
The Dockerfile builds both workspaces as part of image construction.

## Local image build

Build from the repository root:

```sh
docker build -f package/Dockerfile -t anishelf:local .
```

The image includes Node.js 24, FFmpeg/FFprobe, production backend dependencies,
database migrations and the built frontend. It sets
`ANISHELF_FRONTEND_DIR=/app/web/dist` so Node serves pages and APIs together.
Use `anishelf:local` in the [deployment examples](../README.md#deploy-with-a-container).
