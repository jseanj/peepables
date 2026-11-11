#!/usr/bin/env python3
"""Render a validated SVG to transparent PNG with an available local renderer."""
import argparse
import base64
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from validate_svg import validate


def render(source, target, background="transparent"):
    if importlib.util.find_spec("cairosvg"):
        import cairosvg
        cairosvg.svg2png(url=str(source), write_to=str(target), output_width=1024, output_height=1024, background_color="white" if background == "white" else None)
        return "CairoSVG"
    rsvg = shutil.which("rsvg-convert")
    if rsvg:
        subprocess.run([rsvg, "-w", "1024", "-h", "1024", *(["-b", "#FFFFFF"] if background == "white" else []), "-o", str(target), str(source)], check=True, capture_output=True, timeout=30)
        return "rsvg-convert"
    chrome = next((p for p in [
        shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chromium-browser"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ] if p and Path(p).is_file()), None)
    if not chrome:
        raise RuntimeError("No local renderer found: use an available CairoSVG, rsvg-convert or Chrome installation.")
    with tempfile.TemporaryDirectory(prefix="peeking-eyes-preview-") as folder:
        temporary = Path(folder)
        encoded = base64.b64encode(source.read_bytes()).decode("ascii")
        page = temporary / "preview.html"
        page.write_text('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1024px;height:1024px;background:transparent;overflow:hidden}img{display:block;width:1024px;height:1024px}</style><img src="data:image/svg+xml;base64,' + encoded + '">', encoding="utf-8")
        subprocess.run([
            chrome, "--headless", "--no-first-run", "--no-default-browser-check",
            "--disable-background-networking", "--disable-extensions", "--disable-sync",
            f"--user-data-dir={temporary / 'profile'}", "--hide-scrollbars",
            "--force-device-scale-factor=1", f"--default-background-color={'FFFFFFFF' if background == 'white' else '00000000'}",
            "--window-size=1024,1024", "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=1000", f"--screenshot={target}", page.as_uri(),
        ], check=True, capture_output=True, timeout=30)
    return "Chrome headless (isolated temporary profile)"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg", type=Path)
    parser.add_argument("--output", type=Path, help="Default: same filename with .png extension")
    parser.add_argument("--force", action="store_true", help="Replace an existing PNG")
    parser.add_argument("--background", choices=["transparent", "white"], default="transparent", help="PNG background only; SVG is unchanged")
    args = parser.parse_args()
    source = args.svg.resolve()
    target = (args.output or source.with_suffix(".png")).resolve()
    errors = validate(source)
    if errors:
        parser.error("SVG validation failed: " + "; ".join(errors))
    if target.suffix.lower() != ".png" or target == source:
        parser.error("Output must be a separate .png file.")
    if target.exists() and not args.force:
        parser.error("PNG exists; use --force to replace it.")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix=".peeking-render-", dir=target.parent) as folder:
            pending = Path(folder) / "preview.png"
            backend = render(source, pending, args.background)
            if not pending.is_file() or pending.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError("Renderer did not produce a PNG.")
            os.replace(pending, target)
    except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
        print(f"Render failed: {exc}", file=sys.stderr)
        return 1
    print(f"PNG: {target}\nRenderer: {backend}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
