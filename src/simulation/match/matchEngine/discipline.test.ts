import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { buildContext } from '../core';
import { cloneMatch } from '../testHelpers';
import { Rng, stream } from '../../rng';
import { createMatchEngine } from './engine';
import { autoManageBench } from './management';
import { pickInjury } from './injuries';
import { sendOff } from './resolve';

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

describe('discipline and injuries', () => {
  it('sends a player off and leaves his side a man short', () => {
    const { state } = createTestGame('red-card-test');
    const match = userMatch(state);
    const env = envFor(state, match);
    const engine = createMatchEngine(match, env);
    const es = engine.getState();
    const world = { match, env, context: buildContext(match, env) };

    const offender = es.players.find((player) => player.side === 'home' && player.position !== 'GK')!;
    sendOff(es, world, offender, 'straight-red');

    expect(offender.sentOff).toBe(true);
    const performance = match.performances[offender.playerId]!;
    expect(performance.sentOff).toBe(true);
    expect(performance.redCards).toBe(1);
    expect(performance.wentOffMinute).not.toBeNull();

    // He is still on the team sheet — his slot must not shuffle under the ten —
    // but the football plays without him, so the side is a man short.
    expect(match.lineups.home.starting.some((slot) => slot.playerId === offender.playerId)).toBe(true);
    expect(es.players.filter((player) => player.side === 'home' && !player.sentOff)).toHaveLength(10);

    const reds = match.events.filter((event) => event.type === 'red-card' && event.playerId === offender.playerId);
    expect(reds).toHaveLength(1);
    expect(reds[0]!.importance).toBe(3);
  });

  it('distinguishes a second yellow from a straight red in the record', () => {
    const { state } = createTestGame('second-yellow-test');
    const match = userMatch(state);
    const env = envFor(state, match);
    const engine = createMatchEngine(match, env);
    const es = engine.getState();
    const world = { match, env, context: buildContext(match, env) };

    const offender = es.players.find((player) => player.side === 'home' && player.position !== 'GK')!;
    sendOff(es, world, offender, 'second-yellow');

    const performance = match.performances[offender.playerId]!;
    expect(performance.sentOff).toBe(true);
    // A second yellow is a dismissal but not a red card in the record.
    expect(performance.redCards).toBe(0);
    expect(es.stats.home.redCards).toBe(0);
  });

  it('does not let a sent-off man be replaced', () => {
    const { state } = createTestGame('red-card-sub-test');
    const match = userMatch(state);
    const env = envFor(state, match);
    const engine = createMatchEngine(match, env);
    const es = engine.getState();
    const world = { match, env, context: buildContext(match, env) };

    const offender = es.players.find((player) => player.side === 'home' && player.position !== 'GK')!;
    sendOff(es, world, offender, 'straight-red');

    const bench = match.lineups.home.bench[0]!;
    expect(engine.substitute('home', offender.playerId, bench.playerId)).toBe(false);
    expect(match.substitutions.home).toBe(0);
  });

  it('brings an injured man off at the next review', () => {
    const { state } = createTestGame('injury-bench-test');
    const match = userMatch(state);
    const env = envFor(state, match);
    const engine = createMatchEngine(match, env);
    const es = engine.getState();
    const world = { match, env, context: buildContext(match, env) };

    const injured = es.players.find((player) => player.side === 'home' && player.position !== 'GK')!;
    match.performances[injured.playerId]!.injuryDetail = {
      description: 'a twisted ankle',
      severity: 'minor',
      daysOut: 7,
    };
    match.minute = 20;

    autoManageBench(es, world, 'home', stream(match.seed, 'test'));

    expect(match.substitutions.home).toBe(1);
    expect(match.performances[injured.playerId]!.wentOffMinute).toBe(20);
    const subEvents = match.events.filter(
      (event) => event.type === 'substitution' && event.secondaryPlayerId === injured.playerId,
    );
    expect(subEvents).toHaveLength(1);
    // He is off the pitch and off the team sheet; somebody else is on it.
    expect(es.players.some((player) => player.playerId === injured.playerId)).toBe(false);
    expect(match.lineups.home.starting.some((slot) => slot.playerId === injured.playerId)).toBe(false);
  });

  it('picks a plausible injury', () => {
    const { state } = createTestGame('pick-injury-test');
    const match = userMatch(state);
    const env = envFor(state, match);
    const player = env.getPlayer(match.lineups.home.starting[0]!.playerId)!;

    const detail = pickInjury(new Rng(12345), player, 55, 1);
    expect(['knock', 'minor', 'moderate', 'serious']).toContain(detail.severity);
    expect(detail.daysOut).toBeGreaterThanOrEqual(0);
    expect(detail.description.length).toBeGreaterThan(0);
  });

  it('records red cards and injuries during a match, and answers them', () => {
    // Both a sending-off and a knock are *rare* events, so one seed is a lucky
    // draw rather than a law: pinning a single seed here made the test a
    // statement about one afternoon's luck, and any change to the football —
    // even one that leaves discipline untouched — redraws it. So a handful of
    // seeds are walked and the law is asserted wherever it actually fires.
    const seeds = ['i9', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i10'];
    let reds = 0;
    let injuries = 0;
    for (const seed of seeds) {
      const { state } = createTestGame(seed);
      const match = userMatch(state);
      const engine = createMatchEngine(match, envFor(state, match));
      engine.runToCompletion();

      for (const event of match.events.filter((entry) => entry.type === 'red-card')) {
        reds += 1;
        const performance = match.performances[event.playerId!]!;
        expect(performance.sentOff).toBe(true);
        expect(performance.wentOffMinute).not.toBeNull();
        // He stops being a man on the pitch: the side plays short from there on.
        const node = engine.getState().players.find((player) => player.playerId === event.playerId)!;
        expect(node.sentOff).toBe(true);
      }
      for (const event of match.events.filter((entry) => entry.type === 'injury')) {
        injuries += 1;
        expect(match.performances[event.playerId!]!.injuryDetail).not.toBeNull();
      }
    }

    // Across the corpus both kinds of incident occur, so the code paths above
    // were actually exercised rather than left dormant.
    expect(injuries).toBeGreaterThan(0);
    expect(reds).toBeGreaterThan(0);
  });
});
