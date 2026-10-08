# Additional container deployment guidance

The primary deployment paths are [Docker Compose and rootless Podman Quadlet](../README.md#deploy-with-a-container).
Use the shared image, networking, media permissions and environment guidance there.
This document covers alternate deployment methods and operational details.

## Data storage

Anishelf requires a persistent writable `/data`; both named volumes and bind
mounts satisfy this requirement. The primary examples use named volumes for
consistent lifecycle management. The alternate Podman examples below use bind
mounts when an explicit host directory is useful for backups or storage placement.
`keep-id` lets the dedicated account own a rootless bind mount while the
application runs as UID/GID 1000 inside the container.

Named volumes are isolated by runtime and, for rootless Podman, by account.
Run Podman volume commands as the service account; `sudo podman` uses different
storage. Never mount the same application data in two running instances.

## Data backup and migration

Stop the application before copying data so the database and caches are consistent.
For Docker Compose, run `docker compose stop`, then export the volume to the
current directory with a temporary container:

```sh
docker run --rm --user 0:0 \
  --mount type=volume,source=anishelf-data,target=/data,readonly \
  --mount "type=bind,source=$PWD,target=/backup" \
  --entrypoint tar ghcr.io/qw0er/anishelf:latest \
  -C /data -czf /backup/anishelf-data-backup.tar.gz .
```

For rootless Quadlet, run `systemctl --user stop anishelf.service` and
`podman volume export anishelf-data --output anishelf-data-backup.tar` as `anishelf`.
For bind mounts, back up the entire host data directory after stopping the service.
Keep backups outside the data volume and retain the previous image version for rollback.

Existing bind-mount deployments are not migrated automatically. Stop the old
instance and back up its data before switching the Quadlet configuration.
As `anishelf`, create and import a fresh destination volume:

```sh
podman volume create anishelf-data
tar -C "$HOME/.local/share/anishelf" -cf anishelf-data-migration.tar .
podman volume import anishelf-data anishelf-data-migration.tar
```

Use an empty destination volume. Then install the `.volume` file and updated
`.container` file from the README, reload the user service manager and start the
service. Confirm settings and the library before removing the old directory.
When moving from another account or rootful deployment, an administrator must
copy the stopped data to a location readable by `anishelf` first and adjust its
ownership. Do not reuse another account's Podman storage directory.

## Docker CLI

```sh
docker pull ghcr.io/qw0er/anishelf:latest
docker volume create anishelf-data
docker run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 \
  -e ANISHELF_PORT=3000 \
  -e ANISHELF_INITIAL_RESOURCE_ROOT=/media \
  -e ANISHELF_PUBLIC_ORIGIN=https://example.com \
  --mount type=volume,source=anishelf-data,target=/data \
  --mount type=bind,source=/absolute/media/path,target=/media,readonly \
  ghcr.io/qw0er/anishelf:latest
docker ps --filter name=anishelf
docker logs -f anishelf
```

For SELinux mount options, see [SELinux mounts](#selinux-mounts).

To update:

```sh
docker pull ghcr.io/qw0er/anishelf:latest
docker stop --time 15 anishelf
```

Back up `anishelf-data`, then run `docker rm anishelf` and repeat the `docker run`
command. Keep the data volume.

## Podman CLI

#### Rootless CLI

Complete the [dedicated service account setup](../README.md#dedicated-service-account), then run as
`anishelf`:

```sh
mkdir -p ~/.local/share/anishelf
podman pull ghcr.io/qw0er/anishelf:latest
podman run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 \
  --userns keep-id:uid=1000,gid=1000 --user 1000:1000 \
  -e ANISHELF_PORT=3000 \
  -e ANISHELF_INITIAL_RESOURCE_ROOT=/media \
  -e ANISHELF_PUBLIC_ORIGIN=https://example.com \
  -v "$HOME/.local/share/anishelf:/data" \
  -v /absolute/media/path:/media:ro \
  ghcr.io/qw0er/anishelf:latest
podman ps --filter name=anishelf
podman logs -f anishelf
```

#### Rootful CLI

From your administrator account, create a fresh data directory owned by
UID/GID 1000:

```sh
sudo install -d -m 0750 -o 1000 -g 1000 /var/lib/anishelf
sudo podman pull ghcr.io/qw0er/anishelf:latest
sudo podman run -d --name anishelf --restart unless-stopped \
  --network host --stop-timeout 15 --user 1000:1000 \
  -e ANISHELF_PORT=3000 \
  -e ANISHELF_INITIAL_RESOURCE_ROOT=/media \
  -e ANISHELF_PUBLIC_ORIGIN=https://example.com \
  -v /var/lib/anishelf:/data \
  -v /absolute/media/path:/media:ro \
  ghcr.io/qw0er/anishelf:latest
sudo podman ps --filter name=anishelf
sudo podman logs -f anishelf
```

For updates, pull `latest`, stop with `podman stop --time 15 anishelf`, back up
that deployment's data directory, remove with `podman rm anishelf`, and repeat
its run command. Prefix Podman commands with `sudo` for the root deployment.
Use [rootless Quadlet](../README.md#podman-quadlet-rootless) for systemd-managed startup at boot.

## Rootful Podman Quadlet

Use Podman with Quadlet support on Linux with systemd and cgroup v2.
The `[Install]` section enables startup
at boot; start the generated service without running `systemctl enable`.

#### Quadlet as root

Prepare a fresh data directory and the system configuration directory:

```sh
sudo mkdir -p /etc/containers/systemd
sudo install -d -m 0750 -o 1000 -g 1000 /var/lib/anishelf
```

Save `/etc/containers/systemd/anishelf.container`:

```ini
[Unit]
Description=Anishelf media server

[Container]
Image=ghcr.io/qw0er/anishelf:latest
ContainerName=anishelf
Network=host
User=1000:1000
Environment=ANISHELF_PORT=3000
Environment=ANISHELF_INITIAL_RESOURCE_ROOT=/media
Environment=ANISHELF_PUBLIC_ORIGIN=https://example.com
Volume=/var/lib/anishelf:/data
Volume=/absolute/media/path:/media:ro
StopTimeout=15

[Service]
Restart=on-failure
TimeoutStartSec=900
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Rootful Podman uses the system service manager; the application still runs as
UID/GID 1000 inside the container. Ensure that user can read the media directory.

```sh
sudo systemctl daemon-reload
sudo systemctl start anishelf.service
sudo systemctl status anishelf.service
sudo journalctl -u anishelf.service -f
```

The install target starts the service on subsequent boots. Check container health
with `sudo podman inspect --format '{{.State.Health.Status}}' anishelf`.
To update, run `sudo systemctl stop anishelf.service`, back up `/var/lib/anishelf`,
then run:

```sh
sudo podman pull ghcr.io/qw0er/anishelf:latest
sudo systemctl start anishelf.service
sudo systemctl status anishelf.service
```

If you edit the Quadlet file, run `sudo systemctl daemon-reload` before starting.

## SELinux mounts

On SELinux enforcing hosts, named data volumes are managed by the runtime.
For rootless Quadlet, keep `:U` and add `:Z` for private data; use `:ro,z` for
shared media:

```ini
Volume=anishelf-data.volume:/data:Z,U
Volume=/absolute/media/path:/media:ro,z
```

For rootful Quadlet, use `/var/lib/anishelf:/data:Z`. For CLI deployments, use
`-v` mounts with the same `:Z` and `:ro,z` suffixes. For Docker Compose, add `selinux: z` under the media mount's `bind` options.
For Docker CLI, replace the media `--mount` with
`-v /absolute/media/path:/media:ro,z`. Relabeling changes host file labels;
ensure the directory allows it and that other services can still access it.

## Caddy reverse proxy

Set `ANISHELF_PUBLIC_ORIGIN=https://example.com` in your deployment and
restart it. Configure Caddy on the same host to protect the application:

```caddyfile
example.com {
    basic_auth {
        qwer <password-hash>
    }
    reverse_proxy 127.0.0.1:3000
}
```

Generate `<password-hash>` with `caddy hash-password`, then validate and reload
Caddy. Use your exact public origin, including a non-default port if needed.
Keep Host and Origin headers unchanged. Anishelf has no built-in authentication.

### External players without authentication

External-player links do not include the browser's Basic Auth credentials.
To make original media accessible without authentication, use:

```caddyfile
example.com {
    @protected {
        not path /api/media/*
    }

    basic_auth @protected {
        qwer <password-hash>
    }
    reverse_proxy 127.0.0.1:3000
}
```

Anyone with an original media URL can access that file. Pages, settings,
prepared media and subtitles remain authenticated.


See the [Docker volume reference](https://docs.docker.com/engine/storage/volumes/)
and [Podman Quadlet reference](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html)
for volume lifecycle and supported unit keys.
