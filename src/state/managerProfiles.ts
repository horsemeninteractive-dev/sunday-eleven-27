import type { ManagerProfile } from '@/domain/manager';

/**
 * The managers this browser has already met.
 *
 * Starting a career always asks who you are, and the answer is almost always
 * the same man it was last time. So the profile he writes is kept — not as part
 * of a save, because it is his rather than any club's, and not as a single
 * "current" value either, because a household can hold more than one manager,
 * and people do start again with a different name to see how the world treats
 * them.
 *
 * Nothing here is simulation. A profile is a name, a birthday, a day job and a
 * hometown, and these are the rules for keeping them.
 */

const KEY = 'slfm26.profiles';

export interface SavedProfile {
  /** Stable across saves of the same manager, so two careers share one entry. */
  id: string;
  profile: ManagerProfile;
  savedAt: string;
  /** How many careers this manager has been used for, including the current one. */
  careers: number;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function write(store: Storage, value: string): void {
  try {
    store.setItem(KEY, value);
  } catch {
    // A full quota costs the manager a convenience, never a career.
  }
}

/**
 * One identity per person, whatever they type.
 *
 * The same manager entered twice — once as "Dave" and once as "dave", once with
 * a nickname he has since dropped — is one entry rather than three, which is
 * what keeps the list short enough to be useful.
 */
export function profileId(profile: ManagerProfile): string {
  const name = `${profile.firstName} ${profile.surname}`.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${name}|${profile.birthday}`;
}

function isProfile(value: unknown): value is ManagerProfile {
  const candidate = value as Partial<ManagerProfile> | null;
  return (
    Boolean(candidate) &&
    typeof candidate!.firstName === 'string' &&
    typeof candidate!.surname === 'string' &&
    typeof candidate!.birthday === 'string'
  );
}

/** Everything already known, newest first, and never a crash on rubbish. */
export function listProfiles(): SavedProfile[] {
  const store = storage();
  if (!store) return [];
  let parsed: unknown;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const profiles: SavedProfile[] = [];
  for (const entry of parsed) {
    const candidate = entry as Partial<SavedProfile> | null;
    if (!candidate || !isProfile(candidate.profile)) continue;
    const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : profileId(candidate.profile);
    if (seen.has(id)) continue;
    seen.add(id);
    profiles.push({
      id,
      profile: {
        firstName: candidate.profile.firstName,
        surname: candidate.profile.surname,
        nickname: typeof candidate.profile.nickname === 'string' ? candidate.profile.nickname : '',
        birthday: candidate.profile.birthday,
        occupation: typeof candidate.profile.occupation === 'string' ? candidate.profile.occupation : '',
        hometown: typeof candidate.profile.hometown === 'string' ? candidate.profile.hometown : '',
      },
      savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : new Date(0).toISOString(),
      careers: typeof candidate.careers === 'number' && candidate.careers > 0 ? candidate.careers : 1,
    });
  }
  return sortProfiles(profiles);
}

/** Most recently used first, which is the one a returning manager wants. */
export function sortProfiles(profiles: SavedProfile[]): SavedProfile[] {
  return [...profiles].sort((a, b) => (a.savedAt === b.savedAt ? 0 : a.savedAt > b.savedAt ? -1 : 1));
}

/**
 * Keep a manager, and count the career.
 *
 * Called when a career actually starts rather than as he types, so the list
 * holds managers who have been used rather than half-typed ones.
 */
export function rememberProfile(profile: ManagerProfile, now = new Date().toISOString()): SavedProfile | null {
  // Half a manager is not a manager: a first name, a surname and a birthday is
  // the same bar the game asks for before it will start a career.
  const firstName = profile.firstName.trim();
  const surname = profile.surname.trim();
  if (!firstName || !surname || !/^\d{4}-\d{2}-\d{2}$/.test(profile.birthday)) return null;

  const id = profileId(profile);
  const existing = listProfiles().find((entry) => entry.id === id);
  const entry: SavedProfile = {
    id,
    // The latest details win: a nickname added later is the one he uses.
    profile: { ...profile, firstName, surname },
    savedAt: now,
    careers: (existing?.careers ?? 0) + 1,
  };
  const others = listProfiles().filter((candidate) => candidate.id !== id);
  const store = storage();
  if (store) write(store, JSON.stringify([entry, ...others]));
  return entry;
}

export function forgetProfile(id: string): void {
  const store = storage();
  if (!store) return;
  write(store, JSON.stringify(listProfiles().filter((entry) => entry.id !== id)));
}

/** How the manager is described in a list: "Dave Fletcher, 41, Scaffolder". */
export function describeProfile(profile: ManagerProfile, age: number | null): string {
  const name = profile.nickname.trim()
    ? `${profile.firstName} ${profile.surname} (“${profile.nickname.trim()}”)`
    : `${profile.firstName} ${profile.surname}`;
  const parts = [age !== null ? String(age) : null, profile.occupation.trim() || null].filter(Boolean);
  return parts.length > 0 ? `${name} · ${parts.join(' · ')}` : name;
}
