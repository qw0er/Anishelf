"""Container-engine and systemd interactions for the installer."""

from __future__ import annotations

import os
import platform
import shlex
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from .config import Settings
from .errors import InstallerError
from .log import LOG, log
from .validation import (
    exists,
    is_regular_file,
    known_unit,
    read_single_quoted_env,
    unique_backup_path,
)

_ENV_KEYS_TO_CLEAR = (
    "ANISHELF_TAG",
    "ANISHELF_BIND_ADDRESS",
    "ANISHELF_PORT",
    "ANISHELF_PUBLIC_ORIGIN",
    "ANISHELF_MEDIA_PATH",
    "ANISHELF_ALLOWED_HOSTS",
    "ANISHELF_WEB_TRUSTED_PROXIES",
    "COMPOSE_FILE",
    "COMPOSE_PROJECT_NAME",
    "COMPOSE_PROFILES",
    "ANISHELF_TRUSTED_PROXIES",
    "QBITTORRENT_WEBUI_PORT",
    "QBITTORRENT_PEER_PORT",
    "QBITTORRENT_BIND_ADDRESS",
    "QBITTORRENT_TAG",
    "JACKETT_PORT",
    "JACKETT_BIND_ADDRESS",
)


def need(command: str) -> None:
    if shutil.which(command) is None:
        raise InstallerError(f"Required command is missing: {command}")


def run(
    args: list[str],
    *,
    env: dict[str, str] | None = None,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    LOG.log(f"Running: {shlex.join(args)}")
    completed = subprocess.run(
        args,
        env=env,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        check=False,
    )
    if check and completed.returncode != 0:
        detail = ""
        if capture and completed.stderr:
            detail = f": {completed.stderr.strip()}"
        raise InstallerError(
            f"Command failed with status {completed.returncode}: "
            f"{shlex.join(args)}{detail}"
        )
    return completed


def detect_engine(explicit: str | None) -> tuple[str, str]:
    """Return ``(engine, method)`` without prompting.

    Auto-detection is unambiguous only when exactly one engine is installed.
    """

    if explicit:
        if explicit not in {"docker", "podman"}:
            raise InstallerError("Engine must be docker or podman.")
        engine = explicit
    else:
        available = [name for name in ("docker", "podman") if shutil.which(name)]
        if not available:
            raise InstallerError(
                "Install Docker or Podman first; for offline generation, "
                "pass --engine docker or --engine podman."
            )
        if len(available) > 1:
            raise InstallerError(
                "Both Docker and Podman are installed; pass --engine docker "
                "or --engine podman."
            )
        engine = available[0]
        log(f"Detected {engine}; using it automatically.")

    method = "compose"
    if engine == "podman":
        if os.geteuid() == 0:
            raise InstallerError(
                "Run rootless Quadlet as a non-root service user, not through sudo."
            )
        method = "quadlet"
        log("Podman selected; using rootless Quadlet.")
    return engine, method


def compose_environment() -> dict[str, str]:
    environment = dict(os.environ)
    for key in _ENV_KEYS_TO_CLEAR:
        environment.pop(key, None)
    return environment


def saved_profiles(deploy_dir: Path) -> str:
    value = read_single_quoted_env(deploy_dir / ".env", "COMPOSE_PROFILES")
    if value is None:
        value = ""
    if value not in {"", "qbittorrent", "jackett", "qbittorrent,jackett"}:
        raise InstallerError("Unrecognized saved Compose profiles.")
    return value


def compose_command(
    engine: str,
    stack: str,
    deploy_dir: Path,
    args: list[str],
) -> list[str]:
    profiles = saved_profiles(deploy_dir)
    prefix: list[str] = []
    if "qbittorrent" in profiles.split(","):
        prefix.extend(["--profile", "qbittorrent"])
    if "jackett" in profiles.split(","):
        prefix.extend(["--profile", "jackett"])
    log(f"Compose project={stack}; enabled profiles={profiles or 'none'}")
    return [
        engine,
        "compose",
        "--project-name",
        stack,
        "--env-file",
        str(deploy_dir / ".env"),
        "-f",
        str(deploy_dir / "compose.yaml"),
        *prefix,
        *args,
    ]


def compose(
    engine: str,
    stack: str,
    deploy_dir: Path,
    args: list[str],
    *,
    capture: bool = False,
) -> subprocess.CompletedProcess[str]:
    return run(
        compose_command(engine, stack, deploy_dir, args),
        env=compose_environment(),
        capture=capture,
    )


class BackupManager:
    """Archive conflicting installer-owned regular files when --force is set."""

    def __init__(self, force: bool) -> None:
        self.force = force
        self.directory: Path | None = None

    def backup_conflict(self, source: Path, near: Path) -> Path:
        if not self.force or not is_regular_file(source):
            raise InstallerError(
                f"Existing Quadlet unit is preserved: {source} "
                "(use --force for regular files)."
            )
        if self.directory is None:
            self.directory = unique_backup_path(near, "quadlet-backup")
            self.directory.mkdir(mode=0o700)
            log(f"Conflicting Quadlet unit backup: {self.directory}")
        destination = self.directory / source.name
        if exists(destination):
            raise InstallerError(f"Conflict already backed up: {source.name}")
        shutil.copy2(source, destination)
        if source.read_bytes() != destination.read_bytes():
            raise InstallerError(f"Quadlet unit changed during backup: {source}")
        log(f"Backed up conflicting Quadlet unit: {source}")
        return destination


def preflight(
    settings: Settings,
    deploy_dir: Path,
    *,
    replacement: bool = False,
    force: bool = False,
) -> None:
    """Check engine, systemd and conflicting resources before mutations."""

    need(settings.engine)
    if settings.method == "quadlet":
        run([settings.engine, "info"], capture=True)
        rootless = run(
            [
                settings.engine,
                "info",
                "--format",
                "{{.Host.Security.Rootless}}",
            ],
            capture=True,
        ).stdout.strip()
        if rootless != "true":
            raise InstallerError("Podman must be rootless.")
        if not replacement:
            used = run(
                [
                    settings.engine,
                    "ps",
                    "-aq",
                    "--filter",
                    f"volume={settings.stack}-app",
                ],
                capture=True,
            ).stdout.strip()
            if used:
                raise InstallerError(
                    "Existing containers already use "
                    f"{settings.stack}-app. Reuse their deployment configuration."
                )
    else:
        run([settings.engine, "compose", "version"], capture=True)
        run([settings.engine, "info"], capture=True)
        if not replacement:
            project = run(
                [
                    settings.engine,
                    "ps",
                    "-aq",
                    "--filter",
                    f"label=com.docker.compose.project={settings.stack}",
                ],
                capture=True,
            ).stdout.strip()
            if project:
                raise InstallerError(
                    "An anishelf Compose project already exists. "
                    "Use its existing configuration to update it."
                )
            used = run(
                [
                    settings.engine,
                    "ps",
                    "-aq",
                    "--filter",
                    f"volume={settings.stack}-app",
                ],
                capture=True,
            ).stdout.strip()
            if used:
                raise InstallerError(
                    "Existing containers already use "
                    f"{settings.stack}-app. Reuse their deployment configuration."
                )

    if settings.method == "quadlet":
        if platform.system() != "Linux":
            raise InstallerError("Quadlet startup requires Linux.")
        if os.geteuid() == 0:
            raise InstallerError(
                "Run rootless Quadlet as a non-root service user, not through sudo."
            )
        need("systemctl")
        cgroups = run(
            [
                settings.engine,
                "info",
                "--format",
                "{{.Host.CgroupsVersion}}",
            ],
            capture=True,
        ).stdout.strip()
        if cgroups != "v2":
            raise InstallerError("Quadlet requires cgroup v2.")
        run(["systemctl", "--user", "show-environment"], capture=True)
        _check_existing_units(settings, deploy_dir, replacement=replacement, force=force)


def _check_existing_units(
    settings: Settings,
    deploy_dir: Path,
    *,
    replacement: bool,
    force: bool,
) -> None:
    for directory, pattern in (
        (settings.quadlet_dir, f"{settings.stack}*"),
        (settings.systemd_dir, f"{settings.stack}*"),
    ):
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob(pattern)):
            if not exists(path):
                continue
            if settings.stack == "anishelf" and path.name.startswith("anishelf-test"):
                continue
            if not known_unit(path.name, settings.stack):
                raise InstallerError(f"Existing Anishelf unit is preserved: {path}")
            bundled = deploy_dir / "quadlet" / path.name
            if (
                replacement
                and is_regular_file(path)
                and is_regular_file(bundled)
                and path.read_bytes() == bundled.read_bytes()
            ):
                continue
            if force and is_regular_file(path):
                continue
            raise InstallerError(f"Existing Anishelf unit is preserved: {path}")


def publish_unit(
    source: Path,
    destination: Path,
    near: Path,
    backups: BackupManager,
) -> None:
    if exists(destination):
        backups.backup_conflict(destination, near)
        os.unlink(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(
        destination,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL,
        0o600,
    )
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(source.read_bytes())
    log(f"Installed Quadlet unit: {destination}")


def pull_quadlet_images(bundle: dict[str, str], engine: str) -> None:
    pulled: set[str] = set()
    for relative in sorted(bundle):
        if not relative.startswith("quadlet/") or not relative.endswith(".container"):
            continue
        for line in bundle[relative].splitlines():
            if not line.startswith("Image="):
                continue
            image = line[len("Image=") :].strip()
            if not image or image in pulled:
                continue
            log(f"Pulling Quadlet image: {image}")
            run([engine, "pull", image])
            pulled.add(image)


def health_check(settings: Settings) -> None:
    host = settings.bind_address
    if host == "0.0.0.0":
        host = "127.0.0.1"
    url = f"http://{host}:{settings.app_port}/api/health"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(
        url,
        headers={"Host": f"localhost:{settings.app_port}"},
    )
    log(f"Waiting for application health at {url}")
    for _ in range(30):
        try:
            with opener.open(request, timeout=3) as response:
                status = getattr(response, "status", 200)
                if status < 400:
                    log(
                        "Deployment is healthy. Open "
                        f"{settings.public_origin or f'http://localhost:{settings.app_port}'}; "
                        "configure external services in Settings."
                    )
                    if settings.bind_address == "0.0.0.0" and not settings.public_origin:
                        log(
                            f"LAN access: open http://SERVER_IP:{settings.app_port} "
                            "from another device."
                        )
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(2)
    raise InstallerError(
        "Services started but local HTTP health did not pass. "
        "Configuration and data are retained; inspect service logs."
    )


def report_linger() -> None:
    if shutil.which("loginctl") is None:
        return
    completed = run(
        [
            "loginctl",
            "show-user",
            str(os.getuid()),
            "-p",
            "Linger",
            "--value",
        ],
        capture=True,
        check=False,
    )
    if completed.returncode == 0 and completed.stdout.strip() != "yes":
        log(
            "For operation after logout/reboot, an administrator must enable "
            f"lingering for {os.environ.get('USER', 'this account')}."
        )
