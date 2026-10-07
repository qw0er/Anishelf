# Synthetic font fixtures

These original test fonts contain simple geometric glyphs for A, space and two CJK
characters. They contain no third-party outlines and are covered by the repository
license. Both TrueType and OpenType/CFF variants use the family Anishelf Fixture.

Regenerate with `python3 generate.py` after installing FontTools in a development
Python environment. FontTools is not an application or test-run dependency. Fixed
font timestamps keep the checked-in files reproducible. These glyphs exercise font
loading and family selection; they are not representative of CJK coverage.
