import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { MovementRecord } from '@/domain/competition';
import { ordinal } from '@/simulation/news';
import { divisionsOf, pyramidsOf, standingsFor } from '@/simulation/pyramid';
import { lastFinalTable, movementsFor } from '@/simulation/seasonHistory';
import { startNextSeason } from '@/simulation/season';
import { createTestGame, playSeason } from '@/simulation/testSupport';
import { archivedZone, FinalTable } from './LeagueView';

/**
 * Last season's table, as the league screen draws it.
 *
 * The league screen is where a manager reads the table he is in, so it is where
 * the tables behind him belong — and there is only one place they still exist,
 * because the world is rebuilt at the boundary: the divisions are cut again from
 * the field that came out of last season and every cup is redrawn. This holds the
 * piece that draws that table, against a career that has actually played a season
 * and rolled over into the next one.
 *
 * What a server render cannot prove is the store. Zustand hands React the store's
 * initial state on the server whatever has been written into it since, so every
 * club with a name drawn through `ClubLink` prints its no-career fallback here.
 * That is why the assertions below are about what the table is *given*: the
 * order of the positions it prints, the marks it puts on the clubs the ladder
 * moved, and the line underneath it, which is written from the archive rather
 * than from a link. The store-bound halves are the store's own tests' business.
 */

/** A career one season on, with the season it finished captured as it closed. */
function rolledOver(seed: string): {
  game: GameState;
  ownClubId: string;
  seasonId: string;
  seasonLabel: string;
  divisionId: string;
  rows: ReturnType<typeof standingsFor>;
  movements: MovementRecord[];
} {
  const { state, clubId } = createTestGame(seed);
  playSeason(state);
  const divisions = pyramidsOf(state).flatMap((pyramid) => divisionsOf(state, pyramid.id));
  const division = divisions.find((competition) => competition.clubIds.includes(clubId)) ?? divisions[0]!;
  const rows = standingsFor(state, division);
  const seasonId = state.season.id;
  const seasonLabel = state.season.label;
  // The world is rebuilt here: every competition replaced, every cup redrawn.
  startNextSeason(state);
  return {
    game: state,
    ownClubId: clubId,
    seasonId,
    seasonLabel,
    divisionId: division.id,
    rows,
    movements: movementsFor(state, seasonId, division.id),
  };
}

const career = rolledOver('league-archive');

function draw(season: ReturnType<typeof rolledOver>): string {
  const table = lastFinalTable(season.game, season.divisionId)!;
  return renderToStaticMarkup(
    createElement(FinalTable, {
      game: season.game,
      league: table.league,
      seasonLabel: table.season.seasonLabel,
      movements: season.movements,
      ownClubId: season.ownClubId,
    }),
  );
}

describe('the last season’s table', () => {
  it('prints the positions in the order the season ended, one row a club', () => {
    const html = draw(career);
    const positions = [...html.matchAll(/class="zone zone--\w+"[^>]*>(\d+)</g)].map((match) => Number(match[1]));
    expect(positions).toEqual(career.rows.map((_, index) => index + 1));
    // One club drawn a row, and the same clubs the archive kept: the table is the
    // season's own final order, not a table re-derived from what the world looks
    // like now.
    expect(html.match(/Unknown club/g)?.length).toBe(career.rows.length);
    expect(career.rows.length).toBeGreaterThan(2);
  });

  it('marks the manager’s own club, and says where he finished', () => {
    const html = draw(career);
    const mine = career.rows.findIndex((row) => row.clubId === career.ownClubId);
    expect(mine).toBeGreaterThanOrEqual(0);
    expect(html.match(/table__row--mine/g)?.length).toBe(1);
    expect(html).toContain('>you<');
    expect(html).toContain(`you finished ${ordinal(mine + 1)}`);
  });

  it('says which season it is, who won it, and who went up and down out of it', () => {
    const html = draw(career);
    const champion = career.game.clubs[career.rows[0]!.clubId]!;
    expect(html).toContain(career.seasonLabel);
    expect(html).toContain(`won by ${champion.identity.name}`);
    // The boundary is the ladder's own record of it, so the promoted and
    // relegated clubs are marked from `promotionHistory` and from nothing else.
    // A division with nothing above it promotes nobody, and says so.
    const up = career.movements.filter((movement) => movement.direction === 'promoted').length;
    const down = career.movements.filter((movement) => movement.direction === 'relegated').length;
    expect(up + down).toBeGreaterThan(0);
    expect(html.match(/>promoted</g)?.length ?? 0).toBe(up);
    expect(html.match(/>relegated</g)?.length ?? 0).toBe(down);
    // The champion wears the title mark, so a champion who also went up is not
    // counted twice: the position mark is one mark a row.
    const championPromoted = career.movements.some(
      (movement) => movement.direction === 'promoted' && movement.clubId === career.rows[0]!.clubId,
    );
    expect(html.match(/zone--promotion/g)?.length ?? 0).toBe(up - (championPromoted ? 1 : 0));
    expect(html.match(/zone--relegation/g)?.length ?? 0).toBe(down);
    expect(html).toContain(
      up > 0 ? `${up} club${up === 1 ? '' : 's'} went up out of it` : 'Nobody went up out of it',
    );
    // Every club the ladder moved was in the table it moved them out of.
    for (const movement of career.movements) {
      expect(career.rows.map((row) => row.clubId)).toContain(movement.clubId);
    }
  });

  it('marks a row by what that season did with it, not by today’s places', () => {
    // The champion of a division that has since been promoted out of is not
    // marked as a promotion place by the competition it now plays in: the mark is
    // the season's own outcome.
    expect(archivedZone(1, 'relegated')).toBe('title');
    expect(archivedZone(2, 'promoted')).toBe('promotion');
    expect(archivedZone(11, 'relegated')).toBe('relegation');
    expect(archivedZone(6, undefined)).toBe('mid');
    expect(archivedZone(6, 'promoted')).toBe('promotion');
  });

  it('is offered by the league screen, under the table it is in', () => {
    // The screen itself cannot be printed here — it reads the career out of the
    // store, and a server render is handed the store's initial state — so the
    // wiring is held to the source: the screen asks the archive for the division
    // it is showing, and draws the table behind its own season, one click down,
    // where a manager reading a table would look for last season's.
    const view = readFileSync('src/ui/views/LeagueView.tsx', 'utf8');
    expect(view).toContain('lastFinalTable(game, competition.id)');
    expect(view).toContain('movementsFor(game, final.season.seasonId, competition.id)');
    expect(view).toContain('<FinalTable');
    expect(view).toMatch(/<details className="more">[\s\S]{0,200}\.season\.seasonLabel/);
    // And a division that did not play that season is told so, rather than shown
    // a table from somewhere else.
    expect(view).toContain('was not played in');
  });

  it('is drawn from the archive after the world it describes has been rebuilt', () => {
    // The competition the table belonged to is this season's now — a different
    // field, cut again — so the rows cannot have come from it.
    const table = lastFinalTable(career.game, career.divisionId)!;
    expect(table.season.seasonId).toBe(career.seasonId);
    expect(career.game.season.id).not.toBe(career.seasonId);
    expect(table.league.rows).toEqual(career.rows);
    // And a career that has not finished a season has no tab to offer: there is
    // nothing to say about a season nobody has played.
    const { state } = createTestGame('league-archive-none');
    expect(lastFinalTable(state, career.divisionId)).toBeNull();
  });
});
