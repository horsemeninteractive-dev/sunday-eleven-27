import type { CSSProperties } from 'react';
import { KEEPER_ACROSS, KEEPER_LINE, OUTFIELD_LINE, type FormationSlot } from '@/domain/positions';
import type { Tactics } from '@/domain/tactics';

export type DiagramPhase = 'shape' | 'with-ball' | 'without-ball';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * The pitch box, as fractions of its own width and height.
 *
 * The picture is portrait — attacking up the screen — so one football position
 * becomes one place on it through two scales and a handful of floors, and both
 * the drawing of a dot and the reading of a drop off the picture are written
 * from these numbers rather than from literals, because a drawing and a rule
 * that disagree is how a dot ends up somewhere the manager did not put it. The
 * outfield rows run from `DEPTH_TOP` at the far end down to
 * `DEPTH_OF_DEEPEST_ROW` at the six-yard line; the keeper's own row sits behind
 * that, which is what gives him the goalmouth to himself.
 */
const DEPTH_TOP = 0.148;
const DEPTH_AT_GOAL_LINE = 0.87;
const DEPTH_SPAN = 0.82;
const KEEPER_ROW = 0.94;
const ACROSS_MIN = 0.09;
const ACROSS_MAX = 0.91;
const ACROSS_SPREAD = 1.3;
/** The deepest outfield row, as a fraction of the picture's height. */
const DEPTH_OF_DEEPEST_ROW = DEPTH_AT_GOAL_LINE - OUTFIELD_LINE * DEPTH_SPAN;

/** How close a drop has to be to a shirt to count as being *on* it. */
export const SHIRT_REACH = { left: 0.07, top: 0.035 } as const;

/** Where a football point sits across the pitch, as a fraction of the width. */
const acrossFraction = (y: number) => clamp(0.5 + (y - 0.5) * ACROSS_SPREAD, ACROSS_MIN, ACROSS_MAX);

/**
 * Where a football point sits up the picture, as a fraction of the height.
 *
 * A point on the keeper's own line, or behind it, is on the keeper's row rather
 * than on the outfield scale: he is the one man whose row is not a place in the
 * outfield, and saying so by name is what keeps the deepest defender off the top
 * of him.
 */
const depthFraction = (x: number) => (x <= KEEPER_LINE ? KEEPER_ROW : DEPTH_AT_GOAL_LINE - x * DEPTH_SPAN);

/** The football point for a place on the picture: the inverse of the two above. */
const footballAcross = (across: number) => clamp(0.5 + (across - 0.5) / ACROSS_SPREAD, 0.1, 0.9);
const footballDepth = (depth: number) => clamp((DEPTH_AT_GOAL_LINE - depth) / DEPTH_SPAN, OUTFIELD_LINE, 0.88);

/** An illustrative instruction diagram, never input to Touchline or a live position. */
export function diagramPosition(slot: FormationSlot, tactics?: Tactics, phase: DiagramPhase = 'shape') {
  // The keeper is drawn on his own line, in the row behind the defence, and
  // only his place across the goal is his: moving him is not adapting him to a
  // zone, and drawing him from the same numbers the rule clamps to means the
  // dot he was dropped at is the dot that is drawn.
  if (slot.position === 'GK') return { x: KEEPER_LINE, y: clamp(slot.y, KEEPER_ACROSS[0], KEEPER_ACROSS[1]) };
  let x = slot.x;
  let y = slot.y;
  if (tactics && phase !== 'shape') {
    const mentality = { 'very-defensive': -0.07, defensive: -0.035, balanced: 0, attacking: 0.035, 'very-attacking': 0.07 }[tactics.mentality];
    const line = { deep: -0.08, standard: 0, high: 0.08 }[tactics.defensiveLine];
    x += mentality * (slot.x > 0.35 ? 1.3 : 1) + line;
    x += phase === 'with-ball' ? 0.035 : -0.035;
    const width = phase === 'with-ball'
      ? ({ wide: 1.15, balanced: 1, central: 0.8 }[tactics.attackingFocus] - (tactics.passingStyle === 'short' ? 0.05 : 0))
      : 0.86;
    y = 0.5 + (slot.y - 0.5) * width;
  }
  return { x: clamp(x, OUTFIELD_LINE, 0.88), y: clamp(y, 0.1, 0.9) };
}

/**
 * The football point under a pointer, in the pitch's own coordinates.
 *
 * The exact inverse of `diagramStyle`, because a drag has to go both ways: the
 * dot is drawn *from* football coordinates and the drop is read *from* pixels,
 * and if the two mappings disagreed the dot would drift away from the finger
 * that was holding it. Both directions are affine for that reason — the spread
 * that keeps the labels apart is a scale, so inverting it is exact.
 *
 * The floors are the deepest row an outfield man may hold and the highest row
 * the picture has, so the bottom of the pitch is the six-yard line rather than
 * the goal line — and the row behind the six-yard line is the keeper's, which is
 * why aiming at *him* is not done through this mapping at all: see
 * `pitchPointerFraction` and `nearestDrawnSlot`.
 */
export function pitchPointAt(
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const across = clamp((clientX - box.left) / box.width, ACROSS_MIN, ACROSS_MAX);
  const depth = clamp((clientY - box.top) / box.height, DEPTH_TOP, DEPTH_OF_DEEPEST_ROW);
  return { x: footballDepth(depth), y: footballAcross(across) };
}

/**
 * Where a pointer is on the picture, as fractions of the pitch box.
 *
 * The same space `diagramFraction` speaks in, and the same space the dots are
 * placed in with `--shape-left` and `--shape-top`, and deliberately *not* the
 * space `pitchPointAt` speaks in. That one floors a point into the rows a dot
 * may stand in, and the keeper does not stand in one of those — he has a row of
 * his own, on the goal line, behind the deepest defender. A shirt is chosen by
 * aiming at it, so the row has to be reachable by a finger even though there is
 * no zone in front of goal that makes anybody a goalkeeper.
 */
export function pitchPointerFraction(
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { left: number; top: number } {
  return { left: (clientX - box.left) / box.width, top: (clientY - box.top) / box.height };
}

/**
 * Where a football point is drawn, as fractions of the pitch box.
 *
 * The same mapping as `diagramStyle`, in numbers rather than CSS, so a drop can
 * be matched to the nearest dot in the space the manager is actually looking at
 * — the drawing stretches the pitch across, and measuring in football
 * coordinates instead would make the nearest dot depend on the stretch.
 */
export function diagramFraction(position: { x: number; y: number }): { left: number; top: number } {
  return { left: acrossFraction(position.y), top: depthFraction(position.x) };
}

/**
 * The shirt nearest a place on the picture, and how far off it that place is.
 *
 * A drop is a place on a picture rather than a position on a pitch, which is why
 * this is asked in the drawn space: the picture stretches the pitch across, so
 * the nearest shirt would otherwise depend on the stretch — and, worse, the
 * football mapping floors a point into the rows a dot may stand in, so the
 * keeper's shirt, which is in a row of its own, could never be the nearest to
 * anything. Both axes are reported as well as the straight-line distance,
 * because a reach that is generous up the screen is mean across it.
 */
export function nearestDrawnSlot(
  place: { left: number; top: number },
  slots: readonly FormationSlot[],
): { index: number; dx: number; dy: number; distance: number } {
  let best = { index: -1, dx: Number.POSITIVE_INFINITY, dy: Number.POSITIVE_INFINITY, distance: Number.POSITIVE_INFINITY };
  slots.forEach((slot, index) => {
    const drawn = diagramFraction(diagramPosition(slot));
    const dx = drawn.left - place.left;
    const dy = drawn.top - place.top;
    const distance = Math.hypot(dx, dy);
    if (distance < best.distance) best = { index, dx, dy, distance };
  });
  return best;
}

/**
 * Whether a drop landed *on* the nearest shirt rather than merely beside it.
 *
 * The reach is roughly the footprint of the dot itself, and it is deliberately
 * far short of half the gap between the two closest shirts on any formation, so
 * that no drop is ever within reach of two men: a manager either aimed at a man
 * or he did not, and dropping a defender into the space between two of them is
 * still a move rather than a swap with whichever he happened to be nearer.
 */
export function onShirt(drop: { index: number; dx: number; dy: number }): boolean {
  return drop.index >= 0 && Math.abs(drop.dx) <= SHIRT_REACH.left && Math.abs(drop.dy) <= SHIRT_REACH.top;
}

/** Portrait on every preparation screen; spread labels without altering football data. */
export function diagramStyle(position: { x: number; y: number }): CSSProperties {
  const { left, top } = diagramFraction(position);
  return { '--shape-left': `${left * 100}%`, '--shape-top': `${top * 100}%` } as CSSProperties;
}
