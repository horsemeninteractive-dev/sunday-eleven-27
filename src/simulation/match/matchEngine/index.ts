/**
 * The match engine, in one place.
 *
 * `MATCH_ENGINE.md` at the repository root explains the architecture; this is the
 * code. The engine is the only thing that plays football. Read its state, listen
 * to its events, draw it — but never decide anything of your own about the match.
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
// to display — lives in `core`, but is re-exported here so a consumer of the
// engine never has to reach into the old engine's module to find it.
export { currentScore, displayMinute } from '../core';
export { createEngineState, playerOf, activePlayers, keeperOf } from './state';
export { updateDecisions, shapeTargetFor, type DecisionWorld } from './decisions';
export { beginSetPiece, advanceSetPiece, spotFor } from './setPieces';
export { giveBallTo, strikeBall, releaseBall } from './ball';
export { emitEvent, drainEvents, statsFor } from './events';
export { substitute, refreshFormation, autoManageBench, reviewBenches, onPitch } from './management';
