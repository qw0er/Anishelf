"""Load deployment templates bundled with the installer or source checkout."""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path
from typing import Optional

from .errors import InstallerError
from .log import log

_TEMPLATE_PREFIX = "templates/"


class AssetSource:
    """Read canonical templates from the zipapp or a repository checkout."""

    def __init__(self) -> None:
        self.commit = "bundled"
        self._archive: Optional[zipfile.ZipFile] = None
        self._root: Optional[Path] = None

        executable = Path(sys.argv[0]).resolve() if sys.argv and sys.argv[0] else None
        if (
            executable is not None
            and executable.is_file()
            and zipfile.is_zipfile(executable)
        ):
            self._archive = zipfile.ZipFile(executable)
            log(f"Using deployment templates bundled in {executable.name}.")
            return

        # Source layout: scripts/installer/anishelf_install/assets.py
        repository = Path(__file__).resolve().parents[3]
        root = repository / "package" / "deploy"
        if not root.is_dir():
            raise InstallerError(
                "Deployment templates are unavailable. Rebuild the installer "
                "or run it from a complete source checkout."
            )
        self._root = root
        log("Using deployment templates from package/deploy.")

    def resolve(self) -> str:
        """Return a stable template revision label for the deployment log."""

        return self.commit

    def read(self, relative: str) -> bytes:
        """Return one deployment template without writing it to disk."""

        if self._archive is not None:
            try:
                payload = self._archive.read(f"{_TEMPLATE_PREFIX}{relative}")
            except KeyError as error:
                raise InstallerError(
                    f"Missing bundled deployment template: {relative}"
                ) from error
        else:
            assert self._root is not None
            source = self._root / relative
            if not source.is_file():
                raise InstallerError(f"Missing deployment template: {relative}")
            payload = source.read_bytes()
        if not payload:
            raise InstallerError(f"Empty deployment template: {relative}")
        return payload

    def read_text(self, relative: str) -> str:
        try:
            return self.read(relative).decode("utf-8")
        except UnicodeDecodeError as error:
            raise InstallerError(
                f"Deployment template is not valid UTF-8: {relative}"
            ) from error

    def close(self) -> None:
        if self._archive is not None:
            self._archive.close()
            self._archive = None
