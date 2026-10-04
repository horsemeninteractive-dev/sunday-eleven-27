import type {
  BallState,
  FieldZone,
  LineHeights,
  Match,
  MatchFieldState,
  MatchPhase,
  TeamShape,
} from '@/domain/match';
import type { MatchContext, Side } from './core';
import { otherSide } from './core';

/**
 * The football pitch, as the simulation understands it.
 *
 * Not a picture — the watched match has its own, much richer, spatial state for
 * that. This is the small working model the *decisions* are made from: where the
 * ball is, how each side is standing, and how hard each is pressing. A pass is
 * risky because of where it is going and who is closing, and that has to be
 * knowable without drawing anything.
 *
 * One frame throughout: the home side always attacks toward x = 1. The away side
 * therefore attacks toward x = 0, and every helper here takes a side so a caller
 * never has to remember which way round it is. Progress is always measured from
 * the possessing side's own goal, so "0.8" means something in the final third
 * whoever has the ball.
 */

/** How far up the pitch a team's three lines sit, from its own goal (0) to theirs (1). */
const LINE_HEIGHT = {
  deep: { back: 0.15, middle: 0.33, front: 0.55 },
  standard: { back: 0.24, middle: 0.44, front: 0.67 },
  high: { back: 0.35, middle: 0.54, front: 0.78 },
} as const;

const PRESS_FACTOR = { low: 0.15, medium: 0.5, high: 1 } as const;

/**
 * The deepest a back line may sit, measured in progress from its own goal.
 *
 * A back four drops toward its own goal when the ball is deep, but it never
 * stands *on* the line: the men are still in front of the keeper, with a six-yard
 * box between them and the net. Without this floor a deep line plus the own-third
 * retreat drove the back four to progress ~0 — literally behind the goalkeeper —
 * which is not a defensive line, it is a second keeper.
 */
const DEFENSIVE_BACK_FLOOR = 0.1;

/** How far a manager's mentality shifts the block, keyed by mentality. */
const MENTALITY_SHIFT: Record<string, number> = {
  'very-defensive': -0.07,
  defensive: -0.035,
  balanced: 0,
  attacking: 0.035,
  'very-attacking': 0.075,
};

/**
 * The lines every side is drawn against, so a formation slot can be said to
 * belong to one of them.
 *
 * A slot's position on the pitch is fixed by the formation, but the *lines* move
 * with the ball, so a slot cannot simply be pinned to a line by its own x. It is
 * assigned to whichever line it is nearest here, and keeps its offset from that
 * line. That is what makes a back four move as a back four: all four are
 * measured from the same reference and then carried together by the live heights,
 * rather than each being nudged independently toward the ball.
 */
export const REFERENCE_LINES: LineHeights = { back: 0.24, middle: 0.44, front: 0.67 };

/** The line a slot belongs to, and how far off that line it sits. */
export function lineSlotFor(progress: number): { line: keyof LineHeights; offset: number } {
  const options: Array<[keyof LineHeights, number]> = [
    ['back', REFERENCE_LINES.back],
    ['middle', REFERENCE_LINES.middle],
    ['front', REFERENCE_LINES.front],
  ];
  let best = options[0]!;
  let bestGap = Infinity;
  for (const option of options) {
    const gap = Math.abs(progress - option[1]);
    if (gap < bestGap) {
      bestGap = gap;
      best = option;
    }
  }
  return { line: best[0], offset: progress - best[1] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** The goal a side is attacking, in the fixed frame. */
export function goalX(side: Side): number {
  return side === 'home' ? 1 : 0;
}

/** The goal a side is defending, in the fixed frame. */
export function ownGoalX(side: Side): number {
  return side === 'home' ? 0 : 1;
}

/** A player's own rectory: 0 at his own goal line, 1 at the one he attacks. */
export function progressOf(side: Side, x: number): number {
  return side === 'home' ? x : 1 - x;
}

/** Turn a progress value back into a fixed-frame x. */
export function xFromProgress(side: Side, progress: number): number {
  return side === 'home' ? progress : 1 - progress;
}

export function zoneOf(side: Side, x: number): FieldZone {
  const progress = progressOf(side, x);
  if (progress < 0.12) return 'own-box';
  if (progress < 0.34) return 'own-third';
  if (progress < 0.66) return 'middle';
  if (progress < 0.84) return 'final-third';
  return 'box';
}

/** The phase a side in possession is in, read straight off where the ball is. */
export function phaseForZone(zone: FieldZone): MatchPhase {
  switch (zone) {
    case 'own-box':
    case 'own-third':
      return 'build-up';
    case 'middle':
      return 'progression';
    case 'final-third':
      return 'final-third';
    case 'box':
      return 'chance';
  }
}

/** Roughly how much a field position is worth: own box is dangerous, the box is not. */
export function dangerOf(zone: FieldZone): number {
  switch (zone) {
    case 'own-box':
      return 0.85;
    case 'own-third':
      return 0.45;
    case 'middle':
      return 0.15;
    case 'final-third':
      return 0.3;
    case 'box':
      return 0.95;
  }
}

/** Which third of the pitch the ball is in, as a key into the shape. */
export type ShapeThird = 'ownThird' | 'middle' | 'finalThird';

/**
 * The third the ball is in, read from its progress along the pitch.
 *
 * The boundary between the final third and the box is deliberately not one:
 * `zoneOf` splits five ways for the decision model, but a block does not change
 * shape at the edge of the penalty area, it changes shape when the ball crosses
 * into the last third of the field. Two of the decision model's zones therefore
 * share one shape key, which is correct — the shape is coarser than the
 * decision, and pretending otherwise is what made the old single set of line
 * heights wrong in the first place.
 */
export function thirdFor(progress: number): ShapeThird {
  if (progress < 0.34) return 'ownThird';
  if (progress < 0.66) return 'middle';
  return 'finalThird';
}

function heights(back: number, middle: number, front: number): LineHeights {
  return { back: clamp01(back), middle: clamp01(middle), front: clamp01(front) };
}

/**
 * How a side is standing right now.
 *
 * The shape is a function of two things at once — where the ball is and who has
 * it — so this returns a whole *set* of shapes rather than one. A side does not
 * have a single arrangement it holds all match; it has an arrangement it holds
 * when the ball is in its own third, another when it is in the final third, and
 * another for each of those again when it is defending rather than attacking.
 * Reading the live one out of the set is {@link linesFor}'s job.
 *
 * What fills the table is still the manager's instructions, read exactly as
 * before: the defensive line sets the base heights, mentality shifts the block,
 * and pressing, attacking focus and passing style set how the block is spread.
 * What has changed is that those numbers are now applied to six arrangements
 * instead of averaged into one, so a side deep in its own third with the ball
 * and a side camped in the opposition box are described separately rather than
 * by whichever number falls out of averaging them together.
 */
export function shapeFor(
  context: MatchContext,
  side: Side,
  options: { inPossession: boolean; energy: number; urgency: number },
): TeamShape {
  const sideContext = context[side];
  const tactics = sideContext.tactics;
  const base = LINE_HEIGHT[tactics.defensiveLine];

  // Mentality is the manager's appetite: it shifts the whole block up or down,
  // and it shifts the front of the block more than the back, which is what makes
  // an attacking side commit men forward rather than simply stand further up.
  const shift = MENTALITY_SHIFT[tactics.mentality] ?? 0;

  // Chasing a game lifts even a defensive side; protecting a lead late drops it.
  const urgency = options.urgency;

  // Tired legs cannot hold a high line for ninety minutes.
  const legs = clamp01((options.energy - 35) / 65);
  const fatigueBack = -(1 - legs) * 0.05;
  const fatigueMiddle = -(1 - legs) * 0.04;

  /**
   * One arrangement, built from the base plus every adjustment.
   *
   * The three arguments are the situational part, and they are what the six
   * entries vary: how far the block has stepped up toward the ball, how far it
   * has dropped away from it, and how much a side without the ball gets back
   * into its own half.
   */
  const build = (push: number, retreat: number): LineHeights =>
    heights(
      // A back line retreats toward its own goal but is held off the line, so
      // even a side camped on its own six-yard box still has a defensive line in
      // front of the keeper rather than standing on the goal line behind him.
      Math.max(DEFENSIVE_BACK_FLOOR, base.back + shift + urgency * 0.06 + fatigueBack + push + retreat),
      base.middle + shift * 1.15 + urgency * 0.08 + fatigueMiddle + push + retreat * 1.15,
      base.front + shift * 1.3 + urgency * 0.07 + push * 0.9,
    );

  // Possession, in both directions, for each third the ball can be in.
  //
  // The asymmetry is the point and it is small enough to be missed: a side with
  // the ball steps *up* to meet it — pushing toward the ball's own third, and by
  // more in the opposition half than in its own, because a side building from// the back is not trying to win the ball back. A side without it steps *down
  // and away*, and again more the closer the ball is to its own goal, which is
  // the entire reason a defence in front of its own box is deeper than a
  // defence in front of the halfway line.
  const inPossession: Record<ShapeThird, LineHeights> = {
    ownThird: build(-0.04, 0),
    middle: build(0.02, 0),
    finalThird: build(0.12, 0),
  };
  const defending: Record<ShapeThird, LineHeights> = {
    ownThird: build(-0.15, -0.04),
    middle: build(-0.06, -0.02),
    // Deep in the opposition half a side still steps up a little rather than
    // dropping, because the ball is closer to the goal it is attacking than to
    // the one it is defending — but it steps up *less* than the side that has
    // the ball, which is what makes the difference between the two something a
    // test can hold onto.
    finalThird: build(0.02, 0),
  };

  // Orientation is how hard the block leans across the pitch toward the ball.
  //
  // It reads from the instructions in two separate ways, and both are real. A
  // side told to attack wide orients more, because it is trying to get the ball
  // to a flank rather than to the middle. A side told to press hard orients
  // more, because pressing means hunting the ball and you cannot hunt sideways
  // unless you are already turned that way.
  let ballOrientation = 0.3;
  if (tactics.attackingFocus === 'wide') ballOrientation += 0.22;
  if (tactics.attackingFocus === 'central') ballOrientation -= 0.16;
  ballOrientation += PRESS_FACTOR[tactics.pressing] * 0.18;
  if (!options.inPossession) ballOrientation += 0.1;

  // Compactness and width are now each two numbers, because a side in possession
  // and the same side out of it are not the same shape at all: with the ball a
  // side spreads out and takes up more of the pitch, and without it the block
  // closes down and narrows. The old model had one number for each and had to
  // average, which is why a side defending a lead still looked as expansive as
  // one building an attack.
  let compactnessBase = 0.45 + PRESS_FACTOR[tactics.pressing] * 0.2;
  if (tactics.mentality === 'very-defensive' || tactics.mentality === 'defensive') compactnessBase += 0.1;

  let widthBase = 0.62;
  if (tactics.attackingFocus === 'wide') widthBase += 0.16;
  if (tactics.attackingFocus === 'central') widthBase -= 0.18;
  if (tactics.passingStyle === 'short') widthBase -= 0.04;

  const compactness = {
    // A side with the ball is not a block at all, and it covers more ground to
    // prove it.
    inPossession: clamp01(compactnessBase - 0.12),
    outOfPossession: clamp01(compactnessBase + 0.06),
  };
  const width = {
    inPossession: clamp01(widthBase + 0.1),
    outOfPossession: clamp01(widthBase - 0.04),
  };

  return {
    lines: { ownThird: inPossession.ownThird, middle: inPossession.middle, finalThird: inPossession.finalThird, defending },
    ballOrientation: clamp01(ballOrientation),
    compactness,
    width,
  };
}

/**
 * The arrangement a side is actually holding, given the ball and who has it.
 *
 * Everything downstream reads the shape through this rather than reaching into
 * `lines` itself, because the choice between the six is the whole model: it is
 * what makes the same side look different at the two ends of the pitch.
 */
/**
 * The arrangement a side is actually holding, given the ball and who has it.
 *
 * The table is keyed by third, but the *read* of it is interpolated. That
 * distinction is the whole difference between a shape and a twitch: snapping to
 * the nearest third means a ball nudged two inches across a boundary moves all
 * twenty-two men a visible distance on one frame, and the block jumps rather than
 * travels. Interpolating means the block slides continuously between
 * arrangements, so a turnover reads as a team shifting rather than a diagram
 * being redrawn.
 *
 * The blend is linear between the two nearest thirds and flat beyond them, which
 * is what "the shape is coarser than the decision" means in practice — the block
 * has three arrangements and everything between them is somewhere on the way.
 */
export function linesFor(shape: TeamShape, options: { inPossession: boolean; progress: number }): LineHeights {
  const table = options.inPossession ? shape.lines : shape.lines.defending;
  const progress = options.progress;
  const order: ShapeThird[] = ['ownThird', 'middle', 'finalThird'];
  const bounds = [0.34, 0.66];

  // Outside the two boundaries the arrangement is simply the nearest one.
  if (progress <= bounds[0]!) return table.ownThird;
  if (progress >= bounds[1]!) return table.finalThird;

  // Between them: blend the two arrangements by how far across the band the ball
  // has gone. At the midpoint the block is exactly halfway between the two.
  const span = bounds[1]! - bounds[0]!;
  const t = (progress - bounds[0]!) / span;
  const from = table[order[0]!];
  const to = table[order[1]!];
  return {
    back: from.back + (to.back - from.back) * t,
    middle: from.middle + (to.middle - from.middle) * t,
    front: from.front + (to.front - from.front) * t,
  };
}

/** How wide the side is currently spread, given the ball. */
export function widthFor(shape: TeamShape, inPossession: boolean): number {
  return inPossession ? shape.width.inPossession : shape.width.outOfPossession;
}

/** How tightly the side is currently packed, given the ball. */
export function compactnessFor(shape: TeamShape, inPossession: boolean): number {
  return inPossession ? shape.compactness.inPossession : shape.compactness.outOfPossession;
}

/** How hard a side is pressing, 0..1, from its instructions and its legs. */
export function pressureFor(context: MatchContext, side: Side, options: { energy: number; inPossession: boolean }): number {
  const tactics = context[side].tactics;
  const strength = context[side].strength;
  let pressure = 0.2 + PRESS_FACTOR[tactics.pressing] * 0.45;
  pressure += (strength.aggression - 1) * 0.22;
  pressure += (strength.organisation - 1) * 0.3;
  if (!options.inPossession) pressure += 0.12;
  else pressure -= 0.18;
  pressure *= 0.7 + 0.3 * clamp01(options.energy / 100);
  return clamp01(pressure);
}

/** How aggressively a side chases a result, from the scoreline and the clock. */
export function urgencyFor(side: Side, options: { minute: number; goalDifference: number }): number {
  const { minute, goalDifference } = options;
  const late = clamp01((minute - 55) / 35);
  // A home side chasing a game gets a little more of a push from the crowd; a
  // side protecting a lead sits in a little harder.
  const crowd = side === 'home' ? 1.12 : 1;
  if (goalDifference > 0) return -0.5 * late * clamp01(goalDifference / 2) * crowd;
  if (goalDifference < 0) return 0.9 * late * clamp01(-goalDifference / 2) * crowd;
  return 0;
}

export function createBall(x = 0.5, y = 0.5): BallState {
  return { x, y, possessionSide: null, possessionPlayerId: null };
}

/**
 * Build the field state from what the match already holds.
 *
 * A save written before the simulation kept a field is given one the first time
 * it is needed — a centre ball and two shapes read off the tactics — so nothing
 * has to be versioned for it.
 */
export function ensureField(match: Match, context: MatchContext): MatchFieldState {
  if (match.field) return match.field;
  const energy = (side: Side): number => {
    let total = 0;
    let count = 0;
    for (const slot of match.lineups[side].starting) {
      const performance = match.performances[slot.playerId];
      if (!performance) continue;
      total += performance.energy;
      count += 1;
    }
    return count === 0 ? 100 : total / count;
  };
  const field: MatchFieldState = {
    ball: createBall(),
    homeShape: shapeFor(context, 'home', { inPossession: false, energy: energy('home'), urgency: 0 }),
    awayShape: shapeFor(context, 'away', { inPossession: false, energy: energy('away'), urgency: 0 }),
    pressure: { home: 0.5, away: 0.5 },
    phase: 'kickoff',
    counterPress: { home: 0, away: 0 },
  };
  match.field = field;
  return field;
}

export function shapeForSide(field: MatchFieldState, side: Side): TeamShape {
  return side === 'home' ? field.homeShape : field.awayShape;
}

export function setShape(field: MatchFieldState, side: Side, shape: TeamShape): void {
  if (side === 'home') field.homeShape = shape;
  else field.awayShape = shape;
}

/** Where the ball is, and who has it. Coordinates are the fixed frame. */
export function placeBall(field: MatchFieldState, side: Side | null, playerId: string | null, x: number, y: number): void {
  field.ball.possessionSide = side;
  field.ball.possessionPlayerId = playerId;
  field.ball.x = clamp(x, 0.01, 0.99);
  field.ball.y = clamp(y, 0.02, 0.98);
}

export function setPossession(field: MatchFieldState, side: Side | null, playerId: string | null): void {
  field.ball.possessionSide = side;
  field.ball.possessionPlayerId = playerId;
}

export function setPhase(field: MatchFieldState, phase: MatchPhase): void {
  field.phase = phase;
}

/** Everything a caller needs to know about the moment a decision is being made in. */
export interface TeamMoment {
  side: Side;
  opponent: Side;
  progress: number;
  zone: FieldZone;
  phase: MatchPhase;
  /** 0..1 how hard the defending side is pressing the ball. */
  pressure: number;
  inPossession: boolean;
}

export function momentFor(field: MatchFieldState, side: Side, playerPressure: number): TeamMoment {
  const opponent = otherSide(side);
  const zone = zoneOf(side, field.ball.x);
  return {
    side,
    opponent,
    progress: progressOf(side, field.ball.x),
    zone,
    phase: field.phase,
    pressure: clamp01(playerPressure),
    inPossession: field.ball.possessionSide === side,
  };
}
