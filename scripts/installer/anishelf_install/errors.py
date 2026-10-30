"""Installer-specific failures with user-facing messages."""

from __future__ import annotations


class InstallerError(Exception):
    """A recoverable configuration, validation or runtime failure."""

