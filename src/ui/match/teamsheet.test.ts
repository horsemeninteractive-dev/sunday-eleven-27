import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { isPlayer, type Player } from '@/domain/person';
import type { PlayerPerformance } from '@/domain/match';
import { MatchDetailPanel } from '../components/FixtureInfo';
import { nextFixtureFor } from '@/simulation/schedule';
import { buildLineupForClub, prepareMatchday } from '@/simulation/matchday';
import { createTestGame } from '@/simulation/testSupport';
import { TEXT_CONTRAST_FLOOR, contrastRatio, flatClubInk } from '../colour';
import { clubKit, matchKeeperColours, matchKitColours, matchTeamColours } from '../kit';
import { TeamSheet } from './TeamSheet';

/**
 * The written version of the eleven, in the shirt.
 *
 * The two sheets down either side of the pitch are the list of who is out
 * there, and a list of footballers is a list of shirts: whose they are, and
 * which of them is the man in goal. So the sheet is headed in the strip the side
 * turned out in and every row carries that man's own shirt down its edge — the
 * side's strip for the ten, and the club's third strip for the keeper, which is
 * the one shirt on the sheet that belongs to no side's strip but his club's.
 *
 * What is pinned here is the sheet's own behaviour, drawn from a real career:
 * one shirt per row, exactly one keeper's shirt per side and on the keeper's own
 * row, and the ten left without a colour of their own. Where those colours come
 * from — the same `match/shirt.ts` the pitch asks, and the render state's own
 * colours rather than a second reading of the kits — is pinned beside this in
 * `shirt.test.ts` and in `workspaces.test.ts`.
 */

/** Everything the sheet needs, from a career whose kits have been drawn. */
function sheets(seed: string) {
  const { state, clubId } = createTestGame(seed);
  const match = nextFixtureFor(state, clubId, state.date)!;

  const playerById = (id: string): Player | undefined => {
    const person = state.people[id];
    return isPlayer(person) ? person : undefined;
  };

  /**
   * One side's sheet, drawn with the colours `MatchView` hands it.
   *
   * The two calls are the view's own, so what is rendered here is what the
   * match screen renders: the strips the sides actually turned out in (a visitors'
   * clash is the visitors' problem, not their identity's) and each side's own
   * third strip for the man in goal.
   */
  const draw = (side: 'home' | 'away') => {
    const sideClubId = side === 'home' ? match.homeClubId : match.awayClubId;
    const club = state.clubs[sideClubId]!;
    const lineup = buildLineupForClub(state, sideClubId);
    const kits = matchKitColours(state, match.homeClubId, match.awayClubId);
    const keepers = matchKeeperColours(state, match.homeClubId, match.awayClubId);
    const colours = { primary: kits[side], secondary: club.identity.colours.secondary, keeper: keepers[side] };
    return {
      club,
      lineup,
      colours,
      /** The club's own third strip, read straight from its kit rather than from the sheet. */
      third: clubKit(state, sideClubId)!.goalkeeper.primary,
      html: renderToStaticMarkup(
        createElement(TeamSheet, { side, club, lineup, match, playerById, colours }),
      ),
    };
  };

  return { state, match, draw };
}

/** The rows of a rendered sheet, in order. */
const rows = (html: string): string[] => html.split('<li ').slice(1);

const keeperRows = (lineup: { starting: { position: string }[]; bench: { position: string }[] }) =>
  [...lineup.starting, ...lineup.bench].filter((slot) => slot.position === 'GK').length;

describe('a team sheet wears the shirts of the men on it', () => {
  it('draws one shirt per man, on the eleven and on the bench alike', () => {
    for (const side of ['home', 'away'] as const) {
      const { html, lineup } = sheets(`sheet-shirts-${side}`).draw(side);
      const men = lineup.starting.length + lineup.bench.length;
      expect(men, 'nobody was picked').toBeGreaterThan(11);
      expect(html.match(/class="teamsheet__shirt/g), `${side}: one bar per man`).toHaveLength(men);
      expect(rows(html), `${side}: a bar on every row`).toHaveLength(men);
      for (const row of rows(html)) expect(row).toContain('teamsheet__shirt');
    }
  });

  it('heads the sheet in the strip the side turned out in, with an ink that reads on it', () => {
    for (const side of ['home', 'away'] as const) {
      const { html, colours } = sheets(`sheet-head-${side}`).draw(side);
      // The strip, edge to edge: the band the club's name sits on is the shirt
      // and not a tint of the panel.
      expect(html).toContain(`--sheet-colour:${colours.primary}`);
      // And the name is written in a colour measured for that strip, which is the
      // whole reason a white away shirt can have its own name on it.
      expect(html).toContain(`--sheet-ink:${flatClubInk(colours.primary)}`);
      // And it is legible on the strip, by the game's own floor for text on a
      // colour. `flatClubInk` is the ink that tries both and keeps the one that
      // clears it; a brightness test would hand a saturated strip a white name
      // that measures under four to one, which is why the sheet asks this one.
      expect(contrastRatio(flatClubInk(colours.primary), colours.primary)).toBeGreaterThanOrEqual(
        TEXT_CONTRAST_FLOOR,
      );
    }
  });

  it('marks the man in goal with his club’s third strip, and only him', () => {
    for (const side of ['home', 'away'] as const) {
      const { html, lineup, third } = sheets(`sheet-keeper-${side}`).draw(side);
      const keepers = keeperRows(lineup);
      expect(keepers, `${side}: no keeper was picked`).toBeGreaterThan(0);

      // The one shirt on the sheet that is not the side's own, worn by the one man
      // the laws ask to be told apart — and the colour is his club's third strip,
      // read straight off the kit rather than taken on trust from the sheet.
      expect(html.match(/teamsheet__shirt--keeper/g), `${side}: keeper marks`).toHaveLength(keepers);
      expect(html.match(/teamsheet__shirt teamsheet__shirt--keeper" style="background:/g)).toHaveLength(keepers);
      expect(html).toContain(`background:${third}`);
      // The ten are left to the stylesheet, which paints them from the sheet's own
      // strip: the same division the formation board draws the eleven with.
      expect(html.match(/class="teamsheet__shirt"/g)).toHaveLength(lineup.starting.length + lineup.bench.length - keepers);

      // And the marked row is the keeper's own row — the code in it still says so,
      // which is what makes the colour a second telling rather than the only one.
      const marked = rows(html).filter((row) => row.includes('teamsheet__shirt--keeper'));
      expect(marked.length).toBe(keepers);
      for (const row of marked) expect(row).toContain('>GK<');
      // Nobody else's row is marked.
      for (const row of rows(html).filter((row) => !row.includes('teamsheet__shirt--keeper'))) {
        expect(row).not.toContain('>GK<');
      }
    }
  });

  it('keeps the code beside the shirt, so the colour is a second telling', () => {
    // The keeper's row has said "GK" since the sheet existed, and the shirt does
    // not replace it: a manager reads the code, and finds the man by the colour.
    const { html } = sheets('sheet-codes').draw('home');
    expect(html).toContain('<span class="teamsheet__pos">GK</span>');
    expect(html).toContain('<span class="teamsheet__pos">CB</span>');
    // The bars themselves are decoration: they carry no text and are not read out.
    expect(html.match(/teamsheet__shirt[^>]*aria-hidden="true"/g)).toHaveLength(
      html.match(/class="teamsheet__shirt/g)!.length,
    );
  });
});

/** One side's sheet out of a page that holds both, so each can be read alone. */
function sheetHtml(html: string, side: 'home' | 'away'): string {
  const mark = `class="teamsheet teamsheet--${side}"`;
  const from = html.indexOf(mark);
  expect(from, `the ${side} sheet is not on the page`).toBeGreaterThanOrEqual(0);
  return html.slice(from, html.indexOf('</aside>', from));
}

/**
 * The same two sheets, on the screen a match is read on after the whistle.
 *
 * The live match stands a sheet down either side of the pitch, and the two views
 * a manager opens afterwards — the replay of an afternoon and the report on it —
 * are that same afternoon, so they draw the same lists from the same shirts.
 * What is pinned here is that the report really does carry both sides' sheets, in
 * the strips the sides played in and with each keeper marked the way the pitch
 * marks him. The replay's wiring is a source contract in `workspaces.test.ts` and
 * a measurement in the browser, because a screen with a clock of its own is not
 * something that can be rendered to a string.
 */
describe('the played-match views draw the same sheets', () => {
  /** The manager's own fixture, both elevens picked and a result on the record. */
  function playedFixture(seed: string) {
    const { state, clubId } = createTestGame(seed);
    const match = nextFixtureFor(state, clubId, state.date)!;
    // Picked on the day, for both sides, exactly as the matchday does it: a report
    // with one eleven missing in it is a report of a different afternoon.
    prepareMatchday(state, match.matchday);
    match.played = true;
    match.status = 'finished';
    match.result = {
      homeGoals: 2,
      awayGoals: 1,
      homeShots: 12,
      awayShots: 7,
      homePossession: 55,
      awayPossession: 45,
      attendance: 312,
    };
    return { state, match, clubId };
  }

  /** One man's afternoon, in the shape the record keeps it. */
  function performance(playerId: string, clubId: string, goals = 0): PlayerPerformance {
    return {
      playerId,
      clubId,
      started: true,
      minutesPlayed: 90,
      positionPlayed: 'ST',
      goals,
      assists: 0,
      shots: goals,
      shotsOnTarget: goals,
      passes: 20,
      passesCompleted: 15,
      tackles: 1,
      interceptions: 0,
      saves: 0,
      fouls: 0,
      yellowCards: 0,
      redCards: 0,
      rating: 6.8,
      cameOnMinute: null,
      wentOffMinute: null,
      energy: 70,
      injuryDetail: null,
      sentOff: false,
    };
  }

  it('heads both sheets in the strip their side played in, and marks the keeper', () => {
    const { state, match } = playedFixture('report-sheets');
    const html = renderToStaticMarkup(createElement(MatchDetailPanel, { state, match }));
    const strips = matchTeamColours(state, match.homeClubId, match.awayClubId);

    for (const side of ['home', 'away'] as const) {
      const sheet = sheetHtml(html, side);
      const lineup = match.lineups[side];
      const men = lineup.starting.length + lineup.bench.length;
      // Both elevens and both benches, because a report is a document about the
      // afternoon and the line-ups are half of what it is a document about.
      expect(men, `${side}: nobody was picked`).toBeGreaterThan(11);
      expect(sheet.match(/class="teamsheet__shirt/g), `${side}: one bar per man`).toHaveLength(men);

      // Headed in the strip the side turned out in — the away shirt for a visitor,
      // not the club's own colour — with the name's ink measured for that colour.
      expect(sheet).toContain(`--sheet-colour:${strips[side].primary}`);
      expect(sheet).toContain(`--sheet-ink:${flatClubInk(strips[side].primary)}`);
      expect(
        contrastRatio(flatClubInk(strips[side].primary), strips[side].primary),
        `${side}: the club's name reads on its own shirt`,
      ).toBeGreaterThanOrEqual(TEXT_CONTRAST_FLOOR);

      // And the keeper is marked in the third strip — the one shirt on the sheet
      // that is not the side's — exactly as the sheet beside the live pitch is.
      const keepers = keeperRows(lineup);
      expect(keepers, `${side}: no keeper was picked`).toBeGreaterThan(0);
      expect(sheet.match(/teamsheet__shirt--keeper/g), `${side}: keeper marks`).toHaveLength(keepers);
      expect(sheet).toContain(`background:${strips[side].keeper}`);
      // Which is not the shirt of the ten, or the marking would say nothing.
      expect(strips[side].keeper, `${side}: the third strip is the outfield one`).not.toBe(
        strips[side].primary,
      );
    }
  });

  it('says what the men did, because a report is the record of the afternoon', () => {
    const { state, match } = playedFixture('report-marks');
    const scorer = match.lineups.home.starting.find((slot) => slot.position !== 'GK')!;
    match.performances[scorer.playerId] = performance(scorer.playerId, match.homeClubId, 2);

    const sheet = sheetHtml(renderToStaticMarkup(createElement(MatchDetailPanel, { state, match })), 'home');
    // The marks are the half of a sheet a replay deliberately leaves off, and the
    // half a report cannot: it is the record of what happened.
    expect(sheet).toContain('teamsheet__mark--goal');
    expect(sheet).toContain('⚽2');
  });
});
