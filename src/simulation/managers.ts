import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId, SeasonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isOfficial, isPlayer, type Official, type Person, type Player } from '@/domain/person';
import { yearOf } from './calendar';
import { linkManagerToClub } from './generation/relationshipGenerator';
import { maybeNickname, occupation, personFirstName, personSurname } from './generation/names';
import { createEvent } from './news';
import { removePersonFromCommunication } from './communication/store';
import { removePersonRelationships, relationshipStore } from './relationships';
import { Rng, stream } from './rng';

/**
 * The managers' market.
 *
 * Until now a manager was a permanent fixture of a club: appointed when the
 * world was generated and never moved, aged or replaced. Real local football is
 * a carousel — a man steps down when his legs or his patience go, a board or a
 * committee loses faith after a bad winter, a bigger club down the road takes a
 * winning manager, and the post is filled from a pool of men between jobs, from
 * the coach already in the building, or by a player who fancies running it
 * himself.
 *
 * This module turns that carousel once a season. It is deterministic (one stream
 * per club per season) and bounded — the pool is both filled and drained and
 * careers end with age — which is what lets the world run for as many seasons as
 * anybody wants without filling up with managers or running out of them.
 *
 * The player's own manager is deliberately left alone here. Making results cost
 * *him* his job is a career-level decision (what happens next: a new club, a
 * game over, a spell in the pool) and belongs to its own change; the market
 * takes a list of protected ids so that change is a single argument, not a
 * rewrite.
 */

/** Every knob in one place, so the soak can tune the carousel rather than guess. */
export const MANAGER_MARKET = {
  /** Managers start to think about packing it in from here. */
  stepDownAge: 60,
  /** Nobody manages past this. */
  retirementAge: 68,
  /** A stint this long is reason enough to walk away on its own. */
  longStintSeasons: 8,
  /** How far below the reputation-based expectation a finish has to be. */
  sackingSlack: 4,
  /** The bottom this many places is always a reason to worry. */
  dangerZone: 3,
  /** A manager's reputation must lead his club's by this to interest a bigger one. */
  poachGap: 8,
  /** The most managers one summer can take off each other. */
  maxPoaches: 2,
  /** The pool of managers between jobs is refilled to at least this... */
  minPool: 4,
  /** ...and trimmed to at most this. */
  maxPool: 12,
} as const;

export interface ManagerMarketContext {
  seasonId: SeasonId;
  seasonLabel: string;
  seasonStart: ISODate;
  /** The season just finished — its record is what the committee judges. */
  previousSeasonId: SeasonId;
  previousSeasonLabel: string;
  /** Managers the market must not move (the player's own, for now). */
  protectedManagerIds?: PersonId[];
}

export interface ManagerChange {
  clubId: ClubId;
  personId: PersonId;
  name: string;
  reason:
    | 'sacked'
    | 'stepped-down'
    | 'retired'
    | 'poached-away'
    | 'poached'
    | 'appointed'
    | 'promoted'
    | 'player-manager';
}

export interface ManagerMarketOutcome {
  events: GameEvent[];
  changes: ManagerChange[];
}

const REASONS = {
  sacked: 'The committee lost patience after a poor season.',
  'stepped-down': 'Stepped down of his own accord.',
  retired: 'Decided to call it a day.',
} as const;

function displayName(person: Person): string {
  return `${person.firstName} ${person.surname}`;
}

function officials(state: GameState): Official[] {
  return Object.values(state.people).filter(isOfficial);
}

/** The man in charge at a club, if there is one and he still exists. */
function managerOf(state: GameState, club: Club): Official | null {
  const person = club.managerId ? state.people[club.managerId] : undefined;
  return isOfficial(person) ? person : null;
}

function clubsByReputation(state: GameState, clubIds: ClubId[]): Club[] {
  return clubIds
    .map((id) => state.clubs[id])
    .filter((club): club is Club => !!club)
    .sort((a, b) => b.reputation - a.reputation || a.id.localeCompare(b.id));
}

/** Where a club's reputation says it should finish, before the football. */
function expectedRank(state: GameState, clubIds: ClubId[], clubId: ClubId): number {
  const order = clubsByReputation(state, clubIds);
  const index = order.findIndex((club) => club.id === clubId);
  return index < 0 ? order.length : index + 1;
}

function lastFinish(club: Club, previousSeasonId: SeasonId): number | null {
  const record = club.history.seasons.find((entry) => entry.seasonId === previousSeasonId);
  return record?.finalPosition ?? null;
}

/** Whole seasons a manager has been in charge, from the date he took over. */
function stintSeasons(manager: Official, seasonStart: ISODate): number {
  const since = manager.roles[0]?.since ?? seasonStart;
  return Math.max(0, yearOf(seasonStart) - yearOf(since));
}

function closeTenure(club: Club, personId: PersonId, date: ISODate): void {
  const entry = club.history.managers.find((record) => record.personId === personId && record.to === null);
  if (entry) entry.to = date;
}

function openTenure(club: Club, person: Person, date: ISODate): void {
  club.history.managers.unshift({
    personId: person.id,
    name: displayName(person),
    from: date,
    to: null,
  });
}

/** Take a manager's place away, whatever the reason: he can no longer be in charge. */
function leaveClub(club: Club, manager: Official, date: ISODate): void {
  closeTenure(club, manager.id, date);
  club.managerId = null;
  manager.clubId = null;
  manager.role = 'manager';
  manager.roles = [];
  manager.notes.push(`Left ${club.identity.shortName}.`);
}

/** Put a manager in charge of a club: the post, the history and the relationships. */
function appointManager(
  state: GameState,
  club: Club,
  manager: Official,
  context: ManagerMarketContext,
  reason: ManagerChange['reason'],
): ManagerChange {
  manager.role = 'manager';
  manager.roles = [{ clubId: club.id, role: 'manager', since: context.seasonStart }];
  manager.clubId = club.id;
  manager.notes = [...manager.notes.filter((note) => !note.startsWith('Between jobs')), `Took charge ahead of ${context.seasonLabel}.`];
  club.managerId = manager.id;
  openTenure(club, manager, context.seasonStart);
  linkManagerToClub(relationshipStore(state), state.seed, club, manager.id, state.people, context.seasonStart);
  return { clubId: club.id, personId: manager.id, name: displayName(manager), reason };
}

function appointPlayerManager(
  state: GameState,
  club: Club,
  player: Player,
  context: ManagerMarketContext,
): ManagerChange {
  player.isPlayerManager = true;
  player.roles = [{ clubId: club.id, role: 'player-manager', since: context.seasonStart }];
  player.notes.push(`Took over as player-manager ahead of ${context.seasonLabel}.`);
  club.managerId = player.id;
  openTenure(club, player, context.seasonStart);
  linkManagerToClub(relationshipStore(state), state.seed, club, player.id, state.people, context.seasonStart);
  return { clubId: club.id, personId: player.id, name: displayName(player), reason: 'player-manager' };
}

/** Somebody already at the club who could step up. */
function internalCandidate(state: GameState, club: Club, protectedIds: Set<PersonId>): Official | null {
  const candidates = officials(state).filter(
    (person) =>
      person.clubId === club.id &&
      !protectedIds.has(person.id) &&
      person.id !== club.managerId &&
      (person.role === 'assistant' || person.role === 'coach'),
  );
  candidates.sort((a, b) => b.reputation - a.reputation || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** A man between jobs, preferring one from the club's own town. */
function poolCandidate(state: GameState, club: Club, protectedIds: Set<PersonId>): Official | null {
  const candidates = officials(state).filter(
    (person) => person.clubId === null && person.role === 'manager' && !protectedIds.has(person.id),
  );
  candidates.sort(
    (a, b) =>
      Number(b.townId === club.townId) - Number(a.townId === club.townId) ||
      b.reputation - a.reputation ||
      a.id.localeCompare(b.id),
  );
  return candidates[0] ?? null;
}

/** The best of the club's own squad to run the side while still playing. */
function playerManagerCandidate(state: GameState, club: Club, protectedIds: Set<PersonId>): Player | null {
  const candidates = club.squadIds
    .map((id) => state.people[id])
    .filter((person): person is Player => isPlayer(person) && person.age >= 28 && !protectedIds.has(person.id));
  const score = (player: Player): number =>
    player.attributes.mental.decisions + player.attributes.mental.composure + player.attributes.behavioural.ambition;
  candidates.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

function generateManager(
  options: { reputation: number; townId: string | null },
  id: string,
  rng: Rng,
): Official {
  const quality = Math.max(4, Math.min(16, 8 + Math.round(options.reputation / 12)));
  return {
    id,
    kind: 'official',
    firstName: personFirstName(rng),
    surname: personSurname(rng),
    nickname: maybeNickname(rng, 0.2),
    age: rng.gaussianInt(44, 8, 27, 62),
    townId: options.townId,
    occupation: occupation(rng),
    reputation: Math.round(Math.max(5, Math.min(90, options.reputation * 0.8 + rng.gaussian(0, 10)))),
    roles: [],
    role: 'manager',
    clubId: null,
    attributes: {
      coaching: Math.round(quality),
      manManagement: rng.gaussianInt(11, 3, 3, 19),
      motivation: rng.gaussianInt(11, 3, 3, 19),
      tacticalKnowledge: rng.gaussianInt(quality, 3, 3, 19),
      recruitmentEye: rng.gaussianInt(11, 3, 3, 19),
      organisation: rng.gaussianInt(11, 3, 3, 19),
    },
    patience: rng.gaussianInt(11, 3, 3, 19),
    notes: [],
  };
}

/**
 * Turn the carousel once. Called at the season boundary, after the archive and
 * the annual costs, so a committee judges a finish that has actually happened.
 */
export function runManagerMarket(state: GameState, context: ManagerMarketContext): ManagerMarketOutcome {
  const events: GameEvent[] = [];
  const changes: ManagerChange[] = [];
  const protectedIds = new Set<PersonId>(context.protectedManagerIds ?? []);
  const competition = Object.values(state.competitions)[0];
  if (!competition) return { events, changes };
  const clubIds = competition.clubIds;
  const clubs = clubsByReputation(state, clubIds);

  // 1. A year older, for every man holding a manager's job, wherever he is.
  for (const person of officials(state)) {
    if (person.role === 'manager') person.age += 1;
  }

  // 2. Who leaves, and why.
  for (const club of clubs) {
    const manager = managerOf(state, club);
    if (!manager || protectedIds.has(manager.id)) continue;
    const rng = stream(state.seed, 'manager-market', context.seasonId, club.id);

    let reason: ManagerChange['reason'] | null = null;
    if (manager.age >= MANAGER_MARKET.retirementAge) {
      reason = 'retired';
    } else if (
      manager.age >= MANAGER_MARKET.stepDownAge &&
      rng.chance((manager.age - MANAGER_MARKET.stepDownAge + 1) * 0.12)
    ) {
      reason = 'stepped-down';
    } else if (stintSeasons(manager, context.seasonStart) >= MANAGER_MARKET.longStintSeasons && rng.chance(0.3)) {
      reason = 'stepped-down';
    } else {
      const finish = lastFinish(club, context.previousSeasonId);
      const expected = expectedRank(state, clubIds, club.id);
      const underPressure =
        finish !== null &&
        (finish > clubIds.length - MANAGER_MARKET.dangerZone || finish - expected >= MANAGER_MARKET.sackingSlack);
      if (underPressure && rng.chance(0.45)) reason = 'sacked';
    }
    if (!reason) continue;

    manager.notes.push(REASONS[reason as 'sacked' | 'stepped-down' | 'retired']);
    if (manager.age >= MANAGER_MARKET.retirementAge) {
      // Age ends the career for good: he leaves the world rather than the pool,
      // which is what stops a long career filling up with managers. The post
      // must be emptied first, or the club keeps pointing at a man who is gone
      // and step 4 never refills it.
      closeTenure(club, manager.id, context.seasonStart);
      club.managerId = null;
      delete state.people[manager.id];
      removePersonRelationships(state, manager.id);
      removePersonFromCommunication(state, manager.id);
    } else {
      leaveClub(club, manager, context.seasonStart);
      manager.notes.push(`Between jobs, ${context.seasonStart}.`);
    }
    changes.push({ clubId: club.id, personId: manager.id, name: displayName(manager), reason });
    if (club.id === state.userClubId) {
      events.push(managerNews(state, club, manager, reason, context));
    }
  }

  const vacancies = new Set<ClubId>(changes.filter((change) => change.reason !== 'retired').map((change) => change.clubId));
  for (const club of clubs) if (!club.managerId) vacancies.add(club.id);

  // 3. Poaching: a bigger club takes a manager off a smaller one, who then has a
  //    vacancy of his own. Capped, so one summer cannot set off a stampede.
  let poaches = 0;
  for (const club of clubs) {
    if (poaches >= MANAGER_MARKET.maxPoaches) break;
    if (!vacancies.has(club.id)) continue;
    const rng = stream(state.seed, 'manager-poach', context.seasonId, club.id);
    if (!rng.chance(0.4)) continue;
    const target = clubs
      .filter((other) => other.id !== club.id && other.reputation < club.reputation && other.managerId)
      .map((other) => ({ other, manager: managerOf(state, other) }))
      .filter(
        (entry): entry is { other: Club; manager: Official } =>
          !!entry.manager &&
          !protectedIds.has(entry.manager.id) &&
          entry.manager.reputation >= club.reputation + MANAGER_MARKET.poachGap,
      )
      .sort((a, b) => b.manager.reputation - a.manager.reputation || a.other.id.localeCompare(b.other.id))[0];
    if (!target) continue;
    leaveClub(target.other, target.manager, context.seasonStart);
    changes.push({
      clubId: target.other.id,
      personId: target.manager.id,
      name: displayName(target.manager),
      reason: 'poached-away',
    });
    const change = appointManager(state, club, target.manager, context, 'poached');
    target.manager.notes.push(`Poached by ${club.identity.shortName} after a good spell at ${target.other.identity.shortName}.`);
    changes.push(change);
    vacancies.delete(club.id);
    vacancies.add(target.other.id);
    poaches += 1;
  }

  // 4. Restock the pool before anybody hires, so this summer's departures (and a
  //    few men who were already between jobs) are actually available to clubs.
  refillPool(state, context);

  // 5. Fill every post, from the pool first, then from within, then a player.
  //    `club.managerId` covers a player-manager too: a Player in charge is still
  //    a manager, and the market must not appoint over the top of him.
  let generated = 0;
  for (const club of clubs) {
    if (club.managerId) continue;
    const rng = stream(state.seed, 'manager-appointment', context.seasonId, club.id);
    const internal = internalCandidate(state, club, protectedIds);
    const pooled = poolCandidate(state, club, protectedIds);

    if (internal && rng.chance(0.35)) {
      changes.push(appointManager(state, club, internal, context, 'promoted'));
      continue;
    }
    if (pooled) {
      changes.push(appointManager(state, club, pooled, context, 'appointed'));
      continue;
    }
    if (internal) {
      changes.push(appointManager(state, club, internal, context, 'promoted'));
      continue;
    }
    const playerManager = playerManagerCandidate(state, club, protectedIds);
    if (playerManager) {
      changes.push(appointPlayerManager(state, club, playerManager, context));
      continue;
    }
    generated += 1;
    const manager = generateManager({ reputation: club.reputation, townId: club.townId }, `mgr_${context.seasonId}_${generated}`, rng);
    state.people[manager.id] = manager;
    changes.push(appointManager(state, club, manager, context, 'appointed'));
  }

  // 6. Trim the pool so a long career cannot fill the world with idle managers.
  const betweenJobs = officials(state).filter((person) => person.clubId === null && person.role === 'manager');
  if (betweenJobs.length > MANAGER_MARKET.maxPool) {
    const trim = betweenJobs
      .sort((a, b) => a.reputation - b.reputation || b.age - a.age || a.id.localeCompare(b.id))
      .slice(0, betweenJobs.length - MANAGER_MARKET.maxPool);
    for (const person of trim) {
      delete state.people[person.id];
      removePersonRelationships(state, person.id);
      removePersonFromCommunication(state, person.id);
    }
  }

  return { events, changes };
}

/** Keep a handful of men between jobs, so a vacancy is never filled out of thin air. */
function refillPool(state: GameState, context: ManagerMarketContext): void {
  const betweenJobs = officials(state).filter((person) => person.clubId === null && person.role === 'manager');
  if (betweenJobs.length >= MANAGER_MARKET.minPool) return;
  const towns = Object.values(state.world.towns);
  const rng = stream(state.seed, 'manager-pool', context.seasonId);
  for (let index = 0; index < MANAGER_MARKET.minPool - betweenJobs.length; index++) {
    const town = towns.length > 0 ? rng.pick(towns) : null;
    const manager = generateManager(
      { reputation: 40, townId: town?.id ?? null },
      `mgr_pool_${context.seasonId}_${index + 1}`,
      rng,
    );
    manager.notes = ['Between jobs and looking for a club.'];
    state.people[manager.id] = manager;
  }
}

function managerNews(
  state: GameState,
  club: Club,
  manager: Official,
  reason: ManagerChange['reason'],
  context: ManagerMarketContext,
): GameEvent {
  const name = displayName(manager);
  const headlines: Record<string, string> = {
    sacked: `${name} leaves ${club.identity.name}`,
    'stepped-down': `${name} steps down at ${club.identity.name}`,
    retired: `That is that for ${name}`,
    'poached-away': `${name} is off`,
  };
  const body: Record<string, string> = {
    sacked: `After a season that fell short of what the committee expected, ${name} has left ${club.identity.name}.`,
    'stepped-down': `${name} has stepped down as manager of ${club.identity.name} after ${context.previousSeasonLabel}.`,
    retired: `${name} has decided to call it a day after managing ${club.identity.name}.`,
    'poached-away': `${name} has been tempted away from ${club.identity.name}.`,
  };
  return createEvent(state, {
    type: 'club-news',
    importance: 3,
    clubIds: [club.id],
    personIds: [manager.id],
    data: { headline: headlines[reason] ?? `${name} leaves`, body: body[reason] ?? '' },
  });
}
