import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import { applyMatchAftermath, processDay } from './day';
import { rivalryBetween } from './rivalries';
import { supportConfidenceOf } from './support';
import { createTestGame } from './testSupport';

/**
 * The local football world, end to end.
 *
 * The press, the rivalries and the crowds are each pinned on their own. This is
 * the test that says they are *connected*: one afternoon, played by the real day
 * loop, reaches all three — a story in the paper with a reporter's name on it, a
 * relationship that remembers the fixture, and two crowds that have an opinion
 * about it in the morning.
 *
 * It is also where the one thing none of the unit tests can see is checked: that
 * an afternoon is settled exactly once. A result can be reached by more than one
 * route — the day loop simulates the division, the manager's own match can be
 * watched, sent to the bench, or left to the clock — and if two of those routes
 * both counted it, a club's crowd would drift twice as fast as its football
 * deserves and nobody would notice for a season.
 */

/** The first Sunday the manager's club actually plays a league fixture. */
function firstMatchdayFor(state: ReturnType<typeof createTestGame>['state']): string {
  const fixture = Object.values(state.matches)
    .filter((match) => {
      const competition = state.competitions[match.competitionId];
      return competition?.kind === 'league' && (match.homeClubId === state.userClubId || match.awayClubId === state.userClubId);
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (!fixture) throw new Error('the generated world has no league fixture for the manager’s club');
  return fixture.date;
}

/** The fixture the manager's club played on a given date. */
function userFixtureOn(state: ReturnType<typeof createTestGame>['state'], date: string): Match {
  const fixture = Object.values(state.matches).find(
    (match) => match.date === date && (match.homeClubId === state.userClubId || match.awayClubId === state.userClubId),
  );
  if (!fixture) throw new Error('no fixture for the manager’s club on that date');
  return fixture;
}

describe('a Sunday reaches the whole world', () => {
  it('puts the result in the paper with a reporter’s name on it, and moves both crowds a little', () => {
    const { state } = createTestGame('local-matchday');
    const date = firstMatchdayFor(state);
    // The manager's own game, sent to the bench — the same football by the same
    // engine, which is the route that produces the match report the paper runs.
    const outcome = processDay(state, date, { resolveUserMatch: true });
    const fixture = userFixtureOn(state, date);

    expect(fixture.played).toBe(true);

    // The story is about the match that was actually played, and it is attributed
    // to the reporter whose patch the home club is on.
    const story = outcome.news.find((item) => item.matchId === fixture.id)!;
    expect(story).toBeDefined();
    expect(story.eventType).toBe('match-result');
    expect([...story.clubIds].sort()).toEqual([fixture.homeClubId, fixture.awayClubId].sort());
    expect(story.outlet).toBeTruthy();
    expect(story.byline).toBeTruthy();
    expect(story.headline).toContain(String(fixture.result!.homeGoals));

    // And both crowds have moved, in the direction the afternoon went, by no more
    // than one match is worth.
    const home = state.clubs[fixture.homeClubId]!;
    const away = state.clubs[fixture.awayClubId]!;
    const margin = fixture.result!.homeGoals - fixture.result!.awayGoals;
    for (const club of [home, away]) {
      expect(Math.abs(supportConfidenceOf(club) - 50)).toBeLessThanOrEqual(4);
    }
    if (margin !== 0) {
      const winner = margin > 0 ? home : away;
      const loser = margin > 0 ? away : home;
      expect(supportConfidenceOf(winner)).toBeGreaterThan(50);
      expect(supportConfidenceOf(loser)).toBeLessThan(50);
    }

    // The relationship remembers the fixture, and remembers it once.
    const rivalry = rivalryBetween(state, fixture.homeClubId, fixture.awayClubId);
    if (rivalry) {
      expect(rivalry.lastMetOn).toBe(fixture.date);
      expect(rivalry.intensity).toBeGreaterThanOrEqual(rivalry.baseline ?? 0);
    }
    expect(fixture.aftermathNoted).toBe(true);
  }, 120_000);

  it('counts an afternoon once, however many routes settle it', () => {
    const { state } = createTestGame('local-once');
    const date = firstMatchdayFor(state);
    processDay(state, date, { resolveUserMatch: true });
    const fixture = userFixtureOn(state, date);

    const confidence = state.clubs[state.userClubId]!.supporters.confidence;
    const rivalry = rivalryBetween(state, fixture.homeClubId, fixture.awayClubId);
    const intensity = rivalry?.intensity ?? null;
    const meetings = rivalry?.meetings ?? null;

    // The day loop already settled it; the store's route back into the same
    // result — a watched match committed at full time — finds nothing to do.
    const again = applyMatchAftermath(state, fixture);
    expect(again).toEqual([]);
    expect(state.clubs[state.userClubId]!.supporters.confidence).toBe(confidence);
    expect(rivalryBetween(state, fixture.homeClubId, fixture.awayClubId)?.intensity ?? null).toBe(intensity);
    expect(rivalryBetween(state, fixture.homeClubId, fixture.awayClubId)?.meetings ?? null).toBe(meetings);
  }, 120_000);

  it('moves a crowd further for a local derby than for the same scoreline between strangers', () => {
    const first = createTestGame('local-derby');
    const second = createTestGame('local-derby');
    const fixture = Object.values(first.state.matches).find(
      (match) => !match.played && stateIsLeague(first.state, match),
    )!;
    const quiet = second.state.matches[fixture.id]!;

    // The same afternoon in both worlds: the only difference is what the two
    // clubs are to each other before it kicks off.
    // One goal in it, because that is the afternoon a rivalry is made of: the
    // same result in both worlds, with only the relationship between them
    // different.
    for (const match of [fixture, quiet]) {
      match.performances = {};
      match.result = {
        homeGoals: 1,
        awayGoals: 0,
        homeShots: 0,
        awayShots: 0,
        homePossession: 50,
        awayPossession: 50,
        attendance: 0,
      };
    }
    setRivalry(first.state, fixture, 70, 'derby');
    clearRivalry(second.state, quiet);

    applyMatchAftermath(first.state, fixture);
    applyMatchAftermath(second.state, quiet);

    const derbyHome = first.state.clubs[fixture.homeClubId]!;
    const quietHome = second.state.clubs[quiet.homeClubId]!;
    const derbyMove = supportConfidenceOf(derbyHome) - 50;
    const quietMove = supportConfidenceOf(quietHome) - 50;

    expect(derbyMove).toBeGreaterThan(quietMove);
    expect(derbyMove).toBeLessThanOrEqual(4);
    // And the relationship itself: the derby keeps its waterline, gains heat and
    // records the meeting; the strangers are left as they were.
    const rivalry = rivalryBetween(first.state, fixture.homeClubId, fixture.awayClubId)!;
    expect(rivalry.kind).toBe('derby');
    expect(rivalry.baseline).toBe(70);
    expect(rivalry.heat).toBeGreaterThan(0);
    expect(rivalry.intensity).toBe(70 + rivalry.heat!);
    expect(rivalry.meetings).toBe(1);
  });
});

function stateIsLeague(state: ReturnType<typeof createTestGame>['state'], match: Match): boolean {
  return state.competitions[match.competitionId]?.kind === 'league';
}

function setRivalry(
  state: ReturnType<typeof createTestGame>['state'],
  match: Match,
  intensity: number,
  kind: 'derby' | 'competitive',
): void {
  const record = {
    intensity,
    note: 'Neighbours, and they have never liked each other.',
    baseline: intensity,
    kind,
    since: state.season.startDate,
    lastMetOn: null,
    meetings: 0,
    heat: 0,
  };
  state.clubs[match.homeClubId]!.rivalries[match.awayClubId] = { ...record };
  state.clubs[match.awayClubId]!.rivalries[match.homeClubId] = { ...record };
}

function clearRivalry(state: ReturnType<typeof createTestGame>['state'], match: Match): void {
  delete state.clubs[match.homeClubId]!.rivalries[match.awayClubId];
  delete state.clubs[match.awayClubId]!.rivalries[match.homeClubId];
}
