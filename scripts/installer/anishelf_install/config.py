"""Installer configuration model and plan reporting."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

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
    media_path: str = ""
    extra_paths: list[str] = field(default_factory=list)
    qbit_port: int = 8080
    peer_port: int = 6881
    jackett_port: int = 9117
    web_trusted_proxies: str = "127.0.0.1/32 ::1/128"
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
    def profiles(self) -> str:
        profiles: list[str] = []
        if self.qbit:
            profiles.append("qbittorrent")
        if self.jackett:
            profiles.append("jackett")
        return ",".join(profiles)

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
            f"origin={self.public_origin or 'automatic'}"
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


def parse_profile(path: Path) -> Optional[str]:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value or None
