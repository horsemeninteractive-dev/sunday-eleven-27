import type { GameState } from '@/domain/game';

/**
 * Generated ids are drawn from counters held in the game state rather than
 * from a module-level counter, so ids never collide after a save is reloaded
 * and a world regenerated from the same seed produces the same ids.
 */
export function nextId(state: GameState, prefix: string): string {
  const next = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = next;
  return `${prefix}_${next}`;
}

export function peekCounter(state: GameState, prefix: string): number {
  return state.counters[prefix] ?? 0;
}
