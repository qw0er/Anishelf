"""Pure validation and small path helpers shared by the CLI and workflow."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Iterable, Optional

# Characters that are unsafe in the generated single-quoted .env file or in
# Quadlet Volume= values. Control characters are rejected separately.
_UNSAFE_PATH_CHARS = frozenset(":\"'\\$`%")
_IMAGE_TAG = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$")
_IPV4 = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$")
_OCTET = re.compile(r"^(0|[1-9][0-9]{0,2})$")
_ORIGIN = re.compile(
    r"^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$"
)
_ENV_ESCAPE = re.compile(r"[\x00-\x1f\x7f]")


def absolute_input(value: str, cwd: Optional[str] = None) -> str:
    """Resolve a relative operator path against the current directory."""

    if os.path.isabs(value):
        return value
    return os.path.join(cwd or os.getcwd(), value)


def valid_path(value: str) -> bool:
    """Accept absolute, shell-safe paths used in generated configuration."""

    if not value or not value.startswith("/"):
        return False
    if _ENV_ESCAPE.search(value):
        return False
    return not any(character in _UNSAFE_PATH_CHARS for character in value)


def valid_image_tag(value: str) -> bool:
    return bool(_IMAGE_TAG.match(value))


def valid_ipv4(value: str) -> bool:
    if not _IPV4.match(value):
        return False
    for octet in value.split("."):
        if not _OCTET.match(octet) or int(octet) > 255:
            return False
    return True


def valid_port(value: str, rootless: bool = False) -> bool:
    if not re.match(r"^[0-9]{1,5}$", value):
        return False
    number = int(value, 10)
    if not 1 <= number <= 65535:
        return False
    return not (rootless and number < 1024)


def valid_origin(value: str) -> bool:
    if not _ORIGIN.match(value):
        return False
    authority = value.split("://", 1)[1]
    if ":" in authority:
        return valid_port(authority.rsplit(":", 1)[1])
    return True


def is_regular_file(path: Path) -> bool:
    return path.is_file() and not path.is_symlink()


def exists(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def resolve_directory(value: str) -> Path:
    """Return a canonical directory path or raise ValueError."""

    if not valid_path(value):
        raise ValueError("unsupported path characters")
    path = Path(value)
    if not path.is_dir() or path.is_symlink():
        raise ValueError("not a real directory")
    return Path(os.path.realpath(path))


def read_single_quoted_env(env_file: Path, key: str) -> Optional[str]:
    """Read exactly our generated ``KEY='value'`` form without sourcing it."""

    pattern = re.compile(rf"^{re.escape(key)}='([^']*)'$")
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for line in lines:
        match = pattern.match(line)
        if match:
            return match.group(1)
    return None


_KNOWN_UNITS = frozenset(
    {
        "anishelf.network",
        "anishelf.target",
        "anishelf-app.volume",
        "anishelf-media.volume",
        "anishelf-qbittorrent-connection.volume",
        "anishelf-qbittorrent-config.volume",
        "anishelf-qbittorrent-incomplete.volume",
        "anishelf-jackett-config.volume",
        "anishelf-backend.container",
        "anishelf-web.container",
        "anishelf-qbittorrent-init.container",
        "anishelf-qbittorrent.container",
        "anishelf-jackett-init.container",
        "anishelf-jackett.container",
    }
)


def known_unit(name: str, stack: str) -> bool:
    """Match installer-owned unit names for the production or testing stack."""

    if stack == "anishelf-test":
        candidate = name.replace("anishelf-test", "anishelf", 1)
    else:
        candidate = name
    return candidate in _KNOWN_UNITS


def unit_order(qbit: bool, jackett: bool) -> list[str]:
    units = [
        "anishelf.network",
        "anishelf-app.volume",
        "anishelf-media.volume",
        "anishelf-qbittorrent-connection.volume",
        "anishelf-jackett-config.volume",
        "anishelf-backend.container",
        "anishelf-web.container",
        "anishelf.target",
    ]
    if qbit:
        units.extend(
            [
                "anishelf-qbittorrent-config.volume",
                "anishelf-qbittorrent-incomplete.volume",
                "anishelf-qbittorrent-init.container",
                "anishelf-qbittorrent.container",
            ]
        )
    if jackett:
        units.extend(
            [
                "anishelf-jackett-init.container",
                "anishelf-jackett.container",
            ]
        )
    return units


def testing_unit_name(name: str) -> str:
    if name == "anishelf.network":
        return "anishelf-test.network"
    if name == "anishelf.target":
        return "anishelf-test.target"
    return name.replace("anishelf-", "anishelf-test-", 1)


def unique_backup_path(directory: Path, suffix: str) -> Path:
    """Allocate a non-existent sibling path without creating the target."""

    import secrets

    for _ in range(32):
        candidate = directory.parent / f"{directory.name}.{suffix}.{secrets.token_hex(4)}"
        if not exists(candidate):
            return candidate
    raise RuntimeError("could not allocate a backup directory")


def distinct_paths(paths: Iterable[str]) -> bool:
    """Return true when no path is equal to or nested inside another."""

    values = list(paths)
    for index, value in enumerate(values):
        for other in values[index + 1 :]:
            if value == other or value.startswith(f"{other}/") or other.startswith(f"{value}/"):
                return False
    return True
