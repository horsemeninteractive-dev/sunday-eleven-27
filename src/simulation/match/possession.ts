import type { PlayerId } from '@/domain/ids';
import type { Match, MatchEvent } from '@/domain/match';
import type { PositionCode } from '@/domain/positions';
import type { Rng } from '../rng';
import { chooseAction, weighActions, type ActionContext, type ActionKind } from './actions';
import { roleProfile } from './roles';
import {
  currentScore,
  eventCoords,
  makeEvent,
  otherSide,
  performanceOf,
  pushEvent,
  textContext,
  type MatchContext,
  type MatchEnvironment,
  type Side,
  SIDES,
} from './core';
import { writeOffside } from './commentary';
import { commitFoul } from './discipline';
import {
  clamp01,
  ensureField,
  linesFor,
  phaseForZone,
  pressureFor,
  progressOf,
  setPhase,
  setPossession,
  setShape,
  shapeFor,
  shapeForSide,
  urgencyFor,
  xFromProgress,
  zoneOf,
} from './field';
import { takeCorner, takeFreeKick, takePenalty, takeThrowIn, goalKick, type RoutineOutcome } from './setPieces';
import { resolveShot } from './shot';
import { playerEffectiveness } from './teamStrength';
import type { MatchActionKind, RestartState } from '@/domain/matchState';
import { shotAction, type TimelineAction } from './actionTimeline';

/**
 * The football itself.
 *
 * A minute used to be one question — "does this side have the ball, and does it
 * shoot?" — which is why a match read as a list of incidents rather than a game.
 * This is the replacement: the minute is divided into *possessions*, and each
 * possession is a run of decisions made by a named player, at a place on the
 * pitch, against defenders who are trying to stop him. Nothing is rolled in the
 * abstract. A shot exists because somebody got the ball somewhere worth shooting
 * from; a turnover exists because a pass did not reach its man or a tackle went
 * in; a foul exists because a challenge failed; a corner exists because a shot
 * was blocked. The consequences are all downstream of the decisions.
 *
 * The loop is small on purpose. It is not twenty-two agents and a physics step —
 * `MAX_ACTIONS` decisions end a possession however long it has run — but every
 * step of it depends on the state the previous step left behind, which is the
 * property the old engine did not have.
 *
 * Everything here draws from the minute's own stream, so the match replays
 * identically from the same seed and a mid-match change (a substitution, a switch
 * of shape) genuinely alters the football from that minute on.
 */

/** Roughly how long each action takes, in match seconds. Drives possessions per minute. */
const ACTION_SECONDS: Record<ActionKind, number> = {
  pass: 3.4,
  carry: 5.2,
  dribble: 4.6,
  cross: 4.2,
  shoot: 3.6,
  clear: 3.0,
  hold: 5.2,
  switch: 4.4,
  through: 3.8,
};

/** Overhead per possession: the ball travelling, throw-ins, a goal kick. */
const POSSESSION_BASE_SECONDS = 7;
/** The most decisions one possession may contain before it fizzles. */
const MAX_ACTIONS = 8;
/** A match minute is sixty seconds of football. */
const MINUTE_SECONDS = 60;
/**
 * How far ahead of the clock the football is decided.
 *
 * The engine is asked to advance the clock by a minute, and answers with a
 * minute's worth of football — so it decides a little past the target, to be
 * sure the slice it hands back is full. The surplus is not thrown away: it is
 * kept on the match as a starting offset, so the *next* minute carries on from
 * where the football actually got to rather than from the clock. That is what
 * lets a possession run across a minute mark. The clock is the label; the
 * football is the truth.
 */
const DECISION_LOOKAHEAD_SECONDS = 8;
/**
 * A safety rail, not a quota: one slice cannot turn into an endless passage.
 *
 * Sized from the clock, not from a per-minute expectation: it is the most
 * possessions a little over a minute of football could plausibly contain, and it
 * exists so a pathological minute cannot spin forever.
 */
const MAX_POSSESSIONS = 14;

const WIDE_ROLES: ReadonlySet<PositionCode> = new Set(['RM', 'LM', 'RW', 'LW', 'RB', 'LB']);

/**
 * How far up the pitch a role plays, 0 (own goal) to 1 (theirs).
 *
 * A stand-in for real positions, and used as one: it says who is ahead of whom,
 * which is what a passer is actually looking for. It is not a claim about where
 * anybody is standing — the watched pitch has its own, true, spatial state.
 */
function roleDepth(position: PositionCode): number {
  switch (position) {
    case 'GK':
      return 0.04;
    case 'CB':
      return 0.2;
    case 'RB':
    case 'LB':
      return 0.33;
    case 'DM':
      return 0.38;
    case 'CM':
      return 0.5;
    case 'RM':
    case 'LM':
      return 0.56;
    case 'AM':
      return 0.68;
    case 'RW':
    case 'LW':
      return 0.73;
    case 'ST':
      return 0.86;
    default:
      return 0.5;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The home side's edge, as a multiplier on whoever is being asked to do something.
 *
 * Home advantage is not a thumb on the scoreline — it is the crowd, the familiar
 * pitch and the lack of a journey, and it shows up in the small things: a pass
 * that finds its man, a fifty-fifty that goes your way. Applied symmetrically, so
 * a neutral venue is genuinely neutral.
 */
function homeEdge(context: MatchContext, side: Side): number {
  return side === 'home' ? context.homeAdvantage : 1 / context.homeAdvantage;
}

/** How wide the pitch is at a role: the men who hug the touchline. */
function roleWidth(position: PositionCode): number {
  switch (position) {
    case 'RW':
    case 'LW':
      return 0.12;
    case 'RM':
    case 'LM':
      return 0.2;
    case 'RB':
    case 'LB':
      return 0.14;
    case 'CB':
      return 0.38;
    default:
      return 0.5;
  }
}

function meanEnergy(match: Match, side: Side): number {
  let total = 0;
  let count = 0;
  for (const slot of match.lineups[side].starting) {
    const performance = match.performances[slot.playerId];
    if (!performance) continue;
    total += performance.energy;
    count += 1;
  }
  return count === 0 ? 100 : total / count;
}

/**
 * Bring the shapes and the pressure readings up to date.
 *
 * Done before every possession rather than once a minute, so a side that has
 * just lost the ball is pressed by a shape that knows it, and a side that has
 * just won it pushes up with it. This is where fatigue and the scoreline get
 * into the football: tired legs cannot hold a high line, and a side chasing a
 * goal late plays higher and leaves more behind.
 */
export function refreshField(match: Match, context: MatchContext, field: NonNullable<Match['field']>): void {
  const score = currentScore(match);
  const possessing = field.ball.possessionSide;
  for (const side of SIDES) {
    const energy = meanEnergy(match, side);
    const goalDifference = (side === 'home' ? score.home - score.away : score.away - score.home);
    const urgency = urgencyFor(side, { minute: match.minute, goalDifference });
    setShape(field, side, shapeFor(context, side, { inPossession: possessing === side, energy, urgency }));
    field.pressure[side] = pressureFor(context, side, { energy, inPossession: possessing === side });
  }
}

/**
 * How hard the man on the ball is being closed down, 0..1.
 *
 * Crowding rises as the ball goes toward the goal being defended, and a side
 * asked to press gets there quicker. It is the one number the decision model
 * really leans on, so it is worth being explicit about where it comes from.
 */
function pressureOn(field: NonNullable<Match['field']>, defendingSide: Side, progress: number, rng: Rng): number {
  const press = field.pressure[defendingSide];
  let pressure = 0.18 + 0.5 * progress;
  pressure *= 0.5 + 0.95 * press;
  pressure += rng.float(-0.12, 0.12);
  return clamp01(pressure);
}

/** The man who already has the ball, or whoever is best placed to pick it up. */
function resolveCarrier(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  preferred: PlayerId | null,
  rng: Rng,
): PlayerId | null {
  const slots = match.lineups[side].starting.filter(
    (slot) => slot.position !== 'GK' && Boolean(env.getPlayer(slot.playerId)),
  );
  if (slots.length === 0) return null;
  if (preferred && slots.some((slot) => slot.playerId === preferred)) return preferred;
  return rng.weighted(
    slots.map((slot) => {
      // Long balls and clearances are picked up by whoever is around the ball,
      // which is the men in the middle more often than the men on the wing.
      const central = slot.position === 'CM' || slot.position === 'DM' || slot.position === 'AM' ? 2.4 : 1;
      const forward = slot.position === 'ST' ? 1.3 : 1;
      return { value: slot.playerId, weight: central * forward };
    }),
  );
}

/** Who intercepts a pass that did not reach its man. */
function chooseIntercepter(match: Match, env: MatchEnvironment, side: Side, rng: Rng): PlayerId | null {
  const entries = match.lineups[side].starting
    .filter((slot) => slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
      return {
        value: player.id,
        weight: Math.max(0.0001, eff.effective.positioning * 0.6 + eff.effective.workRate * 0.25 + eff.effective.tackling * 0.15),
      };
    });
  const usable = entries.filter((entry): entry is { value: PlayerId; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

interface PossessionOutcome {
  side: Side;
  seconds: number;
  nextSide: Side;
  nextPlayerId: PlayerId | null;
  x: number;
  y: number;
  goal: boolean;
  counter: boolean;
  receivers: PlayerId[];
  /** The decisions this possession made, in order, as timed actions. */
  actions: TimelineAction[];
  /**
   * The dead ball this possession ended on, if it ended on one.
   *
   * A corner, a free kick, a throw or a goal kick all leave the football stopped
   * for a few seconds while twenty-two men arrange themselves. That pause used to
   * exist only as arithmetic — seconds added to the possession budget — and the
   * pitch showed the ball appearing at somebody's feet at the other end of it.
   * Carrying the restart on the outcome is what lets the picture show the pause
   * itself rather than skipping over it.
   */
  restart?: RestartState | null;
  /**
   * The delivery that ended it, as the model decided it.
   *
   * Empty for a possession that ended without one, and for everything that is not
   * a restart at all.
   */
  restartActions?: TimelineAction[];
}

/** The contract's verb for one of the possession model's decisions. */
function timelineKind(decision: string): MatchActionKind {
  switch (decision) {
    case 'carry':
      return 'carry';
    case 'dribble':
      return 'dribble';
    case 'cross':
      return 'cross';
    case 'clear':
      return 'clear';
    case 'hold':
      return 'hold';
    case 'switch':
      return 'switch';
    case 'through':
      return 'through';
    case 'shoot':
      return 'shot';
    default:
      return 'pass';
  }
}

interface StepEnd {
  nextSide: Side;
  nextPlayerId: PlayerId | null;
  goal: boolean;
  counter: boolean;
}

/**
 * One possession: from the moment a side wins the ball to the moment it loses it,
 * shoots, or the passage simply runs out of ideas.
 */
function runPossession(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  field: NonNullable<Match['field']>,
  side: Side,
  startPlayerId: PlayerId | null,
  rng: Rng,
  sink: MatchEvent[],
  options: { fromCounter: boolean },
): PossessionOutcome {
  const opponent = otherSide(side);
  const receivers: PlayerId[] = [];
  /** The decisions of this possession, written down as they are made. */
  const log: TimelineAction[] = [];
  refreshField(match, context, field);

  const carrierId = resolveCarrier(match, env, side, startPlayerId, rng);
  if (!carrierId) {
    return { side, seconds: 2, nextSide: opponent, nextPlayerId: null, x: field.ball.x, y: field.ball.y, goal: false, counter: false, receivers, actions: log };
  }
  setPossession(field, side, carrierId);
  setPhase(field, options.fromCounter ? 'transition' : phaseForZone(zoneOf(side, field.ball.x)));

  let seconds = POSSESSION_BASE_SECONDS;
  let current = carrierId;
  // Whether this side shielded the ball last time it had it. Kept on the field so
  // it survives across the possessions a hold ends, which is the only way two
  // shields can end up back to back.

  /** A fresh ball is a fresh choice about what to do with it. */
  const clearHeld = (): void => {
    if (field.heldRecently) field.heldRecently[side] = false;
  };
  /** The man who played the last pass, so a goal can credit the assist. */
  let lastPasser: PlayerId | null = null;

  const end = (outcome: StepEnd, x: number, y: number, routine?: RoutineOutcome): PossessionOutcome => ({
    side,
    seconds,
    receivers,
    actions: log,
    goal: outcome.goal,
    counter: outcome.counter,
    nextSide: outcome.nextSide,
    nextPlayerId: outcome.nextPlayerId,
    x,
    y,
    // A routine's delivery is appended to this chain's timeline rather than kept
    // beside it: the cross really is the last thing this possession did, and the
    // pitch plays one chain at a time. The restart rides along with it, so the
    // dead ball is arranged immediately before the ball that ends it.
    restart: routine?.restart ?? null,
    restartActions: routine?.actions ?? [],
  });

  /** After a foul: judge it, then run the restart it earns. */
  const afterFoul = (offenderId: PlayerId | null, victimId: PlayerId | null, progress: number): PossessionOutcome => {
    const inBox = progress > 0.83;
    const foul = commitFoul(match, env, context, opponent, offenderId, victimId, inBox, rng, sink);
    seconds += 20;
    // The free kick is taken from where the fouled man actually is, not from the
    // field model's idea of where the ball was. That is the difference between a
    // foul whose two men are standing together on the pitch and a foul written at
    // coordinates nobody was ever at — and it is read from the spatial layer when
    // there is a pitch to read it from.
    const spot = foul ? { x: foul.x, y: foul.y } : foulSpot(match, null);
    if (foul?.penalty) {
      const routine = takePenalty(match, env, context, side, rng, sink);
      return end(routineToStep(routine), routine.x, routine.y, routine);
    }
    const routine = takeFreeKick(match, env, context, side, rng, sink, spot);
    return end(routineToStep(routine), routine.x, routine.y, routine);
  };

  /** After the ball goes out: a corner, a throw, or the keeper starting again. */
  const afterOutOfPlay = (behindTheirGoal: boolean): PossessionOutcome => {
    // Where the ball actually left the pitch is the field model's own answer,
    // and it is the right one.
    //
    // It used to be overridden with the *continuous* ball's current position,
    // which is not the same thing at all: by the time the decision layer decides
    // the ball has gone out, the spatial frame has carried on for a few more steps
    // and its ball is somewhere else entirely — usually halfway up the pitch. The
    // throw was then placed from wherever the picture happened to be, which is
    // how a throw-in ended up taken from the wrong touchline with the ball twenty
    // yards from where it went out. The frame has no better answer to this
    // question than the model that noticed the ball leaving.
    const spot = { x: field.ball.x, y: field.ball.y };
    if (behindTheirGoal) {
      if (rng.chance(0.5)) {
        const routine = takeCorner(match, env, context, side, rng, sink);
        seconds += 18;
        return end(routineToStep(routine), routine.x, routine.y, routine);
      }
      const routine = goalKick(match, opponent, rng);
      seconds += 14;
      return end(routineToStep(routine), routine.x, routine.y, routine);
    }
    const routine = takeThrowIn(match, env, context, side, rng, sink, spot);
    seconds += 9;
    return end(routineToStep(routine), routine.x, routine.y, routine);
  };

  for (let action = 0; action < MAX_ACTIONS; action += 1) {
    // A man sent off during this passage is not still on the ball.
    if (!match.lineups[side].starting.some((slot) => slot.playerId === current)) break;
    const progress = progressOf(side, field.ball.x);
    const zone = zoneOf(side, field.ball.x);
    const pressure = pressureOn(field, opponent, progress, rng);
    const carrier = env.getPlayer(current);
    const performance = performanceOf(match, current);
    if (!carrier || !performance) break;

    const effective = playerEffectiveness(carrier, performance.positionPlayed, {
      energy: performance.energy,
      carryingInjury: Boolean(performance.injuryDetail),
    }).effective;

    const carrierDepth = roleDepth(performance.positionPlayed);
    const teammates = match.lineups[side].starting.filter((slot) => slot.playerId !== current && slot.position !== 'GK');
    const optionsAhead = teammates.filter((slot) => roleDepth(slot.position) > carrierDepth + 0.08).length;
    const optionsWide = teammates.filter((slot) => WIDE_ROLES.has(slot.position)).length;
    // Only roles that make runs beyond the ball count as somewhere to put one.
    const runnersAhead = teammates.filter((entry) => {
      if (roleDepth(entry.position) <= carrierDepth + 0.08) return false;
      return roleProfile(entry.role).runsInBehind;
    }).length;

    const score = currentScore(match);
    const goalDifference = side === 'home' ? score.home - score.away : score.away - score.home;
    const urgency = urgencyFor(side, { minute: match.minute, goalDifference });

    // His role comes from the lineup, never from his position: a deep-lying and a
    // mezzala play the same position and are different footballers, and reading
    // the position back would quietly collapse the two into one.
    const slot = match.lineups[side].starting.find((entry) => entry.playerId === current);

    const actionContext: ActionContext = {
      position: performance.positionPlayed,
      role: roleProfile(slot?.role),
      isKeeper: performance.positionPlayed === 'GK',
      progress,
      y: field.ball.y,
      zone,
      pressure,
      optionsTotal: teammates.length,
      optionsAhead,
      optionsWide,
      runnersAhead,
      effective,
      energy: performance.energy,
      profile: context[side].profile,
      tactics: context[side].tactics,
      urgency,
      retaining: goalDifference > 0 && match.minute > 70,
      counter: options.fromCounter && action === 0,
    };

    const choice = chooseAction(actionContext, rng);
    const actionStart = seconds;
    seconds += ACTION_SECONDS[choice.kind];
    const duration = ACTION_SECONDS[choice.kind];
    /**
     * Record the decision before it is resolved, and annotate the record as the
     * branch below settles it. The record is a reference into `log`, so an early
     * return still carries the action it just made with the outcome it reached.
     */
    const timeline: TimelineAction = {
      kind: timelineKind(choice.kind),
      decision: choice.kind,
      side,
      playerId: current,
      targetPlayerId: null,
      fromX: field.ball.x,
      fromY: field.ball.y,
      toX: field.ball.x,
      toY: field.ball.y,
      startSecond: actionStart,
      duration,
      outcome: 'carry',
    };
    log.push(timeline);

    if (env.trace) {
      const table = weighActions(actionContext)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4)
        .map((option) => `${option.kind} ${Math.round(option.weight * 100) / 100}`)
        .join(', ');
      env.trace({
        minute: match.minute,
        half: match.half,
        phase: field.phase,
        side,
        playerId: current,
        zone,
        message: `${carrier.surname} (${performance.positionPlayed}) at ${(progress * 100).toFixed(0)}% — pressure ${pressure.toFixed(2)} — chose ${choice.kind}`,
        detail: { action: choice.kind, progress: Math.round(progress * 100) / 100, options: table, energy: Math.round(performance.energy) },
      });
    }

    const kind = choice.kind;

    // --- Shooting -----------------------------------------------------------
    if (kind === 'shoot') {
      const nearness = clamp01((progress - 0.56) / 0.34);
      const angle = 1 - clamp01(Math.abs(field.ball.y - 0.5) / 0.42);
      const chanceQuality = clamp01(0.18 + 0.5 * nearness * (0.55 + 0.45 * angle) - 0.22 * pressure);
      const shot = resolveShot(
        match,
        env,
        context,
        side,
        {
          shooterId: current,
          assisterId: lastPasser,
          chanceQuality,
          x: field.ball.x,
          y: field.ball.y,
          pressure,
          assistKind: 'pass',
          blockers: progress > 0.84 ? 2 : 1,
          fromSetPiece: false,
        },
        rng,
        sink,
      );
      timeline.toX = side === 'home' ? 1 : 0;
      timeline.toY = clamp(0.5 + (field.ball.y - 0.5) * 0.4, 0.15, 0.85);
      if (shot.type === 'goal') {
        timeline.outcome = 'goal';
        return end({ nextSide: opponent, nextPlayerId: null, goal: true, counter: false }, 0.5, 0.5);
      }
      if (shot.type === 'shot-blocked') {
        // Blocked: it usually comes back off a defender for a corner or a scrap.
        timeline.outcome = 'blocked';
        return rng.chance(0.4)
          ? afterOutOfPlay(true)
          : end(turnoverStep(opponent, false), field.ball.x, field.ball.y);
      }
      if (shot.type === 'shot-saved') {
        timeline.outcome = 'saved';
        return rng.chance(0.25)
          ? end({ nextSide: side, nextPlayerId: current, goal: false, counter: false }, xFromProgress(side, clamp(progress + 0.02, 0.1, 0.95)), clamp(field.ball.y + rng.float(-0.1, 0.1), 0.08, 0.92))
          : end(turnoverStep(opponent, true), xFromProgress(opponent, 0.06), 0.5);
      }
      // Off target: a goal kick, or occasionally a corner off a deflection.
      timeline.outcome = 'off-target';
      return afterOutOfPlay(true);
    }

    // --- Carrying -----------------------------------------------------------
    if (kind === 'carry') {
      const pace = effective.pace / 20;
      const control = effective.ballControl / 20;
      // Space runs out as the pitch compresses: there is no carrying through a
      // packed final third, and trying to is how possession gets turned over.
      const room = progress > 0.66 ? 0.55 : progress > 0.5 ? 0.8 : 1;
      const advance = (0.05 + 0.1 * pace + rng.float(-0.01, 0.03)) * room;
      // Floored, deliberately. A great carrier in no pressure would otherwise
      // never be dispossessed, and a side that never loses the ball plays the
      // whole match in the opposition half — which is what turns a quality gap
      // into a procession rather than a contest.
      const risk = clamp(0.06 + 0.36 * pressure - 0.28 * control + (progress > 0.7 ? 0.12 : 0), 0.05, 0.75);
      if (rng.chance(risk)) {
        const tackle = contest(match, env, opponent, current, effective.tackling, pressure, rng, context);
        if (tackle === 'foul') {
          timeline.outcome = 'foul';
          return afterFoul(null, current, progress);
        }
        if (tackle === 'won') {
          timeline.outcome = 'turnover';
          return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), field.ball.x, field.ball.y);
        }
        // Beaten but not dispossessed: he keeps going, just not as far.
      }
      const nextProgress = clamp(progress + advance, 0.04, 0.97);
      field.ball.x = xFromProgress(side, nextProgress);
      field.ball.y = clamp(field.ball.y + rng.float(-0.05, 0.05), 0.05, 0.95);
      timeline.toX = field.ball.x;
      timeline.toY = field.ball.y;
      continue;
    }

    // --- Dribbling ----------------------------------------------------------
    if (kind === 'dribble') {
      const duel = contest(match, env, opponent, current, effective.ballControl * 0.55 + effective.agility * 0.45, pressure, rng, context);
      if (duel === 'foul') {
        timeline.outcome = 'foul';
        return afterFoul(null, current, progress);
      }
      if (duel === 'won') {
        timeline.outcome = 'turnover';
        return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), field.ball.x, field.ball.y);
      }
      const nextProgress = clamp(progress + 0.09 + effective.pace / 200, 0.05, 0.97);
      field.ball.x = xFromProgress(side, nextProgress);
      field.ball.y = clamp(field.ball.y + rng.float(-0.08, 0.08), 0.06, 0.94);
      timeline.toX = field.ball.x;
      timeline.toY = field.ball.y;
      continue;
    }

    // --- Crossing -----------------------------------------------------------
    if (kind === 'cross') {
      const attack = effective.crossing * 0.6 + effective.ballControl * 0.4;
      const defence = aerialPowerOf(match, env, opponent) * context[opponent].strength.organisation;
      const quality = clamp01(0.3 + (attack / Math.max(1, defence) - 1) * 0.35 - 0.15 * pressure + rng.float(-0.08, 0.08));
      if (rng.chance(clamp01(quality))) {
        const headerer = bestHeader(match, env, side, rng);
        if (headerer) {
          const headerX = xFromProgress(side, 0.93);
          const headerY = clamp(0.5 + rng.float(-0.16, 0.16), 0.24, 0.76);
          const shot = resolveShot(
            match,
            env,
            context,
            side,
            {
              shooterId: headerer,
              assisterId: current,
              chanceQuality: clamp01(0.28 + quality * 0.35),
              x: headerX,
              y: headerY,
              pressure: 0.5,
              assistKind: 'cross',
              blockers: 1,
              fromSetPiece: false,
            },
            rng,
            sink,
          );
          // The cross found its man, so it is completed — the header is the next
          // action of the minute, not a rewrite of this one.
          timeline.outcome = 'completed';
          timeline.targetPlayerId = headerer;
          timeline.toX = headerX;
          timeline.toY = headerY;
          const header = shotAction({
            kind: 'shot',
            decision: 'shoot',
            side,
            playerId: headerer,
            targetPlayerId: null,
            fromX: headerX,
            fromY: headerY,
            toX: side === 'home' ? 1 : 0,
            toY: headerY,
            startSecond: actionStart + duration,
            outcome: shot.type === 'goal' ? 'goal' : shot.type === 'shot-blocked' ? 'blocked' : shot.type === 'shot-saved' ? 'saved' : 'off-target',
          });
          log.push(header);
          if (shot.type === 'goal') return end({ nextSide: opponent, nextPlayerId: null, goal: true, counter: false }, 0.5, 0.5);
          if (shot.type === 'shot-blocked') return afterOutOfPlay(true);
          return end(turnoverStep(opponent, true), xFromProgress(opponent, 0.06), 0.5);
        }
      }
      // Overhit or headed clear.
      timeline.outcome = 'incomplete';
      if (rng.chance(0.3)) return afterOutOfPlay(false);
      return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), xFromProgress(opponent, clamp(0.55 + rng.float(0, 0.25), 0.3, 0.9)), clamp(rng.float(0.1, 0.9), 0.06, 0.94));
    }

    // --- Clearing -----------------------------------------------------------
    if (kind === 'clear') {
      const findsTeammate = rng.chance(clamp01(0.22 + effective.passing / 60));
      const targetProgress = clamp(progress + 0.28, 0.25, 0.75);
      if (findsTeammate) {
        field.ball.x = xFromProgress(side, targetProgress);
        field.ball.y = clamp(0.5 + rng.float(-0.34, 0.34), 0.06, 0.94);
        timeline.outcome = 'completed';
        timeline.toX = field.ball.x;
        timeline.toY = field.ball.y;
        current = resolveCarrier(match, env, side, null, rng) ?? current;
        timeline.targetPlayerId = current;
        setPossession(field, side, current);
        continue;
      }
      timeline.outcome = 'incomplete';
      return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), xFromProgress(opponent, clamp(0.4 + rng.float(0, 0.3), 0.25, 0.85)), clamp(rng.float(0.1, 0.9), 0.06, 0.94));
    }

    // --- Holding ------------------------------------------------------------
    if (kind === 'hold') {
      if (rng.chance(clamp(0.12 + 0.3 * pressure, 0.1, 0.6))) {
        const tackle = contest(match, env, opponent, current, effective.ballControl, pressure, rng, context);
        if (tackle === 'foul') {
          timeline.outcome = 'foul';
          return afterFoul(null, current, progress);
        }
        timeline.outcome = 'turnover';
        return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), field.ball.x, field.ball.y);
      }
      // A hold is an *action*, so it is written into the timeline like one.
      //
      // It used to be a gap: seconds added to the budget, loop carrying on,
      // nothing on the pitch to show for them. That is what put a dead patch in
      // the middle of a move — the carrier decided to stand still, the decision
      // model spent the time, and the ball did nothing at all for as long as the
      // shield nominally lasted. Written as a step, the carrier shields the ball
      // and the chain waits him out, and the pause is bounded by the action
      // rather than by how long the arithmetic allowed.
      //
      // The possession *ends* here rather than continuing, so the next decision is
      // made with the ball still at his feet. That is what makes it a fresh
      // decision rather than a pause with extra steps around it.
      //
      // It also means the flag has to live on the field rather than in this
      // function: a hold returns from here, so a local one is reset before the
      // next decision is made, and two shields back to back are always allowed.
      // Each is bounded; together they are a ball standing still for longer than
      // either, which is how a chain of `[pass, hold, hold]` happened. The flag is
      // cleared when the ball is genuinely turned over, which is the thing that
      // makes holding it a fresh choice again.
      const held = (field.heldRecently ??= { home: false, away: false });
      if (held[side]) continue;
      held[side] = true;
      log.push({ ...timeline, kind: 'hold', outcome: 'completed' });
      seconds += ACTION_SECONDS.hold;
      return end({ nextSide: side, nextPlayerId: current, goal: false, counter: false }, field.ball.x, field.ball.y);
    }

    // --- Switching ----------------------------------------------------------
    if (kind === 'switch') {
      const target = pickTarget(match, env, side, current, progress, effective.positioning, optionsWide > 0 ? 'wide' : 'any', 0.06, rng);
      if (!target) continue;
      timeline.targetPlayerId = target.playerId;
      timeline.toX = xFromProgress(side, target.progress);
      timeline.toY = clamp(target.y, 0.06, 0.94);
      const success = resolvePassAttempt(match, env, context, side, current, target, progress, pressure, effective.passing, effective.decisions, effective.composure, rng);
      if (!success) {
        timeline.outcome = 'incomplete';
        return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), field.ball.x, field.ball.y);
      }
      timeline.outcome = 'completed';
      field.ball.x = xFromProgress(side, target.progress);
      field.ball.y = clamp(target.y, 0.06, 0.94);
      current = target.playerId;
      clearHeld();
      receivers.push(current);
      lastPasser = target.from;
      setPossession(field, side, current);
      continue;
    }

    // --- Through balls ------------------------------------------------------
    if (kind === 'through') {
      const target = pickTarget(match, env, side, current, progress, effective.positioning, 'forward', 0.34, rng);
      if (!target) continue;
      // A ball played in behind is played against a line, and a line is a trap.
      // How often it springs depends on how high the defence holds and on how
      // well the passer reads it — a careless ball is caught, a good one is not.
      // A ball played in behind is played against a line, and a line is a trap. Where
      // that line actually is depends on where the ball is now and who has it —
      // which is the point of the shape being a set rather than a number. The
      // ball is being played forward from `side`, so it is read in the
      // opponent's frame: how far up their pitch the ball already is, and what
      // they are holding with it in their hands.
      const theirLine = linesFor(shapeForSide(field, opponent), {
        inPossession: false,
        progress: progressOf(opponent, field.ball.x),
      }).back;
      const offsideChance = clamp01(0.02 + theirLine * 0.07 + (1 - effective.decisions / 20) * 0.08);
      timeline.targetPlayerId = target.playerId;
      timeline.toX = xFromProgress(side, clamp(target.progress, 0.1, 0.96));
      timeline.toY = clamp(target.y, 0.1, 0.9);
      if (rng.chance(offsideChance)) {
        const caught = env.getPlayer(target.playerId);
        pushEvent(
          match,
          makeEvent(match, 'offside', {
            minute: match.minute,
            side,
            playerId: target.playerId,
            secondaryPlayerId: current,
            text: writeOffside(textContext(env, match, side, rng, { player: caught ?? null, partner: carrier })),
            ...eventCoords(match, field.ball.x, field.ball.y),
            importance: 1,
          }),
          sink,
        );
        timeline.outcome = 'incomplete';
        return end({ nextSide: opponent, nextPlayerId: null, goal: false, counter: false }, xFromProgress(opponent, clamp(target.progress, 0.1, 0.9)), target.y);
      }
      const success = resolvePassAttempt(match, env, context, side, current, target, progress, pressure + 0.1, effective.passing, effective.decisions, effective.composure, rng);
      receivers.push(target.playerId);
      if (!success) {
        timeline.outcome = 'incomplete';
        return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), xFromProgress(opponent, 0.12), 0.5);
      }
      timeline.outcome = 'completed';
      field.ball.x = xFromProgress(side, clamp(target.progress, 0.1, 0.96));
      field.ball.y = clamp(target.y, 0.1, 0.9);
      current = target.playerId;
      clearHeld();
      lastPasser = target.from;
      setPossession(field, side, current);
      continue;
    }

    // --- Passing: the ordinary business of football -------------------------
    const target = pickTarget(match, env, side, current, progress, effective.positioning, 'any', 0.17, rng);
    if (!target) {
      // Nowhere to go: he does the honest thing and gets rid of it.
      timeline.outcome = 'incomplete';
      return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), xFromProgress(opponent, clamp(0.45 + rng.float(0, 0.25), 0.3, 0.85)), clamp(rng.float(0.12, 0.88), 0.06, 0.94));
    }
    timeline.targetPlayerId = target.playerId;
    timeline.toX = xFromProgress(side, target.progress);
    timeline.toY = clamp(target.y, 0.06, 0.94);
    const success = resolvePassAttempt(match, env, context, side, current, target, progress, pressure, effective.passing, effective.decisions, effective.composure, rng);
    if (!success) {
      timeline.outcome = 'incomplete';
      if (rng.chance(0.14)) return afterOutOfPlay(false);
      return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), field.ball.x, field.ball.y);
    }
    timeline.outcome = 'completed';
    field.ball.x = xFromProgress(side, target.progress);
    field.ball.y = clamp(target.y, 0.06, 0.94);
    receivers.push(target.playerId);
    current = target.playerId;
    clearHeld();
    lastPasser = target.from;
    setPossession(field, side, current);
  }

  // Out of ideas: the move dies in midfield and the other lot pick it up.
  return end(turnoverStep(opponent, canCounter(match, context, field, opponent, side, rng)), field.ball.x, field.ball.y);
}

/** A clean turnover: the winners have it where the ball is, or deep if they cleared. */
function turnoverStep(nextSide: Side, counter: boolean): StepEnd {
  return { nextSide, nextPlayerId: null, goal: false, counter };
}

function routineToStep(routine: RoutineOutcome): StepEnd {
  return { nextSide: routine.nextSide, nextPlayerId: routine.nextPlayerId, goal: routine.goal, counter: routine.counter };
}

/**
 * Where a foul happened, in pitch coordinates.
 *
 * Taken from the fouled player's own position where he can be found, because he
 * is the man who was fouled and the ball goes down next to him. Falls back to
 * the ball for a match with no pitch, which is the old behaviour exactly.
 */
function foulSpot(match: Match, victimId: PlayerId | null): { x: number; y: number } {
  const spatial = match.spatial;
  if (!spatial) return { x: match.field?.ball.x ?? 0.5, y: match.field?.ball.y ?? 0.5 };
  const victim = victimId ? spatial.players.find((node) => node.playerId === victimId) : undefined;
  if (victim) return { x: victim.x, y: victim.y };
  return { x: spatial.ball.x, y: spatial.ball.y };
}

/**
 * Could the side that just won the ball break from here?
 *
 * A counter needs three things: the side that lost it to have been high up the
 * pitch, that side to be structurally exposed, and the winners to have the legs
 * to get away. Nothing is guaranteed — the ball still has to be played.
 */
function canCounter(
  match: Match,
  context: MatchContext,
  field: NonNullable<Match['field']>,
  winner: Side,
  loser: Side,
  rng: Rng,
): boolean {
  // How much room the loser is leaving: the back line they are actually holding,
  // given where the ball is and that they do not have it.
  const loserLine = linesFor(shapeForSide(field, loser), {
    inPossession: false,
    progress: progressOf(loser, field.ball.x),
  }).back;
  const exposure = context[loser].profile.counterVulnerability;
  const paceEdge = context[winner].strength.pace / Math.max(0.5, context[loser].strength.pace);
  // A tired side cannot break eighty yards, however open the game is.
  const legs = meanEnergy(match, winner) / 100;
  const appetite = winner === 'home' ? 0.05 : 0;
  const probability = clamp01(
    0.16 + (loserLine - 0.2) * 0.7 + (exposure - 1) * 0.85 + (paceEdge - 1) * 0.35 + appetite + (legs - 0.7) * 0.4,
  );
  return rng.chance(probability);
}

/**
 * A fifty-fifty on the ball.
 *
 * Returns whether the carrier was fouled, whether he was dispossessed, or
 * neither — the tackler getting a foot in without winning it cleanly.
 */
function contest(
  match: Match,
  env: MatchEnvironment,
  defendingSide: Side,
  carrierId: PlayerId,
  carrierScore: number,
  pressure: number,
  rng: Rng,
  context: MatchContext,
): 'foul' | 'won' | 'lost' {
  const carrierPerf = performanceOf(match, carrierId);
  const tackler = chooseChallenger(match, env, defendingSide, carrierScore, rng);
  if (!tackler) return 'lost';
  const carrierAbility = (carrierScore / 20) * (0.7 + 0.6 * clamp01((carrierPerf?.energy ?? 70) / 100));
  const defenderAbility =
    ((tackler.tackling * 0.55 + tackler.positioning * 0.2 + tackler.strength * 0.25) / 20) *
    (0.7 + 0.6 * clamp01(tackler.energy / 100)) *
    homeEdge(context, defendingSide);
  // Compressed deliberately: over ninety minutes a better player should win more
  // of these, but a fifty-fifty that a much better player always wins is not
  // football, and it turns a quality gap into a procession. The base is high
  // because a challenge is not a coin toss between equals — the defender is
  // going for the ball with a man trying to get away from him, and he wins it
  // more often than not even against somebody better.
  const winProbability = clamp01(0.35 + (defenderAbility - carrierAbility) * 0.45 + pressure * 0.2);
  const roll = rng.next();
  if (roll < winProbability) {
    // A clean tackle is rarer than a mistimed one — which is exactly why fouls
    // cluster around the players who lose the ball.
    const clean = rng.chance(clamp01(0.66 - tackler.aggression * 0.03));
    if (clean) {
      const performance = performanceOf(match, tackler.playerId);
      if (performance) performance.tackles += 1;
      return 'won';
    }
    return 'foul';
  }
  return 'lost';
}

interface Challenger {
  playerId: PlayerId;
  tackling: number;
  positioning: number;
  strength: number;
  aggression: number;
  energy: number;
}

function chooseChallenger(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  carrierScore: number,
  rng: Rng,
): Challenger | null {
  const entries = match.lineups[side].starting
    .filter((slot) => slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy }).effective;
      const defensive = slot.position === 'CB' || slot.position === 'DM' || slot.position === 'RB' || slot.position === 'LB' ? 1.5 : 1;
      const challenger: Challenger = {
        playerId: player.id,
        tackling: eff.tackling,
        positioning: eff.positioning,
        strength: eff.strength,
        aggression: eff.aggression,
        energy: performance?.energy ?? 100,
      };
      return { value: challenger, weight: defensive * Math.max(1, eff.tackling) };
    });
  const usable = entries.filter((entry): entry is { value: Challenger; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  void carrierScore;
  return rng.weighted(usable);
}

interface PassTarget {
  playerId: PlayerId;
  from: PlayerId;
  progress: number;
  y: number;
  /** How ambitious the pass is: a long forward ball vs a safe square one. */
  ambition: number;
}

/**
 * Who the ball is played to.
 *
 * Not a uniform pick. A passer looks for the man furthest up the pitch he can
 * actually reach, weighted by his own vision (a limited player does not see the
 * pass a good one does), by how much the side is trying to get it wide, and by
 * how safe the ball needs to be given the pressure he is under.
 */
function pickTarget(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  carrierId: PlayerId,
  progress: number,
  vision: number,
  preference: 'any' | 'wide' | 'forward',
  /** The furthest up the pitch this kind of ball can carry the move. */
  reach: number,
  rng: Rng,
): PassTarget | null {
  const carrierPerf = performanceOf(match, carrierId);
  const carrierDepth = carrierPerf ? roleDepth(carrierPerf.positionPlayed) : progress;
  const visionFactor = clamp01(vision / 20);

  const entries = match.lineups[side].starting
    .filter((slot) => slot.playerId !== carrierId && slot.position !== 'GK' && Boolean(env.getPlayer(slot.playerId)))
    .map((slot) => {
      const depth = roleDepth(slot.position);
      const forwardness = depth - carrierDepth;
      const wide = WIDE_ROLES.has(slot.position);
      const runsInBehind = roleProfile(slot.role).runsInBehind;
      let weight = 0.9;
      // Forward passes are the point of football, but they need a player who can
      // see them — a limited passer keeps it safe.
      weight += Math.max(0, forwardness) * (1.6 + 2.4 * visionFactor);
      weight += Math.max(0, -forwardness) * 0.5;
      if (wide) weight *= 1.1;
      if (preference === 'wide' && wide) weight *= 2.2;
      if (preference === 'forward') weight *= forwardness > 0 ? 2.4 : 0.3;
      // A ball played in behind is only worth playing to somebody who will run
      // it. The action itself is already gated on a runner being available, so
      // here it only decides which of the men ahead the ball finds: the one
      // whose job is to attack the space behind, not the one who will stand and
      // wait for it to arrive at his feet.
      if (runsInBehind && preference === 'forward') weight *= 1.25;
      return {
        value: {
          playerId: slot.playerId,
          from: carrierId,
          // The ball goes to where the man is, but a move only travels so far on
          // one pass: without this cap every ball to a striker would carry the
          // move from the halfway line to the edge of the box in a single stride,
          // and the match would be nothing but shots.
          progress: clamp(Math.min(depth + rng.float(-0.06, 0.06), progress + reach), 0.04, 0.97),
          y: clamp(roleWidth(slot.position) + rng.float(-0.08, 0.08), 0.05, 0.95),
          ambition: clamp01(forwardness + 0.3),
        },
        weight: Math.max(0.0001, weight),
      };
    });

  if (entries.length === 0) return null;
  return rng.weighted(entries);
}

/**
 * Play the pass, and see whether it arrives.
 *
 * Difficulty is the distance and the angle and, above all, the pressure. Ability
 * is the passer's passing first, then his decisions and composure. A completed
 * pass is recorded for the passer and appears in his statistics; a ball that does
 * not arrive is an interception for the defender who read it.
 */
function resolvePassAttempt(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  side: Side,
  passerId: PlayerId,
  target: PassTarget,
  progress: number,
  pressure: number,
  passing: number,
  decisions: number,
  composure: number,
  rng: Rng,
): boolean {
  const passerPerf = performanceOf(match, passerId);
  const opponent = otherSide(side);
  const ability =
    ((passing * 0.5 + decisions * 0.22 + composure * 0.18 + context[side].strength.control * 2) / 20) * homeEdge(context, side);
  // A short square ball is nearly always made; a long forward one into a crowd
  // is the hardest thing in the game, which is why the forwardness term matters
  // more than the pressure term.
  const forwardness = Math.max(0, target.progress - progress);
  // Playing through a defence is harder the further forward the ball is going:
  // past a certain point there are simply more bodies between the passer and his
  // man. This is what a defensive line actually does, and it is why a side can
  // knock it about in midfield all afternoon without ever getting a sight of goal.
  const territory = clamp01((target.progress - 0.55) / 0.3);
  // How hard the *opposition* makes it. Passing is not a solo act: a side that
  // is well organised and quick to close down takes away the lanes, and a poor
  // one lets you play through it all afternoon. Without this the defenders were
  // decorative — only the passer's own ability decided whether a ball arrived,
  // which is why a better side did not actually keep the ball any better than a
  // weaker one.
  const marking = clamp01((context[opponent].strength.defence - 1) * 0.9);
  const difficulty = clamp01(pressure * 0.6 + forwardness * 1.4 + territory * 0.5 + marking * 0.35);
  const probability = clamp01(0.85 + (ability - 0.5) * 0.6 - difficulty * 0.45);
  const success = rng.chance(probability);

  if (passerPerf) {
    passerPerf.passes += 1;
    if (success) passerPerf.passesCompleted += 1;
  }

  if (success) {
    if (env.trace) {
      env.trace({
        minute: match.minute,
        half: match.half,
        phase: match.field?.phase ?? 'progression',
        side,
        playerId: passerId,
        zone: null,
        message: `${env.getPlayer(passerId)?.surname ?? 'someone'} finds ${env.getPlayer(target.playerId)?.surname ?? 'someone'} (p ${(probability * 100).toFixed(0)}%)`,
        detail: { difficulty: Math.round(difficulty * 100) / 100 },
      });
    }
    return true;
  }

  // Most misplaced balls are not read by anybody in particular — they are just
  // lost. Only a genuine read is credited as an interception, or the panel would
  // show more interceptions than the match had passes worth intercepting.
  let intercepter: PlayerId | null = null;
  if (rng.chance(0.12)) {
    intercepter = chooseIntercepter(match, env, opponent, rng);
    const intercepterPerf = intercepter ? performanceOf(match, intercepter) : undefined;
    if (intercepterPerf) intercepterPerf.interceptions += 1;
  }
  if (env.trace) {
    env.trace({
      minute: match.minute,
      half: match.half,
      phase: match.field?.phase ?? 'progression',
      side,
      playerId: passerId,
      zone: null,
      message: `pass from ${env.getPlayer(passerId)?.surname ?? 'someone'} intercepted by ${intercepter ? env.getPlayer(intercepter)?.surname : 'nobody'}`,
      detail: { probability: Math.round(probability * 100) / 100 },
    });
  }
  return false;
}

/** The biggest man in the box to aim a cross at. */
function bestHeader(match: Match, env: MatchEnvironment, side: Side, rng: Rng): PlayerId | null {
  const entries = match.lineups[side].starting
    .filter((slot) => slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy }).effective;
      const target = slot.position === 'ST' || slot.position === 'AM' ? 1.6 : 1;
      return { value: player.id, weight: Math.max(0.0001, (eff.heading * 0.6 + eff.strength * 0.4) * target) };
    });
  const usable = entries.filter((entry): entry is { value: PlayerId; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

/** A side's aerial power, on the attribute scale rather than as a ratio. */
function aerialPowerOf(match: Match, env: MatchEnvironment, side: Side): number {
  const scores: number[] = [];
  for (const slot of match.lineups[side].starting) {
    if (slot.position === 'GK') continue;
    const player = env.getPlayer(slot.playerId);
    if (!player) continue;
    const performance = performanceOf(match, slot.playerId);
    const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy }).effective;
    scores.push(eff.heading * 0.6 + eff.strength * 0.4);
  }
  if (scores.length === 0) return 10;
  scores.sort((a, b) => b - a);
  const top = scores.slice(0, 4);
  return top.reduce((sum, value) => sum + value, 0) / top.length;
}

/**
 * One possession of a minute, from the moment a side won the ball to the moment
 * it lost it, shot, or ran out of ideas.
 *
 * The minute is a run of these, and each one is a move in its own right — its
 * own side, its own men, its own decisions, its own end. Returned as a list they
 * can each be executed on the pitch in turn, which is what stops the minute's
 * football collapsing into only the move it happened to finish on.
 */
export interface PossessionChain {
  /** The side that had the ball for this possession. */
  side: Side;
  /** How long the possession lasted, in match seconds. */
  seconds: number;
  /** The men the ball was genuinely played to, in this chain, in order. */
  receivers: PlayerId[];
  /** This chain's decisions, in order, as timed actions. */
  actions: TimelineAction[];
  /** Whether the chain ended in a goal. */
  goal: boolean;
  /**
   * The dead ball this chain ends on, when it ends on one.
   *
   * It sits on the chain rather than being installed separately so that the two
   * stay together: a restart with no chain to deliver it, or a chain whose first
   * ball arrives before anyone has walked up, are both ways of showing a set
   * piece as nothing at all.
   */
  restart?: RestartState | null;
  /**
   * The delivery the restart exists to show, as decided.
   *
   * Kept beside the chain's own actions rather than appended to them, because the
   * two have to be separable: the build-up has to be built and played on its own,
   * and only then does the dead ball get arranged at the end of it. Appending them
   * together is what put the ball on the flag eight seconds before the move that
   * won it had finished.
   */
  restartActions?: TimelineAction[];
}

/**
 * The football clock, and how far the last slice ran past the label.
 *
 * The match carries `footballSeconds` as the truth and `minute` as the label
 * derived from it. `footballCarryoverSeconds` is the seam between them: the part
 * of the last slice that was decided beyond the clock, which the next slice must
 * start from. A save written before any of this existed is given a clock from
 * the minute it had already reached, so an old match carries on sensibly rather
 * than restarting at zero.
 */
function refreshFootballClock(match: Match): number {
  if (typeof match.footballSeconds !== 'number') match.footballSeconds = match.minute * MINUTE_SECONDS;
  const carryover = match.footballCarryoverSeconds;
  return typeof carryover === 'number' && carryover > 0 ? carryover : 0;
}

export interface MinuteFootball {
  /** Who held the ball longest this minute — the possession tick. */
  possessionSide: Side;
  /** The side the minute's last move belonged to, for the narrator and the pitch. */
  passageSide: Side;
  /** The men the ball was genuinely played to in the last chain, in order. */
  receivers: PlayerId[];
  /** The last possession's decisions, in order, as timed actions. */
  actions: TimelineAction[];
  goals: number;
  possessions: number;
  /**
   * Every possession of the minute, in the order they were played.
   *
   * The pitch executes these in turn: each chain is played out continuously, and
   * when one is over the next begins from wherever the ball actually is. The
   * fields above are the last chain's, kept because the narrator and a few
   * older readers still want a single move to hang a minute on.
   */
  chains: PossessionChain[];
}

/**
 * One minute of football: a run of possessions until the clock is spent.
 *
 * The number of possessions is *not* fixed — it falls out of how long each one
 * took. A side knocking it about takes three or four minutes-worth of the ball
 * to reach a shot; two poor sides thumping it long will get through half a dozen
 * possessions in the same minute. That is the difference between a tempo and a
 * probability dial.
 */
export function runMinuteFootball(
  match: Match,
  env: MatchEnvironment,
  context: MatchContext,
  rng: Rng,
  sink: MatchEvent[],
): MinuteFootball {
  const field = ensureField(match, context);
  refreshField(match, context, field);
  const carryover = refreshFootballClock(match);

  // A side with nobody out there cannot play football, and the match must not
  // become a ninety-minute procession in which somebody walks the ball in nine
  // times. A fixture is prepared before it is played, so this should be
  // unreachable; it exists so that an unprepared one degrades into a non-event
  // rather than a nonsense scoreline.
  const canField = (team: Side): boolean =>
    match.lineups[team].starting.some((slot) => slot.position !== 'GK');
  if (!canField('home') || !canField('away')) {
    setPhase(field, 'defensive');
    // No football, but the clock still has to move or the engine would ask for
    // the same minute for ever. The label advances; nothing else does.
    match.footballSeconds = (match.footballSeconds ?? match.minute * MINUTE_SECONDS) + MINUTE_SECONDS;
    match.footballCarryoverSeconds = 0;
    return {
      possessionSide: 'home',
      passageSide: 'home',
      receivers: [],
      actions: [],
      goals: 0,
      possessions: 0,
      chains: [],
    };
  }

  let side: Side = field.ball.possessionSide ?? (rng.chance(0.5) ? 'home' : 'away');
  let playerId = field.ball.possessionPlayerId;
  let fromCounter = false;
  // Where the football had already got to when this slice was asked for. On a
  // fresh minute that is the clock itself; mid-possession it is wherever the
  // last one actually reached, which may be past the minute mark.
  let elapsed = carryover;
  const target = MINUTE_SECONDS + DECISION_LOOKAHEAD_SECONDS;
  let possessions = 0;
  let goals = 0;
  const time: Record<Side, number> = { home: 0, away: 0 };
  let lastSide: Side = side;
  // Every possession is kept, in order, so each can be played out on the pitch
  // as its own move. The last one is also kept on its own, because the narrator
  // — and a couple of older readers — want a single move to hang the minute on.
  const chains: PossessionChain[] = [];
  let receivers: PlayerId[] = [];
  let actions: TimelineAction[] = [];

  while (elapsed < target && possessions < MAX_POSSESSIONS) {
    const outcome = runPossession(match, env, context, field, side, playerId, rng, sink, { fromCounter });
    time[side] += outcome.seconds;
    elapsed += outcome.seconds;
    match.footballSeconds = (match.footballSeconds ?? 0) + outcome.seconds;
    possessions += 1;
    receivers = outcome.receivers;
    actions = outcome.actions;
    lastSide = side;
    chains.push({
      side,
      seconds: outcome.seconds,
      receivers: outcome.receivers,
      actions: outcome.actions,
      goal: outcome.goal,
      restart: outcome.restart ?? null,
      restartActions: outcome.restartActions ?? [],
    });

    if (outcome.goal) {
      goals += 1;
      field.ball.x = 0.5;
      field.ball.y = 0.5;
      setPossession(field, otherSide(side), null);
      setPhase(field, 'kickoff');
      // Play restarts from the centre once the celebrations are done.
      break;
    }

    field.ball.x = outcome.x;
    field.ball.y = outcome.y;
    side = outcome.nextSide;
    playerId = outcome.nextPlayerId;
    fromCounter = outcome.counter;
    setPossession(field, side, playerId);
    if (fromCounter) setPhase(field, 'transition');
    else setPhase(field, phaseForZone(zoneOf(side, field.ball.x)));
  }

  // Whatever was decided past the clock is kept, so the next slice starts from
  // the football rather than from the label.
  match.footballCarryoverSeconds = Math.max(0, elapsed - MINUTE_SECONDS);

  const possessionSide: Side = time.home === time.away ? lastSide : time.home > time.away ? 'home' : 'away';
  return { possessionSide, passageSide: lastSide, receivers, actions, goals, possessions, chains };
}

/** Exposed for tests and the developer trace. */
export { roleDepth, pressureOn };
