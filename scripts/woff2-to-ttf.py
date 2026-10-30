#!/usr/bin/env python3
"""
Turn the site's own webfonts into TTFs so Pillow can draw with them.

`scripts/build-brand-assets.py` writes the share card in the same typefaces the
site uses. Pillow cannot read woff2 — it needs the same font as TTF — so this
unpacks the four faces the brand needs, rather than shipping a second copy of
each font in the repository.

Usage:
    pip install --break-system-packages fonttools brotli
    python3 scripts/woff2-to-ttf.py            # writes /tmp/fraunces700.ttf etc.

Brotli is not optional: woff2 is Brotli-compressed, and without it fontTools
raises `ModuleNotFoundError: No module named 'brotli'` the moment it decompresses.
"""
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "public" / "fonts"

# Face as shipped → the path the brand builder expects.
WANTED = {
    "fraunces-latin-700": "/tmp/fraunces700.ttf",
    "manrope-latin-600": "/tmp/manrope600.ttf",
    "manrope-latin-400": "/tmp/manrope400.ttf",
    "ibm-plex-mono-latin-500": "/tmp/plexmono500.ttf",
}


def main() -> int:
    missing = 0
    for face, out in WANTED.items():
        source = FONTS / f"{face}-normal.woff2"
        if not source.exists():
            print(f"  missing: {source.relative_to(ROOT)}")
            missing += 1
            continue
        font = TTFont(source)
        font.flavor = None  # drop the woff2 wrapper, keep the glyphs
        font.save(out)
        print(f"  {source.relative_to(ROOT)}  →  {out}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
