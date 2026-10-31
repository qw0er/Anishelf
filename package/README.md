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
| [Installer](../scripts/install.pyz) | Self-contained Python CLI; renders canonical assets into a fresh deployment directory |
| [Installer sources](../scripts/installer/) | Standard-library Python implementation and tests |

Keep application data separate from media. Development and production must not use
the same app volume. Optional qBittorrent writes shared media and private incomplete
storage; Jackett has config storage only. See [volume ownership](../docs/guide/deployment.md#backup-and-recovery).

## CLI installation

The standalone Python CLI renders the canonical templates bundled at build time into
a private bundle and delegates startup to Docker Compose or rootless Podman Quadlet.
It uses only the Python standard library and never prompts. The distributable is
[`scripts/install.pyz`](../scripts/install.pyz), a zipapp built from
[`scripts/installer/`](../scripts/installer/). It does not collect credentials.
Compose bundles include an executable `manage.sh` whose project and profiles are
fixed at generation time; it supports only `up` and `down`.
Ordinary installation never overwrites deployments;
explicit `--remove DIRECTORY` and `--reconfigure DIRECTORY` actions archive saved
configuration by renaming the entire old deployment directory to a sibling backup
and preserve volumes/media. Replacement configuration uses a fresh original path. Reconfiguration retains the deployment
engine and method, preparing templates before stopping the old services. Generation-only mode
writes configuration without contacting an engine.

Installer options, SELinux and host permissions are in
[Deployment](../docs/guide/deployment.md#cli-installer). Maintainer checks:

```sh
python3 scripts/build-installer.py
python3 -m unittest discover -s scripts/installer_tests -v
npm run test:deployment
```

Rebuild `scripts/install.pyz` after changing `scripts/installer/` or
`package/deploy/`; the test suite also verifies that the packaged archive matches
the sources and templates. Fixtures use fake
engine/systemd commands; live runtime and SELinux validation remain separate.
Keep service/bootstrap logic in canonical templates and containers.

## Publication flow

[Publish images](../.github/workflows/publish-image.yml) verifies main ancestry,
runs project checks/builds, builds Web/Backend natively on AMD64 and ARM64, then
publishes both multi-platform manifests. Any failed check/build blocks publication.

| Trigger | Published tags |
| --- | --- |
| Stable `v*.*.*` tag in main history | Version, `sha-<full-SHA>`, `latest` |
| Prerelease `v*.*.*` tag in main history | Version and commit; leaves `latest` unchanged |
| Manual workflow from any branch | `testing`, `test-<full-SHA>` |
| Ordinary branch push | No images |

Deploy matching Web/Backend tags. `testing` moves with manual builds; only an image
digest identifies exact bytes. Package-version changes do not create release tags,
and publication does not update running deployments. After both image manifests
succeed, tagged publications create a GitHub Release (prereleases remain marked as
such), using the matching section of `CHANGELOG.md` as its notes. Before tagging,
give that section a heading beginning with `## <version>` and include its release
notes; missing, duplicate or empty sections block tagged publication. A date or
other suffix is optional.
Existing Releases are preserved on retries. Manual test builds do not require a
release section.

### Publish a test build

Select any branch and run **Actions → Publish container images → Run workflow**,
or:

```sh
gh workflow run publish-image.yml --ref <branch>
```

Wait for checks, all four native builds and both manifests. Use the matching tags
from the run summary, following [deployment updates](../docs/guide/deployment.md#manual-updates).
Keep a pre-update backup for database rollback.

### Publication permissions

The workflow uses `GITHUB_TOKEN` with `packages: write`. Make both GHCR packages
public after first publication if anonymous pulls are required.

## Optional Jackett

One optional container generates native configuration and its API key. Backend
reads that config volume read-only; existing saved connections/disconnects retain
precedence. First-run site initialization is conditional; see
[Jackett setup](../docs/guide/jackett-setup.md) for operator actions and preservation rules.

## Build identity and update checks

The root `package.json` is the source version. `scripts/build-info.mjs` writes
ignored build manifests before each workspace build or development startup.
Both Docker targets receive `ANISHELF_BUILD_TAG`, `ANISHELF_BUILD_COMMIT`,
`ANISHELF_BUILD_CHANNEL` and optional ISO `ANISHELF_BUILD_TIME` build arguments.
A release tag must equal `v` plus the root package version; stable builds require
a tag. Manual workflow builds use the testing channel. Untagged local builds use
the development channel. Git metadata is optional for source archives.

Settings → About displays each component's embedded identity and flags mismatches.
The authenticated `GET /api/system/info` endpoint returns the backend identity.
`POST /api/system/updates/check` queries the fixed public GitHub repository's latest
stable Release with a ten-second timeout. Successful checks are cached for five
minutes; concurrent checks share a request and failures back off for thirty seconds.
No GitHub credential is required. Network/rate-limit failures remain failures,
while a missing latest Release is shown separately. SemVer comparison applies only
to stable builds. Upgrade links lead to release notes and the deployment guide;
checking never changes the running deployment.

Backend media mounts are read-write for confirmed file/folder Move and Delete.
Installer updates regenerate both Compose and Quadlet mounts; older hand-maintained
bundles must replace Backend media `:ro` with `:rw` and recreate/restart Backend.
Credential/configuration mounts remain read-only. Host media ownership is unchanged;
grant the container user directory write/search access and retain shared SELinux
labels. See [file operations](../docs/guide/operations.md#move-and-delete-originals).
