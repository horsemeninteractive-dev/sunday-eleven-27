import type { ActionOutcome, MatchAction, MatchActionKind, MatchEvent, MatchEventType } from '@/domain/match';
import type { PlayerId } from '@/domain/ids';
import type { Side } from '@/domain/matchState';

/**
 * The shared event stream.
 *
 * One vocabulary for "what happened on the pitch", written in football rather
 * than in drawing instructions. It is the common language every consumer of the
 * match can speak:
 *
 * ```
 *   authoritative records            signals            consumers
 *   ────────────────────            ───────            ─────────
 *   MatchEvent   ──┐                                  ├─ commentary (prose)
 *                  ├──► MatchSignal ──────────────────┼─ 2D renderer
 *   MatchAction  ──┘                                  ├─ future 3D renderer
 *                                                     └─ post-match reporting
 * ```
 *
 * It is a *projection*, not a second record: `MatchEvent` and `MatchAction` stay
 * the truth, and a signal is only a neutral reading of one of them. That is what
 * keeps a goal from being a goal in one renderer and a near miss in another —
 * there is one description of it and everybody reads the same one.
 *
 * The names describe the football (`ShotStarted`, `PassCompleted`, `Goal`) and
 * never the drawing (`MovePlayerSpriteRight`, `Flash2DGoalEffect`). A renderer
 * decides how to show a signal; the signal does not decide for it.
 */

/** The vocabulary. Football, not pixels. */
export type MatchSignalKind =
  | 'kick-off'
  | 'pass-started'
  | 'pass-completed'
  | 'pass-incomplete'
  | 'carry'
  | 'shot-started'
  | 'goal'
  | 'save'
  | 'blocked'
  | 'off-target'
  | 'turnover'
  | 'out-of-play'
  | 'foul'
  | 'offside'
  | 'yellow-card'
  | 'red-card'
  | 'substitution'
  | 'period';

/** One thing that happened, described the same way for every renderer. */
export interface MatchSignal {
  id: string;
  kind: MatchSignalKind;
  minute: number;
  side: Side | null;
  playerId: PlayerId | null;
  targetPlayerId: PlayerId | null;
  /** The action vocabulary it came from, when it came from an action. */
  actionKind: MatchActionKind | null;
  /** How the action came out, when it has resolved. */
  outcome: ActionOutcome | null;
  /** Where on the pitch it happened, 0..1. */
  x: number;
  y: number;
}

/** The football a signal is read in — where and when, supplied by the reader. */
export interface MatchSignalContext {
  minute: number;
  side: Side | null;
  x: number;
  y: number;
}

/** The signal kind a settled outcome reads as, independent of how it arose. */
function kindForOutcome(kind: MatchActionKind, outcome: ActionOutcome): MatchSignalKind {
  switch (outcome) {
    case 'goal':
      return 'goal';
    case 'saved':
      return 'save';
    case 'blocked':
      return 'blocked';
    case 'off-target':
      return 'off-target';
    case 'out':
      return 'out-of-play';
    case 'turnover':
    case 'foul':
      return outcome;
    case 'incomplete':
      return 'pass-incomplete';
    case 'completed':
      return kind === 'shot' ? 'shot-started' : 'pass-completed';
    case 'carry':
      return 'carry';
    default:
      return 'carry';
  }
}

/** The signal kind an action reads as before it has resolved. */
function kindForAction(kind: MatchActionKind): MatchSignalKind {
  if (kind === 'pass' || kind === 'cross' || kind === 'through' || kind === 'switch') return 'pass-started';
  if (kind === 'shot') return 'shot-started';
  return 'carry';
}

/**
 * Read one action as a signal.
 *
 * An action that is still being played out reads as its beginning; one that has
 * resolved reads as how it came out. The same action therefore produces a
 * `PassStarted` when it starts and a `PassCompleted` or `PassIncomplete` when it
 * ends, without a renderer having to diff anything to notice.
 */
export function signalOfAction(action: MatchAction, context: MatchSignalContext): MatchSignal {
  const kind = action.outcome ? kindForOutcome(action.kind, action.outcome) : kindForAction(action.kind);
  return {
    id: `action:${action.id}:${action.status}`,
    kind,
    minute: context.minute,
    side: context.side,
    playerId: action.playerId,
    targetPlayerId: action.targetPlayerId,
    actionKind: action.kind,
    outcome: action.outcome,
    x: context.x,
    y: context.y,
  };
}

/** Which signal an authoritative match event reads as. */
export function signalKindForEvent(type: MatchEventType): MatchSignalKind {
  switch (type) {
    case 'kick-off':
      return 'kick-off';
    case 'goal':
    case 'own-goal':
    case 'penalty-scored':
      return 'goal';
    case 'penalty-missed':
    case 'shot-off-target':
      return 'off-target';
    case 'shot-saved':
      return 'save';
    case 'shot-blocked':
      return 'blocked';
    case 'pass':
      return 'pass-started';
    case 'carry':
      return 'carry';
    case 'tackle':
      return 'turnover';
    case 'foul':
      return 'foul';
    case 'offside':
      return 'offside';
    case 'yellow-card':
      return 'yellow-card';
    case 'red-card':
      return 'red-card';
    case 'substitution':
      return 'substitution';
    case 'goal-kick':
      return 'out-of-play';
    case 'half-time':
    case 'full-time':
    case 'extra-time':
    case 'penalties':
      return 'period';
    default:
      return 'carry';
  }
}

/**
 * Read one authoritative event as a signal.
 *
 * This is the discrete half of the stream: the incidents the engine records —
 * goals, saves, cards, the whistle. The continuous half comes from actions; the
 * two share one vocabulary so a renderer, the commentary and the report card all
 * describe the afternoon the same way.
 */
export function signalOfEvent(event: MatchEvent, side: Side | null = null): MatchSignal {
  return {
    id: `event:${event.id}`,
    kind: signalKindForEvent(event.type),
    minute: event.minute,
    side,
    playerId: event.playerId,
    targetPlayerId: event.secondaryPlayerId,
    actionKind: null,
    outcome: null,
    x: event.x,
    y: event.y,
  };
}

// ---------------------------------------------------------------------------
// Incidents
//
// The signals worth interrupting the picture for. A banner that reads these is
// renderer-neutral by construction: it is handed the same signals whether the
// match is drawn as a 2D pitch or a 3D scene, so a goal says the same thing on
// either screen — and neither renderer has to know how to say it.
//
// Only the match-stopping incidents belong here: goals, fouls, offsides and
// cards. Near misses are the ordinary texture of the game, left to the pitch
// and the commentary rather than shouted across it.
// ---------------------------------------------------------------------------

/** How an incident reads. Semantic, not visual: a renderer dresses it. */
export type IncidentTone = 'goal' | 'whistle' | 'danger';

/** The tone an incident kind reads as, or null if it is not an incident. */
export function incidentTone(kind: MatchSignalKind): IncidentTone | null {
  switch (kind) {
    case 'goal':
      return 'goal';
    case 'foul':
    case 'offside':
      return 'whistle';
    case 'yellow-card':
    case 'red-card':
      return 'danger';
    default:
      return null;
  }
}

/**
 * Every incident in the record, in order.
 *
 * The banner's queue, rather than its latest headline: a foul and the booking
 * that follows it are two incidents in the same minute, and both are worth
 * showing. Skipping everything but the newest would swallow the foul the moment
 * the card landed — which is exactly the pair a manager wants to see together.
 */
export function incidentsOf(signals: readonly MatchSignal[]): MatchSignal[] {
  return signals.filter((signal) => incidentTone(signal.kind) !== null);
}

/**
 * The incidents that have arrived since the ones already accounted for.
 *
 * The banner's inbox: what to add to the queue, in the order it happened. A
 * single revision can carry more than one incident — a foul and the card that
 * follows it — and they must both come through, not just the last of them.
 */
export function newIncidents(
  seen: ReadonlySet<string>,
  signals: readonly MatchSignal[],
): MatchSignal[] {
  return incidentsOf(signals).filter((signal) => !seen.has(signal.id));
}

/**
 * The newest incident worth showing, or null if nothing has happened yet.
 *
 * Signals arrive in the order the match happened, so the latest showable one is
 * the incident to announce. Only the match-stopping incidents qualify — goals,
 * fouls, offsides and cards; the ordinary traffic of a Sunday afternoon is
 * skipped rather than shown weakly.
 */
export function latestIncident(signals: readonly MatchSignal[]): MatchSignal | null {
  for (let index = signals.length - 1; index >= 0; index -= 1) {
    const signal = signals[index]!;
    if (incidentTone(signal.kind)) return signal;
  }
  return null;
}
