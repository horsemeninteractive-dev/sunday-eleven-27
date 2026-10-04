import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import type { GameState } from '@/domain/game';
import type { PlayerId } from '@/domain/ids';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { SPATIAL_STEP_SECONDS, advanceSpatial, ensureSpatial, spatialAlpha } from '@/simulation/match/spatial';
import { DEFAULT_PREFERENCES } from '@/state/preferences';
import {
  buildMatchRenderState,
  facingRadians,
  interpolatedX,
  interpolatedY,
  involvementOf,
} from './matchPresentation';
import { MATCH_RENDERERS, resolveRenderer } from './matchRenderers';
import { incidentTone, incidentsOf, latestIncident, newIncidents, signalOfAction, signalOfEvent } from './matchSignals';
import type { MatchEvent, MatchEventType } from '@/domain/match';

/**
 * The renderer contract.
 *
 * The point of this seam is that the same football can be drawn two ways — and
 * that choosing a way is a paint, never a replay. These tests pin the parts that
 * make that true: the renderer only ever *reads* the authoritative state, the
 * state it is handed is the same object the simulation advances, interpolation
 * is shared rather than reinvented per renderer, a chosen-but-unbuilt renderer
 * falls back cleanly, and the signals describe the football rather than the
 * drawing.
 */

function staged(seed: string): { state: GameState; match: Match; env: ReturnType<typeof matchEnvironment> } {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match = cloneMatch(state.matches[fixture.id]!);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  return { state, match, env };
}

/** A stable, comparable picture of the football, renderer-independent. */
function snapshot(match: Match): string {
  const spatial = match.spatial!;
  return JSON.stringify({
    clock: spatial.clock,
    residual: spatial.residual,
    possession: spatial.context.possession,
    phase: spatial.context.phase,
    ball: spatial.ball,
    players: spatial.players.map((node) => ({
      id: node.playerId,
      x: node.x,
      y: node.y,
      px: node.px,
      py: node.py,
      vx: node.vx,
      vy: node.vy,
      action: node.action,
      possession: node.possession,
    })),
    events: match.events.length,
    result: match.result,
    commentary: match.commentary?.length ?? 0,
  });
}

describe('the renderer registry', () => {
  it('mounts the 2D pitch for the default preference', () => {
    const definition = resolveRenderer(DEFAULT_PREFERENCES.renderer);
    expect(definition.kind).toBe('2d');
    expect(definition.available).toBe(true);
    expect(definition.Component).toBeTruthy();
  });

  it('falls back to 2D for a renderer that is not built yet', () => {
    expect(MATCH_RENDERERS['3d'].available).toBe(false);
    const resolved = resolveRenderer('3d');
    expect(resolved.kind).toBe('2d');
    expect(resolved.Component).toBe(MATCH_RENDERERS['2d'].Component);
  });
});

describe('the render state', () => {
  it('is a window onto the simulation, not a copy of it', () => {
    const { state, match } = staged('render-window');
    const spatial = match.spatial!;
    const render = buildMatchRenderState(match, state);
    expect(render.continuous).toBe(true);
    expect(render.players).toBe(spatial.players);
    expect(render.ball).toBe(spatial.ball);
    expect(render.actions).toBe(spatial.actions);
    expect(render.players).toHaveLength(22);
  });

  it('reports the clock, context and revision the simulation holds', () => {
    const { state, match } = staged('render-readings');
    const spatial = match.spatial!;
    const render = buildMatchRenderState(match, state);
    expect(render.clock).toBe(spatial.clock);
    expect(render.possession).toBe(spatial.context.possession);
    expect(render.phase).toBe(spatial.context.phase);
    expect(render.revision).toBe(match.events.length);
    expect(render.alpha()).toBeCloseTo(spatialAlpha(spatial), 10);
  });

  it('describes both teams, with their own colours', () => {
    const { state, match } = staged('render-teams');
    const render = buildMatchRenderState(match, state);
    expect(render.teams.home.clubId).toBe(match.homeClubId);
    expect(render.teams.away.clubId).toBe(match.awayClubId);
    expect(render.teams.home.colours).toEqual(state.clubs[match.homeClubId]!.identity.colours);
    expect(render.teams.away.colours).toEqual(state.clubs[match.awayClubId]!.identity.colours);
  });

  it('lays the teams out from their formation when there is no continuous state', () => {
    const { state, match } = staged('render-fallback');
    match.spatial = undefined;
    const render = buildMatchRenderState(match, state);
    expect(render.continuous).toBe(false);
    expect(render.players).toHaveLength(22);
    expect(render.ball).toBeTruthy();
    // Nothing to interpolate between, so the fraction is a standing still one.
    expect(render.alpha()).toBe(0);
  });

  it('does not change the football by being read', () => {
    const { state, match } = staged('render-pure');
    const before = snapshot(match);
    buildMatchRenderState(match, state);
    involvementOf(buildMatchRenderState(match, state));
    expect(snapshot(match)).toBe(before);
  });
});

describe('shared interpolation', () => {
  it('draws between the step a thing was at and the step it is at', () => {
    const sample = { px: 0.2, x: 0.6 };
    expect(interpolatedX(sample, 0)).toBeCloseTo(0.2, 10);
    expect(interpolatedX(sample, 1)).toBeCloseTo(0.6, 10);
    expect(interpolatedX(sample, 0.25)).toBeCloseTo(0.3, 10);
    const vertical = { py: 0.9, y: 0.1 };
    expect(interpolatedY(vertical, 0.5)).toBeCloseTo(0.5, 10);
  });

  it('reads orientation from the velocity the simulation owns', () => {
    expect(facingRadians(1, 0)).toBeCloseTo(0, 10);
    expect(facingRadians(0, 1)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('involvement', () => {
  it('picks out the carrier from the authoritative ball', () => {
    const { state, match } = staged('render-involvement');
    const spatial = match.spatial!;
    const carrier = spatial.players.find((node) => node.side === 'home')!;
    spatial.ball.ownerId = carrier.playerId;
    spatial.ball.status = 'controlled';
    spatial.context.possession = 'home';

    const involvement = involvementOf(buildMatchRenderState(match, state));
    expect(involvement.possessing).toBe('home');
    expect(involvement.carrying.has(carrier.playerId)).toBe(true);
    expect(involvement.involved.has(carrier.playerId)).toBe(true);
  });
});

describe('switching renderer changes only the paint', () => {
  it('leaves the clock, positions, possession and events exactly as they were', () => {
    const { state, match, env } = staged('render-switch');
    for (let i = 0; i < 300; i += 1) advanceSpatial(match, env, SPATIAL_STEP_SECONDS);
    const before = snapshot(match);

    // Choosing 2D, then 3D (which resolves to 2D), and reading the state for
    // each: none of it may move a single value.
    for (const kind of ['2d', '3d', '2d'] as const) {
      expect(resolveRenderer(kind).Component).toBeTruthy();
      involvementOf(buildMatchRenderState(match, state));
    }
    expect(snapshot(match)).toBe(before);
  });

  it('does not duplicate the simulation when a renderer is mounted', () => {
    const plain = staged('render-no-duplicate');
    const watched = staged('render-no-duplicate');
    for (let i = 0; i < 300; i += 1) {
      advanceSpatial(plain.match, plain.env, SPATIAL_STEP_SECONDS);
      advanceSpatial(watched.match, watched.env, SPATIAL_STEP_SECONDS);
      // The watched one is "rendered" every step; the other is not.
      involvementOf(buildMatchRenderState(watched.match, watched.state));
    }
    expect(snapshot(watched.match)).toBe(snapshot(plain.match));
  });
});

describe('the shared event stream', () => {
  it('reads an action as a beginning, and then as how it came out', () => {
    const context = { minute: 12, side: 'home' as const, x: 0.4, y: 0.5 };
    const started = signalOfAction(
      {
        id: 'a1',
        kind: 'pass',
        playerId: 'p1' as PlayerId,
        targetPlayerId: 'p2' as PlayerId,
        startedAt: 0,
        duration: 1,
        status: 'active',
        outcome: null,
      },
      context,
    );
    expect(started.kind).toBe('pass-started');
    expect(started.playerId).toBe('p1');
    expect(started.targetPlayerId).toBe('p2');

    const completed = signalOfAction(
      {
        id: 'a1',
        kind: 'pass',
        playerId: 'p1' as PlayerId,
        targetPlayerId: 'p2' as PlayerId,
        startedAt: 0,
        duration: 1,
        status: 'resolved',
        outcome: 'completed',
      },
      context,
    );
    expect(completed.kind).toBe('pass-completed');
    expect(completed.outcome).toBe('completed');
  });

  it('describes incidents in football terms, not drawing terms', () => {
    const event = matchEvent('goal');
    expect(signalOfEvent(event).kind).toBe('goal');
    expect(signalOfEvent({ ...event, type: 'yellow-card' }).kind).toBe('yellow-card');
    expect(signalOfEvent({ ...event, type: 'red-card' }).kind).toBe('red-card');
    expect(signalOfEvent({ ...event, type: 'foul' }).kind).toBe('foul');
    expect(signalOfEvent({ ...event, type: 'offside' }).kind).toBe('offside');
    expect(signalOfEvent({ ...event, type: 'shot-saved' }).kind).toBe('save');
    expect(signalOfEvent({ ...event, type: 'full-time' }).kind).toBe('period');
  });
});

/** A minimal authoritative event, for projecting into a signal. */
function matchEvent(type: MatchEventType, overrides: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: `${type}-1`,
    minute: 30,
    type,
    clubId: null,
    playerId: null,
    secondaryPlayerId: null,
    text: '',
    x: 0.9,
    y: 0.5,
    scoreAfter: { home: 0, away: 0 },
    importance: 3,
    ...overrides,
  };
}

describe('the render state carries the shared signals', () => {
  it('projects the authoritative events into the one vocabulary', () => {
    const { state, match } = staged('render-signals');
    match.events.push(matchEvent('goal', { id: 'goal-1', clubId: match.homeClubId, minute: 20 }));
    const render = buildMatchRenderState(match, state);
    expect(render.signals).toHaveLength(match.events.length);
    const newest = render.signals[render.signals.length - 1]!;
    expect(newest.kind).toBe('goal');
    expect(newest.side).toBe('home');
  });
});

describe('the replay cursor', () => {
  it('reveals only the record that has been reached', () => {
    const { state, match } = staged('render-cursor');
    match.events.push(matchEvent('goal', { id: 'goal-1', minute: 12 }));
    match.events.push(matchEvent('yellow-card', { id: 'card-1', minute: 60 }));
    match.events.push(matchEvent('goal', { id: 'goal-2', minute: 88 }));

    const render = buildMatchRenderState(match, state, {
      minute: 30,
      revealed: match.events.length - 1,
      focus: { x: 0.7, y: 0.4 },
    });

    expect(render.continuous).toBe(false);
    expect(render.signals).toHaveLength(match.events.length - 1);
    expect(render.revision).toBe(match.events.length - 1);
    expect(render.minute).toBe(30);
    expect(render.half).toBe(1);
    // The picture leans toward the moment, not the live spatial state.
    expect(render.ball.x).toBeCloseTo(0.7, 5);
    expect(render.ball.y).toBeCloseTo(0.4, 5);
    expect(render.players.length).toBeGreaterThan(0);
  });

  it('still leaves the live match alone', () => {
    const { state, match } = staged('render-cursor-live');
    const live = buildMatchRenderState(match, state);
    expect(live.continuous).toBe(true);
    expect(live.signals).toHaveLength(match.events.length);
  });
});

describe('the incident stream', () => {
  it('tones an incident semantically rather than visually', () => {
    expect(incidentTone('goal')).toBe('goal');
    expect(incidentTone('red-card')).toBe('danger');
    expect(incidentTone('yellow-card')).toBe('danger');
    expect(incidentTone('foul')).toBe('whistle');
    expect(incidentTone('offside')).toBe('whistle');
    expect(incidentTone('period')).toBeNull();
  });

  it('leaves near misses to the pitch, not the banner', () => {
    expect(incidentTone('save')).toBeNull();
    expect(incidentTone('blocked')).toBeNull();
    expect(incidentTone('off-target')).toBeNull();
    expect(latestIncident([signalOfEvent(matchEvent('shot-saved'))])).toBeNull();
  });

  it('keeps both halves of a same-minute pair, in the order they happened', () => {
    const signals = [
      signalOfEvent(matchEvent('kick-off', { id: 'ko-1', minute: 44 })),
      signalOfEvent(matchEvent('foul', { id: 'foul-1', minute: 44 })),
      signalOfEvent(matchEvent('yellow-card', { id: 'card-1', minute: 44 })),
      signalOfEvent(matchEvent('note', { id: 'note-1', minute: 44 })),
    ];
    // The banner queues these rather than replacing the foul with the card.
    expect(incidentsOf(signals).map((entry) => entry.kind)).toEqual(['foul', 'yellow-card']);
    expect(incidentsOf(signals).map((entry) => entry.id)).toEqual(['event:foul-1', 'event:card-1']);
  });

  it('puts every incident that arrives in one revision into the queue', () => {
    const foul = signalOfEvent(matchEvent('foul', { id: 'foul-3', minute: 44 }));
    const card = signalOfEvent(matchEvent('yellow-card', { id: 'card-3', minute: 44 }));
    const goal = signalOfEvent(matchEvent('goal', { id: 'goal-3', minute: 44 }));

    // Nothing seen yet: both halves of the pair, in order, plus the goal.
    expect(newIncidents(new Set(), [foul, card, goal]).map((entry) => entry.kind)).toEqual([
      'foul',
      'yellow-card',
      'goal',
    ]);
    // The foul already shown does not stall the card behind it.
    expect(newIncidents(new Set([foul.id]), [foul, card]).map((entry) => entry.id)).toEqual([card.id]);
    // Nothing new means nothing to queue.
    expect(newIncidents(new Set([foul.id, card.id]), [foul, card])).toEqual([]);
  });

  it('counts only the incidents, not the ordinary traffic', () => {
    const signals = [
      signalOfEvent(matchEvent('kick-off', { id: 'ko-2' })),
      signalOfEvent(matchEvent('shot-saved', { id: 'save-2' })),
      signalOfEvent(matchEvent('goal', { id: 'goal-2' })),
      signalOfEvent(matchEvent('full-time', { id: 'ft-2' })),
    ];
    expect(incidentsOf(signals).map((entry) => entry.kind)).toEqual(['goal']);
  });

  it('announces the newest incident and skips the ordinary traffic', () => {
    const signals = [
      signalOfEvent(matchEvent('kick-off', { id: 'ko-1' })),
      signalOfEvent(matchEvent('offside', { id: 'off-1' })),
      signalOfEvent(matchEvent('note', { id: 'note-1' })),
    ];
    expect(latestIncident(signals)?.kind).toBe('offside');
  });

  it('picks the latest when several land in the same minute', () => {
    const signals = [
      signalOfEvent(matchEvent('foul', { id: 'foul-2', minute: 44 })),
      signalOfEvent(matchEvent('yellow-card', { id: 'card-2', minute: 44 })),
      signalOfEvent(matchEvent('goal', { id: 'goal-2', minute: 44 })),
    ];
    expect(latestIncident(signals)?.kind).toBe('goal');
  });

  it('has nothing to say when nothing has happened', () => {
    expect(latestIncident([])).toBeNull();
    expect(latestIncident([signalOfEvent(matchEvent('kick-off'))])).toBeNull();
  });
});
