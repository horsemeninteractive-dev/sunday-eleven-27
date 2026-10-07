import { describe, expect, it } from 'vitest';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { cloneMatch } from './testHelpers';
import { createMatchEngine } from './matchEngine';
import { matchStats, recentPressure } from './stats';

/**
 * The stats panel may only show what the simulation actually knows. These tests
 * exist so a panel can never quietly start inventing a number: every figure is
 * checked against the match record the engine wrote.
 */

function aFinishedMatch(seed: string) {
  const { state } = createTestGame(seed);
  const match = Object.values(state.matches).find(
    (candidate) =>
      candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, match.matchday);
  const prepared = cloneMatch(state.matches[match.id]!);
  const engine = createMatchEngine(prepared, matchEnvironment(state, prepared, { autoManageAllBenches: true }));
  engine.runToCompletion();
  return prepared;
}

describe('live match statistics', () => {
  it('reads shots straight off the match record', () => {
    const match = aFinishedMatch('stats-shots');
    const stats = matchStats(match);

    expect(match.result).not.toBeNull();
    expect(stats.home.shots).toBe(match.result!.homeShots);
    expect(stats.away.shots).toBe(match.result!.awayShots);
    expect(stats.home.shotsOnTarget).toBeLessThanOrEqual(stats.home.shots);
    expect(stats.away.shotsOnTarget).toBeLessThanOrEqual(stats.away.shots);
  });

  it('splits possession between the two sides and nothing else', () => {
    const match = aFinishedMatch('stats-possession');
    const stats = matchStats(match);

    expect(stats.home.possession + stats.away.possession).toBeCloseTo(1, 10);
    // The engine rounds the same ticks to a whole percent for the result.
    expect(Math.round(stats.home.possession * 100)).toBe(match.result!.homePossession);
  });

  it('counts corners, fouls and cards from the incidents themselves', () => {
    const match = aFinishedMatch('stats-counts');
    const stats = matchStats(match);
    const countIn = (type: string, side: 'home' | 'away') => {
      const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
      return match.events.filter((event) => event.type === type && event.clubId === clubId).length;
    };

    for (const side of ['home', 'away'] as const) {
      expect(stats[side].corners).toBe(countIn('corner', side));
      expect(stats[side].fouls).toBe(countIn('foul', side));
      expect(stats[side].yellowCards).toBe(countIn('yellow-card', side));
      expect(stats[side].redCards).toBe(countIn('red-card', side));
    }
  });
});

describe('recent pressure', () => {
  it('is level when nothing has happened', () => {
    const match = aFinishedMatch('pressure-quiet');
    expect(recentPressure({ ...match, events: [] })).toEqual({ home: 0.5, away: 0.5 });
  });

  it('leans towards the side that has been making the chances', () => {
    const match = aFinishedMatch('pressure-lean');
    const homeShot = {
      id: 'x',
      minute: 88,
      type: 'shot-saved' as const,
      clubId: match.homeClubId,
      playerId: null,
      secondaryPlayerId: null,
      text: 'Saved.',
      x: 0.5,
      y: 0.5,
      scoreAfter: { home: 0, away: 0 },
      importance: 2 as const,
    };
    const pressure = recentPressure({ ...match, minute: 90, events: [homeShot] });
    expect(pressure.home).toBe(1);
    expect(pressure.away).toBe(0);
  });
});
