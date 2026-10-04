import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { cloneMatch } from '../testHelpers';
import { createMatchEngine } from './engine';
import { statsFor } from './events';
import { beginSetPiece } from './setPieces';

/** The human's own fixture on the next matchday, with lineups prepared. */
function userMatch(state: GameState): Match {
  const matchday = nextMatchday(state);
  const fixture = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!fixture) throw new Error('no fixture');
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function envFor(state: GameState, match: Match) {
  return matchEnvironment(state, match, { autoManageAllBenches: true });
}

describe('new engine audit', () => {
  it('does not count dead-ball preparation as possession', () => {
    const { state } = createTestGame('audit-possession');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    beginSetPiece(es, 'corner', 'home', { x: 1, y: 0.01 });
    expect(es.phase).toBe('corner');
    const before = statsFor(es, 'home').possessionSeconds;

    for (let i = 0; i < 10; i += 1) engine.advance(1 / 30, 1 / 30);
    // The side taking the corner owns the restart; it is not playing football,
    // so none of the arrangement may be counted as possession.
    expect(statsFor(es, 'home').possessionSeconds).toBe(before);
  });

  it('lays out a set piece once and does not re-roll the targets each step', () => {
    const { state } = createTestGame('audit-arrange');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    beginSetPiece(es, 'corner', 'home', { x: 1, y: 0.01 });
    engine.advance(1 / 30, 1 / 30); // the first setup step lays the arrangement out
    const snapshot = es.players.map((player) => `${player.playerId}:${player.tx},${player.ty}`);

    engine.advance(1 / 30, 1 / 30);
    engine.advance(1 / 30, 1 / 30);
    const after = es.players.map((player) => `${player.playerId}:${player.tx},${player.ty}`);
    expect(after).toEqual(snapshot);
  });

  it('writes a goal kick as an event as well as a statistic', () => {
    const { state } = createTestGame('audit-goal-kick');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    // Put the ball just over the goal line, last touched by the side attacking
    // that end: a goal kick to the defending side. This exercises the branch
    // directly, since a shot in this version rarely misses the target.
    es.setPiece = null;
    es.phase = 'open-play';
    const attacker = es.players.find((player) => player.side === 'home' && !player.sentOff)!;
    es.ball.status = 'loose';
    es.ball.ownerId = null;
    es.ball.x = 1.002;
    es.ball.y = 0.2;
    es.ball.lastTouchId = attacker.playerId;

    engine.advance(1 / 30, 1 / 30);

    const events = match.events.filter((event) => event.type === 'goal-kick');
    expect(events).toHaveLength(1);
    expect(events[0]!.clubId).toBe(match.awayClubId);
    expect(es.stats.away.goalKicks).toBe(1);
    expect(es.stats.home.goalKicks).toBe(0);
  });

  it('counts a goal as a shot on target', () => {
    for (const seed of ['audit-on-target', 'i4', 'i9']) {
      const { state } = createTestGame(seed);
      const match = userMatch(state);
      const engine = createMatchEngine(match, envFor(state, match));
      engine.runToCompletion();
      const es = engine.getState();

      // Every goal scored by the scoring side's own player is on target. (An own
      // goal is the last touch an opponent, and is not the scoring side's shot.)
      const ownGoals = (clubId: string) =>
        match.events.filter(
          (event) =>
            event.type === 'goal' &&
            event.clubId === clubId &&
            event.playerId !== null &&
            match.performances[event.playerId]?.clubId === clubId,
        ).length;

      expect(es.stats.home.shotsOnTarget).toBeGreaterThanOrEqual(ownGoals(match.homeClubId));
      expect(es.stats.away.shotsOnTarget).toBeGreaterThanOrEqual(ownGoals(match.awayClubId));
      expect(es.stats.home.shotsOnTarget + es.stats.away.shotsOnTarget).toBeGreaterThan(0);
    }
  });
});
