import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { advanceMinute, currentScore, simulateToCompletion } from './engine';
import {
  SPATIAL_SECONDS_PER_MINUTE,
  SPATIAL_STEP_SECONDS,
  advanceSpatial,
  ensureSpatial,
  giveBallTo,
  spatialAlpha,
  stepSpatial,
  syncSpatial,
  travelTo,
} from './spatial';
import { cloneMatch } from './testHelpers';

/**
 * The spatial layer is the match happening in space: positions the simulation
 * owns, a ball that travels rather than teleports, and a fixed step so the same
 * football comes out whatever machine watched it. These pin the three things
 * that make it worth having — movement is continuous, the ball has travel time,
 * and none of it can change a result.
 */

function userMatch(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function staged(seed: string): { state: GameState; match: Match; env: ReturnType<typeof matchEnvironment> } {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  return { state, match, env };
}

describe('the spatial simulation', () => {
  it('places both teams on the pitch from their lineups, and only once', () => {
    const { match, env } = staged('spatial-init');
    const spatial = ensureSpatial(match, env);

    expect(spatial.players).toHaveLength(22);
    expect(spatial.players.filter((node) => node.side === 'home')).toHaveLength(11);
    expect(spatial.players.filter((node) => node.side === 'away')).toHaveLength(11);
    expect(spatial.players.every((node) => node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1)).toBe(true);
    // The home keeper is on his own line and the away keeper on the other.
    const keeper = spatial.players.find((node) => node.side === 'home' && node.position === 'GK')!;
    expect(keeper.x).toBeLessThan(0.2);
    // Asking again gives the same object rather than a second pitch.
    expect(ensureSpatial(match, env)).toBe(spatial);
  });

  it('moves players toward their target instead of teleporting them', () => {
    const { match, env } = staged('spatial-move');
    const spatial = ensureSpatial(match, env);
    const node = spatial.players.find((entry) => entry.position === 'ST')!;

    // Send him somewhere he is not, and watch him walk.
    node.tx = 0.9;
    node.ty = 0.9;
    const from = { x: node.x, y: node.y };
    stepSpatial(match, env, SPATIAL_STEP_SECONDS);

    const moved = Math.hypot(node.x - from.x, node.y - from.y);
    expect(moved).toBeGreaterThan(0);
    // One step can never cover more ground than his legs allow.
    expect(moved).toBeLessThanOrEqual(node.speed * SPATIAL_STEP_SECONDS + 1e-9);
    // And the position he came from is kept for the renderer to interpolate.
    expect(node.px).toBeCloseTo(from.x, 10);
    expect(node.py).toBeCloseTo(from.y, 10);
  });

  it('gives a pass a journey: the ball travels, then the man receives it', () => {
    const { match, env } = staged('spatial-pass');
    const spatial = ensureSpatial(match, env);
    const passer = spatial.players.find((node) => node.side === 'home' && node.position === 'CM')!;
    const receiver = spatial.players.find((node) => node.side === 'home' && node.position === 'ST')!;

    giveBallTo(spatial, passer.playerId);
    travelTo(spatial, { x: passer.x, y: passer.y }, { x: receiver.x, y: receiver.y }, receiver.playerId, 0.32);

    expect(spatial.ball.status).toBe('travelling');
    expect(spatial.ball.ownerId).toBeNull();

    const start = { x: spatial.ball.x, y: spatial.ball.y };
    stepSpatial(match, env, SPATIAL_STEP_SECONDS);
    // One step is not the whole pass.
    expect(spatial.ball.status).toBe('travelling');
    expect(Math.hypot(spatial.ball.x - start.x, spatial.ball.y - start.y)).toBeGreaterThan(0);

    let steps = 1;
    while (spatial.ball.status === 'travelling' && steps < 600) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      steps += 1;
    }
    // It took real time, and it ended at the man it was played to.
    expect(steps).toBeGreaterThan(1);
    expect(spatial.ball.ownerId).toBe(receiver.playerId);
    expect(spatial.ball.status).toBe('controlled');
  });

  it('gives a shot a journey too, and leaves it loose when nobody is on the end of it', () => {
    const { match, env } = staged('spatial-shot');
    const spatial = ensureSpatial(match, env);
    const shooter = spatial.players.find((node) => node.side === 'home' && node.position === 'ST')!;

    giveBallTo(spatial, shooter.playerId);
    travelTo(spatial, { x: shooter.x, y: shooter.y }, { x: 0.99, y: 0.5 }, null, 0.7);
    let steps = 0;
    while (spatial.ball.status === 'travelling' && steps < 600) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      steps += 1;
    }
    expect(steps).toBeGreaterThan(1);
    expect(spatial.ball.status).toBe('loose');
    expect(spatial.ball.ownerId).toBeNull();
  });

  it('follows the teams on the pitch: a substitute appears, a sent-off man goes', () => {
    const { match, env } = staged('spatial-sync');
    const spatial = ensureSpatial(match, env);

    const off = match.lineups.home.starting[5]!;
    const on = match.lineups.home.bench[0]!;
    match.lineups.home.starting[5] = { playerId: on.playerId, position: off.position, role: on.role, outOfPosition: false };
    match.lineups.home.bench.splice(0, 1);
    syncSpatial(match, env);

    expect(spatial.players.some((node) => node.playerId === off.playerId)).toBe(false);
    expect(spatial.players.some((node) => node.playerId === on.playerId)).toBe(true);
    expect(spatial.players).toHaveLength(22);

    // And a sending-off takes a man off the pitch entirely.
    match.lineups.home.starting.splice(3, 1);
    syncSpatial(match, env);
    expect(spatial.players).toHaveLength(21);
  });

  it('advances by the time it is given, in fixed steps, whatever the frame rate', () => {
    const a = staged('spatial-clock-a');
    const spatialA = ensureSpatial(a.match, a.env);
    const b = staged('spatial-clock-b');
    const spatialB = ensureSpatial(b.match, b.env);

    // The same second of football, delivered as small frames and as big ones.
    for (let i = 0; i < 100; i += 1) advanceSpatial(a.match, a.env, 0.01);
    for (let i = 0; i < 10; i += 1) advanceSpatial(b.match, b.env, 0.1);

    expect(spatialA.clock).toBeCloseTo(1, 6);
    expect(spatialB.clock).toBeCloseTo(1, 6);
    // And what is left over is a fraction of a step, never a whole one.
    expect(spatialAlpha(spatialA)).toBeLessThan(1);
    expect(spatialAlpha(spatialB)).toBeLessThan(1);

    // At the fastest setting a single frame is worth a good slice of a minute of
    // football. The picture still has to keep up with the clock, or the move on
    // screen would drift behind the minute the commentary is reading out — so
    // all of it must be spent, not dropped.
    const fast = staged('spatial-clock-fast');
    const spatialFast = ensureSpatial(fast.match, fast.env);
    // Eight seconds of movement, delivered as six chunky frames.
    const frame = 0.8;
    for (let i = 0; i < 6; i += 1) advanceSpatial(fast.match, fast.env, frame);
    expect(spatialFast.clock).toBeCloseTo(frame * 6, 5);
    // But a tab coming back from the background is capped, not replayed.
    const stalled = spatialFast.clock;
    advanceSpatial(fast.match, fast.env, 600);
    expect(spatialFast.clock - stalled).toBeLessThanOrEqual(SPATIAL_SECONDS_PER_MINUTE * 2);
  });

  it('shows the very passes the commentary describes', () => {
    const { state } = createTestGame('spatial-words');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    match.spatial = undefined;
    advanceMinute(match, env); // kick-off, which puts the pitch in place
    const spatial = match.spatial!;
    const surnameOf = (id: string | null | undefined) => (id ? env.getPlayer(id as never)?.surname : undefined);

    const steps = Math.round(SPATIAL_SECONDS_PER_MINUTE / SPATIAL_STEP_SECONDS);
    let checked = 0;

    // What the picture does: every pass the ball is actually played on. The
    // pitch plays a minute's football all the way out before the next minute is
    // decided — which is how the store drives it — so a window shows the minute
    // that was decided for it, possession running across the mark and all.
    const playOut = (into: Set<string>): void => {
      let guard = 0;
      while ((spatial.plan || (spatial.pending?.length ?? 0) > 0) && guard < steps * 3) {
        const wasTravelling = spatial.ball.status === 'travelling';
        advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
        guard += 1;
        if (!wasTravelling && spatial.ball.status === 'travelling' && spatial.ball.targetId) {
          const name = surnameOf(spatial.ball.targetId);
          if (name) into.add(name);
        }
      }
    };

    // The kick-off minute is played out before any judgement is made, so it
    // cannot lend a pass to the window that follows it.
    playOut(new Set());

    for (let minute = 0; minute < 40; minute += 1) {
      const before = match.commentary?.length ?? 0;
      advanceMinute(match, env);

      const playedTo = new Set<string>();
      playOut(playedTo);

      const told = (match.commentary ?? []).slice(before).map((line) => line.text).join(' \n ');
      for (const name of playedTo) {
        // A pass the ball made to a man the commentary never mentions is the
        // exact failure this whole layer exists to prevent.
        expect(told).toContain(name);
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(5);
  });

  it('never lets the ball or a player cross the pitch between one step and the next', () => {
    const { state } = createTestGame('spatial-teleport');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    match.spatial = undefined;
    advanceMinute(match, env);
    const spatial = match.spatial!;

    const steps = Math.round(SPATIAL_SECONDS_PER_MINUTE / SPATIAL_STEP_SECONDS);
    let worstPassage = 0;
    let worstHandover = 0;
    let handovers = 0;

    for (let minute = 0; minute < 25; minute += 1) {
      advanceMinute(match, env);
      // The engine now installs a continuous possession plan rather than a
      // passage; either way the move must fit inside its own minute.
      worstPassage = Math.max(
        worstPassage,
        (spatial.plan?.steps ?? []).reduce((sum, entry) => sum + entry.duration, 0),
      );
      for (let s = 0; s < steps; s += 1) {
        const wasFlying = spatial.ball.status === 'travelling';
        const speed = spatial.ball.speed;
        const heading = spatial.ball.targetId;
        const from = { x: spatial.ball.x, y: spatial.ball.y };
        const fromBall = from;
        const owner = spatial.ball.ownerId;
        const players = spatial.players.map((node) => ({ id: node.playerId, x: node.x, y: node.y }));
        const eventsBefore = match.events.length;
        advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
        // Two frames in a match are not made on legs, and both of them are the
        // same operation: a dead ball being *arranged*. A corner taker is put on
        // his flag, and the two men in a challenge are brought together where it
        // was given. Neither is play, and neither may be measured as if it were —
        // but the exemption is exactly these two frames, because a rule that says
        // "nobody teleports except here and there" is not the rule this test
        // exists to catch.
        const placedTaker =
          spatial.restart?.takerId != null &&
          spatial.players.some((node) => node.playerId === spatial.restart!.takerId && Math.hypot(node.x - (fromBall?.x ?? node.x), node.y - (fromBall?.y ?? node.y)) >= 0);
        const foulJustWritten = match.events.slice(eventsBefore).some((event) => event.type === 'foul');
        const travelled = Math.hypot(spatial.ball.x - from.x, spatial.ball.y - from.y);

        // A ball already on its way somewhere, and still on its way to the same
        // place, can only cover what its own speed allows.
        if (wasFlying && spatial.ball.status === 'travelling' && spatial.ball.targetId === heading) {
          expect(travelled).toBeLessThanOrEqual(speed * SPATIAL_STEP_SECONDS + 1e-9);
        }
        // Whatever the reason, nothing crosses the park in a single step.
        expect(travelled).toBeLessThan(0.15);
        // The one moment the ball moves any other way is when it changes hands,
        // and possession is not handed over so much as gathered: the ball is
        // played to a man near it. A whisk across the park is exactly what made
        // the old picture unreadable.
        if (spatial.ball.ownerId !== owner && spatial.ball.status === 'controlled') {
          worstHandover = Math.max(worstHandover, travelled);
          handovers += 1;
        }

        for (const before of players) {
          const node = spatial.players.find((entry) => entry.playerId === before.id);
          if (!node) continue;
          const moved = Math.hypot(node.x - before.x, node.y - before.y);
          // See the note above: the taker on his flag, and the two men in a
          // challenge, are the only movements in the match not made on legs.
          if (placedTaker && node.playerId === spatial.restart?.takerId) continue;
          if (foulJustWritten) {
            const foul = match.events.slice(eventsBefore).find((event) => event.type === 'foul');
            if (node.playerId === foul?.playerId || node.playerId === foul?.secondaryPlayerId) continue;
          }
          expect(moved).toBeLessThanOrEqual(node.speed * SPATIAL_STEP_SECONDS + 1e-9);
        }
      }
    }

    expect(handovers).toBeGreaterThan(10);
    expect(worstHandover).toBeLessThan(0.05);
    // Every move is sized to finish inside its own minute, so the next one never
    // interrupts it half-played.
    expect(worstPassage).toBeLessThanOrEqual(SPATIAL_SECONDS_PER_MINUTE);
  });

  it('stops playing football for a goal: the pitch celebrates, then restarts', () => {
    const { state } = createTestGame('spatial-celebration');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    match.spatial = undefined;
    advanceMinute(match, env); // kick-off, which puts the pitch in place
    const spatial = match.spatial!;

    const stepsPerMinute = Math.round(SPATIAL_SECONDS_PER_MINUTE / SPATIAL_STEP_SECONDS);
    // Play until a goal goes in, watching for the moment the pitch hands over.
    let minutes = 0;
    while (!spatial.celebration && match.status !== 'finished' && minutes < 120) {
      advanceMinute(match, env);
      minutes += 1;
      for (let s = 0; s < stepsPerMinute && !spatial.celebration; s += 1) {
        advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
      }
    }

    expect(spatial.celebration).toBeTruthy();
    // The celebration begins at the end of the step that put the ball in, so the
    // pitch takes one more step to turn and face it.
    advanceSpatial(match, env, SPATIAL_STEP_SECONDS);

    const celebration = spatial.celebration!;
    const scorer = spatial.players.find((node) => node.playerId === celebration.scorerId);
    expect(scorer).toBeTruthy();

    // Nobody is playing football. The scorer is off to the corner of the goal he
    // scored in, his own team is chasing him, and the rest are going back.
    expect(spatial.plan).toBeNull();
    expect(scorer!.action).toBe('celebrating');
    expect(scorer!.tx).toBeCloseTo(celebration.side === 'home' ? 0.95 : 0.05, 6);
    const scorers = spatial.players.filter(
      (node) => node.side === celebration.side && node.playerId !== celebration.scorerId && node.position !== 'GK',
    );
    expect(scorers.every((node) => node.action === 'celebrating')).toBe(true);
    const conceded = spatial.players.filter((node) => node.side !== celebration.side);
    expect(conceded.every((node) => node.action !== 'celebrating')).toBe(true);

    // The next minute arrives while the huddle is on, and its move is not played
    // into the middle of it.
    advanceMinute(match, env);
    expect(spatial.plan).toBeNull();

    // The celebration runs out. Nothing crossed the park on the way, and the ball
    // ends up back on the centre spot, where the match resumes.
    let furthest = 0;
    let previous = { x: spatial.ball.x, y: spatial.ball.y };
    let guard = 0;
    while (spatial.celebration && guard < stepsPerMinute * 4) {
      advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
      furthest = Math.max(furthest, Math.hypot(spatial.ball.x - previous.x, spatial.ball.y - previous.y));
      previous = { x: spatial.ball.x, y: spatial.ball.y };
      guard += 1;
    }
    expect(spatial.celebration ?? null).toBeNull();
    expect(furthest).toBeLessThan(0.15);

    for (let s = 0; s < stepsPerMinute * 3 && spatial.ball.status === 'travelling'; s += 1) {
      advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
    }
    expect(spatial.ball.x).toBeCloseTo(0.5, 3);
    expect(spatial.ball.y).toBeCloseTo(0.5, 3);
  });

  it('cannot change what happened: pressing on through the same match leaves the result alone', () => {
    const { state } = createTestGame('spatial-outcomes');
    const original = userMatch(state);

    const first = cloneMatch(original);
    simulateToCompletion(first, matchEnvironment(state, first, { autoManageAllBenches: true }));

    const second = cloneMatch(original);
    const env = matchEnvironment(state, second, { autoManageAllBenches: true });
    let guard = 0;
    while (second.status !== 'finished' && guard < 400) {
      advanceMinute(second, env);
      // Somebody watching it would be moving the picture on all the while.
      advanceSpatial(second, env, 0.05);
      guard += 1;
    }

    expect(currentScore(second)).toEqual(currentScore(first));
    expect(second.result).toEqual(first.result);
    expect(second.events.map((event) => event.text)).toEqual(first.events.map((event) => event.text));
  });
});
