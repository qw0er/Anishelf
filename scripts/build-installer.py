#!/usr/bin/env python3
"""Build the self-contained Anishelf installer zipapp at scripts/install.pyz.

The archive embeds the Python sources and the canonical ``package/deploy``
templates. Deployment hosts only need the system Python interpreter.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import zipapp
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parent
SOURCE = ROOT / "installer"
TEMPLATES = REPOSITORY / "package" / "deploy"
DEFAULT_TARGET = ROOT / "install.pyz"


def _include(path: Path) -> bool:
    return "__pycache__" not in path.parts and path.suffix != ".pyc"


def build(target: Path) -> Path:
    if not SOURCE.is_dir():
        raise SystemExit(f"Installer source directory is missing: {SOURCE}")
    if not TEMPLATES.is_dir():
        raise SystemExit(f"Deployment template directory is missing: {TEMPLATES}")

    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="anishelf-installer-build-") as temporary:
        staging = Path(temporary) / "app"
        shutil.copytree(
            SOURCE,
            staging,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        shutil.copytree(
            TEMPLATES,
            staging / "templates",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        zipapp.create_archive(
            staging,
            target=target,
            interpreter="/usr/bin/env python3",
            compressed=True,
            filter=_include,
        )
    target.chmod(0o755)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_TARGET,
        help=f"output archive (default: {DEFAULT_TARGET})",
    )
    args = parser.parse_args(argv)
    target = build(args.output)
    print(f"Built {target} ({target.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
