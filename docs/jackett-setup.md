# Jackett service setup

Date: 2026-10-23. Stage 3 delivers external connection settings and an optional
bundled service. [Stage 4 search subscriptions](search-subscriptions.md) adds the
manual acquisition workflow. Watching automation remains later work.

## External connection

Open **Settings → Jackett sources**. Enter the API base URL reachable from the
backend and the API key from Jackett. Optionally save a browser-reachable management
URL; the backend address and browser address can differ. Management links accept
HTTP(S) URLs without embedded credentials. An omitted key retains the current key;
changing the API address requires entering a key explicitly. Saved keys are never
returned to the browser or placed in query/mutation variables.

Save, then use **Test connection and load sites**. This lists sites already configured
in Jackett; it proves API access, not successful upstream searches. Choose sites,
order them with the arrows and save. Under **Search diagnostics**, check search
support and run a title search. The UI distinguishes capability support, matches,
no matches, limited coverage and failures. Diagnostics never create subscriptions
or authorize downloads. The order is saved for the later source-selection workflow;
this stage does not automatically rank or select sites for an anime.

Manage tracker credentials, cookies, site configuration and the Jackett administrator
password in Jackett itself. Anishelf does not provision or modify an external service.
Clearing or changing a connection advances its revision; old search bindings and
unsent download references cannot silently inherit a different service or credentials.

## Optional bundled Compose service

For this checkout:

```sh
docker compose --profile jackett up -d --build
```

For a published release containing this feature:

```sh
docker compose -f package/deploy/compose.yaml --profile jackett up -d
```

Combine `--profile qbittorrent --profile jackett` or set
`COMPOSE_PROFILES=qbittorrent,jackett` when both optional services are wanted.
The Jackett management port defaults to `127.0.0.1:9117`. Change `JACKETT_PORT` and
optionally `JACKETT_BIND_ADDRESS` in the deployment environment. The backend uses
`http://jackett:9117/`; a browser on another machine needs a protected public address
or an SSH tunnel for management access.

There is **one optional Jackett container**, using
`ghcr.io/linuxserver/jackett:latest`. Pull and recreate it to update. In-container
binary updates are disabled with `AUTO_UPDATE=false`. `UMASK=077` restricts new
configuration files. Jackett receives only its configuration volume, without media
or incomplete-download mounts. Backend startup and playback do not depend on it.
The backend image contains neither Jackett binaries nor a separate init script.

## Native configuration and connection import

Jackett owns `/config/Jackett/ServerConfig.json` in `anishelf-jackett-config` and
generates its own API key. Backend mounts that same volume **read-only** at
`/run/jackett-config` and reads
`ANISHELF_BUNDLED_JACKETT_CONFIG_FILE=/run/jackett-config/Jackett/ServerConfig.json`.
Both services use UID/GID 1000. Backend never writes the native config or sets the
Jackett administrator password. Treat the complete configuration volume as secret.

Sources starts one background worker without awaiting file availability or service
readiness. It validates a bounded native JSON file and imports its key only when
no connector configuration has ever been saved. External connections, selected
sites, saved keys and explicit disconnects survive restart. **Use bundled Jackett**
explicitly imports the current native key using the current connector revision;
key rotation does not silently replace an existing saved connection.
Availability describes the local native configuration, not service health.
Connection and search diagnostics remain explicit operations.

## One-time site initialization

A private journal in the Anishelf data directory,
`acquisition/jackett-bootstrap.json`, records first-run authorization and progress.
It contains a key fingerprint, never the key or management session cookie. It uses
0700 directories and a 0600 file; preserve it with application state.

- When the worker observes that native configuration is absent, it records `waiting`.
  After Jackett creates the file, it records `pending` and may initialize Nyaa.si
  (`nyaasi`) on the active bundled connection.
- If native configuration already exists on the very first observation, it imports
  the connection but records `manual`, leaving all sites untouched. This also applies
  when Jackett starts faster than Backend on an otherwise fresh installation.
  Finish site setup in Jackett, then load and select sites in Settings.
- A saved external connection or explicit disconnect prevents automatic import and
  management changes. Switching explicitly to the bundle can resume an authorized
  pending setup; it does not grant first-run authorization to an existing service.
- A changed native key or configured administrator password requires manual site
  review. Backend does not bypass management authentication.

For authorized initialization the worker obtains a first-run Jackett WebUI session,
checks configured sites, reads Nyaa.si defaults and submits the site configuration.
Torznab API-key authentication is separate from this management session. Existing
sites are preserved. The worker writes `attempted` **before** the mutation and
`complete` after success. Once attempted, a lost response or restart requires manual
review instead of repeating the mutation. Completed setup never recreates a removed
site, including after container or Backend restarts.

File/readiness failures retry with exponential backoff from five seconds to five
minutes. Requests have ten-second timeouts, bounded responses and generation fences.
Disconnecting/changing the connector aborts current setup; shutdown cancels and drains
the worker. Logs expose event names and safe status information, never API keys,
session cookies or service response bodies.

```sh
docker compose --profile jackett logs backend jackett
```

Application events include `acquisition.jackett_connection_saved`,
`acquisition.jackett_bootstrap_unavailable`, `acquisition.jackett_setup_completed`,
`acquisition.jackett_setup_review_required` and
`acquisition.jackett_bootstrap_identity_changed`.
Back up the Jackett config volume together with application state.

## Optional rootless Quadlet and upgrade

The core backend needs `anishelf-jackett-config.volume` for the read-only mount,
even when the optional service is disabled. Install `anishelf-jackett.container`
to enable Jackett. Both files belong in `~/.config/containers/systemd/`;
`anishelf.target` remains in `~/.config/systemd/user/`. Reload and restart the target.
Jackett joins it through `WantedBy`/`PartOf` without a backend dependency. Edit the
loopback `PublishPort` only to change browser management access.

When upgrading from the earlier three-container draft, recreate Compose with
`--remove-orphans`. For Quadlet, stop and remove previously installed
`anishelf-jackett-init.container` and `anishelf-jackett-provision.container`, then
reload systemd. Do not delete Jackett configuration or application state. The old
`anishelf-jackett-connection` volume and its unit are no longer used; retain them
until the new deployment is verified. Replace the old connection-file environment
variable with the native config-file variable above. Existing saved connections
remain authoritative; an existing native configuration never triggers site writes.

## Verification and limits

Automated checks cover native credential import, conservative existing-instance
handling, first-run initialization, external/disconnect precedence, uncertain
writes, already configured sites, credential rotation, cancellation and shutdown.
Deployment tests assert one optional Jackett service, `latest`, a read-only backend
config mount and independent backend startup.

Isolated live acceptance on 2026-10-23 used `latest`, reporting LinuxServer build
`v0.24.2900-ls14` and manifest digest
`sha256:f94a4f018badb1b92c2e8d81780b16eefeeae2a7c4c2938645cedf75fb84e868`.
Jackett generated its native key; the real backend worker imported it and configured
Nyaa.si. Torznab configured-site enumeration and capabilities succeeded. With
`UMASK=077`, native configuration was owned by UID/GID 1000 with mode 0600. After
deleting the site and restarting Jackett, the backend worker made zero management
requests and preserved its absence. Both temporary containers and credentials
were removed. Compose parsing and rootless Quadlet generation also passed.
This does not establish a complete application-image deployment, browser visual
acceptance, upstream search results, or download/ingestion/playback acceptance.

Upstream references: [LinuxServer Jackett image](https://docs.linuxserver.io/images/docker-jackett/),
[server configuration model](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Models/Config/ServerConfig.cs),
[management controller](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Server/Controllers/IndexerApiController.cs),
[first-run session handling](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Server/Controllers/UIController.cs).
