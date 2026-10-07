import { describe, expect, it } from 'vitest';
import type { Match, MatchEvent, MatchEventType, MatchPhase } from '@/domain/match';
import type { GameState } from '@/domain/game';
import type { PlayerId } from '@/domain/ids';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { cloneMatch } from '@/simulation/match/testHelpers';
// The simulation is reached only through its boundary, exactly as the match
// screen reaches it — see `TOUCHLINE_ARCHITECTURE.md` §"Presentation boundary".
import { createMatchEngine, simulationAlpha, type MatchEngine } from '@/simulation/touchline';
import { DEFAULT_PREFERENCES } from '@/state/preferences';
import {
  buildMatchRenderState,
  facingRadians,
  interpolatedX,
  interpolatedY,
  involvementOf,
} from './matchPresentation';
import { buildEngineRenderState } from './matchEnginePresentation';
import { MATCH_RENDERERS, resolveRenderer } from './matchRenderers';
import { incidentTone, incidentsOf, latestIncident, newIncidents, signalOfAction, signalOfEvent } from './matchSignals';

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
 *
 * The simulation is the live engine: `buildEngineRenderState` reads
 * `MatchEngine.getState()` into the same neutral `MatchRenderState` the replay
 * and the unwatched reconstruction produce, so the picture is tested against the
 * one authority rather than against a retired second one.
 */

/**
 * A match somebody is watching: the world, the fixture, the environment, and the
 * live engine that plays the football. Every reading below comes off this one
 * engine — the object the match screen pumps — so the picture is measured
 * against the state the simulation actually owns.
 */
function staged(seed: string): {
  state: GameState;
  match: Match;
  env: ReturnType<typeof matchEnvironment>;
  engine: MatchEngine;
} {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match = cloneMatch(state.matches[fixture.id]!);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  const engine = createMatchEngine(match, env);
  // A couple of seconds of football, so the engine is past kick-off set-up and
  // there is real movement in the state to read, interpolate and draw.
  engine.advance(2, 2, false);
  return { state, match, env, engine };
}

/** A stable, comparable picture of the football, renderer-independent. */
function snapshot(engine: MatchEngine, match: Match): string {
  const state = engine.getState();
  return JSON.stringify({
    clock: state.clock,
    residual: state.residual,
    possession: state.possession,
    phase: state.phase,
    ball: state.ball,
    players: state.players.map((node) => ({
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
    const { state, match, engine } = staged('render-window');
    const engineState = engine.getState();
    const render = buildEngineRenderState(engine, match, state);
    expect(render.continuous).toBe(true);
    // The arrays the renderer draws are the engine's own, not a snapshot of
    // them, so reading the picture cannot fork the football.
    expect(render.players[0]).toBe(engineState.players[0]);
    expect(render.ball).toBe(engineState.ball);
    expect(render.actions).toBe(engineState.actions);
    expect(render.players).toHaveLength(22);
  });

  it('reports the clock, context and revision the simulation holds', () => {
    const { state, match, engine } = staged('render-readings');
    const engineState = engine.getState();
    const render = buildEngineRenderState(engine, match, state);
    expect(render.clock).toBe(engineState.clock);
    expect(render.possession).toBe(engineState.possession);
    expect(render.phase).toBe(engineState.phase as unknown as MatchPhase);
    expect(render.revision).toBe(match.events.length);
    expect(render.alpha()).toBeCloseTo(simulationAlpha(engineState), 10);
  });

  it('describes both teams, with their own colours', () => {
    const { state, match, engine } = staged('render-teams');
    const render = buildEngineRenderState(engine, match, state);
    expect(render.teams.home.clubId).toBe(match.homeClubId);
    expect(render.teams.away.clubId).toBe(match.awayClubId);
    expect(render.teams.home.colours).toEqual(state.clubs[match.homeClubId]!.identity.colours);
    expect(render.teams.away.colours).toEqual(state.clubs[match.awayClubId]!.identity.colours);
  });

  it('lays the teams out from their formation when there is no continuous state', () => {
    // An unwatched fixture, or a save from before the recording existed: there is
    // no live state to read, so the picture is reconstructed from the lineups and
    // there is nothing to interpolate between.
    const { state, match } = staged('render-fallback');
    const render = buildMatchRenderState(match, state);
    expect(render.continuous).toBe(false);
    expect(render.players).toHaveLength(22);
    expect(render.ball).toBeTruthy();
    expect(render.alpha()).toBe(0);
  });

  it('does not change the football by being read', () => {
    const { state, match, engine } = staged('render-pure');
    const before = snapshot(engine, match);
    buildEngineRenderState(engine, match, state);
    involvementOf(buildEngineRenderState(engine, match, state));
    expect(snapshot(engine, match)).toBe(before);
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
    const { state, match, engine } = staged('render-involvement');
    const engineState = engine.getState();
    const carrier = engineState.players.find((node) => node.side === 'home')!;
    engineState.ball.ownerId = carrier.playerId;
    engineState.ball.status = 'controlled';
    engineState.possession = 'home';

    const involvement = involvementOf(buildEngineRenderState(engine, match, state));
    expect(involvement.possessing).toBe('home');
    expect(involvement.carrying.has(carrier.playerId)).toBe(true);
    expect(involvement.involved.has(carrier.playerId)).toBe(true);
  });
});

describe('switching renderer changes only the paint', () => {
  it('leaves the clock, positions, possession and events exactly as they were', () => {
    const { state, match, engine } = staged('render-switch');
    engine.advance(10, 10, false);
    const before = snapshot(engine, match);

    // Choosing 2D, then 3D (which resolves to 2D), and reading the state for
    // each: none of it may move a single value.
    for (const kind of ['2d', '3d', '2d'] as const) {
      expect(resolveRenderer(kind).Component).toBeTruthy();
      involvementOf(buildEngineRenderState(engine, match, state));
    }
    expect(snapshot(engine, match)).toBe(before);
  });

  it('does not duplicate the simulation when a renderer is mounted', () => {
    const plain = staged('render-no-duplicate');
    const watched = staged('render-no-duplicate');
    // The step the engine itself owns: no test decides the simulation's cadence.
    const step = plain.engine.getState().stepSeconds;
    for (let i = 0; i < 300; i += 1) {
      plain.engine.step(step);
      watched.engine.step(step);
      // The watched one is "rendered" every step; the other is not.
      involvementOf(buildEngineRenderState(watched.engine, watched.match, watched.state));
    }
    expect(snapshot(watched.engine, watched.match)).toBe(snapshot(plain.engine, plain.match));
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
    const { state, match, engine } = staged('render-signals');
    match.events.push(matchEvent('goal', { id: 'goal-1', clubId: match.homeClubId, minute: 20 }));
    const render = buildEngineRenderState(engine, match, state);
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
    // The picture leans toward the moment, not the live state.
    expect(render.ball.x).toBeCloseTo(0.7, 5);
    expect(render.ball.y).toBeCloseTo(0.4, 5);
    expect(render.players.length).toBeGreaterThan(0);
  });

  it('still leaves the live match alone', () => {
    const { state, match, engine } = staged('render-cursor-live');
    const live = buildEngineRenderState(engine, match, state);
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
