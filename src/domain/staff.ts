import type { PersonId } from './ids';

/**
 * The club's personnel.
 *
 * Staff are people, not slots: every role here is held by a `Person` — usually
 * an `Official`, sometimes a player who doubles up (the player-manager, or the
 * secretary who turns out at right back). The roster below is the club's own
 * explicit view of who holds what, so a screen can ask "who is our physio?"
 * without scanning the whole world; the `roles` array on the person stays the
 * record of what that person does, and the two are kept in step by the staff
 * service.
 *
 * A Sunday club does not have every role, and often one person holds two — the
 * chairman who is also the treasurer, the manager who coaches as well. Nothing
 * here assumes a full professional structure.
 */

/** The roles a club's non-playing personnel can hold (manager and chairman are on the club itself). */
export type SupportStaffRole =
  | 'assistant'
  | 'coach'
  | 'physio'
  | 'secretary'
  | 'treasurer'
  | 'scout'
  | 'volunteer';

/** Every staff role, including the two the club already carries directly. */
export type StaffRole = 'manager' | 'chairman' | SupportStaffRole;

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  manager: 'Manager',
  assistant: 'Assistant manager',
  coach: 'Coach',
  physio: 'Physio',
  secretary: 'Secretary',
  treasurer: 'Treasurer',
  scout: 'Scout',
  chairman: 'Chairman',
  volunteer: 'Volunteer',
};

/** The order roles are shown in, most senior first. */
export const STAFF_ROLE_ORDER: StaffRole[] = [
  'chairman',
  'manager',
  'assistant',
  'coach',
  'physio',
  'secretary',
  'treasurer',
  'scout',
  'volunteer',
];

/**
 * The club's explicit personnel roster.
 *
 * Manager and chairman live on `Club` (they predate this and are read all over
 * the game); everything else is here. A person may appear in more than one
 * slot — that is a feature, not a mistake — but never twice in the same slot.
 */
export interface ClubStaff {
  assistantId: PersonId | null;
  coachIds: PersonId[];
  physioId: PersonId | null;
  secretaryId: PersonId | null;
  treasurerId: PersonId | null;
  scoutIds: PersonId[];
  volunteerIds: PersonId[];
}

export function emptyClubStaff(): ClubStaff {
  return {
    assistantId: null,
    coachIds: [],
    physioId: null,
    secretaryId: null,
    treasurerId: null,
    scoutIds: [],
    volunteerIds: [],
  };
}

/** One person holding one role at a club. */
export interface StaffMember {
  personId: PersonId;
  role: StaffRole;
}

/**
 * How good somebody is in a given role, on the same 1-20 scale the rest of the
 * game uses. Shown as a judgement, not a spreadsheet.
 */
export function competenceLabel(value: number): string {
  if (value >= 16) return 'Excellent';
  if (value >= 13) return 'Strong';
  if (value >= 10) return 'Sound';
  if (value >= 7) return 'Limited';
  return 'Out of his depth';
}
