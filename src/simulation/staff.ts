import type { Club, ClubStructure } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId, SeasonId, TownId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isOfficial, type Official, type Person, type Player } from '@/domain/person';
import {
  emptyClubStaff,
  STAFF_ROLE_LABEL,
  STAFF_ROLE_ORDER,
  type ClubStaff,
  type StaffMember,
  type StaffRole,
  type SupportStaffRole,
} from '@/domain/staff';
import { maybeNickname, occupation, personFirstName, personSurname } from './generation/names';
import { createEvent } from './news';
import { removePersonFromCommunication } from './communication/store';
import { applyRelationshipEvent, removePersonRelationships, upsertRelationship } from './relationships';
import { Rng, stream } from './rng';

/**
 * The club personnel system.
 *
 * Staff are people. Every role a club fills beyond the manager and the chairman
 * is held by a real `Person` — usually an `Official`, sometimes a player who
 * doubles up — with an identity, an age, a personality, a reputation and the
 * few role-facing attributes the game has a reason to look at. There is no
 * parallel "staff record": a staff member is exactly whatever the person model
 * already says they are, plus the roles they hold.
 *
 * The club keeps an explicit roster ({@link ClubStaff}) so a screen can ask who
 * the physio is without scanning the world; the person's own `roles` array stays
 * the record of what they do. This service is the only thing that writes either,
 * which is what keeps them in step.
 *
 * Generation is deterministic: each club draws from its own named stream, so the
 * same seed always produces the same committee, and adding staff never consumes
 * numbers that the rest of world generation depends on.
 */

/* ------------------------------------------------------------------------ *
 * Reading a club's staff
 * ------------------------------------------------------------------------ */

/** Every member of staff at a club, manager and chairman included. */
export function staffMembers(club: Club): StaffMember[] {
  const staff = club.staff ?? emptyClubStaff();
  const members: StaffMember[] = [];
  if (club.chairmanId) members.push({ personId: club.chairmanId, role: 'chairman' });
  if (club.managerId) members.push({ personId: club.managerId, role: 'manager' });
  if (staff.assistantId) members.push({ personId: staff.assistantId, role: 'assistant' });
  for (const id of staff.coachIds) members.push({ personId: id, role: 'coach' });
  if (staff.physioId) members.push({ personId: staff.physioId, role: 'physio' });
  if (staff.secretaryId) members.push({ personId: staff.secretaryId, role: 'secretary' });
  if (staff.treasurerId) members.push({ personId: staff.treasurerId, role: 'treasurer' });
  for (const id of staff.scoutIds) members.push({ personId: id, role: 'scout' });
  for (const id of staff.volunteerIds) members.push({ personId: id, role: 'volunteer' });
  return members.sort((a, b) => STAFF_ROLE_ORDER.indexOf(a.role) - STAFF_ROLE_ORDER.indexOf(b.role));
}

/** Does this club hold this role at all? */
export function clubHasRole(club: Club, role: StaffRole): boolean {
  return staffMembers(club).some((member) => member.role === role);
}

/* ------------------------------------------------------------------------ *
 * Competence — light, role-facing, on the 1-20 scale
 * ------------------------------------------------------------------------ */

/** Read a staff attribute, falling back to a middle value for older officials. */
export function officialAttribute(person: Official, key: keyof Official['attributes'], fallback = 10): number {
  const value = person.attributes[key];
  return typeof value === 'number' ? value : fallback;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * How good somebody is in a role, as a single 1-20 judgement.
 *
 * Kept to one number on purpose: it is what a screen shows and what a future
 * system would read, and it is built from the few attributes the role actually
 * cares about rather than a full attribute sheet.
 */
export function staffCompetence(person: Official, role: StaffRole): number {
  const a = person.attributes;
  const attr = (key: keyof Official['attributes'], fallback = 10) => officialAttribute(person, key, fallback);
  let score: number;
  switch (role) {
    case 'manager':
      score = mean([a.coaching, a.manManagement, a.motivation, a.tacticalKnowledge]);
      break;
    case 'assistant':
      score = mean([a.tacticalKnowledge, attr('judgement'), attr('reliability')]);
      break;
    case 'coach':
      score = mean([a.coaching, attr('reliability'), attr('development')]);
      break;
    case 'physio':
      score = mean([attr('medical'), attr('reliability')]);
      break;
    case 'secretary':
      score = mean([a.organisation, attr('reliability')]);
      break;
    case 'treasurer':
      score = mean([attr('financial'), attr('reliability'), a.organisation]);
      break;
    case 'scout':
      score = mean([attr('judgement'), a.recruitmentEye, attr('reliability')]);
      break;
    case 'chairman':
      score = mean([a.organisation, a.manManagement, person.patience]);
      break;
    case 'volunteer':
      score = mean([attr('reliability'), a.organisation]);
      break;
  }
  return Math.max(1, Math.min(20, Math.round(score)));
}

/* ------------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------------ */

export function staffIsAvailable(person: Official): boolean {
  return (person.availability?.status ?? 'available') === 'available';
}

export function setStaffAvailability(
  state: GameState,
  personId: PersonId,
  status: 'available' | 'unavailable',
  note: string | null = null,
): boolean {
  const person = state.people[personId];
  if (!isOfficial(person)) return false;
  person.availability = { status, note };
  return true;
}

/* ------------------------------------------------------------------------ *
 * Assigning and releasing roles
 * ------------------------------------------------------------------------ */

/** Add a role to a person without ever duplicating one. */
function addPersonRole(person: Person, clubId: ClubId, role: SupportStaffRole, since: ISODate): void {
  if (person.roles.some((entry) => entry.clubId === clubId && entry.role === role)) return;
  person.roles = [...person.roles, { clubId, role, since }];
}

/** Remove a role from a person's own record. */
function removePersonRole(person: Person, clubId: ClubId, role: SupportStaffRole): void {
  person.roles = person.roles.filter((entry) => !(entry.clubId === clubId && entry.role === role));
}

/**
 * Put a person in a support role at a club.
 *
 * Works on the plain roster and person rather than on `GameState`, so it can be
 * used during world generation before a career exists. Manager and chairman are
 * deliberately not assignable here: they live on the club and are managed by the
 * manager/chairman systems.
 */
export function assignSupportRole(
  club: { id: ClubId; staff: ClubStaff },
  person: Person,
  role: SupportStaffRole,
  since: ISODate,
): void {
  switch (role) {
    case 'assistant':
      club.staff.assistantId = person.id;
      break;
    case 'physio':
      club.staff.physioId = person.id;
      break;
    case 'secretary':
      club.staff.secretaryId = person.id;
      break;
    case 'treasurer':
      club.staff.treasurerId = person.id;
      break;
    case 'coach':
      if (!club.staff.coachIds.includes(person.id)) club.staff.coachIds = [...club.staff.coachIds, person.id];
      break;
    case 'scout':
      if (!club.staff.scoutIds.includes(person.id)) club.staff.scoutIds = [...club.staff.scoutIds, person.id];
      break;
    case 'volunteer':
      if (!club.staff.volunteerIds.includes(person.id)) club.staff.volunteerIds = [...club.staff.volunteerIds, person.id];
      break;
  }
  addPersonRole(person, club.id, role, since);
  // A new man is attached to the club; an existing one already is.
  if (isOfficial(person)) person.clubId = club.id;
}

/** Take a support role away from a person, leaving their other roles intact. */
export function releaseSupportRole(
  club: { id: ClubId; staff: ClubStaff },
  person: Person,
  role: SupportStaffRole,
): void {
  switch (role) {
    case 'assistant':
      if (club.staff.assistantId === person.id) club.staff.assistantId = null;
      break;
    case 'physio':
      if (club.staff.physioId === person.id) club.staff.physioId = null;
      break;
    case 'secretary':
      if (club.staff.secretaryId === person.id) club.staff.secretaryId = null;
      break;
    case 'treasurer':
      if (club.staff.treasurerId === person.id) club.staff.treasurerId = null;
      break;
    case 'coach':
      club.staff.coachIds = club.staff.coachIds.filter((id) => id !== person.id);
      break;
    case 'scout':
      club.staff.scoutIds = club.staff.scoutIds.filter((id) => id !== person.id);
      break;
    case 'volunteer':
      club.staff.volunteerIds = club.staff.volunteerIds.filter((id) => id !== person.id);
      break;
  }
  removePersonRole(person, club.id, role);
}

/** Appoint somebody at a live club (the runtime form of {@link assignSupportRole}). */
export function appointStaff(
  state: GameState,
  clubId: ClubId,
  personId: PersonId,
  role: SupportStaffRole,
  date: ISODate,
): boolean {
  const club = state.clubs[clubId];
  const person = state.people[personId];
  if (!club || !person) return false;
  assignSupportRole(club, person, role, date);
  return true;
}

/** Release one role at a live club. */
export function relinquishStaff(
  state: GameState,
  clubId: ClubId,
  personId: PersonId,
  role: SupportStaffRole,
): boolean {
  const club = state.clubs[clubId];
  const person = state.people[personId];
  if (!club || !person) return false;
  releaseSupportRole(club, person, role);
  settleClubAffiliation(person);
  return true;
}

/**
 * A person steps away from everything they do at a club.
 *
 * Used when a man leaves for good, retires or is replaced. The roles come off
 * the club's roster and off his own record; if he holds nothing anywhere after
 * that, he is unattached, which is what the manager market and the world view
 * read.
 */
export function leaveClubStaff(
  state: GameState,
  clubId: ClubId,
  personId: PersonId,
  note: string | null = null,
): boolean {
  const club = state.clubs[clubId];
  const person = state.people[personId];
  if (!club || !person) return false;
  for (const member of staffMembers(club).filter((entry) => entry.personId === personId)) {
    if (member.role === 'manager' || member.role === 'chairman') continue;
    releaseSupportRole(club, person, member.role);
  }
  if (note && isOfficial(person)) person.notes = [...person.notes, note];
  settleClubAffiliation(person);
  return true;
}

/** Keep `clubId` honest: a person with no roles anywhere belongs to nobody. */
function settleClubAffiliation(person: Person): void {
  // A player's club is set by the player side, so a player is left alone.
  if (!isOfficial(person)) return;
  if (person.roles.length === 0) person.clubId = null;
  else if (person.clubId && !person.roles.some((role) => role.clubId === person.clubId)) {
    person.clubId = person.roles[0]!.clubId;
  }
}

/** A person's roles at one club. */
export function rolesAtClub(person: Person, clubId: ClubId): SupportStaffRole[] {
  return person.roles
    .filter((entry) => entry.clubId === clubId)
    .map((entry) => entry.role)
    .filter((role): role is SupportStaffRole =>
      role === 'assistant' || role === 'coach' || role === 'physio' || role === 'secretary' ||
      role === 'treasurer' || role === 'scout' || role === 'volunteer',
    );
}

/* ------------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------------ */

export interface GenerateStaffOptions {
  seed: string;
  clubId: ClubId;
  townId: TownId | null;
  reputation: number;
  structure: ClubStructure;
  seasonStart: ISODate;
  squad: readonly Player[];
  people: Record<PersonId, Person>;
  managerId?: PersonId | null;
  chairmanId?: PersonId | null;
  /** An assistant already in place — the ex-manager who stepped back for a player-manager. */
  assistantId?: PersonId | null;
}

/** How likely a club of this kind is to have a given role at all. */
function roleChance(role: SupportStaffRole, structure: ClubStructure, reputation: number): number {
  const professional = reputation >= 55;
  const committee = structure === 'committee';
  switch (role) {
    case 'assistant':
      return professional ? 0.72 : committee ? 0.3 : 0.5;
    case 'coach':
      return professional ? 0.6 : committee ? 0.3 : 0.45;
    case 'physio':
      return professional ? 0.5 : 0.18;
    case 'secretary':
      return 0.72;
    case 'treasurer':
      return 0.62;
    case 'scout':
      return professional ? 0.4 : 0.14;
    case 'volunteer':
      return 0.4;
  }
}

const SUPPORT_AGES: Record<SupportStaffRole, { mean: number; spread: number; min: number; max: number }> = {
  // Capped below `STAFF_LIFECYCLE.retirementAge` so a newly generated committee
  // is not one season from disappearing.
  assistant: { mean: 44, spread: 9, min: 26, max: 64 },
  coach: { mean: 41, spread: 10, min: 22, max: 62 },
  physio: { mean: 38, spread: 9, min: 23, max: 60 },
  secretary: { mean: 50, spread: 11, min: 28, max: 68 },
  treasurer: { mean: 52, spread: 11, min: 30, max: 70 },
  scout: { mean: 48, spread: 10, min: 28, max: 66 },
  volunteer: { mean: 45, spread: 13, min: 20, max: 70 },
};

/**
 * Build a club's support staff.
 *
 * Deliberately partial: a Sunday club might have a secretary and nothing else, a
 * bigger one a physio and a coach, and one role is often covered by somebody who
 * already does another — the chairman who keeps the books, the manager who takes
 * the coaching. Nobody is given a full professional backroom.
 *
 * The whole thing draws from `<seed>::staff::<clubId>` and never from the shared
 * world stream, so it is stable and does not disturb anything generated around it.
 */
export function generateClubStaff(options: GenerateStaffOptions): ClubStaff {
  const staff = emptyClubStaff();
  const rng = stream(options.seed, 'staff', options.clubId);
  const club = { id: options.clubId, staff };
  let index = 0;

  const createOfficial = (role: SupportStaffRole): Official => {
    index += 1;
    const official = makeStaffOfficial(rng, role, options, index);
    options.people[official.id] = official;
    return official;
  };

  const people = options.people;
  const manager = options.managerId ? people[options.managerId] : undefined;
  const chairman = options.chairmanId ? people[options.chairmanId] : undefined;

  // --- Assistant manager ----------------------------------------------------
  if (options.assistantId) {
    // Somebody is already in the job (a step-back or an existing appointment).
    staff.assistantId = options.assistantId;
  } else if (rng.chance(roleChance('assistant', options.structure, options.reputation))) {
    assignSupportRole(club, createOfficial('assistant'), 'assistant', options.seasonStart);
  }

  // --- Coach ----------------------------------------------------------------
  if (rng.chance(roleChance('coach', options.structure, options.reputation))) {
    if (manager && rng.chance(0.3)) {
      // The manager takes the sessions himself.
      assignSupportRole(club, manager, 'coach', options.seasonStart);
    } else {
      assignSupportRole(club, createOfficial('coach'), 'coach', options.seasonStart);
    }
    if (rng.chance(0.18)) assignSupportRole(club, createOfficial('coach'), 'coach', options.seasonStart);
  }

  // --- Physio ---------------------------------------------------------------
  if (rng.chance(roleChance('physio', options.structure, options.reputation))) {
    assignSupportRole(club, createOfficial('physio'), 'physio', options.seasonStart);
  }

  // --- Secretary ------------------------------------------------------------
  if (rng.chance(roleChance('secretary', options.structure, options.reputation))) {
    const playerSecretary = options.squad.length > 0 && rng.chance(0.22);
    if (playerSecretary) {
      const pick = pickPlayerForRole(options.squad, rng);
      if (pick) assignSupportRole(club, pick, 'secretary', options.seasonStart);
    } else {
      assignSupportRole(club, createOfficial('secretary'), 'secretary', options.seasonStart);
    }
  }

  // --- Treasurer ------------------------------------------------------------
  if (rng.chance(roleChance('treasurer', options.structure, options.reputation))) {
    if (chairman && rng.chance(0.45)) {
      // The chairman keeps the books himself — the classic small-club double act.
      assignSupportRole(club, chairman, 'treasurer', options.seasonStart);
    } else {
      assignSupportRole(club, createOfficial('treasurer'), 'treasurer', options.seasonStart);
    }
  }

  // --- Scout ----------------------------------------------------------------
  if (rng.chance(roleChance('scout', options.structure, options.reputation))) {
    assignSupportRole(club, createOfficial('scout'), 'scout', options.seasonStart);
  }

  // --- Volunteer ------------------------------------------------------------
  if (rng.chance(roleChance('volunteer', options.structure, options.reputation))) {
    assignSupportRole(club, createOfficial('volunteer'), 'volunteer', options.seasonStart);
  }

  return staff;
}

/** A squad player willing to take on a bit of the admin. */
function pickPlayerForRole(squad: readonly Player[], rng: Rng): Player | null {
  const candidates = [...squad]
    .filter((player) => player.roles.every((role) => role.role === 'player' || role.role === 'player-manager'))
    .sort((a, b) => a.id.localeCompare(b.id));
  return candidates.length > 0 ? rng.pick(candidates) : null;
}

const ROLE_DUTY: Record<SupportStaffRole, string[]> = {
  assistant: ['Runs the warm-up and has a say on the shape.', 'Takes the session when you cannot get there.'],
  coach: ['Takes the Thursday sessions.', 'Works with the lads on the training ground.'],
  physio: ['Straps the ankles and runs the warm-up.', 'Knows a hamstring when he sees one.'],
  secretary: ['Does the registrations and the paperwork.', 'Sorts the league forms and the fines.'],
  treasurer: ['Keeps the subs book.', 'Handles the club’s money.'],
  scout: ['Goes to watch players.', 'Knows who is worth a look.'],
  volunteer: ['Puts the nets up and runs the line.', 'Helps out on a Sunday morning.'],
};

/** Build the Official record for a support-staff role, with role-facing attributes. */
function makeStaffOfficial(
  rng: Rng,
  role: SupportStaffRole,
  options: GenerateStaffOptions,
  index: number,
): Official {
  const age = SUPPORT_AGES[role];
  const base = Math.max(4, Math.min(16, 7 + Math.round(options.reputation / 11)));
  const around = (mean: number, spread = 3) => rng.gaussianInt(mean, spread, 3, 19);
  const id: PersonId = `staff_${options.clubId}_${role}_${index}`;
  return {
    id,
    kind: 'official',
    firstName: personFirstName(rng),
    surname: personSurname(rng),
    nickname: maybeNickname(rng, 0.15),
    age: rng.gaussianInt(age.mean, age.spread, age.min, age.max),
    townId: options.townId,
    occupation: occupation(rng),
    reputation: Math.round(Math.max(5, Math.min(80, options.reputation * 0.6 + rng.gaussian(0, 12)))),
    roles: [],
    role,
    clubId: null,
    patience: around(11, 3),
    attributes: {
      coaching: around(role === 'coach' ? base : 8),
      manManagement: around(11, 3),
      motivation: around(11, 3),
      tacticalKnowledge: around(role === 'assistant' ? base : 9),
      recruitmentEye: around(role === 'scout' ? base : 9),
      organisation: around(role === 'secretary' || role === 'treasurer' ? base : 10),
      reliability: around(role === 'volunteer' ? 13 : 12, 3),
      medical: around(role === 'physio' ? base : 6, 3),
      financial: around(role === 'treasurer' ? base : 7, 3),
      judgement: around(role === 'scout' || role === 'assistant' ? base : 10, 3),
      development: around(role === 'coach' ? base : 9, 3),
    },
    notes: [rng.pick(ROLE_DUTY[role])],
    availability: { status: 'available', note: null },
  };
}

/** Give a club a default (empty) roster: an old save with no staff system yet. */
export function ensureClubStaff(club: Club): void {
  if (!club.staff) club.staff = emptyClubStaff();
}

/** True when a person holds any role at a club. */
export function isStaffAt(person: Person, clubId: ClubId): boolean {
  return person.roles.some((role) => role.clubId === clubId);
}
/* ------------------------------------------------------------------------ *
 * Lifecycle — the committee changes over the years
 * ------------------------------------------------------------------------ */

/**
 * The knobs on staff turnover, in one place so the soak can read them.
 *
 * Deliberately gentler than the managers' carousel: a physio or a secretary is
 * a volunteer who drifts away quietly rather than a manager under pressure, and
 * most seasons most of the committee stays exactly as it was.
 */
export const STAFF_LIFECYCLE = {
  /** Men start to think about packing the committee in from here. */
  stepDownAge: 62,
  /** Nobody keeps doing it past this. */
  retirementAge: 72,
  /** Added chance of stepping down per year past `stepDownAge`. */
  stepDownChance: 0.18,
  /** When a role falls empty, how often the club fills it that summer. */
  replaceChance: 0.65,
  /** Officials between jobs are trimmed to this many. */
  maxIdle: 8,
} as const;

export interface StaffLifecycleContext {
  seasonId: SeasonId;
  seasonLabel: string;
  seasonStart: ISODate;
}

export interface StaffLifecycleOutcome {
  events: GameEvent[];
  /** Men who left the world altogether. */
  retired: PersonId[];
  /** Men who left their post but are still knocking about. */
  departed: PersonId[];
}

/** The support-staff holders at a club, chairman and manager excluded. */
function supportStaffAt(club: Club): PersonId[] {
  const staff = club.staff ?? emptyClubStaff();
  const ids = new Set<PersonId>();
  if (staff.assistantId) ids.add(staff.assistantId);
  if (staff.physioId) ids.add(staff.physioId);
  if (staff.secretaryId) ids.add(staff.secretaryId);
  if (staff.treasurerId) ids.add(staff.treasurerId);
  for (const id of staff.coachIds) ids.add(id);
  for (const id of staff.scoutIds) ids.add(id);
  for (const id of staff.volunteerIds) ids.add(id);
  // A man who is also the manager or the chairman is theirs, not the committee's.
  if (club.chairmanId) ids.delete(club.chairmanId);
  if (club.managerId) ids.delete(club.managerId);
  return [...ids];
}

/**
 * Turn the committee over once a season.
 *
 * A year on everybody's clock, a few men stepping down or packing it in, and the
 * roles they leave behind filled from the town — enough for a club to have a
 * different physio in five years' time, and bounded so the county does not fill
 * up with idle physios. Called at the season boundary beside the managers'
 * market; the two are kept apart because they age and replace different posts.
 */
export function runStaffLifecycle(state: GameState, context: StaffLifecycleContext): StaffLifecycleOutcome {
  const events: GameEvent[] = [];
  const retired: PersonId[] = [];
  const departed: PersonId[] = [];
  const vacated = new Map<ClubId, Set<SupportStaffRole>>();

  const vacate = (clubId: ClubId, roles: SupportStaffRole[]): void => {
    if (roles.length === 0) return;
    const set = vacated.get(clubId) ?? new Set<SupportStaffRole>();
    for (const role of roles) set.add(role);
    vacated.set(clubId, set);
  };

  // 1. A year older. Managers are aged by their own market and clubId-less men
  //    have no post to keep, so only serving, non-managing officials grow old
  //    here — once each, however many hats they wear.
  for (const person of Object.values(state.people)) {
    if (!isOfficial(person)) continue;
    if (person.clubId === null || person.role === 'manager') continue;
    person.age += 1;
  }

  // 2. Who steps away, and why.
  for (const club of Object.values(state.clubs)) {
    const rng = stream(state.seed, 'staff-lifecycle', context.seasonId, club.id);
    for (const personId of supportStaffAt(club)) {
      const person = state.people[personId];
      if (!isOfficial(person)) continue;
      let reason: 'retired' | 'stepped-down' | null = null;
      if (person.age >= STAFF_LIFECYCLE.retirementAge) reason = 'retired';
      else if (
        person.age >= STAFF_LIFECYCLE.stepDownAge &&
        rng.chance((person.age - STAFF_LIFECYCLE.stepDownAge + 1) * STAFF_LIFECYCLE.stepDownChance)
      ) {
        reason = 'stepped-down';
      }
      if (!reason) continue;

      vacate(club.id, rolesAtClub(person, club.id));
      const name = `${person.firstName} ${person.surname}`;
      leaveClubStaff(
        state,
        club.id,
        person.id,
        reason === 'retired'
          ? `Retired from ${club.identity.shortName} at ${person.age}.`
          : `Stood down from ${club.identity.shortName}.`,
      );

      if (club.id === state.userClubId) {
        events.push(
          createEvent(state, {
            type: 'club-news',
            importance: 2,
            clubIds: [club.id],
            personIds: [person.id],
            data: {
              headline: reason === 'retired' ? `${name} steps back after ${person.age} years` : `${name} stands down`,
              body:
                reason === 'retired'
                  ? `${name} has retired from his post at ${club.identity.name}.`
                  : `${name} has stood down from his post at ${club.identity.name}.`,
            },
          }),
        );
      }

      if (reason === 'retired') {
        delete state.people[person.id];
        removePersonRelationships(state, person.id);
        removePersonFromCommunication(state, person.id);
        retired.push(person.id);
      } else {
        departed.push(person.id);
      }
    }
  }

  // 3. Fill what fell empty, from the town. Not every role is refilled: a Sunday
  //    club that loses its physio often simply does without one.
  let generated = 0;
  for (const [clubId, roles] of vacated) {
    const club = state.clubs[clubId];
    if (!club) continue;
    const rng = stream(state.seed, 'staff-replacement', context.seasonId, clubId);
    for (const role of roles) {
      if (!rng.chance(STAFF_LIFECYCLE.replaceChance)) continue;
      generated += 1;
      const official = makeStaffOfficial(
        rng,
        role,
        {
          seed: state.seed,
          clubId,
          townId: club.townId,
          reputation: club.reputation,
          structure: club.structure,
          seasonStart: context.seasonStart,
          squad: [],
          people: state.people,
        },
        generated,
      );
      official.id = `staff_${clubId}_${role}_${context.seasonId}_${generated}`;
      official.notes = [`Joined the committee ahead of ${context.seasonLabel}.`];
      state.people[official.id] = official;
      assignSupportRole(club, official, role, context.seasonStart);

      // The same relationship service as everybody else: a new man is known to
      // whoever runs the club.
      const anchorId = club.managerId ?? club.chairmanId;
      if (anchorId && anchorId !== official.id) {
        upsertRelationship(state, {
          aId: anchorId,
          bId: official.id,
          origin: 'club-committee',
          context: `Both at ${club.identity.shortName}`,
          aToB: { respect: 48, trust: 46, loyalty: 46 },
          bToA: { respect: 46, trust: 46, loyalty: 44, friendship: 44 },
        });
        applyRelationshipEvent(state, {
          type: 'joined-club',
          aId: official.id,
          bId: anchorId,
          intensity: 0.8,
          date: context.seasonStart,
          clubId,
          detail: 'joined the committee',
        });
      }

      if (clubId === state.userClubId) {
        events.push(
          createEvent(state, {
            type: 'club-news',
            importance: 1,
            clubIds: [clubId],
            personIds: [official.id],
            data: {
              headline: `${official.firstName} ${official.surname} joins the committee`,
              body: `${official.firstName} ${official.surname} has taken over as ${STAFF_ROLE_LABEL[role].toLowerCase()} at ${club.identity.name}.`,
            },
          }),
        );
      }
    }
  }

  // 4. Trim the men between posts, so a long career cannot fill the county with
  //    idle volunteers. Managers and referees have their own pools and are left
  //    alone.
  const idle = Object.values(state.people).filter(
    (person): person is Official =>
      isOfficial(person) && person.clubId === null && person.role !== 'manager' && person.role !== 'referee',
  );
  if (idle.length > STAFF_LIFECYCLE.maxIdle) {
    const trim = idle
      .sort((a, b) => a.reputation - b.reputation || b.age - a.age || a.id.localeCompare(b.id))
      .slice(0, idle.length - STAFF_LIFECYCLE.maxIdle);
    for (const person of trim) {
      delete state.people[person.id];
      removePersonRelationships(state, person.id);
      removePersonFromCommunication(state, person.id);
    }
  }

  return { events, retired, departed };
}
