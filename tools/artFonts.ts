/**
 * The artwork's fonts, cut from the face the game is set in.
 *
 * `assets/fonts/` holds Archivo as four small TrueType files — one for each
 * weight the social card and the installer's bitmaps set — subset to printable
 * ASCII, which is every character either of them writes. Those are the files
 * `typeOutline` reads, and they are committed rather than fetched as part of a
 * build, so that regenerating the card, the installer art or the installers
 * themselves never needs the network.
 *
 *   npm run art:fonts
 *
 * This is the one place that does. Google Fonts will hand out a TrueType file
 * rather than a page if it is asked with a user agent old enough to predate web
 * fonts, and `text=` cuts the file down to the characters named — so what
 * arrives is the face the game loads, in four weights, at about twenty
 * kilobytes each. Run it when the artwork starts writing a character the files
 * do not carry, which `typeOutline` will say plainly when it happens, or when
 * the face itself moves version.
 *
 * The typeface is OFL, like the copies in `public/fonts/` that the game itself
 * loads; the licence sits beside those, in `public/fonts/Archivo-LICENSE.txt`.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ARTWORK_CHARACTERS, ARTWORK_WEIGHTS, loadFace } from './typeOutline';

const OUT = fileURLToPath(new URL('../assets/fonts/', import.meta.url));

/**
 * The user agent that gets a font file back.
 *
 * Google Fonts answers a request with a stylesheet shaped like the browser: ask
 * as anything current and it sends WOFF2, which the rasteriser cannot read. This
 * one is Safari 5, which is before WOFF, so the answer is `format('truetype')`.
 */
const AS_OLD_SAFARI =
  'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-US) AppleWebKit/533.21.1 ' +
  '(KHTML, like Gecko) Version/5.0.5 Safari/533.21.1';

function wanted(weight: number): string {
  return (
    `https://fonts.googleapis.com/css2?family=Archivo:wght@${weight}` +
    `&text=${encodeURIComponent(ARTWORK_CHARACTERS)}`
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  console.log(`  Archivo, cut to the artwork's ${ARTWORK_CHARACTERS.length} characters:`);

  for (const weight of ARTWORK_WEIGHTS) {
    const css = await (await fetch(wanted(weight), { headers: { 'user-agent': AS_OLD_SAFARI } })).text();
    const href = /url\(([^)]+)\)/.exec(css)?.[1];
    if (href === undefined) {
      throw new Error(`art:fonts: no font came back for ${weight}: ${css.trim().slice(0, 200)}`);
    }
    const file = `${OUT}archivo-${weight}.ttf`;
    writeFileSync(file, Buffer.from(await (await fetch(href)).arrayBuffer()));

    // Read back what was written, with the reader the artwork itself uses: a
    // subset that arrived missing a letter would otherwise be found by somebody
    // looking at a card with a hole in it.
    const face = loadFace(weight);
    const missing = face.missing(ARTWORK_CHARACTERS);
    if (missing.length > 0) {
      throw new Error(`art:fonts: ${file} is missing ${missing.join('')}`);
    }
    const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
    console.log(
      `  assets/fonts/archivo-${weight}.ttf  ${kb(statSync(file).size).padStart(7)}  ` +
        `${face.unitsPerEm} units/em, every character the artwork sets`,
    );
  }

  console.log('\n  The artwork reads these through `tools/typeOutline.ts`.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
