import type { ClubId, PlayerId } from '@/domain/ids';
import type { Match, MatchEventType, MatchLineup, PlayerPerformance } from '@/domain/match';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { type PositionCode } from '@/domain/positions';
import { attackingCoordinates, makeEvent, type MatchEnvironment } from '@/simulation/match/core';
// The laws of the game both resolutions obey — the penalty's own ladder, the
// ladder a foul walks to a card, and how many changes a side may make. What is
// *measured* stays in `FAST_CALIBRATION` below; what is a law lives there.
import {
  RESTART_STRIKES,
  cardForFoul,
  changesAllowed,
  penaltyTaker,
  strikeOutcome,
} from '@/simulation/match/laws';
import { BASE_INJURY_RATE, pickInjury } from '@/simulation/match/matchEngine/injuries';
import { ensurePerformances } from '@/simulation/match/matchEngine/state';
import { computeTeamStrength, conditionFactor, type TeamStrength } from '@/simulation/match/teamStrength';
import { conditionEffects, tacticalProfile, type TacticalProfile } from '@/simulation/match/tacticsModel';
import { stream, type Rng } from '@/simulation/rng';

/**
 * Touchline — the abstract resolution: the FAST background simulation.
 *
 * A fixture nobody watches does not need twenty-two men moved thirty times a
 * second. It needs the things the rest of the game actually reads: a score, the
 * goals and who scored them, the shots, the cards, the knocks, the substitutions,
 * and a per-player record the season can accumulate. This module produces exactly
 * that — the *same* domain record the full engine writes, filled in at a higher
 * level of abstraction. It is the second resolution of the one Touchline (see
 * `TOUCHLINE_ARCHITECTURE.md`), not a second football.
 *
 * It is an **abstraction of the same football world**, not a second game:
 *
 *  - the *inputs* are identical — the same `MatchLineup`s, the same `Player`s,
 *    the same tactics, conditions, referee and crowd the full engine is handed
 *    through `matchEnvironment`;
 *  - the *judgement* is shared — team quality is `computeTeamStrength`, the
 *    tactical multipliers are `tacticalProfile`, the pitch and weather penalties
 *    are `conditionEffects`, the knocks are `pickInjury`, and the conditioning
 *    curve is `conditionFactor`. Nothing here re-invents a football opinion the
 *    project already holds;
 *  - the *contract* is identical — `Match.result`, `Match.events`,
 *    `Match.performances`, `Match.possessionTicks`, `Match.stoppage`,
 *    `Match.substitutions` and `Match.shootoutWinnerId`, to the same shape and
 *    the same meaning;
 *  - the *randomness* is the project's own `stream(match.seed, …)`, so the same
 *    fixture state and the same seed always play the same match.
 *
 * What it deliberately does **not** do: move anybody, own a ball, run a step
 * loop, write renderer state, record a replay, narrate, or produce the ordinary
 * texture of ~2 500 pass/carry/tackle/throw-in events a watched match carries.
 * Those exist for the pitch, the passage grouping and the statistics panel, none
 * of which ever reads a background fixture; producing them would bloat every save
 * to say nothing to anybody.
 *
 * The model, in one paragraph: the two sides' quality sets how much of the ball
 * each will have and how many shots each will create; the match is then walked a
 * minute at a time, and each minute may produce a shot, a foul, a booking or a
 * knock, with the men chosen by position and ability. A shot is settled from the
 * attacker's quality against the keeper's, and carries a scorer and (usually) an
 * assist. A foul may be a booking; a booking on a booked man is a sending off.
 * Bodies tire, and tired bodies are substituted. A knockout tie level after
 * ninety plays extra time and then, if it must, penalties — because a cup tie is
 * never left undecided.
 *
 * See `MATCH_ENGINE.md` § "The two modes" for the architecture, and
 * `npm run benchmark` for the calibration this file is pinned to.
 */

// ---------------------------------------------------------------------------
// The calibration
// ---------------------------------------------------------------------------

/**
 * The model's constants, all in one block, and all of them *measured*.
 *
 * They were read off the full engine itself — 76 fixtures of the test world,
 * through the real `processDay` loop — so the two modes agree on what a Sunday
 * league match looks like. That agreement is the point: if FAST produced a
 * different shape of football from FULL, then a season's leading scorer, its
 * cards table and its goals-per-game would quietly depend on *which* fixtures the
 * manager happened to watch. `npm run benchmark` prints both fingerprints side by
 * side, so the day these drift apart is the day it says so.
 *
 * Two things a football match has are deliberately *not* here, because they are
 * the laws of the game rather than this model's measurements, and both
 * resolutions read them from `laws.ts`: the ladder a penalty is scored or missed
 * from, and how many changes a side is allowed. The card ladder is shared too —
 * one of the two chances it is given is this block's, and the other is the
 * deliberate softening of the law explained at `secondYellowShare`.
 */
export const FAST_CALIBRATION = {
  /** Shots a side creates in an even match over ninety minutes. */
  shotsPerSide: 8.5,
  /**
   * The base expected-goals of one attempt, in an even match.
   *
   * Deliberately *below* the full engine's measured conversion of 0.163 goals
   * per shot, because the quality multipliers this is fed through — the attack
   * against the keeper, the finisher's shooting, the chance's own spread —
   * average a little above one. The constant is set so the *net* is the full
   * engine's 2.86 goals a match, which is the figure that actually has to agree;
   * `npm run benchmark` prints both.
   */
  conversion: 0.118,
  /** Share of shots stopped by the keeper. */
  saveShare: 0.4,
  /** Share of shots charged down by a defender. */
  blockShare: 0.277,
  /** Share of the goals that go in off a defender rather than the attacker. */
  ownGoalShare: 0.04,
  /** Share of open-play goals that are assisted. */
  assistShare: 0.62,
  /** Fouls a side commits in an even match. */
  foulsPerSide: 26,
  /** Bookings per foul, before the referee's strictness and the man's discipline. */
  yellowsPerFoul: 0.081,
  /**
   * How often a foul by an already-booked man is the second yellow.
   *
   * Deliberately low. The first cut sent a booked man off automatically the next
   * time he was booked, which sounds like the law and reads nothing like a
   * season: with fifty-odd fouls a match it made sendings off eight times more
   * common than the full engine's. A second yellow is a rare thing a referee
   * gives, not an inevitability waiting for the next tackle.
   */
  secondYellowShare: 0.12,
  /** Straight reds per foul, before the referee's strictness. */
  straightRedPerFoul: 0.0009,
  /** Penalties awarded to a side per match. */
  penaltiesPerSide: 0.2,
  /** Passes a side plays per ninety minutes at even possession. */
  passesPerSide: 772,
  /** How often a pass finds its man, at an average squad. */
  passCompletion: 0.637,
  /** Tackles a side makes per ninety minutes at even possession. */
  tacklesPerSide: 75,
  /** Interceptions a side makes per ninety minutes at even possession. */
  interceptionsPerSide: 92,
  /** Football seconds of stamina a fresh outfield man burns in a minute. */
  staminaPerMinute: 0.84,
  /** The minutes at which a bench is looked at. */
  benchCheckMinutes: [58, 66, 74, 82] as readonly number[],
  /** The chance a bench check turns into a change, before tiredness. */
  benchCheckChance: 0.62,
} as const;

/** The home side's edge. The same figure `buildContext` gives the full engine. */
const HOME_ADVANTAGE = 1.045;

/** The fewest men a side may be reduced to before the model stops removing them. */
const OFF_PITCH_FLOOR = 7;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

type Side = 'home' | 'away';
const SIDES: readonly Side[] = ['home', 'away'];

/** What `simulateMatchFast` hands back. The record itself is written to `match`. */
export interface FastMatchResult {
  /** The mode that produced it. Always `'fast'`; there for the reader. */
  mode: 'fast';
  homeGoals: number;
  awayGoals: number;
  homeShots: number;
  awayShots: number;
  homePossession: number;
  awayPossession: number;
  /** How the tie was settled. League matches always end in normal time. */
  decidedBy: 'normal-time' | 'extra-time' | 'shootout';
}

/** One side, as the background model carries it through the match. */
interface RunningSide {
  readonly side: Side;
  readonly clubId: ClubId;
  readonly lineup: MatchLineup;
  readonly strength: TeamStrength;
  readonly profile: TacticalProfile;
  /** The men named for the pitch, resolved in slot order. */
  readonly starting: Player[];
  /** The men named on the bench, resolved in bench order. */
  readonly bench: Player[];
  /** The men currently on the pitch. Mutated by substitutions and sendings off. */
  onPitch: Player[];
  /** Where each man on the pitch is playing, by player id. */
  readonly positionOf: Map<PlayerId, PositionCode>;
  substitutions: number;
  sentOff: number;
}

/** Everything the minute loop needs, so the helpers do not take ten arguments. */
interface FastContext {
  readonly match: Match;
  readonly env: MatchEnvironment;
  readonly rng: Rng;
  readonly home: RunningSide;
  readonly away: RunningSide;
  /** In-match energy per player, 0-100. */
  readonly energy: Map<PlayerId, number>;
  readonly score: { home: number; away: number };
  /** The minute being played, 1-based. Runs past 90 into extra time. */
  minute: number;
  /** Whether the match is in extra time. */
  extraTime: boolean;
}

// ---------------------------------------------------------------------------
// Attacking responsibility, by position
// ---------------------------------------------------------------------------

/**
 * How likely a man is to be the one who shoots, before his finishing is read.
 *
 * These are *relative* weights within an XI, not probabilities: a striker is
 * simply far more often the man on the end of a move than a centre-half. The full
 * engine arrives at the same shape from the other direction — a decision model
 * that only lets a man shoot from zones his role permits — and the two agree
 * closely enough that a season's scorers are distributed the same way.
 */
const SHOT_WEIGHT: Record<PositionCode, number> = {
  GK: 0,
  CB: 0.4,
  RB: 0.45,
  LB: 0.45,
  DM: 0.5,
  CM: 0.85,
  RM: 1.1,
  LM: 1.1,
  AM: 1.55,
  RW: 1.85,
  LW: 1.85,
  ST: 2.6,
};

/** How likely a man is to be the one who made the pass before a goal. */
const ASSIST_WEIGHT: Record<PositionCode, number> = {
  GK: 0.05,
  CB: 0.25,
  RB: 0.7,
  LB: 0.7,
  DM: 0.75,
  CM: 1.25,
  RM: 1.45,
  LM: 1.45,
  AM: 1.7,
  RW: 1.75,
  LW: 1.75,
  ST: 1.0,
};

/** How much of a side's passing a position does. */
const PASS_WEIGHT: Record<PositionCode, number> = {
  GK: 0.5,
  CB: 1.15,
  RB: 0.95,
  LB: 0.95,
  DM: 1.05,
  CM: 1.3,
  RM: 1.1,
  LM: 1.1,
  AM: 1.1,
  RW: 0.9,
  LW: 0.9,
  ST: 0.75,
};

/** How much of a side's tackling a position does. */
const TACKLE_WEIGHT: Record<PositionCode, number> = {
  GK: 0.1,
  CB: 1.45,
  RB: 1.2,
  LB: 1.2,
  DM: 1.5,
  CM: 0.9,
  RM: 0.6,
  LM: 0.6,
  AM: 0.4,
  RW: 0.3,
  LW: 0.3,
  ST: 0.25,
};

/** How much of a side's reading of the game a position does. */
const INTERCEPT_WEIGHT: Record<PositionCode, number> = {
  GK: 0.15,
  CB: 1.35,
  RB: 1.15,
  LB: 1.15,
  DM: 1.6,
  CM: 1.0,
  RM: 0.8,
  LM: 0.8,
  AM: 0.6,
  RW: 0.5,
  LW: 0.5,
  ST: 0.3,
};

// ---------------------------------------------------------------------------
// Small arithmetic
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sideOfClub(match: Match, clubId: ClubId): Side {
  return clubId === match.homeClubId ? 'home' : 'away';
}

function performanceOf(match: Match, playerId: PlayerId): PlayerPerformance | undefined {
  return match.performances[playerId];
}

function clubShortName(env: MatchEnvironment, match: Match, side: Side): string {
  return env.clubShortName(side === 'home' ? match.homeClubId : match.awayClubId);
}

function playerName(player: Player): string {
  return `${player.firstName.charAt(0)}. ${player.surname}`;
}

// ---------------------------------------------------------------------------
// Building the two sides
// ---------------------------------------------------------------------------

function buildSide(match: Match, env: MatchEnvironment, side: Side): RunningSide {
  const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
  const lineup = match.lineups[side];
  const resolve = (id: PlayerId): Player | undefined => env.getPlayer(id);
  const starting = lineup.starting.map((slot) => resolve(slot.playerId)).filter(isPlayer);
  const positionOf = new Map<PlayerId, PositionCode>();
  for (const slot of lineup.starting) positionOf.set(slot.playerId, slot.position);

  const strength = computeTeamStrength({
    slots: lineup.starting,
    players: (id) => resolve(id),
    tactics: lineup.tactics,
    conditions: match.conditions,
    energy: (id) => match.performances[id]?.energy ?? resolve(id)?.fitness ?? 100,
    carryingInjury: (id) => Boolean(match.performances[id]?.injuryDetail),
    tacticalFamiliarity: env.tacticalFamiliarity?.(clubId),
    cohesion: env.cohesion?.(clubId),
  });

  return {
    side,
    clubId,
    lineup,
    strength,
    profile: tacticalProfile(lineup.tactics, match.conditions),
    starting,
    bench: lineup.bench.map((slot) => resolve(slot.playerId)).filter(isPlayer),
    onPitch: [...starting],
    positionOf,
    substitutions: 0,
    sentOff: 0,
  };
}

/** The other side's state, given one. */
function opponent(ctx: FastContext, side: RunningSide): RunningSide {
  return side.side === 'home' ? ctx.away : ctx.home;
}

/** The keeper currently on the pitch for a side, if anybody is. */
function keeperOf(side: RunningSide): Player | undefined {
  return side.onPitch.find((player) => side.positionOf.get(player.id) === 'GK') ?? side.onPitch[0];
}

// ---------------------------------------------------------------------------
// The event log
// ---------------------------------------------------------------------------

interface EmitSpec {
  playerId?: PlayerId | null;
  secondaryPlayerId?: PlayerId | null;
  text: string;
  x: number;
  y: number;
  importance: 1 | 2 | 3;
}

/**
 * Write one event onto the match's record.
 *
 * The events are produced in chronological order by the minute loop, so the log
 * is already sorted and needs no second pass. `makeEvent` is the same
 * constructor the full engine uses, so the id scheme, the `clubId` resolution and
 * the `scoreAfter` field mean exactly the same thing here.
 */
function emit(ctx: FastContext, type: MatchEventType, side: Side | null, spec: EmitSpec): void {
  ctx.match.events.push(
    makeEvent(ctx.match, type, {
      minute: ctx.minute,
      second: ctx.minute * 60,
      side,
      playerId: spec.playerId ?? null,
      secondaryPlayerId: spec.secondaryPlayerId ?? null,
      text: spec.text,
      x: spec.x,
      y: spec.y,
      importance: spec.importance,
      scoreAfter: { ...ctx.score },
    }),
  );
}

// ---------------------------------------------------------------------------
// The minute loop's three resolutions
// ---------------------------------------------------------------------------

/** A weighted pick among men, by a base weight times an attribute reading. */
function pickWeighted(
  rng: Rng,
  players: readonly Player[],
  weight: (player: Player) => number,
): Player | undefined {
  const entries = players
    .map((player) => ({ value: player, weight: Math.max(0, weight(player)) }))
    .filter((entry) => entry.weight > 0);
  if (entries.length === 0) return players[0];
  return rng.weighted(entries);
}

function shootingWeight(player: Player, position: PositionCode): number {
  const base = SHOT_WEIGHT[position] ?? 0.5;
  if (base <= 0) return 0;
  return base * (0.45 + player.attributes.technical.shooting / 15);
}

/** The expected goals of one attempt, from the attack against the keeper. */
function xgFor(ctx: FastContext, att: RunningSide, def: RunningSide, shooter: Player): number {
  const attack = att.strength.attack * att.profile.attackMultiplier;
  const keeper = Math.max(0.15, def.strength.keeper);
  const ratio = clamp(attack / keeper, 0.4, 2.4);
  const finishing = clamp(0.62 + shooter.attributes.technical.shooting / 26, 0.62, 1.35);
  const tiredness = conditionFactor(shooter, ctx.energy.get(shooter.id) ?? shooter.fitness);
  const quality = FAST_CALIBRATION.conversion * Math.pow(ratio, 0.7) * att.profile.shotQualityMultiplier * finishing * tiredness;
  // A chance is a chance: the spread across a side's attempts is what makes the
  // scoreline varied rather than binomial, and it is drawn per shot, not per man.
  return clamp(quality * ctx.rng.float(0.35, 1.9), 0.02, 0.3);
}

/**
 * Settle one attempt.
 *
 * The outcome shares are the full engine's measured ones (16 % goal, 42 % saved,
 * 28 % blocked, the rest off target), with the goal share moved by the quality of
 * the chance and the keeper. A goal is a `goal` (or, rarely, an `own-goal`); a
 * save is a `shot-saved` and the keeper's; a block is a `shot-blocked`; anything
 * else is a `shot-off-target`. Every branch writes the shooter's own record, so
 * the tally and the record can never disagree.
 */
function resolveShot(ctx: FastContext, att: RunningSide, def: RunningSide): void {
  const shooter = pickWeighted(ctx.rng, att.onPitch, (player) =>
    shootingWeight(player, att.positionOf.get(player.id) ?? player.preferredPosition),
  );
  if (!shooter) return;
  const shooterPerf = performanceOf(ctx.match, shooter.id);
  if (shooterPerf) {
    shooterPerf.shots += 1;
    shooterPerf.positionPlayed = att.positionOf.get(shooter.id) ?? shooterPerf.positionPlayed;
  }

  const xg = xgFor(ctx, att, def, shooter);
  const roll = ctx.rng.next();
  const saved = xg + FAST_CALIBRATION.saveShare;
  const blocked = saved + FAST_CALIBRATION.blockShare;
  const spot = attackingCoordinates(ctx.match, att.side, ctx.rng, 'chance');
  const short = clubShortName(ctx.env, ctx.match, att.side);

  if (roll < xg) {
    if (shooterPerf) shooterPerf.shotsOnTarget += 1;
    // An own goal is the defender's last touch, credited to the side it helped.
    if (ctx.rng.chance(FAST_CALIBRATION.ownGoalShare)) {
      const defender = pickWeighted(ctx.rng, def.onPitch, () => 1);
      ctx.score[att.side] += 1;
      emit(ctx, 'own-goal', att.side, {
        playerId: defender?.id ?? null,
        text: `Own goal — ${defender ? playerName(defender) : 'a defender'} turns it past his own keeper. ${short} lead ${ctx.score.home}-${ctx.score.away}.`,
        x: spot.x,
        y: spot.y,
        importance: 3,
      });
      return;
    }
    ctx.score[att.side] += 1;
    if (shooterPerf) shooterPerf.goals += 1;
    const assist = ctx.rng.chance(FAST_CALIBRATION.assistShare)
      ? pickWeighted(
          ctx.rng,
          att.onPitch.filter((player) => player.id !== shooter.id),
          (player) => {
            const position = att.positionOf.get(player.id) ?? player.preferredPosition;
            return (ASSIST_WEIGHT[position] ?? 0.5) * (0.4 + player.attributes.technical.passing / 16);
          },
        )
      : undefined;
    if (assist) {
      const assistPerf = performanceOf(ctx.match, assist.id);
      if (assistPerf) assistPerf.assists += 1;
    }
    emit(ctx, 'goal', att.side, {
      playerId: shooter.id,
      secondaryPlayerId: assist?.id ?? null,
      text: assist
        ? `${playerName(shooter)} scores for ${short}, played in by ${playerName(assist)}. ${ctx.score.home}-${ctx.score.away}.`
        : `${playerName(shooter)} scores for ${short}. ${ctx.score.home}-${ctx.score.away}.`,
      x: spot.x,
      y: spot.y,
      importance: 3,
    });
    return;
  }

  if (roll < saved) {
    if (shooterPerf) shooterPerf.shotsOnTarget += 1;
    const keeper = keeperOf(def);
    const keeperPerf = keeper ? performanceOf(ctx.match, keeper.id) : undefined;
    if (keeperPerf) keeperPerf.saves += 1;
    emit(ctx, 'shot-saved', att.side, {
      playerId: shooter.id,
      text: `${playerName(shooter)} forces a save from ${keeper ? playerName(keeper) : 'the keeper'}.`,
      x: spot.x,
      y: spot.y,
      importance: 2,
    });
    return;
  }

  if (roll < blocked) {
    emit(ctx, 'shot-blocked', att.side, {
      playerId: shooter.id,
      text: `${playerName(shooter)}'s effort is charged down.`,
      x: spot.x,
      y: spot.y,
      importance: 1,
    });
    return;
  }

  emit(ctx, 'shot-off-target', att.side, {
    playerId: shooter.id,
    text: `${playerName(shooter)} drags it wide.`,
    x: spot.x,
    y: spot.y,
    importance: 1,
  });
}

/** The referee's temper, from the strictness the matchday service picked. */
function refereeFactor(ctx: FastContext): number {
  return clamp(ctx.env.refereeStrictness / 11, 0.55, 1.7);
}

/** How much trouble a man's own discipline gets him into. */
function disciplineFactor(player: Player): number {
  return clamp(1.6 - player.attributes.behavioural.discipline / 14, 0.4, 1.8);
}

/** Send a man off: he leaves the pitch, his record stops, and his side is short. */
function sendOff(ctx: FastContext, side: RunningSide, player: Player, text: string, x: number, y: number): void {
  const perf = performanceOf(ctx.match, player.id);
  if (perf) {
    perf.redCards += 1;
    perf.sentOff = true;
    perf.minutesPlayed = Math.max(0, ctx.minute - (perf.cameOnMinute ?? 0));
  }
  side.onPitch = side.onPitch.filter((entry) => entry.id !== player.id);
  side.sentOff += 1;
  emit(ctx, 'red-card', side.side, { playerId: player.id, text, x, y, importance: 3 });
}

/**
 * Settle one foul by the side that committed it.
 *
 * A foul is a real event on the record (the stats panel counts them from the
 * log), and it is where the game's cards come from. A booking on a man already
 * booked is the second yellow, and he goes; a straight red is rare and left to
 * the referee's temper. The men are chosen by how likely they are to be the one
 * making the challenge — a holding midfielder more than a winger — and by how
 * badly their discipline reads. The ladder a foul walks is the shared law in
 * `laws.ts`; only the chances below are this model's.
 */
function resolveFoul(ctx: FastContext, side: RunningSide): void {
  const offender = pickWeighted(ctx.rng, side.onPitch, (player) => {
    const position = side.positionOf.get(player.id) ?? player.preferredPosition;
    if (position === 'GK') return 0;
    const exposure = (TACKLE_WEIGHT[position] ?? 0.6) * disciplineFactor(player);
    return exposure;
  });
  if (!offender) return;
  const perf = performanceOf(ctx.match, offender.id);
  if (perf) perf.fouls += 1;
  const x = ctx.rng.float(0.12, 0.88);
  const y = ctx.rng.float(0.12, 0.88);

  const decision = cardForFoul(
    ctx.rng,
    {
      straightRed: FAST_CALIBRATION.straightRedPerFoul * refereeFactor(ctx) * disciplineFactor(offender),
      yellow: FAST_CALIBRATION.yellowsPerFoul * side.profile.cardRate * refereeFactor(ctx) * disciplineFactor(offender),
      secondYellowShare: FAST_CALIBRATION.secondYellowShare,
    },
    (perf?.yellowCards ?? 0) > 0,
  );

  if (decision === 'straight-red') {
    sendOff(ctx, side, offender, `${playerName(offender)} is sent off.`, x, y);
    return;
  }
  if (decision === 'second-yellow') {
    if (perf) perf.yellowCards += 1;
    sendOff(ctx, side, offender, `Second booking for ${playerName(offender)} — he is off.`, x, y);
    return;
  }
  if (decision === 'yellow') {
    if (perf) perf.yellowCards += 1;
    emit(ctx, 'yellow-card', side.side, {
      playerId: offender.id,
      text: `${playerName(offender)} is booked.`,
      x,
      y,
      importance: 2,
    });
    return;
  }

  emit(ctx, 'foul', side.side, {
    playerId: offender.id,
    text: `${playerName(offender)} gives away a free kick.`,
    x,
    y,
    importance: 1,
  });
}

/**
 * Award and take a penalty.
 *
 * A penalty is taken by the club's nominated taker when it has one and he is on
 * the pitch, and by the side's best finisher otherwise. That choice is the law in
 * `laws.ts` and the detailed resolution obeys it too, and so is the ladder the
 * penalty is scored or missed from: the two resolutions cannot disagree about
 * what a penalty *is*. What they read differently is only what "best finisher"
 * means, and what a save is — a save is the keeper's and a miss the taker's, and
 * that is local to what this model can see. It counts as a shot, and it is scored
 * or missed as such, so the record stays a single account of the match.
 */
function resolvePenalty(ctx: FastContext, att: RunningSide): void {
  const nominatedId = att.lineup.tactics.setPieceRoutines?.penaltyTakerId;
  const onPitch = att.onPitch;
  const nominated = nominatedId ? onPitch.find((player) => player.id === nominatedId) : undefined;
  const taker = penaltyTaker(nominated, () =>
    pickWeighted(ctx.rng, onPitch, (player) => {
      if (att.positionOf.get(player.id) === 'GK') return 0;
      return player.attributes.technical.shooting + player.attributes.mental.composure * 0.5;
    }),
  );
  if (!taker) return;
  const outcome = strikeOutcome(RESTART_STRIKES.penalty, ctx.rng.next());
  const takerPerf = performanceOf(ctx.match, taker.id);
  if (takerPerf) {
    takerPerf.shots += 1;
    // A penalty put wide is a shot, but it is not a shot *on target*.
    if (outcome !== 'wide') takerPerf.shotsOnTarget += 1;
  }
  if (outcome === 'goal') {
    ctx.score[att.side] += 1;
    if (takerPerf) takerPerf.goals += 1;
    emit(ctx, 'penalty-scored', att.side, {
      playerId: taker.id,
      text: `${playerName(taker)} scores from the spot. ${ctx.score.home}-${ctx.score.away}.`,
      x: 0.88,
      y: 0.5,
      importance: 3,
    });
    return;
  }
  // Only a save is the keeper's: a penalty put wide never reached him.
  const keeper = outcome === 'saved' ? keeperOf(opponent(ctx, att)) : undefined;
  const keeperPerf = keeper ? performanceOf(ctx.match, keeper.id) : undefined;
  if (keeperPerf) keeperPerf.saves += 1;
  emit(ctx, 'penalty-missed', att.side, {
    playerId: taker.id,
    text:
      outcome === 'saved'
        ? `${playerName(taker)} misses from the spot — ${keeper ? playerName(keeper) : 'the keeper'} keeps it out.`
        : `${playerName(taker)} puts the penalty wide.`,
    x: 0.88,
    y: 0.5,
    importance: 3,
  });
}

/**
 * Roll for knocks, once a minute, man by man.
 *
 * The rate is the full engine's own (`BASE_INJURY_RATE`, the conditions' injury
 * rate, the hidden susceptibility and the tiredness), applied per minute exactly
 * as the engine applies it per five-second check after scaling. A man already
 * carrying a knock is not hurt twice.
 */
function resolveInjuries(ctx: FastContext): void {
  const injuryRate = conditionEffects(ctx.match.conditions).injuryRate;
  for (const side of [ctx.home, ctx.away]) {
    for (const player of side.onPitch) {
      const perf = performanceOf(ctx.match, player.id);
      if (!perf || perf.injuryDetail) continue;
      const susceptibility = player.attributes.hidden.injurySusceptibility;
      const tiredness = 1 + (100 - (ctx.energy.get(player.id) ?? 100)) / 140;
      const perMinute = BASE_INJURY_RATE * injuryRate * (0.4 + susceptibility / 12) * tiredness;
      if (!ctx.rng.chance(perMinute)) continue;

      perf.injuryDetail = pickInjury(ctx.rng, player, ctx.energy.get(player.id) ?? 100, injuryRate);
      emit(ctx, 'injury', side.side, {
        playerId: player.id,
        text: `${playerName(player)} pulls up — ${perf.injuryDetail.description}.`,
        x: ctx.rng.float(0.1, 0.9),
        y: ctx.rng.float(0.1, 0.9),
        importance: 2,
      });
      // A man who cannot run it off comes off as soon as somebody is ready.
      if (perf.injuryDetail.severity !== 'knock') makeSubstitution(ctx, side, player, true);
    }
  }
}

/**
 * Bring a substitute on.
 *
 * The incoming man inherits the outgoing man's position, exactly as the full
 * engine's bench does, so the shape is unchanged and the record says where he
 * played. His own record starts at the minute he came on.
 */
function makeSubstitution(ctx: FastContext, side: RunningSide, outgoing: Player, injured: boolean): void {
  if (side.substitutions >= changesAllowed(ctx.env.substitutionsAllowed)) return;
  if (side.bench.length === 0) return;
  if (side.onPitch.length <= OFF_PITCH_FLOOR) return;
  const position = side.positionOf.get(outgoing.id) ?? outgoing.preferredPosition;
  const incoming = pickWeighted(ctx.rng, side.bench, (player) =>
    player.attributes.behavioural.commitment * 0.05 +
    (player.preferredPosition === position ? 3 : 0.4) +
    player.fitness / 40,
  );
  if (!incoming) return;

  const outgoingPerf = performanceOf(ctx.match, outgoing.id);
  if (outgoingPerf) outgoingPerf.wentOffMinute = ctx.minute;
  const incomingPerf = performanceOf(ctx.match, incoming.id);
  if (incomingPerf) {
    incomingPerf.cameOnMinute = ctx.minute;
    incomingPerf.positionPlayed = position;
    incomingPerf.energy = ctx.energy.get(incoming.id) ?? incoming.fitness;
  }

  side.onPitch = side.onPitch.map((player) => (player.id === outgoing.id ? incoming : player));
  side.positionOf.set(incoming.id, position);
  side.bench.splice(side.bench.indexOf(incoming), 1);
  side.substitutions += 1;

  const short = clubShortName(ctx.env, ctx.match, side.side);
  emit(ctx, 'substitution', side.side, {
    playerId: incoming.id,
    secondaryPlayerId: outgoing.id,
    text: `${short} change: ${playerName(incoming)} on for ${playerName(outgoing)}${injured ? ' (injury)' : ''}.`,
    x: 0.5,
    y: 0.5,
    importance: 1,
  });
}

/**
 * Look at a bench, on the full engine's cadence.
 *
 * A change is made for the tiredest man on the pitch, and only to a man who is
 * genuinely tiring — the abstraction of the engine's own review, which reads the
 * same principle (a fresh pair of legs for a heavy one) from real stamina.
 */
function reviewBench(ctx: FastContext, side: RunningSide): void {
  if (side.substitutions >= changesAllowed(ctx.env.substitutionsAllowed)) return;
  if (side.bench.length === 0) return;
  const candidates = side.onPitch.filter((player) => side.positionOf.get(player.id) !== 'GK');
  if (candidates.length === 0) return;
  const tiredest = candidates.reduce((worst, player) =>
    (ctx.energy.get(player.id) ?? 100) < (ctx.energy.get(worst.id) ?? 100) ? player : worst,
  );
  const energy = ctx.energy.get(tiredest.id) ?? 100;
  const chance = FAST_CALIBRATION.benchCheckChance + (100 - energy) / 260;
  if (!ctx.rng.chance(chance)) return;
  makeSubstitution(ctx, side, tiredest, false);
}

// ---------------------------------------------------------------------------
// The pitch, brought back to life between the two halves
// ---------------------------------------------------------------------------

/** The interval: nothing is played, but the record says the half ended. */
function halfTime(ctx: FastContext, nominalMinute: number): void {
  emit(ctx, 'half-time', null, {
    text: 'Half time.',
    x: 0.5,
    y: 0.5,
    importance: 3,
  });
  ctx.minute = nominalMinute;
  ctx.match.half = 2;
  ctx.match.period = 'second-half';
}

// ---------------------------------------------------------------------------
// Penalties, when a knockout tie will not settle itself
// ---------------------------------------------------------------------------

interface Shootout {
  home: number;
  away: number;
  winner: Side;
}

/**
 * Decide a level knockout tie from the spot.
 *
 * Deliberately outside the football: a shootout is a series of independent kicks
 * decided by a stream of its own, from composure and technique. It writes the
 * winner onto the match and the score onto the result, which is the one place a
 * cup tie's decider is recorded — and then the match ends, exactly as if the
 * football had settled it. A tier tie is never left undecided: that is the one
 * thing a cup tie must never be.
 */
function resolveShootout(ctx: FastContext): Shootout {
  const takers = (side: RunningSide): Player[] =>
    side.onPitch
      .filter((player) => side.positionOf.get(player.id) !== 'GK')
      .sort(
        (a, b) =>
          b.attributes.technical.shooting + b.attributes.mental.composure -
          (a.attributes.technical.shooting + a.attributes.mental.composure),
      );

  const take = (player: Player | undefined, kick: number): boolean => {
    if (!player) return false;
    const rng = stream(ctx.match.seed, 'fast-shootout', kick);
    const composure = player.attributes.mental.composure;
    const shooting = player.attributes.technical.shooting;
    const p = 0.68 + (composure - 11) / 90 + (shooting - 11) / 180;
    return rng.chance(clamp(p, 0.45, 0.92));
  };

  const homeKicks = takers(ctx.home);
  const awayKicks = takers(ctx.away);
  const at = (list: Player[], round: number): Player | undefined =>
    list.length === 0 ? undefined : list[Math.min(round, list.length - 1)];

  const REGULATION_KICKS = 5;
  const MAX_ROUNDS = 12;
  let kicksHome = 0;
  let kicksAway = 0;
  let kick = 0;
  let winner: Side = 'home';
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (take(at(homeKicks, round), kick)) kicksHome += 1;
    kick += 1;
    if (take(at(awayKicks, round), kick)) kicksAway += 1;
    kick += 1;
    if (round >= REGULATION_KICKS - 1 && kicksHome !== kicksAway) {
      winner = kicksHome > kicksAway ? 'home' : 'away';
      break;
    }
  }
  if (kicksHome === kicksAway) winner = 'home';

  ctx.match.shootoutWinnerId = winner === 'home' ? ctx.match.homeClubId : ctx.match.awayClubId;
  emit(ctx, 'penalties', null, {
    text: `Penalties: ${kicksHome}-${kicksAway}. ${clubShortName(ctx.env, ctx.match, winner)} go through.`,
    x: 0.5,
    y: 0.5,
    importance: 3,
  });
  return { home: kicksHome, away: kicksAway, winner };
}

// ---------------------------------------------------------------------------
// The record, finished off
// ---------------------------------------------------------------------------

/**
 * Fill in the figures the minute loop does not produce directly.
 *
 * Passes, tackles and interceptions are a *reading* of the football rather than
 * a list of moments in it: the model knows who had the ball, who was asked to win
 * it and for how long each man played, and those are the same quantities the full
 * engine's per-event counters aggregate to. Writing them here keeps the
 * per-player record complete — the statistics panel, the ratings and any future
 * career figure read them — without inventing two thousand pass events for a
 * match nobody will open.
 */
function fillAggregates(side: RunningSide, share: number, ctx: FastContext): void {
  const teamPasses = FAST_CALIBRATION.passesPerSide * (share / 0.5);
  const teamTackles = FAST_CALIBRATION.tacklesPerSide * ((1 - share) / 0.5);
  const teamInterceptions = FAST_CALIBRATION.interceptionsPerSide * ((1 - share) / 0.5);
  const oppositionControl = opponent(ctx, side).strength.control;
  const completionBase = clamp(
    FAST_CALIBRATION.passCompletion * (side.strength.control / Math.max(0.2, oppositionControl)) ** 0.25,
    0.5,
    0.85,
  );

  const played: Array<{ player: Player; perf: PlayerPerformance; minutes: number; shareOfMatch: number }> = [];
  const named = [
    ...side.starting,
    ...side.lineup.bench.map((slot) => ctx.env.getPlayer(slot.playerId)).filter(isPlayer),
  ];
  for (const player of named) {
    const perf = performanceOf(ctx.match, player.id);
    if (!perf) continue;
    const minutes = perf.minutesPlayed;
    played.push({ player, perf, minutes, shareOfMatch: minutes / Math.max(1, ctx.minute) });
  }

  const distribute = (
    teamTotal: number,
    weight: (player: Player, position: PositionCode) => number,
  ): Map<PlayerId, number> => {
    const weights = played.map((entry) => {
      const position = entry.perf.positionPlayed;
      return { player: entry.player, weight: Math.max(0, weight(entry.player, position)) * entry.shareOfMatch };
    });
    const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
    const out = new Map<PlayerId, number>();
    for (const entry of weights) {
      out.set(entry.player.id, total <= 0 ? 0 : Math.round((teamTotal * entry.weight) / total));
    }
    return out;
  };

  const passes = distribute(teamPasses, (player, position) => (PASS_WEIGHT[position] ?? 0.8) * (0.5 + player.attributes.technical.passing / 20));
  const tackles = distribute(teamTackles, (player, position) => (TACKLE_WEIGHT[position] ?? 0.5) * (0.5 + player.attributes.technical.tackling / 20));
  const interceptions = distribute(teamInterceptions, (player, position) => (INTERCEPT_WEIGHT[position] ?? 0.5) * (0.6 + player.attributes.mental.positioning / 25));

  for (const entry of played) {
    if (entry.minutes <= 0) continue;
    const attempts = passes.get(entry.player.id) ?? 0;
    entry.perf.passes = attempts;
    const personal = clamp(completionBase + (entry.player.attributes.technical.passing - 10) / 70, 0.42, 0.9);
    entry.perf.passesCompleted = Math.min(attempts, Math.round(attempts * personal));
    entry.perf.tackles = tackles.get(entry.player.id) ?? 0;
    entry.perf.interceptions = interceptions.get(entry.player.id) ?? 0;
  }
}

/**
 * How well a man played, out of ten.
 *
 * This is the same reading the full engine's own `ratePerformances` takes at the
 * whistle — same weights, same defensive weighting by position, same discount for
 * a cameo. It is written out here rather than shared because the engine's copy is
 * private and the standing rule is that nothing under `match/` is edited; the two
 * are pinned together by the benchmark, which prints the mean rating from each
 * mode and would show the day they drifted apart.
 */
function ratePerformances(ctx: FastContext): void {
  for (const perf of Object.values(ctx.match.performances)) {
    const isHome = perf.clubId === ctx.match.homeClubId;
    const conceded = isHome ? ctx.score.away : ctx.score.home;
    const scored = isHome ? ctx.score.home : ctx.score.away;
    const position = perf.positionPlayed;
    const defWeight =
      position === 'GK' ? 1 : position.startsWith('D') || position === 'DM' ? 0.7 : position.startsWith('M') ? 0.5 : 0.3;

    let rating = 6.1;
    rating += perf.goals * 1.15;
    rating += perf.assists * 0.6;
    rating += perf.shotsOnTarget * 0.05;
    rating += perf.tackles * 0.035;
    rating += perf.interceptions * 0.03;
    rating += perf.saves * 0.12;
    rating += perf.passesCompleted * 0.004;
    rating -= perf.fouls * 0.02;
    rating -= perf.yellowCards * 0.35;
    rating -= perf.redCards * 1.4;
    rating -= conceded * 0.1 * defWeight * (position === 'GK' ? 1.4 : 1);
    if (conceded === 0) rating += 0.25 * (position === 'GK' ? 1.2 : defWeight);
    rating += scored > conceded ? 0.3 : scored === conceded ? 0.1 : -0.2;
    if (perf.minutesPlayed < 20) rating = 6 + (rating - 6) * 0.6;

    perf.rating = Math.max(3, Math.min(10, Math.round(rating * 10) / 10));
  }
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * Play a background fixture, fast.
 *
 * The whole match is decided here and written straight onto the `Match` — there
 * is no engine object to hold, no state to advance and no renderer to feed, which
 * is exactly why it is fast. The writes are the same ones the full engine makes,
 * so every consumer of a finished match (`applyMatchConsequences`,
 * `applyMatchdayFinances`, the league table, the cup, a player's career) reads
 * this record without knowing or caring which mode produced it.
 *
 * Deterministic: the same match state and the same `match.seed` always produce
 * the same result, events and performances.
 */
export function simulateMatchFast(match: Match, env: MatchEnvironment): FastMatchResult {
  // A fresh play, so re-simulating the same fixture is an honest repeat rather
  // than an accumulation.
  match.events = [];
  match.performances = {};
  match.result = null;
  match.status = 'in-progress';
  match.played = false;
  match.half = 1;
  match.period = 'first-half';
  match.minute = 0;
  match.footballSeconds = 0;
  match.substitutions = { home: 0, away: 0 };
  match.simulationMode = 'fast';
  ensurePerformances(match, env);

  const rng = stream(match.seed, 'fast-match');
  const home = buildSide(match, env, 'home');
  const away = buildSide(match, env, 'away');
  const energy = new Map<PlayerId, number>();
  for (const side of [home, away]) {
    for (const player of [...side.starting, ...side.bench]) {
      energy.set(player.id, performanceOf(match, player.id)?.energy ?? player.fitness);
    }
  }

  const ctx: FastContext = { match, env, rng, home, away, energy, score: { home: 0, away: 0 }, minute: 0, extraTime: false };

  // --- How much of the ball, and how many shots -----------------------------
  const homeControl = home.strength.control * home.profile.controlMultiplier;
  const awayControl = away.strength.control * away.profile.controlMultiplier;
  const possessionNoise = rng.gaussian(0, 2.4);
  const homePossession = clamp(Math.round((homeControl / (homeControl + awayControl)) * 100 + possessionNoise), 30, 70);
  const shares: Record<Side, number> = { home: homePossession / 100, away: 1 - homePossession / 100 };

  const expectedShots = (att: RunningSide, def: RunningSide): number => {
    const attack = att.strength.attack * att.profile.attackMultiplier;
    const defence = Math.max(0.1, def.strength.defence * def.profile.defenceMultiplier);
    const ratio = clamp(attack / defence, 0.35, 2.6);
    const advantage = att.side === 'home' && !match.neutralVenue ? HOME_ADVANTAGE : 1;
    return (
      FAST_CALIBRATION.shotsPerSide *
      Math.pow(ratio, 0.85) *
      att.profile.shotRateMultiplier *
      advantage *
      (0.75 + 0.5 * shares[att.side])
    );
  };
  const expectedFouls = (side: RunningSide): number =>
    FAST_CALIBRATION.foulsPerSide * side.profile.foulRate * (0.6 + 0.4 * side.strength.aggression);

  const shotRate: Record<Side, number> = { home: expectedShots(home, away), away: expectedShots(away, home) };
  const foulRate: Record<Side, number> = { home: expectedFouls(home), away: expectedFouls(away) };

  // --- The whistle ----------------------------------------------------------
  const addedFirst = rng.int(1, 6);
  const addedSecond = rng.int(2, 8);
  match.stoppage = { first: addedFirst, second: addedSecond };
  const regulationMinutes = 90 + addedFirst + addedSecond;

  emit(ctx, 'kick-off', null, { text: 'Kick-off.', x: 0.5, y: 0.5, importance: 1 });

  /** Burn a minute of stamina and walk the minute's football. */
  const stepMinute = (minute: number): void => {
    ctx.minute = minute;
    for (const side of [home, away]) {
      for (const player of side.onPitch) {
        const current = energy.get(player.id) ?? player.fitness;
        const drain = (side.positionOf.get(player.id) === 'GK' ? 0.35 : 1) * FAST_CALIBRATION.staminaPerMinute;
        energy.set(player.id, Math.max(0, current - drain));
      }
    }

    // The draws alternate which side is asked first, so neither side is
    // systematically the one who gets the last word of every minute.
    const order: Side[] = minute % 2 === 0 ? ['home', 'away'] : ['away', 'home'];
    for (const s of order) {
      const side = s === 'home' ? home : away;
      const other = s === 'home' ? away : home;
      const shortHanded = 1 - side.sentOff * 0.18;
      const againstTen = 1 + other.sentOff * 0.12;
      if (rng.chance((shotRate[s] / regulationMinutes) * shortHanded * againstTen)) resolveShot(ctx, side, other);
      if (rng.chance((foulRate[s] / regulationMinutes) * shortHanded)) resolveFoul(ctx, side);
      const penaltyChance = (FAST_CALIBRATION.penaltiesPerSide / regulationMinutes) * againstTen;
      if (rng.chance(penaltyChance)) resolvePenalty(ctx, side);
    }

    resolveInjuries(ctx);

    if (FAST_CALIBRATION.benchCheckMinutes.includes(minute)) {
      for (const s of order) reviewBench(ctx, s === 'home' ? home : away);
    }
  };

  for (let minute = 1; minute <= regulationMinutes; minute += 1) {
    stepMinute(minute);
    if (minute === 45 + addedFirst) {
      halfTime(ctx, 45);
    }
  }
  ctx.minute = regulationMinutes;
  match.half = 2;
  match.period = 'second-half';

  // --- Extra time, if the tie is a knockout one still level -----------------
  let decidedBy: FastMatchResult['decidedBy'] = 'normal-time';
  let penalties: { home: number; away: number } | undefined;
  if (match.knockout && ctx.score.home === ctx.score.away) {
    emit(ctx, 'extra-time', null, {
      text: `Extra time: ${ctx.score.home}-${ctx.score.away}.`,
      x: 0.5,
      y: 0.5,
      importance: 3,
    });
    ctx.extraTime = true;
    match.half = 3;
    match.period = 'extra-first';
    const EXTRA_MINUTES = 30;
    const extraStart = regulationMinutes;
    for (let extra = 1; extra <= EXTRA_MINUTES; extra += 1) {
      if (extra === 16) match.period = 'extra-second';
      // Fifteen minutes a period, played the same way but at the same rate: the
      // extra half hour is a third of a match, so it produces a third of the shots.
      ctx.minute = extraStart + extra;
      for (const s of SIDES) {
        const side = s === 'home' ? home : away;
        const other = s === 'home' ? away : home;
        if (rng.chance((shotRate[s] / regulationMinutes) / 3)) resolveShot(ctx, side, other);
        if (rng.chance((foulRate[s] / regulationMinutes) / 3)) resolveFoul(ctx, side);
      }
    }
    ctx.minute = extraStart + EXTRA_MINUTES;
    match.half = 3;
    match.period = 'extra-second';
    decidedBy = 'extra-time';

    if (ctx.score.home === ctx.score.away) {
      const shootout = resolveShootout(ctx);
      penalties = { home: shootout.home, away: shootout.away };
      decidedBy = 'shootout';
    }
  }

  // --- Minutes, then the figures read off them -------------------------------
  //
  // Minutes come first because passes, tackles and interceptions are apportioned
  // by how long each man was actually on the pitch. A man who started plays the
  // whole match unless he was withdrawn or sent off; a substitute plays from the
  // minute he came on; a man never used plays none at all — the mistake that
  // makes a bench look like twenty-two men who each played the full ninety.
  for (const side of [home, away]) {
    const named = [
      ...side.starting,
      ...side.lineup.bench.map((slot) => env.getPlayer(slot.playerId)).filter(isPlayer),
    ];
    for (const player of named) {
      const perf = performanceOf(match, player.id);
      if (!perf) continue;
      if (!perf.started && perf.cameOnMinute === null) {
        perf.minutesPlayed = 0;
        continue;
      }
      if (perf.sentOff) continue;
      const from = perf.cameOnMinute ?? 0;
      const to = perf.wentOffMinute ?? ctx.minute;
      perf.minutesPlayed = Math.max(0, to - from);
      perf.energy = Math.round(energy.get(player.id) ?? perf.energy);
    }
  }

  match.substitutions = { home: home.substitutions, away: away.substitutions };

  fillAggregates(home, shares.home, ctx);
  fillAggregates(away, shares.away, ctx);
  ratePerformances(ctx);

  // --- The whistle ----------------------------------------------------------
  const totalSeconds = ctx.minute * 60;
  emit(ctx, 'full-time', null, {
    text: `Full time: ${ctx.score.home}-${ctx.score.away}.`,
    x: 0.5,
    y: 0.5,
    importance: 3,
  });

  match.status = 'finished';
  match.played = true;
  match.minute = ctx.minute;
  match.footballSeconds = totalSeconds;
  match.possessionTicks = {
    home: Math.round((totalSeconds * homePossession) / 100),
    away: Math.round((totalSeconds * (100 - homePossession)) / 100),
  };
  match.result = {
    homeGoals: ctx.score.home,
    awayGoals: ctx.score.away,
    homeShots: Object.values(match.performances)
      .filter((perf) => perf.clubId === match.homeClubId)
      .reduce((sum, perf) => sum + perf.shots, 0),
    awayShots: Object.values(match.performances)
      .filter((perf) => perf.clubId === match.awayClubId)
      .reduce((sum, perf) => sum + perf.shots, 0),
    homePossession,
    awayPossession: 100 - homePossession,
    attendance: Math.max(10, Math.round(env.expectedAttendance)),
    ...(penalties ? { penalties } : {}),
  };

  return {
    mode: 'fast',
    homeGoals: ctx.score.home,
    awayGoals: ctx.score.away,
    homeShots: match.result.homeShots,
    awayShots: match.result.awayShots,
    homePossession,
    awayPossession: 100 - homePossession,
    decidedBy,
  };
}

/** The mode tag, re-exported so a caller need not know where it lives. */
export type { MatchSimulationMode } from '@/domain/match';

/** The side a club is playing for, for a caller reading a record back. */
export { sideOfClub };
