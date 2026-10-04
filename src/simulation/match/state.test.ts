import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { MatchAction, MatchState } from '@/domain/matchState';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { advanceMinute } from './engine';
import { cloneMatch } from './testHelpers';
import { SPATIAL_STEP_SECONDS, advanceSpatial, ensureSpatial, stepSpatial } from './spatial';
import {
  SIMULATION_STEP_SECONDS,
  actionProgress,
  advanceSimulationSteps,
  beginAction,
  clearActions,
  resolveAction,
  resolveDueActions,
  simulationAlpha,
} from './state';

/**
 * The continuous match-state contract.
 *
 * Two things are being pinned here. First, the clock: simulation time advances
 * in fixed steps whatever the frame rate, because that is the only reason the
 * same match can be replayed identically on two machines. Second, the action:
 * something a player does is a thing with a beginning, a duration and a
 * resolution, not an instant that a renderer has to reconstruct afterwards.
 * Neither of these can change the football, and a test that let them would be
 * testing the wrong layer.
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

/** A contract state with no football in it, for testing the mechanics alone. */
function bareState(): MatchState {
  return {
    clock: 0,
    stepSeconds: SIMULATION_STEP_SECONDS,
    residual: 0,
    players: [
      {
        playerId: 'p1',
        side: 'home',
        position: 'CM',
        baseX: 0.5,
        baseY: 0.5,
        x: 0.5,
        y: 0.5,
        px: 0.5,
        py: 0.5,
        tx: 0.5,
        ty: 0.5,
        speed: 0.02,
        vx: 0,
        vy: 0,
        action: 'shape',
        actionKind: null,
        actionStartedAt: null,
        actionEndsAt: null,
        possession: false,
      },
    ],
    ball: {
      x: 0.5,
      y: 0.5,
      px: 0.5,
      py: 0.5,
      status: 'loose',
      ownerId: null,
      targetId: null,
      tx: 0.5,
      ty: 0.5,
      speed: 0,
      height: 0,
      touchedAt: 0,
      lastTouchId: null,
    },
    actions: [],
    context: { possession: null, phase: 'kickoff', eventCount: 0 },
  };
}

describe('the simulation clock', () => {
  it('turns real time into whole steps and carries the remainder', () => {
    const state = bareState();
    const plan = advanceSimulationSteps(state, 0.1);

    expect(plan.steps).toBe(3);
    expect(plan.spent).toBeCloseTo(0.1, 10);
    // The leftover is a fraction of a step, never a whole one.
    expect(state.residual).toBeGreaterThanOrEqual(0);
    expect(state.residual).toBeLessThan(state.stepSeconds);
    expect(simulationAlpha(state)).toBeCloseTo(state.residual / state.stepSeconds, 10);
  });

  it('takes the same number of steps however the frames are delivered', () => {
    const fine = bareState();
    const coarse = bareState();
    for (let i = 0; i < 100; i += 1) advanceSimulationSteps(fine, 0.01);
    for (let i = 0; i < 10; i += 1) advanceSimulationSteps(coarse, 0.1);

    // Both spent exactly one second of football, in the same number of steps.
    expect(fine.residual).toBeCloseTo(coarse.residual, 10);
    expect(simulationAlpha(fine)).toBeCloseTo(simulationAlpha(coarse), 10);
  });

  it('caps a frame rather than replaying minutes nobody watched', () => {
    const state = bareState();
    const plan = advanceSimulationSteps(state, 600, { maxCatchUpSeconds: 9 });
    expect(plan.spent).toBeLessThanOrEqual(9 + 1e-9);
    expect(state.residual).toBeLessThan(state.stepSeconds);
  });

  it('honours a hard step ceiling, and ignores time that is not there', () => {
    const state = bareState();
    const capped = advanceSimulationSteps(state, 5, { maxSteps: 10 });
    expect(capped.steps).toBe(10);

    expect(advanceSimulationSteps(bareState(), 0).steps).toBe(0);
    expect(advanceSimulationSteps(bareState(), -1).steps).toBe(0);
  });
});

describe('a timed action', () => {
  it('begins at the simulation time, with a duration and a target', () => {
    const state = bareState();
    state.clock = 12.5;
    const action = beginAction(state, { kind: 'pass', playerId: 'p1', targetPlayerId: 'p2', duration: 3 });

    expect(action.startedAt).toBe(12.5);
    expect(action.duration).toBe(3);
    expect(action.status).toBe('active');
    expect(action.targetPlayerId).toBe('p2');
    expect(state.actions).toContain(action);
    expect(actionProgress(action, 12.5)).toBe(0);
    expect(actionProgress(action, 14)).toBeCloseTo(0.5, 10);
    expect(actionProgress(action, 99)).toBe(1);
  });

  it('keeps the player\u2019s own action fields in step with the authoritative list', () => {
    const state = bareState();
    const action = beginAction(state, { kind: 'carry', playerId: 'p1', duration: 4 });

    expect(state.players[0]!.actionKind).toBe('carry');
    expect(state.players[0]!.actionStartedAt).toBe(0);
    expect(state.players[0]!.actionEndsAt).toBe(4);

    resolveAction(state, action);
    expect(state.actions).toHaveLength(0);
    expect(state.players[0]!.actionKind).toBeNull();
    expect(state.players[0]!.actionEndsAt).toBeNull();
  });

  it('records what it came to when it resolves, and leaves the active list', () => {
    const state = bareState();
    const action = beginAction(state, { kind: 'shot', playerId: 'p1', duration: 2 });
    const resolved = resolveAction(state, action, 'goal');

    expect(resolved.status).toBe('resolved');
    expect(resolved.outcome).toBe('goal');
    expect(state.actions).toHaveLength(0);
  });

  it('resolves only the actions whose time is up', () => {
    const state = bareState();
    const early = beginAction(state, { kind: 'carry', playerId: 'p1', duration: 1 });
    state.actions.push({
      ...early,
      id: 'late',
      kind: 'pass',
      startedAt: 0,
      duration: 5,
    });
    state.clock = 2;

    const due = resolveDueActions(state, (action) => (action.kind === 'carry' ? 'completed' : null));
    expect(due).toHaveLength(1);
    expect(due[0]!.outcome).toBe('completed');
    expect(state.actions.map((action) => action.id)).toEqual(['late']);
  });

  it('cancels everything when a new minute takes the pitch', () => {
    const state = bareState();
    beginAction(state, { kind: 'carry', playerId: 'p1', duration: 4 });
    beginAction(state, { kind: 'shot', playerId: 'p1', duration: 2 });
    clearActions(state);

    expect(state.actions).toHaveLength(0);
    expect(state.players[0]!.actionKind).toBeNull();
  });

  it('gives two actions at the same instant distinct ids', () => {
    const state = bareState();
    const a = beginAction(state, { kind: 'carry', playerId: 'p1', duration: 1 });
    const b = beginAction(state, { kind: 'carry', playerId: 'p1', duration: 1 });
    expect(a.id).not.toBe(b.id);
  });
});

describe('the contract on the pitch', () => {
  it('gives a fresh spatial state the whole contract', () => {
    const { match, env } = staged('state-shape');
    const spatial = ensureSpatial(match, env);

    expect(spatial.stepSeconds).toBe(SIMULATION_STEP_SECONDS);
    expect(Array.isArray(spatial.actions)).toBe(true);
    expect(spatial.context.phase).toBe('kickoff');
    expect(spatial.context.eventCount).toBe(match.events.length);
    expect(spatial.players.every((node) => typeof node.possession === 'boolean')).toBe(true);
    expect(spatial.players.every((node) => node.actionKind === null)).toBe(true);
    expect(spatial.ball.touchedAt).toBe(0);
    expect(spatial.ball.lastTouchId).toBeNull();
  });

  it('grows the contract onto a state written before it existed', () => {
    const { match, env } = staged('state-normalise');
    const spatial = ensureSpatial(match, env);

    // Strip exactly the fields a v9 save would not have had.
    const legacy = JSON.parse(JSON.stringify(spatial)) as Record<string, unknown>;
    delete legacy.stepSeconds;
    delete legacy.actions;
    delete legacy.context;
    for (const node of legacy.players as Array<Record<string, unknown>>) {
      delete node.actionKind;
      delete node.actionStartedAt;
      delete node.actionEndsAt;
      delete node.possession;
    }
    const legacyBall = legacy.ball as Record<string, unknown>;
    delete legacyBall.touchedAt;
    delete legacyBall.lastTouchId;
    match.spatial = legacy as never;

    const revived = ensureSpatial(match, env);
    expect(revived.stepSeconds).toBe(SIMULATION_STEP_SECONDS);
    expect(revived.actions).toEqual([]);
    expect(revived.context).toBeTruthy();
    expect(revived.players.every((node) => typeof node.possession === 'boolean')).toBe(true);
    expect(revived.ball.touchedAt).toBe(0);
  });

  it('reads possession, phase and the event cursor from one place', () => {
    const { match, env } = staged('state-context');
    const spatial = ensureSpatial(match, env);
    advanceMinute(match, env);
    stepSpatial(match, env, SPATIAL_STEP_SECONDS);

    const owner = spatial.ball.ownerId;
    const ownerSide = owner ? spatial.players.find((node) => node.playerId === owner)?.side ?? null : null;
    expect(spatial.context.possession).toBe(ownerSide);
    expect(spatial.context.eventCount).toBe(match.events.length);
    expect(spatial.players.every((node) => node.possession === (node.playerId === owner))).toBe(true);
  });

  it('records the move as timed actions, and resolves them as it is played', () => {
    const { state } = createTestGame('state-actions');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    match.spatial = undefined;
    advanceMinute(match, env); // kick-off, which puts the pitch in place
    const spatial = match.spatial!;

    const seen = new Map<string, MatchAction>();
    let resolvedAtLeastOne = false;

    outer: for (let minute = 0; minute < 20; minute += 1) {
      if (minute > 0) advanceMinute(match, env);
      for (let step = 0; step < 240; step += 1) {
        const before = new Set(spatial.actions.map((action) => action.id));
        stepSpatial(match, env, SPATIAL_STEP_SECONDS);
        for (const action of spatial.actions) seen.set(action.id, action);
        const after = new Set(spatial.actions.map((action) => action.id));
        for (const id of before) if (!after.has(id)) resolvedAtLeastOne = true;
        if (match.status === 'finished') break outer;
      }
      if (seen.size > 0 && resolvedAtLeastOne) break;
    }

    expect(seen.size).toBeGreaterThan(0);
    const actions = [...seen.values()];
    // Only the actions the present simulation actually plays out are produced.
    expect(actions.every((action) => ['carry', 'pass', 'shot'].includes(action.kind))).toBe(true);
    expect(actions.every((action) => action.duration > 0)).toBe(true);
    expect(actions.every((action) => action.playerId !== null)).toBe(true);
    // A pass names the man it was played to.
    expect(actions.filter((action) => action.kind === 'pass').every((action) => action.targetPlayerId !== null)).toBe(true);
    expect(resolvedAtLeastOne).toBe(true);
  });

  it('produces the same football however the frames are delivered', () => {
    const a = staged('state-frames');
    ensureSpatial(a.match, a.env);
    advanceMinute(a.match, a.env);

    const b = staged('state-frames');
    ensureSpatial(b.match, b.env);
    advanceMinute(b.match, b.env);

    // The same two seconds of football, as small frames and as big ones.
    for (let i = 0; i < 200; i += 1) advanceSpatial(a.match, a.env, 0.01);
    for (let i = 0; i < 20; i += 1) advanceSpatial(b.match, b.env, 0.1);

    expect(a.match.spatial!.clock).toBeCloseTo(b.match.spatial!.clock, 6);
    expect(a.match.spatial!.ball).toEqual(b.match.spatial!.ball);
    expect(a.match.spatial!.players.map((node) => [node.x, node.y, node.px, node.py])).toEqual(
      b.match.spatial!.players.map((node) => [node.x, node.y, node.px, node.py]),
    );
  });
});
