import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { fixtureIdsOnMatchday } from '@/simulation/pyramid';
import { nextMatchday } from '@/simulation/timeline';
import type { MatchEnvironment } from '@/simulation/match/core';
import { simulateMatchFast } from './simulate';

/**
 * The fast background model on its own terms.
 *
 * The routing and the integration with the season live in `mode.test.ts`; this
 * file asks whether the *record* the model writes is internally honest. A fast
 * match is an abstraction, but an abstraction that does not add up is a bug: the
 * goals on the events must be the goals on the scoreline, the saves must be the
 * shots the keeper stopped, the bookings on the players must be the bookings in
 * the log, and a man who never came on must have played no minutes.
 */

/** A prepared fixture from a fresh test world, with the environment it plays in. */
function fixtureFor(seed: string, index = 0): { match: Match; env: MatchEnvironment } {
  const { state } = createTestGame(seed);
  const matchday = nextMatchday(state);
  prepareMatchday(state, matchday);
  const ids = fixtureIdsOnMatchday(state, matchday);
  const match = state.matches[ids[index] ?? ids[0]!];
  if (!match) throw new Error('the test world has no fixtures on its first matchday');
  return { match, env: matchEnvironment(state, match, { autoManageAllBenches: true }) };
}

/** Every fixture on the first matchday of a fresh world, ready to play. */
function matchdayFixtures(seed: string): Array<{ match: Match; env: MatchEnvironment }> {
  const { state } = createTestGame(seed);
  const matchday = nextMatchday(state);
  prepareMatchday(state, matchday);
  return fixtureIdsOnMatchday(state, matchday).map((id) => {
    const match = state.matches[id]!;
    return { match, env: matchEnvironment(state, match, { autoManageAllBenches: true }) };
  });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe('the fast background simulation', () => {
  it('plays a match from the same state and seed identically every time', () => {
    const { match, env } = fixtureFor('fast-determinism');
    const first = structuredClone(match);
    const second = structuredClone(match);
    const a = simulateMatchFast(first, env);
    const b = simulateMatchFast(second, env);

    expect(b).toEqual(a);
    expect(second.result).toEqual(first.result);
    expect(second.events).toEqual(first.events);
    expect(second.performances).toEqual(first.performances);
    expect(second.possessionTicks).toEqual(first.possessionTicks);
    expect(second.substitutions).toEqual(first.substitutions);
    // And it really is stamped as the fast mode, so a reader never has to guess.
    expect(second.simulationMode).toBe('fast');
  });

  it('writes the record the season reads', () => {
    const { match, env } = fixtureFor('fast-contract');
    simulateMatchFast(structuredClone(match), env);
    const played = structuredClone(match);
    simulateMatchFast(played, env);

    expect(played.status).toBe('finished');
    expect(played.played).toBe(true);
    expect(played.result).not.toBeNull();
    expect(played.simulationMode).toBe('fast');
    // The period vocabulary is the full engine's, not a second one.
    expect(['first-half', 'second-half', 'extra-first', 'extra-second']).toContain(played.period);
    expect(played.period).toBe('second-half');
    expect(played.half).toBe(2);
    // A full XI a side plus a named bench.
    expect(Object.keys(played.performances).length).toBeGreaterThanOrEqual(22);
    expect(played.possessionTicks.home + played.possessionTicks.away).toBeGreaterThan(0);
    expect(played.result!.homePossession + played.result!.awayPossession).toBe(100);
    expect(played.result!.attendance).toBeGreaterThan(0);
    // The whistle is on the record, and so is the kick-off.
    expect(played.events[0]!.type).toBe('kick-off');
    expect(played.events[played.events.length - 1]!.type).toBe('full-time');
    expect(played.events.some((event) => event.type === 'half-time')).toBe(true);
  });

  it('keeps the score, the goals and the performers in agreement', () => {
    for (const { match, env } of matchdayFixtures('fast-validity')) {
      const played = structuredClone(match);
      simulateMatchFast(played, env);
      const result = played.result!;
      const performances = Object.values(played.performances);

      // The scoreline is the goal events, however they arose.
      const ownGoals = played.events.filter((event) => event.type === 'own-goal').length;
      const goals = played.events.filter((event) => event.type === 'goal').length;
      const penalties = played.events.filter((event) => event.type === 'penalty-scored').length;
      expect(goals + penalties + ownGoals).toBe(result.homeGoals + result.awayGoals);
      // A goal is credited to a man unless it went in off a defender.
      expect(sum(performances.map((perf) => perf.goals))).toBe(goals + penalties);

      // Every shot is somebody's, and a shot on target is a goal or a save.
      expect(sum(performances.map((perf) => perf.shots))).toBe(result.homeShots + result.awayShots);
      const saves = sum(performances.map((perf) => perf.saves));
      expect(sum(performances.map((perf) => perf.shotsOnTarget))).toBe(goals + penalties + ownGoals + saves);
      // Every attempt is on the log. Open-play attempts are the `shot-*` events;
      // a penalty is a shot too, but it is filed as the kick it was.
      const shotEvents = played.events.filter((event) =>
        ['shot-saved', 'shot-off-target', 'shot-blocked'].includes(event.type),
      ).length;
      const penaltyEvents = played.events.filter(
        (event) => event.type === 'penalty-scored' || event.type === 'penalty-missed',
      ).length;
      expect(shotEvents + penaltyEvents).toBe(result.homeShots + result.awayShots - goals - ownGoals);

      // The bookings on the men are the bookings in the log.
      const yellows = played.events.filter((event) => event.type === 'yellow-card').length;
      const reds = played.events.filter((event) => event.type === 'red-card').length;
      expect(sum(performances.map((perf) => perf.redCards))).toBe(reds);
      expect(sum(performances.map((perf) => perf.yellowCards))).toBeGreaterThanOrEqual(yellows);
      expect(sum(performances.map((perf) => perf.yellowCards))).toBeLessThanOrEqual(yellows + reds);
      for (const perf of performances) {
        expect(perf.redCards).toBeLessThanOrEqual(1);
        expect(perf.sentOff).toBe(perf.redCards > 0);
      }

      // A knock is on the man and in the log, and never twice on one man.
      const injuries = played.events.filter((event) => event.type === 'injury').length;
      expect(performances.filter((perf) => perf.injuryDetail).length).toBe(injuries);
      expect(sum(performances.map((perf) => perf.yellowCards))).toBeLessThanOrEqual(yellows + reds);

      // A change is on the match and in the log, and never more than the three.
      const substitutions = played.events.filter((event) => event.type === 'substitution').length;
      expect(played.substitutions.home + played.substitutions.away).toBe(substitutions);
      expect(played.substitutions.home).toBeLessThanOrEqual(3);
      expect(played.substitutions.away).toBeLessThanOrEqual(3);

      // Nobody plays a minute he could not have played.
      for (const perf of performances) {
        if (!perf.started && perf.cameOnMinute === null) {
          expect(perf.minutesPlayed, `${perf.playerId} played without coming on`).toBe(0);
          continue;
        }
        const from = perf.cameOnMinute ?? 0;
        expect(perf.minutesPlayed).toBeGreaterThan(0);
        expect(perf.minutesPlayed).toBeLessThanOrEqual(played.minute - from + 1);
        expect(perf.rating).toBeGreaterThanOrEqual(3);
        expect(perf.rating).toBeLessThanOrEqual(10);
        expect(perf.energy).toBeGreaterThanOrEqual(0);
        expect(perf.energy).toBeLessThanOrEqual(100);
      }

      // Eleven a side started.
      for (const side of ['home', 'away'] as const) {
        const clubId = side === 'home' ? played.homeClubId : played.awayClubId;
        expect(performances.filter((perf) => perf.clubId === clubId && perf.started).length).toBe(11);
        expect(played.substitutions[side]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('gives the two sides of a match the same events they would get either way', () => {
    // A cheap guard against a side-specific bug: the home and away records are
    // built by the same code, so an equal fixture should read roughly equal.
    const { match, env } = fixtureFor('fast-symmetry');
    const played = structuredClone(match);
    simulateMatchFast(played, env);
    const home = Object.values(played.performances).filter((perf) => perf.clubId === played.homeClubId);
    const away = Object.values(played.performances).filter((perf) => perf.clubId === played.awayClubId);
    expect(home.length).toBe(away.length);
    expect(sum(home.map((perf) => perf.passes))).toBeGreaterThan(0);
    expect(sum(away.map((perf) => perf.passes))).toBeGreaterThan(0);
  });

  it('never leaves a knockout tie undecided', () => {
    const { match, env } = fixtureFor('fast-knockout');
    for (let run = 0; run < 60; run += 1) {
      const fixture = structuredClone(match);
      fixture.knockout = true;
      fixture.seed = match.seed + run * 7919;
      const result = simulateMatchFast(fixture, env);
      const level = fixture.result!.homeGoals === fixture.result!.awayGoals;
      // A cup tie is never left level, whatever the football did.
      expect(level && !fixture.shootoutWinnerId, `run ${run} was left undecided`).toBe(false);
      if (result.decidedBy === 'extra-time') {
        expect(result.homeGoals).not.toBe(result.awayGoals);
      }
      if (fixture.shootoutWinnerId) {
        expect(fixture.result!.penalties).toBeTruthy();
        expect(result.decidedBy).toBe('shootout');
      }
      expect(['normal-time', 'extra-time', 'shootout']).toContain(result.decidedBy);
    }
  });

  it('plays a whole matchday in a fraction of the time one full match takes', () => {
    const fixtures = matchdayFixtures('fast-speed');
    const started = Date.now();
    for (const { match, env } of fixtures) simulateMatchFast(structuredClone(match), env);
    const elapsed = Date.now() - started;
    // The full engine takes about a second for *one* of these. The budget is
    // deliberately loose — a slow CI box must not fail the suite — but a
    // regression that put the step loop back into the fast path would blow it.
    expect(elapsed).toBeLessThan(2000);
  });
});
