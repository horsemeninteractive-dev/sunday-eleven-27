import type { Match, MatchSimulationMode } from '@/domain/match';
import type { MatchEnvironment } from '@/simulation/match/core';
import {
  simulateMatchEngine,
  type MatchEngine,
  type MatchEngineOptions,
} from '@/simulation/match/matchEngine';
import { simulateMatchFast } from './simulate';

/**
 * The background simulation mode, in one place.
 *
 * The game has two ways to play a fixture and both of them live behind this
 * barrel: `'full'` is the `MatchEngine` (see `MATCH_ENGINE.md`) and `'fast'` is
 * the abstract background model beside it. Neither replaces the other — the full
 * engine remains the authoritative simulation for a match somebody is watching,
 * and the fast mode exists so the *other* forty-odd fixtures on a Sunday, and the
 * season-long runs built on them, stop costing seconds apiece.
 *
 * `simulateFixture` is the single explicit door: a caller says which mode it
 * wants and gets exactly that. Nothing infers the mode from what the caller is,
 * and the policy that decides it for the game itself is `simulationModeFor`.
 */

export type { MatchSimulationMode } from '@/domain/match';
export { MATCH_SIMULATION_MODES, isMatchSimulationMode, simulationModeFor } from './mode';
export { simulateMatchFast, FAST_CALIBRATION, type FastMatchResult } from './simulate';

/**
 * Play a fixture with the full engine, recording the mode it was played in.
 *
 * A thin wrapper: the `MatchEngine` itself is untouched (see the standing rule
 * that nothing under `match/` is edited), but the *record* should say which
 * simulation decided it, so a reader never has to infer it. The stamp lives here
 * rather than inside the engine so both modes are labelled by the same module.
 *
 * Returns the engine, because the watched and instant-result paths need it — to
 * drain the commentary feed and to carry the possession across to the store.
 * Everything else about the match is on the `Match`, as it always was.
 */
export function simulateMatchFull(
  match: Match,
  env: MatchEnvironment,
  options: MatchEngineOptions = {},
): MatchEngine {
  match.simulationMode = 'full';
  return simulateMatchEngine(match, env, options);
}

/**
 * Play a fixture in an explicit mode and write the result onto it.
 *
 * Deliberately returns nothing: the match record *is* the result, and every
 * consumer in the game — `applyMatchConsequences`, `applyMatchdayFinances`, the
 * league table, the cup, a player's career — reads that record rather than an
 * engine object. A caller that needs the live engine (the watched match) drives
 * `MatchEngine` directly, or `simulateMatchFull`, instead.
 */
export function simulateFixture(match: Match, env: MatchEnvironment, mode: MatchSimulationMode): void {
  if (mode === 'fast') {
    simulateMatchFast(match, env);
    return;
  }
  simulateMatchFull(match, env);
}
