import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { PlayerId } from '@/domain/ids';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { advanceMinute, currentScore } from './engine';
import { cloneMatch } from './testHelpers';
import {
  SPATIAL_SECONDS_PER_MINUTE,
  SPATIAL_STEP_SECONDS,
  advanceSpatial,
  ensureSpatial,
  giveBallTo,
  installPossessionChains,
  installPossessionPlan,
  stepSpatial,
} from './spatial';
import { buildPossessionPlan } from './continuousPossession';
import type { TimelineAction } from './actionTimeline';

/**
 * The continuous possession.
 *
 * The step this pins is the one the architecture was missing: the football is no
 * longer decided in full and then replayed. The possession model still *decides*
 * a minute, but the pitch now *executes* those decisions a fixed simulation step
 * at a time — the carrier moves, the ball is played, it travels, and the receiver
 * takes it — from the authoritative player, ball and action state. At every
 * moment of the sequence, that state says where everyone is and what is being
 * done.
 *
 * Nothing here decides anything, so nothing here can change a result. What these
 * tests protect is that the moving picture is the football the model played, that
 * it is deterministic, and that the clock — not the frame rate — is what moves it.
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
  match.spatial = undefined;
  ensureSpatial(match, env);
  return { state, match, env };
}

/** One decision from the possession model, exactly as the engine records it. */
function action(
  kind: TimelineAction['kind'],
  playerId: PlayerId,
  targetPlayerId: PlayerId | null,
  outcome: TimelineAction['outcome'],
  toX = 0.7,
  toY = 0.5,
  side: 'home' | 'away' = 'home',
): TimelineAction {
  return {
    kind,
    decision: kind,
    side,
    playerId,
    targetPlayerId,
    fromX: 0.5,
    fromY: 0.5,
    toX,
    toY,
    startSecond: 0,
    duration: 1.2,
    outcome,
  };
}

function homePlayers(match: Match) {
  const spatial = match.spatial!;
  return {
    cm: spatial.players.find((node) => node.side === 'home' && node.position === 'CM')!,
    st: spatial.players.find((node) => node.side === 'home' && node.position === 'ST')!,
  };
}

/** A stable, comparable picture of the pitch, to six decimal places. */
function snapshot(match: Match): string {
  const spatial = match.spatial!;
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  return JSON.stringify({
    clock: round(spatial.clock),
    ball: { x: round(spatial.ball.x), y: round(spatial.ball.y), status: spatial.ball.status, owner: spatial.ball.ownerId },
    players: spatial.players.map((node) => ({
      id: node.playerId,
      x: round(node.x),
      y: round(node.y),
      tx: round(node.tx),
      ty: round(node.ty),
      vx: round(node.vx),
      vy: round(node.vy),
      action: node.action,
    })),
  });
}

describe('the possession plan', () => {
  it('is built from the model\u2019s own decisions and invents nothing', () => {
    const { match } = staged('plan-build');
    const { cm, st } = homePlayers(match);
    const geometry = {
      pointOf: (id: PlayerId) => match.spatial!.players.find((node) => node.playerId === id),
      targetOf: () => undefined,
      onPitch: (id: PlayerId | null | undefined) => Boolean(id) && match.spatial!.players.some((node) => node.playerId === id),
    };

    const plan = buildPossessionPlan('home', [
      action('carry', cm.playerId, null, 'carry'),
      action('pass', cm.playerId, st.playerId, 'completed', 0.3, 0.5),
    ], geometry)!;

    expect(plan.steps.map((step) => step.kind)).toEqual(['carry', 'pass']);
    expect(plan.steps[0]!.playerId).toBe(cm.playerId);
    expect(plan.steps[1]!.playerId).toBe(cm.playerId);
    expect(plan.steps[1]!.targetPlayerId).toBe(st.playerId);
    // The outcome is the model's, carried through unchanged.
    expect(plan.steps[1]!.outcome).toBe('completed');

    // A timeline that names nobody on the pitch has nothing to play.
    expect(buildPossessionPlan('home', [], geometry)).toBeNull();
  });
});

describe('a continuous carry', () => {
  it('has the carrier in possession, and opens a timed action', () => {
    const { match, env } = staged('possession-carry');
    const spatial = match.spatial!;
    const { cm } = homePlayers(match);

    giveBallTo(spatial, cm.playerId);
    const plan = installPossessionPlan(match, env, 'home', [action('carry', cm.playerId, null, 'carry', 0.85, 0.5)]);
    expect(plan).not.toBeNull();

    // The authoritative state: the ball is his, it is at his feet, and he is
    // carrying it — with a beginning and an end on the action.
    expect(spatial.ball.ownerId).toBe(cm.playerId);
    expect(spatial.ball.status).toBe('controlled');
    expect(spatial.ball.x).toBeCloseTo(cm.x, 6);
    expect(spatial.ball.y).toBeCloseTo(cm.y, 6);
    expect(spatial.actions.some((entry) => entry.kind === 'carry' && entry.playerId === cm.playerId)).toBe(true);
    expect(cm.actionKind).toBe('carry');
    expect(cm.actionStartedAt).not.toBeNull();
    expect(cm.actionEndsAt!).toBeGreaterThan(cm.actionStartedAt!);

    // One step of football, and the state says where he is going: the model's
    // own decision, clamped to the pitch.
    stepSpatial(match, env, SPATIAL_STEP_SECONDS);
    expect(cm.tx).toBeCloseTo(0.85, 6);
  });

  it('moves the carrier over time, with the ball attached to him', () => {
    const { match, env } = staged('possession-carry-move');
    const spatial = match.spatial!;
    const { cm } = homePlayers(match);

    giveBallTo(spatial, cm.playerId);
    installPossessionPlan(match, env, 'home', [action('carry', cm.playerId, null, 'carry', 0.9, 0.5)]);
    const startX = cm.x;

    for (let i = 0; i < 8; i += 1) {
      const before = { x: cm.x, y: cm.y };
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      // Nobody teleports: one step is bounded by his own legs.
      expect(Math.hypot(cm.x - before.x, cm.y - before.y)).toBeLessThanOrEqual(cm.speed * SPATIAL_STEP_SECONDS + 1e-9);
      // The ball is control-linked to the carrier, every step of the way.
      expect(spatial.ball.ownerId).toBe(cm.playerId);
      expect(spatial.ball.x).toBeCloseTo(cm.x, 6);
      expect(spatial.ball.y).toBeCloseTo(cm.y, 6);
    }

    // He went forward, rather than being placed there.
    expect(cm.x).toBeGreaterThan(startX);
  });
});

describe('a complete chain: carry, pass, receive', () => {
  it('plays the whole sequence out and hands the ball to the receiver', () => {
    const { match, env } = staged('possession-chain');
    const spatial = match.spatial!;
    const { cm, st } = homePlayers(match);

    giveBallTo(spatial, cm.playerId);
    // The receiver is heading somewhere, so the pass can be led into his run —
    // which is what gives him something to move onto rather than a ball landing
    // on his toes.
    st.tx = Math.min(0.95, st.x + 0.05);
    st.ty = st.y;

    const plan = installPossessionPlan(match, env, 'home', [
      action('carry', cm.playerId, null, 'carry', 0.75, 0.5),
      action('pass', cm.playerId, st.playerId, 'completed'),
    ]);
    expect(plan).not.toBeNull();
    expect(spatial.ball.ownerId).toBe(cm.playerId);

    const carryStartX = cm.x;
    const receiverStart = { x: st.x, y: st.y };
    let sawPass = false;
    let receiverMovedDuringPass = false;

    for (let i = 0; i < 4000; i += 1) {
      const stBefore = { x: st.x, y: st.y };
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      // The receiver never teleports to the ball.
      expect(Math.hypot(st.x - stBefore.x, st.y - stBefore.y)).toBeLessThanOrEqual(
        st.speed * SPATIAL_STEP_SECONDS + 1e-9,
      );

      if (spatial.ball.status === 'travelling' && spatial.ball.targetId === st.playerId) {
        sawPass = true;
        // The passer has let it go, and it belongs to nobody while it travels.
        expect(spatial.ball.ownerId).toBeNull();
        if (Math.hypot(st.x - stBefore.x, st.y - stBefore.y) > 0) receiverMovedDuringPass = true;
      }

      if (!spatial.plan && spatial.ball.status !== 'travelling') break;
    }

    // Every part of the sequence actually happened.
    expect(sawPass).toBe(true);
    expect(receiverMovedDuringPass).toBe(true);
    expect(cm.x).toBeGreaterThan(carryStartX);
    expect(Math.hypot(st.x - receiverStart.x, st.y - receiverStart.y)).toBeGreaterThan(0);

    // And it ends the way it should: the chain is over, and the receiver is the
    // new carrier — the ball is at his feet.
    expect(spatial.plan).toBeNull();
    expect(spatial.ball.ownerId).toBe(st.playerId);
    expect(spatial.ball.status).toBe('controlled');
    expect(spatial.ball.x).toBeCloseTo(st.x, 6);
  });

  it('lets the next action be selected from the updated state', () => {
    const { match, env } = staged('possession-next');
    const spatial = match.spatial!;
    const { cm, st } = homePlayers(match);

    giveBallTo(spatial, cm.playerId);
    installPossessionPlan(match, env, 'home', [action('pass', cm.playerId, st.playerId, 'completed')]);
    for (let i = 0; i < 2000 && (spatial.plan || spatial.ball.status === 'travelling'); i += 1) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
    }
    expect(spatial.ball.ownerId).toBe(st.playerId);

    // The new carrier can carry, because the state it is read from is current.
    const again = installPossessionPlan(match, env, 'home', [action('carry', st.playerId, null, 'carry', 0.9, 0.5)]);
    expect(again).not.toBeNull();
    expect(spatial.actions.some((entry) => entry.kind === 'carry' && entry.playerId === st.playerId)).toBe(true);
  });

  it('does not touch the match record: the decisions were made before the picture moved', () => {
    const { match, env } = staged('possession-record');
    const spatial = match.spatial!;
    const { cm, st } = homePlayers(match);
    const before = JSON.stringify({ events: match.events, result: match.result, score: currentScore(match) });

    giveBallTo(spatial, cm.playerId);
    installPossessionPlan(match, env, 'home', [
      action('carry', cm.playerId, null, 'carry', 0.75, 0.5),
      action('pass', cm.playerId, st.playerId, 'completed'),
    ]);
    for (let i = 0; i < 2000 && (spatial.plan || spatial.ball.status === 'travelling'); i += 1) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
    }

    expect(JSON.stringify({ events: match.events, result: match.result, score: currentScore(match) })).toBe(before);
  });
});

describe('time, not frames', () => {
  function ready(seed: string) {
    const { match, env } = staged(seed);
    const spatial = match.spatial!;
    const { cm, st } = homePlayers(match);
    giveBallTo(spatial, cm.playerId);
    installPossessionPlan(match, env, 'home', [
      action('carry', cm.playerId, null, 'carry', 0.8, 0.5),
      action('pass', cm.playerId, st.playerId, 'completed'),
    ]);
    return { match, env, spatial };
  }

  it('produces the same football whether it arrives as big frames or small ones', () => {
    const a = ready('possession-frames');
    const b = ready('possession-frames');

    // One second of football, delivered thirty small frames and one big one. The
    // same second is worth the same fixed steps either way.
    for (let i = 0; i < 30; i += 1) advanceSpatial(a.match, a.env, SPATIAL_STEP_SECONDS);
    advanceSpatial(b.match, b.env, SPATIAL_STEP_SECONDS * 30);

    expect(snapshot(b.match)).toBe(snapshot(a.match));
  });

  it('spends its time in whole steps, carrying the remainder rather than dropping it', () => {
    const { match, env, spatial } = ready('possession-remainder');
    // A ragged frame: part of a step is kept, not thrown away.
    advanceSpatial(match, env, SPATIAL_STEP_SECONDS * 2.5);
    const steps = Math.round((spatial.clock / SPATIAL_STEP_SECONDS) * 1e6) / 1e6;
    expect(steps).toBe(2);
    expect(spatial.clock).toBeCloseTo(SPATIAL_STEP_SECONDS * 2, 6);
  });

  it('is not moved by the presentation speed: the football belongs to the engine', () => {
    const { state } = createTestGame('possession-speed');
    const original = userMatch(state);
    const fast = cloneMatch(original);
    const slow = cloneMatch(original);
    const fastEnv = matchEnvironment(state, fast, { autoManageAllBenches: true });
    const slowEnv = matchEnvironment(state, slow, { autoManageAllBenches: true });

    for (let minute = 0; minute < 12; minute += 1) {
      advanceMinute(fast, fastEnv);
      advanceMinute(slow, slowEnv);
      // Fast: the minute's movement spent in one go, as 8x would.
      advanceSpatial(fast, fastEnv, SPATIAL_SECONDS_PER_MINUTE);
      // Slow: the same movement dribbled out frame by frame.
      for (let frame = 0; frame < 20; frame += 1) advanceSpatial(slow, slowEnv, SPATIAL_SECONDS_PER_MINUTE / 20);
    }

    // How the picture was fed cannot touch a single result.
    expect(currentScore(fast)).toEqual(currentScore(slow));
    expect(fast.events.map((event) => event.text)).toEqual(slow.events.map((event) => event.text));
  });
});

describe('a minute of several possessions', () => {
  it('plays each chain in turn, in the order the model played it', () => {
    const { match, env } = staged('possession-chains');
    const spatial = match.spatial!;
    const { cm, st } = homePlayers(match);
    const awayCm = spatial.players.find((node) => node.side === 'away' && node.position === 'CM')!;
    const awaySt = spatial.players.find((node) => node.side === 'away' && node.position === 'ST')!;

    giveBallTo(spatial, cm.playerId);
    const installed = installPossessionChains(match, env, [
      {
        side: 'home',
        seconds: 5,
        receivers: [st.playerId],
        actions: [
          action('carry', cm.playerId, null, 'carry', 0.78, 0.5),
          action('pass', cm.playerId, st.playerId, 'completed'),
        ],
        goal: false,
      },
      {
        side: 'away',
        seconds: 5,
        receivers: [awaySt.playerId],
        actions: [
          action('carry', awayCm.playerId, null, 'carry', 0.22, 0.5, 'away'),
          action('pass', awayCm.playerId, awaySt.playerId, 'completed', 0.7, 0.5, 'away'),
        ],
        goal: false,
      },
    ]);

    expect(installed).not.toBeNull();
    // The first chain is on the pitch; the second is waiting its turn.
    expect(spatial.plan).toBe(installed);
    expect(spatial.pending).toHaveLength(1);

    let sawHomeReceiver = -1;
    let sawAwayCarrier = -1;
    for (let i = 0; i < 6000 && (spatial.plan || spatial.ball.status === 'travelling'); i += 1) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      // A reception hands the ball over inside the step, and the next chain can
      // start gathering it in the very same one — so what is observed is the
      // touch the state remembers, not a single step's owner.
      const touch = spatial.ball.lastTouchId;
      if (touch === st.playerId && sawHomeReceiver < 0) sawHomeReceiver = i;
      if (touch === awayCm.playerId && sawAwayCarrier < 0) sawAwayCarrier = i;
    }

    // Both chains were played, and the home one first: the second only begins
    // once the first is over, however short the first was.
    expect(sawHomeReceiver).toBeGreaterThanOrEqual(0);
    expect(sawAwayCarrier).toBeGreaterThan(sawHomeReceiver);
    // And the minute is drained: no chain left over, the ball with the last
    // chain's receiver.
    expect(spatial.plan).toBeNull();
    expect(spatial.pending ?? []).toHaveLength(0);
    expect(spatial.ball.ownerId).toBe(awaySt.playerId);
  });
});
