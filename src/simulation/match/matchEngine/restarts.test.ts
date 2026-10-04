import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { buildContext } from '../core';
import { cloneMatch } from '../testHelpers';
import { giveBallTo } from './ball';
import { updateDecisions } from './decisions';
import { createMatchEngine } from './engine';
import { progressOf } from './pitch';
import { beginSetPiece } from './setPieces';
import type { SetPieceState } from './types';
import { Rng } from '../../rng';

/**
 * The laws of the restart, as the engine plays them.
 *
 * These pin the four spatial rules the playtest found wanting — the press, the
 * throw-in, the penalty and the kick-off — each by reading the state at the
 * moment the ball is actually played, which is the only moment the rule is a
 * claim about. They are deliberately about *positions and roles*, not about
 * outcomes, so a balance change cannot quietly invalidate them.
 */

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

/** Advance until the dead ball is in its delivery step, and hand it back. */
function toDelivery(
  engine: ReturnType<typeof createMatchEngine>,
  maxSteps = 6000,
): SetPieceState | null {
  const es = engine.getState();
  for (let step = 0; step < maxSteps; step += 1) {
    engine.advance(1 / 30, 1 / 30);
    if (es.setPiece?.phase === 'delivery') return es.setPiece;
    if (es.setPiece === null && step > 0) return null;
  }
  return null;
}

describe('the pressing rule', () => {
  it('sends exactly one defender at the man on the ball, the nearest', () => {
    const { state } = createTestGame('restarts-press');
    const match = userMatch(state);
    const env = envFor(state, match);
    const engine = createMatchEngine(match, env);
    const es = engine.getState();
    const world = { match, env, context: buildContext(match, env) };

    // Take it out of the opening kick-off and park everyone away from the ball.
    es.setPiece = null;
    es.phase = 'open-play';
    for (const player of es.players) {
      if (player.position === 'GK') continue;
      if (player.side === 'home') {
        player.x = 0.05;
        player.y = 0.05;
      } else {
        player.x = 0.95;
        player.y = 0.95;
      }
    }
    const carrier = es.players.find((player) => player.side === 'home' && player.position !== 'GK')!;
    carrier.x = 0.45;
    carrier.y = 0.5;
    giveBallTo(es, carrier.playerId);

    // Two away defenders both on top of him, plus the rest far away. Football
    // sends the closest one; the second must hold his shape.
    const defenders = es.players.filter((player) => player.side === 'away' && player.position !== 'GK');
    defenders[0]!.x = 0.47;
    defenders[0]!.y = 0.5;
    defenders[1]!.x = 0.49;
    defenders[1]!.y = 0.52;

    es.clock = 0;
    es.nextOffBallDecision = 0;
    updateDecisions(es, world, new Rng(1));

    const pressers = es.players.filter(
      (player) => player.side === 'away' && (player.intent === 'press' || player.intent === 'chase'),
    );
    expect(pressers).toHaveLength(1);
    expect(pressers[0]!.playerId).toBe(defenders[0]!.playerId);
  });
});

describe('the throw-in', () => {
  it('is awarded to a named thrower and taken from the touchline', () => {
    const { state } = createTestGame('restarts-throw');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    // Put the ball over the touchline, last touched by a home outfielder, so the
    // throw is the away side's.
    es.setPiece = null;
    es.phase = 'open-play';
    const toucher = es.players.find((player) => player.side === 'home' && player.position !== 'GK')!;
    es.ball.status = 'loose';
    es.ball.ownerId = null;
    es.ball.x = 0.6;
    es.ball.y = 1.002;
    es.ball.lastTouchId = toucher.playerId;

    engine.advance(1 / 30, 1 / 30);

    const event = match.events.filter((candidate) => candidate.type === 'throw-in').at(-1);
    expect(event).toBeDefined();
    // The record names the man who will take it, not an anonymous ball on the line.
    expect(event!.playerId).not.toBeNull();
    // Read the piece through a fresh state reference: assigning `null` above
    // narrows the property, and TypeScript would otherwise call this impossible.
    expect(engine.getState().setPiece?.kind).toBe('throw-in');

    const delivery = toDelivery(engine);
    expect(delivery).not.toBeNull();
    const taker = es.players.find((player) => player.playerId === delivery!.takerId)!;
    // A throw-in is taken from the touchline, by the man named on the record.
    expect(Math.min(taker.y, 1 - taker.y)).toBeLessThan(0.04);
  });
});

describe('the penalty', () => {
  it('stands the keeper on his line and everyone else outside the area', () => {
    const { state } = createTestGame('restarts-penalty');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    beginSetPiece(es, 'penalty', 'home', { x: 0.88, y: 0.5 });
    // Put the defending outfielders roughly where they belong so the arrangement
    // is measured, not the walk to it.
    for (const player of es.players) {
      if (player.side === 'away' && player.position !== 'GK') {
        player.x = 0.72;
        player.y = 0.5;
      }
    }

    const delivery = toDelivery(engine);
    expect(delivery).not.toBeNull();

    const keeper = es.players.find((player) => player.side === 'away' && player.position === 'GK')!;
    expect(keeper.x).toBeGreaterThanOrEqual(0.94);

    // Every other defender is outside his own penalty area (x >= 0.84), behind
    // the ball rather than standing in the taker's path.
    for (const player of es.players) {
      if (player.sentOff || player.side !== 'away' || player.position === 'GK') continue;
      expect(player.x, `${player.position} inside the box at x=${player.x}`).toBeLessThan(0.84);
    }
  });
});

describe('the kick-off', () => {
  it('keeps everyone but the taker out of the centre circle and in their own half', () => {
    const { state } = createTestGame('restarts-kickoff');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    const delivery = toDelivery(engine);
    expect(delivery).not.toBeNull();
    expect(delivery!.kind).toBe('kickoff');

    for (const player of es.players) {
      if (player.sentOff || player.playerId === delivery!.takerId) continue;
      const fromCentre = Math.hypot(player.x - 0.5, player.y - 0.5);
      expect(fromCentre, `${player.side} ${player.position} inside the circle`).toBeGreaterThanOrEqual(0.09);
      expect(
        progressOf(player.side, player.x),
        `${player.side} ${player.position} in the opposition half`,
      ).toBeLessThanOrEqual(0.5001);
    }

    const taker = es.players.find((player) => player.playerId === delivery!.takerId)!;
    expect(Math.hypot(taker.x - 0.5, taker.y - 0.5)).toBeLessThan(0.06);
  });
});
