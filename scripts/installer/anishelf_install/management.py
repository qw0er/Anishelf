"""Shared lifecycle commands for saved Compose and Quadlet deployments."""

from __future__ import annotations

from .config import Settings
from .errors import InstallerError
from .log import LOG, log
from .runtime import compose, health_check, need, pull_quadlet_images, run
from .validation import is_regular_file


def manage(settings: Settings, command: str, *, update_all: bool = False) -> None:
    LOG.set_file(settings.deploy_dir / "manage.log")
    LOG.phase = f"{command} {settings.method} deployment"
    log(f"Managing {settings.stack}: action={command}; tag={settings.image_tag}; update all={update_all}")
    if settings.method == "compose":
        need("docker")
        compose(settings.engine, settings.stack, settings.deploy_dir, ["config", "--quiet"])
        if command == "update":
            services = [] if update_all else ["backend", "web"]
            compose(settings.engine, settings.stack, settings.deploy_dir, ["pull", *services])
            # Do not recreate dependencies (especially downloader/bootstrap services)
            # during an application-only update.
            options = [] if update_all else ["--no-deps"]
            compose(settings.engine, settings.stack, settings.deploy_dir, ["up", "-d", *options, *services])
        else:
            options = ["up", "-d"] if command == "up" else ["down", "--remove-orphans"]
            compose(settings.engine, settings.stack, settings.deploy_dir, options)
    else:
        need("podman")
        need("systemctl")
        bundle = {}
        for unit in sorted((settings.deploy_dir / "quadlet").iterdir()):
            destination = (settings.systemd_dir if unit.suffix == ".target" else settings.quadlet_dir) / unit.name
            if not is_regular_file(destination) or destination.read_bytes() != unit.read_bytes():
                raise InstallerError(f"Quadlet unit is missing or differs from the bundle: {destination}; install or reconcile it first.")
            if unit.suffix == ".container":
                bundle[f"quadlet/{unit.name}"] = unit.read_text(encoding="utf-8")
        if command == "update":
            selected = bundle if update_all else {
                name: text for name, text in bundle.items()
                if name in {f"quadlet/{settings.stack}-backend.container", f"quadlet/{settings.stack}-web.container"}
            }
            pull_quadlet_images(selected, settings.engine)
            services = [f"{settings.stack}-backend.service", f"{settings.stack}-web.service"]
            if update_all:
                if settings.qbit:
                    services.append(f"{settings.stack}-qbittorrent.service")
                if settings.jackett:
                    services.append(f"{settings.stack}-jackett.service")
            run(["systemctl", "--user", "restart", *services])
        else:
            run(["systemctl", "--user", "start" if command == "up" else "stop", f"{settings.stack}.target"])
        if command != "down":
            services = [f"{settings.stack}-backend.service", f"{settings.stack}-web.service"]
            if settings.qbit:
                services.append(f"{settings.stack}-qbittorrent.service")
            if settings.jackett:
                services.append(f"{settings.stack}-jackett.service")
            run(["systemctl", "--user", "is-active", "--quiet", *services])
    if command != "down":
        LOG.phase = "checking application health"
        health_check(settings)
    log(f"Deployment {command} completed successfully.")
