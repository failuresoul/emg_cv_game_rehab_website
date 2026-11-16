"""Makes the README's image grids and shrinks every screenshot and diagram (Day 20).

    python scripts\\docs\\optimise_images.py

Needs Pillow (a local tool, not a project dependency: Anaconda has it, or
`pip install pillow`). Run by scripts/docs/make_screenshots.ps1 after the Playwright captures.

- docs/images/screens/warmup-grid.png: the six warm-up exercises, 3 x 2;
- docs/images/screens/games-grid.png: the nine games, 3 x 3;
- every PNG in docs/images/screens/ and docs/images/diagrams/ is reduced to a 256-colour
  palette and, while it is still above MAX_BYTES, scaled down by 15% at a time.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - a hint for the person running it
    print("Pillow is missing: run this with Anaconda's python, or pip install pillow")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[2]
SCREENS = ROOT / "docs" / "images" / "screens"
DIAGRAMS = ROOT / "docs" / "images" / "diagrams"
MAX_BYTES = 400 * 1024
# The order of the warm-up (web/e2e/session.ts ALL_EXERCISES).
WARMUP = ["shoulder-flexion", "shoulder-abduction", "elbow-flexion", "forward-reach",
          "hand-open-close", "thumb-opposition"]  # fmt: skip
GAMES = ["reach-activate", "balloon-pop", "fruit-catch", "bloom", "finger-piano", "path-trace",
         "paint-wall", "pick-place", "grip-hold"]  # fmt: skip


def grid(names: list[str], columns: int, out: Path, tile_width: int = 960) -> bool:
    """Tiles the images (kept in proportion) with a white gap; False if any is missing."""
    paths = [SCREENS / f"{name}.png" for name in names]
    missing = [p.name for p in paths if not p.exists()]
    if missing:
        print(f"  {out.name}: missing {', '.join(missing)}; not made")
        return False
    tiles = []
    for path in paths:
        with Image.open(path) as image:
            height = round(image.height * tile_width / image.width)
            tiles.append(image.convert("RGB").resize((tile_width, height), Image.LANCZOS))
    gap = 16
    tile_height = max(tile.height for tile in tiles)
    rows = (len(tiles) + columns - 1) // columns
    canvas = Image.new("RGB", (columns * tile_width + (columns + 1) * gap, rows * tile_height + (rows + 1) * gap), "white")
    for index, tile in enumerate(tiles):
        row, column = divmod(index, columns)
        canvas.paste(tile, (gap + column * (tile_width + gap), gap + row * (tile_height + gap)))
    canvas.save(out)
    return True


def encoded(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    palette = image.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def shrink(path: Path) -> tuple[int, int]:
    before = path.stat().st_size
    with Image.open(path) as opened:
        image = opened.copy()
    data = encoded(image)
    while len(data) > MAX_BYTES and image.width > 640:
        image = image.resize((int(image.width * 0.85), int(image.height * 0.85)), Image.LANCZOS)
        data = encoded(image)
    path.write_bytes(data)
    return before, len(data)


def main() -> int:
    if not SCREENS.exists():
        print(f"No screenshots in {SCREENS}: run scripts\\docs\\make_screenshots.ps1 first")
        return 1
    grid([f"warmup-{name}" for name in WARMUP], 3, SCREENS / "warmup-grid.png")
    grid([f"game-{name}" for name in GAMES], 3, SCREENS / "games-grid.png")
    over = []
    for folder in (SCREENS, DIAGRAMS):
        for path in sorted(folder.glob("*.png")):
            before, after = shrink(path)
            flag = "" if after <= MAX_BYTES else "  (still above the limit)"
            if after > MAX_BYTES:
                over.append(path.name)
            print(f"  {path.relative_to(ROOT)}: {before // 1024} KB -> {after // 1024} KB{flag}")
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main())
