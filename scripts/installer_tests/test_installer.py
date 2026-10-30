"""Tests for the stdlib-only Anishelf installer and its packaged artifact."""

from __future__ import annotations

import json
import os
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

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
SOURCE = SCRIPTS / "installer"
TEMPLATES = ROOT / "package" / "deploy"
ARTIFACT = SCRIPTS / "install.pyz"

sys.path.insert(0, str(SOURCE))

from anishelf_install.assets import AssetSource  # noqa: E402
from anishelf_install.config import Settings  # noqa: E402
from anishelf_install.errors import InstallerError  # noqa: E402
from anishelf_install.render import render_compose, render_quadlet  # noqa: E402
from anishelf_install.validation import (  # noqa: E402
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


class Fixture:
    def __init__(self, case: unittest.TestCase) -> None:
        self.case = case
        self.directory = Path(tempfile.mkdtemp(prefix="anishelf-installer-test-"))
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
    def test_checkout_templates_are_read_from_package_deploy(self) -> None:
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

    def test_compose_defaults_leave_canonical_template_unchanged(self) -> None:
        rendered = render_compose(self.compose_template, make_settings())
        self.assertEqual(rendered, self.compose_template)

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
        self.assertIn("Volume=anishelf-test-app.volume:/data/app", rendered)


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
        self.assertEqual(
            (fixture.target / "compose.yaml").read_text(encoding="utf-8"),
            (TEMPLATES / "compose.yaml").read_text(encoding="utf-8"),
        )
        env = (fixture.target / ".env").read_text(encoding="utf-8")
        self.assertIn("ANISHELF_TAG='latest'", env)
        self.assertIn("COMPOSE_PROFILES=''", env)
        self.assertIn("ANISHELF_TRUSTED_PROXIES='loopback,uniquelocal'", env)
        self.assertEqual(
            stat.S_IMODE((fixture.target / ".env").stat().st_mode), 0o600
        )
        self.assertEqual(
            stat.S_IMODE((fixture.target / "install.log").stat().st_mode), 0o600
        )
        self.assertEqual([call["name"] for call in fixture.calls()], ["getenforce"])
        helper = fixture.target / "manage.sh"
        self.assertTrue(helper.is_file())
        self.assertEqual(stat.S_IMODE(helper.stat().st_mode), 0o755)
        helper_text = helper.read_text(encoding="utf-8")
        self.assertIn("up -d", helper_text)
        self.assertIn("down --remove-orphans", helper_text)
        self.assertNotIn("COMPOSE_PROFILES", helper_text)
        self.assertNotIn("--profile", helper_text)

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

    def test_compose_manage_script_applies_saved_profiles(self) -> None:
        fixture = Fixture(self)
        generated = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
            "--qbit",
            "--jackett",
        )
        self.assertEqual(generated.returncode, 0, generated.stderr)
        fixture.cleanup_calls()
        environment = {
            **os.environ,
            "PATH": f"{fixture.bin}:{os.environ['PATH']}",
            "INSTALL_TEST_TRACE": str(fixture.trace),
        }
        result = subprocess.run(
            [str(fixture.target / "manage.sh"), "up"],
            cwd=str(fixture.target),
            env=environment,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [
            call
            for call in fixture.calls()
            if call["name"] == "docker" and call["args"][:1] == ["compose"]
        ]
        self.assertEqual(len(calls), 1)
        arguments = calls[0]["args"]
        self.assertIn("--profile", arguments)
        self.assertIn("qbittorrent", arguments)
        self.assertIn("jackett", arguments)
        self.assertEqual(
            arguments[arguments.index("--project-name") + 1], "anishelf"
        )
        self.assertEqual(arguments[-2:], ["up", "-d"])

    def test_compose_manage_script_omits_profiles_when_none(self) -> None:
        fixture = Fixture(self)
        generated = self.generate(
            fixture,
            "--engine",
            "docker",
            "--deploy-dir",
            str(fixture.target),
        )
        self.assertEqual(generated.returncode, 0, generated.stderr)
        fixture.cleanup_calls()
        environment = {
            **os.environ,
            "PATH": f"{fixture.bin}:{os.environ['PATH']}",
            "INSTALL_TEST_TRACE": str(fixture.trace),
        }
        result = subprocess.run(
            [str(fixture.target / "manage.sh"), "down"],
            cwd=str(fixture.target),
            env=environment,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [
            call
            for call in fixture.calls()
            if call["name"] == "docker" and call["args"][:1] == ["compose"]
        ]
        self.assertEqual(len(calls), 1)
        self.assertNotIn("--profile", calls[0]["args"])
        self.assertEqual(calls[0]["args"][-2:], ["down", "--remove-orphans"])

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
        self.assertIn(
            "ANISHELF_INITIAL_RESOURCE_ROOTS: /data/media:/data/extra/1", compose
        )
        self.assertIn(f'      - "{extra}:/data/extra/1:rw,z"', compose)
        self.assertIn(":/data/media:rw,z", compose)
        self.assertIn(":/data/media:z", compose)
        self.assertNotIn('chown "$${PUID}:$${PGID}" /data/media', compose)
        env = (fixture.target / ".env").read_text(encoding="utf-8")
        self.assertIn(f"ANISHELF_MEDIA_PATH='{media}'", env)
        self.assertIn("COMPOSE_PROFILES='qbittorrent,jackett'", env)

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
        self.assertIn("Volume=anishelf-test-app.volume:/data/app", backend)
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
        self.assertIn("ANISHELF_PORT='3001'", env)
        self.assertIn("COMPOSE_PROJECT_NAME='anishelf-test'", env)
        self.assertEqual(
            (compose_fixture.target / ".deployment-profile").read_text(encoding="utf-8"),
            "testing\n",
        )

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
        env = (fixture.target / ".env").read_text(encoding="utf-8")
        self.assertIn("COMPOSE_PROFILES='qbittorrent,jackett'", env)
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
            env={"ANISHELF_TAG": "wrong-inherited-tag"},
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
        self.assertIn(
            "Deployment is healthy",
            (fixture.target / "install.log").read_text(encoding="utf-8"),
        )

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
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(help_result.returncode, 0, help_result.stderr)
        for command in ("install", "reconfigure", "remove"):
            self.assertIn(command, help_result.stdout)
        install_help = subprocess.run(
            [sys.executable, str(ARTIFACT), "install", "--help"],
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
