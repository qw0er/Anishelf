# Container Packaging

For installation, maintenance, updates and removal, use the
[deployment guide](../docs/guide/deployment.md). This reference covers image and
installer maintenance.

## Images and build targets

| Dockerfile target | Release image | Contents |
| --- | --- | --- |
| `backend` | `ghcr.io/qw0er/anishelf-backend` | Node.js 24, backend, production dependencies, migrations, FFmpeg/FFprobe |
| `web` | `ghcr.io/qw0er/anishelf-web` | Caddy 2, built SPA and `package/Caddyfile` |

Both images support Linux AMD64/ARM64 and run as UID/GID 1000. Web listens on 8080
and proxies `/api` to private Backend:3000. Only Backend mounts app/media state;
its image does not enable Node frontend hosting. Both have health checks.

```sh
# From the repository root
docker build -f package/Dockerfile --target backend -t anishelf-backend:local .
docker build -f package/Dockerfile --target web -t anishelf-web:local .
```

| Asset | Purpose |
| --- | --- |
| [Root Compose](../compose.yaml) | Build and run the checkout |
| [Deployment Compose](deploy/compose.yaml) | Pull published images; matching app tags via `ANISHELF_TAG` |
| [Environment example](deploy/.env.example) | Host paths, ports, profiles and origin |
| [Quadlet units](deploy/quadlet/) | Rootless systemd stack, managed through `anishelf.target` |
| [Installer](install.sh) | Render canonical assets into a fresh deployment directory |

Keep application data separate from media. Development and production must not use
the same app volume. Optional qBittorrent writes shared media and private incomplete
storage; Jackett has config storage only. See [volume ownership](../docs/guide/deployment.md#storage-updates-and-recovery).

## Interactive installation

The standalone Bash wizard resolves templates to one GitHub commit, renders a
private bundle and delegates startup to Docker/Podman Compose or rootless Quadlet.
It does not collect credentials or overwrite deployments. Generation-only mode
writes configuration without contacting an engine.

Installer options, SELinux and host permissions are in
[Deployment](../docs/guide/deployment.md#interactive-installer). Maintainer checks:

```sh
bash -n package/install.sh
npm run test:deployment
```

Fixtures use fake engine/network commands; live runtime and SELinux validation
remain separate. Keep service/bootstrap logic in canonical templates and containers.

## Publication flow

[Publish images](../.github/workflows/publish-image.yml) verifies main ancestry,
runs project checks/builds, builds Web/Backend natively on AMD64 and ARM64, then
publishes both multi-platform manifests. Any failed check/build blocks publication.

| Trigger | Published tags |
| --- | --- |
| Stable `v*.*.*` tag in main history | Version, `sha-<full-SHA>`, `latest` |
| Prerelease tag | Version and commit; leaves `latest` unchanged |
| Manual workflow from main | `testing`, `test-<full-SHA>` |
| Ordinary branch push / manual run from another ref | No images |

Deploy matching Web/Backend tags. `testing` moves with manual builds; only an image
digest identifies exact bytes. Package-version changes do not create release tags,
and publication does not create a GitHub Release or update running deployments.

### Publish a test build

Commit/push to main, then run **Actions → Publish container images → Run workflow**,
or:

```sh
gh workflow run publish-image.yml --ref main
```

Wait for checks, all four native builds and both manifests. Use the matching tags
from the run summary, following [deployment updates](../docs/guide/deployment.md#updates).
Keep a pre-update backup for database rollback.

### Publication permissions

The workflow uses `GITHUB_TOKEN` with `packages: write`. Make both GHCR packages
public after first publication if anonymous pulls are required.

## Optional Jackett

One optional container generates native configuration and its API key. Backend
reads that config volume read-only; existing saved connections/disconnects retain
precedence. First-run site initialization is conditional; see
[Jackett setup](../docs/guide/jackett-setup.md) for operator actions and preservation rules.
