"""Versioned deployment configuration and generated-file drift detection."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, fields
from pathlib import Path

from . import __version__
from .config import Settings
from .errors import InstallerError
from .validation import is_regular_file, valid_image_tag, valid_ipv4, valid_port

MANIFEST = "deployment.json"


def digest(payload: str | bytes) -> str:
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def serialize(settings: Settings, bundle: dict[str, str | bytes]) -> str:
    values = asdict(settings)
    values.pop("deploy_dir")
    return json.dumps({
        "schema_version": 1,
        "installer_version": __version__,
        "owner_uid": os.geteuid(),
        "config_home": str(settings.quadlet_dir.parents[1]),
        "settings": values,
        "files": {name: digest(payload) for name, payload in sorted(bundle.items())},
    }, indent=2) + "\n"


def load(directory: Path) -> Settings:
    path = directory / MANIFEST
    if not is_regular_file(path):
        raise InstallerError(
            "Missing deployment.json. This command requires a deployment generated "
            "by the current installer; manage older bundles manually."
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if type(data) is not dict or type(data.get("schema_version")) is not int or data["schema_version"] != 1:
            raise ValueError("unsupported schema version")
        values = data["settings"]
        expected = {field.name: field.type for field in fields(Settings) if field.name != "deploy_dir"}
        if type(values) is not dict or values.keys() != expected.keys():
            raise ValueError("invalid settings fields")
        types = {"str": str, "int": int, "bool": bool, "list[str]": list}
        for name, annotation in expected.items():
            if annotation == "bool | None" and values[name] is None:
                continue
            expected_type = bool if annotation == "bool | None" else types[annotation]
            if type(values[name]) is not expected_type:
                raise ValueError(f"invalid setting: {name}")
        if any(type(value) is not str for value in values["extra_paths"]):
            raise ValueError("invalid media paths")
        settings = Settings(deploy_dir=directory, **values)
        if (settings.engine, settings.method) not in {("docker", "compose"), ("podman", "quadlet")}:
            raise ValueError("invalid deployment engine/method")
        if settings.stack != ("anishelf-test" if settings.test_mode else "anishelf"):
            raise ValueError("invalid deployment namespace")
        if not valid_image_tag(settings.image_tag) or not valid_ipv4(settings.bind_address):
            raise ValueError("invalid image tag or bind address")
        if any(not valid_port(str(port), rootless=settings.rootless_quadlet) for port in (
            settings.app_port, settings.qbit_port, settings.peer_port, settings.jackett_port
        )):
            raise ValueError("invalid port")
        if settings.rootless_quadlet and (
            os.geteuid() == 0 or data["owner_uid"] != os.geteuid()
            or data["config_home"] != str(settings.quadlet_dir.parents[1])
        ):
            raise ValueError("run as the original rootless service user with the original XDG_CONFIG_HOME")
        files = data["files"]
        if type(files) is not dict or not files:
            raise ValueError("missing generated-file checksums")
        required = {"manage.sh", "manage.pyz", ".deployment-profile"}
        required.update({"compose.yaml", ".env"} if settings.method == "compose" else {
            f"quadlet/{settings.stack}.target",
            f"quadlet/{settings.stack}-backend.container",
            f"quadlet/{settings.stack}-web.container",
        })
        if not required.issubset(files):
            raise ValueError("incomplete generated-file checksums")
        for name, checksum in files.items():
            relative = Path(name)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("invalid generated-file path")
            generated = directory / relative
            if not is_regular_file(generated) or digest(generated.read_bytes()) != checksum:
                raise ValueError(f"generated file changed: {name}; reconcile it before continuing")
    except (ValueError, KeyError, TypeError) as error:
        raise InstallerError(f"Invalid deployment.json: {error}") from error
    return settings


def inherit(args, settings: Settings) -> None:
    """Explicit command flags override the saved, validated installation choices."""
    qbit_ports_supplied = args.qbit_port is not None or args.peer_port is not None
    jackett_port_supplied = args.jackett_port is not None
    mapping = {
        "image_tag": "image_tag", "log_level": "log_level", "bind": "bind_address",
        "port": "app_port", "public_origin": "public_origin", "qbit": "qbit",
        "jackett": "jackett", "qbit_port": "qbit_port", "peer_port": "peer_port",
        "jackett_port": "jackett_port", "media": "media_path", "extra_media": "extra_paths",
    }
    for option, attribute in mapping.items():
        if getattr(args, option) is None:
            setattr(args, option, getattr(settings, attribute))
    if args.managed_media:
        args.media = None
    if args.clear_extra_media:
        args.extra_media = []
    if args.selinux_relabel is None:
        args.selinux_relabel = settings.selinux_relabel if (args.media or args.extra_media) else None
    if not args.qbit and qbit_ports_supplied:
        raise InstallerError("qBittorrent ports require --qbit.")
    if not args.jackett and jackett_port_supplied:
        raise InstallerError("--jackett-port requires --jackett.")
