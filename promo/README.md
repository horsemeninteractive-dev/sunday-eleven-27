# The game's two marks, as files to hand to somebody

Nothing in this directory is part of a build. It is the game's own mark written
out at size — the full lockup, and the mark the icons carry — transparent for a
page that brings its own ground, and on the game's own grounds for a page that
does not, the launcher's among them, so that a listing, a thumbnail or a post can
use the real mark instead of a screenshot of the menu.

```bash
npm run promo     # writes every file below, and checks it against the game
```

Everything here is written by that command and checked as it is written: the
marks are set from the numbers the menu keeps (see **Where the numbers come
from**), and the command fails rather than write a mark that has drifted from the
game. If the mark itself has changed, run `npm run mark` first, then
`npm run promo`.

## The files

| file | what it is for | size | ink |
| --- | --- | --- | --- |
| `se27-brand-mark.svg` `se27-brand-mark.png` | The full mark on nothing at all — SUNDAY over ELEVEN with the season beside them, cropped to its own ink — for a page that brings its own ground. Prefer the SVG. | 3840 × 918 | words `#f4faf6`, season `#4caf7d` |
| `se27-icon-mark.svg` `se27-icon-mark.png` | The mark the icons carry, likewise on nothing: SE with the season, and none of the tile it is usually set on. | 2048 × 623 | words `#f4faf6`, season `#4caf7d` |
| `se27-brand-mark-on-dark.svg` `se27-brand-mark-on-dark.png` | The full mark on the near-black the game is played on, which is how the menu shows it. | 4300 × 1378 | words `#f4faf6`, season `#4caf7d` on `#08090b` |
| `se27-brand-mark-on-light.svg` `se27-brand-mark-on-light.png` | The full mark on the light theme's off-white, in that theme's own inks. | 4300 × 1378 | words `#12171d`, season `#1b6d44` on `#e2e5e9` |
| `se27-icon-mark-on-dark.svg` `se27-icon-mark-on-dark.png` | The icon mark on the near-black. | 2360 × 935 | words `#f4faf6`, season `#4caf7d` on `#08090b` |
| `se27-icon-mark-on-light.svg` `se27-icon-mark-on-light.png` | The icon mark on the off-white. | 2360 × 935 | words `#12171d`, season `#1b6d44` on `#e2e5e9` |
| `se27-icon-mark-on-green.svg` `se27-icon-mark-on-green.png` | The icon mark on the launcher's own ground — the club green, mown in bands, with the tile's markings, stripe, glow and shade behind it — for a listing or a post that should look like the icon. | 2360 × 935 | words `#f4faf6`, season `#4caf7d` on the launcher's mown green |
| `USAGE.txt` | The rule, in one line — the sentence to quote in a style note or a message. | — | — |
| `README.md` | This file. | — | — |

A plated file carries the same ink at the same size as the transparent file it is
named after; what it adds is the ground and the air around it, so the two can be
laid over one another and line up exactly.

## Which ground

The mark is drawn for the dark: its words are `#f4faf6`, which on the light
theme's own off-white ground reads at barely more than 1:1 — that is, not at all.
The light plates are therefore the same setting repainted in the two inks the
light theme picks for its own pages, its text and its green, and both pairs are
measured against the sheet's own 4.5:1 floor every time the command runs.

**The game itself only ever sets the mark on the dark ground.** The light theme
restates its surfaces, its ink and its green; it does not restate the words'
near-white, and the scene the mark stands on is the same scene in both themes.
The light plates exist for the pages that are not the game.

**The green plate is the launcher's ground, not a third colour.** It is the tile
the icons wear — the club green, mown in bands, with the pitch markings, the
game's stripe, the glow behind the mark and the shade over it — squared off,
because a plate is a rectangle and the rounded square is the icon's own business:
`store/` and the launchers carry that one. The ground is the favicon's own
markup, drawn at the size that makes the tile's wordmark box as wide as this
plate's mark, so that every layer behind the mark keeps the proportion the icon
gives it — and so that the shade, which in the tile is a band across the
wordmark, lands under *this* mark rather than near it.

One number differs from its neighbours, deliberately. The season on the green is
measured against the floor the tile itself is built to, **3.5:1** — the floor for
bold display ink, not the sheet's 4.5:1 for small text — and the command prints
what it measured: about 3.8:1 at its worst, against 4.34:1 on the bare mown band.
The stripe the mark crosses is lighter than the band, which is why the tile
carries a shade over it at all, and the plate inherits the same answer.

## Clear space

Give the mark room: empty ground on every side of at least a quarter of the mark's
own height — 230px around the full mark, 156px around the icon mark — and nothing
else in it, a page edge included. The plated files carry exactly that, so one can
be dropped onto a page as it is; the transparent ones leave the decision, and the
space, to whoever lays the page out.

`USAGE.txt` is the whole of it in one sentence, for quoting:

> Set it on one of the grounds in this folder — the game’s near-black, its off-white, or the launcher’s mown green — give it a quarter of its own height of empty ground on every side, and never stretch, trace or redraw it.

And the other half of the same advice: nothing here is ever cropped, rotated or
given a drop shadow. The marks are drawn to their own edges and are meant to be
placed as they are.

## Where the numbers come from

Nothing here is drawn by hand, and nothing is transcribed either:

* **The setting**, from [`src/ui/styles.css`](../src/ui/styles.css) — the measure
  the words are spread across (`--brand-stack`), the size the season is set at and
  the tracking between its two digits (`.brand__year`), the gap it stands off by
  (`--s3`), and every colour: the words' own, `--accent` for the season, `--bg`
  for the dark ground, and the light theme's `--bg`, `--text` and `--accent` for
  the light plates.
* **The name**, from [`src/ui/components/BrandMark.tsx`](../src/ui/components/BrandMark.tsx) —
  the words and the season, so that renaming the game renames these files.
* **The faces**, through [`tools/typeOutline.ts`](../tools/typeOutline.ts): where
  each glyph's ink actually is, which is what lands the letters on the measure and
  makes the season stand exactly as tall as the two words.
* **The icon mark**, from [`public/favicon.svg`](../public/favicon.svg): that
  file's wordmark group and nothing else from it, so that what these PNGs carry
  and what the tab, the launcher and the installer carry cannot be two marks.
  `npm run mark` writes that file.

The store listing icons are a different job with a different set of sizes, and
they are in [`store/`](../store/): `npm run icons` writes them.
