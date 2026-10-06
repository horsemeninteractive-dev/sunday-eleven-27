import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, navSectionFor, NAV_LEAVES } from './navigation';

/**
 * The shape of the sidebar.
 *
 * The order is not decoration. Recruitment sits inside Team because finding a
 * player is part of building a side; Media sits inside Club because the news is
 * mostly about his club. Every one of those is easy to undo by accident while
 * adding the next screen, so they are written down here rather than left to
 * whoever moves the array next.
 *
 * Messages is the exception to the array being the order: it is marked as
 * pinned, so the desktop sidebar draws it at the foot of the panel rather than
 * in the list, where a scrolled sidebar could hide the one thing that was
 * waiting on the manager. The array stays in reading order because the phone's
 * More sheet is built from it, and a short sheet needs no pinning.
 */
describe('the sidebar reads top to bottom', () => {
  const shape = NAV_SECTIONS.map((section) => ({
    label: section.label,
    direct: section.direct === true,
    children: section.leaves.map((leaf) => leaf.label),
  }));

  it('is home, manager, messages, then the four groups and the world', () => {
    expect(shape).toEqual([
      { label: 'Home', direct: true, children: ['Home'] },
      { label: 'Manager', direct: true, children: ['Your profile'] },
      { label: 'Messages', direct: true, children: ['Messages'] },
      {
        label: 'Team',
        direct: false,
        children: ['Squad', 'Selection', 'Tactics', 'Training', 'Recruitment'],
      },
      {
        label: 'Competitions',
        direct: false,
        children: ['Schedule', 'League Table', 'Cups'],
      },
      { label: 'Club', direct: false, children: ['Club', 'Staff', 'Finances', 'Media', 'History'] },
      { label: 'World', direct: true, children: ['The local game'] },
    ]);
  });

  it('puts recruitment inside the team rather than beside it', () => {
    // It was its own top-level section, which read as a fifth group of equal
    // weight to Team and split the side in two.
    expect(NAV_SECTIONS.some((section) => section.id === 'recruitment')).toBe(false);
    expect(navSectionFor('recruitment')?.id).toBe('team');
  });

  it('puts media inside the club rather than beside it', () => {
    expect(NAV_SECTIONS.some((section) => section.id === 'media')).toBe(false);
    expect(navSectionFor('news')?.id).toBe('club');
  });

  it('opens the club section with the club overview, because it is the question the others answer', () => {
    const club = NAV_SECTIONS.find((section) => section.id === 'club')!;
    expect(club.leaves[0]!.id).toBe('club');
    expect(club.leaves[0]!.label).toBe('Club');
    // Everything the overview sends the manager on to is still in the same
    // section, so a card pointing at Staff or Finances lands somewhere the
    // sidebar already says he is.
    for (const id of ['staff', 'finances', 'news', 'history'] as const) {
      expect(navSectionFor(id)?.id).toBe('club');
    }
  });

  it('puts the schedule before the table, because the next game comes first', () => {
    const competitions = NAV_SECTIONS.find((section) => section.id === 'competitions')!;
    expect(competitions.leaves.map((leaf) => leaf.id)).toEqual(['fixtures', 'league', 'cup']);
  });

  it('keeps messages a single destination, so it can carry the unread count', () => {
    // A group with screens inside it is drawn as a heading with a chevron, and
    // a heading has nowhere to put a badge.
    const inbox = NAV_SECTIONS.find((section) => section.id === 'inbox')!;
    expect(inbox.direct).toBe(true);
    expect(inbox.leaves).toHaveLength(1);
    expect(inbox.leaves[0]!.id).toBe('inbox');
  });

  it('pins messages to the foot of the sidebar, outside the part that scrolls', () => {
    // The one destination that can be waiting on the manager without his
    // knowing must not be the one that has scrolled out of reach — and it is
    // the only one pinned, because the foot is a place for that, not a second
    // list to keep in step with the first.
    const pinned = NAV_SECTIONS.filter((section) => section.pinned === true);
    expect(pinned.map((section) => section.id)).toEqual(['inbox']);
    expect(pinned[0]!.direct).toBe(true);
    expect(pinned[0]!.leaves).toHaveLength(1);
  });

  it('still reaches every destination exactly once', () => {
    // Sections were merged, so a screen could have been left in two of them, or
    // dropped on the way: the More sheet on a phone is built from this list.
    const ids = NAV_LEAVES.map((leaf) => leaf.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(
      [
        'club',
        'cup',
        'dashboard',
        'finances',
        'fixtures',
        'history',
        'inbox',
        'league',
        'manager',
        'news',
        'recruitment',
        'squad',
        'staff',
        'tactics',
        'team',
        'training',
        'world',
      ].sort(),
    );
  });
});