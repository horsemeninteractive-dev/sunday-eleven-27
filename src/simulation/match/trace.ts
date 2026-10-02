import type { SimTraceEntry } from './core';

/**
 * Watching the simulation think.
 *
 * The hardest part of balancing a football simulation is that a wrong-looking
 * match tells you nothing about *why* it was wrong. A scoreline is an end product;
 * what you need is the decision that produced it. This is the smallest thing that
 * gives you that: the engine hands every decision to a callback, and these two
 * helpers turn a match's worth of them into something you can read.
 *
 * It is deliberately not wired into the game. A normal match passes no callback
 * and pays nothing; a test, a balance script or a developer console attaches a
 * collector and gets the whole afternoon in prose.
 *
 * Typical use:
 *
 * ```ts
 * const collected = collectingTrace();
 * simulateToCompletion(match, { ...matchEnvironment(state, match), trace: collected.trace });
 * console.log(formatTrace(collected.entries.filter((entry) => entry.minute < 20)));
 * ```
 */

export interface TraceCollector {
  trace: (entry: SimTraceEntry) => void;
  entries: SimTraceEntry[];
}

/** A callback and the list it fills, so a caller cannot forget one of them. */
export function collectingTrace(): TraceCollector {
  const entries: SimTraceEntry[] = [];
  return {
    entries,
    trace: (entry) => {
      entries.push(entry);
    },
  };
}

function detailLine(detail: Record<string, number | string | null> | undefined): string {
  if (!detail) return '';
  const parts = Object.entries(detail)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? `  [${parts.join(' ')}]` : '';
}

/** The trace as a readable log, one decision to a line. */
export function formatTrace(entries: readonly SimTraceEntry[]): string {
  return entries
    .map((entry) => {
      const clock = `${entry.minute}'`.padStart(5, ' ');
      const side = (entry.side ?? '-').padEnd(4, ' ');
      const phase = entry.phase.padEnd(12, ' ');
      return `${clock} ${side} ${phase} ${entry.message}${detailLine(entry.detail)}`;
    })
    .join('\n');
}

/** Just the decisions, without the bookkeeping around them. */
export function traceActions(entries: readonly SimTraceEntry[]): SimTraceEntry[] {
  return entries.filter((entry) => typeof entry.detail?.action === 'string');
}
