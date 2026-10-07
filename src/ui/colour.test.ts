import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COLOUR_PAIRS } from '@/simulation/generation/names';
import {
  SCENE_INK,
  sceneFade,
  STRIPE_ANGLE,
  STRIPE_BAND_SHARE,
  STRIPE_CONTRAST_FLOOR,
  STRIPE_COUNT,
  STRIPE_SPAN,
  barFade,
  barStripes,
  clubStyle,
  colourDistance,
  contrastRatio,
  inkForColour,
  inkForColours,
  mixColours,
  secondaryColour,
  stripeAlpha,
  stripeColours,
  stripeTile,
  stripeTiles,
  stripeWeights,
  withAlpha,
} from './colour';

/** The `r, g, b` an `#rrggbb` writes to, so a hex and a gradient can be compared. */
function hexToRgbCsv(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255},`;
}

describe('ink', () => {
  it('goes dark on light colours and light on dark ones', () => {
    expect(inkForColour('#ffffff')).toBe('#101a14');
    expect(inkForColour('#f9a825')).toBe('#101a14');
    expect(inkForColour('#1565c0')).toBe('#f4f8f6');
    expect(inkForColour('#000000')).toBe('#f4f8f6');
  });

  it('reads three-digit hex the same as six', () => {
    expect(inkForColour('#fff')).toBe(inkForColour('#ffffff'));
    expect(withAlpha('#fff', 0.5)).toBe('rgba(255, 255, 255, 0.5)');
  });

  it('picks the ink that survives on the most colours it is given', () => {
    const ink = inkForColours('#1565c0', '#ffffff');
    const other = ink === '#f4f8f6' ? '#101a14' : '#f4f8f6';
    const worst = (candidate: string) =>
      Math.min(contrastRatio(candidate, '#1565c0'), contrastRatio(candidate, '#ffffff'));
    // Neither option is perfect on both, but the loser must be the worse one,
    // and the winner must not be invisible anywhere.
    expect(worst(ink)).toBeGreaterThan(worst(other));
    expect(worst(ink)).toBeGreaterThan(3);
  });
});

describe('telling two colours apart', () => {
  it('calls a colour itself zero, and its opposite the whole way across', () => {
    expect(colourDistance('#c62828', '#c62828')).toBe(0);
    expect(colourDistance('#000000', '#ffffff')).toBeCloseTo(255 * Math.sqrt(9), 6);
  });

  it('separates two shirts that would read as the same one', () => {
    // Two mid reds: different hex codes, the same kit on a Sunday morning.
    expect(colourDistance('#c62828', '#b32323')).toBeLessThan(60);
    // Red against green: equally bright, and never confused.
    expect(colourDistance('#c62828', '#2e7d32')).toBeGreaterThan(200);
    // Black against navy: the classic kit clash.
    expect(colourDistance('#111111', '#16224a')).toBeGreaterThan(100);
    expect(colourDistance('#111111', '#16224a')).toBeLessThan(160);
  });
});

describe('stripes', () => {
  it('stripes the bar in the club\u2019s own colours', () => {
    const colours = { primary: '#c62828', secondary: '#ffffff' };
    const stripes = barStripes(colours);
    expect(stripes.startsWith('repeating-linear-gradient(112deg,')).toBe(true);
    // Drawn at whatever strength the club's two colours can carry, so the ink
    // chosen for the bar stays readable across every band.
    expect(stripes).toContain(`rgba(255, 255, 255, ${stripeAlpha(colours)}) 0`);
  });

  it('wears the very same stripe as the screens before a career starts', () => {
    // The bar and the pre-game ground are one pattern in two colours, so that
    // the two move together and neither can be changed without the other. All
    // that should differ between them is the colour of the bands.
    const shape = (gradient: string) => gradient.replace(/rgba\([^)]+\)/g, 'C');
    expect(shape(barStripes({ primary: '#c62828', secondary: '#ffffff' }))).toBe(shape(stripeTiles()));
  });

  it('walks each band on the bar a little fainter than the one before it', () => {
    const weights = stripeWeights();
    expect(weights[0]).toBe(1);
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]!).toBeLessThan(weights[i - 1]!);
    }
    expect(weights).toHaveLength(Math.ceil(STRIPE_COUNT / 2));

    // The run's own decay, now carried by the mask over the moving stripe:
    // a stop per band, each `STRIPE_FADE` of the one before it.
    const fade = barFade();
    const alphas = [...fade.matchAll(/rgba\(255, 255, 255, ([\d.]+)\)/g)].map((match) => Number(match[1]));
    expect(alphas.slice(0, weights.length)).toEqual(weights.map((weight) => Number(weight.toFixed(3))));
    for (let i = 1; i < alphas.length; i += 1) expect(alphas[i]!).toBeLessThanOrEqual(alphas[i - 1]!);
    // The furthest band is less than half the strength of the nearest, which is
    // what makes the fade land rather than stopping at a hard edge.
    expect(alphas[weights.length - 1]!).toBeLessThan(0.5 * alphas[0]!);
  });

  it('gives up by the end of the span, leaving the rest of the bar flat', () => {
    // The bands cover a span, not the whole header — the search box and the
    // fixture summary sit on the club's plain colour.
    expect(STRIPE_SPAN).toBeLessThan(0.7);
    const fade = barFade();
    expect(fade.startsWith('linear-gradient(112deg,')).toBe(true);
    const span = (STRIPE_SPAN * 100).toFixed(2);
    expect(fade).toContain(`rgba(255, 255, 255, 0) ${span}%`);
    // Every stop from there on is fully transparent, so the rest of the bar is
    // the club's plain colour.
    const tail = fade.slice(fade.indexOf(`rgba(255, 255, 255, 0) ${span}%`));
    const stops = [...tail.matchAll(/rgba\(255, 255, 255, ([\d.]+)\)/g)].map((match) => Number(match[1]));
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((alpha) => alpha === 0)).toBe(true);
    expect(fade.endsWith('100%)')).toBe(true);
  });

  it('holds the stripes back to what the club’s colours can carry', () => {
    // A dark second colour turns a mid orange brown, and brown cannot take the
    // white ink the orange needed — so those stripes are drawn fainter.
    expect(stripeAlpha({ primary: '#ef6c00', secondary: '#212121' })).toBeLessThan(0.3);
    // A light second colour on a dark first one has room for stronger bands.
    expect(stripeAlpha({ primary: '#283593', secondary: '#ffca28' })).toBeGreaterThan(0.3);
  });

  it('leaves a club with only one colour a plain bar', () => {
    // There is nothing to draw a band in, so there are no bands — and so
    // nothing for the drift to move.
    const flat = stripeColours({ primary: '#c62828', secondary: '#c62828' });
    expect(flat).toEqual(['#c62828']);
    expect(barStripes({ primary: '#c62828' })).toBe('none');
  });

  it('mixes a stripe band between the two colours', () => {
    expect(mixColours('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixColours('#c62828', '#ffffff', 0)).toBe('#c62828');
  });

  it('wears the header\u2019s own stripe, at the size of the bar it is drawn on', () => {
    const field = stripeTiles();
    expect(field.startsWith('repeating-linear-gradient(112deg,')).toBe(true);

    // The header's bands are a run of STRIPE_COUNT segments crossing STRIPE_SPAN
    // of the bar, so one segment is the share of the window the field uses. It
    // is a length along the gradient's own axis, hence the sine.
    const lengths = [...field.matchAll(/([0-9.]+)vw/g)].map((match) => Number(match[1]));
    const band = STRIPE_BAND_SHARE * Math.sin((STRIPE_ANGLE * Math.PI) / 180) * 100;
    expect(field).toContain('rgba(76, 175, 125, 0.9) 0');
    expect(lengths).toHaveLength(3);
    // A band, then the gap after it — the same width as the band — and there the
    // period is up and the pattern starts again.
    expect(lengths[0]).toBeCloseTo(band, 3);
    expect(lengths[1]).toBeCloseTo(band, 3);
    expect(lengths[2]).toBeCloseTo(band * 2, 3);
  });

  it('is drawn in the mark\u2019s own green, not a green of its own', () => {
    // The field is the colour of the 27 beside the words. The stylesheet holds
    // that green as --accent and the gradient is built in JS, so the two are
    // read here against each other rather than trusted to stay in step.
    const sheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    const accent = /--accent:\s*(#[0-9a-fA-F]{3,8})/.exec(sheet)?.[1]?.toLowerCase();
    expect(accent).toBeTruthy();
    expect(SCENE_INK.toLowerCase()).toBe(accent);
    expect(stripeTiles()).toContain(hexToRgbCsv(SCENE_INK));
  });

  it('fades the field from almost opaque to gone, left to right', () => {
    const fade = sceneFade();
    expect(fade.startsWith('linear-gradient(90deg,')).toBe(true);
    const alphas = [...fade.matchAll(/rgba\(255, 255, 255, ([\d.]+)\)/g)].map((match) => Number(match[1]));
    // Almost opaque where the eye starts and nothing at all by the far right.
    expect(alphas[0]).toBeGreaterThan(0.9);
    expect(alphas[alphas.length - 1]).toBe(0);
    for (let i = 1; i < alphas.length; i += 1) expect(alphas[i]!).toBeLessThan(alphas[i - 1]!);
    // And it runs across the window rather than along the bands: the fade is a
    // left-to-right one whatever angle the stripes happen to be on.
    expect(fade).not.toContain(`${STRIPE_ANGLE}deg`);
  });

  it('moves the field by exactly one period, so the drift has no seam', () => {
    const field = stripeTiles();
    const period = Number([...field.matchAll(/([0-9.]+)vw/g)].pop()![1]);
    const tile = Number(stripeTile().replace('vw', ''));

    // The pattern's period runs along the gradient's axis; the layer moves
    // sideways, which is a longer way round by the sine of the angle. At one
    // period divided by that sine the pattern is standing exactly where it
    // started — so the loop cannot show a join, however long it runs. The last
    // two decimals are the rounding in the emitted `vw` lengths: a hundredth of
    // a pixel a loop, which is why they are printed and not worried about.
    expect(tile).toBeCloseTo(period / Math.sin((STRIPE_ANGLE * Math.PI) / 180), 2);
    // And the tile is the distance the stylesheet both moves the layer by and
    // sizes it by, in the same units. Nothing here is a pixel count that could
    // fall out of step with a window of a different width.
    expect(stripeTile().endsWith('vw')).toBe(true);
    expect(tile).toBeGreaterThan(0);
  });
});

describe('clubStyle', () => {
  it('offers every club its own shirt, and never the same one twice', () => {
    // A pair is a shirt, a scarf and a crest band all at once. Two identical
    // pairs mean one of the county's wardrobes is a copy of another's, which is
    // how a whole division ends up in the same colours.
    const keys = COLOUR_PAIRS.map((colours) => `${colours.primary}/${colours.secondary}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(40);
  });

  it('hands CSS both colours, the stripe background and an ink that reads on it', () => {
    const style = clubStyle({ primary: '#c62828', secondary: '#ffffff' });
    expect(style['--club']).toBe('#c62828');
    expect(style['--club-2']).toBe('#ffffff');
    expect(style['--club-stripes']).toContain('linear-gradient');
    expect(style['--club-soft']).toBe('rgba(198, 40, 40, 0.26)');
    // The header text has to survive both the flat colour and the band.
    for (const surface of stripeColours({ primary: '#c62828', secondary: '#ffffff' })) {
      expect(contrastRatio(style['--club-ink']!, surface)).toBeGreaterThanOrEqual(STRIPE_CONTRAST_FLOOR);
    }
  });

  it('treats a missing second colour as the first', () => {
    expect(secondaryColour({ primary: '#2e7d32' })).toBe('#2e7d32');
    expect(secondaryColour({ primary: '#2e7d32', secondary: '  ' })).toBe('#2e7d32');
  });

  it('keeps the fixture band legible, and darker than the club’s own colour', () => {
    for (const colours of COLOUR_PAIRS) {
      const style = clubStyle(colours);
      const band = style['--club-band']!;
      // The band exists to be read: the date, the competition and the venue are
      // the three facts a manager looks for without reading anything else.
      expect(
        contrastRatio(style['--club-band-ink']!, band),
        `${colours.primary} fixture band`,
      ).toBeGreaterThanOrEqual(4.5);
      // Contrast against black rises with luminance, so this is the band being
      // a shade of the club's colour rather than a second colour.
      expect(contrastRatio(band, '#000000')).toBeLessThan(contrastRatio(colours.primary, '#000000'));
    }
  });

  it('keeps every generated pair legible in the header', () => {
    for (const colours of COLOUR_PAIRS) {
      const style = clubStyle(colours);
      for (const surface of stripeColours(colours)) {
        expect(
          contrastRatio(style['--club-ink']!, surface),
          `${colours.primary} + ${colours.secondary} on ${surface} (alpha ${stripeAlpha(colours)})`,
        ).toBeGreaterThanOrEqual(STRIPE_CONTRAST_FLOOR);
      }
      // The faded tail walks through colours neither end of the gradient
      // shows, so those have to be legible too.
      expect(stripeColours(colours).length).toBeGreaterThan(2);
    }
  });
});
