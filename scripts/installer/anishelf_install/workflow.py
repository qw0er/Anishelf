"""Non-interactive installation, reconfiguration and removal workflow."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from .assets import AssetSource
from .config import Settings, deployment_profile, parse_profile
from .errors import InstallerError
from .log import LOG, log
from .render import (
    render_compose,
    render_compose_helper,
    render_quadlet,
    unit_filename,
)
from .runtime import (
    BackupManager,
    compose,
    detect_engine,
    health_check,
    need,
    preflight,
    publish_unit,
    pull_quadlet_images,
    report_linger,
    run,
    saved_profiles,
)
from .validation import (
    absolute_input,
    distinct_paths,
    exists,
    is_regular_file,
    known_unit,
    read_single_quoted_env,
    resolve_directory,
    unique_backup_path,
    unit_order,
    valid_image_tag,
    valid_ipv4,
    valid_origin,
    valid_path,
    valid_port,
)

SYSTEM_DIRECTORIES = (
    "/",
    "/home",
    "/root",
    "/etc",
    "/private/etc",
    "/usr",
    "/boot",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/var",
    "/sys",
    "/proc",
    "/dev",
    "/run",
)


class Installer:
    """Own one CLI invocation and all of its temporary state."""

    def __init__(self, args) -> None:
        self.args = args
        self.command = args.command
        self.reconfigure = args.command == "reconfigure"
        self.generate_only = (
            args.command == "install" and getattr(args, "generate_only", False)
        )
        self.settings: Settings | None = None
        self.existing: dict | None = None
        self.assets: AssetSource | None = None
        self.bundle: dict[str, str] = {}
        self.bundle_modes: dict[str, int] = {}
        self.backups = BackupManager(args.force)

    def cleanup(self) -> None:
        if self.assets is not None:
            self.assets.close()
            self.assets = None

    def run(self) -> int:
        if self.command in {"remove", "reconfigure"}:
            self.existing = self._load_existing()
            if self.command == "remove":
                self.remove_configuration()
                return 0

        self.settings = self._collect_settings()
        self.settings.report_plan()

        if not self.generate_only:
            LOG.phase = "checking runtime prerequisites"
            preflight(
                self.settings,
                self.settings.deploy_dir,
                replacement=self.reconfigure,
                force=self.args.force,
            )

        self._prepare_bundle()

        if self.settings.method == "quadlet" and not self.generate_only:
            LOG.phase = "pulling Quadlet container images"
            pull_quadlet_images(self.bundle, self.settings.engine)

        if self.reconfigure:
            if self.settings.method == "compose":
                self._validate_replacement_compose()
            self.remove_configuration()
            LOG.phase = "checking replacement runtime prerequisites"
            preflight(
                self.settings,
                self.settings.deploy_dir,
                replacement=True,
                force=self.args.force,
            )

        self._write_bundle()

        if self.generate_only:
            log("Generation complete; no services or systemd units were changed.")
            return 0

        self._start()
        return 0

    # ------------------------------------------------------------------
    # Configuration collection
    # ------------------------------------------------------------------

    def _collect_settings(self) -> Settings:
        args = self.args
        reconfigure = self.reconfigure
        if reconfigure:
            assert self.existing is not None
            deploy_dir = self.existing["deploy_dir"]
            engine = self.existing["engine"]
            method = self.existing["method"]
            stack = self.existing["stack"]
            test_mode = self.existing["test_mode"]
            if engine == "podman" and os.geteuid() == 0:
                raise InstallerError(
                    "Run rootless Quadlet as a non-root service user, not through sudo."
                )
        else:
            stack = "anishelf-test" if args.test else "anishelf"
            test_mode = bool(args.test)
            engine, method = detect_engine(args.engine)
            deploy_dir = self._deployment_directory(args.deploy_dir, stack)

        rootless = method == "quadlet"
        image_tag = (
            args.image_tag
            if args.image_tag is not None
            else ("testing" if test_mode else "latest")
        )
        if not valid_image_tag(image_tag):
            raise InstallerError(
                "Image tag must match [A-Za-z0-9_][A-Za-z0-9_.-]{0,127}."
            )

        bind_address = args.bind if args.bind is not None else "127.0.0.1"
        if not valid_ipv4(bind_address):
            raise InstallerError(
                "Application bind address must be an IPv4 address, "
                "for example 127.0.0.1 or 0.0.0.0."
            )
        public_origin = (
            args.public_origin if args.public_origin is not None else ""
        )
        if public_origin and not valid_origin(public_origin):
            raise InstallerError(
                "Public origin must be an HTTP(S) origin without credentials, "
                "paths, query or fragment."
            )

        app_port = self._port(
            "Application host port",
            args.port,
            3001 if test_mode else 3000,
            rootless,
        )
        qbit = bool(args.qbit)
        jackett = bool(args.jackett)
        if not qbit and (args.qbit_port is not None or args.peer_port is not None):
            raise InstallerError("qBittorrent ports require --qbit.")
        if not jackett and args.jackett_port is not None:
            raise InstallerError("--jackett-port requires --jackett.")

        qbit_port = self._port(
            "qBittorrent WebUI host port",
            args.qbit_port,
            8081 if test_mode else 8080,
            rootless,
        )
        peer_port = self._port(
            "qBittorrent peer TCP/UDP port",
            args.peer_port,
            6882 if test_mode else 6881,
            rootless,
        )
        jackett_port = self._port(
            "Jackett WebUI host port",
            args.jackett_port,
            9118 if test_mode else 9117,
            rootless,
        )

        if test_mode:
            log(
                "Testing profile: isolated services, network and volumes; "
                "no host media mounts. Use independent test service credentials."
            )
            if args.media or args.extra_media:
                raise InstallerError("Host media mounts are disabled in --test mode.")
            media_path = ""
            extra_paths: list[str] = []
        else:
            media_path = self._resolve_media(args.media) if args.media else ""
            extra_paths = [
                self._resolve_media(value) for value in (args.extra_media or [])
            ]
            if len(extra_paths) > 63:
                raise InstallerError(
                    "At most 63 additional media directories are supported."
                )
            if not distinct_paths(
                ([media_path] if media_path else []) + extra_paths
            ):
                raise InstallerError(
                    "Primary and additional media directories must be distinct "
                    "and must not contain one another."
                )

        selinux_mode = self._detect_selinux()
        relabel_default = selinux_mode in {"Enforcing", "Permissive"}
        if args.selinux_relabel is None:
            relabel = bool(media_path or extra_paths) and relabel_default
        else:
            relabel = bool(args.selinux_relabel)
            if relabel and not (media_path or extra_paths):
                raise InstallerError(
                    "--selinux-relabel requires --media or --extra-media."
                )
        selinux_suffix = ",z" if relabel else ""

        self._check_relabel_paths(
            media_path, extra_paths, selinux_suffix, selinux_mode
        )
        if qbit and media_path and not os.access(media_path, os.W_OK):
            raise InstallerError(
                "Bundled qBittorrent requires a writable media directory; "
                "permissions will not be changed automatically."
            )
        self._check_distinct_ports(
            app_port, qbit, qbit_port, peer_port, jackett, jackett_port
        )

        return Settings(
            deploy_dir=deploy_dir,
            engine=engine,
            method=method,
            stack=stack,
            test_mode=test_mode,
            image_tag=image_tag,
            bind_address=bind_address,
            app_port=app_port,
            public_origin=public_origin,
            qbit=qbit,
            jackett=jackett,
            media_path=media_path,
            extra_paths=extra_paths,
            qbit_port=qbit_port,
            peer_port=peer_port,
            jackett_port=jackett_port,
            selinux_mode=selinux_mode,
            selinux_suffix=selinux_suffix,
        )

    @staticmethod
    def _deployment_directory(value: str | None, stack: str) -> Path:
        raw = value if value is not None else str(Path.home() / stack)
        candidate = absolute_input(raw)
        if not valid_path(candidate):
            raise InstallerError(
                "Deployment directory must be absolute and must not contain "
                "quotes, $, %, backslashes, colons or control characters."
            )
        if exists(Path(candidate)):
            raise InstallerError(
                f"Deployment directory already exists: {candidate}"
            )
        return Path(candidate)

    @staticmethod
    def _resolve_media(value: str) -> str:
        candidate = absolute_input(value)
        path = Path(candidate)
        if (
            not valid_path(candidate)
            or not path.is_dir()
            or not os.access(path, os.R_OK | os.X_OK)
        ):
            raise InstallerError(
                "Media directory must be an existing readable/traversable "
                f"directory: {value}"
            )
        resolved = os.path.realpath(path)
        if not valid_path(resolved):
            raise InstallerError(
                "Resolved media path contains unsupported configuration characters."
            )
        return resolved

    @staticmethod
    def _port(
        label: str,
        value: int | None,
        default: int,
        rootless: bool,
    ) -> int:
        port = default if value is None else value
        if not valid_port(str(port), rootless):
            restriction = (
                " (1024 or higher for rootless Podman)" if rootless else ""
            )
            raise InstallerError(
                f"{label} must be a port from 1 to 65535{restriction}."
            )
        return port

    def _detect_selinux(self) -> str:
        if shutil.which("getenforce") is None:
            return "unavailable"
        completed = run(["getenforce"], capture=True, check=False)
        if completed.returncode == 0:
            value = completed.stdout.strip()
            if value:
                return value
        return "unavailable"

    def _check_relabel_paths(
        self,
        media_path: str,
        extra_paths: list[str],
        selinux_suffix: str,
        selinux_mode: str,
    ) -> None:
        if not selinux_suffix:
            return
        log(
            f"SELinux: {selinux_mode}. Shared :z will relabel the selected media "
            "tree when containers start."
        )
        for path in ([media_path] if media_path else []) + extra_paths:
            for system in SYSTEM_DIRECTORIES:
                if system == "/":
                    if path == "/":
                        raise InstallerError(
                            "Refusing to relabel a system directory. Choose a "
                            "dedicated media directory or pre-label it manually."
                        )
                    continue
                if path == system or path.startswith(f"{system}/"):
                    raise InstallerError(
                        "Refusing to relabel a system directory. Choose a "
                        "dedicated media directory or pre-label it manually."
                    )
            if path == str(Path.home()):
                raise InstallerError("Refusing to relabel your entire home directory.")

    @staticmethod
    def _check_distinct_ports(
        app_port: int,
        qbit: bool,
        qbit_port: int,
        peer_port: int,
        jackett: bool,
        jackett_port: int,
    ) -> None:
        ports = [app_port]
        if qbit:
            ports.extend([qbit_port, peer_port])
        if jackett:
            ports.append(jackett_port)
        if len(set(ports)) != len(ports):
            raise InstallerError("Selected TCP ports must be distinct.")

    # ------------------------------------------------------------------
    # Templates and bundle writing
    # ------------------------------------------------------------------

    def _prepare_bundle(self) -> None:
        assert self.settings is not None
        LOG.phase = "preparing deployment templates"
        self.bundle = {
            ".deployment-profile": deployment_profile(self.settings.test_mode)
        }
        self.bundle_modes = {}
        self.assets = AssetSource()
        self.settings.template_source = self.assets.resolve()

        if self.settings.method == "compose":
            self._prepare_compose()
        else:
            self._prepare_quadlet()

    def _prepare_compose(self) -> None:
        assert self.settings is not None and self.assets is not None
        try:
            rendered = render_compose(
                self.assets.read_text("compose.yaml"), self.settings
            )
        except ValueError as error:
            raise InstallerError(str(error)) from error
        self.bundle["compose.yaml"] = rendered
        self.bundle[".env"] = self._render_env(self.settings)
        self.bundle["manage.sh"] = render_compose_helper(self.settings)
        self.bundle_modes["manage.sh"] = 0o755

    def _prepare_quadlet(self) -> None:
        assert self.settings is not None and self.assets is not None
        units = unit_order(self.settings.qbit, self.settings.jackett)
        for unit in units:
            rendered = render_quadlet(
                unit,
                self.assets.read_text(f"quadlet/{unit}"),
                self.settings,
            )
            filename = unit_filename(unit, self.settings.test_mode)
            self.bundle[f"quadlet/{filename}"] = rendered
        log(f"Rendered {len(units)} Quadlet unit files.")

    @staticmethod
    def _render_env(settings: Settings) -> str:
        values = [
            ("ANISHELF_TAG", settings.image_tag),
            ("ANISHELF_BIND_ADDRESS", settings.bind_address),
            ("ANISHELF_PORT", str(settings.app_port)),
            ("ANISHELF_PUBLIC_ORIGIN", settings.public_origin),
            ("ANISHELF_MEDIA_PATH", settings.media_path),
            ("COMPOSE_PROFILES", settings.profiles),
            ("COMPOSE_PROJECT_NAME", settings.stack),
            ("ANISHELF_DEPLOY_ENGINE", settings.engine),
            ("ANISHELF_TRUSTED_PROXIES", "loopback,uniquelocal"),
            ("ANISHELF_WEB_TRUSTED_PROXIES", settings.web_trusted_proxies),
            ("QBITTORRENT_WEBUI_PORT", str(settings.qbit_port)),
            ("QBITTORRENT_PEER_PORT", str(settings.peer_port)),
            ("JACKETT_PORT", str(settings.jackett_port)),
            ("QBITTORRENT_BIND_ADDRESS", "127.0.0.1"),
            ("JACKETT_BIND_ADDRESS", "127.0.0.1"),
            ("QBITTORRENT_TAG", "latest"),
        ]
        return "".join(f"{key}='{value}'\n" for key, value in values)

    def _write_bundle(self) -> None:
        assert self.settings is not None
        LOG.phase = "writing the new deployment bundle"
        deploy_dir = self.settings.deploy_dir
        deploy_dir.parent.mkdir(parents=True, exist_ok=True)
        # mkdir refuses existing or symlinked destinations even if they appeared
        # after validation or while templates were prepared.
        os.mkdir(deploy_dir, 0o700)
        try:
            for relative in sorted(self.bundle):
                target = Path(relative)
                if target.is_absolute() or ".." in target.parts:
                    raise InstallerError(f"Unsafe bundled path: {relative}")
                destination = deploy_dir / target
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                mode = self.bundle_modes.get(relative, 0o600)
                descriptor = os.open(
                    destination,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    mode,
                )
                with os.fdopen(
                    descriptor, "w", encoding="utf-8", newline="\n"
                ) as stream:
                    stream.write(self.bundle[relative])
                os.chmod(destination, mode)
            os.chmod(deploy_dir, 0o700)
        except BaseException:
            shutil.rmtree(deploy_dir, ignore_errors=True)
            raise
        LOG.set_file(deploy_dir / "install.log")
        rootless = self.settings.method == "quadlet"
        log(
            "Configuration saved. "
            f"Namespace={self.settings.stack}; image={self.settings.image_tag}; "
            f"Engine={self.settings.engine}; method={self.settings.method}; "
            f"rootless={rootless}; template source={self.settings.template_source}; "
            f"SELinux={self.settings.selinux_mode}."
        )

    def _validate_replacement_compose(self) -> None:
        assert self.settings is not None
        assert "compose.yaml" in self.bundle and ".env" in self.bundle
        LOG.phase = "validating replacement Compose configuration"
        with self._validation_directory() as temporary:
            directory = Path(temporary)
            compose_file = directory / "compose.yaml"
            env_file = directory / ".env"
            compose_file.write_text(self.bundle["compose.yaml"], encoding="utf-8")
            env_file.write_text(self.bundle[".env"], encoding="utf-8")
            os.chmod(compose_file, 0o600)
            os.chmod(env_file, 0o600)
            compose(
                self.settings.engine,
                self.settings.stack,
                directory,
                ["config", "--quiet"],
            )

    @staticmethod
    def _validation_directory() -> tempfile.TemporaryDirectory:
        shared_memory = Path("/dev/shm")
        if shared_memory.is_dir() and os.access(shared_memory, os.W_OK):
            log("Validating Compose configuration in memory-backed /dev/shm.")
            return tempfile.TemporaryDirectory(
                prefix="anishelf-compose.", dir=str(shared_memory)
            )
        log("Validating Compose configuration in the system temporary directory.")
        return tempfile.TemporaryDirectory(prefix="anishelf-compose.")

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------

    def _start(self) -> None:
        assert self.settings is not None
        settings = self.settings
        if settings.method == "compose":
            LOG.phase = "validating Compose configuration"
            compose(settings.engine, settings.stack, settings.deploy_dir, ["config", "--quiet"])
            LOG.phase = "pulling container images"
            compose(settings.engine, settings.stack, settings.deploy_dir, ["pull"])
            LOG.phase = "starting Compose services"
            compose(settings.engine, settings.stack, settings.deploy_dir, ["up", "-d"])
            log(
                "Read the initial password with: "
                f"{settings.engine} compose --project-name {settings.stack} "
                f"--env-file \"{settings.deploy_dir / '.env'}\" "
                f"-f \"{settings.deploy_dir / 'compose.yaml'}\" logs backend"
            )
        else:
            LOG.phase = "installing rootless Quadlet units"
            preflight(
                settings,
                settings.deploy_dir,
                replacement=self.reconfigure,
                force=self.args.force,
            )
            settings.quadlet_dir.mkdir(parents=True, exist_ok=True)
            settings.systemd_dir.mkdir(parents=True, exist_ok=True)
            for unit in sorted((settings.deploy_dir / "quadlet").iterdir()):
                if unit.name == f"{settings.stack}.target":
                    destination = settings.systemd_dir / unit.name
                else:
                    destination = settings.quadlet_dir / unit.name
                publish_unit(unit, destination, settings.deploy_dir, self.backups)
            run(["systemctl", "--user", "daemon-reload"])
            run(
                ["systemctl", "--user", "cat", f"{settings.stack}-backend.service"],
                capture=True,
            )
            LOG.phase = "starting rootless Quadlet services"
            run(
                [
                    "systemctl",
                    "--user",
                    "enable",
                    "--now",
                    f"{settings.stack}.target",
                ]
            )
            run(
                [
                    "systemctl",
                    "--user",
                    "is-active",
                    "--quiet",
                    f"{settings.stack}-backend.service",
                    f"{settings.stack}-web.service",
                ]
            )
            if settings.qbit:
                run(
                    [
                        "systemctl",
                        "--user",
                        "is-active",
                        "--quiet",
                        f"{settings.stack}-qbittorrent.service",
                    ]
                )
            if settings.jackett:
                run(
                    [
                        "systemctl",
                        "--user",
                        "is-active",
                        "--quiet",
                        f"{settings.stack}-jackett.service",
                    ]
                )
            report_linger()
            log(
                "Read the initial password with: "
                f"journalctl --user -u {settings.stack}-backend.service"
            )

        LOG.phase = "checking application health"
        health_check(settings)

    # ------------------------------------------------------------------
    # Existing deployment commands
    # ------------------------------------------------------------------

    def _load_existing(self) -> dict:
        raw = self.args.directory
        assert raw is not None
        try:
            deploy_dir = resolve_directory(absolute_input(raw))
        except ValueError as error:
            raise InstallerError("Choose a real saved deployment directory.") from error

        profile_path = deploy_dir / ".deployment-profile"
        test_mode = False
        stack = "anishelf"
        if is_regular_file(profile_path):
            profile = parse_profile(profile_path)
            if profile == "testing":
                stack = "anishelf-test"
                test_mode = True
            elif profile == "production":
                if getattr(self.args, "test", False):
                    raise InstallerError("Cannot apply --test to a production bundle.")
                stack = "anishelf"
            else:
                raise InstallerError("Unrecognized deployment profile.")
        elif getattr(self.args, "test", False):
            raise InstallerError("Cannot apply --test to an existing production bundle.")

        compose_yaml = deploy_dir / "compose.yaml"
        env_file = deploy_dir / ".env"
        quadlet_dir = deploy_dir / "quadlet"
        if exists(compose_yaml) and exists(quadlet_dir):
            raise InstallerError("Mixed deployment bundles must be reconciled manually.")

        if is_regular_file(compose_yaml) and is_regular_file(env_file):
            saved_engine = read_single_quoted_env(env_file, "ANISHELF_DEPLOY_ENGINE")
            if saved_engine == "podman":
                raise InstallerError(
                    "Podman Compose is no longer supported. Manage this existing "
                    "deployment manually; no files or services were changed."
                )
            if saved_engine != "docker":
                raise InstallerError("Not a recognized installer Compose bundle.")
            saved_project = read_single_quoted_env(env_file, "COMPOSE_PROJECT_NAME")
            if saved_project != stack:
                raise InstallerError("Not a recognized installer Compose bundle.")
            saved_profiles(deploy_dir)
            if self.args.engine and self.args.engine != saved_engine:
                raise InstallerError(
                    "Use the original engine to preserve its volumes."
                )
            method = "compose"
            engine = saved_engine
        elif (
            quadlet_dir.is_dir()
            and not quadlet_dir.is_symlink()
            and is_regular_file(quadlet_dir / f"{stack}-backend.container")
            and is_regular_file(quadlet_dir / f"{stack}-web.container")
            and is_regular_file(quadlet_dir / f"{stack}.target")
        ):
            method = "quadlet"
            engine = "podman"
            if self.args.engine and self.args.engine != "podman":
                raise InstallerError(
                    "Use the original engine to preserve its volumes."
                )
            self._validate_saved_quadlet(deploy_dir, stack)
        else:
            raise InstallerError(
                "Not a recognized saved installer deployment; source checkouts "
                "cannot be removed."
            )

        info = {
            "deploy_dir": deploy_dir,
            "engine": engine,
            "method": method,
            "stack": stack,
            "test_mode": test_mode,
        }
        log(
            f"Selected saved deployment: {deploy_dir} ({engine}/{method}). "
            "Volumes and media will be preserved."
        )
        return info

    def _validate_saved_quadlet(self, deploy_dir: Path, stack: str) -> None:
        config_home = Path(
            os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
        )
        installed_quadlet = config_home / "containers" / "systemd"
        installed_systemd = config_home / "systemd" / "user"
        for unit in sorted((deploy_dir / "quadlet").iterdir()):
            name = unit.name
            if not known_unit(name, stack):
                raise InstallerError(f"Unrecognized bundle unit: {name}")
            if not is_regular_file(unit):
                raise InstallerError(f"Bundle unit must be a regular file: {unit}")
            destination = installed_quadlet / name
            if name == f"{stack}.target":
                destination = installed_systemd / name
            if not exists(destination):
                continue
            if is_regular_file(destination) and destination.read_bytes() == unit.read_bytes():
                continue
            if self.args.force and is_regular_file(destination):
                continue
            raise InstallerError(
                "Installed unit differs from the bundle; reconcile it first or "
                f"use --force: {destination}"
            )

    def remove_configuration(self) -> None:
        LOG.phase = "archiving existing deployment configuration"
        existing = self._load_existing()
        deploy_dir = existing["deploy_dir"]
        backup_dir = unique_backup_path(deploy_dir, "backup")
        LOG.set_file(deploy_dir / "removal.log")
        log(f"Archiving configuration in {backup_dir} before stopping services.")

        if existing["method"] == "compose":
            LOG.phase = "stopping existing Compose deployment"
            compose(
                existing["engine"],
                existing["stack"],
                deploy_dir,
                ["config", "--quiet"],
            )
            compose(
                existing["engine"],
                existing["stack"],
                deploy_dir,
                ["down", "--remove-orphans"],
            )
        else:
            need("systemctl")
            need("podman")
            if os.geteuid() == 0:
                raise InstallerError(
                    "Manage rootless Quadlet as the original non-root service user."
                )
            LOG.phase = "stopping existing Quadlet deployment"
            config_home = Path(
                os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config")
            )
            installed_quadlet = config_home / "containers" / "systemd"
            installed_systemd = config_home / "systemd" / "user"
            target = installed_systemd / f"{existing['stack']}.target"
            if exists(target):
                run(
                    [
                        "systemctl",
                        "--user",
                        "stop",
                        f"{existing['stack']}.target",
                    ]
                )
            for unit in sorted((deploy_dir / "quadlet").glob("*.container")):
                installed = installed_quadlet / unit.name
                if exists(installed):
                    run(
                        [
                            "systemctl",
                            "--user",
                            "stop",
                            f"{unit.name[: -len('.container')]}.service",
                        ]
                    )
            if exists(target):
                run(
                    [
                        "systemctl",
                        "--user",
                        "disable",
                        f"{existing['stack']}.target",
                    ]
                )
            for unit in sorted((deploy_dir / "quadlet").iterdir()):
                destination = installed_quadlet / unit.name
                if unit.name == f"{existing['stack']}.target":
                    destination = installed_systemd / unit.name
                if not exists(destination):
                    continue
                if not is_regular_file(destination) or destination.read_bytes() != unit.read_bytes():
                    self.backups.backup_conflict(destination, deploy_dir)
                os.unlink(destination)
            run(["systemctl", "--user", "daemon-reload"])

        LOG.phase = "renaming the entire old deployment directory"
        os.rename(deploy_dir, backup_dir)
        LOG.set_file(backup_dir / "removal.log")
        log(
            f"Active configuration removed; backup: {backup_dir}. "
            "All volumes and host media are preserved."
        )
