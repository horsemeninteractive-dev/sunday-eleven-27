import type { ComponentType } from 'react';
import type { ClubId } from '@/domain/ids';
import type { MatchAction, MatchBallState, MatchPeriod, MatchPhase, PlayerState } from '@/domain/match';
import type { Celebration } from '@/domain/match';
import type { Side } from '@/domain/matchState';
import type { Player } from '@/domain/person';
import type { MatchSignal } from './matchSignals';

/**
 * The renderer contract.
 *
 * This is the seam that lets the same football be drawn two ways. A renderer is
 * a leaf that is *handed* the authoritative match — it never holds, advances or
 * decides any of it. Everything a renderer is allowed to know is described by
 * {@link MatchRenderState}, and that description is deliberately neutral about
 * how it will be drawn: it says where people are and what they are doing, not
 * whether they become dots on a pitch or meshes in a scene.
 *
 * ```
 *              MATCH SIMULATION
 *                     │
 *             AUTHORITATIVE STATE
 *                     │
 *       ┌─────────────┴─────────────┐
 *       │                           │
 *    2D RENDERER               3D RENDERER
 *       │                           │
 *    same match                 same match
 * ```
 *
 * The rules that keep that picture true, and which any future renderer must
 * follow:
 *
 * - **A renderer reads, it does not simulate.** It may interpolate between the
 *   steps the simulation already took — that is presentation — but it may not
 *   move a player, aim a ball, decide possession or invent an outcome. If the
 *   picture needs something the state does not carry, the state grows a field;
 *   the renderer does not start inferring football.
 * - **There is no 2D-only or 3D-only football.** Possession, ball movement and
 *   tactics live in the simulation, once. A renderer that finds itself writing
 *   those rules is a second simulation, and that is the bug this contract exists
 *   to prevent.
 * - **Switching renderer changes only which component is mounted.** The match
 *   clock, positions, possession, events, commentary, speed and result are held
 *   above the renderer, so unmounting one and mounting the other is a paint, not
 *   a restart.
 *
 * The types here are the contract. The one implementation today is the 2D pitch
 * (`src/ui/match/MatchPitch.tsx`), reached through the registry in
 * `src/presentation/matchRenderers.tsx`.
 */

/** The renderers the game can name. Only `2d` is implemented today. */
export type RendererKind = '2d' | '3d';

/** A club's colours, as the renderer draws them. The simulation's own truth. */
export interface RenderTeamColours {
  primary: string;
  secondary: string;
}

/** One side's identity, as a renderer needs it — who is playing and in what. */
export interface RenderTeam {
  side: Side;
  clubId: ClubId;
  name: string;
  colours: RenderTeamColours;
  /** The shape the manager set, so a renderer can describe the team. */
  formation: string;
}

/**
 * The match, as a renderer sees it.
 *
 * One object, built once per render, holding everything a renderer may draw and
 * nothing it may not. Positions and the ball are the simulation's own values —
 * `px/py` is the previous step, `x/y` the current one — and {@link alpha} is the
 * shared interpolation fraction between them, so smoothing is identical for
 * every renderer instead of being reinvented per view.
 *
 * It carries references into the authoritative state rather than copies, so
 * building it cannot change the football: it is a window, not a fork.
 */
export interface MatchRenderState {
  /**
   * Whether this match has continuous spatial state to draw.
   *
   * A watched match always does. An unwatched one — or a save from before the
   * pitch existed — does not, and the builder lays the teams out from their
   * formations so something sensible is still drawn.
   */
  continuous: boolean;
  /** Seconds of football simulated since kick-off. */
  clock: number;
  /** The match minute the engine is on. */
  minute: number;
  half: 1 | 2 | 3;
  /**
   * Which part of the game this moment is in.
   *
   * The explicit label, rather than something a renderer has to infer from the
   * half number — which cannot tell the two periods of extra time apart.
   */
  period: MatchPeriod;
  /** Where in the story of the match this moment sits. */
  phase: MatchPhase;
  /** Which side has the ball, if either. */
  possession: Side | null;
  /** Every player on the pitch, in the simulation's fixed frame. */
  players: readonly PlayerState[];
  /** The ball, always present — synthesised for a match with no spatial state. */
  ball: MatchBallState;
  /** The actions being played out right now. */
  actions: readonly MatchAction[];
  /** The goal being celebrated right now, if any. */
  celebration: Celebration | null;
  /** Both teams' identity and colours. */
  teams: Record<Side, RenderTeam>;
  /** Non-critical incidents for this match, in the order they happened. */
  incidents: readonly string[];
  /**
   * The match's whole story as renderer-neutral signals, in order.
   *
   * A projection of the authoritative events into the one football vocabulary
   * every consumer speaks (see `matchSignals`), so an incident banner or a
   * future replay can describe an afternoon without reading the engine's own
   * types and without either renderer inventing its own version of a goal.
   */
  signals: readonly MatchSignal[];
  /**
   * A version counter that changes when a new minute has been simulated.
   *
   * A renderer uses it to know when the *shape* of the match has changed (the
   * lineups, the passage, the events), as opposed to the per-frame movement that
   * is read straight from the arrays and never re-renders React.
   */
  revision: number;
  /**
   * How far into the next simulation step we are, 0..1.
   *
   * The one piece of per-frame information a renderer needs, exposed as a
   * function because it changes every frame: a renderer calls it inside its own
   * draw loop and interpolates with it, so no render triggers when it moves.
   */
  alpha: () => number;
}

/**
 * What every renderer is handed.
 *
 * `state` is the match; `side` is whose match it is (so a renderer can face the
 * manager's team the right way); `playerById` resolves a player id to the person,
 * for a name or a face. A renderer that needs more than this is asking the state
 * to grow, which is the correct answer.
 */
export interface MatchRendererProps {
  state: MatchRenderState;
  side: Side;
  playerById: (id: string) => Player | undefined;
}

/**
 * A renderer's entry in the registry.
 *
 * `available` is what makes a chosen-but-unbuilt renderer safe: while it is
 * false the registry hands back 2D instead, so selecting 3D before 3D exists
 * still watches the match rather than showing a hole.
 */
export interface MatchRendererDefinition {
  kind: RendererKind;
  label: string;
  description: string;
  available: boolean;
  /** The component to mount, or null while the renderer is not built. */
  Component: ComponentType<MatchRendererProps> | null;
}
