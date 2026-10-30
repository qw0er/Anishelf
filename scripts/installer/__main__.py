"""Entry point for ``python scripts/installer`` and the packaged ``install.pyz``."""

from __future__ import annotations

import sys

from anishelf_install.cli import main

if __name__ == "__main__":
    sys.exit(main())
