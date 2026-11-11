"""Render canonical Compose and Quadlet templates for one installation."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .config import Settings


def render_compose(template: str, settings: Settings) -> str:
    """Apply installer settings to the canonical Compose template."""

    text = template
    # These are fixed, two-space-indented entries in our canonical template,
    # not arbitrary operator-provided YAML. Keep offline generation stdlib-only.
    optional_entries = {
        "qbittorrent": settings.qbit,
        "qbittorrent-init": settings.qbit,
        "qbittorrent-config": settings.qbit,
        "qbittorrent-connection": settings.qbit,
        "qbittorrent-incomplete": settings.qbit,
        "jackett": settings.jackett,
        "jackett-init": settings.jackett,
        "jackett-config": settings.jackett,
    }
    for name, enabled in optional_entries.items():
        if not enabled:
            text = re.sub(
                rf"^  {re.escape(name)}:\n.*?(?=^  [\w-]+:|^\S|\Z)",
                "",
                text,
                flags=re.MULTILINE | re.DOTALL,
            )
    text = "\n".join(
        line
        for line in text.splitlines()
        if not line.startswith("    profiles:")
        and _include_bundled_connection(line, settings)
    ) + "\n"
    if settings.selinux_suffix:
        text = text.replace(":/data/media:rw", ":/data/media:rw,z")
        text = "\n".join(
            f"{line}:z" if line.rstrip().endswith("}:/data/media") else line
            for line in text.splitlines()
        )
        if template.endswith("\n"):
            text += "\n"

    if settings.media_path:
        text = text.replace(
            'chown "$${PUID}:$${PGID}" /data/media /data/incomplete',
            'chown "$${PUID}:$${PGID}" /data/incomplete',
        )

    if settings.extra_paths:
        lines: list[str] = []
        for line in text.splitlines():
            if line == "      ANISHELF_INITIAL_RESOURCE_ROOTS: /data/media":
                lines.append(
                    f"      ANISHELF_INITIAL_RESOURCE_ROOTS: {settings.initial_roots}"
                )
            else:
                lines.append(line)
            if "${ANISHELF_MEDIA_PATH:-anishelf-media}:/data/media:rw" in line:
                for index, extra in enumerate(settings.extra_paths, start=1):
                    lines.append(
                        f'      - "{extra}:/data/extra/{index}:rw'
                        f'{settings.selinux_suffix}"'
                    )
        text = "\n".join(lines)
        if template.endswith("\n"):
            text += "\n"

    if settings.test_mode:
        text = text.replace("name: anishelf-", "name: anishelf-test-")

    label = ",z" if not settings.log_path and settings.selinux_mode in {"Enforcing", "Permissive"} else ""
    log_path = settings.backend_log_path
    logging_env = f"      ANISHELF_LOG_DESTINATION: {settings.log_destination}\n"
    if settings.log_destination != "stdout":
        logging_env += f'      ANISHELF_LOG_PATH: "/var/log/anishelf/{log_path.name}"\n'
        text = text.replace(
            "      - anishelf-app:/var/lib/anishelf\n",
            "      - anishelf-app:/var/lib/anishelf\n"
            f'      - "{log_path.parent}:/var/log/anishelf:rw{label}"\n',
        )
    text = text.replace(
        "      ANISHELF_LOG_LEVEL: ${ANISHELF_LOG_LEVEL:-info}\n",
        "      ANISHELF_LOG_LEVEL: ${ANISHELF_LOG_LEVEL:-info}\n" + logging_env,
    )

    if not _valid_compose_generation(text):
        raise ValueError("rendered Compose configuration failed its sanity check")
    return text


def _valid_compose_generation(text: str) -> bool:
    # A missing media mount is a common rendering regression; reject it early
    # instead of writing a bundle that would start without media.
    return "ANISHELF_INITIAL_RESOURCE_ROOTS:" in text and "/data/media" in text


def _include_bundled_connection(line: str, settings: Settings) -> bool:
    """Omit Backend hints and credential mounts for services not selected."""

    if not settings.qbit and any(
        marker in line for marker in (
            "ANISHELF_QBITTORRENT_API_URL",
            "ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE",
            ":/run/anishelf-qbittorrent:",
        )
    ):
        return False
    if not settings.jackett and any(
        marker in line for marker in (
            "ANISHELF_BUNDLED_JACKETT_CONFIG_FILE",
            ":/run/jackett-config:",
        )
    ):
        return False
    return True


def render_quadlet(name: str, template: str, settings: Settings) -> str:
    """Render and optionally namespace one canonical Quadlet unit."""

    lines: list[str] = []
    for original in template.splitlines():
        if name == "anishelf-backend.container" and not _include_bundled_connection(
            original, settings
        ):
            continue
        line = _translate_unit_line(name, original, settings)
        if settings.selinux_suffix and line.startswith("Volume=anishelf-"):
            if line.endswith((":ro", ":rw")):
                line = f"{line},z"
            else:
                line = f"{line}:z"
        lines.append(line)
        if (
            name == "anishelf-backend.container"
            and line.startswith("Volume=")
            and ":/data/media:rw" in line
        ):
            for index, extra in enumerate(settings.extra_paths, start=1):
                lines.append(
                    f"Volume={extra}:/data/extra/{index}:rw{settings.selinux_suffix}"
                )
    text = "\n".join(lines)
    if template.endswith("\n"):
        text += "\n"
    if settings.test_mode:
        _, text = isolate_quadlet(name, text)
    if name == "anishelf-backend.container":
        label = ",z" if not settings.log_path and settings.selinux_mode in {"Enforcing", "Permissive"} else ""
        log_path = settings.backend_log_path
        logging_env = f"Environment=ANISHELF_LOG_DESTINATION={settings.log_destination}\n"
        if settings.log_destination != "stdout":
            logging_env += (
                f'Environment="ANISHELF_LOG_PATH=/var/log/anishelf/{log_path.name}"\n'
                f'Volume="{log_path.parent}:/var/log/anishelf:rw{label}"\n'
            )
        text = text.replace("[Service]\n", logging_env + "\n[Service]\n")
    return text


def _translate_unit_line(name: str, line: str, settings: Settings) -> str:
    if line.startswith("Image=ghcr.io/qw0er/anishelf-backend:"):
        return f"Image=ghcr.io/qw0er/anishelf-backend:{settings.image_tag}"
    if line.startswith("Image=ghcr.io/qw0er/anishelf-web:"):
        return f"Image=ghcr.io/qw0er/anishelf-web:{settings.image_tag}"
    if name == "anishelf-backend.container" and line.startswith("Environment=ANISHELF_LOG_LEVEL="):
        return f"Environment=ANISHELF_LOG_LEVEL={settings.log_level}"
    if (
        name == "anishelf-backend.container"
        and line.startswith("Environment=ANISHELF_INITIAL_RESOURCE_ROOTS=")
    ):
        return f"Environment=ANISHELF_INITIAL_RESOURCE_ROOTS={settings.initial_roots}"
    if line.startswith("Environment=ANISHELF_PUBLIC_ORIGIN="):
        return f"Environment=ANISHELF_PUBLIC_ORIGIN={settings.public_origin}"
    if (
        name == "anishelf-web.container"
        and line.startswith('Environment="ANISHELF_WEB_TRUSTED_PROXIES=')
    ):
        return f'Environment="ANISHELF_WEB_TRUSTED_PROXIES={settings.web_trusted_proxies}"'
    if name == "anishelf-web.container" and line.startswith("PublishPort="):
        return f"PublishPort={settings.bind_address}:{settings.app_port}:8080"
    if name == "anishelf-jackett.container" and line.startswith("PublishPort="):
        return f"PublishPort=127.0.0.1:{settings.jackett_port}:9117"
    if (
        name == "anishelf-qbittorrent.container"
        and line.startswith("Environment=TORRENTING_PORT=")
    ):
        return f"Environment=TORRENTING_PORT={settings.peer_port}"
    if (
        name == "anishelf-qbittorrent.container"
        and line == "PublishPort=127.0.0.1:8080:8080"
    ):
        return f"PublishPort=127.0.0.1:{settings.qbit_port}:8080"
    if (
        name == "anishelf-qbittorrent.container"
        and line == "PublishPort=6881:6881"
    ):
        return f"PublishPort={settings.peer_port}:{settings.peer_port}"
    if (
        name == "anishelf-qbittorrent.container"
        and line == "PublishPort=6881:6881/udp"
    ):
        return f"PublishPort={settings.peer_port}:{settings.peer_port}/udp"
    if line == "Volume=anishelf-media.volume:/data/media:rw":
        if settings.media_path:
            return f"Volume={settings.media_path}:/data/media:rw{settings.selinux_suffix}"
        return line
    if line == "Volume=anishelf-media.volume:/data/media":
        if settings.media_path:
            label = ":z" if settings.selinux_suffix else ""
            return f"Volume={settings.media_path}:/data/media{label}"
        return line
    if (
        settings.media_path
        and name == "anishelf-qbittorrent.container"
        and "chown 1000:1000 /data/media /data/incomplete" in line
    ):
        return line.replace(
            "chown 1000:1000 /data/media /data/incomplete",
            "chown 1000:1000 /data/incomplete",
        )
    return line


def isolate_quadlet(name: str, text: str) -> tuple[str, str]:
    """Namespace unit content and return the testing-prefixed filename."""

    from .validation import testing_unit_name

    lines: list[str] = []
    for line in text.splitlines():
        if not line.startswith("Image="):
            line = line.replace("anishelf-", "anishelf-test-")
        line = line.replace("NetworkName=anishelf", "NetworkName=anishelf-test")
        line = line.replace("anishelf.network", "anishelf-test.network")
        line = line.replace("anishelf.target", "anishelf-test.target")
        lines.append(line)
    rendered = "\n".join(lines)
    if text.endswith("\n"):
        rendered += "\n"
    return testing_unit_name(name), rendered


def unit_filename(name: str, test_mode: bool) -> str:
    from .validation import testing_unit_name

    return testing_unit_name(name) if test_mode else name
