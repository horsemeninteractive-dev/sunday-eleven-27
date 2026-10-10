import { describe, expect, it } from 'vitest';
import {
  ARTWORK_CHARACTERS,
  ARTWORK_WEIGHTS,
  loadFace,
  typePath,
  type ArtworkWeight,
} from '../../tools/typeOutline';

/**
 * The artwork's type, held to the face the game renders.
 *
 * The card and the installer's bitmaps are drawn outside the app, by `sharp`,
 * and the reason this module exists is that the rasteriser used to be asked for
 * a font by name and given whatever the machine had. So the tests are about the
 * two things that can now go wrong quietly: the four subset files drifting from
 * the characters the art writes, and the outlines drifting from the face the
 * game sets.
 *
 * The widths below were measured in Chromium — the engine the game itself runs
 * in — on the same lines at the same sizes, through the WOFF2 in `public/fonts`
 * that the stylesheet loads. They are what "the same letters" means, so a
 * difference is a difference from the game rather than from a number someone
 * once wrote down. The tolerance is a quarter of a percent, which is a couple
 * of pixels on the longest line the card sets, and it is there for the two
 * things this reader deliberately does not do: the browser kerns its pairs and
 * this sets none, and the artwork's tracking is rounded to whole font units.
 */
const MEASURED_IN_THE_GAME: { face: ArtworkWeight; text: string; size: number; tracking: number; width: number }[] = [
  { face: 800, text: 'Sunday Eleven 27', size: 88, tracking: -2, width: 745.39 },
  { face: 800, text: 'SE27', size: 36, tracking: 0, width: 95.256 },
  {
    face: 500,
    text: 'Pick a side of a muddy pitch, pick a team from the local game, and take them to the whistle.',
    size: 27,
    tracking: 0,
    width: 1085.27,
  },
  { face: 600, text: 'HORSEMEN INTERACTIVE', size: 5.6, tracking: 2, width: 111.002 },
];

/** The width of a line as this module sets it, in px. */
function sets(face: ArtworkWeight, text: string, size: number, tracking: number): number {
  const font = loadFace(face);
  return font.typeset(text, tracking / (size / font.unitsPerEm)).width * (size / font.unitsPerEm);
}

describe('the artwork’s fonts', () => {
  it('carries every character the card and the installer write', () => {
    for (const weight of ARTWORK_WEIGHTS) {
      expect(loadFace(weight).missing(ARTWORK_CHARACTERS), `weight ${weight}`).toEqual([]);
    }
  });

  it('is a file each, at the size a subset should be', () => {
    for (const weight of ARTWORK_WEIGHTS) {
      const face = loadFace(weight);
      expect(face.file, `weight ${weight}`).toContain(`archivo-${weight}.ttf`);
      // The face is cut to printable ASCII, so an em of it is small; a file
      // that came back whole would mean the character set was not asked for.
      expect(face.unitsPerEm).toBe(1000);
    }
  });

  it('sets the artwork’s lines at the widths the game itself sets them', () => {
    for (const { face, text, size, tracking, width } of MEASURED_IN_THE_GAME) {
      expect(Math.abs(sets(face, text, size, tracking) - width), text).toBeLessThan(width / 400);
    }
    // 'SE27' has no kern pair and no tracking to round, and comes out exact to
    // the pixel: the outlines are the game's, not a copy of them.
    expect(sets(800, 'SE27', 36, 0)).toBeCloseTo(95.256, 3);
  });

  it('draws every glyph as closed contours', () => {
    const face = loadFace(500);
    for (const character of ARTWORK_CHARACTERS) {
      const glyph = face.glyph(character);
      expect(glyph.advance, character).toBeGreaterThan(0);
      if (character === ' ') {
        // A space is a width and nothing else.
        expect(glyph.d, 'a space draws nothing').toBe('');
        expect(glyph.box).toBeNull();
        continue;
      }
      const starts = glyph.d.match(/M/g)?.length ?? 0;
      expect(starts, character).toBeGreaterThan(0);
      expect(glyph.d.match(/Z/g)?.length, `'${character}' closes every contour it opens`).toBe(starts);
      // Nothing is drawn outside the em box and its descender.
      expect(glyph.box!.top, character).toBeLessThan(face.unitsPerEm);
      expect(glyph.box!.bottom, character).toBeGreaterThan(-face.unitsPerEm / 2);
    }
  });

  it('keeps the coordinates the face’s own: y up from the baseline', () => {
    const face = loadFace(500);
    const box = (character: string) => face.glyph(character).box!;
    expect(box('H').bottom).toBe(0); // a capital sits on the baseline
    expect(box('H').top).toBeGreaterThan(600);
    expect(box('g').bottom).toBeLessThan(-100); // a descender goes under it
    expect(box('_').top).toBeLessThan(0); // and the underscore is all of it below
  });

  it('refuses a character the files were not cut to, and says how to cut them again', () => {
    const face = loadFace(700);
    expect(face.missing('SUNDAY — 27')).toEqual(['—']);
    expect(() => face.glyph('—')).toThrow(/art:fonts/);
    expect(() => face.glyph('AB')).toThrow(/one character at a time/);
  });

  it('anchors a line where the artwork asks, and flips the axis the way SVG needs', () => {
    const face = loadFace(800);
    const centred = typePath(face, 'SE27', { x: 52, y: 65.6, size: 36, fill: '#000', anchor: 'middle' });
    const width = sets(800, 'SE27', 36, 0);
    const left = Number(/translate\(([-\d.]+)/.exec(centred)![1]);
    expect(left).toBeCloseTo(52 - width / 2, 1);

    const started = typePath(face, 'SE27', { x: 52, y: 65.6, size: 36, fill: '#000' });
    expect(Number(/translate\(([-\d.]+)/.exec(started)![1])).toBe(52);

    // Font units are y up and SVG is y down; the size lives in the transform,
    // so the path data in the source stays the font's own coordinates.
    expect(centred).toContain('scale(0.036 -0.036)');
    expect(centred).not.toContain('NaN');
  });
});
