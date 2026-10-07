import type { PlayerId } from './ids';
import type { PositionCode } from './positions';
import type { Role } from '@/simulation/match/roles';

/**
 * The vocabulary of the continuous match state.
 *
 * One object describes the football as it is happening: where every player is,
 * where the ball is, what each of them is doing about it, and how far through
 * the clock the match has got. It is deliberately *declarative* — it says what
 * is true now, not how to work it out — so that every consumer, present and
 * future, reads the same truth:
 *
 * ```
 *          MatchEngineState (authoritative)   [matchEngine/types.ts]
 *                    │
 *       ┌────────────┴────────────┐
 *       │                         │
 *   match events             renderers
 *       │                    (2D now, 3D later)
 *   commentary
 * ```
 *
 * This file is the vocabulary, and only the vocabulary: the shapes that state is
 * written in. **Touchline** owns the authoritative match state —
 * `MatchEngineState`, built by `createEngineState` and written only by
 * `MatchEngine` — and the deterministic rules that advance it live in
 * `src/simulation/match/state.ts`. The shapes below are what the engine's own
 * state extends, and what every reader of a match (the pitch, the replay, a
 * statistics panel, a future 3D view) is handed.
 */

export type Side = 'home' | 'away';

/**
 * What a player is doing with himself, in the coarsest useful sense.
 *
 * The coarse movement state — he holds his shape, he is chasing the ball, the
 * ball is at his feet, he is supporting the carrier, or he is celebrating. The
 * *timed* thing he is doing is separate and lives in {@link MatchAction}.
 */
export type PlayerAction = 'shape' | 'chasing' | 'carrying' | 'supporting' | 'celebrating';

/**
 * Where the ball is, in the continuous state.
 *
 * `controlled` is at a player's feet, `travelling` is on its way to a named
 * receiver or aim point, `loose` is on the grass with nobody on it, and
 * `out-of-play` is the ball dead behind a touchline or goal line while a
 * restart is arranged.
 */
export type BallStatus = 'controlled' | 'travelling' | 'loose' | 'out-of-play';

/** Player state: identity, place, movement and the action he is playing out. */
export interface PlayerState {
  playerId: PlayerId;
  side: Side;
  /** The role he is filling, not necessarily the one he prefers. */
  position: PositionCode;
  /**
   * The role he is playing, carried on the node so a pure function can place him
   * without reaching back into the spatial state. Optional because a node built
   * before roles existed has nothing here and falls back to his position's
   * default.
   */
  role?: Role;
/** Where his slot tells him to stand, in the match's fixed orientation. */
baseX: number;
baseY: number;
  /**
   * Where the current shape says he stands, eased toward rather than snapped to.
   *
   * The shape's own answer for this player can move a long way in one frame —
   * most sharply when possession turns over, because the two sets of heights
   * genuinely differ. Snapping to it would move all twenty-two men at once,
   * which is the twitch the whole shape model is supposed to avoid. So the block
   * is given somewhere to *be* and travels there at a bounded rate, and the shape
   * is a thing the side moves toward rather than a thing that happens to it.
   */
shapeX?: number;
shapeY?: number;
  /**
   * The match clock until which he is deliberately standing still, or undefined.
   *
   * Set when he arrives somewhere with nothing to do and cleared by anything
   * that actually needs him: the ball coming within reach, a plan step naming
   * him, or the side winning or losing the ball.
   */
restUntil?: number;
  /**
   * The position he has already offered to support from, and the ball position
   * he offered against.
   *
   * A man who has moved up to support his carrier should stay where he moved
   * to, not keep creeping forward every step because the offer is recomputed
   * from scratch thirty times a second. Cached here so it is decided once and
   * revisited only when the thing it was decided against has actually changed.
   */
offerX?: number;
offerY?: number;
offerBallX?: number;
offerBallY?: number;
offerCarrierId?: string;
  /** Where he is now, in pitch fractions (0..1). */
  x: number;
  y: number;
  /** Where he was a step ago, so a renderer can interpolate. */
  px: number;
  py: number;
  /** Where the simulation has told him to go. */
  tx: number;
  ty: number;
  /** Pitch-lengths per simulation second. */
  speed: number;
  /** The coarse movement state. */
  action: PlayerAction;
  /** Current velocity in pitch-lengths per simulation second (x, y). */
  vx: number;
  vy: number;
  /**
   * The timed action this player is playing out, if any.
   *
   * A denormalised view of the engine's own {@link MatchAction} list, kept in
   * step from that one list so it cannot drift out of it.
   */
  actionKind: MatchActionKind | null;
  actionStartedAt: number | null;
  actionEndsAt: number | null;
  /** True while the ball is at his feet. */
  possession: boolean;
}

/** Ball state: position, movement, ownership and timing. */
export interface MatchBallState {
  x: number;
  y: number;
  px: number;
  py: number;
  status: BallStatus;
  /** The player with the ball at his feet, when it is under control. */
  ownerId: PlayerId | null;
  /** The player a travelling ball is aimed at, or null for a loose aim point. */
  targetId: PlayerId | null;
  /** Where a travelling ball is headed. */
  tx: number;
  ty: number;
  /** Pitch-lengths per simulation second. */
  speed: number;
  /** 0 = on the deck. Reserved for flight. */
  height: number;
  /** Simulation time the ball last changed hands or left a foot. */
  touchedAt: number;
  /** The player who last had it or was aimed at. */
  lastTouchId: PlayerId | null;
}

/** Where an action is in its life. */
export type MatchActionStatus = 'active' | 'resolved' | 'cancelled';

/**
 * How an action came out.
 *
 * The possession model decides this; the continuous layer may *represent* it —
 * a saved shot is met by the keeper, an incomplete pass finds the man who read
 * it — but it may never change it.
 */
export type ActionOutcome =
  | 'completed'
  | 'incomplete'
  | 'carry'
  | 'turnover'
  | 'foul'
  | 'out'
  | 'goal'
  | 'saved'
  | 'blocked'
  | 'off-target';

/**
 * The vocabulary an action is written in.
 *
 * These are the things that happen over time on a football pitch. Only the
 * actions the present simulation actually plays out are produced today — carry,
 * pass and shot — but the contract can already name the rest, so the seam is
 * open to them without a second representation being invented later.
 */
export type MatchActionKind =
  | 'move'
  | 'support'
  | 'close-down'
  | 'track'
  | 'carry'
  | 'dribble'
  | 'turn'
  | 'pass'
  | 'cross'
  | 'clear'
  | 'hold'
  | 'switch'
  | 'through'
  | 'receive'
  | 'tackle'
  | 'interception'
  | 'shot'
  | 'save';

/**
 * Something a player is doing over time.
 *
 * An action is not a roll — it is a plan with a beginning, a duration and a
 * resolution. It starts at a simulation time, it is progressed by the clock and
 * nothing else, and it ends either when its time is up or when the thing it
 * described has happened. That is the property the old representation lacked:
 * a pass was an instant, and the picture had to reconstruct the time afterwards.
 */
export interface MatchAction {
  id: string;
  kind: MatchActionKind;
  /** The player playing it out, or null for an action about the ball itself. */
  playerId: PlayerId | null;
  /** The player it concerns — the receiver of a pass, the man being tackled. */
  targetPlayerId: PlayerId | null;
  /** Simulation seconds when the action began. */
  startedAt: number;
  /** How long the action is given. */
  duration: number;
  status: MatchActionStatus;
  /** What it came to, in one word, once resolved. */
  outcome: ActionOutcome | null;
}

