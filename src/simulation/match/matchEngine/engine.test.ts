import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { STOPPAGE_BOUNDS } from '../core';
import { cloneMatch } from '../testHelpers';
import { createMatchEngine } from './engine';

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

describe('match engine', () => {
  it('plays a complete match from kick-off to full time', () => {
    const { state } = createTestGame('engine-basic');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    engine.runToCompletion();

    expect(engine.finished).toBe(true);
    expect(match.status).toBe('finished');
    expect(match.result).not.toBeNull();

    const types = new Set(match.events.map((event) => event.type));
    expect(types.has('kick-off')).toBe(true);
    expect(types.has('half-time')).toBe(true);
    expect(types.has('full-time')).toBe(true);

    // A full XI a side.
    expect(Object.keys(match.performances).length).toBeGreaterThanOrEqual(22);

    const result = match.result!;
    expect(result.homePossession + result.awayPossession).toBe(100);
    expect(result.homeShots + result.awayShots).toBeGreaterThan(0);

    // Every goal on the record — an ordinary goal, an own goal or a penalty —
    // must add up to the scoreline.
    const goals = match.events.filter(
      (event) => event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored',
    );
    expect(goals.length).toBe(result.homeGoals + result.awayGoals);

    // The ordinary texture is on the record too, not only the loud moments: a
    // move is a run of passes and carries, and the timeline needs them to group.
    const count = (type: string) => match.events.filter((event) => event.type === type).length;
    expect(count('pass')).toBeGreaterThan(100);
    expect(count('carry')).toBeGreaterThan(0);
    expect(count('tackle')).toBeGreaterThan(0);
  });

  it('stamps every event with seconds since kick-off, straight through the interval', () => {
    // The record is read as a timeline by the presentation layer, which assumes
    // the seconds run forwards. Rewinding the clock to 45:00 at the interval —
    // which is tempting, because the second half *is* shown as starting at 45 —
    // would stamp a second-half event earlier than the half-time whistle that
    // preceded it, and put the whole record out of order.
    const { state } = createTestGame('engine-clock');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    engine.runToCompletion();

    // The engine knows which part of the game it finished in, and both the
    // season's `half` and the match's own `period` follow it — the period is what
    // the UI labels with instead of guessing from the half number.
    expect(engine.getState().period).toBe('second-half');
    expect(match.half).toBe(2);
    expect(match.period).toBe('second-half');

    const seconds = match.events.map((event) => event.second ?? event.minute * 60);
    for (let index = 1; index < seconds.length; index += 1) {
      expect(seconds[index]!).toBeGreaterThanOrEqual(seconds[index - 1]!);
    }
    // And the second half really did start after the interval, not at 45:00.
    const halfTime = match.events.findIndex((event) => event.type === 'half-time');
    const afterInterval = match.events[halfTime + 1];
    expect(afterInterval).toBeDefined();
    expect(seconds[halfTime + 1]!).toBeGreaterThanOrEqual(seconds[halfTime]!);
    // The second half begins at 45 plus the first half's stoppage, and the
    // displayed minute is rebased so a manager still reads it as 45.
    expect(seconds[halfTime + 1]!).toBeGreaterThan(45 * 60);

    // The label is rebased with the period: the half-time whistle is filed under
    // first-half stoppage (45+x on the clock), while the second half opens at 45
    // again — not the 49 the raw second would give.
    expect(match.events[halfTime]!.minute).toBeGreaterThan(45);
    const firstFootball = match.events
      .slice(halfTime + 1)
      .find((event) => event.type === 'pass' || event.type === 'carry');
    expect(firstFootball?.minute).toBe(45);
  });

  it('plays extra time and a shootout for a level knockout tie', () => {
    // A cup tie the football will not separate has to be settled the way a level
    // cup tie is: extra time, then penalties. The score the engine reads at each
    // period end is held level to reach it, so the branch is exercised rather
    // than hoped for.
    const { state } = createTestGame('engine-extra-time');
    const match = userMatch(state);
    match.knockout = true;
    const engine = createMatchEngine(match, envFor(state, match));

    let guard = 0;
    while (!engine.finished && guard < 30000) {
      if (engine.getState().phase === 'half-time') engine.startSecondHalf();
      engine.getState().score.home = 0;
      engine.getState().score.away = 0;
      engine.advance(5, 5);
      guard += 1;
    }

    expect(engine.finished).toBe(true);
    const types = match.events.map((event) => event.type);
    expect(types).toContain('extra-time');
    expect(types).toContain('penalties');
    // The tie is settled, and by the shootout: a winner and a kick-by-kick score,
    // never a draw for the cup to guess at.
    expect(match.shootoutWinnerId).toBeTruthy();
    const penalties = match.result!.penalties;
    expect(penalties).toBeDefined();
    expect(penalties!.home).not.toBe(penalties!.away);
    // And the record says where the football finished.
    expect(match.period).toBe('extra-second');
    expect(match.half).toBe(3);
  });

  it('always settles a knockout tie played straight out', () => {
    // The invariant the cup relies on: however the tie falls, `result` says who
    // went through, either on goals or on penalties — never neither.
    const { state } = createTestGame('engine-knockout');
    const match = userMatch(state);
    match.knockout = true;
    createMatchEngine(match, envFor(state, match)).runToCompletion();

    expect(match.status).toBe('finished');
    const result = match.result!;
    const decided = result.homeGoals !== result.awayGoals || Boolean(match.shootoutWinnerId);
    expect(decided).toBe(true);
    if (result.homeGoals === result.awayGoals) {
      expect(result.penalties).toBeDefined();
    }
  });

  it('produces a believable Sunday-league scoreline', () => {
    const { state } = createTestGame('engine-scoreline');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    engine.runToCompletion();

    const result = match.result!;
    const total = result.homeGoals + result.awayGoals;
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBeLessThanOrEqual(14);
  });

  it('replays identically from the same seed', () => {
    const { state } = createTestGame('engine-determinism');
    const original = userMatch(state);
    const first = cloneMatch(original);
    const second = cloneMatch(original);

    createMatchEngine(first, envFor(state, first)).runToCompletion();
    createMatchEngine(second, envFor(state, second)).runToCompletion();

    const key = (m: Match) => m.events.map((event) => `${event.minute}:${event.type}:${event.playerId ?? ''}`);
    expect(key(first)).toEqual(key(second));
    expect(first.result).toEqual(second.result);
  });

  it('produces the same match however the presentation paces it', () => {
    // The split this proves: the presentation decides how much football a frame
    // is worth, and that varies per passage — a few hundredths of a second of
    // filler, several seconds of a chance, a whole skip in one step. The engine
    // must not care. This drives two fixtures with wildly different feeding
    // patterns and compares the record, which is the guarantee the store's
    // variable-rate pump depends on.
    const { state } = createTestGame('engine-pacing');
    const original = userMatch(state);
    const steady = cloneMatch(original);
    const ragged = cloneMatch(original);

    const a = createMatchEngine(steady, envFor(state, steady));
    const b = createMatchEngine(ragged, envFor(state, ragged));

    // One is fed a smooth trickle; the other in a jittering mix of tiny frames
    // and large jumps, including the interval released without anybody watching.
    const pattern = [0.016, 0.016, 2.5, 0.016, 0.4, 6, 0.016, 0.05, 3, 0.016];
    let i = 0;
    while (!a.finished && !b.finished && i < 200000) {
      a.advance(0.05, 0.05);
      const delta = pattern[i % pattern.length]!;
      b.advance(delta, Math.max(delta, 0.05));
      i += 1;
    }

    const key = (m: Match) => m.events.map((event) => `${event.second}:${event.type}:${event.playerId ?? ''}`);
    expect(key(steady)).toEqual(key(ragged));
    expect(steady.result).toEqual(ragged.result);
  });

  it('plays added time it has measured from the stoppages, not one drawn before kick-off', () => {
    // The referee's board used to be a number off the seed: every half got
    // between one and five-plus minutes whether or not anything had happened.
    // Now the engine watches the ball while it is dead, and plays back what it
    // actually saw.
    const { state } = createTestGame('engine-stoppage');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    engine.runToCompletion();

    const first = match.stoppage?.first;
    const second = match.stoppage?.second;
    expect(typeof first).toBe('number');
    expect(typeof second).toBe('number');
    expect(first!).toBeGreaterThanOrEqual(STOPPAGE_BOUNDS[1].min);
    expect(first!).toBeLessThanOrEqual(STOPPAGE_BOUNDS[1].max);
    expect(second!).toBeGreaterThanOrEqual(STOPPAGE_BOUNDS[2].min);
    expect(second!).toBeLessThanOrEqual(STOPPAGE_BOUNDS[2].max);

    // The engine really did count time with the ball dead.
    expect(engine.getState().stoppedSeconds.first).toBeGreaterThan(0);
    expect(engine.getState().stoppedSeconds.second).toBeGreaterThan(0);

    // And the whistle went at 45 plus the first half's added time, and at 90
    // plus both halves', because that is how long the football took.
    const halfTime = match.events.find((event) => event.type === 'half-time')!;
    const fullTime = match.events[match.events.length - 1]!;
    expect(fullTime.type).toBe('full-time');
    expect(Math.round((halfTime.second ?? 0) / 60)).toBe(45 + first!);
    expect(Math.round((fullTime.second ?? 0) / 60)).toBe(90 + first! + second!);
  });

  it('gives a stop-start half more added time than a quiet one', () => {
    // The figure has to follow the play: a half with more dead-ball time must
    // never get less added time than a half with less of it.
    const rows = ['stoppage-a', 'stoppage-b', 'stoppage-c'].map((seed) => {
      const { state } = createTestGame(seed);
      const match = userMatch(state);
      const engine = createMatchEngine(match, envFor(state, match));
      engine.runToCompletion();
      return { dead: engine.getState().stoppedSeconds.first, added: match.stoppage!.first! };
    });
    expect(new Set(rows.map((row) => row.dead)).size).toBeGreaterThan(1);
    const sorted = [...rows].sort((a, b) => a.dead - b.dead);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.added).toBeGreaterThanOrEqual(sorted[i - 1]!.added);
    }
  });

  it('leaves play for throw-ins and corners during a match', () => {
    const { state } = createTestGame('engine-restarts');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    engine.runToCompletion();

    const types = match.events.map((event) => event.type);
    const throwIns = types.filter((type) => type === 'throw-in').length;
    const corners = types.filter((type) => type === 'corner').length;
    expect(throwIns).toBeGreaterThan(0);
    expect(corners).toBeGreaterThanOrEqual(0);
  });

  it('celebrates a goal: the scoring side runs, the ball rests in the net, and the restart returns it', () => {
    // The seconds after a goal are not a still picture any more. The side that
    // scored genuinely moves — the scorer runs for the corner, his teammates set
    // off after him — while the ball lies in the net where it crossed the line,
    // and the conceding side holds its ground. The restart, not the hold, is
    // what puts the ball back on the centre spot.
    const { state } = createTestGame('engine-goal-hold');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));

    // Search in half-second chunks so the hold is caught near its start and a
    // second of celebration still fits inside it.
    let scored = false;
    for (let i = 0; i < 40000 && !scored && !engine.finished; i += 1) {
      engine.advance(0.5, 0.5, false);
      scored = engine.getState().phase === 'goal';
    }
    expect(scored).toBe(true);

    const held = engine.getState();
    const celebration = held.celebration;
    expect(celebration).toBeTruthy();
    const side = celebration!.side;
    const before = new Map(held.players.map((player) => [player.playerId, { x: player.x, y: player.y }]));
    const ballX = held.ball.x;
    const ballY = held.ball.y;

    // The ball rests where it crossed the line, drawn exactly where it is, and
    // is not already on the centre spot.
    expect(held.ball.px).toBe(ballX);
    expect(held.ball.py).toBe(ballY);
    expect(Math.abs(ballX - 0.5) > 0.05 || Math.abs(ballY - 0.5) > 0.05).toBe(true);

    // A second of celebration: the scoring side has genuinely run, the conceding
    // side has not, and the ball has not moved from the net.
    engine.advance(1, 1, false);
    const during = engine.getState();
    expect(during.phase).toBe('goal');
    let scorersMoved = 0;
    let concedersMoved = 0;
    for (const player of during.players) {
      const from = before.get(player.playerId)!;
      const moved = Math.hypot(player.x - from.x, player.y - from.y);
      if (player.side === side) {
        if (moved > 0.01) scorersMoved += 1;
      } else if (moved > 0.01) {
        concedersMoved += 1;
      }
      // The drawn position is always a real position — never a stale value from
      // another step — so the interpolated picture is movement, not a shudder.
      expect(Number.isFinite(player.px)).toBe(true);
      expect(Number.isFinite(player.py)).toBe(true);
    }
    expect(scorersMoved).toBeGreaterThanOrEqual(5);
    expect(concedersMoved).toBe(0);
    expect(during.ball.x).toBe(ballX);
    expect(during.ball.y).toBe(ballY);

    // After the hold, the kick-off brings it back to the centre spot.
    engine.advance(4, 4, false);
    const after = engine.getState();
    expect(after.phase).not.toBe('goal');
    expect(after.ball.x).toBeCloseTo(0.5, 5);
    expect(after.ball.px).toBeCloseTo(0.5, 5);
  });

  it('lays each side out symmetrically, so the shape is not lopsided', () => {
    // A wide role widens a man toward *his own* touchline. The width bias used
    // to be signed by the team's facing instead of the player's flank, so every
    // wide role pushed the same screen direction: a left back drifted toward the
    // middle while a right back went wider — and the away side mirrored the same
    // lopsided shape. The fixed slot geometry must mirror about the halfway line.
    const { state } = createTestGame('engine-shape-symmetry');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));

    for (const side of ['home', 'away'] as const) {
      const ys = engine
        .getState()
        .players.filter((player) => player.side === side)
        .map((player) => 0.5 + player.slotLateral)
        .sort((a, b) => a - b);
      expect(ys).toHaveLength(11);
      for (let index = 0; index < ys.length; index += 1) {
        expect(ys[index]! + ys[ys.length - 1 - index]!).toBeCloseTo(1, 6);
      }
    }
  });
});
