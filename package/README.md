# Container packaging

## Published images

The GitHub Actions workflow in `.github/workflows/publish-image.yml` builds this
Dockerfile and publishes a multi-platform Linux image for AMD64 and ARM64 to
`ghcr.io/qw0er/anishelf` when a
version tag such as `v0.2.6` is pushed and its commit belongs to `main` history.
Tags on commits outside `main` skip the build and publication job; ordinary branch
pushes do not trigger publication. It publishes the full version (`0.2.6`)
and the source commit (`sha-<full-commit-sha>`). Stable versions also update
`latest`; prereleases such as `v0.2.6-rc.1` publish `0.2.6-rc.1` without updating
`latest`. Image names follow the repository owner/name and are lowercased.
Both architectures share the same tags; Docker selects the matching image when
pulling.

### Publication flow

1. Pushing a tag matching `v*.*.*` triggers the workflow. Changing the version in
   `package.json` does not create a tag or trigger publication.
2. The `check-main` job checks whether the tagged commit is an ancestor of
   `origin/main`. Any commit in that history is eligible; it does not have to be
   the latest commit. Tags outside that history skip the build and publish jobs.
3. The `verify` job calls the reusable `check.yml` workflow on the tagged commit.
   It installs Node.js 24, FFmpeg/FFprobe and native build dependencies, then runs
   `npm ci`, `npm run check` and `npm run build`. Failed checks block image builds
   and publication, even if a different commit on `main` passed earlier.
4. The `build` job runs two native builds in parallel: AMD64 on `ubuntu-24.04`
   and ARM64 on `ubuntu-24.04-arm`. Each uses Docker Buildx and
   `package/Dockerfile`, caches layers separately by architecture, pushes its
   image to GHCR by digest, and uploads the digest as a workflow artifact.
5. After both builds succeed, the `publish` job downloads their digests and uses
   `docker buildx imagetools create` to publish the multi-platform manifest under
   the version and commit tags described above. It then inspects the manifest.
   A failed architecture build prevents this final publication.

### Release commands

Commit the workflow and push the intended release commit to `main` before tagging:

```sh
git switch main
git push origin main
git tag v0.2.6
git push origin v0.2.6
```

The workflow uses the repository's `GITHUB_TOKEN` with `packages: write`; no
additional registry secret is required. For anonymous pulls, set the GHCR
package visibility to public after the first publication. An existing package
must grant this repository Actions access if it was created separately.

```sh
docker pull ghcr.io/qw0er/anishelf:latest
```

Primary deployment instructions for Docker Compose and rootless Podman Quadlet
are in the [top-level README](../README.md#deploy-with-a-container).
See [additional deployment guidance](../docs/deployment.md) for CLI deployments,
rootful Quadlet, backups, migration and
[Caddy domain access](../docs/deployment.md#caddy-reverse-proxy).

The same check workflow also runs for pull requests targeting `main` and pushes
to `main`. It includes Biome, architecture and unused-code checks, type checking,
architecture-rule tests and both workspace test suites, including real media
tests when their tools are available. CI explicitly verifies FFmpeg/FFprobe before
running the tests. These checks run on Linux AMD64; the image build separately
validates compilation for both supported architectures.

The Dockerfile installs dependencies and builds both workspaces as part of image
construction. Publication does not create a GitHub Release or
update running containers. Update deployed instances using the deployment guide.

## Local image build

Build from the repository root:

```sh
docker build -f package/Dockerfile -t anishelf:local .
```

The image includes Node.js 24, FFmpeg/FFprobe, production backend dependencies,
database migrations and the built frontend. It sets
`ANISHELF_FRONTEND_DIR=/app/web/dist` so Node serves pages and APIs together.
Use `anishelf:local` in the [deployment examples](../README.md#deploy-with-a-container).
