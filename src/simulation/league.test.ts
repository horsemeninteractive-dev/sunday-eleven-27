import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import { Rng } from './rng';
import { generateFixtures, matchdayCount } from './generation/fixtureGenerator';
import { computeStandings } from './league';

function fakeMatch(
  id: string,
  matchday: number,
  homeClubId: string,
  awayClubId: string,
  homeGoals: number,
  awayGoals: number,
): Match {
  return {
    id,
    seasonId: 'season',
    competitionId: 'comp',
    competitionName: 'League',
    matchday,
    date: '2026-09-06',
    kickOff: '10:30am',
    homeClubId,
    awayClubId,
    groundId: 'ground',
    neutralVenue: false,
    conditions: { weather: 'clear', pitch: 'good', pitchQuality: 14, temperatureC: 12 },
    refereeId: null,
    lineups: {
      home: { clubId: homeClubId, formation: '4-4-2', starting: [], bench: [], tactics: {} as never, captainId: null },
      away: { clubId: awayClubId, formation: '4-4-2', starting: [], bench: [], tactics: {} as never, captainId: null },
    },
    events: [],
    performances: {},
    status: 'finished',
    minute: 90,
    half: 2,
    possessionTicks: { home: 50, away: 50 },
    substitutions: { home: 0, away: 0 },
    played: true,
    result: {
      homeGoals,
      awayGoals,
      homeShots: 10,
      awayShots: 10,
      homePossession: 50,
      awayPossession: 50,
      attendance: 60,
    },
    seed: 1,
    incidents: [],
    postponementReason: null,
    postponedOn: null,
    originalDate: null,
    replacedByMatchId: null,
    lateCallMade: false,
  };
}

describe('fixture generation', () => {
  it('produces a full double round robin', () => {
    const clubs = Array.from({ length: 12 }, (_, i) => `club_${i + 1}`);
    const fixtures = generateFixtures(new Rng('fixtures'), clubs);

    expect(fixtures).toHaveLength(clubs.length * (clubs.length - 1));
    expect(Math.max(...fixtures.map((f) => f.matchday))).toBe(matchdayCount(clubs.length));

    const pairings = new Map<string, number>();
    for (const fixture of fixtures) {
      const key = `${fixture.homeClubId}->${fixture.awayClubId}`;
      pairings.set(key, (pairings.get(key) ?? 0) + 1);
    }
    for (const home of clubs) {
      for (const away of clubs) {
        if (home === away) continue;
        expect(pairings.get(`${home}->${away}`)).toBe(1);
      }
    }
  });

  it('never schedules a club twice on the same matchday', () => {
    const clubs = Array.from({ length: 13 }, (_, i) => `club_${i + 1}`);
    const fixtures = generateFixtures(new Rng('odd-number'), clubs);
    const byMatchday = new Map<number, string[]>();
    for (const fixture of fixtures) {
      const list = byMatchday.get(fixture.matchday) ?? [];
      list.push(fixture.homeClubId, fixture.awayClubId);
      byMatchday.set(fixture.matchday, list);
    }
    for (const [, clubsOnDay] of byMatchday) {
      expect(new Set(clubsOnDay).size).toBe(clubsOnDay.length);
    }
  });

  it('is deterministic and responds to the seed', () => {
    const clubs = Array.from({ length: 10 }, (_, i) => `club_${i + 1}`);
    const a = generateFixtures(new Rng('seed-a'), clubs);
    const b = generateFixtures(new Rng('seed-a'), clubs);
    const c = generateFixtures(new Rng('seed-b'), clubs);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('league table', () => {
  const clubs = ['a', 'b', 'c', 'd'];
  const name = (id: string) => id.toUpperCase();

  it('awards points and orders by points, goal difference then goals scored', () => {
    const matches: Match[] = [
      fakeMatch('m1', 1, 'a', 'b', 3, 0),
      fakeMatch('m2', 1, 'c', 'd', 1, 1),
      fakeMatch('m3', 2, 'b', 'c', 2, 2),
      fakeMatch('m4', 2, 'd', 'a', 0, 1),
      fakeMatch('m5', 3, 'a', 'c', 0, 2),
      fakeMatch('m6', 3, 'b', 'd', 4, 1),
    ];
    const table = computeStandings({ clubIds: clubs, matches, competitionId: 'comp', clubName: name });

    const byClub = Object.fromEntries(table.map((row) => [row.clubId, row]));
    expect(byClub.a).toMatchObject({ played: 3, won: 2, lost: 1, goalsFor: 4, goalsAgainst: 2, points: 6, goalDifference: 2 });
    expect(byClub.b).toMatchObject({ played: 3, won: 1, drawn: 1, lost: 1, points: 4 });
    expect(byClub.c).toMatchObject({ played: 3, won: 1, drawn: 2, points: 5 });
    expect(byClub.d).toMatchObject({ played: 3, drawn: 1, lost: 2, points: 1 });

    expect(table[0]!.clubId).toBe('a');
    expect(table.map((row) => row.clubId)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('keeps recent form in chronological order', () => {
    const matches: Match[] = [
      fakeMatch('m1', 1, 'a', 'b', 1, 0),
      fakeMatch('m2', 2, 'b', 'a', 2, 2),
      fakeMatch('m3', 3, 'a', 'c', 0, 1),
    ];
    const table = computeStandings({ clubIds: clubs, matches, competitionId: 'comp', clubName: name });
    expect(table.find((row) => row.clubId === 'a')!.form).toEqual(['W', 'D', 'L']);
  });

  it('ignores unplayed fixtures and other competitions', () => {
    const unplayed = fakeMatch('m1', 1, 'a', 'b', 5, 0);
    unplayed.played = false;
    unplayed.result = null;
    const otherCompetition = { ...fakeMatch('m2', 1, 'a', 'c', 4, 0), competitionId: 'cup' };
    const table = computeStandings({
      clubIds: clubs,
      matches: [unplayed, otherCompetition],
      competitionId: 'comp',
      clubName: name,
    });
    expect(table.every((row) => row.played === 0)).toBe(true);
  });
});
