"""Build small background-playback copies without touching the original photos."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


SUPPORTED = {".webp", ".avif", ".jpg", ".jpeg", ".png", ".gif"}
MAX_EDGE = 560


def save_preview(source: Path, destination: Path) -> None:
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        if getattr(image, "is_animated", False):
            image.seek(0)
        image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
        suffix = destination.suffix.lower()
        destination.parent.mkdir(parents=True, exist_ok=True)

        if suffix in {".jpg", ".jpeg"}:
            image.convert("RGB").save(destination, quality=78, optimize=True, progressive=True)
        elif suffix == ".png":
            image.save(destination, optimize=True)
        elif suffix == ".gif":
            image.convert("P", palette=Image.Palette.ADAPTIVE).save(destination, optimize=True)
        elif suffix == ".avif":
            image.save(destination, quality=72)
        else:
            image.save(destination, format="WEBP", quality=72, method=6)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    args.destination.mkdir(parents=True, exist_ok=True)

    created = 0
    reused = 0
    for source in sorted(args.source.iterdir(), key=lambda item: item.name.lower()):
        if not source.is_file() or source.suffix.lower() not in SUPPORTED:
            continue
        destination = args.destination / source.name
        if destination.exists() and destination.stat().st_mtime_ns >= source.stat().st_mtime_ns:
            reused += 1
            continue
        save_preview(source, destination)
        created += 1

    print(f"Background previews: created {created} / reused {reused}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
