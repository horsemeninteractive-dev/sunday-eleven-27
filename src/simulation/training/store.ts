import type { GameState } from '@/domain/game';
import type { ClubId, PersonId } from '@/domain/ids';
import { isPlayer, type Player, createSystemFamiliarity } from '@/domain/person';
import type { TrainingSession, TrainingStore } from '@/domain/training';
import { TRAINING_SESSION_HISTORY_PER_CLUB, emptyTrainingStore } from '@/domain/training';
import { stream } from '../rng';

/**
 * Reading and tidying the training store.
 *
 * The store lives on the game state (there is no second root object), and every
 * accessor here is defensive: an old save, or a state built by a test, may be
 * missing parts of it, and the world should keep working anyway.
 */

export function trainingStore(state: GameState): TrainingStore {
  const existing = state.training as TrainingStore | undefined;
  if (!existing || typeof existing !== 'object') {
    state.training = emptyTrainingStore();
    return state.training;
  }
  if (!existing.plans) existing.plans = {};
  if (!existing.history) existing.history = [];
  if (!existing.development) existing.development = {};
  if (!existing.systemSignatures) existing.systemSignatures = {};
  return existing;
}

export function sessionsFor(state: GameState, clubId: ClubId): TrainingSession[] {
  return trainingStore(state).history.filter((session) => session.clubId === clubId);
}

export function lastSessionFor(state: GameState, clubId: ClubId): TrainingSession | null {
  return sessionsFor(state, clubId)[0] ?? null;
}

/** Has this club's session for the given matchday already been run? */
export function sessionRecordedFor(state: GameState, clubId: ClubId, matchday: number): boolean {
  return trainingStore(state).history.some((session) => session.clubId === clubId && session.matchday === matchday);
}

export function developmentFor(state: GameState, personId: PersonId): Record<string, number> {
  const store = trainingStore(state);
  const existing = store.development[personId];
  if (existing) return existing;
  const created: Record<string, number> = {};
  store.development[personId] = created;
  return created;
}

export function recordSession(state: GameState, session: TrainingSession): void {
  const store = trainingStore(state);
  store.history.unshift(session);
  pruneTrainingHistory(state);
}

/**
 * Nothing grows without bound: keep a short recent history per club and drop
 * development figures for people who have left the world entirely.
 */
export function pruneTrainingHistory(state: GameState, keepPerClub = TRAINING_SESSION_HISTORY_PER_CLUB): void {
  const store = trainingStore(state);
  const counts = new Map<ClubId, number>();
  const kept: TrainingSession[] = [];
  for (const session of store.history) {
    const count = counts.get(session.clubId) ?? 0;
    if (count >= keepPerClub) continue;
    counts.set(session.clubId, count + 1);
    kept.push(session);
  }
  store.history = kept;

  const known = new Set(Object.keys(state.people));
  for (const personId of Object.keys(store.development)) {
    if (!known.has(personId)) delete store.development[personId];
  }
  for (const clubId of Object.keys(store.plans)) {
    if (!state.clubs[clubId]) delete store.plans[clubId];
  }
}

/**
 * Make sure a state carries everything the training system needs. Used by the
 * save migration and, harmlessly, before any conduction: a player who has never
 * had familiarity is given a plausible starting point derived from his age,
 * how long he has been at the club and his adaptability.
 */
export function ensureTrainingState(state: GameState, date = state.date): void {
  trainingStore(state);
  for (const person of Object.values(state.people)) {
    if (!isPlayer(person)) continue;
    const player: Player = person;
    if (!player.systemFamiliarity) {
      player.systemFamiliarity = seedSystemFamiliarity(state, player, date);
    }
  }
}

/**
 * What a player knows of the club's system before anything has happened: the
 * older he is and the longer he has been here, the more of it he has picked up,
 * but nobody starts knowing it inside out.
 */
export function seedSystemFamiliarity(state: GameState, player: Player, date: string): Player['systemFamiliarity'] {
  const rng = stream(state.seed, 'familiarity', player.id);
  const weeksAtClub = weeksSince(player.joinedClubOn, date);
  const tenure = Math.min(1, weeksAtClub / 40);
  const adaptability = player.attributes.hidden.adaptability / 20;
  const base = 6.5 + tenure * 5 + adaptability * 2 + (player.clubId ? 0.5 : -2);
  return createSystemFamiliarity({
    formation: base + rng.gaussian(0, 1.1),
    instructions: base + rng.gaussian(-0.3, 1.2),
    setPieces: base + rng.gaussian(-0.6, 1.3),
  });
}

/** Whole weeks between two dates; 0 when either is unusable. */
export function weeksSince(from: string | null, to: string): number {
  if (!from) return 0;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / (7 * 86400000)));
}
