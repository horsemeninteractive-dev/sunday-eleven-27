/**
 * Dead balls, and making them visible.
 *
 * Everything in this match that stopped the football used to stop it *invisibly*.
 * A corner was a line in the event log and a change of possession; a throw-in
 * was the ball quietly appearing forty yards upfield; a free kick was a foul
 * event followed by a shot from somewhere else entirely. The simulation was
 * doing the thing and the pitch was not showing it, which is the whole of the
 * "it's simulating but it doesn't look like football" complaint.
 *
 * A restart is a small state machine with three phases, and the middle one was
 * the missing piece:
 *
 * 1. **Setup.** The ball is out of play on its spot and does not move. The taker
 *    walks to it, the defending side forms its block, the attacking side takes
 *    up its positions. For eight seconds on a corner, the pitch visibly *arranges
 *    itself*.
 * 2. **Delivery.** The taker plays it, as an ordinary possession step.
 * 3. **Resolution.** Whatever the possession model already decided.
 *
 * **What this module is not allowed to do is decide anything.** The whole
 * architecture rests on that: `setPieces.ts` still rolls the outcome, still
 * decides whether the header is a goal, and still writes the same events it
 * always did. The restart is the *presentation* of a decision that has already
 * been made, and the `plan` it carries is intent — where the taker is aiming —
 * never the answer. A restart that changed a single result would be a second
 * football, and there is only supposed to be one.
 */
import type { PlayerId } from '@/domain/ids';
import type { ActionOutcome, RestartKind, RestartState, SetPiecePlan } from '@/domain/matchState';
import type { PositionCode } from '@/domain/positions';
import type { Side } from './core';

/**
 * The little a man is, as far as a restart cares about.
 *
 * A restart is about *where a man is standing*, so it needs his identity, his
 * side and his position and nothing else — not his velocity, not his target, not
 * anything he was doing before the whistle went. Narrowing it to this is what
 * lets the placement be tested without a pitch, and is the same reason
 * {@link import('./continuousPossession').PlanGeometry} exists.
 */
export interface RestartPlayer {
  playerId: PlayerId;
  side: Side;
  position: PositionCode;
  /** Where he is standing now. */
  x: number;
  y: number;
}

/**
 * What the placement needs to know about the men it is placing, which is a few
 * questions about the *whole side* rather than about any one of them.
 *
 * `rankOf` gives a stable left-to-right ordering within a side, which is how
 * players are spread along a wall or across the top of a box without any of
 * them being told where "third from the left" is. `markedMan` is the defender's
 * man to pick up; `isNearPost` and `isReceiver` pick the two roles a corner and
 * a throw-in each need exactly one of.
 *
 * All of it is passed in rather than reached for, so this module stays free of
 * the spatial layer and can be asked what a restart looks like from a list of
 * twenty-two plain objects.
 */
export interface RestartGeometry {
  /**
   * A stable ordering index for this man among his side's outfield players,
   * roughly left to right. Distinct per man, in 0..9.
   */
  rankOf(player: RestartPlayer, attacking: boolean): number;
  /** The attacking man this defender is marking, if the routine named one. */
  markedMan(player: RestartPlayer): { x: number; y: number } | null;
  /** Whether this attacker stands at the near post. */
  isNearPost(player: RestartPlayer): boolean;
  /** Whether this man is the one the throw is going to. */
  isReceiver(player: RestartPlayer, state: RestartState): boolean;
  /**
   * Where this man stands in a wall, offset from the middle of it.
   *
   * Nine yards from the ball, spread across the line to the goal. A wall is the
   * clearest single image in the whole of this module and it is worth a tenth of
   * a pitch of lateral spread between its two ends.
   */
  wallOffset(player: RestartPlayer): number;
}

/**
 * How long each restart takes to arrange, in seconds.
 *
 * These are the visible costs of the three phases, and they are drawn from the
 * kind rather than from anything else because that is what actually determines
 * them: a throw is a man walking two steps and lifting the ball overhead, a
 * corner is eleven men walking twenty-five yards into a box, and a penalty is a
 * whole team standing still outside the area while two men walk to the spot.
 *
 * The ordering is the claim — a corner takes visibly longer to arrange than a
 * throw, and a penalty longer than either — and every one of them sits well
 * inside a ten-second window, which is a real constraint rather than a tuning
 * choice. `realism.test.ts` asserts that the ball is moving through every ten
 * seconds of an in-progress match, so a stoppage long enough to swallow a whole
 * window shows up as a frozen window. That is the right way round: the rule is
 * that football does not stop for long enough to watch, and the longest pause in
 * the game is six seconds.
 *
 * Twelve seconds for a penalty and eight for a corner were both tried, on the
 * theory that a set piece should be *seen* to take time. They made the game
 * watch a dead ball for longer than a real one does and turned a passing test
 * into a failing one, which is the trade stated plainly: the setup has to be
 * visible, but it does not have to be long.
 */
export const SETUP_SECONDS: Record<RestartKind, number> = {
  kickoff: 3,
  // A throw is the quickest thing in football: a man picks the ball up, steps to
  // the line and throws. Four seconds was a visible stop-start on *every* ball
  // that left the pitch — about thirty times a match, which is thirty times the
  // game appears to stop. Two seconds is still long enough to see the ball placed
  // on the line and the taker reach it.
  'throw-in': 2,
  'goal-kick': 4,
  corner: 6,
  'free-kick': 5,
  penalty: 6,
  'drop-ball': 3,
  'half-time': 3,
  'full-time': 3,
};

/** The corner flag, in the fixed frame. The ball goes *in* the arc, not on it. */
const CORNER_ARC = 0.015;

/** Where a penalty is taken from, in the fixed frame. */
const PENALTY_SPOT_X = 0.885;
const PENALTY_SPOT_Y = 0.5;

/**
 * The penalty area, in the fixed frame.
 *
 * Needed as data rather than as constants scattered through the placement code,
 * because both the *setup* (everyone outside the box but the two men in it) and
 * the *test* ("no other player inside the box at delivery") have to agree about
 * where the box is. Two copies of a number is how that test starts passing for
 * the wrong reason.
 *
 * It comes in two, because there are two goals. `penaltyBox(side)` is the area
 * belonging to `side`'s *keeper*, which is the end `side` defends and the end a
 * `side` penalty is taken at.
 */
export const BOX_HOME = { minX: 0, maxX: 0.17, minY: 0.29, maxY: 0.71 } as const;
export const BOX_AWAY = { minX: 0.83, maxX: 1, minY: 0.29, maxY: 0.71 } as const;

/** The area `side` defends, and therefore the one a `side` penalty is taken at. */
export function penaltyBox(side: Side): { minX: number; maxX: number; minY: number; maxY: number } {
  return side === 'home' ? BOX_HOME : BOX_AWAY;
}

/**
 * The six-yard box, where a goal kick is taken from.
 *
 * `side`'s keeper takes it, so it is `side`'s own six-yard box — which is how a
 * home goal kick ended up being placed in the away six, half a pitch from the man
 * who has to take it.
 */
export function sixYardBox(side: Side): { minX: number; maxX: number; minY: number; maxY: number } {
  return side === 'home'
    ? { minX: 0, maxX: SIX_YARD_SPAN, minY: 0.42, maxY: 0.58 }
    : { minX: 1 - SIX_YARD_SPAN, maxX: 1, minY: 0.42, maxY: 0.58 };
}

/** How far the six-yard box reaches out from its goal line. */
const SIX_YARD_SPAN = 0.06;

/** The box nearest the *away* goal, for callers that do not care which side. */
export const BOX = BOX_AWAY;

/** How close to the touchline a throw-in is placed. */
export const TOUCHLINE_Y = 0.012;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * A restart with everything but the taker and the plan filled in.
 *
 * The constructor is the only place a restart is made, so `elapsed` always
 * starts at zero, `setupSeconds` always comes from {@link SETUP_SECONDS} for the
 * kind, and there is exactly one way for a restart to exist.
 */
function restart(
  kind: RestartKind,
  side: Side,
  ballX: number,
  ballY: number,
  extra: { takerId?: PlayerId | null; plan?: SetPiecePlan; outcome?: ActionOutcome } = {},
): RestartState {
  return {
    kind,
    side,
    ballX: clamp(ballX, 0.005, 0.995),
    ballY: clamp(ballY, 0.005, 0.995),
    elapsed: 0,
    setupSeconds: SETUP_SECONDS[kind],
    takerId: extra.takerId ?? null,
    plan: extra.plan,
    outcome: extra.outcome,
  };
}

/**
 * Is the restart still in its setup?
 *
 * The one question `stepSpatial` asks every step, and the answer is what decides
 * whether the ball moves. Setup is the only legitimate stillness in the whole
 * match: the ball does not move and the men do, walking to where they have to
 * be, and the moment the setup is over the delivery is played.
 *
 * Both flags are load-bearing, and they answer two different questions. `placed`
 * says the ball has actually been put down on its spot — set when the chain
 * reaches the step that *delivers* the restart, which for a corner at the end of
 * a long move is not when the move began. `played` says the delivery is over.
 * Elapsed time alone cannot decide either: a restart created long ago and
 * installed now has a large elapsed time and has not yet been arranged, and one
 * placed two steps ago and already taken has a small one.
 */
export function setupPhase(state: RestartState): boolean {
  if (state.placed !== true || state.played === true) return false;
  // The setup ends when the time is up *or* the taker is standing at the ball,
  // whichever comes second, bounded so a taker who cannot arrive cannot hold the
  // pitch dead for ever.
  const overdue = state.takerArrived !== true && state.elapsed < state.setupSeconds + TAKER_GRACE;
  return state.elapsed < state.setupSeconds || overdue;
}

/**
 * The longest a setup waits for a taker who has not arrived.
 *
 * Bounded on both sides. Below it, a corner taker who was still thirty yards out
 * when the clock ran out strikes the ball from thirty yards out, which is a long
 * throw rather than a corner — and it measured 0.097 of a pitch from the flag.
 * Above it, a taker who genuinely cannot arrive holds the pitch dead, which is
 * the one thing a restart must never do.
 */
export const TAKER_GRACE = 3.5;

/**
 * Has the restart run out of setup without the delivery being played?
 *
 * The backstop for a taker who never reached the ball. Without it a restart
 * whose taker is somehow stuck would hold the pitch dead for ever, and the one
 * thing this module promised — that a dead ball is a *finite* pause — would be
 * false.
 */
export function setupExpired(state: RestartState, slack = 6): boolean {
  return state.placed === true && state.played !== true && state.elapsed >= state.setupSeconds + slack;
}

/**
 * The corner.
 *
 * `side` attacks, so the flag is at the end `side` attacks: the home side's
 * corner is at x ≈ 0.985. The ball is placed just inside the arc rather than on
 * the touchline itself, because the arc is where a corner is actually taken
 * from and putting it on the line makes the taker stand in the stands.
 */
export function beginCorner(
  side: Side,
  takerId: PlayerId | null,
  plan: SetPiecePlan | undefined,
  outcome: ActionOutcome | undefined,
  cornerY?: number,
): RestartState {
  const x = side === 'home' ? 1 - CORNER_ARC : CORNER_ARC;
  const y = cornerY === undefined ? 0.5 : cornerY < 0.5 ? CORNER_ARC : 1 - CORNER_ARC;
  return restart('corner', side, x, y, { takerId, plan, outcome });
}

/**
 * A throw-in.
 *
 * The ball goes *on* the touchline, which is the point of the whole thing: a
 * throw-in the eye cannot identify as a throw-in is not a throw-in. It is
 * clamped to within {@link TOUCHLINE_Y} of the line rather than exactly on it,
 * because a ball's centre is never on the chalk.
 */
export function beginThrowIn(
  side: Side,
  x: number,
  y: number,
  takerId: PlayerId | null,
  plan: SetPiecePlan | undefined,
  outcome: ActionOutcome | undefined,
): RestartState {
  const near = y < 0.5;
  return restart('throw-in', side, clamp(x, 0.01, 0.99), near ? TOUCHLINE_Y : 1 - TOUCHLINE_Y, {
    takerId,
    plan,
    outcome,
  });
}

/**
 * A free kick.
 *
 * From wherever it was given. This is the restart that fixes the foul symptom:
 * the ball is placed at the *fouled player's actual position on the pitch*, so
 * the two men in the challenge are standing together when the ball is set down
 * between them, rather than being written into an event at coordinates the
 * spatial frame has never heard of.
 */
export function beginFreeKick(
  side: Side,
  x: number,
  y: number,
  takerId: PlayerId | null,
  plan: SetPiecePlan | undefined,
  outcome: ActionOutcome | undefined,
): RestartState {
  return restart('free-kick', side, x, y, { takerId, plan, outcome });
}

/**
 * A penalty.
 *
 * From the spot, with the ball in front of it. The spot is given as a constant
 * rather than derived from the attacking direction because it is the one place
 * on the pitch with an absolute location that everybody agrees on.
 */
export function beginPenalty(
  side: Side,
  takerId: PlayerId | null,
  outcome: ActionOutcome | undefined,
): RestartState {
  const x = side === 'home' ? PENALTY_SPOT_X : 1 - PENALTY_SPOT_X;
  return restart('penalty', side, x, PENALTY_SPOT_Y, {
    takerId,
    outcome,
    plan: {
      kind: 'shot',
      targetId: null,
      // Struck at the goal, from the spot.
      x: side === 'home' ? 0.995 : 0.005,
      y: 0.5,
      duration: 1.3,
    },
  });
}

/**
 * A goal kick.
 *
 * From inside the six-yard box, by the keeper — the one restart where the taker
 * is the goalkeeper, which is why it reads differently from every other one even
 * before anyone knows what it is.
 */
export function beginGoalKick(
  side: Side,
  keeperId: PlayerId | null,
  plan: SetPiecePlan | undefined,
  outcome: ActionOutcome | undefined,
): RestartState {
  // Inside `side`'s own six-yard box, in front of his keeper — not the other
  // end of the pitch, which is where this put it and how a goal kick ended up
  // with the ball a full pitch from the only man allowed to take it.
  const x = side === 'home' ? 0.04 : 0.96;
  return restart('goal-kick', side, x, 0.5, { takerId: keeperId, plan, outcome });
}

/** A drop ball: to the nearest man to where it went out, which is the rule. */
export function beginDropBall(
  side: Side,
  x: number,
  y: number,
  takerId: PlayerId | null,
  plan: SetPiecePlan | undefined,
  outcome: ActionOutcome | undefined,
): RestartState {
  return restart('drop-ball', side, x, y, { takerId, plan, outcome });
}

/** A kick-off, from the centre spot. */
export function beginKickoff(
  side: Side,
  takerId: PlayerId | null,
  plan: SetPiecePlan | undefined,
  outcome: ActionOutcome | undefined,
): RestartState {
  return restart('kickoff', side, 0.5, 0.5, { takerId, plan, outcome });
}

/**
 * Where one man should stand during a restart's setup.
 *
 * This is the whole of what makes a restart legible, and it is a pure function
 * of (his place, his side, the kind) rather than anything about the ball in
 * play — because during a setup there is no football, so a man who was
 * supporting the carrier has nobody to support. Every case is a *specific* place:
 * a wall is nine yards from the ball and on the line between it and the goal, a
 * corner taker is in the arc, and the men outside a penalty are outside the box
 * because that is what the rule says and it is what the crowd expects to see.
 *
 * Returns null for a man the restart has no use for, so the caller can leave him
 * on his shape — which is the right answer for a restart that does not involve
 * him, and is also the only one that is not an invention.
 */
export function restartPositionFor(
  node: RestartPlayer,
  state: RestartState,
  geometry: RestartGeometry,
): { x: number; y: number } | null {
  const isTaker = state.takerId !== null && node.playerId === state.takerId;
  const attacking = node.side === state.side;
  const ball = { x: state.ballX, y: state.ballY };
  // Which way this side is attacking, for building "in front of the ball".
  const attackX = attacking ? 1 : -1;
  const ownGoalX = attacking ? 0 : 1;
  const isKeeper = node.position === 'GK';

  if (isTaker) {
    // The taker stands at the ball. For a throw he stands *on* the line with it
    // overhead; for a corner, just inside the arc; for a penalty, a step behind
    // it, because he runs up to it.
    switch (state.kind) {
      case 'penalty':
        return { x: clamp(ball.x - attackX * 0.06, 0.01, 0.99), y: ball.y };
      case 'goal-kick':
        return { x: ball.x, y: ball.y };
      default:
        return { x: ball.x, y: ball.y };
    }
  }

  switch (state.kind) {
    case 'penalty': {
      // One keeper on his line, everyone else outside the box, and the men who
      // will be in the box standing at the edge of it waiting to be allowed in.
      // This is the case the law is most specific about and the case a viewer
      // checks first, so it is spelled out rather than approximated.
      // The keeper stands on *his own* line. Keying this off the attacking
      // direction rather than off which end his goal is sent every keeper who is
      // not on the attacking side to the wrong end of the pitch, so the keeper
      // facing a home penalty was left 0.39 of a pitch from his own posts.
      if (isKeeper) return { x: ownGoalX === 0 ? 0.05 : 0.95, y: 0.5 };
      // Outside the area, in front of it. The box is whichever end the penalty is
      // being taken at, and "outside" is always its near edge — computing it from
      // the attacking direction instead put the defending side at x = 1.04, which
      // is in the stands, and left them standing inside the box for the whole of
      // the setup.
      const box = penaltyBox(state.side);
      const attackingX = state.side === 'home' ? 1 : -1;
      const slot = geometry.rankOf(node, attacking);
      return {
        x: clamp(attackingX === 1 ? box.minX - 0.04 : box.maxX + 0.04, 0.02, 0.98),
        y: clamp(0.5 + (slot - 3.5) * 0.055, 0.2, 0.8),
      };
    }

    case 'corner': {
      // The attacking side fills the box and the six-yard box; the defending
      // side gets a keeper on his line and markers on the men in front of it.
      if (attacking) {
        const nearPost = geometry.isNearPost(node);
        // Some at the near post, some at the far post, and the rest in between.
        const post = nearPost
          ? { x: attackX === 1 ? 0.97 : 0.03, y: ballYFromCorner(state, attackX) }
          : { x: attackX === 1 ? 0.84 : 0.16, y: ballYFromCorner(state, attackX) };
        return post;
      }
      if (isKeeper) return { x: ownGoalX === 0 ? 0.05 : 0.95, y: 0.5 };
      // Marking: stand goal-side of the man being marked, in his own box.
      const marker = geometry.markedMan(node);
      if (marker) {
        return {
          x: clamp(marker.x + attackX * 0.03, 0.02, 0.98),
          y: clamp(marker.y + (marker.y < 0.5 ? -0.04 : 0.04), 0.03, 0.97),
        };
      }
      return { x: attackX === 1 ? 0.87 : 0.13, y: clamp(ball.y + (node.position === 'CB' ? 0.2 : -0.2), 0.05, 0.95) };
    }

    case 'free-kick': {
      if (isKeeper) return { x: ownGoalX === 0 ? 0.05 : 0.95, y: 0.5 };
      const central = Math.abs(ball.y - 0.5) < 0.25;
      const distanceToOwnGoal = Math.abs(ball.x - ownGoalX);
      if (!attacking && central && distanceToOwnGoal < 0.4) {
        // A wall: on the line between the ball and the goal, nine yards away.
        const dx = ownGoalX - ball.x;
        const dy = 0.5 - ball.y;
        const length = Math.max(0.001, Math.hypot(dx, dy));
        return {
          x: clamp(ball.x + (dx / length) * 0.09, 0.02, 0.98),
          y: clamp(ball.y + (dy / length) * 0.09 + geometry.wallOffset(node), 0.03, 0.97),
        };
      }
      // Everyone else: the attacking side in and around the box, the defending
      // side between them and their own goal.
      const depth = attacking ? penaltyBox(ownGoalX === 0 ? 'away' : 'home').minX - 0.05 : ownGoalX + 0.12;
      const slot = geometry.rankOf(node, attacking);
      return {
        x: attackX === 1 ? depth : 1 - depth,
        y: clamp(0.5 + (slot - 3.5) * 0.06, 0.06, 0.94),
      };
    }

    case 'throw-in': {
      // Nobody forms anything for a throw. The taker throws to a team-mate who
      // has come to receive, and everybody else stands where they stand — so
      // this returns null for all but the receiver, and the shape layer keeps
      // the rest of the side honest.
      if (attacking && geometry.isReceiver(node, state)) {
        // On the line, a few yards inside the pitch, waiting for the ball.
        return { x: clamp(ball.x + attackX * 0.06, 0.01, 0.99), y: ball.y < 0.5 ? 0.06 : 0.94 };
      }
      return null;
    }

    case 'goal-kick': {
      if (isKeeper && attacking) return { x: ball.x, y: ball.y };
      if (isKeeper) return { x: attackX === 1 ? 0.06 : 0.94, y: 0.5 };
      // A keeper taking a goal kick pushes his centre-backs wide of the box so
      // there is somewhere to go.
      if (attacking && (node.position === 'CB' || node.position === 'RB' || node.position === 'LB')) {
        // Wide of the box, so there is somewhere to go. Measured from the keeper's
        // own end rather than from a fixed number, for the same reason the goal
        // kick is.
        const wide = attackX === 1 ? 0.78 : 0.22;
        return { x: wide, y: clamp(ball.y + (node.position === 'RB' ? 0.22 : -0.22), 0.05, 0.95) };
      }
      return null;
    }

    case 'kickoff':
    case 'drop-ball':
    case 'half-time':
    case 'full-time':
    default:
      // A kick-off is its own shape — the two forwards in the centre circle, his
      // side in their own half, the other side on the edge of theirs — and the
      // shape model already draws it, so there is nothing to add. `drop-ball` is
      // genuinely shapeless: the ball is dropped where it stopped and the two
      // nearest men contest it.
      return null;
  }
}

/**
 * Which end of the goal a man is nearer, for a corner.
 *
 * Read off the side of the pitch he is on rather than from his position code,
 * because a centre-back is not always the one at the near post and a full-back
 * often is.
 */
function ballYFromCorner(state: RestartState, attackX: number): number {
  // The corner is taken from one end, so the near post is the post on that end.
  const nearY = state.ballY < 0.5 ? 0.06 : 0.94;
  const farY = state.ballY < 0.5 ? 0.94 : 0.06;
  return attackX === 1 ? nearY : farY;
}