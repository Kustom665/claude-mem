# 名残 — Ghosting Garden **V1**

*Nagori* (名残) is the Japanese word for what lingers after a thing is gone —
the wake behind a boat, the trace of a departed guest. That is the whole game.

Drag anywhere and a rake with 3, 5, or 8 tines carves real furrows into the
sand. The furrows part around the stones, hold their shape, and then ghost
away. You can set how long they linger, or turn the fading off and keep every
line you ever drew.

One self-contained HTML page. No network calls, no tracking, no build step
beyond Python 3.

## Playing

| | |
| --- | --- |
| **Rake** | Drag across the sand. Faster drags cut wider. |
| **Stones** | Tap the sand to set a stone, drag to move it, double-tap to take it out. |
| **Tines** | 3 for a narrow rake, 8 for a broad one. |
| **Ghost** | *Quick* (25s), *Slow* (110s), or *Never* — the sand keeps everything. |
| **Smooth** | Clears the marks, keeps the stones. |
| **Reset** | Back to the opening five-stone arrangement. |
| **Sound** | Rake hiss and stone thud, synthesised live. Off until you ask. |
| **Save image** | Exports the garden as a PNG. |

## How the ghosting works

The obvious implementation — one mark layer, decayed each frame with
`destination-out` — does not work. The per-frame alpha step for a 25-second
fade is about 0.0017, which rounds to nothing in 8-bit alpha, so the marks
stick at full opacity forever and then vanish all at once whenever you force a
clear. That bug is easy to miss because it looks fine for the first second.

Instead the marks live on a ring of three layers, rotated once every
`lifetime / 3`. New strokes go into the current layer; the older two are
composited at a falling `globalAlpha`, which is a float applied at draw time
and so has no quantisation floor. By the time a layer's slot comes round again
it has reached zero and is cleared for reuse. A mark therefore lives between
two-thirds and a full lifetime, and reaches true zero rather than leaving
residue.

Strokes are clipped to the canvas minus the stone silhouettes (`clip("evenodd")`
over a rect-plus-stones path), so furrows genuinely stop at the rock instead of
being painted over by it. Each tine is drawn twice: a wide dark groove, then a
thin lit lip offset up and to the left, which is what makes the sand read as
carved rather than drawn on.

The render loop only runs while marks are on screen and stops itself when the
sand is clear, so an idle garden costs nothing.

## Layout

```
src/garden.template.html   the source — edit this
src/fonts/                 woff2 faces, inlined at build time
build.py                   inlines the fonts, writes both outputs
index.html                 generated · standalone page (doctype + head)
fragment.html              generated · body-only, for publishing as an Artifact
```

```bash
python3 build.py
```

`index.html` opens straight from disk or any static host. `fragment.html` is
the same page without the document wrapper, for publishing as a claude.ai
Artifact — that renderer supplies its own.

## Fonts

Embedded as base64 data URIs so the page has no external requests and cannot
silently fall back to a system face.

| Face | Role | Licence |
| --- | --- | --- |
| [Shippori Mincho](https://github.com/fontdasu/ShipporiMincho) | display, kanji | SIL OFL 1.1 |
| [Zen Kaku Gothic New](https://github.com/googlefonts/zen-kakugothic) | UI | SIL OFL 1.1 |

Licence texts are in `src/fonts/`. The Japanese face is subset to the 27 kanji
the page uses — 7 KB instead of 1.4 MB — so 名残 always renders as type.

## Verified

Driven in Chromium at 1440×900 and 390×844, in light, dark, and
`prefers-reduced-motion`: raking measurably carves the canvas, marks fade to
zero residue on *Quick*, *Never* holds them flat, stones place/drag/remove
correctly, the canvas exports a valid PNG, the viewport never scrolls, and the
console fits on screen at every width.
