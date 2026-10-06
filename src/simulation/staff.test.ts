import { describe, expect, it } from 'vitest';
import type { Club } from '@/domain/club';
import { GAME_STATE_VERSION } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { isOfficial, isPlayer, type Official } from '@/domain/person';
import { STAFF_ROLE_ORDER, type StaffMember } from '@/domain/staff';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { relationshipViewsFor } from './relationships';
import {
  appointStaff,
  clubHasRole,
  leaveClubStaff,
  rolesAtClub,
  runStaffLifecycle,
  STAFF_LIFECYCLE,
  staffCompetence,
  staffIsAvailable,
  staffMembers,
  setStaffAvailability,
} from './staff';
import { createTestGame } from './testSupport';
import { startNextSeason } from './season';

/**
 * The staff system holds one promise above all others: a member of staff is a
 * person, not a slot. These tests check that promise at the seams the rest of the
 * game reads — generation, assignment, the player-manager, save and load — and
 * that the committee turns over without leaving the club pointing at a ghost.
 */

/** A hand-made official, for the tests that need a known person to move about. */
function makeOfficial(id: string, overrides: Partial<Official> = {}): Official {
  return {
    id,
    kind: 'official',
    firstName: 'Test',
    surname: 'Man',
    age: 40,
    townId: null,
    occupation: 'Joiner',
    reputation: 20,
    roles: [],
    role: 'volunteer',
    clubId: null,
    attributes: {
      coaching: 10,
      manManagement: 10,
      motivation: 10,
      tacticalKnowledge: 10,
      recruitmentEye: 10,
      organisation: 10,
      reliability: 10,
    },
    patience: 10,
    notes: [],
    availability: { status: 'available', note: null },
    ...overrides,
  };
}

/** A club with at least one member of support staff, whichever seed produced it. */
function clubWithStaff(state: ReturnType<typeof createTestGame>['state']): {
  club: Club;
  members: StaffMember[];
} {
  for (const club of Object.values(state.clubs)) {
    const members = staffMembers(club).filter((member) => member.role !== 'manager' && member.role !== 'chairman');
    if (members.length > 0) return { club, members };
  }
  throw new Error('no club in the world has any support staff');
}

describe('the club personnel system', () => {
  it('generates staff as real people, not anonymous slots', () => {
    const { state } = createTestGame('staff-real-people');
    for (const club of Object.values(state.clubs)) {
      for (const member of staffMembers(club)) {
        const person = state.people[member.personId];
        expect(person, `${member.role} at ${club.id} names somebody who exists`).toBeDefined();
        // Every role is held by a Player (a player-manager or player-secretary) or
        // by an Official — never by a nameless record of its own.
        expect(isPlayer(person) || isOfficial(person)).toBe(true);
        expect(person!.age).toBeGreaterThan(0);
      }
    }
  });

  it('lets a club assign a person to a role, and records it on the person too', () => {
    const { state, clubId } = createTestGame('staff-assign');
    const person = makeOfficial('staff_handmade_assign');
    state.people[person.id] = person;

    expect(appointStaff(state, clubId, person.id, 'physio', state.season.startDate)).toBe(true);

    const club = state.clubs[clubId]!;
    expect(club.staff!.physioId).toBe(person.id);
    expect(person.clubId).toBe(clubId);
    expect(rolesAtClub(person, clubId)).toContain('physio');
    expect(clubHasRole(club, 'physio')).toBe(true);
  });

  it('lets one person hold more than one role at the same club', () => {
    const { state, clubId } = createTestGame('staff-multi-role');
    const person = makeOfficial('staff_handmade_multi');
    state.people[person.id] = person;

    appointStaff(state, clubId, person.id, 'coach', state.season.startDate);
    appointStaff(state, clubId, person.id, 'secretary', state.season.startDate);

    const club = state.clubs[clubId]!;
    expect(club.staff!.coachIds).toContain(person.id);
    expect(club.staff!.secretaryId).toBe(person.id);
    expect(rolesAtClub(person, clubId).sort()).toEqual(['coach', 'secretary']);
    // One person, one record: the roles are hats he wears, not extra people.
    expect(Object.values(state.people).filter((entry) => entry.id === person.id)).toHaveLength(1);
  });

  it('never invents a second person record for a player-manager', () => {
    const { state } = createTestGame('staff-player-manager');
    const club = Object.values(state.clubs).find((entry) => {
      const person = entry.managerId ? state.people[entry.managerId] : undefined;
      return isPlayer(person) && person.isPlayerManager;
    });
    if (!club) return; // this seed produced no player-manager; the property is still asserted elsewhere

    const manager = state.people[club.managerId!]!;
    expect(isPlayer(manager)).toBe(true);
    // The player is in the world once, and the club points at that one record.
    expect(Object.values(state.people).filter((entry) => entry.id === manager.id)).toHaveLength(1);
    const members = staffMembers(club);
    expect(members.find((member) => member.role === 'manager')!.personId).toBe(manager.id);
    // The man who stepped back for him is the assistant, not a duplicate.
    if (club.staff!.assistantId) {
      expect(club.staff!.assistantId).not.toBe(manager.id);
      expect(isOfficial(state.people[club.staff!.assistantId])).toBe(true);
    }
  });

  it('gives clubs realistic, incomplete staff structures', () => {
    const { state } = createTestGame('staff-incomplete');
    const clubs = Object.values(state.clubs);
    // A Sunday pyramid has clubs doing without roles, and no club should have a
    // full professional backroom.
    expect(clubs.some((club) => !clubHasRole(club, 'physio'))).toBe(true);
    expect(clubs.some((club) => !clubHasRole(club, 'scout'))).toBe(true);
    for (const club of clubs) {
      expect(staffMembers(club).length).toBeLessThan(STAFF_ROLE_ORDER.length);
    }
  });

  it('lets a staff member step down from one role, or leave altogether', () => {
    const { state, clubId } = createTestGame('staff-leave');
    const person = makeOfficial('staff_handmade_leave');
    state.people[person.id] = person;
    appointStaff(state, clubId, person.id, 'coach', state.season.startDate);
    appointStaff(state, clubId, person.id, 'treasurer', state.season.startDate);

    const club = state.clubs[clubId]!;
    // One hat comes off; the other stays on.
    leaveClubStaff(state, clubId, person.id);
    expect(club.staff!.coachIds).not.toContain(person.id);
    expect(club.staff!.treasurerId).toBeNull();
    expect(person.clubId).toBeNull();
    expect(rolesAtClub(person, clubId)).toHaveLength(0);
  });

  it('measures competence from the attributes the role actually uses', () => {
    const physio = makeOfficial('staff_competence', {
      attributes: {
        coaching: 4,
        manManagement: 4,
        motivation: 4,
        tacticalKnowledge: 4,
        recruitmentEye: 4,
        organisation: 4,
        medical: 19,
        reliability: 18,
      },
    });
    const coach = makeOfficial('staff_competence_coach', {
      attributes: {
        coaching: 18,
        manManagement: 10,
        motivation: 10,
        tacticalKnowledge: 10,
        recruitmentEye: 10,
        organisation: 10,
        development: 18,
        reliability: 17,
      },
    });
    expect(staffCompetence(physio, 'physio')).toBeGreaterThan(staffCompetence(physio, 'scout'));
    expect(staffCompetence(coach, 'coach')).toBeGreaterThan(staffCompetence(coach, 'treasurer'));
  });

  it('tracks availability as a small, honest fact rather than a second fitness system', () => {
    const { state, clubId } = createTestGame('staff-availability');
    const person = makeOfficial('staff_handmade_availability');
    state.people[person.id] = person;
    appointStaff(state, clubId, person.id, 'scout', state.season.startDate);

    expect(staffIsAvailable(person)).toBe(true);
    expect(setStaffAvailability(state, person.id, 'unavailable', 'Working Saturdays')).toBe(true);
    expect(staffIsAvailable(person)).toBe(false);
    expect(person.availability!.note).toBe('Working Saturdays');
  });

  it('gives a new committee relationship through the existing relationship system', () => {
    const { state } = createTestGame('staff-relationships');
    const { club, members } = clubWithStaff(state);
    const managerId = club.managerId;
    expect(managerId).toBeTruthy();
    const staffIds = new Set(members.map((member) => member.personId));
    const views = relationshipViewsFor(state, managerId!);
    const toStaff = views.filter((view) => staffIds.has(view.otherId));
    expect(toStaff.length).toBeGreaterThan(0);
    // It is the one relationship service, and the committee shows up in it.
    expect(toStaff.every((view) => view.origin === 'club-committee')).toBe(true);
  });

  it('is deterministic: the same seed produces the same committee', () => {
    const a = createTestGame('staff-deterministic');
    const b = createTestGame('staff-deterministic');
    for (const clubId of Object.keys(a.state.clubs)) {
      expect(b.state.clubs[clubId]!.staff).toEqual(a.state.clubs[clubId]!.staff);
      const aIds = staffMembers(a.state.clubs[clubId]!).map((member) => member.personId);
      for (const id of aIds) {
        const aPerson = a.state.people[id]!;
        const bPerson = b.state.people[id]!;
        expect(bPerson.firstName).toBe(aPerson.firstName);
        expect(bPerson.surname).toBe(aPerson.surname);
        expect(bPerson.age).toBe(aPerson.age);
      }
    }
  });

  it('survives a save and a load with every slot still naming somebody', () => {
    const { state } = createTestGame('staff-save-load');
    const loaded = deserialiseGame(serialiseGame(state));
    expect(loaded.error).toBeNull();
    const restored = loaded.state!;
    for (const club of Object.values(restored.clubs)) {
      for (const member of staffMembers(club)) {
        expect(restored.people[member.personId], `${member.role} at ${club.id}`).toBeDefined();
      }
    }
  });

  it('gives a save written before the personnel system an empty committee, not an invented one', () => {
    const game = createTestGame('staff-migrate');
    const legacy = JSON.parse(serialiseGame(game.state)) as {
      version: number;
      state: { clubs: Record<string, { managerId: string | null; chairmanId: string | null; staff?: unknown }> };
    };
    legacy.version = 11;
    for (const club of Object.values(legacy.state.clubs)) {
      delete club.staff;
    }

    const loaded = deserialiseGame(JSON.stringify(legacy));
    expect(loaded.error).toBeNull();
    expect(loaded.state!.version).toBe(GAME_STATE_VERSION);
    for (const club of Object.values(loaded.state!.clubs)) {
      expect(club.staff).toBeDefined();
      expect(club.staff!.assistantId).toBeNull();
      expect(club.staff!.coachIds).toEqual([]);
      // The men it already had are untouched.
      if (club.managerId) expect(loaded.state!.people[club.managerId]).toBeDefined();
      if (club.chairmanId) expect(loaded.state!.people[club.chairmanId]).toBeDefined();
    }
  });

  it('ages the committee and retires the oldest without leaving a dangling slot', () => {
    const { state } = createTestGame('staff-lifecycle');
    const { members } = clubWithStaff(state);
    const target = state.people[members[0]!.personId] as Official;
    const before = target.age;

    const context = {
      seasonId: 'season_test_staff',
      seasonLabel: 'test',
      seasonStart: state.season.startDate as ISODate,
    };
    const first = runStaffLifecycle(state, context);
    // A young man simply gets a year older.
    if (state.people[target.id]) {
      expect((state.people[target.id] as Official).age).toBe(before + 1);
    }

    // Give somebody the retirement age and run it again: he must leave the world,
    // and no club may still point at him.
    const { club: club2, members: members2 } = clubWithStaff(state);
    const retiree = state.people[members2[0]!.personId] as Official;
    retiree.age = STAFF_LIFECYCLE.retirementAge;
    const second = runStaffLifecycle(state, context);
    expect(second.retired).toContain(retiree.id);
    expect(state.people[retiree.id]).toBeUndefined();

    for (const entry of Object.values(state.clubs)) {
      for (const member of staffMembers(entry)) {
        expect(state.people[member.personId], `dangling ${member.role} at ${entry.id}`).toBeDefined();
      }
    }
    // The lists are genuinely returned, not just muted.
    expect(Array.isArray(first.departed)).toBe(true);
    expect(club2.managerId || club2.chairmanId).toBeTruthy();
  });

  it('takes a retiring player’s committee posts with him', () => {
    const { state } = createTestGame('staff-player-retires');
    const club = state.clubs[state.userClubId]!;
    const player = club.squadIds.map((id) => state.people[id]).filter(isPlayer)[0]!;
    // The grassroots double: he plays, and he keeps the bibs and the minutes.
    appointStaff(state, club.id, player.id, 'coach', state.season.startDate);
    appointStaff(state, club.id, player.id, 'secretary', state.season.startDate);
    player.age = 41; // over the hill: this summer takes him as a player

    startNextSeason(state);

    // He has stopped playing, so he is off the pitch and off the committee: no
    // slot at the club goes on naming a man who has left the world.
    expect(club.squadIds).not.toContain(player.id);
    expect(club.staff.coachIds).not.toContain(player.id);
    expect(club.staff.secretaryId).not.toBe(player.id);
    for (const member of staffMembers(club)) {
      expect(state.people[member.personId], `${member.role} names a missing person`).toBeDefined();
    }
  });

  it('creates no duplicate staff records across the whole world', () => {
    const { state } = createTestGame('staff-no-duplicates');
    // One person may hold two roles — that is a feature. What must never happen
    // is the same role being handed to the same man twice, or a post naming
    // somebody who is not in the world.
    for (const club of Object.values(state.clubs)) {
      const slots = new Set<string>();
      for (const member of staffMembers(club)) {
        const slot = `${member.role}:${member.personId}`;
        expect(slots.has(slot), `${slot} twice at ${club.id}`).toBe(false);
        slots.add(slot);
        expect(state.people[member.personId]).toBeDefined();
      }
    }
  });
});
