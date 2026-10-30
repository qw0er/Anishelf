"""Small stderr/file logger shared by the installer modules."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional


class InstallerLog:
    """Write installer progress to stderr and, once known, to a bundle log."""

    def __init__(self) -> None:
        self.phase = "collecting configuration"
        self._path: Optional[Path] = None

    @property
    def path(self) -> Optional[Path]:
        return self._path

    def set_file(self, path: Path) -> None:
        self._path = path

    def clear_file(self) -> None:
        self._path = None

    def log(self, message: str) -> None:
        line = f"[anishelf] {message}"
        print(line, file=sys.stderr, flush=True)
        path = self._path
        if path is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as stream:
                stream.write(f"{line}\n")
        except OSError:
            # Logging must never hide the original installer failure.
            pass

    def error(self, message: str) -> None:
        self.log(f"ERROR: {message}")

    def failure(self, message: str) -> None:
        self.error(message)
        self.log(
            f"Failed while {self.phase}. Existing data is preserved; inspect the output above."
        )


LOG = InstallerLog()


def log(message: str) -> None:
    LOG.log(message)


def error(message: str) -> None:
    LOG.error(message)


def die(message: str) -> None:
    """Raise a user-facing installer failure."""
    from .errors import InstallerError

    raise InstallerError(message)
