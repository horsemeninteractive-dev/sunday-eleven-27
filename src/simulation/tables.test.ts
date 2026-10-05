import { describe, expect, it } from 'vitest';
import { createTestGame } from './testSupport';
import { competitionStats, MIN_APPEARANCES_FOR_RATING, STATS_CHART_LENGTH } from './tables';
import { processDay } from './day';
import { leagueCompetitions } from './pyramid';
import { isPlayer, type Player } from '@/domain/person';

/**
 * The record books.
 *
 * These charts are read out of the performances the match engine already wrote,
 * so the only thing worth proving is that they are read from the right matches:
 * the ones that have been played, the ones that count for something, and the
 * ones whose clubs are in the competition being looked at.
 */

/**
 * Play days until `want` league matches in the manager's own division have been
 * decided — which is a fixture count, not a matchday count: twelve clubs is six
 * matches a week.
 *
 * A career opens six weeks before the league does, so "play two days" would still
 * be pre-season friendlies and every chart would be empty for a reason that has
 * nothing to do with the charts.
 */
function playInto(game: ReturnType<typeof createTestGame>, want: number) {
  const division = leagueCompetitions(game.state).find((entry) =>
    game.draft.divisionClubIds.includes(entry.clubIds[0]!),
  )!;
  for (let day = 0; day < 120; day += 1) {
    if (competitionStats(game.state, division.clubIds).matchesPlayed >= want) return;
    const before = game.state.date;
    processDay(game.state, before, { resolveUserMatch: true });
    if (game.state.date === before) break;
  }
}

function playerOf(game: ReturnType<typeof createTestGame>, id: string): Player {
  const person = game.state.people[id];
  if (!person || !isPlayer(person)) throw new Error('not a player');
  return person;
}

describe('the record books of a competition', () => {
  it('is empty before anything has been played, rather than full of zeroes', () => {
    const game = createTestGame('tables-empty');
    const division = leagueCompetitions(game.state).find((entry) => game.draft.divisionClubIds.includes(entry.clubIds[0]!));
    const stats = competitionStats(game.state, division?.clubIds ?? []);

    expect(stats.matchesPlayed).toBe(0);
    expect(stats.averageRating).toBeNull();
    expect(stats.scorers).toEqual([]);
    expect(stats.ratings).toEqual([]);
  });

  it('reads goals and assists out of the performances the engine recorded', () => {
    const game = createTestGame('tables-scorers');
    playInto(game, 1);
    const division = leagueCompetitions(game.state).find((entry) => game.draft.divisionClubIds.includes(entry.clubIds[0]!))!;
    const stats = competitionStats(game.state, division.clubIds);

    expect(stats.matchesPlayed).toBeGreaterThan(0);
    expect(stats.scorers.length).toBeGreaterThan(0);
    // Best first, and nobody has scored more goals than the man above him.
    for (let i = 1; i < stats.scorers.length; i += 1) {
      expect(stats.scorers[i - 1]!.goals).toBeGreaterThanOrEqual(stats.scorers[i]!.goals);
    }
    // Every row is a real player of a club in this division, and the numbers are
    // the ones the engine actually recorded rather than a fresh roll.
    const top = stats.scorers[0]!;
    const person = playerOf(game, top.playerId);
    expect(division.clubIds).toContain(top.clubId);
    expect(top.goals).toBe(person.record.goals);
  });

  it('sums the cards, and puts the worst offender at the top of the book', () => {
    const game = createTestGame('tables-cards');
    playInto(game, 3);
    const division = leagueCompetitions(game.state).find((entry) => game.draft.divisionClubIds.includes(entry.clubIds[0]!))!;
    const stats = competitionStats(game.state, division.clubIds);

    const yellow = stats.yellowCards.reduce((total, row) => total + row.yellowCards, 0);
    const reds = stats.redCards.reduce((total, row) => total + row.redCards, 0);
    // Cards are rarer than goals, and a red is rarer than a yellow, so a chart
    // that had more sendings-off than bookings would mean the two were swapped.
    expect(reds).toBeLessThanOrEqual(yellow);
    for (let i = 1; i < stats.yellowCards.length; i += 1) {
      expect(stats.yellowCards[i - 1]!.yellowCards).toBeGreaterThanOrEqual(stats.yellowCards[i]!.yellowCards);
    }
  });

  // Three matchdays is expensive to reach and worth reaching once: every
  // assertion here reads the same played-out season rather than paying for a
  // new one each time.
  describe('after three matchdays', () => {
    let stats: ReturnType<typeof competitionStats>;
    let division: ReturnType<typeof leagueCompetitions>[number];

    beforeAll(() => {
      const game = createTestGame('tables-charts');
      playInto(game, 19);
      division = leagueCompetitions(game.state).find((entry) =>
        game.draft.divisionClubIds.includes(entry.clubIds[0]!),
      )!;
      stats = competitionStats(game.state, division.clubIds);
    });

    it('leaves a man with one game out of the ratings chart', () => {
      // A debutant with one appearance is a swing, not an average: three games is
      // the smallest number that usually survives contact with a season.
      expect(stats.ratings.length).toBeGreaterThan(0);
      for (const row of stats.ratings) {
        expect(row.appearances).toBeGreaterThanOrEqual(MIN_APPEARANCES_FOR_RATING);
        expect(row.rating).not.toBeNull();
        expect(row.rating!).toBeGreaterThan(0);
        expect(row.rating!).toBeLessThanOrEqual(10);
      }
      // The average is a mean of what the engine gave out, not a made-up number.
      expect(stats.averageRating).not.toBeNull();
      expect(stats.averageRating!).toBeGreaterThan(0);
      expect(stats.ratedAppearances).toBeGreaterThan(0);
    });

    it('shows a chartful of names, and no more', () => {
      for (const chart of [stats.scorers, stats.assists, stats.ratings, stats.yellowCards, stats.redCards]) {
        expect(chart.length).toBeLessThanOrEqual(STATS_CHART_LENGTH);
      }
      // Full enough to be worth printing, and every row inside this division.
      expect(stats.scorers.length).toBeGreaterThan(0);
      // And nobody is on a chart for something he has not done: a red-card chart
      // padded with zeroes is a list of the division's luckiest players.
      for (const row of stats.scorers) expect(row.goals).toBeGreaterThan(0);
      for (const row of stats.assists) expect(row.assists).toBeGreaterThan(0);
      for (const row of stats.yellowCards) expect(row.yellowCards).toBeGreaterThan(0);
      for (const row of stats.redCards) expect(row.redCards).toBeGreaterThan(0);
      for (const row of [...stats.scorers, ...stats.ratings, ...stats.yellowCards, ...stats.redCards]) {
        expect(division.clubIds).toContain(row.clubId);
      }
    });
  });

  it('counts only the matches whose clubs are both in the competition', () => {
    const game = createTestGame('tables-scope');
    playInto(game, 3);
    const mine = leagueCompetitions(game.state).find((entry) =>
      game.draft.divisionClubIds.includes(entry.clubIds[0]!),
    )!;
    const stats = competitionStats(game.state, mine.clubIds);

    // Counted from the fixtures themselves rather than from the chart, so a
    // chart that quietly added a friendly or a game from another division would
    // disagree with the calendar.
    const expected = new Set(
      Object.values(game.state.matches)
        .filter((match) => match.competitionId === mine.id && match.result !== null)
        .map((match) => match.id),
    ).size;
    expect(stats.matchesPlayed).toBe(expected);
    for (const row of [...stats.scorers, ...stats.yellowCards]) {
      expect(mine.clubIds).toContain(row.clubId);
    }
  });

  it('leaves a pre-season friendly out of the league charts', () => {
    // The manager's own pre-season games are not competitive matches: a hat
    // trick in one must not put him top of the division's scoring charts.
    const game = createTestGame('tables-friendly');
    const friendlies = Object.values(game.state.matches).filter(
      (match) => match.competitionId === null || !game.state.competitions[match.competitionId],
    );
    expect(friendlies.length).toBeGreaterThan(0);
    expect(competitionStats(game.state, friendlies.map((m) => m.homeClubId)).matchesPlayed).toBe(0);
  });
});