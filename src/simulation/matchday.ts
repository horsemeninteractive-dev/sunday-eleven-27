import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, MatchId, PersonId } from '@/domain/ids';
import type { Match, MatchConditions, MatchLineup, PitchCondition, Weather } from '@/domain/match';
import type { Official, Player } from '@/domain/person';
import type { Ground } from '@/domain/world';
import { monthOf } from './calendar';
import { stream, Rng } from './rng';
import { estimateAttendance } from './match/attendance';
import type { MatchEnvironment } from './match/engine';
import { isPlayer } from '@/domain/person';
import { nextFixtureFor } from './schedule';
import { autoPickLineup } from './selection';
import { clubCohesionValue, clubSystemFamiliarity } from './training/cohesion';

/**
 * Matchday services sit between the world model and the match engine: they
 * decide where a game is played, in what conditions, who referees, who is
 * available, and what the crowd might look like.
 */

const WEATHER_BY_MONTH: Array<Array<{ value: Weather; weight: number }>> = [
  // Jan
  [
    { value: 'cold', weight: 3 },
    { value: 'frozen', weight: 1.6 },
    { value: 'overcast', weight: 2.4 },
    { value: 'light-rain', weight: 2.2 },
    { value: 'heavy-rain', weight: 1.2 },
  ],
  // Feb
  [
    { value: 'cold', weight: 2.4 },
    { value: 'frozen', weight: 1 },
    { value: 'overcast', weight: 2.6 },
    { value: 'light-rain', weight: 2.4 },
    { value: 'windy', weight: 1.4 },
  ],
  // Mar
  [
    { value: 'overcast', weight: 3 },
    { value: 'light-rain', weight: 2.6 },
    { value: 'windy', weight: 2 },
    { value: 'clear', weight: 1.6 },
    { value: 'cold', weight: 1.2 },
  ],
  // Apr
  [
    { value: 'clear', weight: 3 },
    { value: 'overcast', weight: 3 },
    { value: 'light-rain', weight: 2.2 },
    { value: 'windy', weight: 1.6 },
  ],
  // May
  [
    { value: 'clear', weight: 4 },
    { value: 'overcast', weight: 2.6 },
    { value: 'light-rain', weight: 1.6 },
    { value: 'windy', weight: 1.2 },
  ],
  // Jun
  [
    { value: 'clear', weight: 5 },
    { value: 'overcast', weight: 2 },
    { value: 'light-rain', weight: 1.4 },
  ],
  // Jul
  [
    { value: 'clear', weight: 5.4 },
    { value: 'overcast', weight: 1.8 },
    { value: 'light-rain', weight: 1.2 },
  ],
  // Aug
  [
    { value: 'clear', weight: 4.4 },
    { value: 'overcast', weight: 2.2 },
    { value: 'light-rain', weight: 1.8 },
  ],
  // Sep
  [
    { value: 'clear', weight: 3 },
    { value: 'overcast', weight: 3 },
    { value: 'light-rain', weight: 2.4 },
    { value: 'windy', weight: 1.8 },
  ],
  // Oct
  [
    { value: 'overcast', weight: 3.2 },
    { value: 'light-rain', weight: 3 },
    { value: 'heavy-rain', weight: 1.8 },
    { value: 'windy', weight: 2 },
    { value: 'cold', weight: 1.4 },
  ],
  // Nov
  [
    { value: 'overcast', weight: 3 },
    { value: 'light-rain', weight: 3.2 },
    { value: 'heavy-rain', weight: 2.2 },
    { value: 'windy', weight: 2.2 },
    { value: 'cold', weight: 2 },
    { value: 'frozen', weight: 0.6 },
  ],
  // Dec
  [
    { value: 'cold', weight: 3 },
    { value: 'frozen', weight: 1.4 },
    { value: 'overcast', weight: 2.6 },
    { value: 'light-rain', weight: 2.4 },
    { value: 'heavy-rain', weight: 1.4 },
  ],
];

function temperatureFor(rng: Rng, month: number): number {
  const means = [4, 5, 7, 9, 13, 16, 18, 18, 15, 11, 7, 5];
  const mean = means[month] ?? 10;
  return Math.round(rng.gaussian(mean, 3));
}

export function rollMatchConditions(rng: Rng, ground: Ground, date: ISODate): MatchConditions {
  const month = monthOf(date);
  const weather = rng.weighted(WEATHER_BY_MONTH[month] ?? WEATHER_BY_MONTH[9]!);
  const temperatureC = temperatureFor(rng, month);

  // Poor, badly-draining pitches suffer most from rain and frost.
  const drainage = ground.drainage;
  const quality = ground.quality;
  let pitch: PitchCondition;
  const wetness = weather === 'heavy-rain' ? 2 : weather === 'light-rain' ? 1 : 0;
  const floodRisk = wetness - (drainage - 8) / 4 - (quality - 10) / 8;

  if (ground.surface === '3G') {
    pitch = 'excellent';
  } else if (temperatureC <= 0 && floodRisk < 2) {
    pitch = 'frozen';
  } else if (floodRisk >= 1.6) {
    pitch = 'waterlogged';
  } else if (floodRisk >= 0.8) {
    pitch = 'muddy';
  } else if (quality >= 14) {
    pitch = 'excellent';
  } else if (quality >= 10) {
    pitch = 'good';
  } else {
    pitch = 'worn';
  }

  const pitchQuality =
    pitch === 'excellent'
      ? 18
      : pitch === 'good'
        ? 15
        : pitch === 'worn'
          ? 11
          : pitch === 'muddy'
            ? 7
            : pitch === 'waterlogged'
              ? 4
              : 3;

  return { weather, pitch, pitchQuality, temperatureC };
}

export function pickReferee(state: GameState, matchId: MatchId): { id: PersonId | null; strictness: number } {
  const referees = Object.values(state.people).filter((person): person is Official => person.kind === 'official' && person.role === 'referee');
  if (referees.length === 0) return { id: null, strictness: 11 };
  const rng = stream(state.seed, 'referee', matchId);
  const chosen = rng.pick(referees);
  return { id: chosen.id, strictness: chosen.attributes.strictness ?? 11 };
}

export interface CreateMatchParams {
  state: GameState;
  id: MatchId;
  matchday: number;
  date: ISODate;
  homeClubId: ClubId;
  awayClubId: ClubId;
  competitionId: string;
  competitionName: string;
  kickOff: string;
}

export function createMatchRecord(params: CreateMatchParams): Match {
  const { state } = params;
  const home = state.clubs[params.homeClubId]!;
  const ground = state.world.grounds[home.groundId]!;
  const rng = stream(state.seed, 'match', params.id);

  return {
    id: params.id,
    seasonId: state.season.id,
    competitionId: params.competitionId,
    competitionName: params.competitionName,
    matchday: params.matchday,
    date: params.date,
    kickOff: params.kickOff,
    homeClubId: params.homeClubId,
    awayClubId: params.awayClubId,
    groundId: home.groundId,
    neutralVenue: false,
    conditions: rollMatchConditions(rng, ground, params.date),
    refereeId: null,
    lineups: {
      home: emptyLineupState(params.homeClubId),
      away: emptyLineupState(params.awayClubId),
    },
    events: [],
    performances: {},
    status: 'scheduled',
    minute: 0,
    half: 1,
    possessionTicks: { home: 0, away: 0 },
    substitutions: { home: 0, away: 0 },
    played: false,
    result: null,
    seed: rng.int(1, 2 ** 30),
    incidents: [],
    postponementReason: null,
    postponedOn: null,
    originalDate: null,
    replacedByMatchId: null,
    lateCallMade: false,
  };
}

function emptyLineupState(clubId: ClubId): MatchLineup {
  return {
    clubId,
    formation: '',
    starting: [],
    bench: [],
    tactics: {
      formation: '4-4-2',
      mentality: 'balanced',
      passingStyle: 'mixed',
      tempo: 'standard',
      pressing: 'medium',
      defensiveLine: 'standard',
      attackingFocus: 'balanced',
    },
    captainId: null,
  };
}

export function buildLineupForClub(state: GameState, clubId: ClubId): MatchLineup {
  const club = state.clubs[clubId]!;
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  const tactics = club.tactics;
  const selection = autoPickLineup(squad, tactics.formation);
  const captain = selection.starting
    .map((slot) => state.people[slot.playerId])
    .filter(isPlayer)
    .sort((a, b) => b.attributes.mental.determination + b.attributes.behavioural.commitment - (a.attributes.mental.determination + a.attributes.behavioural.commitment))[0];

  return {
    clubId,
    formation: tactics.formation,
    starting: selection.starting,
    bench: selection.bench,
    tactics: { ...tactics },
    captainId: captain?.id ?? null,
  };
}

/**
 * The manager always has a team to edit.
 *
 * Only the day's fixtures get their lineups on the day, so a fixture a week out
 * would otherwise be an empty pitch with an empty bench on it. Filling it from
 * the same auto-pick the opposition uses means he starts from a sensible XI and
 * changes what he wants; his own selections are never overwritten, and the
 * opposition is still picked on the day.
 */
export function ensureUserXi(state: GameState): void {
  const match = nextFixtureFor(state, state.userClubId, state.date);
  if (!match) return;
  const side: 'home' | 'away' = match.homeClubId === state.userClubId ? 'home' : 'away';
  if (match.lineups[side].starting.length > 0) return;
  match.lineups[side] = buildLineupForClub(state, state.userClubId);
}

/**
 * Called when a matchday arrives: fills in weather, referee and default
 * lineups for every fixture that is still blank. A human manager's own
 * selections are never overwritten.
 */
export function prepareMatchday(state: GameState, matchday: number): void {
  const ids = state.fixtures.byMatchday[matchday] ?? [];
  for (const id of ids) {
    const match = state.matches[id];
    if (!match || match.played) continue;
    const rng = stream(state.seed, 'conditions', match.id);
    const ground = state.world.grounds[match.groundId]!;
    match.conditions = rollMatchConditions(rng, ground, match.date);
    const referee = pickReferee(state, match.id);
    match.refereeId = referee.id;
    if (match.lineups.home.starting.length === 0) match.lineups.home = buildLineupForClub(state, match.homeClubId);
    if (match.lineups.away.starting.length === 0) match.lineups.away = buildLineupForClub(state, match.awayClubId);
  }
}

export function expectedAttendanceFor(state: GameState, match: Match): number {
  const home = state.clubs[match.homeClubId];
  const away = state.clubs[match.awayClubId];
  const ground = state.world.grounds[match.groundId];
  if (!home || !away || !ground) return 0;
  return estimateAttendance({
    home,
    away,
    ground,
    conditions: match.conditions,
    matchday: match.matchday,
    rivalryIntensity: home.rivalries[away.id]?.intensity ?? 0,
    involvesUserClub: match.homeClubId === state.userClubId || match.awayClubId === state.userClubId,
  });
}

export interface EnvironmentOptions {
  autoManageAllBenches?: boolean;
}

export function matchEnvironment(state: GameState, match: Match, options: EnvironmentOptions = {}): MatchEnvironment {
  const referee = match.refereeId ? state.people[match.refereeId] : undefined;
  const strictness = referee && referee.kind === 'official' ? (referee.attributes.strictness ?? 11) : 11;
  const userInvolved = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;

  return {
    getPlayer: (id) => {
      const person = state.people[id];
      return isPlayer(person) ? person : undefined;
    },
    clubName: (id) => state.clubs[id]?.identity.name ?? id,
    clubShortName: (id) => state.clubs[id]?.identity.shortName ?? id,
    // Only the club the human actually manages has its bench left alone.
    userClubId: userInvolved ? state.userClubId : null,
    autoManageAllBenches: options.autoManageAllBenches ?? true,
    substitutionsAllowed: 3,
    refereeStrictness: strictness,
    expectedAttendance: expectedAttendanceFor(state, match),
    // What the week's training has built: a side that knows its shape and each
    // other plays a little better than the same eleven who do not.
    tacticalFamiliarity: (clubId) => clubSystemFamiliarity(state, clubId),
    cohesion: (clubId) => clubCohesionValue(state, clubId),
  };
}

export function substitutionsRemaining(match: Match, side: 'home' | 'away'): number {
  return Math.max(0, 3 - match.substitutions[side]);
}

export function benchOf(state: GameState, match: Match, side: 'home' | 'away'): Player[] {
  return match.lineups[side].bench.map((slot) => state.people[slot.playerId]).filter(isPlayer);
}

/** The best-rated performer in a completed match, for post-match reporting. */
export function bestPerformer(match: Match): { playerId: string; rating: number } | null {
  const entries = Object.values(match.performances)
    .filter((performance) => performance.minutesPlayed > 15)
    .sort((a, b) => b.rating - a.rating || b.goals - a.goals);
  const best = entries[0];
  return best ? { playerId: best.playerId, rating: best.rating } : null;
}


