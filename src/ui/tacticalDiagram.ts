import type { CSSProperties } from 'react';
import { KEEPER_ACROSS, KEEPER_LINE, type FormationSlot } from '@/domain/positions';
import type { Tactics } from '@/domain/tactics';

export type DiagramPhase = 'shape' | 'with-ball' | 'without-ball';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

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
  return { x: clamp(x, 0.13, 0.88), y: clamp(y, 0.1, 0.9) };
}

/**
 * The football point under a pointer, in the pitch's own coordinates.
 *
 * The exact inverse of `diagramStyle`, because a drag has to go both ways: the
 * dot is drawn *from* football coordinates and the drop is read *from* pixels,
 * and if the two mappings disagreed the dot would drift away from the finger
 * that was holding it. Both directions are affine for that reason — the spread
 * that keeps the labels apart is a scale, so inverting it is exact.
 */
export function pitchPointAt(
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  // The same clamps the drawing applies, in the same order: a drop at the very
  // edge of the picture has to leave the dot where the picture can actually
  // draw it, or the manager would let go and watch it slide out from under his
  // finger. The deepest outfield row is `x = 0.13`, so the bottom of the pitch
  // is the defensive line rather than the goal line.
  const across = clamp((clientX - box.left) / box.width, 0.09, 0.91);
  const depth = clamp((clientY - box.top) / box.height, 0.148, 0.7634);
  return { x: clamp((0.87 - depth) / 0.82, 0.13, 0.88), y: clamp(0.5 + (across - 0.5) / 1.3, 0.1, 0.9) };
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
  const across = clamp(0.5 + (position.y - 0.5) * 1.3, 0.09, 0.91);
  const depth = position.x <= 0.05 ? 0.94 : 0.87 - position.x * 0.82;
  return { left: across, top: depth };
}

/** Portrait on every preparation screen; spread labels without altering football data. */
export function diagramStyle(position: { x: number; y: number }): CSSProperties {
  const across = clamp(0.5 + (position.y - 0.5) * 1.3, 0.09, 0.91);
  const depth = position.x <= 0.05 ? 0.94 : 0.87 - position.x * 0.82;
  return { '--shape-left': `${across * 100}%`, '--shape-top': `${depth * 100}%` } as CSSProperties;
}
