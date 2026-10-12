import type { MatchSurface } from '@/domain/match';
import { pitchPoint, type PitchFrame } from './pitchFrame';

/**
 * What the grass is painted with, from the ground's own reading of itself.
 *
 * The pitch used to be one flat green whatever the afternoon was: the condition
 * was printed in the header — *Overcast · Muddy pitch* — while the picture under
 * it showed the same surface in a July friendly and a February league game. A
 * manager picks his football around a heavy pitch, and the one screen where he is
 * standing on it said nothing about it at all.
 *
 * So this is the surface as paint, and it is deliberately a *reading* rather than
 * a simulation: everything here comes off {@link MatchSurface} — the day's
 * verdict the engine played by, the surface the ground actually is, the ground's
 * own 1-20 of grass and how far into its next point of wear it has been played —
 * and nothing here decides how the ball behaves. The engine's numbers do that,
 * and they are already charged (`tacticsModel`). Two vocabularies rather than one
 * because they answer different questions: the tone is *what the surface is like*
 * (a cinder pitch is not grass, a frozen one is not simply a poor one) and the
 * patches are *what has happened to it* (grass gone in the goalmouths, water
 * lying on it, a winter of studs through the middle).
 *
 * Three rules, which are the whole design:
 *
 *  1. **The day beats the ground.** Mud, standing water and frost are what the
 *     afternoon is like, so they name the tone whatever the quality is. Below
 *     that the surface's own kind comes first — a 3G pitch never goes bald and a
 *     cinder one was never green — and only then the verdict among grass.
 *  2. **The ground decides how much grass is left.** `quality` is the number the
 *     club's own work moves, so it is what the bald patches are counted from: a
 *     pitch re-laid in October has grass in the goalmouths in November, and the
 *     one beside it does not. That is the whole visible payoff of a £980 job.
 *  3. **The wear is the upkeep, drawn.** `scuff` is nought while the club is
 *     paying for the ground to be looked after and grows with the football played
 *     when it is not, so the £9 a week is the difference between a pitch that
 *     looks cut and one that is being cut up — which is the only way a manager
 *     ever *sees* what he is paying for.
 *
 * Free of React and of the DOM, like `pitchFrame`: the reading is the part worth
 * testing and `MatchPitch` is the part that has to run in a browser.
 */

/** The surface as one word, and the stylesheet's hook for painting it. */
export type SurfaceTone =
  /** Grass with the mow still on it. */
  | 'lush'
  /** Grass holding up, the ordinary Sunday. */
  | 'fair'
  /** Grass going thin on top — the winter's own surface. */
  | 'thin'
  /** Cutting up: mud, clods and the ball sitting up in it. */
  | 'heavy'
  /** Standing water lying on it. */
  | 'flooded'
  /** Frozen underfoot. */
  | 'frozen'
  /** An artificial pitch: even, bright and never bald. */
  | 'artificial'
  /** Cinder: no grass at all, and no mud either. */
  | 'cinder';

/** What a patch of the surface is: grass gone, mud, water or frost. */
export type SurfaceMark = 'bare' | 'mud' | 'water' | 'frost';

/** One mark on the grass, in the pitch's own coordinates. */
export interface SurfacePatch {
  /** Along the pitch, 0 at the home goal line and 1 at the away one. */
  x: number;
  /** Across it, 0 at one touchline and 1 at the other. */
  y: number;
  /** Half the patch, measured along the pitch. */
  rx: number;
  /** Half the patch, measured across it. */
  ry: number;
  mark: SurfaceMark;
}

export interface SurfaceLook {
  tone: SurfaceTone;
  /**
   * The ink the mown bands are painted at, 0..1.
   *
   * A number rather than a class because it is a *strength*: a pitch with the
   * mow on it shows the bands, a wet one shows them faintly, and a 3G or cinder
   * pitch has nothing to mow at all. It is handed to the stylesheet as the alpha
   * of one gradient stop (`--mow-ink`), so the bands are one layer of paint on the
   * grass rather than a second surface under it.
   */
  mowInk: number;
  patches: SurfacePatch[];
}

/**
 * Where grass goes first, worst place first.
 *
 * Football's own order rather than a scatter of random ellipses, and it is the
 * reason the picture is worth drawing at all: the six-yard boxes are cut up by
 * every goal kick and every keeper's landing, the centre spot by every kick-off,
 * the touchline the benches stand behind by every throw-in, and the rest of the
 * pitch is barely touched. So the marks arrive in that order as a surface gets
 * worse, and a pitch with one patch on it has that patch in a goalmouth.
 *
 * Deterministic on purpose. A patch that moved between one frame and the next
 * would be a pitch rearranging itself sixty times a second, and a picture drawn
 * from a random seed per render is a picture nobody can test.
 */
const WORN_PLACES: ReadonlyArray<{ x: number; y: number; rx: number; ry: number }> = [
  // The two six-yard boxes: the home end first, then the away end.
  { x: 0.1, y: 0.32, rx: 0.055, ry: 0.075 },
  { x: 0.1, y: 0.68, rx: 0.055, ry: 0.075 },
  { x: 0.9, y: 0.32, rx: 0.055, ry: 0.075 },
  { x: 0.9, y: 0.68, rx: 0.055, ry: 0.075 },
  // The centre spot, where every kick-off of the afternoon is taken.
  { x: 0.5, y: 0.5, rx: 0.045, ry: 0.06 },
  // The touchline the benches are on, and the one the linesman runs.
  { x: 0.3, y: 0.08, rx: 0.07, ry: 0.035 },
  { x: 0.7, y: 0.92, rx: 0.07, ry: 0.035 },
  // The edges of the two penalty areas, where the game is turned round.
  { x: 0.18, y: 0.5, rx: 0.045, ry: 0.05 },
  { x: 0.82, y: 0.5, rx: 0.045, ry: 0.05 },
  // The flanks at halfway, which take a season to show anything at all.
  { x: 0.5, y: 0.12, rx: 0.06, ry: 0.04 },
  { x: 0.5, y: 0.88, rx: 0.06, ry: 0.04 },
];

/** At most this many marks, so the picture stays a pitch rather than a map. */
const MOST_MARKS = 6;

/**
 * How strongly the mown bands show on each kind of surface.
 *
 * The strength is the surface's own: a pitch cut this morning has a fresh band
 * across it, a wet one has the bands flattened out of it by the water, and an
 * artificial or cinder surface has none because there is no grass on it to mow.
 * The tone's own gradient carries the colour — the bands are the ink on top of
 * it, not a second field underneath.
 */
const MOW_INK: Record<SurfaceTone, number> = {
  lush: 0.05,
  fair: 0.035,
  thin: 0.022,
  heavy: 0.014,
  flooded: 0.012,
  frozen: 0.008,
  artificial: 0,
  cinder: 0,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * What the surface is like, from the day's verdict on it.
 *
 * Mud, water and frost are the afternoon and outrank everything: a cinder pitch
 * in a downpour has water lying on it, and drawing it as grey and dry because it
 * is not grass would be a lie about the game being played on it. Below those, the
 * kind of surface decides — nothing is ever mown on 3G or cinder — and last of
 * all the verdict among grass, which is the only place `quality` shows through as
 * a word.
 */
export function surfaceToneOf(surface: MatchSurface): SurfaceTone {
  if (surface.condition === 'waterlogged') return 'flooded';
  if (surface.condition === 'frozen') return 'frozen';
  if (surface.condition === 'muddy') return 'heavy';
  if (surface.surface === '3G') return 'artificial';
  if (surface.surface === 'cinder') return 'cinder';
  if (surface.condition === 'worn') return 'thin';
  return surface.condition === 'excellent' ? 'lush' : 'fair';
}

/** How bald a ground of this quality is, 0..1. A 15 is holding, a 5 is not. */
function barenessOf(quality: number): number {
  return clamp01((15 - quality) / 11);
}

/**
 * The grass as the picture should paint it.
 *
 * The marks arrive in the order football wears a pitch, they are counted from
 * the ground's own quality and its wear, and every surface that cannot mark up —
 * an artificial pitch, a cinder one — is given none of them at all. A pitch that
 * nobody has played on and nobody has worked on is given none either, which is
 * what makes the drawing *information*: a green field with nothing on it is a
 * ground with nothing wrong with it.
 */
export function pitchSurfaceLook(surface: MatchSurface): SurfaceLook {
  const tone = surfaceToneOf(surface);
  const patches: SurfacePatch[] = [];
  const add = (mark: SurfaceMark, count: number): void => {
    for (let index = 0; index < count && patches.length < MOST_MARKS; index += 1) {
      const place = WORN_PLACES[patches.length % WORN_PLACES.length]!;
      patches.push({ ...place, mark });
    }
  };

  // Two kinds of mark, and only one of them needs grass. Water lies on a 3G
  // pitch and frost gets into a cinder one, so those two are drawn whatever the
  // surface is; bare grass and poached mud are grass *loss*, and a surface that
  // never had any grass cannot lose it — an artificial pitch is not drawn as
  // going bald, however bad the day.
  const hasGrass = surface.surface === 'grass' || surface.surface === 'grass (uneven)';
  const worn = (mark: SurfaceMark, count: number): void => {
    add(mark === 'bare' || mark === 'mud' ? (hasGrass ? mark : 'water') : mark, count);
  };

  // The day's own weather first, because it is what the afternoon *is*.
  if (tone === 'flooded') worn('water', 3);
  else if (tone === 'heavy') worn('mud', 3);
  else if (tone === 'frozen') worn('frost', 2);
  else if (hasGrass) add('bare', Math.round(barenessOf(surface.quality) * 4));

  // Then the winter: the football played since anybody last looked at it. Muddy
  // where there is already mud to be made, bare where there is not.
  worn(tone === 'heavy' || tone === 'flooded' ? 'mud' : 'bare', Math.round(clamp01(surface.scuff) * 2));

  // An uneven pitch is an uneven pitch whatever its quality: one more place
  // where the grass has gone and the ball will not run true.
  if (surface.surface === 'grass (uneven)') add('bare', 1);

  return { tone, mowInk: MOW_INK[tone], patches };
}

/**
 * Where a mark lands in the box, in the frame the picture is currently drawn in.
 *
 * The places are in the pitch's own coordinates — along the length and across it
 * — so they turn with everything else when the box comes out portrait, through
 * the same `pitchPoint` the men and the ball go through: a goalmouth is at the
 * left of a landscape pitch and at the foot of a portrait one, and a mark that
 * stayed put would be a mark on a pitch nobody is playing on. The two radii swap
 * with the turn, for the same reason.
 *
 * Fractions of the surface rather than pixels, because the picture is drawn at
 * whatever size the box turns out to be.
 */
export function patchBox(
  patch: SurfacePatch,
  frame: PitchFrame,
): { left: number; top: number; width: number; height: number } {
  const centre = pitchPoint(patch.x, patch.y, frame);
  const width = (frame === 'portrait' ? patch.ry : patch.rx) * 2;
  const height = (frame === 'portrait' ? patch.rx : patch.ry) * 2;
  return { left: centre.left - width / 2, top: centre.top - height / 2, width, height };
}
