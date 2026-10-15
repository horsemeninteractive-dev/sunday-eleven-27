import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createTestGame } from '@/simulation/testSupport';
import { clubTown } from '@/simulation/queries';

/**
 * The place a club plays in, wherever a ladder is read.
 *
 * A manager chooses a district off a map of named towns and then spends a career
 * in lists that name clubs and nothing else — a league table, a fixture row, a
 * result. The town is the one fact he arrived with and the one those screens left
 * out, so the rule is that a club named inside a ladder is named with its place:
 * the division's table, its week's fixtures, the cup's ties, his own fixture list
 * and the fixture sheet.
 *
 * It is drawn in one place — `ClubLink` asked for a town — and resolved in one
 * place — `clubTown` — because a screen that worked out its own town would be a
 * second copy of a rule about where a club is, and the second copy is the one that
 * goes wrong. The rendered half of these tests runs against a real career, with
 * the store's own game handed to it.
 */

const { state: game } = createTestGame('club-place');

vi.mock('@/ui/hooks', () => ({
  // Read through a getter rather than captured: the mock factory is hoisted above
  // this file's own setup, and the career exists by the time a render asks for it.
  useGame: () => game,
  gameActions: () => ({ openProfile: () => {} }),
}));

const { ClubLink } = await import('./../components/Links');

const source = (path: string) => readFileSync(`src/ui/${path}`, 'utf8');

describe('the town a club plays in', () => {
  it('is the place the club is registered in, and nothing when there is no club', () => {
    const club = game.clubs[game.userClubId]!;
    const town = game.world.towns[club.townId]!;
    expect(clubTown(game, club.id)).toEqual(town);
    // A club the world does not carry — an archived table's row from a club since
    // dissolved, a stale link — answers nothing rather than another place.
    expect(clubTown(game, 'club_that_never_existed')).toBeUndefined();
  });

  it('is drawn under the club’s name when the place is asked for, and not otherwise', () => {
    const club = game.clubs[game.userClubId]!;
    const town = game.world.towns[club.townId]!;
    const withTown = renderToStaticMarkup(createElement(ClubLink, { clubId: club.id, town: true }));
    const without = renderToStaticMarkup(createElement(ClubLink, { clubId: club.id }));

    expect(withTown).toContain(club.identity.name);
    expect(withTown).toContain(`<span class="clubcell__town">${town.name}</span>`);
    // A club named inside a sentence — 'v Draywick Social Club' — is a name, and
    // the cell does not grow a second line it was not asked for.
    expect(without).not.toContain('clubcell__town');
    expect(without).toContain(club.identity.name);
    // The place is on the cell's own tooltip either way, so who a club is and
    // where it is are both a hover away.
    expect(withTown).toContain(`${club.identity.name} — ${club.identity.nickname}, ${town.name}`);
  });

  it('is asked for by every screen that names clubs inside a ladder', () => {
    // The whole ladder: the division's table and last season's final one, and —
    // through the shared fixture row — the week's fixtures, the results elsewhere
    // in the division and every cup tie, plus the fixture sheet a next match or a
    // result is printed on.
    expect(source('views/LeagueView.tsx').match(/<ClubLink clubId=\{row\.clubId\} town \/>/g)?.length).toBe(2);
    const row = source('components/FixtureRow.tsx');
    expect(row).toContain('<ClubLink clubId={homeClubId} town />');
    expect(row).toContain('<ClubLink clubId={awayClubId} reverse town />');
    expect(source('components/FixtureCard.tsx')).toContain('<ClubLink clubId={club.id} town>');
    // And the manager's own season, which draws its opponent by hand: the same
    // place, on the same line under the name.
    const diary = source('views/FixturesView.tsx');
    expect(diary).toContain('clubTown(state, opponentId)');
    expect(diary).toContain('clubcell__town');
  });

  it('draws its place line as a line, quiet enough to sit under a name', () => {
    const css = source('styles.css');
    expect(css).toMatch(/\.clubcell__town \{[^}]*display: block/s);
    expect(css).toMatch(/\.clubcell__town \{[^}]*font-size: var\(--fs-xs\)/s);
    // A fixture row ellipsises the spans inside its sides, which is right for the
    // name in a row of names and wrong for the place under it: half a town is a
    // manager learning nothing.
    expect(css).toMatch(/\.fixrow__side \.clubcell__town \{[^}]*white-space: normal/s);
  });
});
