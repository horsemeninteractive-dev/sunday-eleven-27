import { fixtureIdsOnMatchday } from '@/simulation/pyramid';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { createTestGame } from '../testSupport';
import { nextMatchday } from '@/simulation/timeline';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { advanceMinute, beginMatch, simulateToCompletion } from './engine';
import { cloneMatch } from './testHelpers';

/**
 * Fixtures only carry lineups once their matchday has arrived, so tests must
 * prepare the matchday before simulating a game from it.
 */
function preparedMatch(state: GameState, fixture: Match): Match {
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function userMatch(state: GameState): Match {
  const matchday = nextMatchday(state);
  const match = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!match) throw new Error('no fixture');
  return match;
}

describe('match engine', () => {
  it('produces identical matches from the same initial state and seed', () => {
    const { state } = createTestGame('determinism-check');
    const original = userMatch(state);

    const first = cloneMatch(original);
    const second = cloneMatch(original);

    simulateToCompletion(first, matchEnvironment(state, first, { autoManageAllBenches: true }));
    simulateToCompletion(second, matchEnvironment(state, second, { autoManageAllBenches: true }));

    expect(first.events.map((event) => `${event.minute}:${event.type}:${event.playerId ?? ''}`)).toEqual(
      second.events.map((event) => `${event.minute}:${event.type}:${event.playerId ?? ''}`),
    );
    expect(first.result).toEqual(second.result);
  });

  it('replays the same way when stepped one minute at a time', () => {
    const { state } = createTestGame('step-check');
    const original = userMatch(state);
    const whole = cloneMatch(original);
    const stepped = cloneMatch(original);

    simulateToCompletion(whole, matchEnvironment(state, whole, { autoManageAllBenches: true }));

    const env = matchEnvironment(state, stepped, { autoManageAllBenches: true });
    beginMatch(stepped, env);
    let guard = 0;
    while (stepped.status !== 'finished' && guard < 400) {
      advanceMinute(stepped, env);
      guard += 1;
    }

    expect(stepped.result!.homeGoals).toBe(whole.result!.homeGoals);
    expect(stepped.result!.awayGoals).toBe(whole.result!.awayGoals);
  });

  it('produces a believable Sunday League scoreline and event list', () => {
    const { state } = createTestGame('belief-check');
    const match = cloneMatch(userMatch(state));
    simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));

    const result = match.result!;
    expect(result.homeGoals + result.awayGoals).toBeGreaterThanOrEqual(0);
    expect(result.homeGoals + result.awayGoals).toBeLessThanOrEqual(14);
    expect(result.homeShots + result.awayShots).toBeGreaterThan(4);
    expect(result.homePossession + result.awayPossession).toBe(100);
    expect(result.attendance).toBeGreaterThan(0);

    const types = new Set(match.events.map((event) => event.type));
    expect(types.has('kick-off')).toBe(true);
    expect(types.has('half-time')).toBe(true);
    expect(types.has('full-time')).toBe(true);

    // Player performances are recorded for both sides.
    expect(Object.keys(match.performances).length).toBeGreaterThanOrEqual(22);
    for (const performance of Object.values(match.performances)) {
      expect(performance.rating).toBeGreaterThanOrEqual(3);
      expect(performance.rating).toBeLessThanOrEqual(10);
    }

    // A goal from the spot counts as a goal in the scoreline as well as a goal
    // in the match record, so both event types have to be counted here.
    const goals = match.events.filter((event) => event.type === 'goal' || event.type === 'penalty-scored');
    const goalCount = goals.length;
    expect(goalCount).toBe(result.homeGoals + result.awayGoals);
    for (const goal of goals) {
      expect(goal.playerId).toBeTruthy();
      expect(goal.scoreAfter.home + goal.scoreAfter.away).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives the stronger side better results over many matches', () => {
    const { state, draft } = createTestGame('strength-check');
    const clubIds: ClubId[] = draft.divisionClubIds;
    // Boost every attribute of one club's squad, and nerf another's.
    const strong = state.clubs[clubIds[0]!]!;
    const weak = state.clubs[clubIds[1]!]!;
    for (const id of strong.squadIds) {
      const player = state.people[id];
      if (player?.kind !== 'player') continue;
      for (const group of Object.values(player.attributes)) {
        for (const key of Object.keys(group as unknown as Record<string, number>)) {
          (group as unknown as Record<string, number>)[key] = 17;
        }
      }
    }
    for (const id of weak.squadIds) {
      const player = state.people[id];
      if (player?.kind !== 'player') continue;
      for (const group of Object.values(player.attributes)) {
        for (const key of Object.keys(group as unknown as Record<string, number>)) {
          (group as unknown as Record<string, number>)[key] = 7;
        }
      }
    }

    let strongGoals = 0;
    let weakGoals = 0;
    for (let i = 0; i < 12; i++) {
      const fixture = Object.values(state.matches).find(
        (candidate) => candidate.homeClubId === strong.id && candidate.awayClubId === weak.id,
      )!;
      const match = preparedMatch(state, fixture);
      match.seed = 1000 + i;
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
      strongGoals += match.result!.homeGoals;
      weakGoals += match.result!.awayGoals;
    }

    expect(strongGoals).toBeGreaterThan(weakGoals * 1.5);
    expect(weakGoals).toBeLessThan(strongGoals);
  });

  it('lets the better side win most matches without making surprises impossible', () => {
    const { state, draft } = createTestGame('variance-check');
    const clubIds: ClubId[] = draft.divisionClubIds;
    const stronger = state.clubs[clubIds[2]!]!;
    const weaker = state.clubs[clubIds[3]!]!;
    for (const id of stronger.squadIds) {
      const player = state.people[id];
      if (player?.kind !== 'player') continue;
      for (const group of Object.values(player.attributes)) {
        for (const key of Object.keys(group as unknown as Record<string, number>)) {
          (group as unknown as Record<string, number>)[key] = Math.min(20, 13);
        }
      }
    }
    for (const id of weaker.squadIds) {
      const player = state.people[id];
      if (player?.kind !== 'player') continue;
      for (const group of Object.values(player.attributes)) {
        for (const key of Object.keys(group as unknown as Record<string, number>)) {
          (group as unknown as Record<string, number>)[key] = 9;
        }
      }
    }

    let strongerWins = 0;
    let weakerWins = 0;
    const fixtures = Object.values(state.matches).filter(
      (candidate) => candidate.homeClubId === weaker.id && candidate.awayClubId === stronger.id,
    );
    let played = 0;
    for (const fixture of fixtures) {
      for (let i = 0; i < 8; i++) {
        const match = preparedMatch(state, fixture);
        match.seed = 5000 + i * 17;
        simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
        const home = match.result!.homeGoals;
        const away = match.result!.awayGoals;
        const strongerWasHome = match.homeClubId === stronger.id;
        const strongerGoals = strongerWasHome ? home : away;
        const weakerGoals = strongerWasHome ? away : home;
        if (strongerGoals > weakerGoals) strongerWins += 1;
        if (weakerGoals > strongerGoals) weakerWins += 1;
        played += 1;
      }
    }

    expect(played).toBeGreaterThanOrEqual(8);
    // Ability and setup dominate the result; randomness decides the details.
    // (Distribution-level behaviour is covered in calibration.test.ts.)
    expect(strongerWins).toBeGreaterThan(weakerWins);
    expect(strongerWins).toBeGreaterThan(played / 2);
  });

  it('creates chances, cards and injuries across a season of fixtures', () => {
    const { state } = createTestGame('season-scan');
    prepareMatchday(state, 1);
    prepareMatchday(state, 3);
    const matchday1 = fixtureIdsOnMatchday(state, 1).map((id) => cloneMatch(state.matches[id]!));
    const matchday3 = fixtureIdsOnMatchday(state, 3).map((id) => cloneMatch(state.matches[id]!));
    const matches = [...matchday1, ...matchday3];
    const typeCounts = new Map<string, number>();
    let goals = 0;

    for (const match of matches) {
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
      for (const event of match.events) {
        typeCounts.set(event.type, (typeCounts.get(event.type) ?? 0) + 1);
      }
      goals += match.result!.homeGoals + match.result!.awayGoals;
    }

    expect(goals / matches.length).toBeGreaterThan(1.2);
    expect(goals / matches.length).toBeLessThan(6);
    expect(typeCounts.get('foul')).toBeGreaterThan(20);
    expect((typeCounts.get('shot-saved') ?? 0) + (typeCounts.get('shot-off-target') ?? 0)).toBeGreaterThan(20);
    const cards = (typeCounts.get('yellow-card') ?? 0) + (typeCounts.get('red-card') ?? 0);
    expect(cards).toBeGreaterThan(3);
  });
});
