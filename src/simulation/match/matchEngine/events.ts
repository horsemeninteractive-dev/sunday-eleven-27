import type { Match, MatchEvent, MatchEventType } from '@/domain/match';
import { makeEvent } from '../core';
import { addedTimeBefore, displayedMinuteFor } from './periods';
import type { MatchEngineState, Side, TeamMatchStats } from './types';

/**
 * Events are the engine's output.
 *
 * The engine decides that a thing happened; this is where it is written down.
 * Nothing outside the engine may create one, which is what lets the commentary,
 * the statistics and a renderer all read the *same* account of the match rather
 * than each keeping one of their own.
 */

export interface EmitSpec {
  type: MatchEventType;
  side: Side | null;
  playerId?: string | null;
  secondaryPlayerId?: string | null;
  text: string;
  x: number;
  y: number;
  importance: 1 | 2 | 3;
  scoreAfter?: { home: number; away: number };
}

/**
 * Write an event into the authoritative record.
 *
 * It goes on the match's own log — the record the whole game reads — and onto
 * the engine's pending feed, which a running match drains one step at a time.
 *
 * The point is a point *on the pitch*. A shot is resolved where the ball ended
 * up, and a shot that goes in ended up a fraction beyond the goal line, so the
 * engine's own coordinates can fall outside the field by a hundredth or two. The
 * record keeps the place the thing happened — the line itself — rather than a
 * coordinate off the edge of the field every reader draws, which is what the map
 * strip, the replay and a future 3D view all assume. Nothing about the football
 * changes: it is the same event, filed where it can be shown.
 */
export function emitEvent(state: MatchEngineState, match: Match, spec: EmitSpec): MatchEvent {
  // The minute is the one the clock *reads*, not the raw count of seconds: the
  // clock runs straight through added time (`second`), and the label is rebased
  // per period, so a second-half event is filed under 45..90 rather than under
  // the 49..94 its raw second would give.
  const event = makeEvent(match, spec.type, {
    minute: displayedMinuteFor(state.period, state.clock, addedTimeBefore(match, state.period)),
    second: state.clock,
    side: spec.side,
    playerId: spec.playerId ?? null,
    secondaryPlayerId: spec.secondaryPlayerId ?? null,
    text: spec.text,
    x: Math.max(0, Math.min(1, spec.x)),
    y: Math.max(0, Math.min(1, spec.y)),
    importance: spec.importance,
    scoreAfter: spec.scoreAfter ?? { ...state.score },
  });
  match.events.push(event);
  state.pendingEvents.push(event);
  return event;
}

/** The tally for a side. */
export function statsFor(state: MatchEngineState, side: Side): TeamMatchStats {
  return side === 'home' ? state.stats.home : state.stats.away;
}

/** Drain the pending feed. A running match calls this after each frame. */
export function drainEvents(state: MatchEngineState): MatchEvent[] {
  const events = state.pendingEvents.slice();
  state.pendingEvents.length = 0;
  return events;
}
