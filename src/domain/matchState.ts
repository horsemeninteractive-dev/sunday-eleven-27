import type { PlayerId } from './ids';
import type { PositionCode } from './positions';
import type { MatchPhase } from './match';
import type { Role } from '@/simulation/match/roles';

/**
 * The authoritative continuous match-state contract.
 *
 * One object describes the football as it is happening: where every player is,
 * where the ball is, what each of them is doing about it, and how far through
 * the clock the match has got. It is deliberately *declarative* — it says what
 * is true now, not how to work it out — so that every consumer, present and
 * future, reads the same truth:
 *
 * ```
 *          MatchState (authoritative, continuous)
 *                    │
 *       ┌────────────┴────────────┐
 *       │                         │
 *   simulation events        renderers
 *       │                    (2D now, 3D later)
 *   commentary
 * ```
 *
 * This file is the contract, and only the contract: types and the vocabulary
 * they are written in. The deterministic rules that produce and advance the
 * state live in `src/simulation/match/state.ts`, and the current (transitional)
 * producer of the continuous fields lives in `src/simulation/match/spatial.ts`.
 *
 * The contract is satisfied in practice by `MatchSpatial`, which *is* the single
 * authoritative continuous state — it is not a second simulation beside the
 * minute engine, and it must never become one. What the minute engine decides
 * (goals, shots, fouls, possession) is authoritative for the football; what this
 * contract describes is the continuous, in-space state of that same match.
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
   * The timed action this player is playing out, if any. A denormalised view of
   * {@link MatchState.actions}, kept in step from that one list so it cannot
   * drift out of it.
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

/**
 * The context the continuous state sits in.
 *
 * These are readings, not instructions: possession, the phase of play, and how
 * many match events have been recorded. The tactical instructions themselves and
 * the field model they move stay where they already are — on the match and its
 * lineups — so the contract references them rather than copying them, and there
 * is exactly one of each.
 */
export interface MatchContextState {
  /** Which side has the ball, if either. */
  possession: Side | null;
  /** Where in the story of the match this moment sits. */
  phase: MatchPhase;
  /** How many of the match's own events have been recorded so far. */
  eventCount: number;
}

/**
 * The match, continuously.
 *
 * Simulation time is the spine: `clock` is seconds of football since the
 * whistle, advanced in fixed `stepSeconds` steps, with the part-step not yet
 * spent carried in `residual` for a renderer to interpolate with. Rendering
 * frequency and presentation speed are *not* in here — a renderer may draw at
 * 30 or 60 frames a second and a manager may watch at 1x or 8x, and neither
 * changes the clock or the football.
 */
export interface MatchState {
  /** Seconds of football simulated since kick-off. Deterministic. */
  clock: number;
  /** The fixed step the simulation advances in. Not the render frame. */
  stepSeconds: number;
  /** Simulation time not yet spent on a whole step (0..stepSeconds). */
  residual: number;
  /** Every player on the pitch. */
  players: PlayerState[];
  /** The ball. */
  ball: MatchBallState;
  /** The actions currently being played out. */
  actions: MatchAction[];
  /** Possession, phase and the event cursor. */
  context: MatchContextState;
}

/**
 * The kind of thing one step of a possession chain does.
 *
 * Deliberately small. These are the actions that have been promoted out of the
 * post-hoc passage replay and into continuous simulation — the carrier moves,
 * the ball is played, or it is struck. Everything else is still executed by the
 * legacy minute path, and is a step of a chain in name only.
 *
 * `carry` keeps the ball at a player's feet while he moves. `pass` separates the
 * ball from the player and sends it to a receiver or an aim point. `shot` does
 * the same toward a goal. All three are executed over simulation time, step by
 * step, not replayed once the minute is over.
 */
export type PossessionStepKind = 'carry' | 'pass' | 'shot' | 'hold';

/**
 * One step of a possession chain.
 *
 * The geometry is what makes this an *execution* plan rather than a decision:
 * the simulation has already said what came to what (`outcome`), and this says
 * where the player and the ball go and how long they are given to get there.
 *
 * There is no `elapsed` or `started` here. Those used to live on the plan; they
 * now live on the authoritative {@link MatchAction} the step is played out as,
 * so a caller never has to wonder whether the two agree — the action *is* the
 * record of progress, and the plan only records what is still to come.
 */
export interface PossessionStep {
  kind: PossessionStepKind;
  playerId: PlayerId;
  /** The man a pass is aimed at, or null for a carry or a shot. */
  targetPlayerId: PlayerId | null;
  /**
   * The opponent the model credited with meeting this step — the man who read a
   * pass or saved a shot — so the pitch meets the ball at the right man rather
   * than picking whoever happens to be nearest.
   */
  opponentId?: PlayerId | null;
  /** Where the step starts, in pitch fractions. */
  fromX: number;
  fromY: number;
  /** Where it is headed, in pitch fractions. */
  toX: number;
  toY: number;
  /** Simulated seconds the step is given before it must be over. */
  duration: number;
  /** What the possession model already decided this comes to. */
  outcome: ActionOutcome;
}

/**
 * A possession chain the simulation executes continuously.
 *
 * `steps[index]` is the action being played out right now; everything after it
 * is what the chain will do next. It is the transitional half of the migration:
 * the *decisions* still come from the possession model, but the *execution* —
 * movement, ball travel, the change of possession — now lives in the continuous
 * state and is advanced one fixed step at a time.
 *
 * The chain is not authoritative about the football. It cannot change an
 * outcome, and nothing rolls a die while playing it. It is the plan the pitch
 * follows, and the authoritative record of what is happening this instant is the
 * player, ball and action state it drives.
 */
/**
 * How play is being started again.
 *
 * The vocabulary of dead balls. A corner and a throw-in are both "the ball is
 * not in play and somebody is going to put it back in", and the difference
 * between them is only *where* and *who* — which is why they are one type with
 * a kind rather than two unrelated types.
 *
 * `half-time` and `full-time` are here because they are also a moment the pitch
 * has to show rather than a decision to replay: the ball goes to the centre
 * spot and the teams walk, and the difference is that nothing is thrown back in.
 */
export type RestartKind =
  | 'kickoff'
  | 'throw-in'
  | 'goal-kick'
  | 'corner'
  | 'free-kick'
  | 'penalty'
  | 'drop-ball'
  | 'half-time'
  | 'full-time';

/**
 * What the taker is going to do with the ball, decided before he takes it.
 *
 * This is the part of a set piece that a drilled routine actually decides: a
 * corner routine is *where* the ball goes, not merely *that* it does. A side
 * with a worked routine near-post run has somebody at the near post; a side
 * without one is aiming at whoever happens to be tallest.
 *
 * It is a description of intent, never of outcome: what the delivery came to was
 * decided by the possession model before this was written, and nothing here may
 * change it.
 */
export interface SetPiecePlan {
  /** Which kind of delivery this routine plays. */
  kind: 'cross' | 'pass' | 'shot' | 'clear';
  /** Who it is aimed at, when the routine names a man. */
  targetId: PlayerId | null;
  /** Where the ball is going, in the fixed frame. */
  x: number;
  y: number;
  /**
   * How long the delivery is given, in match seconds.
   *
   * A corner is a high ball that has to arrive; a tap-in is two feet. Taking the
   * duration from the routine rather than from the geometry is what lets a
   * short corner be short.
   */
  duration: number;
}

/**
 * A dead ball, and the passage that brings it back to life.
 *
 * A restart is a *state machine with a shape*, not a moment. The three phases
 * are:
 *
 * 1. **Setup** (`elapsed < setupSeconds`). The ball is out of play on the spot
 *    and does not move. Everybody walks into place: the taker to the ball, the
 *    defending side into its block, the attacking side into its arrangement.
 *    This is the phase that used not to exist, and it is most of what makes a
 *    set piece legible — a corner nobody walks up to is an event, not a
 *    passage.
 * 2. **Delivery**. The taker plays the ball, as a normal possession step.
 * 3. **Resolution**. Handled by the existing shot and possession logic.
 *
 * Nothing here decides anything. The restart is the *presentation* of a
 * decision the possession model has already made, and the plan it carries says
 * what the taker intends, not how it turns out.
 */
export interface RestartState {
  kind: RestartKind;
  /** Who is restarting, and therefore who is attacking during the setup. */
  side: Side;
  /** The spot the ball is placed on, in the fixed frame. */
  ballX: number;
  ballY: number;
  /** Seconds since the restart was given. */
  elapsed: number;
  /**
   * How long the setup takes — players walking into place.
   *
   * Drawn once per restart from the kind, not from a frame rate, because a
   * corner takes visibly longer to arrange than a throw-in and the difference is
   * the whole reason the restart is worth showing.
   */
  setupSeconds: number;
  /** The taker, once known. Null before it is chosen. */
  takerId: PlayerId | null;
  /** The delivery, for the restarts that have one. */
  plan?: SetPiecePlan;
  /**
   * Whether the ball has been put down on its spot and the men are walking up.
   *
   * Set when the chain reaches the step that *delivers* this restart, which for a
   * corner at the end of a long move is well after the restart was created. Until
   * it is set the restart exists but nothing on the pitch knows about it, so the
   * build-up that led to it plays as ordinary football.
   */
  placed?: boolean;
  /**
   * Whether the taker has walked to the ball yet.
   *
   * The setup is not over until he has, within a bound: the referee waits for
   * the taker, and a corner taken from thirty yards away because the clock said
   * so is a corner struck by somebody who is not there.
   */
  takerArrived?: boolean;
  /**
   * Whether the delivery has been played.
   *
   * The ball is never both dead and being played: this is set and the restart
   * cleared in the same step that the ball is struck.
   */
  played?: boolean;
  /**
   * What the possession model decided this restart came to.
   *
   * Carried so the pitch can *show* the decided football without re-deciding it:
   * a corner that was decided as a goal is shown as a cross that finds a header
   * which goes in, rather than a cross thrown at nobody and then rolled for a
   * second time.
   */
  outcome?: ActionOutcome;
}

export interface PossessionPlan {
  /** The side playing the chain. */
  side: Side;
  steps: PossessionStep[];
  /** The step being played out (or about to be); steps before it are done. */
  index: number;
  /**
   * The restart this chain begins with, when it begins with one.
   *
   * A chain that opens with a dead ball has to *show* the dead ball before it
   * can play the delivery: the ball placed, the men walking up, the whistle. So
   * the plan carries the restart rather than the restart being a separate thing
   * that competes with the plan for the pitch.
   */
  restart?: RestartState | null;
  /**
   * Which step of this chain the restart belongs to.
   *
   * A corner is the last thing a possession does but rarely the first — there are
   * a dozen steps of build-up before it — so the dead ball has to be pinned to
   * the step that *delivers* it. Without this the ball went down for eight
   * seconds at the wrong end of the move and the corner was never taken.
   */
  restartIndex?: number;
  /**
   * How much longer the chain owes the picture after its last step.
   *
   * The steps carry the picture durations; the model's budget is what it took to
   * decide the whole possession. The difference is real football that has to be
   * shown, spent as settling at the end of the chain.
   */
  settleSeconds?: number;
  /** The spatial clock when the chain began settling, or absent before it has. */
  settledAt?: number;
  /**
   * How long the possession model took to decide this chain, in match seconds.
   *
   * The one clock means the picture owes the football exactly this much time:
   * a chain decided in twenty seconds of match must take twenty seconds to
   * play, or the pitch runs out of football halfway through the minute and
   * stands still until the next one is decided. The steps divide it up between
   * them while it is played; without it a plan is played at whatever pace its
   * geometry suggests, which is a fraction of the time it was decided over.
   */
  budgetSeconds?: number;
  /**
   * The spatial clock when this chain took the pitch, so its budget is spent
   * from when it started rather than from when it was queued — a chain that
   * waited its turn behind another does not get that wait for free.
   */
  startedAt?: number;
  /**
   * How many of the match's untold commentary lines belong to this chain.
   *
   * The words for a minute are written when the minute is decided, but they are
   * told as the football happens: this is how many of them this chain is
   * responsible for, and they are read off the front of the queue at the moment
   * the chain actually takes the pitch. A minute used to be announced all at
   * once, a minute before any of it had been played, so the bar described a
   * move the pitch had not started.
   */
  commentaryCount?: number;
  /**
   * How many of those lines have actually been said.
   *
   * A chain's words are told one per step as that step takes the pitch, not all
   * at once when the chain arrives: a five-step chain spends two or three
   * seconds on screen playing those five steps, and saying all five at the first
   * of them put the bar three seconds ahead of the football before the ball had
   * moved. This is the count of what has been said, so the remainder can be
   * flushed when the chain gives up the pitch.
   */
  toldCount?: number;
  /**
   * The step whose line was told last.
   *
   * A step can be *begun* more than once — a carry waits at the feet of a loose
   * ball until it arrives, and each attempt comes back through here — so this is
   * what makes telling a line once-and-once possible.
   */
  narratedStep?: number;
}
