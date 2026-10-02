import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import {
  RELATIONSHIP_HISTORY_LIMIT,
  RELATIONSHIP_ORIGIN_LABEL,
  attitudeOf,
  attitudeToward,
  clampAttitudeValue,
  createAttitude,
  emptyRelationshipStore,
  indexRelationship,
  orderPair,
  relationshipIdFor,
  relationshipOther,
  relationshipStrength,
  strongerProvenance,
  summariseAttitude,
  type AttitudeSummary,
  type Relationship,
  type RelationshipAttitude,
  type RelationshipHistoryEntry,
  type RelationshipOrigin,
  type RelationshipProvenance,
  type RelationshipStore,
} from '@/domain/relationship';

/**
 * The relationship service.
 *
 * Everything that wants to know about, create or change a relationship goes
 * through here, so the store and its per-person index can never drift apart and
 * so every change is traceable to a named event rather than a random drift.
 *
 * Relationships change because something happened — a match was won, someone
 * was left out, two lads had a row, a player moved on. Nothing here mutates a
 * relationship on a timer.
 */

const PROVENANCE_ORDER: Record<RelationshipProvenance, number> = {
  inferred: 0,
  reported: 1,
  known: 2,
  observed: 3,
};

export function personName(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  if (!person) return 'Someone';
  return `${person.firstName} ${person.surname}`;
}

/** The store, created on demand so old saves can be repaired in place. */
export function relationshipStore(state: GameState): RelationshipStore {
  const existing = state.relationships as RelationshipStore | undefined;
  if (existing && existing.byId && existing.byPerson) return existing;
  const store = emptyRelationshipStore();
  state.relationships = store;
  return store;
}

export function getRelationship(
  state: GameState,
  aId: PersonId,
  bId: PersonId,
): Relationship | undefined {
  if (aId === bId) return undefined;
  const store = relationshipStore(state);
  const direct = store.byId[relationshipIdFor(aId, bId)];
  if (direct) return direct;
  // Tolerate records written before ids were canonicalised.
  for (const id of store.byPerson[aId] ?? []) {
    const candidate = store.byId[id];
    if (candidate && (candidate.personAId === bId || candidate.personBId === bId)) return candidate;
  }
  return undefined;
}

/**
 * Rebuild the per-person index from the records themselves, dropping duplicate
 * pair records and references to people who no longer exist. Safe to call at
 * any time; called after loading a save.
 */
export function rebuildRelationshipIndex(state: GameState): { duplicates: number; relationships: number } {
  const store = relationshipStore(state);
  const rebuilt = emptyRelationshipStore();
  let duplicates = 0;

  for (const relationship of Object.values(store.byId)) {
    if (!relationship || !relationship.personAId || !relationship.personBId) continue;
    if (!state.people[relationship.personAId] || !state.people[relationship.personBId]) continue;
    const id = relationshipIdFor(relationship.personAId, relationship.personBId);
    const canonical: Relationship = { ...relationship, id };
    const existing = rebuilt.byId[id];
    if (!existing) {
      indexRelationship(rebuilt, canonical);
      continue;
    }
    duplicates += 1;
    // Keep whichever record carries the richer history.
    if (canonical.history.length > existing.history.length) {
      rebuilt.byPerson[canonical.personAId] = (rebuilt.byPerson[canonical.personAId] ?? []).filter(
        (entry) => entry !== id,
      );
      rebuilt.byPerson[canonical.personBId] = (rebuilt.byPerson[canonical.personBId] ?? []).filter(
        (entry) => entry !== id,
      );
      delete rebuilt.byId[id];
      indexRelationship(rebuilt, canonical);
    }
  }

  // Preserve index entries for people with no relationships at all.
  const byPerson: Record<PersonId, string[]> = {};
  for (const [personId, ids] of Object.entries(store.byPerson)) {
    if (!state.people[personId]) continue;
    const live = ids.filter((id) => rebuilt.byId[id]);
    if (live.length > 0) byPerson[personId] = live;
  }
  for (const id of Object.keys(rebuilt.byId)) {
    const relationship = rebuilt.byId[id]!;
    byPerson[relationship.personAId] = rebuilt.byPerson[relationship.personAId] ?? [];
    byPerson[relationship.personBId] = rebuilt.byPerson[relationship.personBId] ?? [];
  }

  store.byId = rebuilt.byId;
  store.byPerson = byPerson;
  return { duplicates, relationships: Object.keys(store.byId).length };
}

/**
 * Forget somebody who has left the world, and every relationship that named
 * them.
 *
 * A departed free agent is deleted from `state.people`, which leaves any
 * relationship naming him pointing at nobody. The save loader prunes those links
 * on the next load, so leaving them in place makes a running career and a
 * reloaded one differ in the social world. Removing them here keeps the two in
 * step: what happens to a man who leaves is the same whether or not the manager
 * saves first.
 *
 * Safe to call for somebody with no relationships, and for somebody who is not
 * in `state.people` at all. Returns how many links were removed.
 */
export function removePersonRelationships(state: GameState, personId: PersonId): number {
  const store = relationshipStore(state);
  // Read the records themselves rather than trusting the index, so a store that
  // was already partly stale is cleaned up rather than half-cleaned.
  const doomed = Object.values(store.byId).filter(
    (relationship) =>
      !!relationship && (relationship.personAId === personId || relationship.personBId === personId),
  );

  for (const relationship of doomed) {
    delete store.byId[relationship.id];
    for (const side of [relationship.personAId, relationship.personBId]) {
      const list = store.byPerson[side];
      if (!list) continue;
      const remaining = list.filter((entry) => entry !== relationship.id);
      if (remaining.length > 0) store.byPerson[side] = remaining;
      else delete store.byPerson[side];
    }
  }
  delete store.byPerson[personId];
  return doomed.length;
}

export interface RelationshipSeed {
  aId: PersonId;
  bId: PersonId;
  origin: RelationshipOrigin;
  context?: string | null;
  aToB?: Partial<RelationshipAttitude>;
  bToA?: Partial<RelationshipAttitude>;
  provenance?: RelationshipProvenance;
  date?: ISODate;
}

/** Create a relationship if it does not exist. Existing relationships are left alone. */
export function upsertRelationship(state: GameState, seed: RelationshipSeed): Relationship {
  const store = relationshipStore(state);
  const existing = getRelationship(state, seed.aId, seed.bId);
  if (existing) return existing;

  const ordered = orderPair(seed.aId, seed.bId, seed.aToB ?? {}, seed.bToA ?? {});
  const date = seed.date ?? state.date;
  const relationship: Relationship = {
    id: relationshipIdFor(seed.aId, seed.bId),
    personAId: ordered.personAId,
    personBId: ordered.personBId,
    origin: seed.origin,
    context: seed.context ?? null,
    aToB: createAttitude(ordered.aToB),
    bToA: createAttitude(ordered.bToA),
    strength: 0,
    established: date,
    lastInteraction: null,
    history: [],
    provenance: seed.provenance ?? 'observed',
  };
  relationship.strength = relationshipStrength(relationship.aToB, relationship.bToA);
  indexRelationship(store, relationship);
  return relationship;
}

export interface InteractionInput {
  aId: PersonId;
  bId: PersonId;
  /** Deltas applied to A's attitude toward B. */
  aToB?: Partial<RelationshipAttitude>;
  bToA?: Partial<RelationshipAttitude>;
  description: string;
  tone?: 'positive' | 'negative' | 'neutral';
  date?: ISODate;
  provenance?: RelationshipProvenance;
}

function applyDeltas(
  attitude: RelationshipAttitude,
  deltas: Partial<RelationshipAttitude> | undefined,
): RelationshipAttitude {
  if (!deltas) return { ...attitude };
  return {
    friendship: clampAttitudeValue(attitude.friendship + (deltas.friendship ?? 0)),
    respect: clampAttitudeValue(attitude.respect + (deltas.respect ?? 0)),
    trust: clampAttitudeValue(attitude.trust + (deltas.trust ?? 0)),
    tension: clampAttitudeValue(attitude.tension + (deltas.tension ?? 0)),
    loyalty: clampAttitudeValue(attitude.loyalty + (deltas.loyalty ?? 0)),
  };
}

function netChange(deltas: Partial<RelationshipAttitude> | undefined): number {
  if (!deltas) return 0;
  return (
    (deltas.friendship ?? 0) +
    (deltas.trust ?? 0) * 0.8 +
    (deltas.respect ?? 0) * 0.6 +
    (deltas.loyalty ?? 0) * 0.6 -
    (deltas.tension ?? 0) * 1.2
  );
}

/** Apply a change, record why, and keep derived values in step. */
export function recordInteraction(state: GameState, input: InteractionInput): Relationship | null {
  const relationship = getRelationship(state, input.aId, input.bId);
  if (!relationship) return null;

  const aIsA = relationship.personAId === input.aId;
  relationship.aToB = applyDeltas(relationship.aToB, aIsA ? input.aToB : input.bToA);
  relationship.bToA = applyDeltas(relationship.bToA, aIsA ? input.bToA : input.aToB);
  relationship.strength = relationshipStrength(relationship.aToB, relationship.bToA);
  relationship.lastInteraction = input.date ?? state.date;

  const direction = netChange(input.aToB) + netChange(input.bToA);
  const tone = input.tone ?? (direction > 0.5 ? 'positive' : direction < -0.5 ? 'negative' : 'neutral');
  const entry: RelationshipHistoryEntry = {
    date: input.date ?? state.date,
    seasonLabel: state.season.label,
    description: input.description,
    tone,
  };
  relationship.history.unshift(entry);
  if (relationship.history.length > RELATIONSHIP_HISTORY_LIMIT) {
    relationship.history.length = RELATIONSHIP_HISTORY_LIMIT;
  }

  if (input.provenance) {
    relationship.provenance = strongerProvenance(input.provenance, relationship.provenance);
  }
  return relationship;
}

/**
 * The relationship events the current simulation can actually produce. Each one
 * is a small, self-contained reason for two people to feel differently about
 * each other; nothing here fires on a schedule.
 */
export type RelationshipEventType =
  | 'shared-success'
  | 'manager-praise'
  | 'manager-criticism'
  | 'dropped'
  | 'teammate-argument'
  | 'teammate-support'
  | 'recommendation'
  | 'joined-club'
  | 'left-club';

interface RelationshipEffect {
  aToB: Partial<RelationshipAttitude>;
  bToA: Partial<RelationshipAttitude>;
  phrase: (actor: string, other: string) => string;
  /** Short version, for a news headline. */
  headline: (actor: string, other: string) => string;
  importance: 1 | 2 | 3;
  tone: 'positive' | 'negative' | 'neutral';
  /** Created on demand when the pair have no relationship yet. */
  origin?: RelationshipOrigin;
  context?: string;
}

const EFFECTS: Record<RelationshipEventType, RelationshipEffect> = {
  'shared-success': {
    aToB: { friendship: 3, trust: 2, loyalty: 2, tension: -2 },
    bToA: { friendship: 3, trust: 2, loyalty: 2, tension: -2 },
    phrase: (actor, other) => `${actor} and ${other} enjoyed that one together`,
    headline: (actor, other) => `${actor} and ${other} on the same wavelength`,
    importance: 1,
    tone: 'positive',
  },
  'manager-praise': {
    aToB: { trust: 3, respect: 2, tension: -1.5, loyalty: 1 },
    bToA: { respect: 2.5, trust: 1.5, tension: -1 },
    phrase: (actor, other) => `${other} made it clear he rates ${actor}`,
    headline: (actor, other) => `${other} pleased with ${actor}`,
    importance: 1,
    tone: 'positive',
  },
  'manager-criticism': {
    aToB: { trust: -3, tension: 3, friendship: -1 },
    bToA: { respect: -1.5, tension: 2 },
    phrase: (actor, other) => `${other} had a go at ${actor} in front of the rest`,
    headline: (actor, other) => `${other} reads the riot act to ${actor}`,
    importance: 2,
    tone: 'negative',
  },
  dropped: {
    aToB: { trust: -2.5, tension: 3.5, loyalty: -1.5, friendship: -0.5 },
    bToA: { respect: -1, tension: 1 },
    phrase: (actor) => `${actor} was left out and is not happy about it`,
    headline: (actor) => `${actor} not happy at being left out`,
    importance: 2,
    tone: 'negative',
  },
  'teammate-argument': {
    aToB: { friendship: -4, trust: -3, tension: 7 },
    bToA: { friendship: -4, trust: -3, tension: 7 },
    phrase: (actor, other) => `${actor} and ${other} had a proper row`,
    headline: (actor, other) => `Bust-up between ${actor} and ${other}`,
    importance: 2,
    tone: 'negative',
  },
  'teammate-support': {
    aToB: { friendship: 4, trust: 4, respect: 2, loyalty: 2, tension: -3 },
    bToA: { friendship: 4, trust: 4, respect: 2, loyalty: 2, tension: -3 },
    phrase: (actor, other) => `${actor} helped ${other} out when it mattered`,
    headline: (actor, other) => `${actor} backs ${other}`,
    importance: 1,
    tone: 'positive',
  },
  recommendation: {
    aToB: { respect: 2, friendship: 2, loyalty: 1 },
    bToA: { trust: 5, loyalty: 5, friendship: 3 },
    phrase: (actor, other) => `${actor} put ${other}'s name forward`,
    headline: (actor, other) => `${actor} puts a word in for ${other}`,
    importance: 2,
    tone: 'positive',
    origin: 'recommendation',
    context: 'Word of mouth',
  },
  'joined-club': {
    aToB: { friendship: 8, trust: 5, loyalty: 4, tension: -4 },
    bToA: { friendship: 6, trust: 5, loyalty: 4, tension: -4 },
    phrase: (actor, other) => `${actor} came in and got chatting to ${other}`,
    headline: (actor) => `${actor} settles in with the squad`,
    importance: 1,
    tone: 'positive',
    origin: 'current-teammates',
  },
  'left-club': {
    aToB: { loyalty: -6, tension: 1.5, friendship: -1 },
    bToA: { loyalty: -6, tension: 1.5, friendship: -1 },
    phrase: (actor, other) => `${actor} moved on, and it stung for ${other}`,
    headline: (actor) => `${actor} moves on`,
    importance: 1,
    tone: 'negative',
  },
};

export interface RelationshipEventInput {
  type: RelationshipEventType;
  /** The actor in the event: for a praise, the player; for a row, whoever started it. */
  aId: PersonId;
  bId: PersonId;
  /** Effect multiplier; 1 is a normal occurrence, 0.5 a mild one. */
  intensity?: number;
  /** Extra factual detail appended to the history line. */
  detail?: string;
  date?: ISODate;
  clubId?: ClubId;
}

export interface RelationshipEventResult {
  relationship: Relationship;
  description: string;
  headline: string;
  importance: 1 | 2 | 3;
  tone: 'positive' | 'negative' | 'neutral';
}

export function applyRelationshipEvent(
  state: GameState,
  input: RelationshipEventInput,
): RelationshipEventResult | null {
  if (input.aId === input.bId) return null;
  const effect = EFFECTS[input.type];
  const intensity = Math.max(0.25, Math.min(2, input.intensity ?? 1));

  let relationship = getRelationship(state, input.aId, input.bId);
  if (!relationship) {
    if (!effect.origin) return null;
    relationship = upsertRelationship(state, {
      aId: input.aId,
      bId: input.bId,
      origin: effect.origin,
      context: effect.context ?? null,
      date: input.date ?? state.date,
    });
  }

  const scale = (deltas: Partial<RelationshipAttitude>): Partial<RelationshipAttitude> => ({
    friendship: (deltas.friendship ?? 0) * intensity,
    respect: (deltas.respect ?? 0) * intensity,
    trust: (deltas.trust ?? 0) * intensity,
    tension: (deltas.tension ?? 0) * intensity,
    loyalty: (deltas.loyalty ?? 0) * intensity,
  });

  const actor = personName(state, input.aId);
  const other = personName(state, input.bId);
  let description = effect.phrase(actor, other);
  const headline = effect.headline(actor, other);
  if (input.detail) description = `${description} — ${input.detail}`;
  if (relationship.context === null && effect.context) relationship.context = effect.context;

  recordInteraction(state, {
    aId: input.aId,
    bId: input.bId,
    aToB: scale(effect.aToB),
    bToA: scale(effect.bToA),
    description,
    tone: effect.tone,
    date: input.date,
    provenance: 'observed',
  });

  return { relationship, description, headline, importance: effect.importance, tone: effect.tone };
}

export interface RelationshipView {
  relationship: Relationship;
  otherId: PersonId;
  /** How this person feels about the other. */
  attitude: RelationshipAttitude;
  /** How the other feels about this person. */
  theirAttitude: RelationshipAttitude;
  summary: AttitudeSummary;
  theirSummary: AttitudeSummary;
  origin: RelationshipOrigin;
  originLabel: string;
  context: string | null;
  provenance: RelationshipProvenance;
  lastInteraction: ISODate | null;
  latest: RelationshipHistoryEntry | null;
  strength: number;
}

export function relationshipViewsFor(state: GameState, personId: PersonId): RelationshipView[] {
  const store = relationshipStore(state);
  const views: RelationshipView[] = [];
  for (const id of store.byPerson[personId] ?? []) {
    const relationship = store.byId[id];
    if (!relationship) continue;
    const attitude = attitudeOf(relationship, personId);
    const theirAttitude = attitudeToward(relationship, personId);
    if (!attitude || !theirAttitude) continue;
    views.push({
      relationship,
      otherId: relationshipOther(relationship, personId),
      attitude,
      theirAttitude,
      summary: summariseAttitude(attitude),
      theirSummary: summariseAttitude(theirAttitude),
      origin: relationship.origin,
      originLabel: RELATIONSHIP_ORIGIN_LABEL[relationship.origin],
      context: relationship.context,
      provenance: relationship.provenance,
      lastInteraction: relationship.lastInteraction,
      latest: relationship.history[0] ?? null,
      strength: relationship.strength,
    });
  }
  return views.sort((a, b) => b.strength - a.strength);
}

/**
 * What the manager can actually find out about. His own dressing room is in
 * front of him every week; anything beyond it is gossip unless he has a reason
 * to know.
 */
export function visibleRelationshipViewsFor(state: GameState, personId: PersonId): RelationshipView[] {
  const userManagerId = state.clubs[state.userClubId]?.managerId ?? null;
  const userClubId = state.userClubId;
  return relationshipViewsFor(state, personId).filter((view) => {
    if (personId === userManagerId || view.otherId === userManagerId) return true;
    const other = state.people[view.otherId];
    const subject = state.people[personId];
    const otherClubId = other && 'clubId' in other ? other.clubId : null;
    const subjectClubId = subject && 'clubId' in subject ? subject.clubId : null;
    if (otherClubId === userClubId && subjectClubId === userClubId) return true;
    return PROVENANCE_ORDER[view.provenance] >= PROVENANCE_ORDER.known;
  });
}

export interface SocialGroup {
  id: string;
  clubId: ClubId;
  memberIds: PersonId[];
  /** 0-100 average internal closeness. */
  cohesion: number;
  dominantOrigin: RelationshipOrigin;
  /** Derived from the members themselves — never a hard-coded faction name. */
  label: string;
  /** Who the group listens to, if anybody. */
  leaderId: PersonId | null;
}

/**
 * Social groups are *derived* from the graph: a group is a set of players at a
 * club who are all connected through reasonably close relationships. Nobody is
 * assigned to a faction; the dressing room's shape falls out of who gets on
 * with whom.
 */
export function socialGroupsFor(
  state: GameState,
  clubId: ClubId,
  options: { threshold?: number; minSize?: number } = {},
): SocialGroup[] {
  const threshold = options.threshold ?? 46;
  const minSize = options.minSize ?? 3;
  const club = state.clubs[clubId];
  if (!club) return [];
  const members = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  const memberIds = new Set(members.map((member) => member.id));

  const parent = new Map<PersonId, PersonId>();
  const find = (id: PersonId): PersonId => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const union = (a: PersonId, b: PersonId): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  for (const member of members) parent.set(member.id, member.id);

  const store = relationshipStore(state);
  for (const member of members) {
    for (const id of store.byPerson[member.id] ?? []) {
      const relationship = store.byId[id];
      if (!relationship || relationship.strength < threshold) continue;
      const other = relationshipOther(relationship, member.id);
      if (!memberIds.has(other)) continue;
      union(member.id, other);
    }
  }

  const buckets = new Map<PersonId, PersonId[]>();
  for (const member of members) {
    const root = find(member.id);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(member.id);
    else buckets.set(root, [member.id]);
  }

  const groups: SocialGroup[] = [];
  for (const [root, ids] of buckets) {
    if (ids.length < minSize) continue;
    const pairs: number[] = [];
    const originCounts = new Map<RelationshipOrigin, number>();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const relationship = getRelationship(state, ids[i]!, ids[j]!);
        if (!relationship) continue;
        pairs.push(relationship.strength);
        originCounts.set(relationship.origin, (originCounts.get(relationship.origin) ?? 0) + 1);
      }
    }
    const cohesion = pairs.length > 0 ? Math.round(pairs.reduce((sum, value) => sum + value, 0) / pairs.length) : 0;
    const dominantOrigin =
      [...originCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'current-teammates';
    groups.push({
      id: `group_${clubId}_${root}`,
      clubId,
      memberIds: ids,
      cohesion,
      dominantOrigin,
      label: deriveGroupLabel(members.filter((member) => ids.includes(member.id)), dominantOrigin),
      leaderId: findGroupLeader(state, ids),
    });
  }

  return groups.sort((a, b) => b.memberIds.length - a.memberIds.length || b.cohesion - a.cohesion);
}

function deriveGroupLabel(members: Player[], dominantOrigin: RelationshipOrigin): string {
  const averageAge = members.reduce((sum, member) => sum + member.age, 0) / Math.max(1, members.length);
  if (averageAge >= 31) return 'The old guard';
  if (dominantOrigin === 'five-a-side') return 'The five-a-side crowd';
  if (averageAge <= 23) return 'The young lads';
  if (dominantOrigin === 'work-colleagues') return 'The lads who work together';
  return 'A tight little group';
}

function findGroupLeader(state: GameState, memberIds: PersonId[]): PersonId | null {
  let best: { id: PersonId; score: number } | null = null;
  for (const id of memberIds) {
    const respect = memberIds
      .filter((other) => other !== id)
      .map((other) => getRelationship(state, id, other))
      .map((relationship) => (relationship ? attitudeToward(relationship, id)?.respect ?? 0 : 0));
    if (respect.length === 0) continue;
    const score = respect.reduce((sum, value) => sum + value, 0) / respect.length;
    if (!best || score > best.score) best = { id, score };
  }
  return best && best.score >= 55 ? best.id : null;
}

export interface SocialProfile {
  personId: PersonId;
  clubId: ClubId | null;
  closeFriends: number;
  respectedBy: number;
  tensionWith: number;
  groupId: string | null;
  /** 0-100: how much weight his opinion carries inside the dressing room. */
  influence: number;
  informalLeader: boolean;
  troublemaker: boolean;
}

/**
 * The minimum foundation for captaincy and dressing-room influence: leadership
 * is worked out from what teammates actually think of somebody (respect),
 * rather than stored as a magic attribute.
 */
export function socialProfileOf(state: GameState, personId: PersonId): SocialProfile {
  const person = state.people[personId];
  const clubId = person && 'clubId' in person ? person.clubId : null;
  const club = clubId ? state.clubs[clubId] : undefined;
  const views = clubId
    ? relationshipViewsFor(state, personId).filter((view) => {
        const other = state.people[view.otherId];
        return isPlayer(other) && other.clubId === clubId;
      })
    : [];

  const closeFriends = views.filter((view) => view.attitude.friendship >= 62 && view.attitude.tension < 40).length;
  const respectedBy = views.filter((view) => view.theirAttitude.respect >= 60).length;
  const tensionWith = views.filter((view) => view.attitude.tension >= 45 || view.theirAttitude.tension >= 45).length;
  const meanRespect =
    views.length > 0
      ? views.reduce((sum, view) => sum + view.theirAttitude.respect, 0) / views.length
      : 50;
  const group = club ? socialGroupsFor(state, clubId!).find((entry) => entry.memberIds.includes(personId)) : undefined;

  const player = person && isPlayer(person) ? person : null;
  const nous = player ? (player.attributes.mental.determination + player.attributes.behavioural.commitment) / 2 : 10;
  const ageBoost = player ? Math.max(0, Math.min(12, (player.age - 24) * 0.9)) : 0;
  const influence = Math.round(
    Math.max(0, Math.min(100, meanRespect * 0.72 + nous * 1.1 + ageBoost + (player ? player.reputation / 12 : 0))),
  );

  return {
    personId,
    clubId,
    closeFriends,
    respectedBy,
    tensionWith,
    groupId: group?.id ?? null,
    influence,
    informalLeader: influence >= 62 && respectedBy >= 3,
    troublemaker: tensionWith >= 2,
  };
}

/**
 * Morale is a broad state — playing time, form, results, fitness, life — and a
 * relationship is one input to it, never a replacement. A player who trusts and
 * feels loyal to his manager, and who is close to the lads around him, carries
 * a few points of resilience into a bad week.
 */
export function moraleInputFromRelationships(state: GameState, player: Player): number {
  let delta = 0;

  const managerId = player.clubId ? state.clubs[player.clubId]?.managerId : null;
  if (managerId && managerId !== player.id) {
    const relationship = getRelationship(state, player.id, managerId);
    const attitude = relationship ? attitudeOf(relationship, player.id) : null;
    if (attitude) {
      delta += (attitude.trust - 50) / 22;
      delta += (attitude.loyalty - 50) / 32;
      delta -= attitude.tension / 26;
    }
  }

  const teamViews = relationshipViewsFor(state, player.id)
    .filter((view) => {
      const other = state.people[view.otherId];
      return isPlayer(other) && other.clubId === player.clubId && other.id !== player.id;
    })
    .sort((a, b) => b.relationship.strength - a.relationship.strength)
    .slice(0, 5);
  if (teamViews.length > 0) {
    const average =
      teamViews.reduce((sum, view) => sum + view.attitude.friendship - view.attitude.tension * 0.5, 0) /
      teamViews.length;
    delta += (average - 50) / 45;
  }

  return Math.max(-3.5, Math.min(3.5, Math.round(delta * 10) / 10));
}

export interface ContactQuery {
  /** Restrict to particular ways of knowing each other. */
  origins?: RelationshipOrigin[];
  /** Only relationships at least this close. */
  minStrength?: number;
  /** Only people currently at this club. */
  atClubId?: ClubId;
  /** Only people at a different club to this person. */
  outsideHisClub?: boolean;
}

/**
 * Who does this person know? The foundation the recruitment system will ask
 * this question through: "who played with him before?", "who might know an
 * unattached player?", "who does he trust enough to act on a word?"
 */
export function contactsOf(state: GameState, personId: PersonId, query: ContactQuery = {}): RelationshipView[] {
  const subjectClubId = clubIdOf(state, personId);
  return relationshipViewsFor(state, personId).filter((view) => {
    if (query.origins && !query.origins.includes(view.origin)) return false;
    if (query.minStrength !== undefined && view.strength < query.minStrength) return false;
    const otherClubId = clubIdOf(state, view.otherId);
    if (query.atClubId !== undefined && otherClubId !== query.atClubId) return false;
    if (query.outsideHisClub && otherClubId === subjectClubId) return false;
    return true;
  });
}

/** People who would take this person at his word — a recruitment shortlist, later. */
export function trustedContactsOf(state: GameState, personId: PersonId, minTrust = 55): RelationshipView[] {
  return relationshipViewsFor(state, personId).filter((view) => view.theirAttitude.trust >= minTrust);
}

export interface RelationshipCounts {
  total: number;
  withinUserClub: number;
  acrossClubs: number;
  strained: number;
  close: number;
}

/** A small summary used by tests and by the world view. */
export function relationshipCounts(state: GameState): RelationshipCounts {
  const store = relationshipStore(state);
  const userClubId = state.userClubId;
  let withinUserClub = 0;
  let acrossClubs = 0;
  let strained = 0;
  let close = 0;

  for (const relationship of Object.values(store.byId)) {
    const clubA = clubIdOf(state, relationship.personAId);
    const clubB = clubIdOf(state, relationship.personBId);
    if (clubA && clubB && clubA !== clubB) acrossClubs += 1;
    if (clubA === userClubId && clubB === userClubId) withinUserClub += 1;
    if (relationship.aToB.tension >= 50 || relationship.bToA.tension >= 50) strained += 1;
    if (relationship.strength >= 62) close += 1;
  }

  return { total: Object.keys(store.byId).length, withinUserClub, acrossClubs, strained, close };
}

function clubIdOf(state: GameState, personId: PersonId): ClubId | null {
  const person = state.people[personId];
  return person && 'clubId' in person ? person.clubId : null;
}
