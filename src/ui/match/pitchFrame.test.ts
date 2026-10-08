import { describe, expect, it } from 'vitest';
import { facingRadians } from '@/presentation/matchPresentation';
import { attackDirection, facingIn, frameForBox, pitchPoint, type PitchFrame } from './pitchFrame';

/**
 * The rules of the turn, pinned.
 *
 * A portrait box is not a second pitch drawn sideways — it is one picture turned,
 * and these tests are about the turn itself rather than about any pixel of it:
 * the shape of the box it is asked for, where the corners land, which way round
 * it went, and that the three readings of it (a man's position, the way he is
 * running, the end his side is attacking) agree with one another. That last one
 * is the whole reason `pitchFrame` exists: a defence drawn upside down with its
 * arrow pointing the other way is worse than no turn at all.
 */

/** The frames every test that has to hold in both of them runs in. */
const BOTH: PitchFrame[] = ['landscape', 'portrait'];

/** Cosine of the smaller angle between two headings, whatever their wrapping. */
function sameHeading(a: number, b: number): number {
  return Math.cos(a - b);
}

/**
 * The heading the drawn picture actually gives a velocity, read off `pitchPoint`
 * rather than asked of `facingIn`. Going the long way round on purpose: if the
 * two functions ever stopped agreeing, this is the test that would notice, and it
 * can only notice because it works the answer out for itself.
 *
 * The screen's y grows downward and CSS rotates clockwise, so the angle of a
 * drawn offset is `atan2` of it in that order and nothing else.
 */
function drawnHeading(frame: PitchFrame, vx: number, vy: number): number {
  const step = 1e-6;
  const from = pitchPoint(0.5, 0.5, frame);
  const to = pitchPoint(0.5 + vx * step, 0.5 + vy * step, frame);
  return Math.atan2(to.top - from.top, to.left - from.left);
}

/** The heading an arrow in this direction points in, in CSS's own rotation. */
const ARROW_HEADING: Record<'up' | 'down' | 'left' | 'right', number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

describe('pitch frame', () => {
  it('draws the pitch up the screen only when the box is taller than it is wide', () => {
    expect(frameForBox({ width: 390, height: 600 })).toBe('portrait');
    expect(frameForBox({ width: 600, height: 390 })).toBe('landscape');
    // A square box is a landscape pitch: a pitch wider than it is long does not
    // exist, and one drawn across a square box still reads as football.
    expect(frameForBox({ width: 500, height: 500 })).toBe('landscape');
    // The boundary is the comparison itself rather than a ratio, so a box that is
    // taller by a single pixel is portrait rather than nearly portrait.
    expect(frameForBox({ width: 500, height: 501 })).toBe('portrait');
    expect(frameForBox({ width: 501, height: 500 })).toBe('landscape');
  });

  it('leaves a landscape box exactly as the simulation describes it', () => {
    expect(pitchPoint(0, 0, 'landscape')).toEqual({ left: 0, top: 0 });
    expect(pitchPoint(1, 0.5, 'landscape')).toEqual({ left: 1, top: 0.5 });
    expect(pitchPoint(0.25, 0.75, 'landscape')).toEqual({ left: 0.25, top: 0.75 });
    // Which is the same thing as saying the home side attacks to the right.
    expect(pitchPoint(1, 0.5, 'landscape').left).toBeGreaterThan(pitchPoint(0, 0.5, 'landscape').left);
  });

  it('turns the pitch a quarter turn, putting the home goal at the foot of the screen', () => {
    // The two goal mouths. The home goal is the x = 0 end and the away goal the
    // x = 1 end, for the whole afternoon: the simulation never changes ends.
    expect(pitchPoint(0, 0.5, 'portrait')).toEqual({ left: 0.5, top: 1 });
    expect(pitchPoint(1, 0.5, 'portrait')).toEqual({ left: 0.5, top: 0 });
    // So the side that attacks toward x = 1 attacks up the screen.
    expect(pitchPoint(1, 0.5, 'portrait').top).toBeLessThan(pitchPoint(0, 0.5, 'portrait').top);
    // And the corners, which say which way round the turn went: the pitch's own
    // left-hand touchline (y = 0, the one a home player has on his left as he
    // runs at the away goal) is drawn down the left of the screen.
    expect(pitchPoint(0, 0, 'portrait')).toEqual({ left: 0, top: 1 });
    expect(pitchPoint(1, 0, 'portrait')).toEqual({ left: 0, top: 0 });
    expect(pitchPoint(0, 1, 'portrait')).toEqual({ left: 1, top: 1 });
    expect(pitchPoint(1, 1, 'portrait')).toEqual({ left: 1, top: 0 });
    expect(pitchPoint(0.5, 0, 'portrait').left).toBe(0);
    expect(pitchPoint(0.5, 1, 'portrait').left).toBe(1);
  });

  it('is a rotation and not a mirror, in either axis', () => {
    // A rotation keeps the shape of a triangle the same way round; a mirror
    // reverses it, and a reversed pitch would hand the manager his own side
    // reflected — his right winger on the left. The signed area is the way to
    // see that without any trigonometry about it.
    const area = (frame: PitchFrame, a: [number, number], b: [number, number], c: [number, number]) => {
      const p = pitchPoint(a[0], a[1], frame);
      const q = pitchPoint(b[0], b[1], frame);
      const r = pitchPoint(c[0], c[1], frame);
      return (q.left - p.left) * (r.top - p.top) - (q.top - p.top) * (r.left - p.left);
    };
    const landscape = area('landscape', [0.2, 0.2], [0.8, 0.2], [0.2, 0.8]);
    const portrait = area('portrait', [0.2, 0.2], [0.8, 0.2], [0.2, 0.8]);
    expect(landscape).not.toBe(0);
    expect(portrait).toBeCloseTo(landscape, 12);
    // Stated as the two mirrors it is not, so the test fails if the turn is ever
    // "simplified" into a swap of x and y.
    // Stated as the two mirrors it is not: swapping the two numbers, and leaving
    // the point where it was. The turn sends this one to the bottom right.
    expect(pitchPoint(0.25, 0.75, 'portrait')).toEqual({ left: 0.75, top: 0.75 });
    expect(pitchPoint(0.25, 0.75, 'portrait')).not.toEqual({ left: 0.75, top: 0.25 });
    expect(pitchPoint(0.25, 0.75, 'portrait')).not.toEqual({ left: 0.25, top: 0.75 });
  });

  it('points a man the way the picture draws him running', () => {
    // The invariant the whole file exists for, checked the long way round: the
    // heading `facingIn` names and the heading the drawn positions actually give
    // have to be the same heading, in both frames, for every direction.
    const velocities: Array<[number, number]> = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [0.7, 0.7],
      [-0.5, 0.86],
      [0.31, -0.95],
    ];
    for (const frame of BOTH) {
      for (const [vx, vy] of velocities) {
        expect(sameHeading(facingIn(frame, vx, vy), drawnHeading(frame, vx, vy))).toBeCloseTo(1, 5);
      }
    }
  });

  it('turns a heading with the pitch, and leaves a landscape one alone', () => {
    // Across a landscape pitch, or up a portrait one, is the same run.
    expect(facingIn('landscape', 1, 0)).toBeCloseTo(facingRadians(1, 0), 12);
    expect(facingIn('landscape', -1, 0)).toBeCloseTo(Math.PI, 12);
    expect(facingIn('portrait', 1, 0)).toBeCloseTo(-Math.PI / 2, 12);
    expect(facingIn('portrait', -1, 0)).toBeCloseTo(Math.PI / 2, 12);
    // A man running at the away goal is a man running to the right in a landscape
    // box and a man running up the screen when it is turned, which is the point.
    expect(sameHeading(facingIn('portrait', 1, 0), ARROW_HEADING.up)).toBeCloseTo(1, 12);
    // A man standing still has no direction worth reporting — the renderer keeps
    // the last real one rather than writing an angle of numerical dust — but the
    // turn is applied to him all the same, which is why it is applied here rather
    // than in the renderer: one rule, both frames, whether or not it is written.
    expect(facingIn('landscape', 0, 0)).toBe(facingRadians(0, 0));
    expect(sameHeading(facingIn('portrait', 0, 0), facingRadians(0, 0) - Math.PI / 2)).toBeCloseTo(1, 12);
  });

  it('names the end each side is attacking as a direction in the box', () => {
    expect(attackDirection('landscape', 'home')).toBe('right');
    expect(attackDirection('landscape', 'away')).toBe('left');
    expect(attackDirection('portrait', 'home')).toBe('up');
    expect(attackDirection('portrait', 'away')).toBe('down');
  });

  it('agrees the arrow with the men it is drawn among', () => {
    // The arrow is a border on an empty box and the men are coordinates, so the
    // only thing tying the two together is that both read the same turn. An arrow
    // pointing at the end the home side is drawn attacking is the test of it.
    for (const frame of BOTH) {
      const home = drawnHeading(frame, 1, 0);
      expect(sameHeading(ARROW_HEADING[attackDirection(frame, 'home')], home)).toBeCloseTo(1, 5);
      const away = drawnHeading(frame, -1, 0);
      expect(sameHeading(ARROW_HEADING[attackDirection(frame, 'away')], away)).toBeCloseTo(1, 5);
      // And the two opposite ends really are opposite, in both frames.
      expect(attackDirection(frame, 'home')).not.toBe(attackDirection(frame, 'away'));
    }
  });
});
