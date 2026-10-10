/**
 * The card the game shows when somebody pastes its link.
 *
 * A link pasted into Discord, Slack or iMessage is unfurled by a bot that never
 * runs the game. It reads Open Graph and Twitter Card tags and nothing else, so
 * a game that ships no `og:image` is unfurled as a title and a sentence in a
 * grey box — which is exactly what it looked like, and it is the first thing
 * anybody sees of the game apart from the game itself.
 *
 * The picture is the same photograph the pre-game screen is built on, so the
 * card and the game are visibly the same place: a mown pitch at the end of a
 * wet Sunday afternoon, dimmed enough to carry type over. The two colours along
 * the bottom edge are the match screen's own header bar — the home shirt and the
 * away shirt — which is the one piece of the interface that says "football" from
 * a distance.
 *
 *   npm run og
 *
 * It is a developer tool, like `scene` and `icons`: nothing in the game imports
 * it, and it is typechecked with everything else so it cannot rot. The master
 * photograph stays in `assets/`, out of `public/`, so Vite never copies it; what
 * ships is `public/og.png`, written here.
 */
import { statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadFace, typePath } from './typeOutline';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = `${repoRoot}assets/scene-ground.png`;
const OUTPUT = `${repoRoot}public/og.png`;

/** The size every unfurl actually asks for. */
const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Where the photograph is cropped from, as a fraction of the height that was cut
 * away. The stylesheet's own `background-position: center 42%` — the same frame
 * the manager has been looking at, so the card is not a different photograph of
 * the same pitch but a crop of the view he already knows.
 */
const FOCUS_Y = 0.42;

/**
 * How dark the photograph is made before type goes on it.
 *
 * A photograph is not a background. The game dims the scene behind its own
 * gradient by about this much, and the card does the same, which is what keeps
 * white type at full contrast over grass rather than fighting it.
 */
const SCRIM = 0.62;

/** The match screen's header bar: a home shirt and an away shirt, meeting. */
const HOME_SHIRT = '#558b2f';
const AWAY_SHIRT = '#e0e3e8';

const BRAND = '#4caf7d';
const INK = '#07110c';

/**
 * The type, as one SVG.
 *
 * Drawn rather than laid out in the game because nothing here is interactive and
 * nothing here should ever be: a card that changes when a season rolls over is a
 * card that gets cached with last season's text in it. The type is set from the
 * game's own Archivo — `assets/fonts`, by way of `typeOutline` — so the card is
 * cut from the same letters as the mark and the game, rather than from whatever
 * face the rasteriser happened to find.
 */
function overlay(): string {
  const title = 'Sunday Eleven 27';
  const kicker = 'SUNDAY LEAGUE FOOTBALL MANAGEMENT';
  const line =
    'Pick a side of a muddy pitch, pick a team from the local game, and take them to the whistle.';

  const extraBold = loadFace(800);
  const bold = loadFace(700);
  const medium = loadFace(500);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05080a" stop-opacity="${SCRIM}" />
      <stop offset="0.55" stop-color="#05080a" stop-opacity="${SCRIM + 0.08}" />
      <stop offset="1" stop-color="#05080a" stop-opacity="${SCRIM + 0.2}" />
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)" />

  <!-- The mark, exactly as the favicon draws it. -->
  <g transform="translate(80 74)">
    <rect width="104" height="104" rx="23" fill="${BRAND}" />
    ${typePath(extraBold, 'SE27', { x: 52, y: 65.6, size: 36, fill: INK, anchor: 'middle' })}
  </g>

  ${typePath(extraBold, title, { x: 80, y: 330, size: 88, fill: '#ffffff', tracking: -2 })}

  <rect x="80" y="366" width="104" height="6" rx="3" fill="${BRAND}" />

  ${typePath(bold, kicker, { x: 80, y: 424, size: 27, fill: BRAND, tracking: 3.4 })}

  ${typePath(medium, line, { x: 80, y: 500, size: 27, fill: '#c9d2cc' })}

  <!-- The two shirts, meeting in the middle, as they do above the match. -->
  <rect x="0" y="${HEIGHT - 8}" width="${WIDTH / 2}" height="8" fill="${HOME_SHIRT}" />
  <rect x="${WIDTH / 2}" y="${HEIGHT - 8}" width="${WIDTH / 2}" height="8" fill="${AWAY_SHIRT}" />
</svg>`;
}

async function main(): Promise<void> {
  // Scale to the card's width first, then take the band of the photograph the
  // stylesheet would show. The card is shorter than the photograph is wide, so
  // it has to come off the top and the bottom, and `FOCUS_Y` decides which of
  // those two cuts takes more — the same frame the pre-game screen is looking
  // at, so the card is a crop of a view the manager already knows rather than a
  // different photograph of the same pitch.
  const widened = await sharp(SOURCE).resize({ width: WIDTH }).toBuffer();
  const scaled = await sharp(widened).metadata();
  if (scaled.width !== WIDTH || scaled.height === undefined) {
    throw new Error(`og: the source did not scale to ${WIDTH}px wide.`);
  }
  if (scaled.height < HEIGHT) {
    throw new Error(`og: the source is only ${scaled.height}px tall, which cannot fill a ${HEIGHT}px card.`);
  }
  const top = Math.round((scaled.height - HEIGHT) * FOCUS_Y);

  const cropped = await sharp(widened)
    .extract({ left: 0, top, width: WIDTH, height: HEIGHT })
    .toBuffer();

  const composed = await sharp(cropped)
    .composite([{ input: Buffer.from(overlay()), top: 0, left: 0 }])
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();

  /**
   * Did the type actually draw?
   *
   * Text in an SVG is rendered by the system, not by us, so a machine with no
   * matching font will quietly produce a card of grass with nothing written on
   * it — which is exactly the sort of thing that gets shipped and never noticed
   * until somebody pastes the link. The title sits in a known band, and a band
   * with type in it is far lighter than grass is, so the light pixels are counted
   * rather than eyeballed.
   */
  const { data } = await sharp(composed)
    .extract({ left: 60, top: 240, width: 1000, height: 140 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bright = 0;
  for (const value of data) if (value > 170) bright += 1;
  const coverage = bright / data.length;
  if (coverage < 0.04) {
    throw new Error(
      `og: the title band is only ${(coverage * 100).toFixed(1)}% light — the text did not render. ` +
        'A social card with no type on it is worse than no card at all.',
    );
  }

  writeFileSync(OUTPUT, composed);
  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;
  console.log(`  assets/scene-ground.png ${kb(statSync(SOURCE).size).padStart(7)}  source`);
  console.log(`  public/og.png           ${kb(composed.length).padStart(7)}  ${WIDTH}x${HEIGHT}, title ${(coverage * 100).toFixed(1)}% covered`);
  console.log('\n  Wrote public/og.png.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
