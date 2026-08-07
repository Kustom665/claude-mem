# 枯山水 — The Dry Garden

A digital *karesansui* (dry landscape garden). One self-contained HTML page, no
network calls, no build-time dependencies beyond Python 3.

Three things to do there:

- **Rake the gravel.** A canvas field of raked furrows that part around seven
  placed stones. Drag a pointer across it and your marks stay in the sand, then
  soften over about 90 seconds. `prefers-reduced-motion` keeps them still instead.
- **Draw a mantra.** Two lines composed from 16 openers and 16 closers (256
  pairings). The day's mantra is seeded from the date, so it is the same for
  everyone on the same day; pressing the stone draws a fresh one. An optional
  *rin* bell is synthesised with WebAudio — inharmonic partials, no audio files —
  and is off until you turn it on.
- **Read a sign.** Twelve zodiac stones, each with an element, a garden
  correspondence, a reading, and one practice.

The moon phase in the hero is computed from the synodic month (29.530588853 days)
against a known new moon, and is accurate to within a few hours.

## About the counter

The page counts **your** sittings, not global traffic. There is no backend and no
network access, so the numbers come from `localStorage`: how many times you have
visited, how long you have spent here in total, and when you first arrived. If
storage is blocked the page says so rather than showing a number it cannot stand
behind. Nothing is transmitted anywhere.

A real cross-visitor count would need a server (a counter endpoint, or a hosted
KV store) — that is a deliberate omission here, not an oversight.

## Layout

```
src/garden.template.html   the source — edit this
src/fonts/                 woff2 faces, inlined at build time
build.py                   inlines the fonts, writes both outputs
index.html                 generated · standalone page (doctype + head)
fragment.html              generated · body-only, for publishing as an Artifact
```

`index.html` and `fragment.html` are build outputs. Edit the template, then:

```bash
python3 build.py
```

Both outputs are byte-identical apart from the document wrapper. `index.html`
opens straight from disk or from any static host; `fragment.html` is what gets
published as a claude.ai Artifact, whose renderer supplies its own wrapper.

## Fonts

Both faces are embedded as base64 `@font-face` data URIs, because the Artifact
CSP blocks external font hosts and a silent fallback would lose the page's
identity.

| Face | Role | Licence |
| --- | --- | --- |
| [Shippori Mincho](https://github.com/fontdasu/ShipporiMincho) | display | SIL OFL 1.1 |
| [Zen Kaku Gothic New](https://github.com/googlefonts/zen-kakugothic) | body | SIL OFL 1.1 |

Licence texts are in `src/fonts/`. Only the Latin subsets are embedded whole; the
Japanese face is subset to the 21 kanji the page actually uses (5 KB rather than
1.4 MB), so 枯山水 renders as type everywhere instead of falling back to tofu.
Regenerate that subset with:

```bash
pyftsubset ShipporiMincho-Regular.ttf \
  --text="枯山水禅石苔月砂星鈴庭無常真言空静座火土風" \
  --flavor=woff2 --output-file=src/fonts/shippori-mincho-jp-subset.woff2 \
  --layout-features='' --no-hinting --desubroutinize
```

Zodiac glyphs (U+2648–U+2653) default to colour-emoji presentation, so the page
appends U+FE0E and uses a symbol-font stack to keep them monochrome.
