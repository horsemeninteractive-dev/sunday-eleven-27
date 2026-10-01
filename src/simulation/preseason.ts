import { FRIENDLY_COMPETITION_ID, FRIENDLY_COMPETITION_NAME } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, MatchId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { addDays, kickOffTimeFor, PRE_SEASON_WEEKS } from './calendar';
import { createMatchRecord } from './matchday';
import { stream } from './rng';

/**
 * Friendlies.
 *
 * Pre-season is the only part of the year when a manager can try things without
 * it costing him a league position, and a club coming out of July with nothing
 * arranged turns up on the opening Sunday cold. The club arranges its own: three
 * games, spread across the weeks before the opener, against whoever is local and
 * willing — and the manager can add another if he wants one.
 */

/** How many friendlies a club arranges for itself. */
export const FRIENDLIES_PER_PRE_SEASON = 3;

/**
 * The Sundays the club plays on: a week into pre-season, three weeks in, and the
 * week before the league starts. Nothing on the opening week — they are still
 * finding their boots.
 */
export function friendlyDates(preSeasonStart: ISODate, weeks = PRE_SEASON_WEEKS): ISODate[] {
  const dates: ISODate[] = [];
  for (let index = 1; index <= weeks; index += 1) {
    // Every other week, which puts the last one the Sunday before the opener.
    if (index % 2 === 1) dates.push(addDays(preSeasonStart, index * 7));
  }
  return dates;
}

/**
 * Arrange the club's pre-season.
 *
 * Deterministic from the seed, so a career always gets the same summer: the same
 * opponents, in the same order, home first. Friendlies only go in ahead of the
 * manager, never behind him — a career picked up mid-July still gets its games,
 * one loaded in September gets none.
 */
export function arrangePreSeason(state: GameState, clubId: ClubId, preSeasonStart: ISODate): Match[] {
  const created: Match[] = [];
  friendlyDates(preSeasonStart)
    .filter((date) => date >= state.date)
    .slice(0, FRIENDLIES_PER_PRE_SEASON)
    .forEach((date, index) => {
      // Home, away, home: a pre-season that never leaves the village is not a
      // pre-season, and one that never plays at home pays for nothing.
      const atHome = index % 2 === 0;
      const match = arrangeFriendly(state, clubId, opponentFor(state, clubId, index), date, atHome);
      if (match) created.push(match);
    });
  return created;
}

/**
 * Arrange one friendly. Returns null when the date is no use: already gone, on
 * the same day as another game, or after the league has started.
 */
export function arrangeFriendly(
  state: GameState,
  clubId: ClubId,
  opponentClubId: ClubId,
  date: ISODate,
  atHome = true,
  idHint?: string,
): Match | null {
  if (opponentClubId === clubId) return null;
  if (!state.clubs[clubId] || !state.clubs[opponentClubId]) return null;
  // Before the manager's first morning is no use, and the league opener is the
  // hard edge: pre-season ends when the football starts.
  const leagueOpener = state.season.calendar[0]?.date;
  if (date < state.date) return null;
  if (leagueOpener && date >= leagueOpener) return null;

  const clash = Object.values(state.matches).some(
    (match) => match.date === date && (match.homeClubId === clubId || match.awayClubId === clubId),
  );
  if (clash) return null;

  const homeClubId = atHome ? clubId : opponentClubId;
  const awayClubId = atHome ? opponentClubId : clubId;
  const id: MatchId = `friendly_${clubId}_${idHint ?? date}`;

  const match = createMatchRecord({
    state,
    id,
    matchday: 0,
    date,
    homeClubId,
    awayClubId,
    competitionId: FRIENDLY_COMPETITION_ID,
    competitionName: FRIENDLY_COMPETITION_NAME,
    kickOff: kickOffTimeFor(date),
  });
  registerMatch(state, match);
  return match;
}

/** Every match in the world knows where it lives, friendlies included. */
function registerMatch(state: GameState, match: Match): void {
  state.matches[match.id] = match;
  state.matchOrder = [...state.matchOrder, match.id].sort((a, b) => {
    const left = state.matches[a];
    const right = state.matches[b];
    if (!left || !right) return 0;
    if (left.date === right.date) return left.id < right.id ? -1 : 1;
    return left.date < right.date ? -1 : 1;
  });
  const bucket = state.fixtures.byMatchday[match.matchday] ?? [];
  state.fixtures.byMatchday[match.matchday] = [...bucket, match.id];
  state.fixtures.matchdayOf[match.id] = match.matchday;
}

/**
 * Who is willing to play.
 *
 * Local sides with nothing else on: the seed decides, so the same career always
 * gets the same opponents, and no club plays the same friendly twice.
 */
function opponentFor(state: GameState, clubId: ClubId, index: number): ClubId {
  const club = state.clubs[clubId]!;
  const others = Object.values(state.clubs)
    .filter((candidate) => candidate.id !== clubId)
    .map((candidate) => ({
      id: candidate.id,
      // Neighbours first: the village team up the road is who a Sunday club
      // actually plays in July.
      sameTown: candidate.townId === club.townId ? 0 : 1,
      name: candidate.identity.name,
    }))
    .sort((a, b) => a.sameTown - b.sameTown || (a.name < b.name ? -1 : 1));

  const rng = stream(state.seed, 'friendly', clubId, String(index));
  const taken = new Set(
    Object.values(state.matches)
      .filter((match) => match.competitionId === FRIENDLY_COMPETITION_ID && (match.homeClubId === clubId || match.awayClubId === clubId))
      .map((match) => (match.homeClubId === clubId ? match.awayClubId : match.homeClubId)),
  );
  const available = others.filter((candidate) => !taken.has(candidate.id));
  const pool = available.length > 0 ? available : others;
  return rng.pick(pool).id;
}

/** The club's arranged friendlies, oldest first. */
export function friendliesFor(state: GameState, clubId: ClubId): Match[] {
  return Object.values(state.matches)
    .filter(
      (match) =>
        match.competitionId === FRIENDLY_COMPETITION_ID && (match.homeClubId === clubId || match.awayClubId === clubId),
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
