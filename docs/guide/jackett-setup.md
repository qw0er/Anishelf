# Jackett Setup

Jackett supplies ordered source sites for subscriptions. Use a bundled service or
connect your own, then select sites in Anishelf.

## External connection

1. Open **Settings → Jackett sources** and enter the Backend-reachable API URL and key.
2. Optionally save a browser-reachable management URL; it may differ from the API URL.
3. Save, then choose **Test connection and load sites**.
4. Select sites, order them with the arrows and save.
5. Use **Search diagnostics** to check support and run a title search.

| Check | What it proves |
| --- | --- |
| Test connection/load sites | API access and configured-site enumeration |
| Search support | Site capabilities |
| Title search | Actual results, no matches, failures or limited coverage for that query |

Diagnostics do not create subscriptions. Discovery uses the saved site order and
pins the first eligible site; it does not merge releases across sites. Manage site
credentials, cookies and Jackett's administrator password in Jackett itself.

Omitting the key retains it; changing the API address requires a key. Changing or
clearing the connection invalidates old unsent source bindings/references.

## Bundled service

Select Jackett in the installer, or set `COMPOSE_PROFILES=jackett` in the saved
Compose `.env` (`qbittorrent,jackett` enables both), then run:

```sh
docker compose up -d
```

For Quadlet, install `anishelf-jackett-init.container` and
`anishelf-jackett.container` alongside the config volume,
reload systemd and restart `anishelf.target`. See [Deployment](deployment.md#podman-quadlet).

| Setting | Value |
| --- | --- |
| Image | `ghcr.io/linuxserver/jackett:latest` |
| Backend API | `http://jackett:9117/` |
| Browser WebUI | `http://localhost:9117`; tunnel/protect access on remote hosts |
| Compose host listener | `JACKETT_BIND_ADDRESS` / `JACKETT_PORT`; default `127.0.0.1:9117` |
| Persistent storage | `anishelf-jackett-config`; contains API key and site credentials |
| Updates | Pull/recreate container; in-container updates are disabled |

Backend reads native `/config/Jackett/ServerConfig.json` through a read-only mount
at `/run/jackett-config`. It imports the generated key without blocking startup.
Backend/playback remain available while Jackett is unavailable.

## First-run behavior and recovery

| Situation | Behavior / action |
| --- | --- |
| No saved connection | Native bundled credentials can be imported automatically |
| Saved external connection or disconnect | Preserved across restart; choose **Use bundled Jackett** to switch explicitly |
| Empty config volume at deployment | Initializer records first-run permission before Jackett starts; Backend adds Nyaa.si once regardless of startup timing |
| Existing volume without a first-run marker | Connection import only; configure sites manually or choose **Retry adding Nyaa.si** in Settings |
| Removed site | Remains removed after restart |
| Key rotation or administrator password set | Review manually; existing saved credentials are not silently replaced |
| Temporary outage or uncertain initialization response | Retry with backoff; check configured sites before another add, and verify the site after adding |

For an installation already reporting manual setup, choose **Use bundled Jackett**
if needed, then **Retry adding Nyaa.si**. This explicitly authorizes site setup;
it requires no Jackett administrator password. Refresh Settings after setup, then
load/select sites and save. With an administrator password, add the site in Jackett
management instead. Selecting the bundled connection alone does not retry setup.

Back up Jackett configuration together with app state. App state includes the
private one-time initialization journal. Inspect Backend/Jackett logs and the
Settings diagnostics when setup stalls.

## Upgrade from older bundles

| Deployment | Cleanup |
| --- | --- |
| Compose | Recreate with `--remove-orphans` after updating the template |
| Quadlet | Replace the old `anishelf-jackett-init.container` with the current initializer; stop/remove old `anishelf-jackett-provision.container`, then reload |
| Backend config | Replace the old connection-file variable with `ANISHELF_BUNDLED_JACKETT_CONFIG_FILE` |
| Old connection volume | Keep until verified; `anishelf-jackett-connection` is no longer used |

Preserve native configuration and app state. Follow [deployment updates](deployment.md#updates)
for backups and image handling. Internal contracts and historical verification are in
[Architecture](../development/architecture.md#sources-api-and-lifecycle) and
[History](../history.md#automatic-acquisition-archive-notes).
