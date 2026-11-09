"""Installer configuration model and plan reporting."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, fields
from pathlib import Path

from .errors import InstallerError
from .log import log


@dataclass
class Settings:
    """Validated configuration used to render and start one deployment."""

    deploy_dir: Path
    engine: str
    method: str
    stack: str
    test_mode: bool
    image_tag: str
    bind_address: str
    app_port: int
    public_origin: str
    qbit: bool
    jackett: bool
    log_level: str = "info"
    media_path: str = ""
    extra_paths: list[str] = field(default_factory=list)
    qbit_port: int = 8080
    peer_port: int = 6881
    jackett_port: int = 9117
    web_trusted_proxies: str = "127.0.0.1/32 ::1/128"
    selinux_relabel: bool | None = None
    selinux_mode: str = "unavailable"
    selinux_suffix: str = ""
    template_source: str = "bundled"

    @property
    def rootless_quadlet(self) -> bool:
        return self.method == "quadlet"

    @property
    def initial_roots(self) -> str:
        roots = ["/data/media"]
        roots.extend(f"/data/extra/{index}" for index in range(1, len(self.extra_paths) + 1))
        return ":".join(roots)

    @property
    def quadlet_dir(self) -> Path:
        return self._config_home() / "containers" / "systemd"

    @property
    def systemd_dir(self) -> Path:
        return self._config_home() / "systemd" / "user"

    def _config_home(self) -> Path:
        configured = os.environ.get("XDG_CONFIG_HOME")
        if configured:
            return Path(configured)
        return Path.home() / ".config"

    def report_plan(self) -> None:
        log(
            f"Plan: {self.engine}/{self.method}; directory={self.deploy_dir}; "
            f"image={self.image_tag}; bind={self.bind_address}:{self.app_port}; "
            f"origin={self.public_origin or 'automatic'}; log level={self.log_level}"
        )
        log(f"External proxy trust: {self.web_trusted_proxies}")
        for extra in self.extra_paths:
            log(f"Additional media: {extra}")
        log(
            f"Media: {self.media_path or 'managed volume'}; "
            f"SELinux shared relabel={self.selinux_suffix or 'no'}; "
            f"qBittorrent={'yes' if self.qbit else 'no'}; "
            f"Jackett={'yes' if self.jackett else 'no'}"
        )


def deployment_profile(test_mode: bool) -> str:
    return "testing\n" if test_mode else "production\n"


def parse_profile(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None


# CLI option -> validated installation setting. Only user choices are persisted.
_SAVED_OPTIONS = {
    "image_tag": "image_tag", "log_level": "log_level", "bind": "bind_address",
    "port": "app_port", "public_origin": "public_origin", "qbit": "qbit",
    "jackett": "jackett", "qbit_port": "qbit_port", "peer_port": "peer_port",
    "jackett_port": "jackett_port", "media": "media_path", "extra_media": "extra_paths",
    "selinux_relabel": "selinux_relabel",
}


def saved_configuration(settings: Settings) -> str:
    return json.dumps({
        "engine": settings.engine,
        "method": settings.method,
        "stack": settings.stack,
        "test_mode": settings.test_mode,
        "settings": {name: getattr(settings, name) for name in _SAVED_OPTIONS.values()},
    }, indent=2) + "\n"


def inherit_configuration(args, directory: Path) -> None:
    """Use saved choices as defaults; normal collection validates the result."""
    path = directory / "deployment.json"
    if not path.exists():
        log("No saved installation parameters; unspecified settings use defaults.")
        return
    try:
        values = json.loads(path.read_text(encoding="utf-8"))["settings"]
        if not isinstance(values, dict):
            raise ValueError("settings must be an object")
        annotations = {field.name: field.type for field in fields(Settings)}
        types = {"str": str, "int": int, "bool": bool, "list[str]": list}
        for option, name in _SAVED_OPTIONS.items():
            if name not in values or getattr(args, option) is not None:
                continue
            value = values[name]
            annotation = annotations[name]
            if annotation == "bool | None":
                if value is not None and type(value) is not bool:
                    raise ValueError(f"invalid {name}")
            elif type(value) is not types[annotation]:
                raise ValueError(f"invalid {name}")
            if isinstance(value, list) and any(type(item) is not str for item in value):
                raise ValueError(f"invalid {name}")
            setattr(args, option, value)
    except (ValueError, KeyError, TypeError) as error:
        raise InstallerError(f"Invalid saved installation parameters: {error}") from error
    log("Loaded saved installation parameters; explicit flags take precedence.")
