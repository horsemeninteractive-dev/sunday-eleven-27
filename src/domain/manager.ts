import type { FaceChoices } from './face';
import { toDate } from '@/simulation/calendar';

/**
 * The manager himself.
 *
 * Everything a Sunday League manager controls about his own identity in the
 * game: who he is, when he was born (which sets his age) and what he does for
 * a living. It is deliberately small — a grassroots manager is a volunteer, and
 * the game only needs enough of him to introduce him and to age him along with
 * the men he signs.
 */
export interface ManagerProfile {
  firstName: string;
  surname: string;
  /** Optional local nickname, the kind every Sunday League dressing room uses. */
  nickname: string;
  /** ISO date, `yyyy-mm-dd`. */
  birthday: string;
  occupation: string;
  /** Where he is from — flavour, and a hook for the local game to know him. */
  hometown: string;
  /**
   * The face he picked for himself, before there was a career to put it on.
   *
   * It lives here as well as on the manager's person because of *when* it is
   * chosen: the profile is filled in before the world exists, so there is no
   * person to hang it on yet. Keeping it here also means a saved profile gives
   * back the face as well as the name, which is the point of saving one.
   */
  face?: FaceChoices;
}

export const MIN_MANAGER_AGE = 18;
export const MAX_MANAGER_AGE = 75;

/**
 * The manager's age on a given date. A career runs for years, so the age is
 * derived from the birthday rather than stored once and left to drift.
 */
export function ageOn(birthday: string, onDate: string): number {
  const born = toDate(birthday);
  const at = toDate(onDate);
  let age = at.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

/** A career start year, birthday and the day the career begins, one call. */
export function birthdayForAge(age: number, seasonStart: string): string {
  const year = toDate(seasonStart).getUTCFullYear() - age;
  return `${year}-01-01`;
}

export function defaultManagerProfile(seasonStart = '2026-07-20'): ManagerProfile {
  return {
    firstName: '',
    surname: '',
    nickname: '',
    birthday: birthdayForAge(38, seasonStart),
    occupation: '',
    hometown: '',
  };
}

/** Whether the profile is complete enough to start a career with. */
export function isManagerProfileComplete(profile: ManagerProfile): boolean {
  return profile.firstName.trim().length > 0 && profile.surname.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(profile.birthday);
}
