import type { ClubId } from '@/domain/ids';
import type { Match, MatchSimulationMode } from '@/domain/match';

/**
 * The two ways a fixture is decided, and the one rule that chooses between them.
 *
 * This module is deliberately tiny. The mode is not a flag that gets threaded
 * around the codebase and quietly flipped; it is a property of the fixture and a
 * single documented policy, so any reader can answer "which simulation played
 * this game, and why?" without following a call chain.
 *
 * See `MATCH_ENGINE.md` § "The two modes" for the architecture.
 */

/** Every mode the game knows, in one place. */
export const MATCH_SIMULATION_MODES: readonly MatchSimulationMode[] = ['full', 'fast'];

/** Whether a value is a mode. Used when reading a mode back off a save. */
export function isMatchSimulationMode(value: unknown): value is MatchSimulationMode {
  return value === 'full' || value === 'fast';
}

/**
 * Which mode a fixture is played in.
 *
 * The rule, written down once:
 *
 *  - a fixture the **human's club is involved in** is `'full'`, always — he may
 *    watch it, play it out at speed, or send it to the bench (the headless path
 *    in `day.ts`), and it is the same high-fidelity engine either way, because
 *    the match he is about to be told about is the match he should have played;
 *  - **every other fixture** is `'fast'` — the abstract background model, which
 *    produces the same *results* and the same *player records* without the
 *    spatial loop, the renderer state or the ordinary texture.
 *
 * A caller that wants something else (a test, a tool) passes the mode explicitly
 * to `simulateFixture`; it is never inferred from anywhere but here.
 */
export function simulationModeFor(
  state: { readonly userClubId: ClubId },
  match: Match,
): MatchSimulationMode {
  const involvesUser =
    match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
  return involvesUser ? 'full' : 'fast';
}
