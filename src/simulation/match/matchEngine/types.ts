import type { MatchId, PlayerId } from '@/domain/ids';
import type { PositionCode } from '@/domain/positions';
import type { LineHeights, MatchEvent, PlayerPerformance } from '@/domain/match';
import type { BallStatus, MatchAction, MatchBallState, PlayerState } from '@/domain/matchState';
import type { Role, RoleProfile } from '../roles';
import type { MatchPeriod } from './periods';

/**
 * The contract for the new match engine.
 *
 * This file is *only* the vocabulary: the state the engine owns and the values
 * it is written in. The rules that advance it live beside it, and nothing here
 * decides any football.
 *
 * There is exactly one state, `MatchEngineState`. Everything else — the 2D
 * renderer, the commentary, the statistics, a future 3D view — reads it. The
 * engine is the only thing that writes it.
 */

export type Side = 'home' | 'away';

/**
 * What kind of football is being played right now.
 *
 * A set piece is a *phase*, not an event: the engine spends real seconds of the
 * clock arranging a corner, playing the delivery, and resolving the contest, and
 * only then returns to `open-play`. This is what stops a corner being an
 * animation beside the football.
 */
export type MatchPhase =
  | 'kickoff'
  | 'open-play'
  | 'goal-kick'
  | 'corner'
  | 'free-kick'
  | 'throw-in'
  | 'penalty'
  | 'goal'
  | 'half-time'
  | 'full-time';

/** The kind of dead ball being taken. Maps onto `MatchPhase` one to one. */
export type SetPieceKind = 'kickoff' | 'throw-in' | 'goal-kick' | 'corner' | 'free-kick' | 'penalty';

/**
 * Where a set piece is in its own little state machine.
 *
 * `setup` — the ball is dead on its spot and everybody walks into place.
 * `delivery` — the taker plays it and the ball travels.
 * `resolution` — control, aerial contest, clearance, shot; handled by the
 * ordinary ball and interaction rules, from live spatial state.
 */
export type SetPiecePhase = 'setup' | 'delivery' | 'resolution';

/**
 * How a shot is expected to come out, decided once when it is struck.
 *
 * The engine settles a shot from the actual context — where the shooter is, the
 * angle, the range, his shooting and composure, the pressure on him and the
 * keeper waiting for it — rather than always driving it at the mouth and letting
 * the keeper alone decide. A shot can beat the keeper, be kept out, go wide, sail
 * over the bar or rattle the frame; the resolution rules only carry out what the
 * shot already decided, so a blocked or deflected shot is a genuine interruption
 * of the attempt rather than a second opinion about it.
 */
export type ShotOutcome = 'goal' | 'saved' | 'wide' | 'over' | 'woodwork';

/** What the taker is going to do with it, decided from side and situation. */
export type DeliveryKind = 'cross' | 'pass' | 'shot' | 'clear' | 'throw';

/**
 * What a player is trying to do off the ball, coarse enough to be useful and
 * fine enough to be legible. It is *not* a state machine of its own: it is the
 * engine's own note of the intent it chose for him this step, so a renderer can
 * dress twenty-two men differently without re-deciding anything.
 */
export type PlayerIntent =
  | 'hold'
  | 'press'
  | 'chase'
  | 'cover'
  | 'support'
  | 'run'
  | 'receive'
  | 'carry'
  | 'shield'
  | 'clear'
  | 'celebrate';

/**
 * A player's continuous state.
 *
 * This is a superset of the old contract's {@link PlayerState}, so a renderer
 * written against the old shape still finds everything it read, and the engine
 * adds only what the football actually needs: stamina, his disciplinary state,
 * and the intent it has chosen for him.
 */
export interface PlayerMatchState extends PlayerState {
  /** Index of the formation slot he fills; his anchor in the fixed frame. */
  slotIndex: number;
  /**
   * His top speed when fresh, in pitch-lengths per simulation second.
   *
   * Kept apart from {@link PlayerState.speed} — which the movement rules scale by
   * his legs each step — so a tiring player slows without the engine losing the
   * pace he started with.
   */
  baseSpeed: number;
  /** 0..100 in-match energy. */
  stamina: number;
  /** Whether he is carrying a booking. */
  booked: boolean;
  /** Whether he has been sent off. */
  sentOff: boolean;
  /**
   * His place in the shape, worked out once rather than every decision.
   *
   * Where a slot sits is a function of the formation, his role and his side —
   * none of which change while he plays — so the line his slot belongs to and
   * the fixed offsets his role gives him are computed when he takes the field
   * and simply read afterwards. Refreshed by `refreshFormation` when the shape
   * itself changes. See `shapeTargetFor` for how they are used.
   */
  slotLine: keyof LineHeights;
  /** His role's depth nudge, added to the live line height. */
  slotDepthOffset: number;
  /** His lateral nudge from the centre, scaled by the live width. */
  slotLateral: number;
  /** Whether his role closes the ball down — read every off-ball decision. */
  pressBehaviour: RoleProfile['pressBehaviour'];
  /** Whether his role makes runs beyond the ball. */
  runsInBehind: boolean;
  /** What he is trying to do, as the engine chose it. */
  intent: PlayerIntent;
  /**
   * Simulation seconds before he may be given a new on-ball decision.
   *
   * A player with the ball is committed to what he is doing for a beat — a pass
   * takes time to release, a carry takes time to turn — which is what stops a
   * carrier changing his mind every thirtieth of a second and jittering.
   */
  committedUntil: number;
  /** True while the ball is at his feet, mirrored from the ball for convenience. */
  possession: boolean;
  /**
   * The record the engine writes his match into, held directly.
   *
   * The performance for a man is looked up by id — a string-keyed object read —
   * on every step of the match for his stamina. Holding the object itself turns
   * that into a field read. It is the same object `match.performances` holds, so
   * the record and the engine cannot disagree: it is a shortcut, not a copy.
   */
  performance?: PlayerPerformance;
}

/**
 * The ball.
 *
 * First class: it has a position, a previous position, a velocity, and a status
 * that says whether it is at somebody's feet, travelling to a receiver or an aim
 * point, loose on the grass, or dead while a restart is arranged. `height` is a
 * 0..1 flight value for the aerial game; `vz` is its vertical velocity.
 */
export interface BallNode extends MatchBallState {
  vx: number;
  vy: number;
  vz: number;
  /**
   * The side the ball is travelling *for*, when it is aimed at a player.
   *
   * A travelling ball is not neutral: a pass is played to a teammate and a
   * clearance is struck away by a defender, and the difference decides who may
   * take it under control without a contest and who has to fight for it.
   */
  intendedSide: Side | null;
  /**
   * How the ball is travelling, when it is in flight.
   *
   * The kind of a delivery is not decoration: a shot is dealt with by a keeper,
   * a cross is met in the air, and a clearance is a defender's way of getting rid
   * of it. The resolution rules read this rather than guessing from geometry.
   */
  kind: 'pass' | 'through' | 'cross' | 'shot' | 'clear' | 'throw' | null;
  /**
   * How a shot is expected to come out, set when it is struck.
   *
   * Null on every ball that is not a shot. The resolution rules read it to know
   * whether a ball crossing the goal line between the posts is a goal (a shot
   * genuinely on target), a miss (over the bar) or nothing at all — geometry
   * alone cannot see height, so the shot's own outcome says what it was.
   */
  shotOutcome: ShotOutcome | null;
  /**
   * The attacking player left in an offside position by the pass this ball is.
   *
   * Set at the moment the ball is played, because that is the instant the law
   * judges: if this man later takes control of the ball he is offside and the
   * attacking move is cut dead. It is a fact about the pass, not about where
   * anybody stands afterwards.
   */
  offsidePlayerId: string | null;
  /**
   * Whether this ball is the kick from a penalty.
   *
   * A penalty that beats the keeper is a `penalty-scored` and one that does not
   * is a `penalty-missed`, whoever stops it and however it misses — a fact about
   * the kick, carried on the ball so the resolution rules can say it plainly.
   */
  penaltyShot: boolean;
  /**
   * Players who have already had a read at this ball while it has been in
   * flight, so each of them gets one attempt per flight and not one per step.
   */
  attempted: string[];
}

/** The delivery a set piece taker is about to play. */
export interface SetPieceDelivery {
  kind: DeliveryKind;
  targetId: PlayerId | null;
  /** Where the ball is going, in the fixed frame. */
  x: number;
  y: number;
  /** How long the delivery is given, in match seconds. */
  seconds: number;
  /** How a direct shot from a dead ball is meant to come out, when it is one. */
  shotOutcome?: ShotOutcome | null;
}

/** A dead ball, and the passage that brings it back to life. */
export interface SetPieceState {
  kind: SetPieceKind;
  /** The side taking it, and therefore attacking while it is arranged. */
  side: Side;
  /** The spot the ball rests on during setup, in the fixed frame. */
  spot: { x: number; y: number };
  phase: SetPiecePhase;
  /** Seconds elapsed in this phase. */
  elapsed: number;
  /** How long the setup is worth — a corner takes longer to arrange than a throw. */
  setupSeconds: number;
  /** The man taking it, once chosen. */
  takerId: PlayerId | null;
  /** The delivery, chosen from the taker's role and the side's routines. */
  delivery: SetPieceDelivery | null;
  /** A direct free kick may be struck at goal. */
  direct: boolean;
  /** True once the delivery is in flight. */
  played: boolean;
  /**
   * Whether the arrangement has been laid out.
   *
   * A dead ball is arranged once, when it begins: the men are given their spots
   * and then walk to them under the ordinary movement rules. The spots are not
   * re-rolled every step — that would jitter the targets and spend randomness
   * describing a shape that has already been decided.
   */
  arranged: boolean;
}

/**
 * A goal being celebrated.
 *
 * When the ball crosses the line the engine holds the `goal` phase for a few
 * seconds of football time. This is the fact that makes those seconds *move*:
 * the side that scored runs for the corner, and the men who did not score run
 * for the man who did. It is written once, when the goal is scored, and cleared
 * the moment the kick-off is arranged — the football itself is untouched by it,
 * because the restart lays everybody out afresh.
 */
export interface GoalCelebration {
  /** The side whose goal it is, and therefore the side that celebrates. */
  side: Side;
  /**
   * The man who scored, if the record names one on the celebrating side.
   *
   * Null for an own goal, where the last touch belonged to the side that
   * conceded and the celebration has no scorer of its own to mob.
   */
  scorerId: string | null;
}

/** A per-side tally of the football, read straight off the events and state. */
export interface TeamMatchStats {
  possessionSeconds: number;
  shots: number;
  shotsOnTarget: number;
  goals: number;
  passes: number;
  passesCompleted: number;
  tackles: number;
  interceptions: number;
  fouls: number;
  corners: number;
  throwIns: number;
  goalKicks: number;
  offsides: number;
  saves: number;
  shotsBlocked: number;
  yellowCards: number;
  redCards: number;
}

/** An empty tally, so a caller never has to remember every field. */
export function emptyStats(): TeamMatchStats {
  return {
    possessionSeconds: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    passes: 0,
    passesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    fouls: 0,
    corners: 0,
    throwIns: 0,
    goalKicks: 0,
    offsides: 0,
    saves: 0,
    shotsBlocked: 0,
    yellowCards: 0,
    redCards: 0,
  };
}

/**
 * Derived lookups over `players`, so the hot loop never scans the array.
 *
 * The decision and resolution layers ask "who is this id?" and "who of this side
 * is on the pitch?" many thousands of times a match, and `Array.find`/`filter`
 * answer them by walking all twenty-two men every time. These are the same
 * answers, kept in step: rebuilt lazily the moment the pitch changes (a
 * substitution, a sending off) and read directly in between. They never hold a
 * decision of their own — only the players `players` already holds.
 */
export interface EngineIndex {
  byId: Map<string, PlayerMatchState>;
  active: Record<Side, PlayerMatchState[]>;
  keepers: Record<Side, PlayerMatchState | undefined>;
  dirty: boolean;
}

/**
 * The one authoritative match state.
 *
 * Simulation time is the spine: `clock` is seconds of football since kick-off,
 * advanced in fixed `stepSeconds` steps, with the part-step not yet spent carried
 * in `residual` so a renderer can interpolate. Frame rate and presentation speed
 * are *not* in here — a renderer may draw at 30 or 60 frames a second and a
 * manager may watch at 1x or 8x, and neither changes the football.
 */
export interface MatchEngineState {
  /** The fixture this state belongs to. */
  matchId: MatchId;
  /** The seed every decision's randomness is derived from. */
  seed: number;
  /** Seconds of football simulated since kick-off. Deterministic. */
  clock: number;
  /** The fixed step the simulation advances in. Not the render frame. */
  stepSeconds: number;
  /** Simulation time not yet spent on a whole step (0..stepSeconds). */
  residual: number;
  /**
   * The simulation time at which the off-ball decisions are next revisited.
   *
   * The men without the ball are not re-deciding where to stand thirty times a
   * second — a footballer picks a run and goes, and a target that flickers every
   * thirtieth of a second is jitter, not intent. Their decisions are taken on a
   * slower cadence than the step (see `OFF_BALL_INTERVAL`), and this is when the
   * next one is due. The on-ball decisions are unaffected: the man with the ball
   * is asked every step.
   */
  nextOffBallDecision: number;
  /**
   * Which part of the game is being played.
   *
   * The truth the clock is read against: the clock itself is monotonic seconds
   * since kick-off, and this says which period those seconds fall in, so the
   * minute can be rebased and the end of the period known. `match.half` is kept
   * in step for the rest of the game.
   */
  period: MatchPeriod;
  /** The kind of football being played now. */
  phase: MatchPhase;
  /** Seconds spent in the current phase. Reset whenever the phase changes. */
  phaseElapsed: number;
  /**
   * Seconds of the half in which the ball was dead: a restart being arranged, a
   * goal being celebrated. This is the raw material of added time — the engine
   * measures it rather than guessing a figure before kick-off — and it is read
   * only when a half reaches its nominal end.
   */
  stoppedSeconds: { first: number; second: number };
  /** The score, as the engine has settled it. */
  score: { home: number; away: number };
  /** The side that conceded the last goal, so the kick-off goes the right way. */
  concedingSide?: Side | null;
  /** The goal currently being celebrated, or null outside the goal hold. */
  celebration?: GoalCelebration | null;
  /** Who has the ball, if anybody. */
  possession: Side | null;
  /**
   * The last pass that was actually completed, for assisting a goal.
   *
   * A goal is assisted only when the record supports it: the scorer received a
   * pass from a teammate, from the same side, not long before he scored. This is
   * that chain — the passer and the man he found — written when the ball is
   * controlled, so a goal within its window can name an assister without
   * inventing one.
   */
  lastPass: { passerId: string; receiverId: string; side: Side; clock: number } | null;
  /** Every player on the pitch. */
  players: PlayerMatchState[];
  /** The ball. */
  ball: BallNode;
  /** The timed actions currently being played out. */
  actions: MatchAction[];
  /** The dead ball being arranged, or null during open play. */
  setPiece: SetPieceState | null;
  /** The football tallied per side. */
  stats: { home: TeamMatchStats; away: TeamMatchStats };
  /**
   * Events emitted since the last read.
   *
   * The authoritative record is `match.events`, which the engine also writes;
   * this is the feed a running match hands to its consumers one step at a time.
   */
  pendingEvents: MatchEvent[];
  /** True once the final whistle has gone. */
  finished: boolean;
  /**
   * Whether set pieces are arranged at all.
   *
   * A debug switch and the only one of its kind: it exists so a test can prove
   * that *showing* a restart cannot change one, by driving two fixtures with the
   * same seed and refusing restarts in one of them. It has no UI and is not a
   * product feature.
   */
  setPiecesEnabled?: boolean;
  /**
   * Cached lookups over `players`, refreshed when the pitch changes. Purely
   * derived: it can be thrown away and rebuilt at any time without changing a
   * fact about the match.
   */
  index?: EngineIndex;
}

/** What the engine hands a renderer for one player, after interpolation. */
export interface InterpolatedPlayer {
  playerId: PlayerId;
  side: Side;
  position: PositionCode;
  role: Role | undefined;
  x: number;
  y: number;
  intent: PlayerIntent;
  possession: boolean;
}

/** Convenience: the players belonging to one side. */
export function playersOf(state: MatchEngineState, side: Side): PlayerMatchState[] {
  return state.players.filter((player) => player.side === side);
}

/** The other side. */
export function otherSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

/** The ball's status, for a caller that only wants to know if it is live. */
export function ballInPlay(ball: BallNode): boolean {
  return (ball.status as BallStatus) !== 'out-of-play';
}
