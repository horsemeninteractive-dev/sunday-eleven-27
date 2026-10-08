import { describe, expect, it } from 'vitest';
import type { ViewId } from '@/state/gameStore';
import { ARCHETYPES, ARCHETYPE_LABEL, viewArchetype, type ViewArchetype } from './archetype';

/**
 * The five rooms, and which screen is in which.
 *
 * A mapping this small is easy to get wrong quietly — a new screen lands in the
 * default room and looks like the screen it was not meant to look like — so the
 * groups are pinned here by name rather than by counting.
 */

const GROUPS: Record<ViewArchetype, ViewId[]> = {
  workspace: ['dashboard', 'manager', 'inbox'],
  // A match and its replay are the football itself, so if either ever moves
  // inside the shell it lands in the right room. Today both are takeover
  // screens rendered outside the shell, where the attribute is never read.
  football: ['squad', 'team', 'tactics', 'training', 'match', 'replay'],
  club: ['club', 'staff', 'finances', 'recruitment', 'kit'],
  competition: ['fixtures', 'league', 'cup', 'history'],
  // The four setup screens also render outside the shell; the local game is the
  // nearest room to them, and the value is a fallback either way.
  world: ['world', 'news', 'start', 'profile', 'select-club', 'create-club'],
};

/** Every view the store can show, so the map can be checked for completeness. */
const ALL_VIEWS: ViewId[] = [
  'start', 'profile', 'select-club', 'create-club', 'dashboard', 'manager', 'squad',
  'team', 'tactics', 'fixtures', 'league', 'cup', 'finances', 'history', 'club',
  'kit', 'world', 'news', 'replay', 'recruitment', 'training', 'inbox', 'staff', 'match',
];

describe('every screen is in a room', () => {
  it('names five rooms and gives each one a description', () => {
    expect(ARCHETYPES).toHaveLength(5);
    for (const archetype of ARCHETYPES) expect(ARCHETYPE_LABEL[archetype]).toBeTruthy();
  });

  it('has no view left in the default room by accident', () => {
    // Every view in the store is named in exactly one group below, so a screen
    // added later fails here rather than inheriting a room it was never given.
    const named = Object.values(GROUPS).flat();
    expect([...named].sort()).toEqual([...ALL_VIEWS].sort());
    expect(new Set(named).size).toBe(named.length);
  });

  it('puts each screen in the room it belongs to', () => {
    for (const archetype of ARCHETYPES) {
      for (const view of GROUPS[archetype]) {
        expect(viewArchetype(view), `${view} should be in ${archetype}`).toBe(archetype);
      }
    }
  });

  it('keeps the four working screens together and the season screens together', () => {
    // The two seams worth stating, because they are the ones a new screen is most
    // likely to be filed on the wrong side of. Selection, Tactics and Training
    // are the same activity — the week's football — and the Schedule, the table,
    // the cups and the honours are the same object seen from four angles.
    for (const view of ['squad', 'team', 'tactics', 'training'] as ViewId[]) {
      expect(viewArchetype(view)).toBe('football');
    }
    for (const view of ['fixtures', 'league', 'cup', 'history'] as ViewId[]) {
      expect(viewArchetype(view)).toBe('competition');
    }
    // Recruitment is money as much as football: it is filed with the club.
    expect(viewArchetype('recruitment')).toBe('club');
    // And the pre-game screens render outside the shell entirely, so whatever
    // room they are given is only ever a fallback.
    for (const view of ['start', 'profile', 'select-club', 'create-club'] as ViewId[]) {
      expect(viewArchetype(view)).toBe('world');
    }
  });
});
