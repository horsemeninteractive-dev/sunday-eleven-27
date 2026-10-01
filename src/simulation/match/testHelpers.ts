import type { Match } from '@/domain/match';

/** Deep clone without touching shared player objects. */
export function cloneMatch(match: Match): Match {
  return structuredClone(match) as Match;
}
