import type { ClubId, PlayerId } from '@/domain/ids';
import type { InjuryDetail, Match, MatchEvent, MatchEventType, PlayerPerformance } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { PositionCode } from '@/domain/positions';
import type { Tactics } from '@/domain/tactics';
import { stream, type Rng } from '../rng';
import * as C from './commentary';
import { computeTeamStrength, playerEffectiveness, positionRoleWeights, type TeamStrength } from './teamStrength';
import { tacticalProfile, conditionEffects, type TacticalProfile } from './tacticsModel';

/**
 * The match engine advances one minute at a time from a serialisable state.
 *
 * Randomness is drawn from `(match.seed, half, minute)` streams rather than a
 * mutable generator, so a fixture replays identically from any starting point,
 * and any mid-match decision (a substitution, a tactical switch) genuinely
 * changes what happens from that minute onward.
 */

export type Side = 'home' | 'away';

export interface MatchEnvironment {
  getPlayer: (id: PlayerId) => Player | undefined;
  clubName: (id: ClubId) => string;
  clubShortName: (id: ClubId) => string;
  /** Club whose bench is managed by the human; the engine leaves its bench alone. */
  userClubId: ClubId | null;
  /** When true the engine manages both benches (instant results, other games). */
  autoManageAllBenches: boolean;
  substitutionsAllowed: number;
  /** 1-20 referee strictness. */
  refereeStrictness: number;
  /** Pre-match estimate from the matchday service; the engine adds noise to it. */
  expectedAttendance: number;
  /**
   * How well a club knows its system, and how settled it is (0-1 each, 0.5
   * neutral). Supplied by the matchday service from the training state; when a
   * caller (a test, a friendly) does not provide them the side is treated as
   * ordinary, which is what a fresh world looks like.
   */
  tacticalFamiliarity?: (clubId: ClubId) => number;
  cohesion?: (clubId: ClubId) => number;
}

export interface MinuteResult {
  minute: number;
  events: MatchEvent[];
  halfTime: boolean;
  finished: boolean;
}

const BASE_SHOT_RATE = 0.225;
const BASE_FOUL_RATE = 0.13;
const BASE_INJURY_RATE = 0.00055;
const SIDES: Side[] = ['home', 'away'];

export function otherSide(side: Side): Side {
  return side === 'home' ? 'away' : 'home';
}

export function sideClubId(match: Match, side: Side): ClubId {
  return side === 'home' ? match.homeClubId : match.awayClubId;
}

function stoppageMinutes(match: Match, half: 1 | 2): number {
  return stream(match.seed, 'stoppage', half).int(half === 1 ? 1 : 2, half === 1 ? 5 : 7);
}

export function halfEndMinute(match: Match, half: 1 | 2): number {
  if (half === 1) return 45 + stoppageMinutes(match, 1);
  return 90 + stoppageMinutes(match, 1) + stoppageMinutes(match, 2);
}

/** Human-facing minute label, e.g. "45+2". */
export function displayMinute(match: Match): string {
  if (match.half === 1 && match.minute > 45) return `45+${match.minute - 45}`;
  if (match.half === 2 && match.minute > 90) return `90+${match.minute - 90}`;
  return String(match.minute);
}

export function currentScore(match: Match): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const event of match.events) {
    if (event.type === 'goal' || event.type === 'penalty-scored') {
      if (event.clubId === match.homeClubId) home += 1;
      else if (event.clubId === match.awayClubId) away += 1;
    }
  }
  return { home, away };
}

export function performanceOf(match: Match, playerId: PlayerId): PlayerPerformance | undefined {
  return match.performances[playerId];
}

interface SideContext {
  side: Side;
  strength: TeamStrength;
  profile: TacticalProfile;
  tactics: Tactics;
}

interface MatchContext {
  home: SideContext;
  away: SideContext;
  homeAdvantage: number;
}

function buildContext(match: Match, env: MatchEnvironment): MatchContext {
  const build = (side: Side): SideContext => {
    const lineup = match.lineups[side];
    const clubId = sideClubId(match, side);
    const strength = computeTeamStrength({
      slots: lineup.starting,
      players: env.getPlayer,
      tactics: lineup.tactics,
      conditions: match.conditions,
      energy: (id) => performanceOf(match, id)?.energy ?? 100,
      carryingInjury: (id) => Boolean(performanceOf(match, id)?.injuryDetail),
      tacticalFamiliarity: env.tacticalFamiliarity?.(clubId),
      cohesion: env.cohesion?.(clubId),
    });
    return { side, strength, profile: tacticalProfile(lineup.tactics, match.conditions), tactics: lineup.tactics };
  };
  return {
    home: build('home'),
    away: build('away'),
    homeAdvantage: match.neutralVenue ? 1 : 1.045,
  };
}

function makeEvent(
  match: Match,
  type: MatchEventType,
  options: {
    minute: number;
    side: Side | null;
    playerId?: PlayerId | null;
    secondaryPlayerId?: PlayerId | null;
    text: string;
    x: number;
    y: number;
    importance: 1 | 2 | 3;
    /** Goal events report the score *including* the goal just scored. */
    scoreAfter?: { home: number; away: number };
  },
): MatchEvent {
  return {
    id: `${match.id}_e${match.events.length + 1}`,
    minute: options.minute,
    type,
    clubId: options.side ? sideClubId(match, options.side) : null,
    playerId: options.playerId ?? null,
    secondaryPlayerId: options.secondaryPlayerId ?? null,
    text: options.text,
    x: options.x,
    y: options.y,
    scoreAfter: options.scoreAfter ?? currentScore(match),
    importance: options.importance,
  };
}

function pushEvent(match: Match, event: MatchEvent, sink: MatchEvent[]): void {
  match.events.push(event);
  sink.push(event);
}

function textContext(
  env: MatchEnvironment,
  match: Match,
  side: Side,
  rng: Rng,
  extras: { player?: Player | null; partner?: Player | null; quality?: number; score?: string } = {},
): C.CommentaryContext {
  const opponent = otherSide(side);
  const score = currentScore(match);
  return {
    player: extras.player ?? null,
    partner: extras.partner ?? null,
    teamName: env.clubShortName(sideClubId(match, side)),
    opponentName: env.clubShortName(sideClubId(match, opponent)),
    minute: match.minute,
    score: extras.score ?? `${score.home}-${score.away}`,
    quality: extras.quality,
    rngPick: <T,>(items: readonly T[]) => rng.pick(items),
  };
}

/** Pitch coordinates for an action by `side`, respecting which way they attack. */
function attackingCoordinates(match: Match, side: Side, rng: Rng, depth: 'chance' | 'build' = 'chance'): { x: number; y: number } {
  const attackingHome = match.half === 1 ? side === 'home' : side === 'away';
  const dir = attackingHome ? 1 : -1;
  const reach = depth === 'chance' ? rng.float(0.16, 0.44) : rng.float(0.02, 0.2);
  return {
    x: Math.max(0.02, Math.min(0.98, 0.5 + dir * reach)),
    y: Math.max(0.06, Math.min(0.94, rng.float(0.1, 0.9))),
  };
}

function newPerformance(
  playerId: PlayerId,
  player: Player | undefined,
  clubId: ClubId,
  position: PositionCode,
  started: boolean,
  cameOnMinute: number | null,
): PlayerPerformance {
  return {
    playerId,
    clubId,
    started,
    minutesPlayed: 0,
    positionPlayed: position,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    tackles: 0,
    interceptions: 0,
    saves: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    rating: 6,
    cameOnMinute,
    wentOffMinute: null,
    energy: player?.fitness ?? 100,
    injuryDetail: null,
    sentOff: false,
  };
}

export function beginMatch(match: Match, env: MatchEnvironment): void {
  if (match.status !== 'scheduled') return;

  for (const side of SIDES) {
    const lineup = match.lineups[side];
    const clubId = sideClubId(match, side);
    for (const slot of lineup.starting) {
      match.performances[slot.playerId] = newPerformance(slot.playerId, env.getPlayer(slot.playerId), clubId, slot.position, true, null);
    }
    for (const bench of lineup.bench) {
      match.performances[bench.playerId] = newPerformance(bench.playerId, env.getPlayer(bench.playerId), clubId, bench.position, false, null);
    }
  }

  match.status = 'in-progress';
  match.half = 1;
  match.minute = 0;
  match.possessionTicks = { home: 0, away: 0 };
  match.substitutions = { home: 0, away: 0 };

  const rng = stream(match.seed, 'prematch');
  match.incidents = [];
  if (rng.chance(0.35)) {
    const incident = rng.pick(C.INCIDENT_POOL);
    match.incidents.push(incident(env.clubName(match.homeClubId), env.clubName(match.awayClubId)));
  }

  const events: MatchEvent[] = [];
  pushEvent(
    match,
    makeEvent(match, 'note', {
      minute: 0,
      side: null,
      text: C.writeWeatherNote(match.conditions.weather, match.conditions.pitch, rng.float(3, 25)),
      x: 0.5,
      y: 0.5,
      importance: 1,
    }),
    events,
  );
  for (const incident of match.incidents) {
    pushEvent(match, makeEvent(match, 'note', { minute: 0, side: null, text: incident, x: 0.5, y: 0.5, importance: 1 }), events);
  }
  pushEvent(
    match,
    makeEvent(match, 'kick-off', {
      minute: 0,
      side: 'home',
      text: C.writeKickOff(env.clubName(match.homeClubId), env.clubName(match.awayClubId), match.conditions.pitch),
      x: 0.5,
      y: 0.5,
      importance: 1,
    }),
    events,
  );
}

function onPitchIds(match: Match, side: Side): PlayerId[] {
  return match.lineups[side].starting.map((slot) => slot.playerId);
}

function applyFatigue(match: Match, env: MatchEnvironment, context: MatchContext): void {
  for (const side of SIDES) {
    const profile = context[side].profile;
    for (const slot of match.lineups[side].starting) {
      const player = env.getPlayer(slot.playerId);
      const performance = performanceOf(match, slot.playerId);
      if (!player || !performance) continue;
      const staminaFactor = 0.5 + player.attributes.physical.stamina / 20;
      const baseDrain = slot.position === 'GK' ? 0.35 : 0.95;
      const injuryPenalty = performance.injuryDetail ? 1.2 : 1;
      performance.energy = Math.max(0, performance.energy - (baseDrain / staminaFactor) * profile.fatigueRate * injuryPenalty);
      performance.minutesPlayed += 1;
    }
  }
}

function chooseShooter(match: Match, env: MatchEnvironment, side: Side, profile: TacticalProfile, rng: Rng): Player | null {
  const entries = match.lineups[side].starting.map((slot) => {
    const player = env.getPlayer(slot.playerId);
    if (!player) return null;
    const performance = performanceOf(match, slot.playerId);
    const eff = playerEffectiveness(player, slot.position, {
      energy: performance?.energy,
      carryingInjury: Boolean(performance?.injuryDetail),
    });
    const wide = slot.position === 'RM' || slot.position === 'LM' || slot.position === 'RW' || slot.position === 'LW';
    const central = slot.position === 'CM' || slot.position === 'AM' || slot.position === 'ST' || slot.position === 'DM';
    const focusBoost = profile.wideBias > 0.6 ? (wide ? 1.45 : 1) : profile.wideBias < 0.4 ? (central ? 1.25 : 0.92) : 1;
    const crossingBoost = wide ? 1 + Math.max(0, profile.wideBias - 0.5) * 0.5 : 1;
    const weight = Math.max(
      0.0001,
      positionRoleWeights(slot.position).att * Math.pow(Math.max(1, eff.effective.shooting), 2.1) * focusBoost * crossingBoost,
    );
    return { value: player, weight };
  });

  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

function chooseAssister(match: Match, env: MatchEnvironment, side: Side, shooterId: PlayerId, rng: Rng): Player | null {
  const entries = match.lineups[side].starting
    .filter((slot) => slot.playerId !== shooterId && slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
      const creation = eff.effective.passing * 0.6 + eff.effective.crossing * 0.25 + eff.effective.ballControl * 0.15;
      return { value: player, weight: Math.max(0.0001, Math.pow(Math.max(1, creation), 1.8)) };
    });

  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

function chooseAggressor(match: Match, env: MatchEnvironment, side: Side, rng: Rng): Player | null {
  const entries = match.lineups[side].starting.map((slot) => {
    const player = env.getPlayer(slot.playerId);
    if (!player) return null;
    const performance = performanceOf(match, slot.playerId);
    const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
    const weight = Math.max(
      0.0001,
      positionRoleWeights(slot.position).def * Math.pow(Math.max(1, eff.effective.aggression), 2),
    );
    return { value: player, weight };
  });
  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

function chooseVictim(match: Match, env: MatchEnvironment, side: Side, rng: Rng): Player | null {
  const entries = match.lineups[side].starting
    .filter((slot) => slot.position !== 'GK')
    .map((slot) => {
      const player = env.getPlayer(slot.playerId);
      if (!player) return null;
      const performance = performanceOf(match, slot.playerId);
      const eff = playerEffectiveness(player, slot.position, { energy: performance?.energy });
      const weight = Math.max(0.0001, positionRoleWeights(slot.position).att + 0.4 + eff.effective.pace / 60);
      return { value: player, weight };
    });
  const usable = entries.filter((entry): entry is { value: Player; weight: number } => entry !== null);
  if (usable.length === 0) return null;
  return rng.weighted(usable);
}

/**
 * Most Sunday League injuries are knocks and strains. Serious ones are rare
 * enough to be genuinely memorable; a bad pitch and a tired body raise the
 * odds of the middle categories, not of a broken leg.
 */
function pickInjury(rng: Rng, player: Player, energy: number, injuryRate: number): InjuryDetail {
  const susceptibility = player.attributes.hidden.injurySusceptibility;
  const tiredness = 1 + (100 - energy) / 140;
  const seriousChance = 0.022 * injuryRate * (0.6 + susceptibility / 20);
  const moderateChance = 0.1 * injuryRate * tiredness;
  const minorChance = 0.28 * tiredness;

  const roll = rng.next();
  let severity: InjuryDetail['severity'];
  if (roll < seriousChance) severity = 'serious';
  else if (roll < seriousChance + moderateChance) severity = 'moderate';
  else if (roll < seriousChance + moderateChance + minorChance) severity = 'minor';
  else severity = 'knock';

  const descriptions: Record<InjuryDetail['severity'], string[]> = {
    knock: ['a dead leg', 'a knock on the ankle', 'a bang on the knee', 'a cut above the eye'],
    minor: ['a twisted ankle', 'a tight hamstring', 'a pulled calf', 'bruised ribs', 'a groin strain'],
    moderate: ['a hamstring tear', 'a badly rolled ankle', 'a medial knee strain', 'a shoulder injury'],
    serious: ['a suspected broken leg', 'cruciate ligament damage', 'a dislocated shoulder', 'a fractured collarbone'],
  };
  const daysOut =
    severity === 'knock'
      ? rng.int(0, 3)
      : severity === 'minor'
        ? rng.int(4, 12)
        : severity === 'moderate'
          ? rng.int(14, 38)
          : rng.int(60, 240);

  return { description: rng.pick(descriptions[severity]), severity, daysOut };
}

function makeSubstitution(match: Match, env: MatchEnvironment, side: Side, outgoingId: PlayerId, sink: MatchEvent[]): boolean {
  const lineup = match.lineups[side];
  if (lineup.bench.length === 0) return false;
  if (match.substitutions[side] >= env.substitutionsAllowed) return false;

  const slotIndex = lineup.starting.findIndex((slot) => slot.playerId === outgoingId);
  if (slotIndex < 0) return false;
  const slot = lineup.starting[slotIndex]!;
  const outgoing = env.getPlayer(outgoingId);

  const candidates = lineup.bench
    .map((bench, index) => {
      const player = env.getPlayer(bench.playerId);
      if (!player) return { index, player: null, score: -1 };
      const familiarity = player.positionalFamiliarity[slot.position] ?? 0;
      const suitability = familiarity / 20 + (player.preferredPosition === slot.position ? 1 : 0);
      return { index, player, score: suitability * 2 + player.fitness / 100 };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = candidates[0];
  if (!chosen || !chosen.player) return false;
  const incoming = chosen.player;

  const performance = performanceOf(match, outgoingId);
  if (performance) performance.wentOffMinute = match.minute;

  lineup.bench.splice(chosen.index, 1);
  lineup.starting[slotIndex] = {
    playerId: incoming.id,
    position: slot.position,
    outOfPosition: (incoming.positionalFamiliarity[slot.position] ?? 0) < 12,
  };
  match.performances[incoming.id] = newPerformance(incoming.id, incoming, sideClubId(match, side), slot.position, false, match.minute);
  match.substitutions[side] += 1;

  pushEvent(
    match,
    makeEvent(match, 'substitution', {
      minute: match.minute,
      side,
      playerId: incoming.id,
      secondaryPlayerId: outgoingId,
      text: C.writeSubstitution(
        `${incoming.firstName.charAt(0)}. ${incoming.surname}`,
        outgoing ? `${outgoing.firstName.charAt(0)}. ${outgoing.surname}` : 'a teammate',
        env.clubName(sideClubId(match, side)),
      ),
      x: 0.5,
      y: 0.5,
      importance: 2,
    }),
    sink,
  );
  return true;
}

/** Bench management: injuries first, then tired legs late on. */
function manageBench(match: Match, env: MatchEnvironment, side: Side, rng: Rng, sink: MatchEvent[]): void {
  if (env.userClubId === sideClubId(match, side) && !env.autoManageAllBenches) return;

  const onPitch = onPitchIds(match, side);
  const injured = onPitch.find((id) => performanceOf(match, id)?.injuryDetail);
  if (injured && match.minute > 2 && makeSubstitution(match, env, side, injured, sink)) return;

  if (match.minute < 55) return;
  const tired = onPitch
    .map((id) => ({
      id,
      energy: performanceOf(match, id)?.energy ?? 100,
      position: match.lineups[side].starting.find((slot) => slot.playerId === id)?.position,
    }))
    .filter((entry) => entry.position && entry.position !== 'GK')
    .sort((a, b) => a.energy - b.energy)[0];

  if (!tired || tired.energy > 46) return;
  if (rng.chance(0.16)) makeSubstitution(match, env, side, tired.id, sink);
}

function pushCorner(match: Match, env: MatchEnvironment, side: Side, rng: Rng, sink: MatchEvent[]): void {
  const coords = attackingCoordinates(match, side, rng, 'chance');
  pushEvent(
    match,
    makeEvent(match, 'corner', {
      minute: match.minute,
      side,
      text: `Corner to ${env.clubShortName(sideClubId(match, side))}.`,
      x: 0.98,
      y: coords.y < 0.5 ? 0.02 : 0.98,
      importance: 1,
    }),
    sink,
  );
}

function resolveShot(match: Match, env: MatchEnvironment, context: MatchContext, side: Side, rng: Rng, sink: MatchEvent[]): void {
  const opponent = otherSide(side);
  const shooter = chooseShooter(match, env, side, context[side].profile, rng);
  if (!shooter) return;
  const shooterPerf = performanceOf(match, shooter.id);
  if (!shooterPerf) return;

  const keeperSlot = match.lineups[opponent].starting.find((slot) => slot.position === 'GK');
  const keeper = keeperSlot ? env.getPlayer(keeperSlot.playerId) : undefined;
  const keeperPerf = keeper ? performanceOf(match, keeper.id) : undefined;

  const shooterEff = playerEffectiveness(shooter, shooterPerf.positionPlayed, {
    energy: shooterPerf.energy,
    carryingInjury: Boolean(shooterPerf.injuryDetail),
  });
  const keeperEff = keeper
    ? playerEffectiveness(keeper, 'GK', { energy: keeperPerf?.energy, carryingInjury: Boolean(keeperPerf?.injuryDetail) })
    : null;

  const shooterQuality = Math.max(
    0.05,
    Math.min(
      1,
      (shooterEff.effective.shooting * 0.5 +
        shooterEff.effective.composure * 0.22 +
        shooterEff.effective.ballControl * 0.16 +
        shooterEff.effective.positioning * 0.12) /
        20,
    ),
  );
  const keeperQuality = keeperEff
    ? Math.max(
        0.05,
        Math.min(
          1,
          (keeperEff.effective.goalkeeping * 0.7 + keeperEff.effective.positioning * 0.15 + keeperEff.effective.agility * 0.15) / 20,
        ),
      )
    : 0.35;

  const defenderPower = context[opponent].strength.defence * context[opponent].profile.defenceMultiplier;
  const controlEdge = Math.max(
    0.2,
    Math.min(0.8, 0.5 + (context[side].strength.control - defenderPower) * 0.15),
  );
  const quality = Math.max(
    0.1,
    Math.min(0.92, (0.16 + shooterQuality * 0.48 + controlEdge * 0.4) * context[side].profile.shotQualityMultiplier),
  );

  const pOnTarget = Math.max(0.1, Math.min(0.75, 0.22 + quality * 0.42 - keeperQuality * 0.18));
  const pGoal = Math.max(0.05, Math.min(0.62, 0.3 + quality * 0.4 - keeperQuality * 0.26));

  const coords = attackingCoordinates(match, side, rng);
  shooterPerf.shots += 1;
  // A shot is rarely a solo effort: passes lead up to it.
  shooterPerf.passes += rng.int(1, 4);

  const roll = rng.next();
  if (roll < pOnTarget) {
    shooterPerf.shotsOnTarget += 1;
    if (rng.next() < pGoal) {
      const assist = rng.chance(0.72) ? chooseAssister(match, env, side, shooter.id, rng) : null;
      shooterPerf.goals += 1;
      const assistPerf = assist ? performanceOf(match, assist.id) : undefined;
      if (assistPerf) assistPerf.assists += 1;

      const score = currentScore(match);
      const nextScore = {
        home: score.home + (side === 'home' ? 1 : 0),
        away: score.away + (side === 'away' ? 1 : 0),
      };
      pushEvent(
        match,
        makeEvent(match, 'goal', {
          minute: match.minute,
          side,
          playerId: shooter.id,
          secondaryPlayerId: assist?.id ?? null,
          text: C.writeGoal(
            textContext(env, match, side, rng, {
              player: shooter,
              partner: assist,
              quality,
              score: `${nextScore.home}-${nextScore.away}`,
            }),
          ),
          x: coords.x,
          y: coords.y,
          importance: 3,
          scoreAfter: nextScore,
        }),
        sink,
      );
      return;
    }

    if (keeperPerf) keeperPerf.saves += 1;
    pushEvent(
      match,
      makeEvent(match, 'shot-saved', {
        minute: match.minute,
        side,
        playerId: shooter.id,
        secondaryPlayerId: keeper?.id ?? null,
        text: C.writeSaved(textContext(env, match, side, rng, { player: shooter, partner: keeper, quality })),
        x: coords.x,
        y: coords.y,
        importance: 2,
      }),
      sink,
    );
    if (rng.chance(0.55)) pushCorner(match, env, side, rng, sink);
    return;
  }

  if (roll < pOnTarget + (1 - pOnTarget) * 0.45) {
    const blocker = chooseAggressor(match, env, opponent, rng);
    const blockerPerf = blocker ? performanceOf(match, blocker.id) : undefined;
    if (blockerPerf) blockerPerf.tackles += 1;
    pushEvent(
      match,
      makeEvent(match, 'shot-blocked', {
        minute: match.minute,
        side,
        playerId: shooter.id,
        secondaryPlayerId: blocker?.id ?? null,
        text: C.writeBlocked(textContext(env, match, side, rng, { player: shooter, partner: blocker })),
        x: coords.x,
        y: coords.y,
        importance: 1,
      }),
      sink,
    );
    if (rng.chance(0.4)) pushCorner(match, env, side, rng, sink);
    return;
  }

  pushEvent(
    match,
    makeEvent(match, 'shot-off-target', {
      minute: match.minute,
      side,
      playerId: shooter.id,
      text: C.writeOffTarget(textContext(env, match, side, rng, { player: shooter })),
      x: coords.x,
      y: coords.y < 0.5 ? Math.max(0, coords.y - 0.06) : Math.min(1, coords.y + 0.06),
      importance: 1,
    }),
    sink,
  );
}

function resolveFoul(match: Match, env: MatchEnvironment, context: MatchContext, side: Side, rng: Rng, sink: MatchEvent[]): void {
  const offender = chooseAggressor(match, env, side, rng);
  if (!offender) return;
  const victimSide = otherSide(side);
  const victim = chooseVictim(match, env, victimSide, rng);
  const offenderPerf = performanceOf(match, offender.id);
  if (offenderPerf) offenderPerf.fouls += 1;

  const coords = attackingCoordinates(match, victimSide, rng, 'build');
  pushEvent(
    match,
    makeEvent(match, 'foul', {
      minute: match.minute,
      side,
      playerId: offender.id,
      secondaryPlayerId: victim?.id ?? null,
      text: C.writeFoul(textContext(env, match, side, rng, { player: offender, partner: victim })),
      x: coords.x,
      y: coords.y,
      importance: 1,
    }),
    sink,
  );

  if (!offenderPerf) return;
  const discipline = offender.attributes.behavioural.discipline;
  const strictness = env.refereeStrictness;
  const cardRate = context[side].profile.cardRate;
  const baseCardChance = 0.09 * (1 + (12 - discipline) / 12) * cardRate * (strictness / 11);
  const roll = rng.next();

  if (roll < baseCardChance) {
    offenderPerf.yellowCards += 1;
    if (offenderPerf.yellowCards >= 2) {
      sendOff(match, env, side, offender, sink, rng, 'second-yellow');
      return;
    }
    pushEvent(
      match,
      makeEvent(match, 'yellow-card', {
        minute: match.minute,
        side,
        playerId: offender.id,
        text: C.writeYellow(textContext(env, match, side, rng, { player: offender })),
        x: coords.x,
        y: coords.y,
        importance: 2,
      }),
      sink,
    );
    return;
  }

  // Straight reds are rarer still, and the hot-headed are likelier to see one.
  if (roll < baseCardChance + 0.0022 * (1 + (14 - discipline) / 8) * cardRate) {
    sendOff(match, env, side, offender, sink, rng, 'straight-red');
  }
}

function sendOff(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  player: Player,
  sink: MatchEvent[],
  rng: Rng,
  kind: 'second-yellow' | 'straight-red',
): void {
  const performance = performanceOf(match, player.id);
  if (!performance || performance.sentOff) return;
  if (kind === 'straight-red') performance.redCards += 1;
  performance.sentOff = true;
  performance.wentOffMinute = match.minute;

  match.lineups[side].starting = match.lineups[side].starting.filter((slot) => slot.playerId !== player.id);

  const ctx = textContext(env, match, side, rng, { player });
  const text = kind === 'second-yellow' ? C.writeSecondYellow(ctx) : C.writeRed(ctx);
  pushEvent(
    match,
    makeEvent(match, 'red-card', { minute: match.minute, side, playerId: player.id, text, x: 0.5, y: 0.5, importance: 3 }),
    sink,
  );
}

function resolveInjury(
  match: Match,
  env: MatchEnvironment,
  rng: Rng,
  injuryRate: number,
  sink: MatchEvent[],
): void {
  for (const side of SIDES) {
    for (const slot of match.lineups[side].starting) {
      const player = env.getPlayer(slot.playerId);
      const performance = performanceOf(match, slot.playerId);
      if (!player || !performance || performance.injuryDetail) continue;
      const susceptibility = player.attributes.hidden.injurySusceptibility;
      const tiredness = 1 + (100 - performance.energy) / 140;
      const probability = BASE_INJURY_RATE * injuryRate * (0.4 + susceptibility / 12) * tiredness;
      if (!rng.chance(probability)) continue;

      performance.injuryDetail = pickInjury(rng, player, performance.energy, injuryRate);
      pushEvent(
        match,
        makeEvent(match, 'injury', {
          minute: match.minute,
          side,
          playerId: player.id,
          text: C.writeInjury(textContext(env, match, side, rng, { player })),
          ...attackingCoordinates(match, otherSide(side), rng, 'build'),
          importance: 2,
        }),
        sink,
      );
      return; // At most one injury per minute.
    }
  }
}

/** Passes are recorded statistically rather than pass-by-pass. */
function resolvePasses(match: Match, env: MatchEnvironment, side: Side, rng: Rng): void {
  const slots = match.lineups[side].starting;
  if (slots.length === 0) return;
  const count = rng.int(1, 4);
  for (let i = 0; i < count; i++) {
    const slot = rng.pick(slots);
    const performance = performanceOf(match, slot.playerId);
    const player = env.getPlayer(slot.playerId);
    if (!performance || !player) continue;
    const eff = playerEffectiveness(player, slot.position, { energy: performance.energy });
    if (rng.chance(Math.min(0.95, eff.effective.passing / 22))) performance.passes += 1;
  }
}

function computeRating(match: Match, performance: PlayerPerformance): number {
  const score = currentScore(match);
  const isHome = performance.clubId === match.homeClubId;
  const conceded = isHome ? score.away : score.home;
  const scored = isHome ? score.home : score.away;
  const defWeight = defensiveWeight(performance.positionPlayed);

  let rating = 6.1;
  rating += performance.goals * 1.15;
  rating += performance.assists * 0.6;
  rating += performance.shotsOnTarget * 0.05;
  rating += performance.tackles * 0.035;
  rating += performance.saves * 0.12;
  rating += performance.passes * 0.004;
  rating -= performance.fouls * 0.02;
  rating -= performance.yellowCards * 0.35;
  rating -= performance.redCards * 1.4;
  rating -= conceded * 0.1 * defWeight * (performance.positionPlayed === 'GK' ? 1.4 : 1);
  if (conceded === 0) rating += 0.25 * (performance.positionPlayed === 'GK' ? 1.2 : defWeight);
  rating += scored > conceded ? 0.3 : scored === conceded ? 0.1 : -0.2;
  if (performance.minutesPlayed < 20) rating = 6 + (rating - 6) * 0.6;
  if (performance.injuryDetail) rating -= 0.1;

  return Math.max(3, Math.min(10, Math.round(rating * 10) / 10));
}

function defensiveWeight(position: PositionCode): number {
  const def = positionRoleWeights(position).def;
  return def >= 0.7 ? 1 : def >= 0.4 ? 0.6 : 0.25;
}

function attendanceFrom(env: MatchEnvironment, match: Match): number {
  const rng = stream(match.seed, 'attendance');
  return Math.max(10, Math.round(env.expectedAttendance * (1 + rng.float(-0.12, 0.15))));
}

function finishMatch(match: Match, env: MatchEnvironment, sink: MatchEvent[]): void {
  match.status = 'finished';
  match.played = true;
  const score = currentScore(match);

  pushEvent(
    match,
    makeEvent(match, 'full-time', {
      minute: match.minute,
      side: null,
      text: C.writeFullTime(score.home, score.away),
      x: 0.5,
      y: 0.5,
      importance: 3,
    }),
    sink,
  );

  const ticks = match.possessionTicks.home + match.possessionTicks.away;
  const homePossession = ticks === 0 ? 50 : Math.round((match.possessionTicks.home / ticks) * 100);

  match.result = {
    homeGoals: score.home,
    awayGoals: score.away,
    homeShots: sumShots(match, 'home'),
    awayShots: sumShots(match, 'away'),
    homePossession,
    awayPossession: 100 - homePossession,
    attendance: attendanceFrom(env, match),
  };

  for (const performance of Object.values(match.performances)) {
    performance.rating = computeRating(match, performance);
  }
}

function sumShots(match: Match, side: Side): number {
  const clubId = sideClubId(match, side);
  return Object.values(match.performances)
    .filter((performance) => performance.clubId === clubId)
    .reduce((sum, performance) => sum + performance.shots, 0);
}

export function advanceMinute(match: Match, env: MatchEnvironment): MinuteResult {
  const events: MatchEvent[] = [];
  if (match.status === 'finished') return { minute: match.minute, events, halfTime: false, finished: true };
  if (match.status === 'scheduled') beginMatch(match, env);

  const context = buildContext(match, env);
  const rng = stream(match.seed, 'minute', match.half, match.minute);

  if (match.half === 1) {
    if (match.minute >= halfEndMinute(match, 1)) {
      const score = currentScore(match);
      pushEvent(
        match,
        makeEvent(match, 'half-time', {
          minute: match.minute,
          side: null,
          text: C.writeHalfTime(score.home, score.away),
          x: 0.5,
          y: 0.5,
          importance: 3,
        }),
        events,
      );
      match.half = 2;
      match.minute = 45;
      return { minute: 45, events, halfTime: true, finished: false };
    }
    match.minute += 1;
  } else {
    if (match.minute >= halfEndMinute(match, 2)) {
      finishMatch(match, env, events);
      return { minute: match.minute, events, halfTime: false, finished: true };
    }
    match.minute += 1;
  }

  const injuryRate = conditionEffects(match.conditions).injuryRate;
  applyFatigue(match, env, context);

  // --- Possession -----------------------------------------------------------
  const homeControlPower = context.home.strength.control * context.home.profile.controlMultiplier * context.homeAdvantage;
  const awayControlPower = context.away.strength.control * context.away.profile.controlMultiplier;
  const possessionSide: Side = rng.chance(homeControlPower / (homeControlPower + awayControlPower)) ? 'home' : 'away';
  match.possessionTicks[possessionSide] += 1;
  resolvePasses(match, env, possessionSide, rng);

  // --- Chances --------------------------------------------------------------
  const attacker = context[possessionSide];
  const defender = context[otherSide(possessionSide)];
  const attackPower =
    attacker.strength.attack * attacker.profile.attackMultiplier * (possessionSide === 'home' ? context.homeAdvantage : 1);
  const defencePower = defender.strength.defence * defender.profile.defenceMultiplier;

  // A quality gap matters, but it is compressed: a better side creates more and
  // better chances, it does not become unbeatable.
  const qualityRatio = Math.pow(attackPower / Math.max(0.4, defencePower), 0.6);
  let shotRate = BASE_SHOT_RATE * attacker.profile.shotRateMultiplier * qualityRatio;
  const paceFactor = Math.max(
    0.85,
    Math.min(1.2, 0.88 + 0.12 * (attacker.strength.pace / Math.max(0.5, defender.strength.pace))),
  );
  shotRate *= 1 + (paceFactor - 1) * defender.profile.counterVulnerability;
  shotRate *= 1 + (defender.profile.pressExposure - 1) * 0.5;
  shotRate = Math.max(0.04, Math.min(0.55, shotRate));

  if (rng.chance(shotRate)) {
    resolveShot(match, env, context, possessionSide, rng, events);
  } else if (rng.chance(0.05 * attacker.profile.errorRate)) {
    const player = chooseShooter(match, env, possessionSide, attacker.profile, rng);
    const coords = attackingCoordinates(match, possessionSide, rng, 'build');
    pushEvent(
      match,
      makeEvent(match, 'note', {
        minute: match.minute,
        side: possessionSide,
        playerId: player?.id ?? null,
        text: `${player?.surname ?? 'Somebody'} gives it away cheaply.`,
        x: coords.x,
        y: coords.y,
        importance: 1,
      }),
      events,
    );
  }

  // --- Physicality ----------------------------------------------------------
  const homeFoulChance = BASE_FOUL_RATE * context.home.profile.foulRate * (context.home.strength.aggression + 0.35);
  const awayFoulChance = BASE_FOUL_RATE * context.away.profile.foulRate * (context.away.strength.aggression + 0.35);
  const totalFoulChance = homeFoulChance + awayFoulChance;
  if (rng.chance(totalFoulChance)) {
    const foulSide: Side = rng.chance(homeFoulChance / totalFoulChance) ? 'home' : 'away';
    resolveFoul(match, env, context, foulSide, rng, events);
  }

  resolveInjury(match, env, rng, injuryRate, events);

  // --- Bench ---------------------------------------------------------------
  manageBench(match, env, 'home', rng, events);
  manageBench(match, env, 'away', rng, events);

  return { minute: match.minute, events, halfTime: false, finished: false };
}

/** Run a match to its conclusion. Used for other clubs' fixtures and "instant". */
export function simulateToCompletion(match: Match, env: MatchEnvironment): void {
  if (match.status === 'scheduled') beginMatch(match, env);
  let guard = 0;
  while (match.status !== 'finished' && guard < 400) {
    advanceMinute(match, env);
    guard += 1;
  }
}
