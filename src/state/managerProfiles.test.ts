import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagerProfile } from '@/domain/manager';
import { describeProfile, forgetProfile, listProfiles, profileId, rememberProfile, sortProfiles } from './managerProfiles';

/**
 * The managers this browser has met.
 *
 * A career always starts by asking who you are, and the answer is almost always
 * the same man as last time. These are the rules that keeps: one entry per
 * person however he types his name, newest first, and the newest details are the
 * ones that survive.
 */

function profile(patch: Partial<ManagerProfile> = {}): ManagerProfile {
  return {
    firstName: 'Dave',
    surname: 'Fletcher',
    nickname: '',
    birthday: '1984-05-02',
    occupation: 'Scaffolder',
    hometown: 'Wychavon',
    ...patch,
  };
}

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => map.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the managers already saved', () => {
  it('starts empty, and remembers the first manager once a career begins', () => {
    expect(listProfiles()).toEqual([]);
    const saved = rememberProfile(profile(), '2026-10-01T10:00:00.000Z');
    expect(saved?.careers).toBe(1);
    expect(listProfiles()).toHaveLength(1);
    expect(listProfiles()[0]!.profile.firstName).toBe('Dave');
  });

  it('counts careers rather than making a second entry for the same man', () => {
    rememberProfile(profile(), '2026-10-01T10:00:00.000Z');
    rememberProfile(profile({ occupation: 'Site foreman' }), '2026-10-02T10:00:00.000Z');
    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.careers).toBe(2);
    // The details he last used are the ones kept.
    expect(profiles[0]!.profile.occupation).toBe('Site foreman');
  });

  it('treats a differently spelled name as the same man', () => {
    rememberProfile(profile({ firstName: 'dave' }), '2026-10-01T10:00:00.000Z');
    rememberProfile(profile({ firstName: 'Dave ' }), '2026-10-01T11:00:00.000Z');
    expect(listProfiles()).toHaveLength(1);
  });

  it('keeps two managers apart, newest used first', () => {
    rememberProfile(profile(), '2026-10-01T10:00:00.000Z');
    rememberProfile(profile({ firstName: 'Sam', occupation: 'Nurse' }), '2026-10-03T10:00:00.000Z');
    const profiles = listProfiles();
    expect(profiles.map((entry) => entry.profile.firstName)).toEqual(['Sam', 'Dave']);
    // Clearing Dave out leaves Sam exactly where he was.
    forgetProfile(profiles[1]!.id);
    expect(listProfiles().map((entry) => entry.profile.firstName)).toEqual(['Sam']);
  });

  it('will not remember half a manager', () => {
    expect(rememberProfile(profile({ surname: '' }))).toBeNull();
    expect(rememberProfile(profile({ birthday: 'sometime' }))).toBeNull();
    expect(listProfiles()).toEqual([]);
  });

  it('opens with an empty list rather than failing on rubbish', () => {
    localStorage.setItem('slfm26.profiles', '{ not json');
    expect(listProfiles()).toEqual([]);
    localStorage.setItem('slfm26.profiles', JSON.stringify([{ id: 'x' }, { nonsense: true }, 7]));
    expect(listProfiles()).toEqual([]);
  });

  it('describes a manager the way a fixture list would', () => {
    expect(describeProfile(profile(), 42)).toBe('Dave Fletcher · 42 · Scaffolder');
    expect(describeProfile(profile({ nickname: 'Fletch' }), 42)).toBe('Dave Fletcher (“Fletch”) · 42 · Scaffolder');
    expect(describeProfile(profile({ occupation: '', nickname: '' }), 42)).toBe('Dave Fletcher · 42');
    expect(describeProfile(profile({ occupation: '' }), null)).toBe('Dave Fletcher');
  });

  it('uses one identity per person and birthday', () => {
    expect(profileId(profile())).toBe(profileId(profile({ occupation: 'Something else' })));
    expect(profileId(profile())).not.toBe(profileId(profile({ birthday: '1980-01-01' })));
    expect(sortProfiles([])).toEqual([]);
  });
});
