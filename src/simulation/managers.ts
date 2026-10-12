import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId, SeasonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isOfficial, isPlayer, type Official, type Person, type Player } from '@/domain/person';
import { formatShortDate, yearOf } from './calendar';
import { linkManagerToClub } from './generation/relationshipGenerator';
import { maybeNickname, occupation, personFirstName, personSurname } from './generation/names';
import { createEvent } from './news';
import { removePersonFromCommunication } from './communication/store';
import { removePersonRelationships, relationshipStore } from './relationships';
import { nextId } from './ids';
import { leaveClubStaff, releaseSupportRole, rolesAtClub } from './staff';
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
  /**
   * Vacancies to leave unfilled rather than appoint over.
   *
   * Used by the player's own career: while he is out of work the market holds a
   * handful of posts his standing makes him a candidate for, so the job market
   * has something in it. A club the predicate says yes to is returned in
   * {@link ManagerMarketOutcome.held} and filled when its window closes.
   */
  holdVacancies?: (club: Club) => boolean;
  /**
   * The last resort when {@link holdVacancies} held nothing: the club whose
   * committee should take a look at its manager, because there is a manager out
   * of work and a summer in which nobody moved.
   *
   * Only ever consulted for the player's own career, only when he is out of work
   * and the carousel has left him nothing to apply for, and only given clubs that
   * have a manager and are not protected. The market, not the caller, makes the
   * change — the answer is which club, not what happens to it.
   */
  guaranteeVacancy?: (clubs: readonly Club[]) => Club | null;
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
  /** Posts left vacant for a caller to hand to the player's job market. */
  held: ClubId[];
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
  // A man promoted from inside the club gives up the post he was holding. The
  // committee's roster must not go on naming him as the assistant in the job he
  // has just left: it did, and the day his age caught up with him — this very
  // market retires a manager at 68 and deletes him from the world — the club was
  // left pointing at a man who no longer existed (`club-staff-exists` in the
  // soak, first seen four seasons after the club was formed). The best-placed man
  // in the building is usually the assistant, so this is the ordinary case rather
  // than an edge one.
  for (const role of rolesAtClub(manager, club.id)) releaseSupportRole(club, manager, role);
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
  // The carousel turns through the whole pyramid, not just its top division. A
  // committee in the third division judges its manager against the third
  // division, and the man who loses his job down there is exactly the man the
  // player's own job market is for. Reading only the first competition meant
  // only the top tier ever had a change of manager.
  const divisions = Object.values(state.competitions)
    .filter((competition) => competition.kind === 'league')
    .sort((a, b) => a.tier - b.tier);
  const divisionOfClub = new Map<ClubId, ClubId[]>();
  const clubIds: ClubId[] = [];
  for (const division of divisions) {
    for (const id of division.clubIds) {
      divisionOfClub.set(id, division.clubIds);
      clubIds.push(id);
    }
  }
  if (clubIds.length === 0) return { events, changes, held: [] };
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
      // His own division, not the whole pyramid: a third-division club finishing
      // fourth has had a fine season, whatever the top division's standings say.
      const divisionClubIds = divisionOfClub.get(club.id) ?? clubIds;
      const expected = expectedRank(state, divisionClubIds, club.id);
      const underPressure =
        finish !== null &&
        (finish > divisionClubIds.length - MANAGER_MARKET.dangerZone ||
          finish - expected >= MANAGER_MARKET.sackingSlack);
      if (underPressure && rng.chance(0.45)) reason = 'sacked';
    }
    if (!reason) continue;

    manager.notes.push(REASONS[reason as 'sacked' | 'stepped-down' | 'retired']);
    if (manager.age >= MANAGER_MARKET.retirementAge) {
      // Age ends the career for good: he leaves the world rather than the pool,
      // which is what stops a long career filling up with managers. The post
      // must be emptied first, or the club keeps pointing at a man who is gone
      // and step 4 never refills it — and so must every committee post he was
      // still holding, because a man who has left the world cannot be anybody's
      // assistant.
      closeTenure(club, manager.id, context.seasonStart);
      club.managerId = null;
      leaveClubStaff(state, club.id, manager.id);
      delete state.people[manager.id];
      removePersonRelationships(state, manager.id);
      removePersonFromCommunication(state, manager.id);
    } else {
      leaveClub(club, manager, context.seasonStart);
      manager.notes.push(`Between jobs, ${formatShortDate(context.seasonStart)}.`);
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

  // 5. Fill every post, from the pool first, then from within, then a player —
  //    unless it is a post the caller asked to hold for the player's own job
  //    market while he is out of work. The caller is asked once per vacancy and
  //    its answer remembered, because the question below is "did anything at all
  //    come free for him?" and a predicate that is counting its own answers must
  //    not be asked about the same club twice.
  const vacantNow = clubs.filter((club) => !club.managerId);
  const wanted = new Map<ClubId, boolean>();
  for (const club of vacantNow) wanted.set(club.id, context.holdVacancies?.(club) ?? false);

  // A manager out of work with nothing to apply for is a career with nowhere to
  // go, and the summer in which nobody else moved is exactly when that happens:
  // every post that came free is out of his reach, or is the one he has just
  // left, which no committee re-advertises to the man it has sacked. So the
  // caller may name one club — one that would talk to a man of his standing —
  // and that committee parts with its manager for the same reason the clubs a
  // rung above already did: its season was poor and there is a manager looking
  // for work. Taken once and without a roll, because a way back that only
  // sometimes exists is not a way back.
  if (context.holdVacancies && ![...wanted.values()].some(Boolean)) {
    const managed = clubs.filter((club) => {
      const manager = managerOf(state, club);
      return !!manager && !protectedIds.has(manager.id);
    });
    const chosen = context.guaranteeVacancy?.(managed) ?? null;
    const manager = chosen ? managerOf(state, chosen) : null;
    if (chosen && manager && !protectedIds.has(manager.id)) {
      leaveClub(chosen, manager, context.seasonStart);
      manager.notes.push(`Between jobs, ${formatShortDate(context.seasonStart)}.`);
      changes.push({ clubId: chosen.id, personId: manager.id, name: displayName(manager), reason: 'sacked' });
      if (chosen.id === state.userClubId) events.push(managerNews(state, chosen, manager, 'sacked', context));
      wanted.set(chosen.id, true);
    }
  }

  const held: ClubId[] = [];
  for (const club of clubs) {
    if (club.managerId) continue;
    if (wanted.get(club.id)) {
      held.push(club.id);
      continue;
    }
    const change = fillVacantPost(state, club, context, protectedIds);
    if (change) changes.push(change);
  }

  // 6. Trim the pool so a long career cannot fill the world with idle managers.
  //    Never the player's own manager, however long he is out of work: he is the
  //    player, and the pool is where he waits.
  const betweenJobs = officials(state).filter(
    (person) => person.clubId === null && person.role === 'manager' && !protectedIds.has(person.id),
  );
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

  return { events, changes, held };
}

/**
 * Fill one club's manager post, from the pool first, then from within, then a
 * player, then a man invented for the job.
 *
 * Lifted out of the market's own loop so a vacancy can be filled at any time of
 * year — the managers' carousel turns this at the season boundary, and the
 * player's career turns it the day a post stops waiting for him.
 */
export function fillVacantPost(
  state: GameState,
  club: Club,
  context: ManagerMarketContext,
  protectedIds: Set<PersonId> = new Set(context.protectedManagerIds ?? []),
): ManagerChange | null {
  if (club.managerId) return null;
  const rng = stream(state.seed, 'manager-appointment', context.seasonId, club.id);
  const internal = internalCandidate(state, club, protectedIds);
  const pooled = poolCandidate(state, club, protectedIds);

  if (internal && rng.chance(0.35)) return appointManager(state, club, internal, context, 'promoted');
  if (pooled) return appointManager(state, club, pooled, context, 'appointed');
  if (internal) return appointManager(state, club, internal, context, 'promoted');
  const playerManager = playerManagerCandidate(state, club, protectedIds);
  if (playerManager) return appointPlayerManager(state, club, playerManager, context);

  // Nobody to promote and nobody in the pool: invent a man for the job, with an
  // id that is unique to the club and the season it is being filled in.
  const manager = generateManager({ reputation: club.reputation, townId: club.townId }, nextId(state, 'manager'), rng);
  state.people[manager.id] = manager;
  return appointManager(state, club, manager, context, 'appointed');
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
