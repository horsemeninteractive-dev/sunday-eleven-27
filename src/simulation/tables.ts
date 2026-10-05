import type { GameState } from '@/domain/game';
import type { ClubId, PlayerId } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import { isPlayer } from '@/domain/person';
import { playerFullName } from './queries';

/**
 * The record books of a competition.
 *
 * The league table answers "where is everyone"; it cannot answer "who is
 * scoring", and a manager deciding whether to spend on a striker needs both.
 * These are the same numbers the match engine has already worked out, read back
 * out of the performances it recorded — nothing here re-simulates anything, and
 * nothing here is stored, so a table of stats cannot disagree with the results
 * it was built from.
 *
 * Scoped by club: pass a division's clubs for a league table, or a cup's
 * entrants for a cup. A match counts only when both of its clubs are in scope,
 * so a friendly between two division clubs does not put a Sunday-league hat
 * trick into the league scoring charts.
 */

/** One man in one of the charts. */
export interface StatRow {
  playerId: PlayerId;
  clubId: ClubId;
  goals: number;
  assists: number;
  /** Appearances across the matches counted here. */
  appearances: number;
  /** Mean match rating, to one decimal. Null until he has been rated at all. */
  rating: number | null;
  yellowCards: number;
  redCards: number;
}

export interface CompetitionStats {
  /** Goals, best first. */
  scorers: StatRow[];
  /** Assists, best first. */
  assists: StatRow[];
  /** Mean rating, best first. */
  ratings: StatRow[];
  /** Booked most, best first. */
  yellowCards: StatRow[];
  /** Sent off most, best first. */
  redCards: StatRow[];
  /** The competition's mean rating, for the heading above the ratings. */
  averageRating: number | null;
  /** How many appearances the average is drawn from. */
  ratedAppearances: number;
  /** How many competitive matches in scope have been played. */
  matchesPlayed: number;
}

/**
 * How many appearances a man needs before his average rating is worth printing.
 *
 * One match is a swing: a hat-trick sends him top of the charts and a quiet
 * afternoon at left back puts him bottom. Three is the smallest number that
 * usually survives contact with a league season.
 */
export const MIN_APPEARANCES_FOR_RATING = 3;

/** How many names each chart shows. */
export const STATS_CHART_LENGTH = 8;

function nameOf(state: GameState, playerId: PlayerId): string {
  const person = state.people[playerId];
  return person && isPlayer(person) ? playerFullName(person) : 'Unknown';
}

/** Matches in scope: played, competitive, and between two clubs that count. */
function playedIn(state: GameState, clubIds: readonly ClubId[]): Match[] {
  const scope = new Set<ClubId>(clubIds);
  return Object.values(state.matches).filter(
    (match) =>
      match.result !== null &&
      isCompetitiveMatch(state, match) &&
      scope.has(match.homeClubId) &&
      scope.has(match.awayClubId),
  );
}

export function competitionStats(state: GameState, clubIds: readonly ClubId[]): CompetitionStats {
  const tally = new Map<PlayerId, StatRow & { ratingTotal: number }>();
  const matches = playedIn(state, clubIds);
  let ratingTotal = 0;
  let ratedAppearances = 0;

  for (const match of matches) {
    for (const performance of Object.values(match.performances)) {
      const person = state.people[performance.playerId];
      if (!person || !isPlayer(person)) continue;
      const row = tally.get(performance.playerId) ?? {
        playerId: performance.playerId,
        // A player who was sold mid-season still belongs to the club that played
        // him here, so the row follows the match rather than the current squad.
        clubId: performance.clubId,
        goals: 0,
        assists: 0,
        appearances: 0,
        rating: null,
        yellowCards: 0,
        redCards: 0,
        ratingTotal: 0,
      };
      row.goals += performance.goals;
      row.assists += performance.assists;
      row.yellowCards += performance.yellowCards;
      row.redCards += performance.redCards;
      row.appearances += 1;
      row.ratingTotal += performance.rating;
      ratingTotal += performance.rating;
      ratedAppearances += 1;
      tally.set(performance.playerId, row);
    }
  }

  // One pass to turn each man's running rating total into a mean, rather than
  // walking every match again for every player.
  const rows = [...tally.values()].map(({ ratingTotal: total, ...row }) => ({
    ...row,
    rating: row.appearances > 0 ? Math.round((total / row.appearances) * 10) / 10 : null,
  }));

  const byName = (a: StatRow, b: StatRow) => nameOf(state, a.playerId).localeCompare(nameOf(state, b.playerId));
  // Each chart is made only of the men who have something in it. A red-card
  // chart padded out with zeroes is a list of the luckiest players in the
  // division, and an empty one says "nobody has been sent off" instead.
  const withGoals = rows.filter((row) => row.goals > 0);
  const withAssists = rows.filter((row) => row.assists > 0);
  const withBookings = rows.filter((row) => row.yellowCards > 0);
  const withSendingsOff = rows.filter((row) => row.redCards > 0);
  const rated = rows.filter(
    (row) => row.appearances >= MIN_APPEARANCES_FOR_RATING && row.rating !== null,
  );

  return {
    scorers: [...withGoals].sort((a, b) => b.goals - a.goals || b.assists - a.assists || byName(a, b)).slice(0, STATS_CHART_LENGTH),
    assists: [...withAssists].sort((a, b) => b.assists - a.assists || b.goals - a.goals || byName(a, b)).slice(0, STATS_CHART_LENGTH),
    ratings: [...rated].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.appearances - a.appearances || byName(a, b)).slice(0, STATS_CHART_LENGTH),
    yellowCards: [...withBookings].sort((a, b) => b.yellowCards - a.yellowCards || byName(a, b)).slice(0, STATS_CHART_LENGTH),
    redCards: [...withSendingsOff].sort((a, b) => b.redCards - a.redCards || byName(a, b)).slice(0, STATS_CHART_LENGTH),
    averageRating: ratedAppearances > 0 ? Math.round((ratingTotal / ratedAppearances) * 10) / 10 : null,
    ratedAppearances,
    matchesPlayed: matches.length,
  };
}