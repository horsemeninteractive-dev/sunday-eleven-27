/**
 * The game's two marks, as files to hand to somebody.
 *
 *   npm run promo
 *
 * A store listing asks for an icon at a size it names; a press kit and a
 * promotion sheet ask for the mark *as a file* — on nothing, with the background
 * left out, at whatever size the page it lands on needs. So this writes the
 * game's two marks transparent and large, and both on **nothing at all**:
 *
 *   - `se27-brand-mark.png`, the full lockup the start screen wears — SUNDAY and
 *     ELEVEN stacked at one measure, the season beside them in the game's green;
 *   - `se27-icon-mark.png`, the mark the icons carry — SE and the season — with
 *     the tile it is usually set on left out, because a promotion sheet supplies
 *     its own ground and a green square cannot be placed on a photograph.
 *
 * Both are cropped to their own ink: the file's edges *are* the mark's edges, so
 * whoever lays a page out can put it on a grid and see exactly where it stops,
 * and the space around it stays their decision rather than this tool's.
 *
 * Each mark is also written **on the game's two grounds** — `-on-dark` and
 * `-on-light`, the same ink at the same size with the ground and the air added —
 * so that whoever would rather not choose a backdrop does not have to. And the
 * folder's two documents come out of the same run: `USAGE.txt`, the rule in one
 * line, and `README.md`, which says what every file here is for. The README is
 * written by hand and **read back and checked** rather than transcribed, so it
 * cannot come to describe a folder that is no longer there.
 *
 * **Neither mark is drawn here.** The lockup is *set*, from the numbers the menu
 * keeps — and it reads them out of the places the menu keeps them in rather than
 * carrying its own copy, which is the whole of why a promo file cannot end up
 * looking like an older game:
 *
 *   - `src/ui/styles.css`, for the measure the letters are spread across
 *     (`--brand-stack`), the size the year is set at and the tracking it carries
 *     (`.brand__year`), the gap the season stands off by (`--s3`, measured
 *     against the widest the words are ever set), and both colours: the words'
 *     own, and `--accent` for the season, which is checked against `SCENE_INK`
 *     below because those two are the same green and are asserted to be;
 *   - `src/ui/components/BrandMark.tsx`, for the words themselves and the
 *     season, so that renaming the game renames the file this writes;
 *   - the font files, through `tools/typeOutline.ts`, for where each glyph's ink
 *     actually is — which is what lands the letters on the measure rather than
 *     near it, and what makes the year's digits bracket the two words exactly,
 *     top and bottom, the way the stylesheet says they do.
 *
 * The icon mark is the one `public/favicon.svg` itself holds — the wordmark group
 * out of that file and nothing else from it, taken the way `tools/icons.ts` and
 * `tools/installerArt.ts` take it, so that what these PNGs carry and what the
 * tab, the launcher and the installer carry cannot be two different marks.
 * `npm run mark` writes that file; run it first if the mark itself has changed.
 *
 * Both marks are written as SVG as well as PNG, because a promotion sheet may be
 * printed and a raster is only as sharp as the day it was written. The PNGs are
 * the deliverable; the SVGs are the same drawing, and the source of the PNGs.
 *
 * The light plates are the one place this tool paints rather than reads. The
 * sheet declares `--accent` twice, the second time inside the light theme, and
 * the mark's near-white belongs to the dark ground the game is played on: the
 * light theme restates its surfaces, its ink and its green, and leaves the words'
 * near-white alone — and the scene the mark stands on is the same scene in both
 * themes. So white on an off-white page would be no mark at all, and the light
 * plates are that setting repainted in the two inks the light theme chooses for
 * its own pages. Both pairs are measured against the sheet's own contrast floor
 * below, and the mark's own near-white is measured *failing* it on the light
 * ground, which is the whole of the argument for repainting.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { contrastRatio, SCENE_INK, STRIPE_CONTRAST_FLOOR, TEXT_CONTRAST_FLOOR } from '@/ui/colour';
import { ARTWORK_WEIGHTS, loadFace, loadFontFile, type ArtworkWeight, type Face, type Glyph } from './typeOutline';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = `${root}promo/`;
const STYLES = readFileSync(`${root}src/ui/styles.css`, 'utf8');
const BRAND = readFileSync(`${root}src/ui/components/BrandMark.tsx`, 'utf8');
const FAVICON = readFileSync(`${root}public/favicon.svg`, 'utf8');

/* ------------------------------------------------------------------ *
 * The menu's own numbers, read out of the menu
 * ------------------------------------------------------------------ */

/** How many pixels a `rem` is, which is the browser's own default and the sheet's. */
const ROOT_PX = 16;

/**
 * The first value a custom property is given.
 *
 * The first and not the last, deliberately: the sheet declares `--accent` twice,
 * the second time inside the light theme, and the mark this writes is the one the
 * menu shows — which is the one the default theme sets.
 */
function token(name: string): string {
  const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(STYLES);
  if (!found) throw new Error(`promo: src/ui/styles.css declares no --${name}`);
  return found[1]!.trim();
}

/** One declaration out of one rule of the sheet. */
function declaration(selector: string, property: string): string {
  const at = STYLES.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`promo: src/ui/styles.css has no rule ${selector}`);
  const block = STYLES.slice(at, STYLES.indexOf('}', at));
  const found = new RegExp(`(?:^|[\\s{])${property}:\\s*([^;]+);`).exec(block);
  if (!found) {
    throw new Error(`promo: ${selector} in src/ui/styles.css does not set ${property}`);
  }
  return found[1]!.trim();
}

/**
 * A token as the light theme sets it.
 *
 * The sheet states `--bg`, `--text` and `--accent` a second time, inside
 * `:root[data-theme='light']`, and the light plates are painted out of that
 * block: taking the default theme's values for them would put the dark ground and
 * the near-white ink on the light page, which is the one thing a light plate
 * exists to avoid.
 */
function lightToken(name: string): string {
  const selector = ":root[data-theme='light'] {";
  const at = STYLES.indexOf(selector);
  if (at < 0) {
    throw new Error(
      `promo: src/ui/styles.css states no ${selector.slice(0, -2)} block, so there is no light theme to read.`,
    );
  }
  const block = STYLES.slice(at, STYLES.indexOf('}', at));
  const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  if (!found) throw new Error(`promo: the light theme in src/ui/styles.css states no --${name}`);
  return found[1]!.trim();
}

/** A length in the sheet, as a number of pixels: `12px` is twelve, `3.5rem` fifty-six. */
function pixels(value: string): number {
  const found = /(-?[\d.]+)(px|rem|em)?/.exec(value);
  if (!found) throw new Error(`promo: ${JSON.stringify(value)} is not a length`);
  return Number(found[1]) * (found[2] === 'rem' ? ROOT_PX : 1);
}

/** A length in the sheet that is a share of a font size: `0.07em` is 0.07. */
function ems(value: string): number {
  const found = /(-?[\d.]+)em/.exec(value);
  if (!found) throw new Error(`promo: ${JSON.stringify(value)} is not a share of an em`);
  return Number(found[1]);
}

/**
 * The word size, at the widest the menu ever draws it.
 *
 * `--brand-word` is a clamp — it grows with the window — and everything in the
 * lockup is a multiple of it except one thing: the gap the season stands off by,
 * which the sheet gives in pixels. So the ratio between those two depends on the
 * window, and one end of the clamp has to be chosen. It is the wide end, because
 * a promo file is the mark at its largest, and the ratio that comes out of it is
 * the roomiest the menu ever gives the year.
 */
function wordSize(): number {
  const lengths = token('brand-word').match(/-?[\d.]+(?:px|rem|em)?/g) ?? [];
  if (lengths.length === 0) {
    throw new Error(`promo: --brand-word is ${token('brand-word')}, which is no length`);
  }
  return pixels(lengths[lengths.length - 1]!);
}

/** How much of the word size a calculator in the sheet multiplies it by. */
function multiple(selector: string, property: string): number {
  const value = declaration(selector, property);
  const found = /\*\s*(-?[\d.]+)/.exec(value);
  if (!found) throw new Error(`promo: ${selector} sets ${property} to ${value}, which is no multiple`);
  return Number(found[1]);
}

/**
 * The words, and the season, out of the component the menu renders.
 *
 * Read rather than retyped, so that what these files say the game is called and
 * what the game is called cannot disagree — and a parse that stops understanding
 * the component fails here rather than producing a mark for a game with no name.
 */
function fromComponent(): { words: string[]; season: string } {
  const listed = /const WORDS = \[([^\]]*)\]/.exec(BRAND)?.[1] ?? '';
  const words = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
  const season = /className="brand__year"[^>]*>\s*([^<\s]+)\s*</.exec(BRAND)?.[1] ?? '';
  if (words.length === 0 || season === '') {
    throw new Error(
      'promo: src/ui/components/BrandMark.tsx no longer holds a WORDS list and a .brand__year, ' +
        'so this cannot read the game’s name out of it.',
    );
  }
  return { words, season };
}

const WORD_SIZE = wordSize();
/** The measure the letters of a word are spread across, in word sizes. */
const MEASURE = Number(token('brand-stack'));
/** The gap the season stands off the words by, in word sizes. */
const GAP = pixels(token('s3')) / WORD_SIZE;
/** How tall the year is set, in word sizes — as tall as both lines of words. */
const YEAR_SIZE = multiple('.brand__year', 'font-size');
/** The air the face's two digits are given, as a share of the year's own em. */
const YEAR_TRACKING = ems(declaration('.brand__year', 'letter-spacing'));
const WORDS_INK = declaration('.brand__word', 'color');
const SEASON_INK = token('accent');
const { words: WORDS, season: SEASON } = fromComponent();

/** The ground the game sets the mark on, and the ground a light page is. */
const DARK_GROUND = token('bg');
const LIGHT_GROUND = lightToken('bg');
/** The two inks the light theme picks for its own pages: its text, and its green. */
const LIGHT_WORDS = lightToken('text');
const LIGHT_SEASON = lightToken('accent');

/**
 * How much ground a plated file carries on every side, as a share of the mark's
 * own height.
 *
 * A quarter, and the same quarter for both marks, so that the rule the kit states
 * — a quarter of the mark's own height of air, and no less — is the air the files
 * actually carry rather than a number in a document that nothing enforces.
 */
const PLATE_PAD = 0.25;

/**
 * The rule, in one line.
 *
 * The one file in the folder that is a sentence rather than a picture, and the one
 * the README quotes word for word: this is the string it has to quote.
 */
const USAGE =
  'Set it on one of the grounds in this folder — the game’s near-black, its off-white, or the launcher’s ' +
  'mown green — give it a quarter of its own height of empty ground on every side, and never stretch, ' +
  'trace or redraw it.';

/** The weight the sheet sets the words at, which is one of the artwork's four cuts. */
function wordWeight(): ArtworkWeight {
  const weight = Number(declaration('.brand__word', 'font-weight'));
  if (!(ARTWORK_WEIGHTS as readonly number[]).includes(weight)) {
    throw new Error(
      `promo: the sheet sets the words at weight ${weight}, and the artwork is cut in ` +
        `${ARTWORK_WEIGHTS.join(', ')} — run \`npm run art:fonts\` for a new cut.`,
    );
  }
  return weight as ArtworkWeight;
}
const WORD_WEIGHT = wordWeight();

if (SEASON_INK.toLowerCase() !== SCENE_INK.toLowerCase()) {
  throw new Error(
    `promo: the sheet's --accent is ${SEASON_INK} and the mark's green is ${SCENE_INK}, and a ` +
      'season in one green on the menu and another in the files is the drift this reads the sheet to avoid.',
  );
}

/* ------------------------------------------------------------------ *
 * Setting the lockup
 * ------------------------------------------------------------------ */

/** One glyph, at the pen it is drawn at, in word sizes from the line's start. */
interface Placed {
  glyph: Glyph;
  pen: number;
  /** The size it is set at, in word sizes. */
  size: number;
}

/** One line of the mark: the glyphs, the face they came from, and the ink they wear. */
interface Line {
  face: Face;
  glyphs: Placed[];
  /** The line's baseline, in word sizes down from the first line's. */
  baseline: number;
  fill: string;
}

/** A box in the mark's own units: word sizes, y down from the first baseline. */
interface Ink {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A drawing, in its own units, with the box its ink lands in. */
interface Drawing {
  body: string;
  ink: Ink;
}

/**
 * One word, spread across the measure the way the sheet spreads it.
 *
 * `justify-content: space-between` is what the menu does to a word, and this is
 * that: the spaces between the letters are all equal, and the last letter ends
 * exactly on the measure. It is measured in the letters' *advances*, which is
 * what a flex row lays out, and not in their ink — the two differ by the side
 * bearings, and the ink is what the canvas is fitted to at the end.
 */
function spread(face: Face, word: string, measure: number): Placed[] {
  const glyphs = [...word].map((character) => face.glyph(character));
  const widths = glyphs.map((glyph) => glyph.advance / face.unitsPerEm);
  const free = measure - widths.reduce((total, width) => total + width, 0);
  const gap = free / Math.max(1, glyphs.length - 1);
  const placed: Placed[] = [];
  let pen = 0;
  for (const [index, glyph] of glyphs.entries()) {
    placed.push({ glyph, pen, size: 1 });
    pen += widths[index]! + gap;
  }
  return placed;
}

/**
 * The season: the digits at their own size, on the words' last baseline, spaced
 * by the face's own advance plus the tracking the sheet asks for. The baseline
 * they stand on is the line's own, so it is not a parameter here.
 */
function seasonLine(face: Face, season: string, pen: number): Placed[] {
  const size = YEAR_SIZE;
  const placed: Placed[] = [];
  let x = pen;
  for (const character of [...season]) {
    const glyph = face.glyph(character);
    placed.push({ glyph, pen: x, size });
    x += (glyph.advance / face.unitsPerEm) * size + YEAR_TRACKING * size;
  }
  return placed;
}

/**
 * The lines of the mark, and the box their ink lands in.
 *
 * The arrangement is the stylesheet's, read off its own numbers: the words one
 * whole word size apart, which is what `line-height: 1` on a word set at exactly
 * that size means, and the season standing on the *last* line's baseline one gap
 * along from the measure.
 */
function lockup(inks: { words: string; season: string }): { lines: Line[]; ink: Ink } {
  const letters = loadFace(WORD_WEIGHT);
  const numerals = loadFontFile(`${root}public/fonts/Fake Identity.ttf`, 'Fake Identity');
  const baseline = WORDS.length - 1;
  const lines: Line[] = WORDS.map((word, index) => ({
    face: letters,
    glyphs: spread(letters, word, MEASURE),
    baseline: index,
    fill: inks.words,
  }));
  lines.push({
    face: numerals,
    glyphs: seasonLine(numerals, SEASON, MEASURE + GAP),
    baseline,
    fill: inks.season,
  });

  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    for (const { glyph, pen, size } of line.glyphs) {
      if (!glyph.box) continue;
      const em = size / line.face.unitsPerEm;
      left = Math.min(left, pen + glyph.box.left * em);
      right = Math.max(right, pen + glyph.box.right * em);
      top = Math.min(top, line.baseline - glyph.box.top * em);
      bottom = Math.max(bottom, line.baseline - glyph.box.bottom * em);
    }
  }
  return { lines, ink: { left, top, right, bottom } };
}

/** One glyph, as a path drawn at its pen and its baseline. */
function glyphPath(line: Line, placed: Placed): string {
  const round = (value: number) => Number(value.toFixed(4));
  const scale = placed.size / line.face.unitsPerEm;
  return (
    `<path d="${placed.glyph.d}" fill="${line.fill}" ` +
    `transform="translate(${round(placed.pen)} ${round(line.baseline)}) scale(${scale} ${-scale})"/>`
  );
}

/**
 * A drawing, fitted to its own ink and scaled to the width asked for.
 *
 * The canvas is the ink box exactly — no air, no frame — so the file's edges are
 * the mark's edges and whoever places it can align it to whatever they like. The
 * scale is applied to the drawing rather than to each path, so the numbers inside
 * the picture stay the numbers the mark was set in.
 */
function fitted(drawing: Drawing, width: number, label: string): { svg: string; height: number } {
  const box = size(drawing.ink);
  const scale = width / box.width;
  const height = Math.round(box.height * scale);
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${(box.width * scale).toFixed(2)} ${(box.height * scale).toFixed(2)}" ` +
      `width="${width}" height="${height}" role="img" aria-label="${label}">\n` +
      `<g transform="scale(${scale}) translate(${(-drawing.ink.left).toFixed(4)} ${(-drawing.ink.top).toFixed(4)})">${drawing.body}</g>\n` +
      `</svg>\n`,
    height,
  };
}

/** An ink box, as the two numbers a canvas is laid out with. */
function size(ink: Ink): { width: number; height: number } {
  return { width: ink.right - ink.left, height: ink.bottom - ink.top };
}

/**
 * The same drawing on a ground, at the scale the transparent file uses.
 *
 * The ink is the same size as it is in the file with no ground, and the canvas is
 * that ink plus the padding on every side — so the two can be laid over one
 * another, and a plated file can be measured to find out what the air in it is
 * (`README.md` states it, and this is what the check reads back).
 */
function plated(drawing: Drawing, width: number, pad: number, ground: string, label: string): { svg: string; height: number } {
  const box = size(drawing.ink);
  const scale = width / box.width;
  const canvasWidth = width + 2 * pad;
  const canvasHeight = Math.round(box.height * scale) + 2 * pad;
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" ` +
      `width="${canvasWidth}" height="${canvasHeight}" role="img" aria-label="${label}">\n` +
      `<rect width="${canvasWidth}" height="${canvasHeight}" fill="${ground}"/>\n` +
      `<g transform="translate(${pad} ${pad}) scale(${scale}) translate(${(-drawing.ink.left).toFixed(4)} ${(-drawing.ink.top).toFixed(4)})">${drawing.body}</g>\n` +
      `</svg>\n`,
    height: canvasHeight,
  };
}

/**
 * The icon mark on the launcher's own ground.
 *
 * The one plate here whose ground is not a colour from the sheet: it is the tile
 * the icons wear — the club green, mown in bands, with the pitch markings, the
 * game's stripe, the glow behind the mark and the shade that keeps the season
 * legible — squared off from the icon and drawn at the plate's own scale.
 *
 * The scale is the whole of the trick. The tile's ground is drawn at the size that
 * makes the tile's own wordmark box as wide as this plate's mark, and it is then
 * centred on it, so every layer behind the mark keeps the proportion the icon gives
 * it: the tile stays seven mown bands wide, the stripe stays the width it is behind
 * the letters, and the shade — a band across the wordmark in the tile — lands under
 * *this* mark rather than near it, which is what makes the season's contrast the
 * same question here as it is in the icon. What is dropped is the corner radius: a
 * plate is a rectangle, and the rounded square is the icon's own business, which
 * `store/` and the launchers carry.
 */
function launcherPlate(mark: Drawing, width: number, pad: number, label: string): { svg: string; bare: string; height: number } {
  const tile = faviconWordmark().ink;
  const box = size(mark.ink);
  const scale = width / size(tile).width;
  const canvasWidth = width + 2 * pad;
  const canvasHeight = Math.round(box.height * (width / box.width)) + 2 * pad;
  const ground =
    `<g transform="translate(${(canvasWidth / 2 - ((tile.left + tile.right) / 2) * scale).toFixed(3)} ` +
    `${(canvasHeight / 2 - ((tile.top + tile.bottom) / 2) * scale).toFixed(3)}) scale(${scale})">${launcherGround()}</g>\n`;
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" ` +
    `width="${canvasWidth}" height="${canvasHeight}" role="img" aria-label="${label}">\n`;
  const markBody =
    `<g transform="translate(${pad} ${pad}) scale(${width / box.width}) ` +
    `translate(${(-mark.ink.left).toFixed(4)} ${(-mark.ink.top).toFixed(4)})">${mark.body}</g>\n`;
  return {
    svg: `${head}${ground}${markBody}</svg>\n`,
    /* The same plate with nothing on it, which is what the mark is measured against. */
    bare: `${head}${ground}</svg>\n`,
    height: canvasHeight,
  };
}

/** The full lockup, drawn in the inks given. */
function brandDrawing(inks: { words: string; season: string }): Drawing {
  const { lines, ink } = lockup(inks);
  const body = lines.map((line) => line.glyphs.map((placed) => glyphPath(line, placed)).join('')).join('');
  return { body, ink };
}

/**
 * The icon mark: the wordmark the favicon draws, and none of its ground.
 *
 * Taken out of the written favicon as the one group that is the mark rather than
 * the field it stands on — the tile, the mown grass, the stripe and the wash all
 * stay in the favicon, which is where a square with a background belongs. What
 * arrives here is the letters and the season, in the favicon's own colours, and
 * the `data-ink` the mark states about itself is what this is fitted to.
 */
function iconDrawing(inks: { words: string; season: string }): Drawing {
  const { body, ink, drawn } = faviconWordmark();
  return { body: recolour(body, [[drawn.words, inks.words], [drawn.season, inks.season]]), ink };
}

/** A drawing's markup with its inks swapped for others. */
function recolour(body: string, swaps: Array<[string, string]>): string {
  return swaps.reduce(
    (carried, [from, to]) => (from.toLowerCase() === to.toLowerCase() ? carried : carried.replaceAll(from, to)),
    body,
  );
}

/**
 * The favicon's wordmark group: the drawing, the box its ink lands in, and the two
 * inks it is drawn in.
 *
 * The inks are matched against the sheet's own — the words' near-white and the
 * season's green — for two reasons: a favicon drawn in a slightly different white
 * from the words in the menu is exactly the drift this tool reads the sheet to
 * catch, and the light plates have to know which fill is which in order to repaint
 * them.
 */
function faviconWordmark(): { body: string; ink: Ink; drawn: { words: string; season: string } } {
  const found = /<g data-wordmark="1"([^>]*)>([\s\S]*?)<\/g>/.exec(FAVICON);
  const stated = /data-ink="([^"]+)"/.exec(found?.[1] ?? '')?.[1];
  const body = found?.[2];
  if (stated === undefined || body === undefined) {
    throw new Error(
      'promo: public/favicon.svg states no wordmark and no ink box — run `npm run mark`.',
    );
  }
  const [left, top, width, height] = stated.split(/\s+/).map(Number);
  if ([left, top, width, height].some((value) => !Number.isFinite(value))) {
    throw new Error(`promo: the favicon states its ink as ${JSON.stringify(stated)}, which is no box`);
  }
  const fills = [...new Set([...body.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((match) => match[1]!))];
  const words = fills.find((fill) => fill.toLowerCase() === WORDS_INK.toLowerCase());
  const season = fills.find((fill) => fill.toLowerCase() === SEASON_INK.toLowerCase());
  if (words === undefined || season === undefined) {
    throw new Error(
      `promo: public/favicon.svg draws its wordmark in ${fills.join(' and ') || 'no named ink'}, and the ` +
        `mark is ${WORDS_INK} words with a ${SEASON_INK} season — run \`npm run mark\`.`,
    );
  }
  return {
    body,
    ink: { left: left!, top: top!, right: left! + width!, bottom: top! + height! },
    drawn: { words, season },
  };
}

/**
 * The launcher's own ground: everything in the favicon that is behind the mark.
 *
 * Taken out of the written favicon as one run of markup — the gradients, the tile,
 * the mown bands, the markings, the stripe, the glow and the shade — because the
 * plate this feeds exists to look like the icon, and a ground rebuilt here out of
 * `tools/mark.ts`'s constants a second time would be a second copy of the tile that
 * can drift from the first. Where it is drawn and how big is `launcherPlate`'s
 * business; what it is is the favicon's own statement of it.
 */
function launcherGround(): string {
  const from = FAVICON.indexOf('<defs>');
  const to = FAVICON.indexOf('<g data-wordmark="1"');
  if (from < 0 || to <= from) {
    throw new Error(
      'promo: public/favicon.svg does not hold its ground ahead of its wordmark, which is where this ' +
        'reads it from — run `npm run mark`.',
    );
  }
  return FAVICON.slice(from, to);
}

/**
 * The two greens the launcher's ground is painted in.
 *
 * Read off the file that paints them rather than carried here, for the same
 * reason every other colour in this tool is read: the tile's field and its mown
 * band are the icon's own two answers to "what colour is this game", and a plate
 * standing on yesterday's answer is exactly what a press kit must not do.
 */
function launcherInks(): { field: string; mown: string } {
  const field = /<rect data-field="1"[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(FAVICON)?.[1];
  const mown = /<g clip-path="url\(#se27-field\)">\s*<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(FAVICON)?.[1];
  if (field === undefined || mown === undefined) {
    throw new Error(
      'promo: public/favicon.svg states no field and no mown band, so there is no launcher’s ground to ' +
        'read — run `npm run mark`.',
    );
  }
  return { field, mown };
}

/* ------------------------------------------------------------------ *
 * Writing them, and checking what was written
 * ------------------------------------------------------------------ */

/**
 * A document, rasterised large and then brought down to size.
 *
 * Twice the target and a good filter, because these are the files somebody puts
 * on a poster: whatever a rasteriser does at speed, it does better when it has
 * more pixels to do it with and then has to give them up.
 */
async function write(svg: string, width: number, height: number, name: string): Promise<void> {
  writeFileSync(`${OUT}${name}.svg`, svg);
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}${name}.png`);
}

/** What a written PNG turned out to be. */
interface Readings {
  width: number;
  height: number;
  transparent: number;
  nearWhite: number;
  green: number;
  /** The share of the canvas whose every channel is dark: ink on a light ground. */
  dark: number;
  /** How far the ink stops short of each edge of the canvas, in pixels. */
  margins: { left: number; top: number; right: number; bottom: number };
  /** The pixel in the corner, as `#rrggbb` — on a plated file, the ground itself. */
  corner: string;
  /** The middle of the ink, as a share of the canvas. */
  centreX: number;
  centreY: number;
  /** Whether each edge of the canvas has any ink in its outermost band. */
  flush: { left: boolean; right: boolean; top: boolean; bottom: boolean };
  /**
   * Whether the band across the middle of the canvas is nothing at all.
   *
   * This is where a mark's ground shows itself: in the lockup the band runs
   * between the two lines of words, and in the icon mark's setting between the
   * letters and the season, and neither has any ink in it — while the tile those
   * letters are usually drawn on is a solid green square across all of it.
   */
  air: boolean;
}

/**
 * A written PNG, read back.
 *
 * Every art tool here checks what it drew rather than trusting it to have drawn —
 * a mark whose letters are missing, or whose ground never rendered, is a file that
 * gets uploaded somewhere before anybody opens it.
 *
 * Passed a ground, the reading skips the pixels that *are* that ground, which is
 * how a plated file is measured: what is left is the ink, so its distance from
 * each edge of the canvas is the air the file carries, and can be compared with
 * the padding it was laid out with. Without a ground — the transparent marks —
 * every opaque pixel is ink and the file's own edges are the mark's.
 */
async function read(name: string, ground?: string): Promise<Readings> {
  const { data, info } = await sharp(`${OUT}${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number): number[] => {
    const i = (y * info.width + x) * info.channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
  };
  const backdrop = ground === undefined ? null : channels(ground);
  const onGround = (r: number, g: number, b: number): boolean =>
    backdrop !== null && Math.max(Math.abs(r - backdrop[0]), Math.abs(g - backdrop[1]), Math.abs(b - backdrop[2])) <= 6;
  const opaque = (x: number, y: number): boolean => pixel(x, y)[3]! > 16;
  const band = 2;
  const edge = (side: 'left' | 'right' | 'top' | 'bottom'): boolean => {
    for (let i = 0; i < info[side === 'top' || side === 'bottom' ? 'width' : 'height']; i += 1) {
      const [x, y] =
        side === 'left' ? [i % band, i] :
        side === 'right' ? [info.width - 1 - (i % band), i] :
        side === 'top' ? [i, i % band] :
        [i, info.height - 1 - (i % band)];
      if (opaque(x!, y!)) return true;
    }
    return false;
  };
  let transparent = 0;
  let nearWhite = 0;
  let green = 0;
  let dark = 0;
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      if (a < 16) {
        transparent += 1;
        continue;
      }
      if (onGround(r!, g!, b!)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      if (Math.max(r!, g!, b!) < 80) dark += 1;
      if (r > 200 && g > 200 && b > 200) nearWhite += 1;
      if (g > r + 8 && g > b + 8) green += 1;
    }
  }
  const pixels = info.width * info.height;
  return {
    width: info.width,
    height: info.height,
    transparent: (transparent / pixels) * 100,
    nearWhite: (nearWhite / pixels) * 100,
    green: (green / pixels) * 100,
    dark: (dark / pixels) * 100,
    margins: {
      left,
      top,
      right: info.width - 1 - right,
      bottom: info.height - 1 - bottom,
    },
    corner: hexOf(pixel(0, 0)),
    centreX: ((left + right) / 2 / info.width) * 100,
    centreY: ((top + bottom) / 2 / info.height) * 100,
    flush: { left: edge('left'), right: edge('right'), top: edge('top'), bottom: edge('bottom') },
    air: [0.56, 0.575, 0.59].every((shareX) =>
      [0.45, 0.5, 0.55].every((shareY) => !opaque(Math.round(info.width * shareX), Math.round(info.height * shareY))),
    ),
  };
}

/** A colour in the sheet, as the three numbers a pixel is compared with. */
function channels(hex: string): [number, number, number] {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!found) throw new Error(`promo: ${JSON.stringify(hex)} is not a six-digit colour`);
  return [parseInt(found[1]!, 16), parseInt(found[2]!, 16), parseInt(found[3]!, 16)];
}

/** A pixel, as `#rrggbb`. */
function hexOf(pixel: number[]): string {
  return `#${pixel.slice(0, 3).map((value) => value!.toString(16).padStart(2, '0')).join('')}`;
}

/** A drawing as raw pixels, without writing a file: for the readings that need two. */
async function raw(svg: string, width: number, height: number): Promise<{ data: Buffer; channels: number }> {
  const { data, info } = await sharp(Buffer.from(svg), { density: 144 })
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, channels: info.channels };
}

/** What a mark on the launcher's own ground turned out to be. */
interface Laid {
  /** How much of the canvas is not painted at all — on a plate, nothing. */
  transparent: number;
  /** How far the mark's ink stops short of each edge of the canvas, in pixels. */
  margins: { left: number; top: number; right: number; bottom: number };
  /** The mark's ink, as shares of the canvas, counted by the ink it is drawn in. */
  words: number;
  season: number;
  /** The ground's own green: its range over the plate, and how much of it is green at all. */
  ground: { min: number; max: number; green: number };
  /** The worst contrast the season keeps against the very ground its ink covers. */
  faintest: number;
}

/**
 * A plated mark read against the same plate with nothing on it.
 *
 * On a ground of one colour the ink is whatever is not that colour, which is how
 * every other plate here is read. The launcher's ground has no such colour: the
 * field, the mown bands, the stripe and the shade are the same greens the ink is
 * made of, so this reading is the *difference* between two renderings — the ground
 * alone, and the ground with the mark on it.
 *
 * It is also the only reading that can say what a mark actually stands on, which
 * is the whole question the season's legibility is: its green on the bare stripe is
 * nowhere near the floor, and the tile's shade exists to put something darker
 * under it. That is measured here from the file rather than argued from the
 * arithmetic that drew it.
 */
async function readLauncherPlate(bare: string, drawn: string, width: number, height: number): Promise<Laid> {
  const [under, over] = await Promise.all([raw(bare, width, height), raw(drawn, width, height)]);
  const pixel = (source: { data: Buffer; channels: number }, x: number, y: number): number[] => {
    const i = (y * width + x) * source.channels;
    return [source.data[i]!, source.data[i + 1]!, source.data[i + 2]!, source.data[i + 3]!];
  };
  const letters = channels(WORDS_INK);
  const season = channels(SEASON_INK);
  const away = (one: number[], other: number[]): number =>
    Math.max(Math.abs(one[0]! - other[0]!), Math.abs(one[1]! - other[1]!), Math.abs(one[2]! - other[2]!));
  let transparent = 0;
  let words = 0;
  let seasonPixels = 0;
  let green = 0;
  let darkest = 255;
  let brightest = 0;
  let faintest = Number.POSITIVE_INFINITY;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const over_ = pixel(over, x, y);
      const under_ = pixel(under, x, y);
      if (over_[3]! < 16) transparent += 1;
      if (under_[1]! > under_[0]! && under_[1]! > under_[2]!) green += 1;
      darkest = Math.min(darkest, under_[1]!);
      brightest = Math.max(brightest, under_[1]!);
      /* The ink, found by what changed rather than by what colour it is. */
      if (away(over_, under_) <= 12) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      if (away(over_, letters) < away(over_, season)) {
        words += 1;
      } else {
        seasonPixels += 1;
        faintest = Math.min(faintest, contrastRatio(SEASON_INK, hexOf(under_)));
      }
    }
  }
  const pixels = width * height;
  return {
    transparent: (transparent / pixels) * 100,
    margins: { left, top, right: width - 1 - right, bottom: height - 1 - bottom },
    words: (words / pixels) * 100,
    season: (seasonPixels / pixels) * 100,
    ground: { min: darkest, max: brightest, green: (green / pixels) * 100 },
    faintest,
  };
}

/**
 * The folder's README, held to what was just written.
 *
 * The README is written by hand — it is a document, with a table in it and prose
 * around it — and the sizes in its table are the one thing in this folder that
 * could silently stop being true, because everything else here is generated from
 * the game and this is not. So it is read back and checked instead of trusted: the
 * files, their sizes, the air the plates carry, the sheet's own colours and the
 * usage line are all in it, and main() insists on each of them.
 */
function readme(): string {
  try {
    return readFileSync(`${OUT}README.md`, 'utf8');
  } catch {
    throw new Error(
      'promo: promo/README.md is missing. The folder documents itself — every file in it is named in ' +
        'that README, with the size it was written at — and this tool will not leave a file in it ' +
        'undocumented. Restore it from the repository and run this again.',
    );
  }
}

/** A check that fails loudly, in the same voice as the other art tools. */
function insist(what: string, holds: boolean, detail: string): void {
  if (!holds) throw new Error(`promo: ${what} — ${detail}`);
  console.log(`  ${what.padEnd(44)} ${detail}`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  console.log(
    `  the menu's own numbers: measure ${MEASURE}, year ${YEAR_SIZE}, gap ${GAP.toFixed(3)},\n` +
      `  words ${WORDS_INK} at ${WORD_WEIGHT}, season ${SEASON_INK}\n` +
      `  the two grounds: ${DARK_GROUND}, the game's own, and ${LIGHT_GROUND}, the light theme's\n`,
  );

  const brandWidth = 3840;
  const brandDrawn = brandDrawing({ words: WORDS_INK, season: SEASON_INK });
  const mark = fitted(brandDrawn, brandWidth, `${WORDS.join(' ')} ${SEASON}`);
  const iconWidth = 2048;
  const iconDrawn = iconDrawing({ words: WORDS_INK, season: SEASON_INK });
  const iconMarked = fitted(iconDrawn, iconWidth, 'SE27');
  await write(mark.svg, brandWidth, mark.height, 'se27-brand-mark');
  await write(iconMarked.svg, iconWidth, iconMarked.height, 'se27-icon-mark');

  /** Every file this run wrote, so the README's table can be held to the sizes in it. */
  const written = [
    { name: 'se27-brand-mark', width: brandWidth, height: mark.height },
    { name: 'se27-icon-mark', width: iconWidth, height: iconMarked.height },
  ];

  const brandPng = await read('se27-brand-mark');
  const iconPng = await read('se27-icon-mark');
  for (const [name, readings] of [
    ['se27-brand-mark', brandPng],
    ['se27-icon-mark', iconPng],
  ] as const) {
    console.log(
      `  promo/${name}.png  ${readings.width}x${readings.height}  ` +
        `${(statSync(`${OUT}${name}.png`).size / 1024).toFixed(0)} KB  ` +
        `${readings.transparent.toFixed(1)}% transparent, ${readings.nearWhite.toFixed(1)}% words, ` +
        `${readings.green.toFixed(1)}% green`,
    );
  }

  console.log('');
  insist(
    'the brand mark is mostly nothing',
    brandPng.transparent > 40,
    `${brandPng.transparent.toFixed(1)}% transparent, so it sits on a photograph as well as on a colour`,
  );
  insist(
    'both of its inks drew',
    brandPng.nearWhite > 0.4 && brandPng.green > 0.15,
    `${brandPng.nearWhite.toFixed(1)}% words, ${brandPng.green.toFixed(1)}% season`,
  );
  insist(
    'the icon mark is the wordmark and no ground',
    iconPng.air && iconPng.nearWhite > 0.5 && iconPng.green > 0.15,
    `${iconPng.transparent.toFixed(1)}% transparent, ${iconPng.nearWhite.toFixed(1)}% letters, ` +
      `${iconPng.green.toFixed(1)}% season, and the air through its middle is air — the tile, the pitch ` +
      'and the stripe stayed in the favicon',
  );
  insist(
    'the brand mark carries no ground either',
    brandPng.air,
    'the band between its two lines of words is nothing at all',
  );
  /*
   * The crop is checked against the box the favicon states about itself rather
   * than against a number written down here: this is the file the tab, the
   * launcher and the installer all carry, and a shape remembered here is a shape
   * that goes stale the next time the mark is re-set. One line of letters is
   * taller for its width than two, which is what makes it the icon's own setting
   * rather than the lockup in a different crop.
   */
  const faviconInk = size(faviconWordmark().ink);
  insist(
    'the icon mark is the icon’s own shape',
    Math.abs(iconPng.height / iconPng.width - faviconInk.height / faviconInk.width) < 0.002 &&
      iconPng.height / iconPng.width > brandPng.height / brandPng.width,
    `its ink is ${(iconPng.height / iconPng.width).toFixed(3)} as tall as it is wide, which is the favicon’s own ` +
      `box (${(faviconInk.height / faviconInk.width).toFixed(3)}) and taller for its width than the lockup’s ` +
      `${(brandPng.height / brandPng.width).toFixed(3)}`,
  );
  for (const [name, readings] of [
    ['the brand mark', brandPng],
    ['the icon mark', iconPng],
  ] as const) {
    const edges = Object.entries(readings.flush);
    insist(
      `${name} is cropped to its own ink`,
      edges.every(([, has]) => has),
      `${edges.map(([side, has]) => `${side} ${has ? 'in' : 'SHORT'}`).join(', ')}`,
    );
  }

  /* ------------------------------------------------------------------ *
   * The same two marks, on the two grounds
   * ------------------------------------------------------------------ */

  /*
   * One description of each mark, so that the plates and the documents are all
   * generated from it rather than from a second copy that can drift out of step
   * with the first.
   */
  const iconSpec = {
    name: 'se27-icon-mark',
    short: 'the icon mark',
    width: iconWidth,
    height: iconMarked.height,
    label: 'SE27',
    draw: iconDrawing,
  };
  const marks = [
    {
      name: 'se27-brand-mark',
      short: 'the full mark',
      width: brandWidth,
      height: mark.height,
      label: `${WORDS.join(' ')} ${SEASON}`,
      draw: brandDrawing,
    },
    iconSpec,
  ];
  const grounds = [
    {
      name: 'dark',
      ground: DARK_GROUND,
      inks: { words: WORDS_INK, season: SEASON_INK },
      /* The mark the menu shows, which is read rather than painted. */
      repainted: false,
    },
    {
      name: 'light',
      ground: LIGHT_GROUND,
      inks: { words: LIGHT_WORDS, season: LIGHT_SEASON },
      /* The only files here this tool paints rather than reads. */
      repainted: true,
    },
  ];

  for (const each of marks) {
    const pad = Math.round(each.height * PLATE_PAD);
    for (const ground of grounds) {
      const name = `${each.name}-on-${ground.name}`;
      const plate = plated(each.draw(ground.inks), each.width, pad, ground.ground, each.label);
      await write(plate.svg, each.width + 2 * pad, plate.height, name);
      written.push({ name, width: each.width + 2 * pad, height: plate.height });

      const readings = await read(name, ground.ground);
      const margins = Object.entries(readings.margins);
      console.log(
        `\n  promo/${name}.png  ${readings.width}x${readings.height}  ` +
          `${(statSync(`${OUT}${name}.png`).size / 1024).toFixed(0)} KB  ` +
          `${ground.ground} with ${pad}px of air`,
      );
      insist(
        'a ground was painted and not left out',
        readings.transparent < 0.05 && readings.corner.toLowerCase() === ground.ground.toLowerCase(),
        `fully painted, its corner ${readings.corner}`,
      );
      insist(
        'the air is equal on all four sides',
        margins.every(([, value]) => Math.abs(value - pad) <= 2),
        margins.map(([side, value]) => `${side} ${value}`).join(', '),
      );
      insist(
        ground.repainted ? 'both of the light theme’s inks repainted it' : 'both of the mark’s inks drew',
        ground.repainted ? readings.dark > 0.3 && readings.green > 0.05 : readings.nearWhite > 0.4 && readings.green > 0.15,
        ground.repainted
          ? `${readings.dark.toFixed(1)}% dark ink, ${readings.green.toFixed(1)}% green of the canvas`
          : `${readings.nearWhite.toFixed(1)}% words, ${readings.green.toFixed(1)}% season of the canvas`,
      );
    }
  }

  /*
   * Why there are two grounds at all, measured rather than asserted: the mark's
   * own near-white is the reason the light plates are repainted, and the light
   * theme's own two inks are what makes them a mark.
   */
  console.log('');
  insist(
    'the mark’s near-white is no ink on a light page',
    contrastRatio(WORDS_INK, LIGHT_GROUND) < 2,
    `${WORDS_INK} on ${LIGHT_GROUND} is ${contrastRatio(WORDS_INK, LIGHT_GROUND).toFixed(2)}:1, which is why the ` +
      'light plates are not the same file on another colour',
  );
  insist(
    'and the light theme’s own inks clear the sheet’s floor',
    [LIGHT_WORDS, LIGHT_SEASON].every((ink) => contrastRatio(ink, LIGHT_GROUND) >= TEXT_CONTRAST_FLOOR),
    `${LIGHT_WORDS} ${contrastRatio(LIGHT_WORDS, LIGHT_GROUND).toFixed(2)}:1 and ${LIGHT_SEASON} ` +
      `${contrastRatio(LIGHT_SEASON, LIGHT_GROUND).toFixed(2)}:1, against the ${TEXT_CONTRAST_FLOOR}:1 the sheet asks`,
  );

  /* ------------------------------------------------------------------ *
   * The icon mark on the launcher's own ground
   * ------------------------------------------------------------------ */

  /*
   * The third ground, and the only one that is not a colour out of the sheet. The
   * tile the icons wear has no token — it is `tools/mark.ts`'s composition, and the
   * file that carries it is the favicon — so it is here because a listing or a post
   * that should look like the icon has only the icon's own ground to match.
   */
  const greenPad = Math.round(iconSpec.height * PLATE_PAD);
  const launcher = launcherPlate(
    iconSpec.draw({ words: WORDS_INK, season: SEASON_INK }),
    iconSpec.width,
    greenPad,
    iconSpec.label,
  );
  const greenWidth = iconSpec.width + 2 * greenPad;
  await write(launcher.svg, greenWidth, launcher.height, 'se27-icon-mark-on-green');
  written.push({ name: 'se27-icon-mark-on-green', width: greenWidth, height: launcher.height });

  const laid = await readLauncherPlate(launcher.bare, launcher.svg, greenWidth, launcher.height);
  const sides = Object.entries(laid.margins);
  console.log(
    `\n  promo/se27-icon-mark-on-green.png  ${greenWidth}x${launcher.height}  ` +
      `${(statSync(`${OUT}se27-icon-mark-on-green.png`).size / 1024).toFixed(0)} KB  ` +
      `the launcher's ground with ${greenPad}px of air`,
  );
  insist(
    'the launcher’s own ground is painted, not left out',
    laid.transparent < 0.05 && laid.ground.green > 90,
    `no transparent pixel at all, and ${laid.ground.green.toFixed(0)}% of it is green`,
  );
  insist(
    'and carries the tile’s own layers',
    laid.ground.min < channels(launcherInks().field)[1]! && laid.ground.max > channels(launcherInks().mown)[1]!,
    `its green runs from ${laid.ground.min} to ${laid.ground.max}: darker than the bare field ` +
      `(${channels(launcherInks().field)[1]}), so the shade is on it, and brighter than the mown band ` +
      `(${channels(launcherInks().mown)[1]}), so the stripe and the glow are`,
  );
  insist(
    'the air is equal on all four sides',
    sides.every(([, value]) => Math.abs(value - greenPad) <= 2),
    sides.map(([side, value]) => `${side} ${value}`).join(', '),
  );
  insist(
    'the season still reads on the mown green',
    laid.words > 0 && laid.season > 0 && laid.faintest >= STRIPE_CONTRAST_FLOOR,
    `the green keeps ${laid.faintest.toFixed(2)}:1 at its worst against the ground its own ink covers — ` +
      `${laid.season.toFixed(1)}% season and ${laid.words.toFixed(1)}% letters — where ${SEASON_INK} on the mown ` +
      `band alone is ${contrastRatio(SEASON_INK, launcherInks().mown).toFixed(2)}:1 and the stripe it crosses is ` +
      `lighter still, which is what the tile’s shade is for. The floor is the ${STRIPE_CONTRAST_FLOOR}:1 the ` +
      'mark’s own tile is built to',
  );

  /* ------------------------------------------------------------------ *
   * The folder's two documents
   * ------------------------------------------------------------------ */

  /*
   * The rule as a file of its own, because a press kit is handed to people who
   * will quote it, and the README is held to quoting it too.
   */
  writeFileSync(`${OUT}USAGE.txt`, `${USAGE}\n`);
  const guide = readme();
  console.log('');
  const listed = readdirSync(OUT).sort();
  const unnamed = listed.filter((file) => !guide.includes(file));
  insist(
    'the README names every file in the folder',
    unnamed.length === 0,
    unnamed.length === 0
      ? `${listed.length} files, and not one of them undocumented`
      : `not in the README: ${unnamed.join(', ')}`,
  );
  const stale = written.filter(({ name, width, height }) => {
    const row = guide.split('\n').find((line) => line.includes(`${name}.svg`));
    return row === undefined || !new RegExp(`${width}\\s*×\\s*${height}`).test(row);
  });
  insist(
    'and states the size each was written at',
    stale.length === 0,
    stale.length === 0
      ? `${written.length} sizes, every one of them the size just written`
      : `stale in the README: ${stale.map(({ name }) => name).join(', ')}`,
  );
  const air = marks.map((each) => Math.round(each.height * PLATE_PAD));
  insist(
    'and quotes the clear space the plates carry',
    air.every((pad) => guide.includes(`${pad}px`)),
    `${air.join('px and ')}px, which is a quarter of each mark’s own height`,
  );
  const inks = [DARK_GROUND, LIGHT_GROUND, WORDS_INK, SEASON_INK, LIGHT_WORDS, LIGHT_SEASON];
  insist(
    'and carries the sheet’s own colours, not a copy of them',
    inks.every((ink) => guide.includes(ink)),
    inks.join(', '),
  );
  insist(
    'and it and USAGE.txt say the same thing',
    guide.includes(USAGE),
    'USAGE.txt is one line, and the README quotes it word for word',
  );

  console.log(
    `\n  promo/: a press kit — ${listed.length} files. Both marks transparent and on the game's grounds, the\n` +
      `  launcher's own among them; the rule in one line; and the README that says what every one of them is for.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
