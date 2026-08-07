#!/usr/bin/env python3
"""Inline the woff2 faces into the Ghosting Garden template.

Emits two files from one source:
  index.html     standalone page (doctype + head), opens from disk or a static host
  fragment.html  body-only, for publishing as a claude.ai Artifact
"""
import base64
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src"
FONTS = SRC / "fonts"

SLOTS = {
    "__SM400__": "shippori-mincho-latin-400.woff2",
    "__SM600__": "shippori-mincho-latin-600.woff2",
    "__SMJP__": "shippori-mincho-jp-subset.woff2",
    "__ZK400__": "zen-kaku-gothic-new-latin-400.woff2",
    "__ZK500__": "zen-kaku-gothic-new-latin-500.woff2",
}

TITLE = "名残 — Ghosting Garden"
DESC = ("A digital zen sand garden: drag to rake real furrows around the stones, "
        "and watch them ghost away.")

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{desc}">
<meta name="color-scheme" content="light dark">
</head>
<body>
"""


def main() -> int:
    html = (SRC / "garden.template.html").read_text(encoding="utf-8")

    for slot, name in SLOTS.items():
        path = FONTS / name
        if not path.exists():
            print(f"missing font: {path}", file=sys.stderr)
            return 1
        b64 = base64.b64encode(path.read_bytes()).decode("ascii")
        if slot not in html:
            print(f"slot {slot} not found in template", file=sys.stderr)
            return 1
        html = html.replace(slot, b64)

    if "__" in html.replace("__proto__", ""):
        leftovers = [t for t in SLOTS if t in html]
        if leftovers:
            print(f"unsubstituted slots: {leftovers}", file=sys.stderr)
            return 1

    (HERE / "fragment.html").write_text(html, encoding="utf-8")
    (HERE / "index.html").write_text(
        HEAD.format(desc=DESC) + html + "\n</body>\n</html>\n", encoding="utf-8"
    )

    kb = len(html.encode("utf-8")) / 1024
    print(f"built  index.html + fragment.html  ({kb:.0f} KB inlined, title: {TITLE})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
