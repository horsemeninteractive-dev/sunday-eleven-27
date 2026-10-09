/**
 * The Windows installer's own artwork, made from the game's mark.
 *
 * A stock NSIS wizard looks like nobody's game in particular: a bare header
 * strip, and whatever the framework draws in it. Two bitmap files are all the
 * installer has to say otherwise, and both are drawn here so that the mark the
 * manager sees on his desktop is the mark he saw while installing it.
 *
 *   - the **header**, 150×57, drawn at the right of the header bar on every
 *     page that has one (the install-mode, folder and progress pages);
 *   - the **sidebar**, 164×314, which MUI paints down the left of the welcome
 *     and finish pages, the two screens that are all picture and no work.
 *
 * The sizes are not chosen: MUI's `MUI_HEADERIMAGE_BITMAP` is a 150×57 control
 * and `MUI_WELCOMEFINISHPAGE_BITMAP` is a 164×314 one. They are written as
 * **BMP**, also not by choice — `electron-builder.yml` hands these paths
 * straight to `makensis`, and NSIS's `LoadImage` reads BMP and nothing else, so
 * a PNG here is a wizard with a blank panel where the game should be.
 *
 * The art is generated from `public/favicon.svg` rather than drawn again, for
 * the reason the rest of the icon set is: two copies of a mark is how they stop
 * matching. Change the favicon, run this, and the installer follows — which is
 * why the palette below is the three colours the game already uses (the near
 * black of `theme-color`, the accent green of the favicon and the boot screen,
 * and the two greys of the boot label) rather than a fourth opinion about them.
 *
 * Requires sharp, which is a development dependency and nothing more: the
 * bitmaps are committed, and the only time this runs is when the mark changes.
 *
 *     npm run desktop:art
 *
 * It checks what it wrote rather than trusting it: the file is read back, the
 * BMP header is parsed, and the pixels are counted per band — so a mark that
 * failed to rasterise, a wordmark too wide for its strip, or a rule that came
 * out the wrong colour fails here rather than in an installer somebody is
 * halfway through running.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const FAVICON = `${root}public/favicon.svg`;
/** `directories.buildResources`: where electron-builder looks for the artwork. */
const OUT = `${root}desktop/resources/`;

/** The near-black the game is drawn on: `theme-color`, and the boot screen. */
const BACKGROUND = '#08090B';
/** The favicon's field, and the accent line this installer is signed with. */
const ACCENT = '#4CAF7D';
/** The boot label's colour, and the muted line under the boot note's. */
const INK = '#E8EFF3';
const MUTED = '#7C868F';

/** The game's own font stack, which is what the favicon and the card use. */
const FONT =
  "Inter, 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/** A band of rows that has to contain something, and how much of it. */
interface Band {
  what: string;
  top: number;
  bottom: number;
  /** Counted as exactly the accent, as the bright ink, or as the muted grey. */
  kind: 'accent' | 'ink' | 'muted';
  /** The smallest share of the band that may be that colour. */
  least: number;
}

interface Art {
  file: string;
  width: number;
  height: number;
  /** Where the favicon is drawn, and at what size. */
  mark: { size: number; left: number; top: number };
  /** Everything else, as SVG over the background. */
  overlay: string;
  /** Which rows must show what, so a blank or clipped panel cannot ship. */
  bands: Band[];
  note: string;
}

/**
 * The overlay as a document librsvg will render.
 *
 * The fragments above are what is drawn; this is the page it is drawn on, sized
 * to the bitmap so that nothing is scaled on the way in — a text layer resized
 * after rasterising is a text layer with soft edges.
 */
function document(width: number, height: number, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}">${body}</svg>`
  );
}

/** One line of the wordmark, centred on `x` unless `anchor` says otherwise. */
function line(
  x: number,
  y: number,
  size: number,
  weight: number,
  spacing: number,
  fill: string,
  body: string,
  anchor: 'start' | 'middle' = 'middle',
): string {
  return (
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}"` +
    ` font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}"` +
    ` fill="${fill}">${body}</text>`
  );
}

/**
 * The strip every page with a header wears.
 *
 * The app's own tile, then the name and what game it is, on the near-black the
 * game uses everywhere — with a green rule along the bottom edge, which is what
 * makes a 150-pixel rectangle read as a deliberate plate rather than as a
 * picture that was stuck to a white bar.
 */
const HEADER: Art = {
  file: 'installerHeader.bmp',
  width: 150,
  height: 57,
  mark: { size: 30, left: 8, top: 13 },
  overlay:
    `<rect x="0" y="55" width="150" height="2" fill="${ACCENT}"/>` +
    line(45, 27, 9, 800, 0.4, INK, 'SUNDAY ELEVEN 27', 'start') +
    line(45, 38, 4.8, 600, 1.1, MUTED, 'SUNDAY LEAGUE FOOTBALL', 'start'),
  bands: [
    { what: 'the wordmark', top: 19, bottom: 30, kind: 'ink', least: 0.02 },
    { what: 'what game it is', top: 33, bottom: 41, kind: 'muted', least: 0.005 },
    { what: 'the mark', top: 13, bottom: 43, kind: 'accent', least: 0.04 },
    { what: 'the rule', top: 55, bottom: 57, kind: 'accent', least: 0.8 },
  ],
  note: 'the bar every inner page wears',
};

/**
 * The panel down the left of the welcome and finish pages.
 *
 * A poster rather than a label: the tile large enough to read the name inside
 * it, the wordmark under it, what the game is, and who made it. Two screens get
 * this and nothing else, which is why it is composed for a page rather than
 * shrunk to fit a bar.
 */
const SIDEBAR: Art = {
  file: 'installerSidebar.bmp',
  width: 164,
  height: 314,
  mark: { size: 84, left: 40, top: 54 },
  overlay:
    `<rect x="62" y="170" width="40" height="2" fill="${ACCENT}"/>` +
    line(82, 198, 12.5, 800, 0.8, INK, 'SUNDAY ELEVEN 27') +
    line(82, 216, 5.6, 600, 1.8, MUTED, 'SUNDAY LEAGUE FOOTBALL') +
    line(82, 292, 5.6, 600, 2, MUTED, 'HORSEMEN INTERACTIVE'),
  bands: [
    { what: 'the mark', top: 54, bottom: 138, kind: 'accent', least: 0.2 },
    { what: 'the rule', top: 170, bottom: 172, kind: 'accent', least: 0.15 },
    { what: 'the wordmark', top: 186, bottom: 203, kind: 'ink', least: 0.01 },
    { what: 'what game it is', top: 208, bottom: 219, kind: 'muted', least: 0.005 },
    { what: 'who made it', top: 285, bottom: 297, kind: 'muted', least: 0.004 },
  ],
  note: 'the panel on the welcome and finish pages',
};

const ART: Art[] = [HEADER, SIDEBAR];

/**
 * Pixels as a 24-bit BMP, which is the only thing NSIS will read.
 *
 * Bottom-up rows, three bytes a pixel in blue-green-red order, and every row
 * padded to a multiple of four bytes — the format's own rules, written out
 * rather than pulled in, because a dependency for forty lines of header would
 * be a dependency in the build of every release.
 */
function toBmp(pixels: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = ((width * 3 + 3) >> 2) * 4;
  const imageSize = stride * height;
  const offset = 14 + 40;
  const bmp = Buffer.alloc(offset + imageSize);

  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(offset, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22); // positive: rows run bottom-up
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30); // BI_RGB, so nothing else has to be explained
  bmp.writeUInt32LE(imageSize, 34);
  bmp.writeInt32LE(2835, 38); // 72 dpi, the 96 dpi of a bitmap being nobody's business
  bmp.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const from = y * width * channels;
    const to = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      bmp[to + x * 3] = pixels[from + x * channels + 2]!;
      bmp[to + x * 3 + 1] = pixels[from + x * channels + 1]!;
      bmp[to + x * 3 + 2] = pixels[from + x * channels]!;
    }
  }
  return bmp;
}

/** RGB at a pixel of a decoded (top-down) bitmap. */
function rgb(pixels: Buffer, width: number, x: number, y: number): [number, number, number] {
  const at = (y * width + x) * 3;
  return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
}

interface Reading {
  width: number;
  height: number;
  depth: number;
  /** Top-down, three bytes a pixel, whatever order the file kept them in. */
  pixels: Buffer;
}

/**
 * The file as a reader that knows nothing about this tool sees it.
 *
 * The install steps are checked on the artifact rather than on the intention
 * — the same reason `apps` are driven in the desktop smoke test — so the checks
 * below start by reading back what was actually written.
 */
function readBmp(path: string): Reading {
  const bmp = readFileSync(path);
  if (bmp.toString('ascii', 0, 2) !== 'BM') throw new Error(`${path} is not a BMP`);
  const offset = bmp.readUInt32LE(10);
  const width = bmp.readInt32LE(18);
  const height = bmp.readInt32LE(22);
  const depth = bmp.readUInt16LE(28);
  if (bmp.readUInt32LE(30) !== 0) throw new Error(`${path} is compressed; NSIS wants BI_RGB`);
  if (height < 0) throw new Error(`${path} is a top-down BMP; every MUI bitmap is bottom-up`);

  const stride = ((width * 3 + 3) >> 2) * 4;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const from = offset + (height - 1 - y) * stride;
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 3;
      pixels[to] = bmp[from + x * 3 + 2]!;
      pixels[to + 1] = bmp[from + x * 3 + 1]!;
      pixels[to + 2] = bmp[from + x * 3]!;
    }
  }
  return { width, height, depth, pixels };
}

/** What a colour looks like in a bitmap: the palette above, in numbers. */
function hexColour(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const GREEN = hexColour(ACCENT);

/**
 * Light enough to be the wordmark rather than the accent line or a blend.
 *
 * The threshold sits above the accent green (which sums to 376) on purpose: the
 * green is a colour of its own in this artwork, counted as such, and counting it
 * as ink would let a mark that never rendered pass a check meant to catch it.
 * Half of the ink blended into the near-black ground sums to 371, so this counts
 * the strokes of the letters rather than the haze around them.
 */
function isInk(red: number, green: number, blue: number): boolean {
  return red + green + blue > 500;
}

/**
 * The greys: the muted line under each wordmark, and nothing else.
 *
 * Brighter than the near-black ground and its antialiasing, darker than the
 * wordmark above it — the band between the two, which is where the subtitle and
 * the maker's name live.
 */
function isMuted(red: number, green: number, blue: number): boolean {
  const sum = red + green + blue;
  return sum > 200 && sum < 500;
}

/**
 * Whether the file says what the design says.
 *
 * Five claims, in the order they would go wrong: the size MUI asked for, the
 * depth NSIS can read, the accent colour where the design puts it, a band of
 * rows per line of text in the colour that line is drawn in — which is what
 * catches a font that never rendered — and a margin between the outermost light
 * pixel and the edge of the picture, which is what catches a wordmark that
 * overran its strip.
 */
function verify(art: Art, path: string): string {
  const image = readBmp(path);
  if (image.width !== art.width || image.height !== art.height) {
    throw new Error(
      `${art.file} is ${image.width}x${image.height}; MUI draws ${art.width}x${art.height}`,
    );
  }
  if (image.depth !== 24) throw new Error(`${art.file} is ${image.depth}-bit; write 24`);

  const total = image.width * image.height;
  let accent = 0;
  let inkLeft = image.width;
  let inkRight = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const [red, green, blue] = rgb(image.pixels, image.width, x, y);
      if (red === GREEN[0] && green === GREEN[1] && blue === GREEN[2]) accent += 1;
      if (isInk(red, green, blue)) {
        if (x < inkLeft) inkLeft = x;
        if (x > inkRight) inkRight = x;
      }
    }
  }

  const shares: string[] = [];
  for (const band of art.bands) {
    let hit = 0;
    const rows = (band.bottom - band.top) * image.width;
    for (let y = band.top; y < band.bottom; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const [red, green, blue] = rgb(image.pixels, image.width, x, y);
        const matches =
          band.kind === 'accent'
            ? red === GREEN[0] && green === GREEN[1] && blue === GREEN[2]
            : band.kind === 'ink'
              ? isInk(red, green, blue)
              : isMuted(red, green, blue);
        if (matches) hit += 1;
      }
    }
    const share = hit / rows;
    shares.push(`${band.what} ${(share * 100).toFixed(1)}%`);
    if (share < band.least) {
      throw new Error(
        `${art.file}: ${band.what} is ${(share * 100).toFixed(1)}% of rows ` +
          `${band.top}–${band.bottom}, and it needs at least ${(band.least * 100).toFixed(1)}% ` +
          '— the mark or a line of text did not render',
      );
    }
  }

  if (accent / total < 0.03) {
    throw new Error(`${art.file} is barely green: ${((accent / total) * 100).toFixed(1)}% of it`);
  }
  if (inkRight === -1) throw new Error(`${art.file} has no light pixels at all`);
  if (inkLeft < 3 || inkRight > image.width - 4) {
    throw new Error(
      `${art.file}: the text runs from x=${inkLeft} to x=${inkRight} in a ${image.width}-pixel ` +
        'picture, so it is against the edge or over it — shorten a line or set it smaller',
    );
  }

  return `${art.width}x${art.height}  ${shares.join(', ')}`;
}

async function main(): Promise<void> {
  const favicon = readFileSync(FAVICON);
  mkdirSync(OUT, { recursive: true });

  console.log('  the Windows installer:');
  for (const art of ART) {
    // Rasterised at a high density so librsvg draws the tile's own text at the
    // target size rather than at 32px and then scaling it up into a blur.
    const mark = await sharp(favicon, { density: 384 })
      .resize(art.mark.size, art.mark.size)
      .png()
      .toBuffer();
    // Rendered to PNG before it is composited: sharp reads an SVG *input*, but
    // a composite layer is decoded from its bytes and an SVG buffer is not a
    // format it recognises there.
    const overlay = await sharp(Buffer.from(document(art.width, art.height, art.overlay)))
      .png()
      .toBuffer();
    const { data, info } = await sharp({
      create: {
        width: art.width,
        height: art.height,
        channels: 3,
        background: BACKGROUND,
      },
    })
      .composite([
        { input: overlay, left: 0, top: 0 },
        { input: mark, left: art.mark.left, top: art.mark.top },
      ])
      .raw()
      .toBuffer({ resolveWithObject: true });

    const path = `${OUT}${art.file}`;
    writeFileSync(path, toBmp(data, info.width, info.height, info.channels));
    const report = verify(art, path);
    console.log(`  ${`desktop/resources/${art.file}`.padEnd(38)} ${report}`);
    console.log(`  ${''.padEnd(38)} ${art.note}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
