import type { GameState } from '@/domain/game';
import type { Celebration, Match, MatchPhase } from '@/domain/match';
import type { Side } from '@/domain/matchState';
// The simulation is reached only through its boundary. `TOUCHLINE_ARCHITECTURE.md`
// §"Presentation boundary": a reader imports Touchline and nothing deeper, so the
// surface it may use is one reviewed list rather than whatever a deep path happens
// to export today.
import { simulationAlpha, specFor, type MatchEngine } from '@/simulation/touchline';
import type { MatchRenderState, RenderTeam } from './renderContract';
import { signalOfEvent, type MatchSignal } from './matchSignals';

/**
 * The match engine, read into the neutral shape a renderer consumes.
 *
 * This is the same seam `buildMatchRenderState` provides for the old
 * presentation layer, pointed at the engine instead. A renderer handed this
 * cannot tell the difference: it is the same `MatchRenderState`, built from the
 * engine's own authoritative state rather than from a replay of a plan, so the
 * 2D pitch (and any future 3D view) draws the football the engine actually
 * played without knowing which engine produced it.
 *
 * It is a window, not a fork. Every array is the engine's own — the players, the
 * ball, the actions — and `alpha` is a closure over the engine's residual, so
 * building this cannot change a result and interpolating costs nothing.
 */

function sideOfEvent(match: Match, clubId: string | null): Side | null {
  if (clubId === null) return null;
  if (clubId === match.homeClubId) return 'home';
  if (clubId === match.awayClubId) return 'away';
  return null;
}

function teamOf(game: GameState, match: Match, side: Side): RenderTeam {
  const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
  const club = game.clubs[clubId]!;
  return {
    side,
    clubId,
    name: club.identity.name,
    colours: { ...club.identity.colours },
    formation: match.lineups[side].tactics.formation,
  };
}

function signalsOf(match: Match): MatchSignal[] {
  return match.events.map((event) => signalOfEvent(event, sideOfEvent(match, event.clubId)));
}

/**
 * The goal being celebrated, if one is.
 *
 * The engine holds the `goal` phase for a few seconds after the ball crosses the
 * line; this reads the goal that put it there, so the pitch can pick out the
 * scorer and his side without deciding anything of its own.
 */
function celebrationOf(match: Match, phase: MatchPhase): Celebration | null {
  if (phase !== 'goal') return null;
  for (let index = match.events.length - 1; index >= 0; index -= 1) {
    const event = match.events[index]!;
    if (event.type !== 'goal' && event.type !== 'penalty-scored') continue;
    const side = sideOfEvent(match, event.clubId);
    if (!side || !event.playerId) return null;
    return { side, scorerId: event.playerId, elapsed: 0 };
  }
  return null;
}

/**
 * Read the engine's authoritative state as the render contract.
 *
 * `match` and `game` supply only the things that do not change during a match —
 * who is playing and in what colours — and the whole of the football comes from
 * the engine.
 */
export function buildEngineRenderState(engine: MatchEngine, match: Match, game: GameState): MatchRenderState {
  const state = engine.getState();
  const phase = state.phase as unknown as MatchPhase;
  return {
    continuous: true,
    clock: state.clock,
    minute: match.minute,
    half: specFor(state.period).half,
    period: state.period,
    phase,
    possession: state.possession,
    // A sent-off man is off the pitch: the engine still holds his node (every
    // rule already skips him), but the picture must not draw him standing there.
    players: state.players.filter((player) => !player.sentOff),
    ball: state.ball,
    actions: state.actions,
    celebration: celebrationOf(match, phase),
    teams: {
      home: teamOf(game, match, 'home'),
      away: teamOf(game, match, 'away'),
    },
    incidents: match.incidents,
    signals: signalsOf(match),
    revision: match.events.length,
    alpha: () => simulationAlpha(state),
  };
}
