import type { GameState } from '@/domain/game';
import type { ISODate, PersonId } from '@/domain/ids';
import {
  emptyRecruitmentStore,
  type CandidateKnowledge,
  type CandidateStatus,
  type DiscoverySource,
  type RecommendationSentiment,
  type RecruitmentCandidate,
  type RecruitmentHistoryEntry,
  type RecruitmentStore,
} from '@/domain/recruitment';
import { mergeKnowledge } from './knowledge';

/** The recruitment store, created on demand so older saves can be repaired. */
export function recruitmentStore(state: GameState): RecruitmentStore {
  const existing = state.recruitment as RecruitmentStore | undefined;
  if (existing && existing.candidates && Array.isArray(existing.pendingTrialIds)) return existing;
  const store = emptyRecruitmentStore();
  state.recruitment = store;
  return store;
}

export function candidateOf(state: GameState, personId: PersonId): RecruitmentCandidate | undefined {
  return recruitmentStore(state).candidates[personId];
}

export interface NewCandidateSeed {
  personId: PersonId;
  discoveredVia: DiscoverySource;
  sourcePersonId?: PersonId | null;
  sourceNote: string;
  sentiment?: RecommendationSentiment;
  knowledge: CandidateKnowledge;
  date?: ISODate;
}

/**
 * Put somebody on the manager's list. Finding the same name twice is normal in
 * local football — the knowledge is merged and the second mention is recorded
 * rather than starting again.
 */
export function addCandidate(state: GameState, seed: NewCandidateSeed): RecruitmentCandidate {
  const store = recruitmentStore(state);
  const date = seed.date ?? state.date;
  const existing = store.candidates[seed.personId];

  if (existing) {
    existing.knowledge = mergeKnowledge(existing.knowledge, seed.knowledge.attributes, seed.knowledge.notes);
    if (seed.sentiment === 'warning') existing.sentiment = 'warning';
    recordCandidateHistory(state, existing, `Mentioned again: ${seed.sourceNote}`, date);
    existing.lastReviewedOn = date;
    return existing;
  }

  const candidate: RecruitmentCandidate = {
    personId: seed.personId,
    discoveredOn: date,
    discoveredVia: seed.discoveredVia,
    sourcePersonId: seed.sourcePersonId ?? null,
    sourceNote: seed.sourceNote,
    sentiment: seed.sentiment ?? 'neutral',
    status: 'watching',
    knowledge: seed.knowledge,
    history: [],
    trials: 0,
    interestHints: [],
    outcome: null,
    lastReviewedOn: date,
  };
  store.candidates[seed.personId] = candidate;
  recordCandidateHistory(state, candidate, `First heard about him: ${seed.sourceNote}`, date);
  return candidate;
}

export function recordCandidateHistory(
  state: GameState,
  candidate: RecruitmentCandidate,
  description: string,
  date?: ISODate,
): RecruitmentHistoryEntry {
  const entry: RecruitmentHistoryEntry = {
    date: date ?? state.date,
    seasonLabel: state.season.label,
    description,
  };
  candidate.history.unshift(entry);
  if (candidate.history.length > 14) candidate.history.length = 14;
  return entry;
}

export function setCandidateStatus(
  state: GameState,
  candidate: RecruitmentCandidate,
  status: CandidateStatus,
  outcome?: string | null,
): void {
  candidate.status = status;
  if (outcome !== undefined) candidate.outcome = outcome;
  candidate.lastReviewedOn = state.date;
  const store = recruitmentStore(state);
  if (status !== 'invited') {
    store.pendingTrialIds = store.pendingTrialIds.filter((id) => id !== candidate.personId);
  } else if (!store.pendingTrialIds.includes(candidate.personId)) {
    store.pendingTrialIds.push(candidate.personId);
  }
}

/** Candidates are people: if the person has gone, the note goes with them. */
export function pruneCandidates(state: GameState): number {
  const store = recruitmentStore(state);
  let removed = 0;
  for (const id of Object.keys(store.candidates)) {
    if (state.people[id]) continue;
    delete store.candidates[id];
    removed += 1;
  }
  store.pendingTrialIds = store.pendingTrialIds.filter((id) => Boolean(state.people[id]));
  return removed;
}

export function candidatesOf(state: GameState): RecruitmentCandidate[] {
  const store = recruitmentStore(state);
  return Object.values(store.candidates).filter((candidate) => Boolean(state.people[candidate.personId]));
}
