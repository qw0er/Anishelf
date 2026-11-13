"""Tests for the stdlib-only Anishelf installer and its packaged artifact."""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
SOURCE = SCRIPTS / "installer"
TEMPLATES = ROOT / "deployment" / "templates"
ARTIFACT = SCRIPTS / "install.pyz"

sys.path.insert(0, str(SOURCE))

from anishelf_install import runtime
from anishelf_install.assets import AssetSource
from anishelf_install.config import Settings
from anishelf_install.errors import InstallerError
from anishelf_install.render import render_compose, render_quadlet
from anishelf_install.validation import (
    valid_image_tag,
    valid_ipv4,
    valid_origin,
    valid_path,
    valid_port,
)


def make_settings(**overrides) -> Settings:
    values = {
        "deploy_dir": Path("/tmp/anishelf-test-deployment"),
        "engine": "docker",
        "method": "compose",
        "stack": "anishelf",
        "test_mode": False,
        "image_tag": "latest",
        "bind_address": "127.0.0.1",
        "app_port": 3000,
        "public_origin": "",
        "qbit": False,
        "jackett": False,
    }
    values.update(overrides)
    return Settings(**values)


FAKE_COMMAND = textwrap.dedent(
    """\
    #!__PYTHON__
    import json
    import os
    import sys

    name = os.path.basename(sys.argv[0])
    args = sys.argv[1:]
    trace = os.environ.get("INSTALL_TEST_TRACE")
    if trace:
        with open(trace, "a", encoding="utf-8") as stream:
            stream.write(json.dumps({
                "name": name,
                "args": args,
                "tag": os.environ.get("ANISHELF_TAG"),
                "profiles": os.environ.get("COMPOSE_PROFILES"),
            }) + "\\n")

    if name == "getenforce":
        print(os.environ.get("INSTALL_TEST_SELINUX", "Disabled"))
        raise SystemExit(0)
    if name == "podman":
        if args and args[0] == "info":
            joined = " ".join(args)
            print("v2" if "CgroupsVersion" in joined else "true")
            raise SystemExit(0)
        if args and args[0] == "pull" and os.environ.get("INSTALL_TEST_PULL_FAIL") == "yes":
            raise SystemExit(1)
        raise SystemExit(0)
    if name == "docker":
        if "pull" in args and os.environ.get("INSTALL_TEST_PULL_FAIL") == "yes":
            raise SystemExit(1)
        if args[:2] == ["compose", "version"]:
            print("Docker Compose version fixture")
        raise SystemExit(0)
    if name == "systemctl":
        if args[:2] == ["--user", "cat"]:
            print("fixture unit")
        raise SystemExit(0)
    if name == "loginctl":
        print("yes")
        raise SystemExit(0)
    raise SystemExit(0)
    """
)


class DockerPrivilegeTests(unittest.TestCase):
    def test_socket_denial_requests_sudo_for_docker_commands(self) -> None:
        denied = subprocess.CompletedProcess([], 1, "", "permission denied accessing /var/run/docker.sock")
        success = subprocess.CompletedProcess([], 0, "", "")
        with patch.object(runtime, "_docker_sudo", None), patch.object(
            runtime.os, "geteuid", return_value=1000
        ), patch.dict(os.environ, {"DOCKER_HOST": "", "DOCKER_CONTEXT": ""}), patch.object(
            runtime, "need"
        ) as need, patch.object(runtime.subprocess, "run", side_effect=[denied, success, success, success, success]) as execute:
            runtime.run(["docker", "info"], capture=True)
            runtime.run(["docker", "ps"], capture=True)
        need.assert_called_once_with("sudo")
        self.assertEqual(execute.call_args_list[2].args[0], ["sudo", "docker", "info"])
        self.assertEqual(execute.call_args_list[4].args[0], ["sudo", "docker", "ps"])

    def test_other_failures_do_not_escalate(self) -> None:
        failure = subprocess.CompletedProcess([], 1, "", "daemon unavailable")
        with patch.object(runtime, "_docker_sudo", None), patch.object(
            runtime.subprocess, "run", side_effect=[failure, failure]
        ) as execute, self.assertRaises(InstallerError):
            runtime.run(["docker", "info"], capture=True)
        self.assertEqual(execute.call_args_list[1].args[0], ["docker", "info"])


class Fixture:
    def __init__(self, case: unittest.TestCase) -> None:
        self.case = case
        self.directory = Path(tempfile.mkdtemp(prefix="anishelf-installer-test-")).resolve()
        self.bin = self.directory / "bin"
        self.home = self.directory / "home"
        self.config = self.directory / "config"
        self.target = self.directory / "deployment"
        self.trace = self.directory / "commands.jsonl"
        self.bin.mkdir()
        self.home.mkdir()
        implementation = FAKE_COMMAND.replace("__PYTHON__", sys.executable)
        for name in ("getenforce", "docker", "podman", "systemctl", "loginctl"):
            path = self.bin / name
            path.write_text(implementation, encoding="utf-8")
            path.chmod(0o755)
        case.addCleanup(self._cleanup)

    def _cleanup(self) -> None:
        import shutil

        shutil.rmtree(self.directory, ignore_errors=True)

    def run(
        self,
        args: list[str] | tuple[str, ...],
        *,
        env: dict[str, str] | None = None,
        cwd: Path | None = None,
        artifact: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        command = [sys.executable]
        command.append(str(ARTIFACT if artifact else SOURCE))
        command.extend(args)
        environment = {
            **os.environ,
            "PATH": str(self.bin),
            "HOME": str(self.home),
            "XDG_CONFIG_HOME": str(self.config),
            "INSTALL_TEST_TRACE": str(self.trace),
            "INSTALL_TEST_SELINUX": "Disabled",
        }
        environment.update(env or {})
        return subprocess.run(
            command,
            check=False,
            stdin=subprocess.DEVNULL,
            text=True,
            cwd=str(cwd or self.directory),
            env=environment,
            capture_output=True,
            timeout=60,
        )

    def calls(self) -> list[dict]:
        if not self.trace.exists():
            return []
        return [
            json.loads(line)
            for line in self.trace.read_text(encoding="utf-8").splitlines()
            if line
        ]

    def cleanup_calls(self) -> None:
        if self.trace.exists():
            self.trace.unlink()


class ValidationTests(unittest.TestCase):
    def test_ports_paths_origins_and_tags(self) -> None:
        self.assertTrue(valid_port("3000"))
        self.assertFalse(valid_port("0"))
        self.assertFalse(valid_port("65536"))
        self.assertFalse(valid_port("80", rootless=True))
        self.assertTrue(valid_port("1024", rootless=True))
        self.assertTrue(valid_path("/srv/media files"))
        self.assertFalse(valid_path("relative"))
        self.assertFalse(valid_path("/srv/a:b"))
        self.assertFalse(valid_path("/srv/$HOME"))
        self.assertTrue(valid_ipv4("0.0.0.0"))
        self.assertFalse(valid_ipv4("127.0.0.01"))
        self.assertTrue(valid_origin("https://anime.example.com"))
        self.assertTrue(valid_origin("http://127.0.0.1:8080"))
        self.assertFalse(valid_origin("https://anime.example.com/path"))
        self.assertTrue(valid_image_tag("v1.2.3"))
        self.assertFalse(valid_image_tag("bad tag"))


class AssetTests(unittest.TestCase):
    def test_checkout_templates_are_read_from_deployment_templates(self) -> None:
        source = AssetSource()
        try:
            self.assertEqual(source.resolve(), "bundled")
            self.assertEqual(
                source.read("compose.yaml"),
                (TEMPLATES / "compose.yaml").read_bytes(),
            )
        finally:
            source.close()

    def test_missing_template_is_rejected(self) -> None:
        source = AssetSource()
        try:
            with self.assertRaises(InstallerError):
                source.read("missing.yaml")
        finally:
            source.close()


class RenderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.compose_template = (TEMPLATES / "compose.yaml").read_text(encoding="utf-8")

    def test_backend_log_mounts_for_compose_and_quadlet(self) -> None:
        settings = make_settings(
            deploy_dir=Path("/tmp/anishelf-test deployment"),
            test_mode=True,
            selinux_mode="Enforcing",
            log_destination="both",
        )
        compose = render_compose(self.compose_template, settings)
        quadlet = render_quadlet(
            "anishelf-backend.container",
            (TEMPLATES / "quadlet/anishelf-backend.container").read_text(),
            settings,
        )
        mount = "/tmp/anishelf-test deployment/logs:/var/log/anishelf:rw,z"
        self.assertIn(f'"{mount}"', compose)
        self.assertIn(f'Volume="{mount}"', quadlet)
        self.assertIn("ANISHELF_LOG_DESTINATION: both", compose)
        self.assertIn("Environment=ANISHELF_LOG_DESTINATION=both", quadlet)
        self.assertIn("/var/log/anishelf/anishelf.log", compose)
        self.assertIn("/var/log/anishelf/anishelf.log", quadlet)
        settings.log_path = "/tmp/custom logs/backend.log"
        quadlet = render_quadlet(
            "anishelf-backend.container",
            (TEMPLATES / "quadlet/anishelf-backend.container").read_text(),
            settings,
        )
        self.assertIn('Volume="/tmp/custom logs:/var/log/anishelf:rw"', quadlet)
        self.assertIn('/var/log/anishelf/backend.log', quadlet)
        settings.log_destination = "stdout"
        compose = render_compose(self.compose_template, settings)
        self.assertIn("ANISHELF_LOG_DESTINATION: stdout", compose)
        self.assertNotIn("ANISHELF_LOG_PATH", compose)
        self.assertNotIn("/var/log/anishelf", compose)
        settings.log_destination = "file"
        compose = render_compose(self.compose_template, settings)
        self.assertIn("ANISHELF_LOG_DESTINATION: file", compose)
        self.assertIn('/var/log/anishelf/backend.log', compose)

    def test_compose_selects_services_and_volumes_without_profiles(self) -> None:
        for qbit in (False, True):
            for jackett in (False, True):
                for test_mode in (False, True):
                    with self.subTest(qbit=qbit, jackett=jackett, test_mode=test_mode):
                        rendered = render_compose(
                            self.compose_template,
                            make_settings(qbit=qbit, jackett=jackett, test_mode=test_mode),
                        )
                        service_text, volume_text = rendered.split("\nvolumes:\n")
                        expected_services = {"backend", "web"}
                        expected_volumes = {"anishelf-app", "anishelf-media"}
                        if qbit:
                            expected_services.update({"qbittorrent", "qbittorrent-init"})
                            expected_volumes.update({
                                "qbittorrent-config", "qbittorrent-connection",
                                "qbittorrent-incomplete",
                            })
                        if jackett:
                            expected_services.update({"jackett", "jackett-init"})
                            expected_volumes.add("jackett-config")
                        self.assertEqual(
                            set(re.findall(r"^  ([\w-]+):$", service_text, re.MULTILINE)),
                            expected_services,
                        )
                        self.assertEqual(
                            set(re.findall(r"^  ([\w-]+):$", volume_text, re.MULTILINE)),
                            expected_volumes,
                        )
                        self.assertNotIn("profiles:", rendered)
                        self.assertEqual("ANISHELF_QBITTORRENT_API_URL:" in rendered, qbit)
                        self.assertEqual(
                            "ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE:" in rendered, qbit,
                        )
                        self.assertEqual(
                            "qbittorrent-connection:/run/anishelf-qbittorrent:ro" in rendered, qbit,
                        )
                        self.assertEqual("ANISHELF_BUNDLED_JACKETT_CONFIG_FILE:" in rendered, jackett)
                        self.assertEqual("jackett-config:/run/jackett-config:ro" in rendered, jackett)
                        if qbit:
                            self.assertIn(
                                "qbittorrent-init:\n        condition: service_completed_successfully",
                                rendered,
                            )
                        if jackett:
                            self.assertIn(
                                "jackett-init:\n        condition: service_completed_successfully",
                                rendered,
                            )
                        prefix = "anishelf-test" if test_mode else "anishelf"
                        for volume in expected_volumes:
                            suffix = volume.removeprefix("anishelf-")
                            self.assertIn(f"name: {prefix}-{suffix}", volume_text)
                        self.assertIn("condition: service_healthy", rendered)
                        self.assertIn("/data/media:rw", rendered)

    def test_quadlet_backend_omits_disabled_connections(self) -> None:
        template = (TEMPLATES / "quadlet" / "anishelf-backend.container").read_text()
        for qbit in (False, True):
            for jackett in (False, True):
                with self.subTest(qbit=qbit, jackett=jackett):
                    rendered = render_quadlet(
                        "anishelf-backend.container", template,
                        make_settings(qbit=qbit, jackett=jackett),
                    )
                    self.assertEqual("ANISHELF_QBITTORRENT_API_URL=" in rendered, qbit)
                    self.assertEqual("ANISHELF_BUNDLED_QBITTORRENT_CONNECTION_FILE=" in rendered, qbit)
                    self.assertEqual("Volume=anishelf-qbittorrent-connection.volume:" in rendered, qbit)
                    self.assertEqual("ANISHELF_BUNDLED_JACKETT_CONFIG_FILE=" in rendered, jackett)
                    self.assertEqual("Volume=anishelf-jackett-config.volume:" in rendered, jackett)

    def test_compose_renders_extra_media_and_selinux(self) -> None:
        settings = make_settings(
            media_path="/srv/media",
            extra_paths=["/srv/extra one", "/srv/extra two"],
            selinux_suffix=",z",
            qbit=True,
            jackett=True,
        )
        rendered = render_compose(self.compose_template, settings)
        self.assertIn(
            "ANISHELF_INITIAL_RESOURCE_ROOTS: /data/media:/data/extra/1:/data/extra/2",
            rendered,
        )
        self.assertIn(
            '      - "/srv/extra one:/data/extra/1:rw,z"',
            rendered,
        )
        self.assertIn(":/data/media:rw,z", rendered)
        self.assertIn(":/data/media:z", rendered)
        self.assertNotIn("chown \"$${PUID}:$${PGID}\" /data/media", rendered)

    def test_quadlet_renders_extra_media_and_selinux(self) -> None:
        settings = make_settings(
            engine="podman",
            method="quadlet",
            media_path="/srv/media",
            extra_paths=["/srv/extra"],
            selinux_suffix=",z",
            qbit=True,
            image_tag="v0.4.1",
        )
        backend = (
            TEMPLATES / "quadlet" / "anishelf-backend.container"
        ).read_text(encoding="utf-8")
        qbit = (
            TEMPLATES / "quadlet" / "anishelf-qbittorrent.container"
        ).read_text(encoding="utf-8")
        rendered_backend = render_quadlet(
            "anishelf-backend.container", backend, settings
        )
        rendered_qbit = render_quadlet(
            "anishelf-qbittorrent.container", qbit, settings
        )
        self.assertIn("Image=ghcr.io/qw0er/anishelf-backend:v0.4.1", rendered_backend)
        self.assertIn(
            "Environment=ANISHELF_INITIAL_RESOURCE_ROOTS=/data/media:/data/extra/1",
            rendered_backend,
        )
        self.assertIn("Volume=/srv/media:/data/media:rw,z", rendered_backend)
        self.assertIn("Volume=/srv/extra:/data/extra/1:rw,z", rendered_backend)
        self.assertIn("Volume=/srv/media:/data/media:z", rendered_qbit)
        self.assertIn("chown 1000:1000 /data/incomplete", rendered_qbit)
        self.assertNotIn("chown 1000:1000 /data/media", rendered_qbit)

    def test_testing_quadlet_namespaces_resources_but_not_images(self) -> None:
        settings = make_settings(
            engine="podman",
            method="quadlet",
            stack="anishelf-test",
            test_mode=True,
            image_tag="testing",
        )
        backend = (
            TEMPLATES / "quadlet" / "anishelf-backend.container"
        ).read_text(encoding="utf-8")
        rendered = render_quadlet("anishelf-backend.container", backend, settings)
        self.assertIn("Image=ghcr.io/qw0er/anishelf-backend:testing", rendered)
        self.assertIn("Network=anishelf-test.network", rendered)
        self.assertIn("Volume=anishelf-test-app.volume:/var/lib/anishelf", rendered)


class InstallerTests(unittest.TestCase):
    def health_server(self) -> int:
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            type(
                "HealthHandler",
                (BaseHTTPRequestHandler,),
                {
                    "do_GET": lambda self: (
                        self.send_response(200),
                        self.end_headers(),
                        self.wfile.write(b"ok"),
                    ),
                    "log_message": lambda self, *args: None,
                },
            ),
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    def generate(self, fixture: Fixture, *flags: str, env=None, artifact=False):
        return fixture.run(
            [
                "install",
                "--generate-only",
                *flags,
            ],
            env=env,
            artifact=artifact,
        )

    def install(self, fixture: Fixture, *flags: str, env=None, artifact=False):
        return fixture.run(
            ["install", *flags],
            env=env,
            artifact=artifact,
        )

    def test_saved_settings_survive_reconfiguration_and_explicit_resets(self) -> None:
        fixture = Fixture(self)
        media = fixture.directory / "media"
        extra = fixture.directory / "extra"
        log_dir = fixture.directory / "custom logs"
        media.mkdir()
        extra.mkdir()
        log_dir.mkdir()
        port = self.health_server()
        generated = self.generate(
            fixture, "--engine", "docker", "--deploy-dir", str(fixture.target),
            "--image-tag", "v1.4.1", "--port", str(port), "--bind", "0.0.0.0",
            "--public-origin", "https://anime.example.com", "--log-level", "warn",
            "--log-path", str(log_dir / "backend.log"),
            "--log-destination", "both",
            "--media", str(media), "--extra-media", str(extra), "--no-selinux-relabel",
            "--qbit", "--jackett", "--qbit-port", "8181", "--peer-port", "6991",
        )
        self.assertEqual(generated.returncode, 0, generated.stderr)
        before = json.loads((fixture.target / "deployment.json").read_text())["settings"]
        result = fixture.run(["reconfigure", str(fixture.target)])
        self.assertEqual(result.returncode, 0, result.stderr)
        after = json.loads((fixture.target / "deployment.json").read_text())["settings"]
        self.assertEqual(after, before)
        compose = (fixture.target / "compose.yaml").read_text()
        self.assertIn(f'{log_dir}:/var/log/anishelf:rw', compose)
        self.assertIn('/var/log/anishelf/backend.log', compose)
        reset = fixture.run([
            "reconfigure", str(fixture.target), "--managed-media", "--clear-extra-media",
            "--no-qbit", "--no-jackett", "--public-origin", "", "--image-tag", "latest",
        ])
        self.assertEqual(reset.returncode, 0, reset.stderr)
        settings = json.loads((fixture.target / "deployment.json").read_text())["settings"]
        self.assertEqual(settings["media_path"], "")
        self.assertEqual(settings["extra_paths"], [])
        self.assertFalse(settings["qbit"])
        self.assertFalse(settings["jackett"])
        self.assertEqual(settings["public_origin"], "")
        self.assertEqual(settings["image_tag"], "latest")
        self.assertEqual(settings["qbit_port"], 8181)
        compose = (fixture.target / "compose.yaml").read_text()
        self.assertNotIn("qbittorrent", compose)
        self.assertNotIn("jackett", compose)
        self.assertFalse((fixture.target / "manage.sh").exists())
        downs = [call for call in fixture.calls() if "down" in call["args"]]
        self.assertTrue(downs)
        self.assertTrue(all(
            "--volumes" not in call["args"] and "-v" not in call["args"] for call in downs
        ))

    def test_compose_generation_includes_only_selected_service_settings(self) -> None:
        for qbit in (False, True):
            for jackett in (False, True):
                with self.subTest(qbit=qbit, jackett=jackett):
                    fixture = Fixture(self)
                    flags = (["--qbit"] if qbit else []) + (["--jackett"] if jackett else [])
                    result = self.generate(
                        fixture, "--engine", "docker",
                        "--deploy-dir", str(fixture.target), *flags,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    compose = (fixture.target / "compose.yaml").read_text()
                    env = (fixture.target / ".env").read_text()
                    self.assertNotIn("profiles:", compose)
                    self.assertNotIn("COMPOSE_PROFILES", env)
                    self.assertEqual("  qbittorrent:" in compose, qbit)
                    self.assertEqual("  jackett:" in compose, jackett)
                    self.assertEqual("QBITTORRENT_TAG=" in env, qbit)
                    self.assertEqual("JACKETT_PORT=" in env, jackett)
                    self.assertFalse((fixture.target / "manage.sh").exists())

    @unittest.skipIf(os.geteuid() == 0, "rootless Quadlet generation requires a non-root user")
    def test_quadlet_generation_selects_units_and_reports_native_testing_commands(self) -> None:
        for qbit in (False, True):
            for jackett in (False, True):
                with self.subTest(qbit=qbit, jackett=jackett):
                    fixture = Fixture(self)
                    flags = (["--qbit"] if qbit else []) + (["--jackett"] if jackett else [])
                    result = self.generate(
                        fixture, "--engine", "podman",
                        "--deploy-dir", str(fixture.target), "--test", *flags,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    units = fixture.target / "quadlet"
                    self.assertEqual((units / "anishelf-test-qbittorrent-connection.volume").exists(), qbit)
                    self.assertEqual((units / "anishelf-test-qbittorrent-init.container").exists(), qbit)
                    self.assertEqual((units / "anishelf-test-qbittorrent.container").exists(), qbit)
                    self.assertEqual((units / "anishelf-test-jackett-config.volume").exists(), jackett)
                    self.assertEqual((units / "anishelf-test-jackett-init.container").exists(), jackett)
                    self.assertEqual((units / "anishelf-test-jackett.container").exists(), jackett)
                    self.assertFalse((fixture.target / "manage.sh").exists())
                    self.assertFalse((fixture.config / "containers").exists())
                    self.assertIn("Install generated units", result.stderr)
                    self.assertIn("systemctl --user enable --now anishelf-test.target", result.stderr)
                    self.assertIn("systemctl --user stop anishelf-test.target", result.stderr)
                    self.assertIn("journalctl --user -u anishelf-test-backend.service", result.stderr)
                    update = next(line for line in result.stderr.splitlines() if "Update application" in line)
                    self.assertIn(
                        "podman pull ghcr.io/qw0er/anishelf-backend:testing "
                        "ghcr.io/qw0er/anishelf-web:testing && systemctl --user restart "
                        "anishelf-test-backend.service anishelf-test-web.service",
                        update,
                    )
                    self.assertNotIn("qbittorrent", update)
                    self.assertNotIn("jackett", update)
                    if qbit or jackett:
                        update_all = next(
                            line for line in result.stderr.splitlines()
                            if "Update all configured services" in line
                        )
                        self.assertEqual("docker.io/linuxserver/qbittorrent:latest" in update_all, qbit)
                        self.assertEqual("anishelf-test-qbittorrent.service" in update_all, qbit)
                        self.assertEqual("ghcr.io/linuxserver/jackett:latest" in update_all, jackett)
                        self.assertEqual("anishelf-test-jackett.service" in update_all, jackett)

    def test_compose_generation_defaults(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        compose = (fixture.target / "compose.yaml").read_text(encoding="utf-8")
        self.assertNotIn("profiles:", compose)
        self.assertNotIn("qbittorrent", compose)
        self.assertNotIn("jackett", compose)
        self.assertIn("  backend:", compose)
        self.assertIn("  web:", compose)
        self.assertIn('ANISHELF_LOG_DESTINATION: stdout', compose)
        self.assertNotIn('/var/log/anishelf', compose)
        self.assertFalse((fixture.target / "logs").exists())
        env = (fixture.target / ".env").read_text(encoding="utf-8")
        self.assertIn("ANISHELF_TAG='latest'", env)
        self.assertIn("ANISHELF_LOG_LEVEL='info'", env)
        self.assertNotIn("COMPOSE_PROFILES", env)
        self.assertIn("ANISHELF_TRUSTED_PROXIES='loopback,uniquelocal'", env)
        self.assertEqual(
            stat.S_IMODE((fixture.target / ".env").stat().st_mode), 0o600
        )
        self.assertEqual(
            stat.S_IMODE((fixture.target / "install.log").stat().st_mode), 0o600
        )
        self.assertEqual([call["name"] for call in fixture.calls()], ["getenforce"])
        self.assertFalse((fixture.target / "manage.sh").exists())
        self.assertIn("docker compose up -d", result.stderr)
        self.assertIn("docker compose down --remove-orphans", result.stderr)
        self.assertIn(
            "docker compose pull backend web && docker compose up -d --no-deps backend web",
            result.stderr,
        )

    def test_file_logging_creates_default_directory(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture, "--engine", "docker", "--deploy-dir", str(fixture.target),
            "--log-destination", "file",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        compose = (fixture.target / "compose.yaml").read_text()
        self.assertIn("ANISHELF_LOG_DESTINATION: file", compose)
        self.assertIn(f'{fixture.target}/logs:/var/log/anishelf:rw', compose)
        self.assertEqual(stat.S_IMODE((fixture.target / "logs").stat().st_mode), 0o700)
        self.assertIn("docker compose pull && docker compose up -d", result.stderr)
        self.assertIn("no profiles required", result.stderr)

    def test_generate_only_uses_no_temporary_staging_directory(self) -> None:
        fixture = Fixture(self)
        temporary = fixture.directory / "tmp"
        temporary.mkdir()
        result = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            env={"TMPDIR": str(temporary)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(list(temporary.iterdir()), [])

    def test_bind_address_replaces_lan_shorthand(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            "--bind",
            "0.0.0.0",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        env = (fixture.target / ".env").read_text(encoding="utf-8")
        self.assertIn("ANISHELF_BIND_ADDRESS='0.0.0.0'", env)

    def test_compose_extra_media_and_selinux(self) -> None:
        fixture = Fixture(self)
        media = fixture.directory / "media"
        extra = fixture.directory / "extra one"
        media.mkdir()
        extra.mkdir()
        result = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            "--media",
            str(media),
            "--extra-media",
            str(extra),
            "--qbit",
            "--jackett",
            "--selinux-relabel",
            env={"INSTALL_TEST_SELINUX": "Enforcing"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        compose = (fixture.target / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn(f'      - "{extra}:/data/extra/1:rw,z"', compose)
        env = (fixture.target / ".env").read_text(encoding="utf-8")
        self.assertIn(f"ANISHELF_MEDIA_PATH='{media}'", env)
        self.assertNotIn("COMPOSE_PROFILES", env)

    @unittest.skipIf(os.geteuid() == 0, "rootless Quadlet requires a non-root user")
    def test_quadlet_generation_ports_volumes_and_images(self) -> None:
        fixture = Fixture(self)
        media = fixture.directory / "media"
        extra = fixture.directory / "extra"
        media.mkdir()
        extra.mkdir()
        result = self.generate(
            fixture,
            "--engine",
            "podman",
            "--deploy-dir",
            str(fixture.target),
            "--media",
            str(media),
            "--extra-media",
            str(extra),
            "--qbit",
            "--jackett",
            "--image-tag",
            "v0.4.1",
            "--log-level",
            "error",
            "--port",
            "3300",
            "--qbit-port",
            "8181",
            "--peer-port",
            "6991",
            "--jackett-port",
            "9217",
            "--selinux-relabel",
            env={"INSTALL_TEST_SELINUX": "Enforcing"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        quadlet = fixture.target / "quadlet"
        backend = (quadlet / "anishelf-backend.container").read_text(encoding="utf-8")
        qbit = (quadlet / "anishelf-qbittorrent.container").read_text(encoding="utf-8")
        web = (quadlet / "anishelf-web.container").read_text(encoding="utf-8")
        jackett = (quadlet / "anishelf-jackett.container").read_text(encoding="utf-8")
        self.assertIn("Image=ghcr.io/qw0er/anishelf-backend:v0.4.1", backend)
        self.assertIn("Environment=ANISHELF_LOG_LEVEL=error", backend)
        self.assertIn(f"Volume={media}:/data/media:rw,z", backend)
        self.assertIn(f"Volume={extra}:/data/extra/1:rw,z", backend)
        self.assertIn("Environment=TORRENTING_PORT=6991", qbit)
        self.assertIn("PublishPort=127.0.0.1:8181:8080", qbit)
        self.assertIn("PublishPort=6991:6991/udp", qbit)
        self.assertIn("PublishPort=127.0.0.1:3300:8080", web)
        self.assertIn("PublishPort=127.0.0.1:9217:9117", jackett)
        self.assertFalse((fixture.config / "containers").exists())
        self.assertFalse((fixture.target / "manage.sh").exists())

    @unittest.skipIf(os.geteuid() == 0, "rootless Quadlet requires a non-root user")
    def test_testing_profile_isolates_quadlet_and_compose(self) -> None:
        quadlet_fixture = Fixture(self)
        result = self.generate(
            quadlet_fixture,
            "--test",
            "--engine",
            "podman",
            "--deploy-dir",
            str(quadlet_fixture.target),
            "--qbit",
            "--jackett",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        quadlet = quadlet_fixture.target / "quadlet"
        self.assertTrue((quadlet / "anishelf-test.network").is_file())
        self.assertTrue((quadlet / "anishelf-test.target").is_file())
        backend = (quadlet / "anishelf-test-backend.container").read_text(
            encoding="utf-8"
        )
        self.assertIn("Image=ghcr.io/qw0er/anishelf-backend:testing", backend)
        self.assertIn("Environment=ANISHELF_LOG_LEVEL=debug", backend)
        self.assertIn("Volume=anishelf-test-app.volume:/var/lib/anishelf", backend)
        self.assertEqual(
            (quadlet / "anishelf-test.network").read_text(encoding="utf-8"),
            "[Network]\nNetworkName=anishelf-test\n",
        )

        compose_fixture = Fixture(self)
        result = self.generate(
            compose_fixture,
            "--test",
            "--engine",
            "docker",
            "--deploy-dir",
            str(compose_fixture.target),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        compose = (compose_fixture.target / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn("name: anishelf-test-app", compose)
        env = (compose_fixture.target / ".env").read_text(encoding="utf-8")
        self.assertIn("ANISHELF_TAG='testing'", env)
        self.assertIn("ANISHELF_LOG_LEVEL='debug'", env)
        self.assertIn("ANISHELF_PORT='3001'", env)
        self.assertIn("COMPOSE_PROJECT_NAME='anishelf-test'", env)
        self.assertEqual(
            (compose_fixture.target / ".deployment-profile").read_text(encoding="utf-8"),
            "testing\n",
        )

    def test_log_level_override_and_validation(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture, "--test", "--engine", "docker", "--deploy-dir",
            str(fixture.target), "--log-level", "warn",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("ANISHELF_LOG_LEVEL='warn'", (fixture.target / ".env").read_text())
        self.assertIn("log level=warn", result.stderr)

        invalid = Fixture(self)
        result = self.generate(
            invalid, "--engine", "docker", "--deploy-dir", str(invalid.target),
            "--log-level", "verbose",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid choice", result.stderr)
        self.assertFalse(invalid.target.exists())

    def test_existing_directory_is_not_overwritten(self) -> None:
        fixture = Fixture(self)
        fixture.target.mkdir()
        (fixture.target / ".env").write_text("preserve me", encoding="utf-8")
        rejected = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("already exists", rejected.stderr)
        self.assertEqual(
            (fixture.target / ".env").read_text(encoding="utf-8"), "preserve me"
        )

    def test_selinux_refuses_system_width_relabeling(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            "--media",
            "/etc",
            "--selinux-relabel",
            env={"INSTALL_TEST_SELINUX": "Enforcing"},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Refusing to relabel", result.stderr)
        self.assertFalse(fixture.target.exists())

    def test_remove_archives_configuration_and_preserves_unrelated_files(self) -> None:
        fixture = Fixture(self)
        generated = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertEqual(generated.returncode, 0, generated.stderr)
        (fixture.target / "keep.txt").write_text("user data", encoding="utf-8")
        original = (fixture.target / "compose.yaml").read_text(encoding="utf-8")
        fixture.cleanup_calls()

        result = fixture.run(["remove", str(fixture.target)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(fixture.target.exists())
        backups = [
            path
            for path in fixture.directory.iterdir()
            if path.name.startswith("deployment.backup.")
        ]
        self.assertEqual(len(backups), 1)
        self.assertEqual(
            (backups[0] / "keep.txt").read_text(encoding="utf-8"), "user data"
        )
        self.assertEqual(
            (backups[0] / "compose.yaml").read_text(encoding="utf-8"), original
        )
        downs = [
            call
            for call in fixture.calls()
            if call["name"] == "docker" and "down" in call["args"]
        ]
        self.assertEqual(len(downs), 1)
        self.assertNotIn("--volumes", downs[0]["args"])
        self.assertNotIn("-v", downs[0]["args"])

    def test_remove_rejects_unrecognized_compose_bundle(self) -> None:
        fixture = Fixture(self)
        generated = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertEqual(generated.returncode, 0, generated.stderr)
        env_file = fixture.target / ".env"
        env_file.write_text(
            env_file.read_text(encoding="utf-8").replace(
                "COMPOSE_PROJECT_NAME='anishelf'",
                "COMPOSE_PROJECT_NAME='other'",
            ),
            encoding="utf-8",
        )
        fixture.cleanup_calls()
        result = fixture.run(["remove", str(fixture.target)])
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((fixture.target / "compose.yaml").is_file())
        self.assertFalse(
            any(
                call["name"] == "docker" and "down" in call["args"]
                for call in fixture.calls()
            )
        )

    def test_reconfigure_archives_old_bundle_and_starts_replacement(self) -> None:
        fixture = Fixture(self)
        generated = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertEqual(generated.returncode, 0, generated.stderr)
        (fixture.target / "custom.txt").write_text("old notes", encoding="utf-8")
        (fixture.target / "deployment.json").unlink()
        with (fixture.target / ".env").open("a") as stream:
            stream.write("# local edit in a legacy deployment\n")
        port = self.health_server()

        result = fixture.run(
            [
                "reconfigure",
                str(fixture.target),
                "--port",
                str(port),
                "--qbit",
                "--jackett",
            ]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("No saved installation parameters", result.stderr)
        env = (fixture.target / ".env").read_text(encoding="utf-8")
        self.assertNotIn("COMPOSE_PROFILES", env)
        self.assertFalse((fixture.target / "custom.txt").exists())
        backups = [
            path
            for path in fixture.directory.iterdir()
            if path.name.startswith("deployment.backup.")
        ]
        self.assertEqual(len(backups), 1)
        self.assertEqual(
            (backups[0] / "custom.txt").read_text(encoding="utf-8"), "old notes"
        )
        calls = fixture.calls()
        down_index = next(
            index
            for index, call in enumerate(calls)
            if call["name"] == "docker" and "down" in call["args"]
        )
        up_index = next(
            index
            for index, call in enumerate(calls)
            if call["name"] == "docker" and "up" in call["args"]
        )
        self.assertLess(down_index, up_index)
        self.assertTrue(
            any(call["name"] == "docker" and "config" in call["args"] for call in calls)
        )

    def test_compose_startup_validates_pulls_starts_and_checks_health(self) -> None:
        fixture = Fixture(self)
        port = self.health_server()
        result = self.install(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            "--port",
            str(port),
            "--qbit",
            "--jackett",
            env={"ANISHELF_TAG": "wrong-inherited-tag", "COMPOSE_PROFILES": "unrelated"},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = fixture.calls()
        compose_calls = [
            call
            for call in calls
            if call["name"] == "docker"
            and call["args"][:1] == ["compose"]
            and call["args"][1] != "version"
        ]
        self.assertEqual(
            {call["args"][-1] for call in compose_calls},
            {"--quiet", "pull", "-d"},
        )
        self.assertTrue(all(call["tag"] is None for call in compose_calls))
        self.assertTrue(all(call["profiles"] is None for call in compose_calls))
        self.assertTrue(all("--profile" not in call["args"] for call in compose_calls))
        self.assertIn(
            "Deployment is healthy",
            (fixture.target / "install.log").read_text(encoding="utf-8"),
        )

    @unittest.skipUnless(sys.platform == "linux", "Quadlet startup requires Linux")
    @unittest.skipIf(os.geteuid() == 0, "rootless Quadlet requires a non-root user")
    def test_quadlet_install_refuses_existing_units(self) -> None:
        fixture = Fixture(self)
        installed = fixture.config / "containers" / "systemd"
        installed.mkdir(parents=True)
        conflicting = installed / "anishelf-backend.container"
        conflicting.write_text("existing configuration", encoding="utf-8")
        port = self.health_server()

        rejected = self.install(
            fixture,
            "--engine",
            "podman",
            "--deploy-dir",
            str(fixture.target),
            "--port",
            str(port),
        )
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("Existing Anishelf unit is preserved", rejected.stderr)
        self.assertEqual(
            conflicting.read_text(encoding="utf-8"), "existing configuration"
        )
        self.assertFalse(fixture.target.exists())

    @unittest.skipUnless(sys.platform == "linux", "Quadlet startup requires Linux")
    @unittest.skipIf(os.geteuid() == 0, "rootless Quadlet requires a non-root user")
    def test_quadlet_reconfigure_force_backs_up_changed_units(self) -> None:
        fixture = Fixture(self)
        port = self.health_server()
        installed = fixture.config / "containers" / "systemd"
        start = self.install(
            fixture,
            "--engine",
            "podman",
            "--deploy-dir",
            str(fixture.target),
            "--port",
            str(port),
        )
        self.assertEqual(start.returncode, 0, start.stderr)
        changed = installed / "anishelf-backend.container"
        changed.write_text("local edits", encoding="utf-8")

        result = fixture.run(
            [
                "reconfigure",
                str(fixture.target),
                "--force",
                "--port",
                str(port),
            ]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Image=", changed.read_text(encoding="utf-8"))
        backups = [
            path
            for path in fixture.directory.iterdir()
            if path.name.startswith("deployment.quadlet-backup.")
        ]
        self.assertEqual(len(backups), 1)
        self.assertEqual(
            (backups[0] / "anishelf-backend.container").read_text(encoding="utf-8"),
            "local edits",
        )

    @unittest.skipUnless(sys.platform == "linux", "Quadlet startup requires Linux")
    @unittest.skipIf(os.geteuid() == 0, "rootless Quadlet requires a non-root user")
    def test_quadlet_remove_only_matching_units(self) -> None:
        fixture = Fixture(self)
        port = self.health_server()
        start = self.install(
            fixture,
            "--engine",
            "podman",
            "--deploy-dir",
            str(fixture.target),
            "--port",
            str(port),
        )
        self.assertEqual(start.returncode, 0, start.stderr)
        installed = fixture.config / "containers" / "systemd"
        unrelated = installed / "unrelated.container"
        unrelated.write_text("user service", encoding="utf-8")
        fixture.cleanup_calls()

        removed = fixture.run(["remove", str(fixture.target)])
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertFalse(fixture.target.exists())
        self.assertFalse((installed / "anishelf-backend.container").exists())
        self.assertFalse(
            (fixture.config / "systemd" / "user" / "anishelf.target").exists()
        )
        self.assertEqual(unrelated.read_text(encoding="utf-8"), "user service")
        backups = [
            path
            for path in fixture.directory.iterdir()
            if path.name.startswith("deployment.backup.")
        ]
        self.assertEqual(len(backups), 1)
        self.assertTrue(
            (backups[0] / "quadlet" / "anishelf-backend.container").is_file()
        )
        calls = fixture.calls()
        self.assertTrue(
            any(
                call["name"] == "systemctl"
                and call["args"][:3] == ["--user", "stop", "anishelf.target"]
                for call in calls
            )
        )
        self.assertFalse(
            any(
                call["name"] == "podman" and "rm" in call["args"] for call in calls
            )
        )

    def test_subcommand_is_required(self) -> None:
        fixture = Fixture(self)
        result = fixture.run([])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("COMMAND", result.stderr)

    def test_both_engines_require_an_explicit_engine(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture,
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Both Docker and Podman", result.stderr)
        self.assertFalse(fixture.target.exists())

    def test_single_engine_is_detected_automatically(self) -> None:
        fixture = Fixture(self)
        (fixture.bin / "podman").unlink()
        result = self.generate(
            fixture,
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Detected docker", result.stderr)

    def test_invalid_and_colliding_ports_are_rejected(self) -> None:
        fixture = Fixture(self)
        missing_qbit = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            "--qbit-port",
            "8181",
        )
        self.assertNotEqual(missing_qbit.returncode, 0)
        self.assertIn("require --qbit", missing_qbit.stderr)

        collision = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            "--port",
            "3300",
            "--qbit",
            "--qbit-port",
            "3300",
        )
        self.assertNotEqual(collision.returncode, 0)
        self.assertIn("TCP ports must be distinct", collision.stderr)
        self.assertFalse(fixture.target.exists())

    @unittest.skipIf(os.geteuid() == 0, "rootless Quadlet requires a non-root user")
    def test_rootless_ports_below_1024_are_rejected(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture,
            "--engine",
            "podman",
            "--deploy-dir",
            str(fixture.target),
            "--port",
            "80",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("1024 or higher", result.stderr)
        self.assertFalse(fixture.target.exists())

    def test_packaged_pyz_runs_and_matches_sources(self) -> None:
        self.assertTrue(ARTIFACT.is_file(), f"Missing packaged installer: {ARTIFACT}")
        temporary = Path(tempfile.mkdtemp(prefix="anishelf-pyz-build-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(temporary, ignore_errors=True))
        rebuilt = temporary / "install.pyz"
        build = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "build-installer.py"),
                "--output",
                str(rebuilt),
            ],
            check=False,
            text=True,
            capture_output=True,
            timeout=60,
        )
        self.assertEqual(build.returncode, 0, build.stderr)
        with zipfile.ZipFile(ARTIFACT) as committed, zipfile.ZipFile(rebuilt) as fresh:
            self.assertEqual(sorted(committed.namelist()), sorted(fresh.namelist()))
            for name in committed.namelist():
                self.assertEqual(committed.read(name), fresh.read(name), name)

        help_result = subprocess.run(
            [sys.executable, str(ARTIFACT), "--help"],
            check=False,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        for command in ("install", "reconfigure", "remove"):
            self.assertIn(command, help_result.stdout)
        install_help = subprocess.run(
            [sys.executable, str(ARTIFACT), "install", "--help"],
            check=False,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(install_help.returncode, 0, install_help.stderr)
        self.assertIn("--deploy-dir", install_help.stdout)

    def test_packaged_pyz_generates_a_bundle(self) -> None:
        fixture = Fixture(self)
        result = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            artifact=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((fixture.target / "compose.yaml").is_file())


if __name__ == "__main__":
    unittest.main()
