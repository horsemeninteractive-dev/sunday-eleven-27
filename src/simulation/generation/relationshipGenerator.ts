import type { Club } from '@/domain/club';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import { isOfficial, isPlayer, type Person, type Player } from '@/domain/person';
import {
  createAttitude,
  emptyRelationshipStore,
  indexRelationship,
  orderPair,
  relationshipIdFor,
  relationshipStrength,
  type Relationship,
  type RelationshipAttitude,
  type RelationshipOrigin,
  type RelationshipProvenance,
  type RelationshipStore,
} from '@/domain/relationship';
import { Rng, stream } from '../rng';
import { staffMembers } from '../staff';

/**
 * Initial social network generation.
 *
 * Nobody in a generated world is socially isolated, but nothing is linked at
 * random either: every relationship is created because of a plausible shared
 * context — the same dressing room, the same five-a-side league, the same job,
 * the same village, a manager who has picked them for years.
 *
 * The generated graph is intentionally asymmetric: attitudes for each side are
 * rolled separately, so "Dave respects Kev, Kev can't stand Dave" happens.
 */

export interface GenerateRelationshipsOptions {
  seed: string;
  people: Record<PersonId, Person>;
  clubs: Record<ClubId, Club>;
  /** Date the network is treated as having existed since. */
  date: ISODate;
}

interface LinkOptions {
  aId: PersonId;
  bId: PersonId;
  origin: RelationshipOrigin;
  context?: string | null;
  provenance?: RelationshipProvenance;
  aToB?: Partial<RelationshipAttitude>;
  bToA?: Partial<RelationshipAttitude>;
  date: ISODate;
}

function link(store: RelationshipStore, options: LinkOptions): Relationship | null {
  if (options.aId === options.bId) return null;
  const id = relationshipIdFor(options.aId, options.bId);
  if (store.byId[id]) return null;

  const ordered = orderPair(options.aId, options.bId, options.aToB ?? {}, options.bToA ?? {});
  const relationship: Relationship = {
    id,
    personAId: ordered.personAId,
    personBId: ordered.personBId,
    origin: options.origin,
    context: options.context ?? null,
    aToB: createAttitude(ordered.aToB),
    bToA: createAttitude(ordered.bToA),
    strength: 0,
    established: options.date,
    lastInteraction: null,
    history: [],
    provenance: options.provenance ?? 'observed',
  };
  relationship.strength = relationshipStrength(relationship.aToB, relationship.bToA);
  indexRelationship(store, relationship);
  return relationship;
}

/** Personality nudges how readily somebody warms to a teammate. */
function managerOf(people: Record<PersonId, Person>, club: Club): Person | undefined {
  return club.managerId ? people[club.managerId] : undefined;
}

function chairmanOf(people: Record<PersonId, Person>, club: Club): Person | undefined {
  return club.chairmanId ? people[club.chairmanId] : undefined;
}

function sociabilityOf(player: Player): number {
  switch (player.personality) {
    case 'Talkative':
    case 'Joker':
      return 6;
    case 'Confident':
    case 'Laid back':
      return 3;
    case 'Quiet':
      return -6;
    case 'Wind-up merchant':
      return -2;
    default:
      return 0;
  }
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

/**
 * Split a squad into the small groups people actually spend time in. The
 * oldest players drift together first (the old guard), then the rest of the
 * dressing room settles into clusters.
 */
function buildCliques(rng: Rng, squad: Player[]): Player[][] {
  const cliques: Player[][] = [];
  const veterans = [...squad].sort((a, b) => b.age - a.age).slice(0, Math.min(4, Math.max(3, Math.round(squad.length / 6))));
  const remaining = rng.shuffle(squad).filter((player) => !veterans.includes(player));
  if (veterans.length >= 3) cliques.push(veterans);
  while (remaining.length >= 2) {
    const size = Math.min(remaining.length, rng.int(3, 4));
    cliques.push(remaining.splice(0, size));
  }
  return cliques;
}

/** One pair inside a clique: usually close, occasionally the two who clash. */
function cliqueLink(
  store: RelationshipStore,
  rng: Rng,
  a: Player,
  b: Player,
  date: ISODate,
  context: string,
): void {
  const friction = rng.chance(0.13);
  if (friction) {
    link(store, {
      aId: a.id,
      bId: b.id,
      origin: 'current-teammates',
      context,
      aToB: {
        friendship: rng.gaussianInt(22, 9, 4, 40),
        respect: rng.gaussianInt(49, 12, 24, 72),
        trust: rng.gaussianInt(34, 11, 12, 55),
        tension: rng.gaussianInt(58, 13, 38, 86),
        loyalty: rng.gaussianInt(34, 12, 12, 60),
      },
      bToA: {
        friendship: rng.gaussianInt(24, 10, 4, 45),
        respect: rng.gaussianInt(52, 12, 26, 75),
        trust: rng.gaussianInt(36, 11, 14, 58),
        tension: rng.gaussianInt(56, 13, 36, 84),
        loyalty: rng.gaussianInt(36, 12, 12, 62),
      },
      date,
    });
    return;
  }

  const friendshipBase = 58 + sociabilityOf(a) + sociabilityOf(b) + (a.age - b.age > 10 ? -4 : 0);
  link(store, {
    aId: a.id,
    bId: b.id,
    origin: 'current-teammates',
    context,
    aToB: {
      friendship: rng.gaussianInt(friendshipBase, 13, 30, 96),
      respect: rng.gaussianInt(52 + (a.attributes.behavioural.commitment - 10) * 1.4, 10, 22, 92),
      trust: rng.gaussianInt(54 + (b.attributes.behavioural.reliability - 10) * 1.4, 11, 22, 92),
      tension: rng.int(0, 16),
      loyalty: rng.gaussianInt(40 + a.attributes.behavioural.loyalty * 1.6, 10, 12, 88),
    },
    bToA: {
      friendship: rng.gaussianInt(friendshipBase, 13, 30, 96),
      respect: rng.gaussianInt(52 + (b.attributes.behavioural.commitment - 10) * 1.4, 10, 22, 92),
      trust: rng.gaussianInt(54 + (a.attributes.behavioural.reliability - 10) * 1.4, 11, 22, 92),
      tension: rng.int(0, 16),
      loyalty: rng.gaussianInt(40 + b.attributes.behavioural.loyalty * 1.6, 10, 12, 88),
    },
    date,
  });
}

function managerQuality(manager: Person | undefined): number {
  return isOfficial(manager) ? manager.attributes.manManagement : 11;
}

/** Chairmen have patience; nobody else in the model does. */
function patienceOf(person: Person | undefined): number {
  return isOfficial(person) ? person.patience : 11;
}

/** The manager's own dressing room: every player, seen a different way. */
function linkManagerAndPlayers(
  store: RelationshipStore,
  seed: string,
  club: Club,
  squad: Player[],
  people: Record<PersonId, Person>,
  date: ISODate,
): void {
  const manager = managerOf(people, club);
  if (!manager) return;
  const manManagement = managerQuality(manager);

  for (const player of squad) {
    if (player.id === manager.id) continue;
    const rng = stream(seed, 'relationships', club.id, 'manager', player.id);
    const manManagementPull = (manManagement - 11) * 1.7;
    const temperament = player.attributes.hidden.temperament;
    const awkward = rng.chance(0.16);

    link(store, {
      aId: manager.id,
      bId: player.id,
      origin: 'player-manager',
      context: `Manager at ${club.identity.shortName}`,
      aToB: {
        // The manager rates the reliable; talent alone is not enough.
        respect: clamp(40 + (player.attributes.behavioural.commitment + player.attributes.behavioural.reliability) * 0.9 + rng.gaussian(0, 8), 12, 95),
        trust: clamp(42 + (player.attributes.behavioural.reliability - 10) * 2.2 + manManagement * 0.5 + rng.gaussian(0, 8), 10, 95),
        friendship: clamp(32 + manManagement * 0.8 + rng.gaussian(0, 11), 6, 90),
        tension: awkward ? rng.int(34, 62) : rng.int(0, 18),
        loyalty: clamp(38 + rng.gaussian(0, 10), 8, 90),
      },
      bToA: {
        // The player's view is built on how the manager handles people.
        trust: clamp(36 + manManagementPull + (temperament - 10) * 0.7 + rng.gaussian(0, 9), 8, 94),
        respect: clamp(38 + manManagementPull * 0.8 + rng.gaussian(0, 8), 10, 94),
        friendship: clamp(30 + sociabilityOf(player) + rng.gaussian(0, 10), 5, 88),
        loyalty: clamp(30 + player.attributes.behavioural.loyalty * 2.1 + rng.gaussian(0, 8), 8, 94),
        tension: awkward ? rng.int(30, 58) : rng.int(0, 16),
      },
      date,
    });
  }
}

/**
 * The committee: every member of staff knows the manager (or the chairman) they
 * work under. Uses the one relationship service, the same as everybody else.
 */
function linkStaff(
  store: RelationshipStore,
  seed: string,
  club: Club,
  people: Record<PersonId, Person>,
  date: ISODate,
): void {
  const manager = managerOf(people, club);
  const chairman = chairmanOf(people, club);
  for (const member of staffMembers(club)) {
    if (member.role === 'manager' || member.role === 'chairman') continue;
    const person = people[member.personId];
    if (!person) continue;
    const anchorId = manager?.id ?? chairman?.id;
    if (!anchorId || anchorId === person.id) continue;
    const rng = stream(seed, 'relationships', club.id, 'staff', member.personId);
    link(store, {
      aId: anchorId,
      bId: person.id,
      origin: 'club-committee',
      context: `Both at ${club.identity.shortName}`,
      provenance: 'known',
      aToB: {
        trust: clamp(44 + rng.gaussian(0, 10), 12, 94),
        respect: clamp(46 + rng.gaussian(0, 11), 12, 92),
        friendship: clamp(42 + rng.gaussian(0, 12), 10, 90),
        tension: rng.int(0, 14),
        loyalty: clamp(48 + rng.gaussian(0, 10), 14, 92),
      },
      bToA: {
        trust: clamp(42 + rng.gaussian(0, 11), 12, 92),
        respect: clamp(44 + rng.gaussian(0, 11), 12, 90),
        friendship: clamp(40 + rng.gaussian(0, 12), 10, 88),
        tension: rng.int(0, 16),
        loyalty: clamp(46 + rng.gaussian(0, 10), 14, 90),
      },
      date,
    });
  }
}

function linkChairman(
  store: RelationshipStore,
  seed: string,
  club: Club,
  squad: Player[],
  people: Record<PersonId, Person>,
  date: ISODate,
  townLabel: string,
): void {
  const chairman = chairmanOf(people, club);
  const manager = managerOf(people, club);
  if (chairman && manager && chairman.id !== manager.id) {
    const rng = stream(seed, 'relationships', club.id, 'chairman', manager.id);
    link(store, {
      aId: chairman.id,
      bId: manager.id,
      origin: 'club-committee',
      context: `Chairman at ${club.identity.shortName}`,
      provenance: 'known',
      aToB: {
        trust: clamp(40 + patienceOf(chairman) * 2.2 + rng.gaussian(0, 10), 10, 95),
        respect: clamp(44 + rng.gaussian(0, 12), 10, 92),
        friendship: clamp(38 + rng.gaussian(0, 12), 8, 90),
        tension: rng.chance(0.2) ? rng.int(25, 55) : rng.int(0, 12),
        loyalty: clamp(46 + rng.gaussian(0, 10), 12, 92),
      },
      bToA: {
        trust: clamp(42 + rng.gaussian(0, 11), 10, 94),
        respect: clamp(46 + rng.gaussian(0, 11), 10, 92),
        friendship: clamp(36 + rng.gaussian(0, 12), 8, 88),
        tension: rng.chance(0.2) ? rng.int(20, 50) : rng.int(0, 12),
        loyalty: clamp(44 + rng.gaussian(0, 10), 12, 92),
      },
      date,
    });
  }

  // Chairmen of small clubs tend to know a couple of the lads personally.
  if (!chairman || squad.length === 0) return;
  const count = Math.min(squad.length, new Rng(`${seed}::chairman-links::${club.id}`).int(1, 2));
  const picked = new Rng(`${seed}::chairman-picks::${club.id}`).shuffle(squad).slice(0, count);
  for (const player of picked) {
    const rng = stream(seed, 'relationships', club.id, 'chairman-player', player.id);
    const pub = rng.chance(0.5);
    link(store, {
      aId: chairman.id,
      bId: player.id,
      origin: pub ? 'same-pub' : 'local-football',
      context: pub ? `Both drink in ${townLabel}` : `Known around ${townLabel}`,
      provenance: 'known',
      aToB: {
        friendship: clamp(48 + rng.gaussian(0, 14), 12, 92),
        respect: clamp(46 + rng.gaussian(0, 12), 15, 90),
        trust: clamp(46 + rng.gaussian(0, 12), 15, 90),
        tension: rng.int(0, 10),
        loyalty: clamp(48 + rng.gaussian(0, 12), 15, 92),
      },
      bToA: {
        friendship: clamp(44 + rng.gaussian(0, 14), 10, 90),
        respect: clamp(46 + rng.gaussian(0, 12), 12, 90),
        trust: clamp(42 + rng.gaussian(0, 13), 12, 90),
        tension: rng.int(0, 12),
        loyalty: clamp(46 + rng.gaussian(0, 12), 12, 90),
      },
      date,
    });
  }
}

/**
 * Connections that cross club boundaries: old teammates, the same five-a-side
 * league, school, work, and the local manager network.
 */
function linkAcrossClubs(
  store: RelationshipStore,
  seed: string,
  clubs: Club[],
  squadByClub: Map<ClubId, Player[]>,
  people: Record<PersonId, Person>,
  date: ISODate,
  townLabels: Map<string, string>,
): void {
  const rng = new Rng(`${seed}::relationships::cross-club`);
  const townOfClub = new Map<ClubId, string>();
  for (const club of clubs) townOfClub.set(club.id, club.townId);

  for (const club of clubs) {
    const squad = squadByClub.get(club.id) ?? [];
    if (squad.length === 0) continue;
    const clubRng = stream(seed, 'relationships', club.id, 'cross');

    // The nearby clubs that share a town are the ones people actually cross paths with.
    const neighbours = clubs.filter((other) => other.id !== club.id && other.townId === club.townId);
    const others = neighbours.length > 0 ? neighbours : clubs.filter((other) => other.id !== club.id);

    const attempts = clubRng.int(2, 4);
    for (let i = 0; i < attempts; i++) {
      const player = clubRng.pick(squad);
      const target = others.length > 0 ? clubRng.pick(others) : null;
      if (!target) break;
      const targetSquad = squadByClub.get(target.id) ?? [];
      if (targetSquad.length === 0) continue;
      const other = clubRng.pick(targetSquad);

      const sharedTown = townOfClub.get(club.id) === townOfClub.get(target.id);
      const sameOccupation = player.occupation === other.occupation;
      const closeInAge = Math.abs(player.age - other.age) <= 3;
      const origin: RelationshipOrigin = sameOccupation
        ? 'work-colleagues'
        : closeInAge && sharedTown
          ? 'school'
          : sharedTown
            ? 'five-a-side'
            : 'former-teammates';
      const context =
        origin === 'work-colleagues'
          ? `Both work as ${player.occupation}`
          : origin === 'school'
            ? `School in ${townLabels.get(club.townId) ?? 'the area'}`
            : origin === 'five-a-side'
              ? `Play ${townLabels.get(club.townId) ?? 'the local'} five-a-side`
              : `Used to play together before ${club.identity.shortName}`;

      const warmth = rng.gaussianInt(52, 16, 12, 92);
      link(store, {
        aId: player.id,
        bId: other.id,
        origin,
        context,
        // Cross-club knowledge is second hand until the manager sees it himself.
        provenance: 'inferred',
        aToB: {
          friendship: warmth,
          respect: rng.gaussianInt(52, 13, 15, 92),
          trust: rng.gaussianInt(48, 14, 12, 90),
          tension: rng.chance(0.12) ? rng.int(25, 55) : rng.int(0, 12),
          loyalty: rng.gaussianInt(34, 13, 8, 70),
        },
        bToA: {
          friendship: rng.gaussianInt(warmth - 4, 16, 10, 92),
          respect: rng.gaussianInt(52, 13, 15, 92),
          trust: rng.gaussianInt(48, 14, 12, 90),
          tension: rng.int(0, 14),
          loyalty: rng.gaussianInt(32, 13, 8, 70),
        },
        date,
      });
    }
  }

  // Managers know each other; they ring round about players, pitches and refs.
  for (const club of clubs) {
    const manager = managerOf(people, club);
    if (!manager) continue;
    const sameTown = clubs.filter((other) => other.id !== club.id && other.townId === club.townId);
    const others = sameTown.length > 0 ? sameTown : clubs.filter((other) => other.id !== club.id);
    if (others.length === 0) continue;
    const picks = rng.shuffle(others).slice(0, 2);
    for (const other of picks) {
      const otherManager = managerOf(people, other);
      if (!otherManager || otherManager.id === manager.id) continue;
      const rng2 = stream(seed, 'relationships', 'managers', club.id, other.id);
      const rival = (club.rivalries[other.id]?.intensity ?? 0) >= 55;
      link(store, {
        aId: manager.id,
        bId: otherManager.id,
        origin: rival ? 'rival-club' : rng2.chance(0.6) ? 'manager-manager' : 'former-manager',
        context: rival
          ? `${club.identity.shortName} and ${other.identity.shortName}`
          : `Managers in the same league`,
        provenance: 'known',
        aToB: {
          friendship: rng2.gaussianInt(rival ? 34 : 50, 14, 8, 90),
          respect: rng2.gaussianInt(rival ? 44 : 55, 13, 15, 92),
          trust: rng2.gaussianInt(rival ? 32 : 50, 14, 8, 90),
          tension: rival ? rng2.int(35, 70) : rng2.int(0, 18),
          loyalty: rng2.gaussianInt(30, 12, 8, 60),
        },
        bToA: {
          friendship: rng2.gaussianInt(rival ? 32 : 50, 14, 8, 90),
          respect: rng2.gaussianInt(rival ? 46 : 55, 13, 15, 92),
          trust: rng2.gaussianInt(rival ? 30 : 50, 14, 8, 90),
          tension: rival ? rng2.int(35, 70) : rng2.int(0, 18),
          loyalty: rng2.gaussianInt(30, 12, 8, 60),
        },
        date,
      });
    }
  }
}

/**
 * Build the whole initial network. This is the function a fresh world calls,
 * and the same function a version-1 save uses to catch up when it is migrated:
 * given the same seed and people, it always produces the same graph.
 */
export function generateInitialRelationships(options: GenerateRelationshipsOptions): RelationshipStore {
  const store = emptyRelationshipStore();
  const clubs = Object.keys(options.clubs)
    .sort()
    .map((id) => options.clubs[id]!)
    .filter(Boolean);
  const squadByClub = new Map<ClubId, Player[]>();
  for (const club of clubs) {
    squadByClub.set(
      club.id,
      club.squadIds.map((id) => options.people[id]).filter(isPlayer),
    );
  }

  const townLabels = new Map<string, string>();
  for (const club of clubs) {
    townLabels.set(club.townId, club.identity.shortName);
  }

  for (const club of clubs) {
    const squad = squadByClub.get(club.id) ?? [];
    if (squad.length === 0) continue;
    const rng = stream(options.seed, 'relationships', club.id, 'squad');

    const cliques = buildCliques(rng, squad);
    const covered = new Set<PersonId>();
    cliques.forEach((clique, index) => {
      const context =
        index === 0 && clique.length >= 3
          ? `Been around ${club.identity.shortName} for years`
          : `Teammates at ${club.identity.shortName}`;
      for (let i = 0; i < clique.length; i++) {
        for (let j = i + 1; j < clique.length; j++) {
          cliqueLink(store, rng, clique[i]!, clique[j]!, options.date, context);
        }
        covered.add(clique[i]!.id);
      }
    });

    // Nobody turns up to a new club completely alone: an odd man out still has
    // a mate, usually the one nearest his own age.
    for (const player of squad) {
      if (covered.has(player.id)) continue;
      const mate = squad
        .filter((candidate) => candidate.id !== player.id)
        .sort((a, b) => Math.abs(a.age - player.age) - Math.abs(b.age - player.age))[0];
      if (mate) cliqueLink(store, rng, player, mate, options.date, `Teammates at ${club.identity.shortName}`);
    }

    linkManagerAndPlayers(store, options.seed, club, squad, options.people, options.date);
    linkChairman(store, options.seed, club, squad, options.people, options.date, townLabels.get(club.townId) ?? 'the village');
    linkStaff(store, options.seed, club, options.people, options.date);
  }

  linkAcrossClubs(store, options.seed, clubs, squadByClub, options.people, options.date, townLabels);
  linkUnattachedPlayers(store, options.seed, clubs, squadByClub, options.people, options.date);
  return store;
}

/**
 * Give the unattached players their connections. Used both when a world is
 * generated and when an older save has a pool of local faces added to it.
 */
export function linkUnattachedPlayersInto(
  store: RelationshipStore,
  seed: string,
  people: Record<PersonId, Person>,
  clubs: Record<ClubId, Club>,
  date: ISODate,
): void {
  const clubList = Object.keys(clubs)
    .sort()
    .map((id) => clubs[id]!)
    .filter(Boolean);
  const squadByClub = new Map<ClubId, Player[]>();
  for (const club of clubList) {
    squadByClub.set(
      club.id,
      club.squadIds.map((id) => people[id]).filter(isPlayer),
    );
  }
  linkUnattachedPlayers(store, seed, clubList, squadByClub, people, date);
}

/**
 * People who are not playing anywhere this season still know people: the lads
 * they played with before, the ones they work with, and whoever is down the
 * five-a-side on a Wednesday. That is how their names ever come up.
 */
function linkUnattachedPlayers(
  store: RelationshipStore,
  seed: string,
  clubs: Club[],
  squadByClub: Map<ClubId, Player[]>,
  people: Record<PersonId, Person>,
  date: ISODate,
): void {
  const clubPlayersByTown = new Map<string, Array<{ player: Player; club: Club }>>();
  for (const club of clubs) {
    const list = clubPlayersByTown.get(club.townId) ?? [];
    for (const player of squadByClub.get(club.id) ?? []) list.push({ player, club });
    clubPlayersByTown.set(club.townId, list);
  }

  const unattached = Object.values(people).filter(
    (person): person is Player => isPlayer(person) && person.clubId === null,
  );

  for (const player of unattached) {
    const rng = stream(seed, 'relationships', 'unattached', player.id);
    const local = player.townId ? clubPlayersByTown.get(player.townId) ?? [] : [];
    const nearby = unattached.filter((other) => other.id !== player.id && other.townId === player.townId);
    if (local.length === 0 && nearby.length === 0) continue;

    const linkToClub = local.length > 0 && (nearby.length === 0 || rng.chance(0.65));
    const count = rng.int(1, 2);

    if (linkToClub) {
      for (const pick of rng.shuffle(local).slice(0, count)) {
        const origin: RelationshipOrigin = rng.weighted([
          { value: 'five-a-side' as RelationshipOrigin, weight: 3 },
          { value: 'former-teammates' as RelationshipOrigin, weight: 2 },
          { value: 'school' as RelationshipOrigin, weight: 1 },
          { value: 'work-colleagues' as RelationshipOrigin, weight: player.occupation === pick.player.occupation ? 2 : 0.6 },
        ]);
        const context =
          origin === 'five-a-side'
            ? `Plays the same five-a-side as the ${pick.club.identity.shortName} lads`
            : origin === 'former-teammates'
              ? `Used to play with lads from ${pick.club.identity.shortName}`
              : origin === 'school'
                ? 'Went to school round here'
                : `Both work as ${player.occupation}`;
        const warmth = rng.gaussianInt(52, 15, 14, 90);
        link(store, {
          aId: player.id,
          bId: pick.player.id,
          origin,
          context,
          provenance: 'inferred',
          aToB: {
            friendship: warmth,
            respect: rng.gaussianInt(50, 13, 15, 90),
            trust: rng.gaussianInt(48, 14, 12, 88),
            tension: rng.int(0, 14),
            loyalty: rng.gaussianInt(32, 13, 8, 68),
          },
          bToA: {
            friendship: rng.gaussianInt(warmth - 4, 15, 10, 88),
            respect: rng.gaussianInt(50, 13, 15, 90),
            trust: rng.gaussianInt(48, 14, 12, 88),
            tension: rng.int(0, 16),
            loyalty: rng.gaussianInt(30, 13, 8, 68),
          },
          date,
        });
      }
      continue;
    }

    for (const other of rng.shuffle(nearby).slice(0, count)) {
      const warmth = rng.gaussianInt(50, 15, 12, 88);
      link(store, {
        aId: player.id,
        bId: other.id,
        origin: 'five-a-side',
        context: 'Same crowd down the five-a-side',
        aToB: { friendship: warmth, trust: rng.gaussianInt(50, 14, 12, 88), tension: rng.int(0, 12) },
        bToA: { friendship: rng.gaussianInt(warmth - 4, 15, 10, 88), trust: rng.gaussianInt(48, 14, 12, 88) },
        date,
      });
    }
  }
}

/** Links a newly signed player into the dressing room they have just joined. */
export function linkNewTeammate(
  store: RelationshipStore,
  seed: string,
  club: Club,
  newPlayerId: PersonId,
  teammates: PersonId[],
  date: ISODate,
): void {
  const rng = stream(seed, 'relationships', club.id, 'new', newPlayerId);
  for (const teammateId of rng.shuffle(teammates).slice(0, 4)) {
    const warmth = rng.gaussianInt(46, 14, 12, 88);
    link(store, {
      aId: newPlayerId,
      bId: teammateId,
      origin: 'current-teammates',
      context: `New at ${club.identity.shortName}`,
      aToB: {
        friendship: warmth,
        respect: rng.gaussianInt(48, 13, 15, 88),
        trust: rng.gaussianInt(44, 14, 12, 86),
        tension: rng.int(0, 12),
        loyalty: rng.gaussianInt(36, 13, 10, 70),
      },
      bToA: {
        friendship: rng.gaussianInt(warmth - 3, 14, 10, 88),
        respect: rng.gaussianInt(50, 13, 15, 88),
        trust: rng.gaussianInt(44, 14, 12, 86),
        tension: rng.int(0, 14),
        loyalty: rng.gaussianInt(34, 13, 10, 70),
      },
      date,
    });
  }
}

/** Chairman↔manager links for a manager appointed after world generation. */
export function linkManagerToClub(
  store: RelationshipStore,
  seed: string,
  club: Club,
  managerId: PersonId,
  people: Record<PersonId, Person>,
  date: ISODate,
): void {
  const manager = people[managerId];
  const chairman = chairmanOf(people, club);
  if (!manager) return;
  if (chairman && chairman.id !== managerId) {
    const rng = stream(seed, 'relationships', club.id, 'chairman', managerId);
    link(store, {
      aId: chairman.id,
      bId: managerId,
      origin: 'club-committee',
      context: `Chairman at ${club.identity.shortName}`,
      provenance: 'known',
      aToB: {
        trust: clamp(38 + patienceOf(chairman) * 2.4 + rng.gaussian(0, 9), 10, 95),
        respect: clamp(42 + rng.gaussian(0, 11), 10, 90),
        friendship: clamp(40 + rng.gaussian(0, 11), 10, 88),
        tension: rng.int(0, 14),
        loyalty: clamp(46 + rng.gaussian(0, 9), 12, 92),
      },
      bToA: {
        trust: clamp(44 + rng.gaussian(0, 10), 12, 94),
        respect: clamp(46 + rng.gaussian(0, 10), 12, 90),
        friendship: clamp(38 + rng.gaussian(0, 11), 10, 88),
        tension: rng.int(0, 14),
        loyalty: clamp(46 + rng.gaussian(0, 9), 12, 92),
      },
      date,
    });
  }
  const squad = club.squadIds
    .map((id) => people[id])
    .filter(isPlayer);
  linkManagerAndPlayers(store, seed, club, squad, people, date);
  // The backroom knows him too. The committee was linked to the man who was in
  // charge when the world was built, and a manager whose coaches, secretary and
  // treasurer have never met him has not taken charge of anything: he is a name
  // on the league's paperwork. The pairs that already exist are left alone, so
  // this only ever adds the introductions that are missing.
  linkStaff(store, seed, club, people, date);
}
