import type { ISODate, PersonId, RelationshipId } from './ids';

/**
 * Relationships are the social layer of the world: Person → Relationship → Club.
 *
 * A relationship is a single record shared by two people, with **two
 * independent attitudes** inside it. People are not assumed to feel the same
 * way about each other — Dave can respect Kev while Kev cannot stand Dave — but
 * there is still only one record for the pair, so there is nothing to keep in
 * step and nothing to duplicate.
 *
 * The record also knows *why* it exists (its origin) and *what has happened* in
 * it (its history), which is what later systems — recruitment by word of mouth,
 * gossip, club politics, biographies — will read.
 */

/**
 * Why two people know each other. Deliberately a small, growing subset of the
 * contexts the design document describes; new origins can be added without
 * changing the shape of a relationship.
 */
export type RelationshipOrigin =
  | 'current-teammates'
  | 'former-teammates'
  | 'five-a-side'
  | 'school'
  | 'work-colleagues'
  | 'same-pub'
  | 'neighbour'
  | 'player-manager'
  | 'former-manager'
  | 'manager-manager'
  | 'club-committee'
  | 'local-football'
  | 'rival-club'
  | 'recommendation';

export const RELATIONSHIP_ORIGIN_LABEL: Record<RelationshipOrigin, string> = {
  'current-teammates': 'Current teammate',
  'former-teammates': 'Former teammate',
  'five-a-side': 'Five-a-side',
  school: 'School',
  'work-colleagues': 'Work colleagues',
  'same-pub': 'Same pub',
  neighbour: 'Neighbours',
  'player-manager': 'Player and manager',
  'former-manager': 'Former manager',
  'manager-manager': 'Fellow manager',
  'club-committee': 'Club committee',
  'local-football': 'Local football',
  'rival-club': 'Rival club',
  recommendation: 'Put his name forward',
};

/**
 * One person's attitude toward another. All values are 0-100.
 *
 * Friendship, respect and trust are independent on purpose: you can respect
 * somebody you do not like, and trust somebody you do not rate. Tension is
 * accumulated friction that has not been resolved; loyalty is the pull of the
 * shared shirt rather than personal affection.
 */
export interface RelationshipAttitude {
  friendship: number;
  respect: number;
  trust: number;
  tension: number;
  loyalty: number;
}

export const ATTITUDE_MIN = 0;
export const ATTITUDE_MAX = 100;

export function clampAttitudeValue(value: number): number {
  if (!Number.isFinite(value)) return ATTITUDE_MIN;
  return Math.max(ATTITUDE_MIN, Math.min(ATTITUDE_MAX, Math.round(value * 10) / 10));
}

/** How people feel about somebody they have only just come across. */
export function neutralAttitude(): RelationshipAttitude {
  return { friendship: 30, respect: 50, trust: 45, tension: 0, loyalty: 40 };
}

export function createAttitude(partial: Partial<RelationshipAttitude> = {}): RelationshipAttitude {
  const base = neutralAttitude();
  return {
    friendship: clampAttitudeValue(partial.friendship ?? base.friendship),
    respect: clampAttitudeValue(partial.respect ?? base.respect),
    trust: clampAttitudeValue(partial.trust ?? base.trust),
    tension: clampAttitudeValue(partial.tension ?? base.tension),
    loyalty: clampAttitudeValue(partial.loyalty ?? base.loyalty),
  };
}

/** How the manager came to know about a relationship — the gossip groundwork. */
export type RelationshipProvenance = 'observed' | 'known' | 'reported' | 'inferred';

export const RELATIONSHIP_PROVENANCE_LABEL: Record<RelationshipProvenance, string> = {
  observed: 'You have seen this',
  known: 'You know this',
  reported: 'Reported to you',
  inferred: 'Only gossip',
};

const PROVENANCE_RANK: Record<RelationshipProvenance, number> = {
  inferred: 0,
  reported: 1,
  known: 2,
  observed: 3,
};

/** Keep the more certain of two provenance claims. */
export function strongerProvenance(
  a: RelationshipProvenance,
  b: RelationshipProvenance,
): RelationshipProvenance {
  return PROVENANCE_RANK[a] >= PROVENANCE_RANK[b] ? a : b;
}

export interface RelationshipHistoryEntry {
  date: ISODate;
  seasonLabel: string;
  description: string;
  tone: 'positive' | 'negative' | 'neutral';
}

export const RELATIONSHIP_HISTORY_LIMIT = 12;

export interface Relationship {
  id: RelationshipId;
  /** Canonical order: the two ids are stored sorted so a pair has one record. */
  personAId: PersonId;
  personBId: PersonId;
  origin: RelationshipOrigin;
  /** Shared context, e.g. "Teammates at Holmere Athletic". */
  context: string | null;
  /** How person A feels about person B. */
  aToB: RelationshipAttitude;
  /** How person B feels about person A. */
  bToA: RelationshipAttitude;
  /** 0-100 closeness derived from both attitudes; used for grouping queries. */
  strength: number;
  established: ISODate;
  lastInteraction: ISODate | null;
  /** Most recent first. */
  history: RelationshipHistoryEntry[];
  /** How much the player actually knows about this relationship. */
  provenance: RelationshipProvenance;
}

/**
 * The relationship graph. `byPerson` is a plain index kept in step by the
 * relationship service; `rebuildRelationshipIndex` can always regenerate it
 * from `byId`, which is what makes save/load safe.
 */
export interface RelationshipStore {
  byId: Record<RelationshipId, Relationship>;
  byPerson: Record<PersonId, RelationshipId[]>;
}

export function emptyRelationshipStore(): RelationshipStore {
  return { byId: {}, byPerson: {} };
}

/** Canonical id for a pair, so A↔B and B↔A are the same relationship. */
export function relationshipIdFor(a: PersonId, b: PersonId): RelationshipId {
  return a <= b ? `rel__${a}__${b}` : `rel__${b}__${a}`;
}

/** Pair ids in canonical order, with the seeded attitudes put the right way round. */
export function orderPair<TA, TB>(
  aId: PersonId,
  bId: PersonId,
  aValue: TA,
  bValue: TB,
): { personAId: PersonId; personBId: PersonId; aToB: TA | TB; bToA: TA | TB } {
  const swap = aId > bId;
  return {
    personAId: swap ? bId : aId,
    personBId: swap ? aId : bId,
    aToB: swap ? bValue : aValue,
    bToA: swap ? aValue : bValue,
  };
}

/**
 * Closeness across the whole relationship: both sides' affection and trust,
 * knocked down by whatever friction has built up.
 */
export function relationshipStrength(aToB: RelationshipAttitude, bToA: RelationshipAttitude): number {
  const a = (aToB.friendship + aToB.trust) / 2;
  const b = (bToA.friendship + bToA.trust) / 2;
  const tension = (aToB.tension + bToA.tension) / 2;
  return clampAttitudeValue((a + b) / 2 - tension * 0.6);
}

/** Register a relationship, keeping the per-person index in step. Idempotent. */
export function indexRelationship(store: RelationshipStore, relationship: Relationship): void {
  store.byId[relationship.id] = relationship;
  addToPersonIndex(store, relationship.personAId, relationship.id);
  addToPersonIndex(store, relationship.personBId, relationship.id);
}

function addToPersonIndex(store: RelationshipStore, personId: PersonId, id: RelationshipId): void {
  const list = store.byPerson[personId];
  if (!list) {
    store.byPerson[personId] = [id];
    return;
  }
  if (!list.includes(id)) list.push(id);
}

export function relationshipOther(relationship: Relationship, personId: PersonId): PersonId {
  return relationship.personAId === personId ? relationship.personBId : relationship.personAId;
}

/** The attitude `personId` holds inside this relationship, if they are in it. */
export function attitudeOf(relationship: Relationship, personId: PersonId): RelationshipAttitude | null {
  if (relationship.personAId === personId) return relationship.aToB;
  if (relationship.personBId === personId) return relationship.bToA;
  return null;
}

/** The attitude the *other* participant holds toward `personId`. */
export function attitudeToward(relationship: Relationship, personId: PersonId): RelationshipAttitude | null {
  if (relationship.personAId === personId) return relationship.bToA;
  if (relationship.personBId === personId) return relationship.aToB;
  return null;
}

export type RelationshipTone = 'close' | 'good' | 'neutral' | 'cool' | 'poor' | 'hostile';

export interface AttitudeSummary {
  label: string;
  tone: RelationshipTone;
}

/**
 * Turn an attitude into something a person would actually say. Numbers stay
 * internal; the UI shows these words.
 */
export function summariseAttitude(attitude: RelationshipAttitude): AttitudeSummary {
  const positive = attitude.friendship * 0.5 + attitude.trust * 0.3 + attitude.respect * 0.2;
  const balance = positive - attitude.tension * 0.8;

  if (attitude.tension >= 76 && balance < 30) return { label: 'Fallen out badly', tone: 'hostile' };
  if (attitude.tension >= 56) {
    return attitude.friendship < 38
      ? { label: 'Barely speaking', tone: 'poor' }
      : { label: 'Strained', tone: 'poor' };
  }
  if (attitude.friendship >= 82 && attitude.trust >= 68) return { label: 'Close friends', tone: 'close' };
  if (attitude.friendship >= 66) return { label: 'Friends', tone: 'good' };
  if (balance >= 62) return { label: 'Good relationship', tone: 'good' };
  if (balance >= 46) return { label: 'Gets on fine', tone: 'neutral' };
  if (balance >= 34) return { label: 'Acquaintances', tone: 'cool' };
  if (balance >= 22) return { label: 'Little time for him', tone: 'poor' };
  return { label: 'Poor relationship', tone: 'poor' };
}
