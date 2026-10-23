"""Regenerate original synthetic test fonts with FontTools (no third-party glyphs)."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen

out = Path(__file__).parent
for is_ttf in (True, False):
    builder = FontBuilder(1000, isTTF=is_ttf)
    glyphs = [".notdef", "space", "A", "uni4F60", "uni597D"]
    builder.setupGlyphOrder(glyphs)
    builder.setupCharacterMap({32: "space", 65: "A", 0x4F60: "uni4F60", 0x597D: "uni597D"})
    outlines = {}
    for glyph in glyphs:
        pen = TTGlyphPen(None) if is_ttf else T2CharStringPen(800, None)
        if glyph != "space":
            pen.moveTo((80, 0))
            pen.lineTo((720, 0))
            pen.lineTo((720, 700))
            pen.lineTo((80, 700))
            pen.closePath()
            pen.moveTo((180, 100))
            pen.lineTo((180, 600))
            pen.lineTo((620, 600))
            pen.lineTo((620, 100))
            pen.closePath()
        outlines[glyph] = pen.glyph() if is_ttf else pen.getCharString()
    if is_ttf:
        builder.setupGlyf(outlines)
    else:
        builder.setupCFF("AnishelfFixture", {"FullName": "Anishelf Fixture", "FamilyName": "Anishelf Fixture", "Weight": "Regular"}, outlines, {})
    builder.setupHorizontalMetrics({glyph: (800, 80) for glyph in glyphs})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": "Anishelf Fixture", "styleName": "Regular", "uniqueFontIdentifier": "AnishelfFixture", "fullName": "Anishelf Fixture", "psName": "AnishelfFixture"})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupMaxp()
    builder.font["head"].created = 3800000000
    builder.font["head"].modified = 3800000000
    builder.font.recalcTimestamp = False
    builder.save(out / ("fixture.ttf" if is_ttf else "fixture.otf"))
