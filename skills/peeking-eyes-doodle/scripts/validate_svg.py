#!/usr/bin/env python3
"""Check the portable native-vector subset used by Peeking Eyes Doodle."""
import argparse
import math
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "http://www.w3.org/2000/svg"
ELEMENTS = {"svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "title", "desc"}
ATTRS = {
    "id", "version", "viewBox", "width", "height", "preserveAspectRatio",
    "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
    "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "fill-rule", "transform", "role", "aria-label", "aria-labelledby",
    "data-peek-eye", "data-peek-white", "data-peek-pupil",
}
SHAPES = {"path", "circle", "ellipse", "rect", "line", "polyline", "polygon"}


def validate(path, interactive=False):
    errors = []
    try:
        raw = Path(path).read_text(encoding="utf-8")
        if re.search(r"<!\s*(DOCTYPE|ENTITY)\b|<\?xml-stylesheet", raw, re.I):
            return ["DTD, entities and external stylesheets are forbidden."]
        root = ET.fromstring(raw)
    except (OSError, UnicodeError, ET.ParseError) as exc:
        return [f"Cannot parse SVG: {exc}"]
    if root.tag != f"{{{NS}}}svg":
        errors.append("Root must be svg in the SVG namespace.")
    try:
        box = [float(v) for v in re.split(r"[\s,]+", root.get("viewBox", "").strip())]
    except ValueError:
        box = []
    if box != [0, 0, 1024, 1024]:
        errors.append('Expected viewBox="0 0 1024 1024".')
    shape_count = 0
    for element in root.iter():
        tag = element.tag.removeprefix(f"{{{NS}}}")
        if tag not in ELEMENTS or (tag == "svg" and element is not root):
            errors.append(f"Unsupported element: {tag}")
        if tag in SHAPES:
            shape_count += 1
        if tag not in {"title", "desc"} and (element.text or "").strip():
            errors.append(f"Unexpected text inside {tag}.")
        if (element.tail or "").strip():
            errors.append(f"Unexpected text after {tag}.")
        for attr, value in element.attrib.items():
            if attr not in ATTRS:
                errors.append(f"Unsupported attribute on {tag}: {attr}")
            if re.search(r"url\s*\(|data:|https?://|file:", value, re.I):
                errors.append(f"Reference or embedded data on {tag}: {attr}")
            if attr in {"fill", "stroke"} and value not in {"#000000", "#FFFFFF", "none"}:
                errors.append(f"Non-palette {attr}: {value}")
            if attr in {"stroke-linecap", "stroke-linejoin"} and value != "round":
                errors.append(f"Expected round {attr} on {tag}.")
    if not shape_count:
        errors.append("No vector shapes found.")
    if interactive:
        eyes = [el for el in root.iter() if "data-peek-eye" in el.attrib]
        if len(eyes) != 2:
            errors.append("Interactive artwork requires exactly two data-peek-eye groups.")
        marked = {"data-peek-white": [], "data-peek-pupil": []}
        for eye in eyes:
            if eye.tag != f"{{{NS}}}g":
                errors.append("data-peek-eye must mark a g element.")
            parts = {}
            for marker in marked:
                nodes = [el for el in eye.iter() if marker in el.attrib]
                marked[marker].extend(nodes)
                if len(nodes) != 1 or nodes[0].tag != f"{{{NS}}}ellipse" or nodes[0] not in list(eye):
                    errors.append(f"Each eye needs one direct ellipse child with {marker}.")
                else:
                    parts[marker] = nodes[0]
            if len(parts) != 2:
                continue
            white, pupil = parts["data-peek-white"], parts["data-peek-pupil"]
            if white is pupil:
                errors.append("Eye white and pupil must be distinct ellipses.")
            if white.get("fill") != "#FFFFFF" or pupil.get("fill") != "#000000":
                errors.append("Marked white/pupil need explicit white/black fills.")
            if any(part.get("transform") for part in (white, pupil)):
                errors.append("Put eye rotation on the eye group, not its ellipses.")
            try:
                values = [[float(part.get(attr, "nan")) for attr in ("cx", "cy", "rx", "ry")] for part in (white, pupil)]
                if not all(math.isfinite(v) for row in values for v in row):
                    raise ValueError
                if not all(row[2] > 0 and row[3] > 0 for row in values):
                    raise ValueError
                if max(values[1][2] / values[0][2], values[1][3] / values[0][3]) >= 0.85:
                    errors.append("Pupils must leave enough room inside the whites to move.")
            except ValueError:
                errors.append("Eye ellipses need finite cx/cy and positive rx/ry.")
        for marker, nodes in marked.items():
            if len(nodes) != 2 or len([el for el in root.iter() if marker in el.attrib]) != 2:
                errors.append(f"Expected exactly two {marker} ellipses inside the eye groups.")
    return list(dict.fromkeys(errors))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("svg", type=Path, nargs="+")
    parser.add_argument("--interactive", action="store_true", help="Check the eye geometry contract for web widgets")
    args = parser.parse_args()
    failed = False
    for path in args.svg:
        errors = validate(path, interactive=args.interactive)
        print(f"{'FAIL' if errors else 'PASS'} {path}")
        for error in errors:
            print(f"  - {error}")
        failed |= bool(errors)
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
