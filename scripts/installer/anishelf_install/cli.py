"""Non-interactive command-line interface for the standalone installer."""

from __future__ import annotations

import argparse
import os
import sys
import traceback

from . import __version__
from .errors import InstallerError
from .log import LOG, log
from .workflow import Installer


def _add_runtime_options(
    parser: argparse.ArgumentParser,
    *,
    include_test: bool = True,
    include_force: bool = True,
) -> None:
    parser.add_argument(
        "--engine",
        choices=("docker", "podman"),
        help="container engine; required when both Docker and Podman are installed",
    )
    if include_test:
        parser.add_argument(
            "--test",
            action="store_true",
            help=(
                "isolated testing deployment: testing images, ports 3001/8081/6882/9118, "
                "separate anishelf-test services and volumes; host media mounts disabled"
            ),
        )
    if include_force:
        parser.add_argument(
            "--force",
            action="store_true",
            help=(
                "back up conflicting regular Quadlet unit files before "
                "replacing/removing"
            ),
        )


def _add_settings_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--image-tag",
        metavar="TAG",
        help="matching Anishelf Web/Backend image tag (default: latest, or testing with --test)",
    )

    networking = parser.add_argument_group("networking")
    networking.add_argument(
        "--bind",
        metavar="IPV4",
        help="application bind address (default: 127.0.0.1)",
    )
    networking.add_argument(
        "--port",
        type=int,
        metavar="PORT",
        help="application host port (default: 3000, or 3001 with --test)",
    )
    networking.add_argument(
        "--public-origin",
        metavar="ORIGIN",
        help="optional fixed browser origin for HTTPS, for example https://anime.example.com",
    )

    storage = parser.add_argument_group("storage")
    storage.add_argument(
        "--media",
        metavar="DIRECTORY",
        help="existing dedicated host media directory; omit for a managed volume",
    )
    storage.add_argument(
        "--extra-media",
        action="append",
        default=[],
        metavar="DIRECTORY",
        help="additional existing host media directory; repeat for multiple directories",
    )
    storage.add_argument(
        "--selinux-relabel",
        action=argparse.BooleanOptionalAction,
        default=None,
        help=(
            "apply the shared SELinux :z label to host media directories "
            "(default: automatic on enforcing/permissive SELinux)"
        ),
    )

    services = parser.add_argument_group("optional services")
    services.add_argument(
        "--qbit",
        action="store_true",
        help="include bundled qBittorrent",
    )
    services.add_argument(
        "--jackett",
        action="store_true",
        help="include bundled Jackett",
    )
    services.add_argument(
        "--qbit-port",
        type=int,
        metavar="PORT",
        help="qBittorrent WebUI host port, loopback only (default: 8080, or 8081 with --test)",
    )
    services.add_argument(
        "--peer-port",
        type=int,
        metavar="PORT",
        help="qBittorrent peer TCP/UDP port (default: 6881, or 6882 with --test)",
    )
    services.add_argument(
        "--jackett-port",
        type=int,
        metavar="PORT",
        help="Jackett WebUI host port, loopback only (default: 9117, or 9118 with --test)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="install.pyz",
        description=(
            "Configure, inspect or remove an Anishelf deployment. Every setting is "
            "a flag; this command never prompts."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 install.pyz install --engine docker --deploy-dir \"$HOME/anishelf\"\n"
            "  python3 install.pyz install --engine podman --deploy-dir \"$HOME/anishelf\" \\\n"
            "      --media /srv/anishelf/media --qbit --jackett\n"
            "  python3 install.pyz install --generate-only --engine docker --deploy-dir ./deployment\n"
            "  python3 install.pyz install --test --engine docker --deploy-dir \"$HOME/anishelf-test\"\n"
            "  python3 install.pyz reconfigure \"$HOME/anishelf\" --media /srv/anishelf/media --qbit\n"
            "  python3 install.pyz remove \"$HOME/anishelf\"\n"
            "\n"
            "Requires Python 3.9 or newer. Docker deployments need Docker Compose\n"
            "v2. Quadlet needs Linux with rootless Podman, cgroup v2, Quadlet and\n"
            "an active systemd user session."
        ),
    )
    commands = parser.add_subparsers(
        dest="command",
        required=True,
        title="commands",
        metavar="COMMAND",
    )

    install = commands.add_parser(
        "install",
        help="configure and start a new deployment",
        description="Configure and start a new Docker Compose or rootless Quadlet deployment.",
    )
    install.add_argument(
        "--deploy-dir",
        metavar="DIRECTORY",
        help="new deployment directory (default: ~/anishelf, or ~/anishelf-test with --test)",
    )
    install.add_argument(
        "--generate-only",
        action="store_true",
        help="write configuration without contacting an engine or installing units",
    )
    _add_runtime_options(install, include_force=False)
    install.set_defaults(force=False)
    _add_settings_options(install)

    reconfigure = commands.add_parser(
        "reconfigure",
        help="archive a saved deployment and start replacement settings",
        description=(
            "Prepare fresh configuration, archive the saved deployment, and start "
            "the replacement in the same directory. Volumes and host media are "
            "preserved."
        ),
    )
    reconfigure.add_argument(
        "directory",
        metavar="DIRECTORY",
        help="saved deployment directory",
    )
    _add_runtime_options(reconfigure)
    _add_settings_options(reconfigure)

    remove = commands.add_parser(
        "remove",
        help="stop a saved deployment and archive its configuration",
        description=(
            "Stop a saved deployment and archive/remove its active configuration. "
            "Volumes and host media are preserved."
        ),
    )
    remove.add_argument(
        "directory",
        metavar="DIRECTORY",
        help="saved deployment directory",
    )
    _add_runtime_options(remove, include_test=False)

    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    return parser


def _validate_arguments(args) -> None:
    if args.command in {"install", "reconfigure"}:
        if args.test and (args.media or args.extra_media):
            raise InstallerError("Host media mounts are disabled in --test mode.")
        if args.test and args.selinux_relabel:
            raise InstallerError("SELinux relabeling is unavailable in --test mode.")
        if not args.qbit and (args.qbit_port is not None or args.peer_port is not None):
            raise InstallerError("qBittorrent ports require --qbit.")
        if not args.jackett and args.jackett_port is not None:
            raise InstallerError("--jackett-port requires --jackett.")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    # Deployment bundles contain credentials and host paths; keep new files private.
    os.umask(0o077)

    installer: Installer | None = None
    try:
        _validate_arguments(args)
        installer = Installer(args)
        return installer.run()
    except InstallerError as error:
        LOG.failure(str(error))
        return 1
    except KeyboardInterrupt:
        log("Interrupted; no further changes were made.")
        return 130
    except OSError as error:
        LOG.failure(str(error))
        return 1
    except Exception as error:  # pragma: no cover - defensive CLI guard
        LOG.failure(f"Unexpected failure: {error}")
        traceback.print_exc()
        return 1
    finally:
        if installer is not None:
            installer.cleanup()


if __name__ == "__main__":
    sys.exit(main())
