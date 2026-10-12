/**
 * The mark: **SE27**, set on the game's own pitch.
 *
 * The long name of the game is a wordmark — SUNDAY and ELEVEN stacked, with the
 * season standing beside them — and this is its shorthand, the one the browser
 * tab, the launcher and the installer's header all wear. Two faces, because the
 * full mark uses two: the letters are Archivo, the same weight and file the menu
 * sets SUNDAY in (`assets/fonts/archivo-800.ttf`), and the season is **Fake
 * Identity**, the display numerals `public/fonts/` gives the game for the `27`.
 * It wears two colours for the same reason, both the start screen's own: the
 * letters are the mark's near-white, and the season is `--accent` — the green of
 * the stripe behind it, which is what makes the `27` the one part of the mark
 * that is a colour rather than an ink, and which is why the shade below is
 * measured against the season rather than against the words.
 *
 * The pair are held to the rule the stylesheet sets: the year is sized so it
 * stands exactly as tall as the caps beside it — the single-line form of the
 * rule the start screen's lockup obeys, where the season stands as tall as both
 * stacked words — and that is a measurement off the two files rather than a
 * number typed in here.
 *
 * Behind them is the ground the menu is drawn on: the scene's own dark green,
 * mown bands and the markings of a pitch seen from above, the game's green laid
 * over it as the stripe the pre-game screens and the command bar both wear, and
 * the menu's own darkening under the words so the type keeps its contrast.
 *
 *   npm run mark
 *
 * **Why a tool writes the favicon rather than a person.** Every character above
 * used to be a `<text>` element naming a font, which means the mark was drawn by
 * whatever face the rasteriser could find: `npm run icons` even carried a check
 * for an icon arriving with no letters on it, because a machine without the
 * named font would quietly produce one. It is now set from the outlines in two
 * files in this repository — the same ones the game loads — so every rasteriser,
 * on every machine, draws the same mark, and a missing face is an error here
 * rather than a blank icon on somebody's home screen.
 *
 * It writes one file, `public/favicon.svg`, which is then the single source for
 * everything else: `npm run icons` rasterises every app icon, splash screen and
 * store listing from it, `npm run desktop:art` draws the installer's bitmaps
 * from it, and `npm run og` places it on the social card. Change the mark here,
 * run those, and the whole set follows.
 */
import { statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  contrastRatio,
  mixColours,
  SCENE_ALPHA,
  SCENE_INK,
  STRIPE_ANGLE,
  STRIPE_BAND_SHARE,
  STRIPE_CONTRAST_FLOOR,
} from '@/ui/colour';
import { loadFace, loadFontFile, type Face } from './typeOutline';

const root = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT = `${root}public/favicon.svg`;

/**
 * The frame, in the units every number below is quoted in.
 *
 * 64 rather than 32 because the mark is drawn at 512 and 1024 as well, and the
 * pitch's own details — a centre circle, a band of grass — want more room than
 * a 32-unit grid gives them before they start landing on fractions.
 */
const CANVAS = 64;
/** The corner, the same share of the square the old mark's was. */
const CORNER = 14;

/* ------------------------------------------------------------------ *
 * The colours, all of them the game's own
 * ------------------------------------------------------------------ */

/** `.scene`'s own background colour: the green a career's screens are laid on. */
const FIELD = '#0d2617';
/** The mark's green — `SCENE_INK`, the stripe, and the boot screen's accent. */
const BRAND = SCENE_INK;
/** The near-black the menu darkens the photograph with under the words. */
const SHADE = '#040e09';
/**
 * The letters' own colour, which is the one the start screen sets them in: the
 * near-white the wordmark is drawn in, read off its own rule.
 */
const INK = '#f4faf6';
/**
 * A mown band: the field lifted towards the mark's green.
 *
 * Mixed rather than picked, so the two greens on the pitch cannot drift from
 * the palette the rest of the game is drawn in.
 */
const MOWN = mixColours(FIELD, BRAND, 0.18);
/**
 * The contrast white ink has to keep on the boldest band.
 *
 * The floor the command bar's own stripes are held to, because the thing
 * standing on these bands is a wordmark: this game draws its stripes behind
 * bold type and nowhere else, so the number is borrowed rather than invented,
 * and it moves if that one ever does.
 */
const INK_FLOOR = STRIPE_CONTRAST_FLOOR;

/* ------------------------------------------------------------------ *
 * The layout, all of it measured off the files rather than typed in
 * ------------------------------------------------------------------ */

/** The pitch's mown bands, across the square. */
const MOWING = 7;
/** How much of the square the wordmark's ink takes, edge to edge. */
const WORD_SHARE = 0.76;
/**
 * How much wider every gap is than the widest air the two faces ask for.
 *
 *
 * A mark is read at arm's length rather than in a line of prose, so it is set a
 * touch airier than the faces would set it — and it is one number for the whole
 * lockup, which is the point: the gaps agree with each other first and with
 * either face second.
 */
const AIR_FACTOR = 1.15;
/**
 * The stripe's turn, which is the menu's.
 *
 * The stylesheet asks for `STRIPE_ANGLE` degrees and CSS counts a gradient's
 * angle clockwise from straight up, while SVG counts a rotation clockwise from
 * straight down, so the two are a quarter turn apart: 112° in CSS is the 22°
 * this rotates by. Read off the shared constant rather than typed in, because
 * a stripe at a different angle to the menu's is what "the same stripe" is not.
 */
const STRIPE_TURN = STRIPE_ANGLE - 90;
/**
 * The menu's own band, as a share of whatever the stripe is drawn across.
 *
 * The stylesheet quotes its bands in `vw` measured along the gradient's axis,
 * and that axis runs the short way between two bands, so what the eye reads as
 * the width of a band is that length times the sine of the angle — the same
 * arithmetic `stripeTiles` does to lay the pattern out.
 */
const BAND_SHARE = STRIPE_BAND_SHARE * Math.sin((STRIPE_ANGLE * Math.PI) / 180);
/**
 * How many times bolder the mark's bands are than the menu's.
 *
 * The menu's band is a share of a *window* — three per cent of 1280px is thirty
 * -nine pixels of stripe — and the same share of an icon is under a pixel at
 * the sixteen a browser tab draws. So the angle, the green and the strength are
 * the menu's and the width is not: this is the one number in the mark that is
 * about the size a mark is read at rather than about the screen it came from.
 */
const BAND_BOLDNESS = 4;
/** A band's width in the mark's own units, and the period it repeats over. */
const STRIPE_BAND = CANVAS * BAND_SHARE * BAND_BOLDNESS;
const STRIPE_PERIOD = STRIPE_BAND * 2;

/**
 * The glow's own peak: how strong the radial wash behind the words ever gets.
 *
 * Named because two things need it: the gradient that draws it, and the
 * worst case the shade below is worked out against.
 */
const GLOW_PEAK = 0.3;
/** How dark the shade is at the very top and bottom of the tile, clear of the words. */
const EDGE_SHADE = 0.18;

interface Extents {
  /** The ink, left and right, in font units from the pen's start. */
  left: number;
  right: number;
  /** The ink, above and below the baseline. */
  top: number;
  bottom: number;
  /** How far the pen travels over the whole run. */
  advance: number;
  /** The air the face leaves inside the run, one number per boundary. */
  airs: number[];
  /** The bearing before the first glyph and after the last, in font units. */
  leading: number;
  trailing: number;
  d: string;
}

/**
 * A run of characters, and where its ink actually is.
 *
 * `typeset` hands back a path and an advance, which is the pen rather than the
 * picture: type has side bearings, so the pen's travel and the ink's width are
 * two different numbers, and everything below is laid out on the ink. The glyphs
 * are walked here for both, because a mark centred on advances is a mark sitting
 * a little to the right of where it looks centred, and a gap measured from an
 * advance is not the gap the eye sees.
 *
 * The air between two characters is measured one boundary at a time — the
 * bearing the first glyph leaves after itself and the one the second arrives
 * with — because that is the air the face draws, and it is a different number at
 * every boundary: Archivo leaves 0.117em between its own S and its own E, and
 * 0.048em after the E. The mark then wears one of them everywhere (see `lockup`).
 */
function run(face: Face, text: string): Extents {
  let pen = 0;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  const glyphs = [...text].map((character) => face.glyph(character));
  for (const glyph of glyphs) {
    if (glyph.box) {
      left = Math.min(left, pen + glyph.box.left);
      right = Math.max(right, pen + glyph.box.right);
      top = Math.max(top, glyph.box.top);
      bottom = Math.min(bottom, glyph.box.bottom);
    }
    pen += glyph.advance;
  }
  const airs = glyphs.slice(0, -1).map((glyph, index) => {
    const next = glyphs[index + 1]!;
    const after = glyph.advance - (glyph.box ? glyph.box.right : glyph.advance);
    return after + (next.box ? next.box.left : 0);
  });
  const first = glyphs[0]!;
  const last = glyphs[glyphs.length - 1]!;
  const { d } = face.typeset(text, 0);
  return {
    left,
    right,
    top,
    bottom,
    advance: pen,
    airs,
    leading: first.box ? first.box.left : 0,
    trailing: last.advance - (last.box ? last.box.right : last.advance),
    d,
  };
}

/** A run as a `<path>`, drawn at the pen, in the sizes and the ink the caller worked out. */
function place(
  face: Face,
  extents: Extents,
  penX: number,
  baselineY: number,
  size: number,
  fill: string,
): string {
  // The scale is carried at full precision, not rounded to the three decimals a
  // coordinate wants: it multiplies every point in the outline, so half a
  // thousandth of it is half a unit of ink at a 1024-unit em — seven pixels of
  // drift in a 512px icon, which is the difference between a mark that is
  // centred and one that is nearly centred.
  const scale = size / face.unitsPerEm;
  const round = (value: number) => Number(value.toFixed(3));
  return (
    `<path d="${extents.d}" fill="${fill}" ` +
    `transform="translate(${round(penX)} ${round(baselineY)}) scale(${scale} ${-scale})"/>`
  );
}

interface Lockup {
  /** The wordmark as one group, ready to paint. */
  group: string;
  /** Where its ink is, in the mark's own units: the box the group states. */
  ink: { left: number; top: number; width: number; height: number };
  /** The gap every boundary wears, the widest air measured, and where the box sits. */
  gaps: { gap: number; widest: number; centre: number };
}

/**
 * The wordmark: SE in the letters' white, 27 in the season's green.
 *
 * Two inks, because the start screen sets two: the words are the near-white the
 * stylesheet draws them in, and the season is `--accent` — the mark's own green,
 * which is the colour of the stripe behind it, so the `27` is the one part of
 * the mark that is a colour rather than an ink.
 *
 * The rule that decides the year's size is the stylesheet's own — the `27` stands
 * exactly as tall as the caps beside it — and the two numbers it needs are read
 * off the files: Archivo's caps measure 711 units of 1000 on the S, and Fake
 * Identity's numerals fill their em exactly, 1024 of 1024. So the season is set
 * at whatever size makes those two bands equal, which is 0.699 of the letters'
 * size for this pair and is computed rather than remembered.
 *
 * **One gap, not three.** Left to the faces, the mark would carry three
 * different airs: Archivo's own 0.117em between the S and the E, its 0.048em
 * after the E, and Fake Identity's 0.050em between its digits — the same
 * characters set twice with nothing to say why. So every boundary gets the
 * widest of those, measured off the two files at the sizes they are finally set
 * at: nothing in the mark is tighter than the face that leads it would set it,
 * and the eye reads four characters rather than two words and a year.
 *
 * **Everything is placed on ink, and the tile is centred on it.** The pens are
 * worked out from where one run's ink stops to where the next one's starts, and
 * the whole box is then centred in the square — both ways — because a mark whose
 * box disagrees with where its glyphs actually sit is a mark that only looks
 * centred at the size it was checked at.
 */
function lockup(): Lockup {
  const letters = loadFace(800);
  const season = loadFontFile(`${root}public/fonts/Fake Identity.ttf`, 'Fake Identity');
  const se = run(letters, 'SE');
  const year = run(season, '27');

  const capBand = se.top - se.bottom;
  const digitBand = year.top - year.bottom;
  // Where each run's ink is, in its own em — which is what the layout is made
  // of, rather than the pens the faces would advance by.
  const seInk = (se.right - se.left) / letters.unitsPerEm;
  const yearInk = (year.right - year.left) / season.unitsPerEm;
  // How tall the season is set, as a multiple of the letters' size.
  const yearPerLetter = capBand / letters.unitsPerEm / (digitBand / season.unitsPerEm);

  // Every air the lockup would otherwise use, all brought into the letters' em:
  // the boundaries inside each run, and the one across them, which is where the
  // letters' face stops and the season's begins.
  const boundaries = [
    ...se.airs.map((air) => air / letters.unitsPerEm),
    se.trailing / letters.unitsPerEm + (year.leading / season.unitsPerEm) * yearPerLetter,
    ...year.airs.map((air) => (air / season.unitsPerEm) * yearPerLetter),
  ];
  const widest = Math.max(...boundaries);
  const gap = widest * AIR_FACTOR;

  // The letters' size, chosen so the whole lockup takes the share of the square
  // it is asked for: everything else is a fixed multiple of it, so this is one
  // equation rather than a search.
  const totalPerLetter = seInk + gap + yearInk * yearPerLetter;
  const size = (CANVAS * WORD_SHARE) / totalPerLetter;
  const yearSize = size * yearPerLetter;

  const band = (capBand / letters.unitsPerEm) * size;
  /*
   * How far the letters reach below the baseline.
   *
   * Archivo draws a round letter a little past the line it stands on — the S runs
   * 12 units under its own baseline, and 12 over the flat cap line, which is what
   * makes it read as standing on the line rather than floating above it. `run`
   * measures that, and the box has to state it: a box that stopped at the baseline
   * would be a box the ink pokes out of, and everything that crops to the box —
   * the maskable safe zone in `tools/icons.ts`, a promotion sheet — would be
   * cutting the bottom off the S. Which it was.
   */
  const overshoot = -(se.bottom / letters.unitsPerEm) * size;
  const centre = CANVAS / 2;
  // The box is centred in the tile by its *caps* rather than by the overshoot:
  // the overshoot is the compensation that makes a round letter look level, so a
  // box centred on the ink would lift the mark by half of it. It is why the mark
  // is set on the cap band and the box is allowed to dip below it.
  const baseline = centre + band / 2;
  const total = totalPerLetter * size;
  const left = centre - total / 2;
  // Each run is placed by its own ink: the letters' left edge at the box's, and
  // the season's left edge one ink-width and one gap further along.
  const sePen = left - (se.left / letters.unitsPerEm) * size;
  const yearPen = left + seInk * size + gap * size - (year.left / season.unitsPerEm) * yearSize;

  /*
   * The ink box is written into the file as an attribute, because the maskable
   * variants are worked out by `tools/icons.ts` from *the file* — a platform may
   * crop the icon to a circle, and how much the wordmark has to shrink to
   * survive that is a question about where its ink actually is. The mark stating
   * its own box is what keeps that from being a number typed into another tool
   * and drifting the first time this one changes.
   */
  const ink = { left, top: baseline - band, width: total, height: band + overshoot };
  const box = [ink.left, ink.top, ink.width, ink.height]
    .map((value) => Number(value.toFixed(3)))
    .join(' ');

  return {
    group:
      `<g data-wordmark="1" data-ink="${box}">` +
      place(letters, se, sePen, baseline, size, INK) +
      place(season, year, yearPen, baseline, yearSize, BRAND) +
      `</g>`,
    ink,
    // The gap is one number and the box is symmetric by construction; both are
    // reported from here rather than re-derived by whoever prints them.
    gaps: { gap: gap * size, widest: widest * size, centre: left + total / 2 },
  };
}

/** The mown bands and the markings: a pitch seen from above. */
function pitch(): string {
  const band = CANVAS / MOWING;
  const bands = Array.from({ length: MOWING }, (_, index) =>
    index % 2 === 0
      ? ''
      : `<rect x="${(index * band).toFixed(3)}" y="0" width="${band.toFixed(3)}" height="${CANVAS}" fill="${MOWN}"/>`,
  ).join('');
  // The markings are drawn faintly on purpose: this is grass under a wordmark,
  // not a tactics board, and a pitch whose lines shouted would be a diagram.
  const line = 0.7;
  return (
    bands +
    `<g stroke="#ffffff" stroke-opacity="0.14" stroke-width="${line}" fill="none">` +
    `<line x1="${CANVAS / 2}" y1="0" x2="${CANVAS / 2}" y2="${CANVAS}"/>` +
    `<circle cx="${CANVAS / 2}" cy="${CANVAS / 2}" r="12"/>` +
    `</g>` +
    `<circle cx="${CANVAS / 2}" cy="${CANVAS / 2}" r="${line * 0.9}" fill="#ffffff" fill-opacity="0.14"/>`
  );
}

/**
 * How strong a band is drawn.
 *
 * The menu's own field wears its stripe at `SCENE_ALPHA`, which is nearly solid
 * — it can, because it lies over a photograph that is dark to begin with and
 * the wash above it does the quietening. The mark's bands lie *behind* the
 * wordmark instead, so the strength is chosen the way a club's colours are:
 * from the menu's own downward, until white ink on the boldest band is back
 * inside the contrast floor. That is the one thing a mark that carries letters
 * cannot get wrong, and it is measured rather than picked so that a brighter
 * green, or a bolder band, moves the number with it.
 */
function stripeAlpha(): number {
  const round = (value: number) => Number(value.toFixed(3));
  // The lightest thing a band can be drawn over: the mown grass, which is the
  // field lifted towards the mark's green.
  for (let alpha = SCENE_ALPHA; alpha >= 0.1; alpha -= 0.02) {
    if (contrastRatio(INK, mixColours(MOWN, BRAND, alpha)) >= INK_FLOOR) return round(alpha);
  }
  return 0.1;
}

/**
 * The game's stripe, which the pre-game screens and the command bar both wear.
 *
 * Vertical bands turned by the menu's angle, drawn past the edges of the square
 * so the turn cannot open a bare corner, climbing to the right exactly as they
 * do behind the menu — and as wide, relative to the surface, as a band can be
 * and still be read at a tab's width rather than a window's.
 */
function stripes(): string {
  const over = CANVAS * 1.5;
  const first = -over;
  const bands: string[] = [];
  for (let x = first; x < CANVAS + over; x += STRIPE_PERIOD) {
    bands.push(
      `<rect x="${x.toFixed(3)}" y="${-over}" width="${STRIPE_BAND.toFixed(3)}" height="${over * 2}" fill="${BRAND}"/>`,
    );
  }
  return (
    `<g fill-opacity="${stripeAlpha()}" ` +
    `transform="rotate(${STRIPE_TURN} ${CANVAS / 2} ${CANVAS / 2})">${bands.join('')}</g>`
  );
}

/**
 * How strong the shade is where the wordmark stands.
 *
 * The brightest thing the words can stand on is not the grass: it is the mark's
 * own green at full strength, because that is what both layers over the grass
 * are made of — the stripe at 0.76 of it, the glow up to 0.3, and neither can
 * take the surface past the ink they are drawn in. So the worst case is exact
 * rather than a guess about how the two overlap, and it cannot go stale.
 *
 * The ink that binds is the season's green, the darker of the mark's two inks
 * and so the one the floor catches first — the letters have 8:1 over the same
 * bands. The strength is found by darkening that surface of solid green until
 * the season clears `INK_FLOOR`: the same arithmetic the stripe's own strength
 * is chosen by, one layer apart — the stripe as strong as the letters allow,
 * the shade as strong as the season needs.
 */
function shadeStrength(): number {
  const round = (value: number) => Number(value.toFixed(3));
  for (let alpha = 0.2; alpha <= 0.95; alpha += 0.02) {
    if (contrastRatio(BRAND, mixColours(BRAND, SHADE, alpha)) >= INK_FLOOR) return round(alpha);
  }
  return 0.95;
}

/**
 * The shade: deepest across the wordmark, and lighter above and below it.
 *
 * Where it is deepest is the lockup's own ink box rather than the middle of the
 * square, so a mark whose words move — or grow, when the season changes face —
 * takes its own darkening with them, and the top and bottom of the tile stay as
 * open as the ground they are drawn from.
 */
function shade(ink: Lockup['ink']): string {
  const strength = shadeStrength();
  const stop = (value: number) => Number((value / CANVAS).toFixed(3));
  return (
    `<linearGradient id="se27-shade" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${SHADE}" stop-opacity="${EDGE_SHADE}"/>` +
    `<stop offset="${stop(ink.top)}" stop-color="${SHADE}" stop-opacity="${strength}"/>` +
    `<stop offset="${stop(ink.top + ink.height)}" stop-color="${SHADE}" stop-opacity="${strength}"/>` +
    `<stop offset="1" stop-color="${SHADE}" stop-opacity="${EDGE_SHADE}"/>` +
    `</linearGradient>`
  );
}

/** Everything inside the corner, in the order it is painted. */
export function markBody(): string {
  const mark = lockup();
  return (
    `<defs>` +
    `<clipPath id="se27-field"><rect width="${CANVAS}" height="${CANVAS}" rx="${CORNER}"/></clipPath>` +
    // The menu's own wash, in two pieces: the mark's green glowing up out of the
    // grass behind the words, and the near-black darkening that keeps the type
    // at full contrast over it — the letters against their own green, and the
    // season against the green it shares with the stripe.
    `<radialGradient id="se27-glow" cx="0.5" cy="0.46" r="0.62">` +
    `<stop offset="0" stop-color="${BRAND}" stop-opacity="${GLOW_PEAK}"/>` +
    `<stop offset="1" stop-color="${BRAND}" stop-opacity="0"/>` +
    `</radialGradient>` +
    shade(mark.ink) +
    `</defs>` +
    // The corner itself: the one rectangle a masking platform squares off, and
    // the clip every layer below is held inside.
    `<rect data-field="1" width="${CANVAS}" height="${CANVAS}" rx="${CORNER}" fill="${FIELD}"/>` +
    `<g clip-path="url(#se27-field)">` +
    pitch() +
    stripes() +
    `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#se27-glow)"/>` +
    `<rect width="${CANVAS}" height="${CANVAS}" fill="url(#se27-shade)"/>` +
    `</g>` +
    mark.group
  );
}

/** The mark as a whole document: what `public/favicon.svg` holds. */
export function markSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" ` +
    `width="${CANVAS}" height="${CANVAS}" role="img" aria-label="SE27">\n` +
    markBody() +
    `\n</svg>\n`
  );
}

function main(): void {
  const svg = markSvg();
  writeFileSync(OUTPUT, svg);
  const kb = () => `${(statSync(OUTPUT).size / 1024).toFixed(1)} KB`;
  console.log(`  public/favicon.svg  ${kb()}`);
  console.log(
    `  ${CANVAS}x${CANVAS}, corner r${CORNER}, ${MOWING} mown bands, ` +
      `stripes at ${STRIPE_ANGLE}° of ${stripeAlpha()} (the menu's own angle and green)`,
  );
  const mark = lockup();
  const gaps = mark.gaps;
  console.log(
    `  the wordmark takes ${(WORD_SHARE * 100).toFixed(0)}% of the square, its season sized off the two files, ` +
      `held up by a shade of ${shadeStrength()}`,
  );
  console.log(
    `  one gap of ${gaps.gap.toFixed(3)} units for all three pairs ` +
      `(the widest the faces ask for is ${gaps.widest.toFixed(3)}), ` +
      `ink centred at ${gaps.centre.toFixed(2)}/${CANVAS}`,
  );
  console.log('\n  Every icon is rasterised from this file: `npm run icons`, `npm run og`, `npm run desktop:art`.');
}

/*
 * `main()` runs on import, as it does in every tool in this folder, and one tool
 * does import this file: `tools/og.ts` borrows `markBody()` to place the mark on
 * the social card. So `npm run og` rewrites `public/favicon.svg` on its way past
 * — the same fonts give the same bytes, so nothing is harmed by it — and prints
 * this report ahead of its own. That cannot be guarded against by looking at
 * `process.argv`: `vite-node` runs the script itself and leaves only the script's
 * own arguments behind, so nothing in it names this file.
 */
main();
