import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { PlayerId } from '@/domain/ids';
import { Rng } from '../rng';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { cloneMatch } from './testHelpers';
import { SPATIAL_STEP_SECONDS, ensureSpatial, giveBallTo, installPossessionPlan, planPassage, stepSpatial } from './spatial';
import { advanceMovement, type MovementState } from './state';
import type { TimelineAction } from './actionTimeline';

/**
 * The continuous loop.
 *
 * These pin the football actually moving rather than a summary of it being
 * replayed: a player accelerates with legs rather than teleporting, a pass
 * travels to its man or dies where the simulation said it would, a carrier who
 * is dispossessed loses the ball where he stands — and none of it may change an
 * outcome, only show it.
 *
 * Everything here runs on the one path there is. The old post-hoc passage used
 * to be executed beside the plan; that executor is gone, and a passage is now
 * only the narrator's description of the move.
 */

function userMatch(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function staged(seed: string): { match: Match; env: ReturnType<typeof matchEnvironment> } {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  return { match, env };
}

function action(
  kind: TimelineAction['kind'],
  playerId: PlayerId,
  targetPlayerId: PlayerId | null,
  outcome: TimelineAction['outcome'],
): TimelineAction {
  return {
    kind,
    decision: kind,
    side: 'home',
    playerId,
    targetPlayerId,
    fromX: 0.5,
    fromY: 0.5,
    toX: 0.5,
    toY: 0.5,
    startSecond: 0,
    duration: 3,
    outcome,
  };
}

function homePlayer(match: Match, position: string) {
  const players = match.spatial!.players;
  // The role is a preference, not a guarantee: a squad short of a position
  // still has to be able to be tested, so anything but the keeper will do.
  return (
    players.find((node) => node.side === 'home' && node.position === position) ??
    players.find((node) => node.side === 'home' && node.position !== 'GK')!
  );
}

describe('a player moves with legs', () => {
  it('accelerates from a standstill rather than starting at full pace', () => {
    const mover: MovementState = { x: 0.5, y: 0.5, tx: 0.9, ty: 0.5, speed: 0.036, vx: 0, vy: 0 };
    advanceMovement(mover, SPATIAL_STEP_SECONDS);
    const moved = Math.hypot(mover.x - 0.5, mover.y - 0.5);
    expect(moved).toBeGreaterThan(0);
    // A step from rest cannot be a full-speed step.
    expect(moved).toBeLessThan(mover.speed * SPATIAL_STEP_SECONDS);
  });

  it('reaches top speed and never exceeds it', () => {
    const mover: MovementState = { x: 0.05, y: 0.5, tx: 0.95, ty: 0.5, speed: 0.036, vx: 0, vy: 0 };
    for (let i = 0; i < 300; i += 1) advanceMovement(mover, SPATIAL_STEP_SECONDS);
    expect(Math.hypot(mover.vx, mover.vy)).toBeLessThanOrEqual(mover.speed + 1e-9);
    // It got up to pace rather than crawling.
    expect(Math.hypot(mover.vx, mover.vy)).toBeGreaterThan(mover.speed * 0.8);
  });

  it('decelerates to a stop when there is nowhere to go', () => {
    const mover: MovementState = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, speed: 0.036, vx: 0.03, vy: 0 };
    for (let i = 0; i < 60; i += 1) advanceMovement(mover, SPATIAL_STEP_SECONDS);
    expect(Math.hypot(mover.vx, mover.vy)).toBeCloseTo(0, 6);
  });

  it('turns rather than changing direction on the spot', () => {
    const mover: MovementState = { x: 0.5, y: 0.5, tx: 0.9, ty: 0.5, speed: 0.036, vx: 0, vy: 0 };
    for (let i = 0; i < 120; i += 1) advanceMovement(mover, SPATIAL_STEP_SECONDS);
    const forward = mover.vx;
    expect(forward).toBeGreaterThan(0);
    // Now send him the other way: his velocity has to swing through zero.
    mover.tx = 0.1;
    advanceMovement(mover, SPATIAL_STEP_SECONDS);
    expect(mover.vx).toBeLessThan(forward);
  });
});

describe('a passage is a description, not a plan', () => {
  it('projects the simulation\u2019s own actions into the move the narrator reads', () => {
    const { match, env } = staged('continuous-project');
    const cm = homePlayer(match, 'CM');
    const st = homePlayer(match, 'ST');

    const actions = [action('carry', cm.playerId, null, 'carry'), action('pass', cm.playerId, st.playerId, 'completed')];
    const passage = planPassage(match, env, 'home', [], [], new Rng('project'), actions);

    expect(passage.steps.map((step) => step.kind)).toEqual(['carry', 'pass']);
    expect(passage.steps[0]!.playerId).toBe(cm.playerId);
    expect(passage.steps[1]!.playerId).toBe(cm.playerId);
    expect(passage.steps[1]!.targetId).toBe(st.playerId);
    // Every step knows whose move it is, so a minute that changed hands is told
    // about the right side line by line.
    expect(passage.steps.every((step) => step.side === 'home')).toBe(true);
  });
});

describe('possession changes in space', () => {
  it('does not reach a man the simulation said the pass missed', () => {
    const { match, env } = staged('continuous-incomplete');
    const spatial = match.spatial!;
    const cm = homePlayer(match, 'CM');
    const st = homePlayer(match, 'ST');

    giveBallTo(spatial, cm.playerId);
    installPossessionPlan(match, env, 'home', [action('pass', cm.playerId, st.playerId, 'incomplete')]);

    let guard = 0;
    while ((spatial.plan || spatial.ball.status === 'travelling') && guard < 1800) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      guard += 1;
    }

    // The ball died short of him: it is loose, or at the feet of whoever read it.
    expect(spatial.ball.ownerId).not.toBe(st.playerId);
  });

  it('ends the move when the carrier is dispossessed, and the ball goes to a defender', () => {
    const { match, env } = staged('continuous-turnover');
    const spatial = match.spatial!;
    const cm = homePlayer(match, 'CM');
    const away = new Set(spatial.players.filter((node) => node.side === 'away').map((node) => node.playerId));

    giveBallTo(spatial, cm.playerId);
    installPossessionPlan(match, env, 'home', [action('carry', cm.playerId, null, 'turnover')]);

    let guard = 0;
    while ((spatial.plan || spatial.ball.status === 'travelling') && guard < 1800) {
      stepSpatial(match, env, SPATIAL_STEP_SECONDS);
      guard += 1;
    }

    // The move is over and the ball is no longer his: it was put on its way to
    // the man who won it, and left loose at his feet.
    expect(spatial.plan).toBeNull();
    expect(spatial.ball.ownerId).not.toBe(cm.playerId);
    expect(spatial.ball.ownerId === null || away.has(spatial.ball.ownerId)).toBe(true);
  });

  it('keeps the ball with the carrier while he carries it', () => {
    const { match, env } = staged('continuous-carry');
    const spatial = match.spatial!;
    const cm = homePlayer(match, 'CM');

    giveBallTo(spatial, cm.playerId);
    installPossessionPlan(match, env, 'home', [action('carry', cm.playerId, null, 'carry')]);
    for (let i = 0; i < 10; i += 1) stepSpatial(match, env, SPATIAL_STEP_SECONDS);

    expect(spatial.ball.ownerId).toBe(cm.playerId);
    expect(spatial.ball.x).toBeCloseTo(cm.x, 6);
    expect(spatial.ball.y).toBeCloseTo(cm.y, 6);
    // And it is a timed action, with a beginning and an end.
    expect(cm.actionKind).toBe('carry');
    expect(cm.actionStartedAt).not.toBeNull();
    expect(cm.actionEndsAt!).toBeGreaterThan(cm.actionStartedAt!);
  });
});

describe('goalkeepers are part of the football', () => {
  it('goes for a ball travelling at his goal', () => {
    const { match, env } = staged('continuous-keeper');
    const spatial = match.spatial!;
    const keeper = spatial.players.find((node) => node.side === 'away' && node.position === 'GK')!;

    // A ball on its way to the away goal.
    spatial.ball.x = 0.6;
    spatial.ball.y = 0.5;
    spatial.ball.px = 0.6;
    spatial.ball.py = 0.5;
    spatial.ball.tx = 0.995;
    spatial.ball.ty = 0.4;
    spatial.ball.status = 'travelling';
    spatial.ball.ownerId = null;
    spatial.ball.targetId = null;
    spatial.ball.speed = 0.7;

    stepSpatial(match, env, SPATIAL_STEP_SECONDS);

    // He has left his line for the ball, rather than standing and watching.
    expect(keeper.tx).toBeGreaterThan(0.9);
    expect(Math.abs(keeper.ty - 0.4)).toBeLessThan(0.2);
  });
});
