import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import { isPlayer } from '@/domain/person';
import { dismissUserManager, type CareerContext } from '@/simulation/career';
import { createTestGame } from '@/simulation/testSupport';
import { PlayerProfile } from './ProfileOverlay';

/**
 * The profile, printed rather than read.
 *
 * Two things on a person's page are decided somewhere else and can only be seen
 * when it is drawn: whether the man on it is somebody the manager can go and have
 * a word with, and whether the facts beside him belong to a club he has not got.
 * Both were wrong in the same way — the page asked the club rather than the man —
 * so both are pinned here, against a career the game itself produced rather than
 * a state somebody believed it produces.
 *
 * The page is rendered from its props for the reason its own comment gives: the
 * store hands a server render its *initial* state whatever has been written into
 * it since, so a store-bound page cannot be printed in a test at all.
 */

type State = ReturnType<typeof createTestGame>['state'];

/** The context a season boundary hands the career, which a dismissal is part of. */
function contextFor(state: State): CareerContext {
  return {
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    seasonStart: state.season.startDate,
    previousSeasonId: state.season.id,
    previousSeasonLabel: state.season.label,
  };
}

/** One person's page, as it arrives on the screen. */
function page(state: State, personId: string): string {
  return renderToStaticMarkup(createElement(PlayerProfile, { game: state, personId }));
}

describe('the manager’s own page', () => {
  it('does not offer him a word with himself, in a job or out of one', () => {
    // The button used to be asked of the club — `clubs[userClubId].managerId` —
    // which was the same answer only while he had the job it named.
    const { state } = createTestGame('profile-own-page');
    expect(page(state, MANAGER_PERSON_ID)).not.toContain('Have a word');

    // Sacked, which is what empties the post: the old test then read "not this
    // club's manager" and offered him a conversation with the man holding the
    // phone.
    dismissUserManager(state, contextFor(state));
    const own = page(state, MANAGER_PERSON_ID);
    expect(state.clubs[state.userClubId]!.managerId).toBeNull();
    expect(own).not.toContain('Have a word');
    // The page is his, and still says the thing he came to read.
    expect(own).toContain('Between jobs');
  });

  it('writes the day it happened the way the game writes dates', () => {
    // The note a dismissal leaves behind is printed verbatim on this page, so a
    // bare `2026-09-13` in it was the one date in the interface nobody could read
    // the way they read every other one.
    const { state } = createTestGame('profile-note-date');
    dismissUserManager(state, contextFor(state));
    const own = page(state, MANAGER_PERSON_ID);
    expect(own).toContain('Between jobs');
    expect(own).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('still offers one for the rest of the club, who are not him', () => {
    const { state } = createTestGame('profile-others');
    const chairman = state.clubs[state.userClubId]!.chairmanId;
    expect(chairman).toBeTruthy();
    expect(page(state, chairman!)).toContain('Have a word');
  });
});

describe('a man without a club', () => {
  it('is not given a subs scheme he has not got', () => {
    const { state, clubId } = createTestGame('profile-no-club');
    const player = state.clubs[clubId]!.squadIds.map((id) => state.people[id]).find(isPlayer)!;
    player.clubId = null;

    const loose = page(state, player.id);
    // He is drawn, and the page says where he is not playing.
    expect(loose).toContain(player.surname);
    expect(loose).toContain('Not playing anywhere');
    // The figures were the game's own defaults, printed as the terms he plays
    // under; a subs scheme belongs to a club.
    expect(loose).not.toContain('per game');

    // At a club, the row is the club's own figures, so it is not simply gone.
    player.clubId = clubId;
    expect(page(state, player.id)).toContain('per game');
  });
});
