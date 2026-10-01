import type { FixtureList } from '@/domain/competition';
import type { ClubId, CompetitionId, MatchId } from '@/domain/ids';
import { Rng } from '../rng';

export interface GeneratedFixture {
  matchday: number;
  homeClubId: ClubId;
  awayClubId: ClubId;
}

/**
 * Round-robin double fixture list (every club home and away against every
 * other). No fixture is ever hard-coded: swapping the club list or the seed
 * produces a different, valid calendar.
 */
export function generateFixtures(rng: Rng, clubIds: readonly ClubId[]): GeneratedFixture[] {
  const clubs = rng.shuffle(clubIds);
  const hasBye = clubs.length % 2 !== 0;
  const teams: Array<ClubId | null> = hasBye ? [...clubs, null] : [...clubs];
  const n = teams.length;
  const roundsPerHalf = n - 1;

  const firstHalf: GeneratedFixture[] = [];
  const rotation = teams.slice();

  for (let round = 0; round < roundsPerHalf; round++) {
    for (let i = 0; i < n / 2; i++) {
      const home = rotation[i]!;
      const away = rotation[n - 1 - i]!;
      if (!home || !away) continue;
      // Alternate who plays at home within a round for a fairer spread.
      const swap = (round + i) % 2 === 1;
      firstHalf.push({
        matchday: round + 1,
        homeClubId: swap ? away : home,
        awayClubId: swap ? home : away,
      });
    }
    // Rotate all but the first entry.
    const fixed = rotation[0]!;
    const rest = rotation.slice(1);
    rest.unshift(rest.pop()!);
    rotation.length = 0;
    rotation.push(fixed, ...rest);
  }

  const secondHalf: GeneratedFixture[] = firstHalf.map((fixture) => ({
    matchday: fixture.matchday + roundsPerHalf,
    homeClubId: fixture.awayClubId,
    awayClubId: fixture.homeClubId,
  }));

  return [...firstHalf, ...secondHalf].sort((a, b) => a.matchday - b.matchday);
}

/** Total number of matchdays a double round-robin produces. */
export function matchdayCount(clubCount: number): number {
  const padded = clubCount % 2 === 0 ? clubCount : clubCount + 1;
  return (padded - 1) * 2;
}

export function buildFixtureList(
  competitionId: CompetitionId,
  fixtures: readonly GeneratedFixture[],
  matchIdFor: (fixture: GeneratedFixture, index: number) => MatchId,
): FixtureList {
  const byMatchday: Record<number, MatchId[]> = {};
  const matchdayOf: Record<MatchId, number> = {};
  fixtures.forEach((fixture, index) => {
    const matchId = matchIdFor(fixture, index);
    (byMatchday[fixture.matchday] ??= []).push(matchId);
    matchdayOf[matchId] = fixture.matchday;
  });
  return { competitionId, byMatchday, matchdayOf };
}
