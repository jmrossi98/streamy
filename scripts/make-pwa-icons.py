#!/usr/bin/env python3
"""Render the home-screen icons from src/app/icon.svg.

The favicon is 32x32 pixel art (one <rect> per run of pixels). A home-screen
icon needs a real PNG at 180 (iOS), 192 and 512 (manifest), so this paints the
rects onto a 32x32 bitmap and scales it by a whole number -- nearest neighbour,
so every pixel stays a crisp square -- onto an opaque #141414 canvas (iOS
renders a transparent icon background as black; this matches the site instead).

    python scripts/make-pwa-icons.py

Re-run after changing icon.svg and commit the PNGs it writes.
"""
from __future__ import annotations

import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "src" / "app" / "icon.svg"
BACKGROUND = (0x14, 0x14, 0x14, 0xFF)
RECT = re.compile(
    r'<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#([0-9a-fA-F]{6})"'
)

# (output path, canvas size, pixel scale). The scale is an integer so the art
# never blurs; what the scale does not fill is padding around the TV.
OUTPUTS = [
    (ROOT / "src" / "app" / "apple-icon.png", 180, 5),
    (ROOT / "public" / "icons" / "icon-192.png", 192, 5),
    (ROOT / "public" / "icons" / "icon-512.png", 512, 14),
    # Maskable: Android may crop to a circle, so keep the art inside the
    # central 80% (a 320 px square sits well within a 409 px safe circle).
    (ROOT / "public" / "icons" / "icon-512-maskable.png", 512, 10),
]


def paint_source() -> Image.Image:
    svg = SVG.read_text(encoding="utf-8")
    size = int(re.search(r'viewBox="0 0 (\d+) (\d+)"', svg).group(1))
    art = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = art.load()
    for x, y, w, h, fill in RECT.findall(svg):
        rgb = tuple(int(fill[i : i + 2], 16) for i in (0, 2, 4))
        for dx in range(int(w)):
            for dy in range(int(h)):
                px[int(x) + dx, int(y) + dy] = (*rgb, 255)
    return art


def main() -> None:
    art = paint_source()
    for path, canvas, scale in OUTPUTS:
        big = art.resize((art.width * scale, art.height * scale), Image.NEAREST)
        out = Image.new("RGBA", (canvas, canvas), BACKGROUND)
        offset = (canvas - big.width) // 2
        out.alpha_composite(big, (offset, offset))
        path.parent.mkdir(parents=True, exist_ok=True)
        out.convert("RGB").save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {canvas}x{canvas}  art {big.width}px")


if __name__ == "__main__":
    main()
