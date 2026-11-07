"""Assemble 36 calibrated views for the real-time turntable from its existing WebP captures."""

import argparse
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "assets",
    type=Path,
    help="Directory containing poster.webp and angle-01.webp through angle-71.webp",
)
args = parser.parse_args()

for size in (360, 600):
    atlas = Image.new("RGBA", (6 * size, 6 * size))
    for view in range(36):
        name = f"angle-{view * 2:02}.webp" if view else "poster.webp"
        with Image.open(args.assets / name) as capture:
            tile = capture.convert("RGBA").resize(
                (size, size), Image.Resampling.LANCZOS
            )
        atlas.paste(tile, ((view % 6) * size, (view // 6) * size))
    atlas.save(
        args.assets / f"studio-{size}.webp", method=5, quality=86, alpha_quality=90
    )
