import type { PlayerId } from '@/domain/ids';
import type { ActionOutcome, MatchActionKind, Side } from '@/domain/matchState';

export type { ActionOutcome };

/**
 * The football, as a run of timed actions.
 *
 * The possession model already decides a minute as a sequence of decisions — a
 * man passes, another carries, a third shoots — but until now it threw that
 * sequence away after computing the outcomes, and the spatial layer invented a
 * representative move from the minute's *events*. Two accounts of one minute is
 * exactly the problem this type exists to end.
 *
 * A `TimelineAction` is one of those decisions written down as it is made: who
 * did it, to whom, from where to where, when in the minute it began, how long it
 * took, and what it came to. The continuous layer replays *these*, so the move
 * the manager watches is the move the model played — not a reconstruction that
 * happens to agree on the score.
 *
 * Nothing here draws a random number or reads an attribute, so recording the
 * timeline cannot change what happens on the pitch: it is a record, not a
 * decision.
 */

/** One decision from the possession model, placed in time. */
export interface TimelineAction {
  /** The contract's action verb. */
  kind: MatchActionKind;
  /** The possession model's own name for the decision (`cross`, `through`, …). */
  decision: string;
  side: Side;
  playerId: PlayerId | null;
  targetPlayerId: PlayerId | null;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Seconds from the start of the minute. */
  startSecond: number;
  duration: number;
  outcome: ActionOutcome;
}

/** The actions that move the ball to another player or into a danger area. */
export function isDelivery(kind: MatchActionKind): boolean {
  return kind === 'pass' || kind === 'cross' || kind === 'clear' || kind === 'switch' || kind === 'through';
}

/** The actions that carry the ball with a player. */
export function isOnBall(kind: MatchActionKind): boolean {
  return kind === 'carry' || kind === 'dribble' || kind === 'hold' || kind === 'turn';
}

/**
 * A hero-shot: a shot from a cross or through ball, so a header or a strike
 * still appears in the timeline of the minute that produced it.
 */
export function shotAction(spec: Omit<TimelineAction, 'duration'>): TimelineAction {
  return { ...spec, duration: 1.1 };
}
