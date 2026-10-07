/**
 * TOUCHLINE — the authoritative football simulation, at its one public boundary.
 *
 * **Touchline decides what happens. Presentation shows what happened.**
 *
 * This module is a *surface*, not a wrapper. Every export below is the real thing,
 * re-exported so that a consumer — a renderer, the commentary, a statistics panel,
 * the season, a tool — has **one import to reach the simulation through**, and so
 * that the boundary exists somewhere a reader can point at. Nothing is copied,
 * delegated, adapted or decided here; if you find yourself wanting a function in
 * this file that does work, it belongs in a resolution instead.
 *
 * ```text
 *                        src/simulation/touchline   ← you are here
 *                                   │
 *                  ┌────────────────┴────────────────┐
 *                  ▼                                 ▼
 *      matchEngine/  (detailed)          fastMatch/  (abstract)
 *      what a manager watches            the other forty fixtures
 *                  │                                 │
 *                  └────────────────┬────────────────┘
 *                                   ▼
 *                    Match  —  result · events · performances
 *                                   │
 *         2D · future 3D · text · statistics · reports  (all readers)
 * ```
 *
 * ## What Touchline owns
 *
 * Everything that decides a football outcome, in one of two **resolutions** of the
 * same football world: the clock, the phase of play, possession, the players, the
 * ball, set pieces, fouls and cards, injuries, substitutions, the events, the
 * statistics and the final result. `TOUCHLINE_ARCHITECTURE.md` §"What Touchline
 * owns" is the full list, and §"The ownership audit — all fourteen questions" answers "which system owns
 * this?" for all fourteen areas of a match, with call paths.
 *
 * ## What Touchline does not own
 *
 * Rendering, the UI, the commentary's wording, pacing, the replay, the pitch and
 * the post-match screens — everything under `src/presentation/` and `src/ui/`.
 * Those read `TouchlineState`, `TouchlineEvent` and `TouchlineMatch`; they may
 * interpolate and interpret, and they must never decide. A renderer that finds
 * itself writing possession, ball movement or an outcome has become a second
 * simulation, which is the one bug this boundary exists to prevent.
 *
 * ## Why there is no `TouchlineSimulation`
 *
 * The obvious shape for a "simulation" is a class or an interface both
 * resolutions implement. There deliberately isn't one, because it would be a
 * fiction: the two resolutions do not return the same thing — the detailed one
 * hands back a live `MatchEngine` (the watched match needs to keep stepping it),
 * and the abstract one returns nothing at all because the `Match` record *is* the
 * result. What they genuinely share is the pair below, and that pair is the real
 * contract:
 *
 * - {@link simulateFixture} — play a fixture in a named resolution;
 * - {@link simulationModeFor} — the one rule that says which resolution a fixture
 *   of the world gets (`'full'` for the manager's own club, `'fast'` for the rest).
 *
 * See `TOUCHLINE_ARCHITECTURE.md` §"Fast / background simulation" for what the two
 * share today and what they realistically could.
 *
 * `MATCH_ENGINE.md` is the detailed resolution's own design document;
 * `TOUCHLINE_ARCHITECTURE.md` is the system's.
 */

import type { Match, MatchEvent, MatchResult, MatchSimulationMode } from '@/domain/match';
import type { MatchEngineState } from '@/simulation/match/matchEngine';

// ---------------------------------------------------------------------------
// The vocabulary
//
// Names for the concepts the brief asks a consumer to know, aliased onto the
// shapes that already exist. An alias, not a second type: `TouchlineState` and
// `MatchEngineState` are the same object, so nothing has to be converted at the
// boundary and no reader can be handed a divergent copy of the state.
// ---------------------------------------------------------------------------

/** The authoritative continuous state of a match being played. */
export type TouchlineState = MatchEngineState;
/** What the simulation announces as it plays — one stream, for every reader. */
export type TouchlineEvent = MatchEvent;
/** The record a match leaves behind. Both resolutions write this, identically. */
export type TouchlineMatch = Match;
/** The settled result: score, shots, possession, attendance, penalties. */
export type TouchlineResult = MatchResult;
/**
 * Which resolution played a fixture: `'full'` (detailed) or `'fast'` (abstract).
 *
 * These two strings are written into saves as `Match.simulationMode`. They are
 * part of the save format and must not be renamed, whatever the resolutions are
 * called in prose.
 */
export type TouchlineResolution = MatchSimulationMode;

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

// `simulateMatchFull` is declared beside the door rather than in the engine (it is
// what stamps `Match.simulationMode = 'full'`), so it is exported from the same
// module: it plays a fixture in the detailed resolution, headless.
export {
  simulateFixture,
  simulateMatchFull,
  simulationModeFor,
  MATCH_SIMULATION_MODES,
  isMatchSimulationMode,
} from '@/simulation/fastMatch';

// ---------------------------------------------------------------------------
// The detailed resolution — what a manager watches
// ---------------------------------------------------------------------------

export { MatchEngine, createMatchEngine, simulateMatchHeadless } from '@/simulation/match/matchEngine';
export type { MatchEngineOptions } from '@/simulation/match/matchEngine';

// ---------------------------------------------------------------------------
// The abstract resolution — the fixtures nobody watches
// ---------------------------------------------------------------------------

export { simulateMatchFast } from '@/simulation/fastMatch';
export type { FastMatchResult } from '@/simulation/fastMatch';

// ---------------------------------------------------------------------------
// Reading the state
//
// The minimum a consumer needs to describe what Touchline already decided: the
// phase of play and the set piece being taken, the shapes of the state it reads,
// the period the clock is in, and the interpolation fraction between steps. All
// of it is a reading — nothing here can change a result.
// ---------------------------------------------------------------------------

export { specFor } from '@/simulation/match/matchEngine/periods';
export type { MatchPeriod, PeriodSpec } from '@/simulation/match/matchEngine/periods';
export type {
  BallNode,
  MatchPhase,
  PlayerIntent,
  PlayerMatchState,
  SetPieceKind,
  SetPieceState,
  ShotOutcome,
  TeamMatchStats,
} from '@/simulation/match/matchEngine';
export { playersOf, otherSide } from '@/simulation/match/matchEngine';
export { simulationAlpha } from '@/simulation/match/state';

// ---------------------------------------------------------------------------
// The laws
//
// Every resolution plays the same football, and this is where that football is
// written down once: which restarts exist, where each is placed, how long each is
// given, who takes it, what a strike from one is worth, what a foul becomes and how
// many changes a side may make (`src/simulation/match/laws.ts`). Exported through
// the boundary so the whole vocabulary of the game is reachable from one import.
//
// `cardForFoul` and `strikeOutcome` *decide*, so they are called by the two
// resolutions and by nothing else — each passes its own chances or its own roll.
// A reader wants the vocabulary and the ladders; a consumer that finds itself
// rolling for a card has become a third resolution, which is the one thing this
// boundary exists to prevent.
// ---------------------------------------------------------------------------

export {
  CHANGES_PER_MATCH,
  RESTART_KINDS,
  RESTART_SETUP_SECONDS,
  RESTART_STRIKES,
  RESTART_TAKER,
  cardForFoul,
  changesAllowed,
  penaltyTaker,
  restartSpotFor,
  strikeOutcome,
} from '@/simulation/match/laws';
export type {
  CardChances,
  CardDecision,
  RestartKind,
  RestartTakerRule,
  StrikeOutcome,
  StrikeRung,
} from '@/simulation/match/laws';
