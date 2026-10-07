/**
 * Touchline — the detailed resolution, in one place.
 *
 * **Touchline decides what happens. Presentation shows what happened.** This
 * module is the public face of the resolution a manager watches: the fixed-step
 * spatial engine, which owns the authoritative `MatchEngineState` and is the only
 * thing that plays football at this resolution. Read its state, listen to its
 * events, draw it — but never decide anything of your own about the match.
 *
 * The other resolution of the same Touchline is `src/simulation/fastMatch/` (the
 * abstract resolution, for the fixtures nobody watches); the two are chosen by
 * `fastMatch/mode.ts` and never play the same fixture. `TOUCHLINE_ARCHITECTURE.md` at the
 * repository root is the audit and the ownership contract; `MATCH_ENGINE.md` is
 * this resolution's own design.
 */

export * from './types';
export {
  MatchEngine,
  createMatchEngine,
  simulateMatchEngine,
  simulateMatchHeadless,
  possessionShare,
  staminaFraction,
  type MatchEngineOptions,
} from './engine';
// The shared reading of a match record — the score on the board and the minute
// to display — lives in `core` with the rest of Touchline's shared vocabulary,
// and is re-exported here so a consumer of the engine reads it from one place.
export { currentScore, displayMinute } from '../core';
export { createEngineState, playerOf, activePlayers, keeperOf } from './state';
export { updateDecisions, shapeTargetFor, type DecisionWorld } from './decisions';
export { beginSetPiece, advanceSetPiece, spotFor } from './setPieces';
export { giveBallTo, strikeBall, releaseBall } from './ball';
export { emitEvent, drainEvents, statsFor } from './events';
export { substitute, refreshFormation, autoManageBench, reviewBenches, onPitch } from './management';
