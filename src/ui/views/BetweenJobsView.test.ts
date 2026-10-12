import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The between-jobs screen, as the one place it can be read without a DOM.
 *
 * The screen is store-backed, and the store is not there in a server render —
 * `useSyncExternalStore` hands the server the store's *initial* state, so a
 * rendered snapshot of this screen is always the empty one. What is pinned here
 * is therefore the shape of the screen rather than a picture of it: that it uses
 * the career's real vacancies, that applying goes through `applyForJob`, and
 * that it does not offer a club screen's controls to a man with no club.
 */

const source = readFileSync('src/ui/views/BetweenJobsView.tsx', 'utf8');

describe('the between-jobs screen', () => {
  it('reads the career itself, not the club it left behind', () => {
    expect(source).toContain('game.career');
    expect(source).toContain('career?.openings');
    expect(source).toContain('career?.applied');
    expect(source).toContain('career?.lastClubId');
  });

  it('offers each open post a real way to apply for it', () => {
    expect(source).toContain('gameActions().applyForJob(opening.clubId)');
    // And marks the ones he has already approached rather than asking again.
    expect(source).toContain('Applied');
  });

  it('offers the record he has built as well as the jobs he could take', () => {
    expect(source).toContain('Your record');
    expect(source).toContain('spells');
  });

  it('says there is nothing on when the board is empty, rather than a blank panel', () => {
    expect(source).toContain('No club is advertising');
  });

  it('says when he went out of work, not when the manager looked at it', () => {
    // "Out of work since {today}" was true on the first morning of unemployment
    // and wrong on every morning after it: the date the manager is reading the
    // screen on is not the date he lost the job. The spell carries that date.
    expect(source).toContain('const outOfWorkSince = spells.find((spell) => spell.to)?.to ?? null;');
    expect(source).toContain('Out of work since ${formatShortDate(outOfWorkSince)}');
    expect(source).not.toContain('formatShortDate(game.date)');
  });

  it('moves the days on through the command bar, not a third hand on the clock', () => {
    // Time is moved from one place only; a view that reached for `continueGame`
    // itself would be a second Continue button, which the uiTuning contract
    // forbids.
    expect(source).not.toContain('continueGame');
    expect(source).toContain('runCommand');
  });
});
