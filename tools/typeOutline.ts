/**
 * The artwork's type, read out of the font rather than asked for by name.
 *
 * The social card and the installer's bitmaps are composed as SVG and
 * rasterised by `sharp`, and sharp's text goes through the system's own font
 * lookup. The `<text>` elements these files used to carry asked for Inter and
 * were quietly handed whatever the machine had — Segoe UI, on the machine this
 * was written on. Nothing in the source said so and nothing failed: the card
 * simply arrived in a typeface the game does not use.
 *
 * So the type is drawn from the file instead. `assets/fonts/` holds Archivo —
 * the face the game itself is set in, under the same OFL as the copies in
 * `public/fonts/` (the licence is `public/fonts/Archivo-LICENSE.txt`) — as four
 * small TrueType files, one per weight the artwork sets, each subset to
 * printable ASCII. This reads their outlines and hands back path data, which
 * means there is no font name for anything to misinterpret and no installed
 * font for anything to fall back to: what the artwork is set in is a file in
 * this repository, and it is the one the game loads.
 *
 * `npm run art:fonts` writes the four files; they are Google's own subsetting
 * of the face, which is why this reader knows precisely what it is reading — a
 * format 4 character map, short or long glyph offsets, and simple outlines. A
 * character the file does not carry, or a composite glyph, fails with a message
 * saying which character and which file, rather than drawing a gap.
 *
 *   npm run og · npm run desktop:art — both set their type through here
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A bounding box in font units, y up from the baseline. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One character, as the file draws it. */
export interface Glyph {
  /** SVG path data in font units, y up. Empty for a character that draws nothing. */
  d: string;
  /** How far the pen moves after the character, in font units. */
  advance: number;
  /** What the strokes cover, or null for a character with no ink (a space). */
  box: Box | null;
}

/** The weights the artwork sets in, one file each. */
export const ARTWORK_WEIGHTS = [500, 600, 700, 800] as const;
export type ArtworkWeight = (typeof ARTWORK_WEIGHTS)[number];

/**
 * What the four files are cut to: printable ASCII, and nothing else.
 *
 * Every character the card and the installer's bitmaps write is in here, which
 * is the contract `npm run art:fonts` cuts to and the one the artwork's tests
 * hold the files to. A character outside it is a re-cut, not a fallback.
 */
export const ARTWORK_CHARACTERS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

export interface Face {
  /** Where the outlines came from, for the failures. */
  readonly file: string;
  readonly weight: ArtworkWeight;
  readonly unitsPerEm: number;
  /**
   * The glyph for a character. Throws when the file has none, because a card
   * missing a letter is worse than a card that was never written.
   */
  glyph(character: string): Glyph;
  /** Which of the characters in `text` this face has no glyph for. */
  missing(text: string): string[];
  /**
   * A run of characters as one path, the pen folded into the coordinates, in
   * font units with y up. `tracking` is added after every character, which is
   * what CSS letter-spacing does and what the artwork is set with; it is rounded
   * to whole font units, which keeps the coordinates in the source the font's own.
   */
  typeset(text: string, tracking: number): { d: string; width: number };
}

interface Table {
  at: number;
  length: number;
}

/** Every table in the file, by tag — the directory at the top of an sfnt. */
function directory(bytes: Buffer): Map<string, Table> {
  const tables = new Map<string, Table>();
  const count = bytes.readUInt16BE(4);
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    tables.set(bytes.toString('latin1', at, at + 4), {
      at: bytes.readUInt32BE(at + 8),
      length: bytes.readUInt32BE(at + 12),
    });
  }
  return tables;
}

function table(tables: Map<string, Table>, tag: string, file: string): Table {
  const found = tables.get(tag);
  if (!found) throw new Error(`${file} has no ${tag} table`);
  return found;
}

/**
 * The character → glyph mapping, as the one subtable these files carry: a
 * format 4 map, whose segments are a run of characters and what they shift by.
 */
function characterMap(bytes: Buffer, tables: Map<string, Table>, file: string): (code: number) => number {
  const cmap = table(tables, 'cmap', file);
  const subtables = bytes.readUInt16BE(cmap.at + 2);
  for (let i = 0; i < subtables; i += 1) {
    const at = cmap.at + bytes.readUInt32BE(cmap.at + 4 + i * 8 + 4);
    if (bytes.readUInt16BE(at) !== 4) continue;

    const segments = bytes.readUInt16BE(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const ranges = deltas + segments * 2;

    return (code) => {
      for (let s = 0; s < segments; s += 1) {
        if (code > bytes.readUInt16BE(ends + s * 2)) continue;
        const start = bytes.readUInt16BE(starts + s * 2);
        if (code < start) return 0;
        const delta = bytes.readInt16BE(deltas + s * 2);
        const range = bytes.readUInt16BE(ranges + s * 2);
        if (range === 0) return (code + delta) & 0xffff;
        const glyph = bytes.readUInt16BE(ranges + s * 2 + range + (code - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
  }
  throw new Error(`${file}: the character map is not a format 4 table`);
}

interface Point {
  x: number;
  y: number;
  /** On the outline or off it: TrueType's curves are the points between. */
  on: boolean;
}

/** The midpoint of two points, which is where an implied on-curve point sits. */
function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true };
}

/**
 * One closed contour as path data.
 *
 * TrueType stores an outline as points, each marked as on the curve or off it,
 * and never spells out the on-curve points that sit between two off-curve ones:
 * they are halfway between them, by definition. So a contour is walked from a
 * point that *is* on the curve — or, when every point is a control point, from
 * the midpoint of the last and the first — and each pair of controls becomes a
 * quadratic through the implied point between them.
 */
function contourPath(points: readonly Point[], pen: number): string {
  const n = points.length;
  const first = points.findIndex((point) => point.on);
  const start = first < 0 ? middle(points[n - 1]!, points[0]!) : points[first]!;
  const order =
    first < 0
      ? points
      : [...points.slice(first + 1), ...points.slice(0, first)];

  let d = `M${start.x + pen} ${start.y}`;
  let control: Point | null = null;
  for (const point of order) {
    if (point.on) {
      if (control === null) d += `L${point.x + pen} ${point.y}`;
      else d += `Q${control.x + pen} ${control.y} ${point.x + pen} ${point.y}`;
      control = null;
    } else if (control === null) {
      control = point;
    } else {
      const implied = middle(control, point);
      d += `Q${control.x + pen} ${control.y} ${implied.x + pen} ${implied.y}`;
      control = point;
    }
  }
  if (control !== null) d += `Q${control.x + pen} ${control.y} ${start.x + pen} ${start.y}`;
  return `${d}Z`;
}

/**
 * The points of a simple outline, contour by contour, in the font's own units.
 *
 * The flags are the whole of the format: a point says whether it is on the
 * curve, whether its coordinates are one byte or two, and whether they are the
 * same as the last point's — with a repeat bit so that a run of points that are
 * alike is written once.
 */
function outlinePoints(bytes: Buffer, at: number, contours: number): Point[][] {
  let cursor = at + 10;
  const ends: number[] = [];
  for (let i = 0; i < contours; i += 1) ends.push(bytes.readUInt16BE(cursor + i * 2));
  cursor += contours * 2;

  const instructions = bytes.readUInt16BE(cursor);
  cursor += 2 + instructions;

  const count = ends[contours - 1]! + 1;
  const flags: number[] = [];
  while (flags.length < count) {
    const flag = bytes[cursor]!;
    cursor += 1;
    flags.push(flag);
    if ((flag & 8) === 0) continue;
    for (let repeat = bytes[cursor]!; repeat > 0; repeat -= 1) flags.push(flag);
    cursor += 1;
  }

  const xs: number[] = [];
  let x = 0;
  for (const flag of flags) {
    if ((flag & 2) !== 0) {
      const step = bytes[cursor]!;
      cursor += 1;
      x += (flag & 16) === 0 ? -step : step;
    } else if ((flag & 16) === 0) {
      x += bytes.readInt16BE(cursor);
      cursor += 2;
    }
    xs.push(x);
  }

  const ys: number[] = [];
  let y = 0;
  for (const flag of flags) {
    if ((flag & 4) !== 0) {
      const step = bytes[cursor]!;
      cursor += 1;
      y += (flag & 32) === 0 ? -step : step;
    } else if ((flag & 32) === 0) {
      y += bytes.readInt16BE(cursor);
      cursor += 2;
    }
    ys.push(y);
  }

  const contours0: Point[][] = [];
  let first = 0;
  for (const end of ends) {
    const points: Point[] = [];
    for (let i = first; i <= end; i += 1) {
      points.push({ x: xs[i]!, y: ys[i]!, on: (flags[i]! & 1) !== 0 });
    }
    contours0.push(points);
    first = end + 1;
  }
  return contours0;
}

/** An outline the format did not expect, said plainly enough to act on. */
function unsupported(file: string, character: string, what: string): Error {
  const drawn = [...character].map((c) => `'${c}'`).join('');
  return new Error(
    `${file} has no ${what} for ${drawn}: the artwork's fonts are cut to printable ASCII, ` +
      'and a character outside that needs the files cut again — `npm run art:fonts`.',
  );
}

/** One face, read and ready to set text in. */
function read(bytes: Buffer, file: string, weight: ArtworkWeight): Face {
  const tables = directory(bytes);
  const head = table(tables, 'head', file);
  const maxp = table(tables, 'maxp', file);
  const hhea = table(tables, 'hhea', file);
  const loca = table(tables, 'loca', file);
  const glyf = table(tables, 'glyf', file);
  const hmtx = table(tables, 'hmtx', file);

  const unitsPerEm = bytes.readUInt16BE(head.at + 18);
  const glyphs = bytes.readUInt16BE(maxp.at + 4);
  const metrics = bytes.readUInt16BE(hhea.at + 34);
  const longOffsets = bytes.readInt16BE(head.at + 50) === 1;
  const lookup = characterMap(bytes, tables, file);

  /** Where a glyph's outline starts in `glyf`, and how much of it there is. */
  function extent(glyph: number): [number, number] {
    return longOffsets
      ? [bytes.readUInt32BE(loca.at + glyph * 4), bytes.readUInt32BE(loca.at + glyph * 4 + 4)]
      : [bytes.readUInt16BE(loca.at + glyph * 2) * 2, bytes.readUInt16BE(loca.at + glyph * 2 + 2) * 2];
  }

  /**
   * A glyph's outline, moved along the line by `pen`.
   *
   * Everything is checked against the glyph's own bounding box on the way out:
   * the file states the box, the points have just been decoded by hand, and a
   * disagreement is a reader that has lost its place rather than artwork.
   */
  function pathOf(glyph: number, pen: number, character: string): { d: string; box: Box | null } {
    const [from, to] = extent(glyph);
    if (to <= from) return { d: '', box: null };

    const at = glyf.at + from;
    const contours = bytes.readInt16BE(at);
    if (contours < 0) {
      // A composite: a character put together out of other characters' outlines.
      // Printable ASCII has none — every one of the ninety-five is a shape of
      // its own — so this is a file cut to something wider than it claims.
      throw new Error(
        `${file} draws '${character}' out of other glyphs, which this reader does not build: ` +
          'the artwork is set in printable ASCII, where every character is its own outline.',
      );
    }
    if (contours === 0) return { d: '', box: null };

    // The record states its box as xMin, yMin, xMax, yMax.
    const box: Box = {
      left: bytes.readInt16BE(at + 2),
      bottom: bytes.readInt16BE(at + 4),
      right: bytes.readInt16BE(at + 6),
      top: bytes.readInt16BE(at + 8),
    };

    const strokes = outlinePoints(bytes, at, contours);
    const drawn = strokes.flat();
    const wanted = [box.left, box.right, box.top, box.bottom];
    const reached = [
      Math.min(...drawn.map((point) => point.x)),
      Math.max(...drawn.map((point) => point.x)),
      Math.max(...drawn.map((point) => point.y)),
      Math.min(...drawn.map((point) => point.y)),
    ];
    if (wanted.some((value, i) => value !== reached[i])) {
      throw new Error(
        `${file}: the outline of '${character}' does not reach its own bounding box ` +
          `(${reached.join(', ')} against ${wanted.join(', ')}) — the glyph was not read correctly.`,
      );
    }

    return { d: strokes.map((points) => contourPath(points, pen)).join(''), box };
  }

  function advanceOf(glyph: number): number {
    return bytes.readUInt16BE(hmtx.at + Math.min(glyph, metrics - 1) * 4);
  }

  function glyphId(character: string): number {
    const [only] = [...character];
    if (only === undefined || [...character].length !== 1) {
      throw new Error(`the artwork sets one character at a time, not ${JSON.stringify(character)}`);
    }
    const glyph = lookup(only.codePointAt(0)!);
    if (glyph <= 0 || glyph >= glyphs) throw unsupported(file, character, 'glyph');
    return glyph;
  }

  function glyph(character: string): Glyph {
    const id = glyphId(character);
    const { d, box } = pathOf(id, 0, character);
    return { d, advance: advanceOf(id), box };
  }

  function typeset(text: string, tracking: number): { d: string; width: number } {
    const gap = Math.round(tracking);
    let pen = 0;
    let d = '';
    for (const character of text) {
      const id = glyphId(character);
      d += pathOf(id, pen, character).d;
      pen += advanceOf(id) + gap;
    }
    return { d, width: pen };
  }

  return {
    file,
    weight,
    unitsPerEm,
    glyph,
    missing: (text) =>
      [...new Set([...text].filter((character) => lookup(character.codePointAt(0)!) <= 0))],
    typeset,
  };
}

const FACES = new Map<ArtworkWeight, Face>();

/** The face for a weight, read once. */
export function loadFace(weight: ArtworkWeight): Face {
  const cached = FACES.get(weight);
  if (cached) return cached;
  const file = fileURLToPath(new URL(`../assets/fonts/archivo-${weight}.ttf`, import.meta.url));
  const face = read(readFileSync(file), file, weight);
  FACES.set(weight, face);
  return face;
}

export interface Placement {
  /** Where the line starts, or where its centre sits when it is anchored there. */
  x: number;
  /** The baseline. */
  y: number;
  /** The em size in px, which is all the artwork ever sets. */
  size: number;
  fill: string;
  /** Space after every character, in px: CSS letter-spacing, which the art sets by hand. */
  tracking?: number;
  anchor?: 'start' | 'middle';
}

/**
 * A line of type as one `<path>` element, ready for the artwork's SVG.
 *
 * The path data stays in font units and the size lives in the transform, so
 * what is drawn scales exactly and the coordinates in the source are the ones
 * in the font. The y axis flips with it, which is the whole of the difference
 * between a font (y up from the baseline) and SVG (y down from it).
 */
export function typePath(face: Face, text: string, place: Placement): string {
  const scale = place.size / face.unitsPerEm;
  const { d, width } = face.typeset(text, (place.tracking ?? 0) / scale);
  const left = place.anchor === 'middle' ? place.x - (width * scale) / 2 : place.x;
  const round = (value: number) => Number(value.toFixed(3));
  return (
    `<path d="${d}" fill="${place.fill}" ` +
    `transform="translate(${round(left)} ${place.y}) scale(${round(scale)} ${round(-scale)})"/>`
  );
}
