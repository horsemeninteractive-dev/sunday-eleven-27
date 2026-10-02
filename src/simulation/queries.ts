import type { Club, StandingRow } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, ISODate, MatchId, PersonId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { isOfficial, isPlayer, type Official, type Person, type Player } from '@/domain/person';
import { POSITIONS, type PositionCode } from '@/domain/positions';
import type { Business, Ground, Town } from '@/domain/world';
import { positionScore } from './selection';
import { divisionOf, fixtureIdsOnMatchday, standingsFor, userCompetition } from './pyramid';
import { nextFixtureFor } from './schedule';
import { matchdaysPlayed, nextMatchday } from './timeline';

export function getPerson(state: GameState, id: PersonId | null | undefined): Person | undefined {
  return id ? state.people[id] : undefined;
}

export function getPlayer(state: GameState, id: PersonId | null | undefined): Player | undefined {
  const person = getPerson(state, id);
  return isPlayer(person) ? person : undefined;
}

export function getClub(state: GameState, id: ClubId): Club | undefined {
  return state.clubs[id];
}

export function userClub(state: GameState): Club {
  return state.clubs[state.userClubId]!;
}

/** The manager's own official record — the man the world knows him as. */
export function userManager(state: GameState): Official | undefined {
  const person = state.people['user_manager'];
  return isOfficial(person) ? person : undefined;
}

/**
 * The manager's record in charge of a club.
 *
 * A season's figures are written into the club's history match by match as they
 * are played, and finalised when the season closes — and a club's history
 * begins with the season its current manager took over. The club's seasons,
 * therefore, *are* his seasons. Friendlies are deliberately absent: they never
 * touch the record books.
 *
 * If a manager ever moves clubs this becomes a per-manager ledger rather than a
 * per-club one; until then one tenure is the whole career.
 */
export interface CareerRecord {
  /** Seasons in charge, including the one in progress. */
  seasons: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /** Share of matches won, 0-100. */
  winPercent: number;
}

export function managerCareerRecord(state: GameState, clubId: ClubId = state.userClubId): CareerRecord {
  const seasons = state.clubs[clubId]?.history.seasons ?? [];
  const totals = seasons.reduce(
    (sum, season) => ({
      played: sum.played + season.played,
      won: sum.won + season.won,
      drawn: sum.drawn + season.drawn,
      lost: sum.lost + season.lost,
      goalsFor: sum.goalsFor + season.goalsFor,
      goalsAgainst: sum.goalsAgainst + season.goalsAgainst,
      points: sum.points + season.points,
    }),
    { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
  );
  return {
    seasons: seasons.length,
    ...totals,
    winPercent: totals.played > 0 ? Math.round((totals.won / totals.played) * 100) : 0,
  };
}

export function getTown(state: GameState, id: string): Town | undefined {
  return state.world.towns[id];
}

export function getGround(state: GameState, id: string): Ground | undefined {
  return state.world.grounds[id];
}

export function getBusiness(state: GameState, id: string): Business | undefined {
  return state.world.businesses[id];
}

export function playerFullName(player: Player): string {
  return `${player.firstName} ${player.surname}`;
}

export function playerDisplayName(player: Player): string {
  return player.nickname ? `${player.firstName} "${player.nickname}" ${player.surname}` : `${player.firstName} ${player.surname}`;
}

export function squadOf(state: GameState, clubId: ClubId): Player[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  return club.squadIds
    .map((id) => state.people[id])
    .filter(isPlayer)
    .sort((a, b) => POSITIONS[a.preferredPosition].group.localeCompare(POSITIONS[b.preferredPosition].group) || b.age - a.age);
}

export interface SquadBreakdown {
  available: Player[];
  doubtful: Player[];
  unavailable: Player[];
}

export function squadAvailability(state: GameState, clubId: ClubId): SquadBreakdown {
  const squad = squadOf(state, clubId);
  return {
    available: squad.filter((player) => player.availability.status === 'available'),
    doubtful: squad.filter((player) => player.availability.status === 'doubtful'),
    unavailable: squad.filter((player) => player.availability.status === 'unavailable'),
  };
}

/**
 * A division's table.
 *
 * With no competition named this is the manager's own division, which is what
 * every screen that just says "the table" wants; the league view passes a
 * competition explicitly to show the rest of the ladder.
 */
export function standings(state: GameState, competitionId?: CompetitionId): StandingRow[] {
  const competition =
    (competitionId ? state.competitions[competitionId] : undefined) ?? userCompetition(state);
  if (!competition) return [];
  return standingsFor(state, competition);
}

export function formOf(state: GameState, clubId: ClubId, length = 5): Array<'W' | 'D' | 'L'> {
  const competition = divisionOf(state, clubId);
  const row = competition ? standingsFor(state, competition).find((entry) => entry.clubId === clubId) : undefined;
  return row ? row.form.slice(-length) : [];
}

export function leaguePosition(state: GameState, clubId: ClubId): number | null {
  const competition = divisionOf(state, clubId);
  if (!competition) return null;
  const index = standingsFor(state, competition).findIndex((row) => row.clubId === clubId);
  return index < 0 ? null : index + 1;
}

export function fixtureIdsForMatchday(state: GameState, matchday: number): MatchId[] {
  return fixtureIdsOnMatchday(state, matchday) as MatchId[];
}

export function matchForClubOnMatchday(state: GameState, clubId: ClubId, matchday: number): Match | null {
  const ids = fixtureIdsForMatchday(state, matchday);
  for (const id of ids) {
    const match = state.matches[id];
    if (!match) continue;
    if (match.homeClubId === clubId || match.awayClubId === clubId) return match;
  }
  return null;
}

export function clubMatches(state: GameState, clubId: ClubId): Match[] {
  return state.matchOrder
    .map((id) => state.matches[id])
    .filter((match): match is Match => Boolean(match) && (match.homeClubId === clubId || match.awayClubId === clubId));
}

export function recentMatches(state: GameState, clubId: ClubId, count = 5): Match[] {
  return clubMatches(state, clubId)
    .filter((match) => match.played)
    .sort((a, b) => b.matchday - a.matchday)
    .slice(0, count);
}

export function lastMatch(state: GameState): Match | null {
  return state.lastMatchId ? state.matches[state.lastMatchId] ?? null : null;
}

export function matchOpponent(match: Match, clubId: ClubId): ClubId {
  return match.homeClubId === clubId ? match.awayClubId : match.homeClubId;
}

export function matchVenueLabel(match: Match, clubId: ClubId | null): 'Home' | 'Away' | 'Neutral' {
  if (match.neutralVenue) return 'Neutral';
  if (!clubId) return 'Neutral';
  return match.homeClubId === clubId ? 'Home' : 'Away';
}

export function groundName(state: GameState, match: Match): string {
  return state.world.grounds[match.groundId]?.name ?? 'Unknown ground';
}

export function journeyDistanceKm(state: GameState, fromClubId: ClubId, toClubId: ClubId): number {
  const from = state.clubs[fromClubId];
  const to = state.clubs[toClubId];
  if (!from || !to) return 0;
  const fromTown = state.world.towns[from.townId];
  const toTown = state.world.towns[to.townId];
  if (!fromTown || !toTown) return 0;
  // Map coordinates are 0-100 across a county roughly 40km wide.
  return Math.round(Math.hypot(fromTown.x - toTown.x, fromTown.y - toTown.y) * 0.45 * 10) / 10;
}

export function rivalryIntensity(state: GameState, a: ClubId, b: ClubId): number {
  return state.clubs[a]?.rivalries[b]?.intensity ?? 0;
}

/** Impressions rather than numbers: exact ability is not automatically known. */
export type AbilityBand = 'Poor' | 'Limited' | 'Solid' | 'Good' | 'Very good' | 'Exceptional';

/**
 * How good a player is, as one number.
 *
 * The nine attributes that between them decide whether somebody can play: what
 * he does with the ball, what he does with his head and how he gets about. It
 * is deliberately not the whole attribute sheet — personality, discipline and
 * temperament are what the dressing room knows and the numbers do not.
 */
export function abilityMean(player: Player): number {
  const technical = player.attributes.technical;
  const mental = player.attributes.mental;
  const physical = player.attributes.physical;
  return (
    (technical.passing + technical.ballControl + technical.shooting + technical.tackling +
      mental.decisions + mental.composure + mental.positioning +
      physical.pace + physical.stamina) /
    9
  );
}

/** The word for a mean ability, on the same scale as `estimateAbilityBand`. */
export function abilityBandFor(mean: number): AbilityBand {
  if (mean < 6) return 'Poor';
  if (mean < 8) return 'Limited';
  if (mean < 10) return 'Solid';
  if (mean < 12) return 'Good';
  if (mean < 14.5) return 'Very good';
  return 'Exceptional';
}

export function estimateAbilityBand(player: Player): AbilityBand {
  return abilityBandFor(abilityMean(player));
}

export function suitabilityFor(player: Player, position: PositionCode): number {
  return Math.round(positionScore(player, position) * 100);
}

export function bestPositionFor(player: Player): { position: PositionCode; score: number } {
  const codes = Object.keys(POSITIONS) as PositionCode[];
  return codes.reduce(
    (best, code) => {
      const score = positionScore(player, code);
      return score > best.score ? { position: code, score } : best;
    },
    { position: player.preferredPosition, score: positionScore(player, player.preferredPosition) },
  );
}

export function squadAverageAge(squad: readonly Player[]): number {
  if (squad.length === 0) return 0;
  return Math.round((squad.reduce((sum, player) => sum + player.age, 0) / squad.length) * 10) / 10;
}

export function balanceOf(state: GameState, clubId: ClubId): number {
  return state.clubs[clubId]?.finances.balance ?? 0;
}

export function ledgerOf(state: GameState, clubId: ClubId) {
  return state.clubs[clubId]?.finances.ledger.slice().reverse() ?? [];
}

export function sortedNews(state: GameState, limit = 20) {
  return state.news.slice(0, limit);
}

/** The matchday being prepared: derived from the date, never counted. */
export function currentMatchday(state: GameState): number {
  return nextMatchday(state);
}

/** How many Sundays have already been played. */
export function completedMatchdays(state: GameState): number {
  return matchdaysPlayed(state);
}

export function matchdayDate(state: GameState, matchday: number): ISODate | null {
  const entry = state.season.calendar.find((item) => item.matchday === matchday);
  return entry ? entry.date : null;
}

export function currentMatchdayDate(state: GameState): ISODate {
  return matchdayDate(state, nextMatchday(state)) ?? state.date;
}

/** The next fixture for a club, whenever the calendar says it is. */
export function nextFixture(state: GameState, clubId: ClubId = state.userClubId) {
  return nextFixtureFor(state, clubId, state.date);
}
