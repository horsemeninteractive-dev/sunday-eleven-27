import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FOUNDING_PYRAMID_ID } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { CompetitionId, ISODate, PyramidId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { formatDayMonth, toDate } from '@/simulation/calendar';
import { processDay } from '@/simulation/day';
import { draftLadders, generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import {
  COUNTY_CUP_ID,
  cupCompetitionId,
  cupCompetitions,
  LEAGUE_CUP_ID,
  PLATE_ID,
} from '@/simulation/pyramid';
import { createTestGame } from '@/simulation/testSupport';
import { cupBracket, openStageOf, type BracketStage } from './cupBracket';
import { CupBracketRail } from './views/CupView';

/**
 * The bracket, as the cup screen reads it.
 *
 * A knockout is read *down* the rounds — who is in each one, when it is played,
 * who went through and who is still waiting — and the screen could only ever show
 * the round in hand. What is held here is the whole road: every round of the plan
 * with its date and its size, the ties where they exist, and the manager's own
 * standing in each one, including the two readings a bracket gets wrong if it
 * guesses. A club on a bye did not miss the round, and a round nobody has drawn is
 * not a round a club is out of.
 *
 * Everything runs on a career the game actually builds. The season is played with
 * the ties settled by hand — a whole season of real ties is fifty-four of them
 * before the league's several hundred, and a bracket does not depend on the
 * football inside a tie, only on the fact that it ends with a winner — which is
 * the same technique `cupStructure.test.ts` uses, applied to the screens' reading
 * of the world rather than to the draw's own arithmetic.
 */

/** The ladder a career is founded with that is not the founding one. */
function districtIdOf(state: GameState): PyramidId {
  return state.pyramidIds.find((id) => id !== FOUNDING_PYRAMID_ID)!;
}

/** A career taken over in the district next door's top division. */
function districtCareer(seed: string): { state: GameState; clubId: string } {
  const draft = generateDraft({ seed, startYear: 2026, pyramids: 2 });
  const district = draftLadders(draft)[1]!;
  const clubId = district.divisions[0]![0]!;
  const state = startGameFromDraft(draft, { seed: draft.seed, startYear: 2026, clubId, saveName: 'District save' });
  return { state, clubId };
}

const stageOf = (stages: readonly BracketStage[], round: number): BracketStage =>
  stages.find((stage) => stage.round === round)!;

/** Every tie in the bracket belongs to the competition the bracket is of. */
function tiesOfBracket(stages: readonly BracketStage[], competitionId: CompetitionId): Match[] {
  return stages.flatMap((stage) => stage.ties).filter((tie) => tie.competitionId === competitionId);
}

/**
 * Settle every fixture due today by hand, so a season can be played without the
 * engine. The manager's own ties are decided deliberately: a bracket is *about*
 * what happened to him, and a result that depends on the length of the club ids
 * would test the arithmetic of `%` rather than the road.
 */
function settleTiesOn(state: GameState, date: ISODate, managerTakes: (match: Match) => 'win' | 'lose' | null): void {
  const manager = state.userClubId;
  for (const match of Object.values(state.matches)) {
    if (match.date !== date || match.played || match.status !== 'scheduled') continue;
    match.played = true;
    match.status = 'finished';
    let homeGoals = match.homeClubId.length % 3;
    let awayGoals = match.awayClubId.length % 2;
    const wants = match.knockout ? managerTakes(match) : null;
    if (wants !== null && (match.homeClubId === manager || match.awayClubId === manager)) {
      const managerAtHome = match.homeClubId === manager;
      const homeWins = managerAtHome === (wants === 'win');
      homeGoals = homeWins ? 3 : 0;
      awayGoals = homeWins ? 0 : 3;
    }
    match.result = {
      homeGoals,
      awayGoals,
      homeShots: 7,
      awayShots: 5,
      homePossession: 51,
      awayPossession: 49,
      attendance: 200,
    } as Match['result'];
    // A knockout tie is level at ninety minutes, so it is decided on penalties.
    if (match.knockout && homeGoals === awayGoals && match.result) {
      match.result.penalties = { home: 4, away: 3 };
      match.shootoutWinnerId = match.homeClubId;
    }
  }
}

/** Play the season's cups out, one day at a time, until every cup has a winner. */
function playTheCups(state: GameState, managerTakes: (match: Match) => 'win' | 'lose' | null): void {
  const cupsDecided = () => cupCompetitions(state).every((cup) => cup.cup?.complete);
  for (let day = 0; day < 460 && !cupsDecided(); day += 1) {
    settleTiesOn(state, state.date, managerTakes);
    const before = state.date;
    processDay(state, state.date);
    if (state.date === before) break;
  }
}

describe('the bracket of a cup', () => {
  it('is every round of the plan, the final last, each one dated', () => {
    const { state, clubId } = createTestGame('bracket-shape');
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    const stages = cupBracket(state, cup, clubId);

    // A 36-club ladder cup: a preliminary of eight, then a round of thirty-two,
    // and halving from there to a final of two.
    expect(stages.map((stage) => stage.name)).toEqual([
      'Preliminary Round',
      'Round of 32',
      'Last 16',
      'Quarter-finals',
      'Semi-finals',
      'Final',
    ]);
    expect(stages.map((stage) => stage.round)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stageOf(stages, 6).entrants).toBe(2);
    expect(stageOf(stages, 6).final).toBe(true);
    expect(stages.filter((stage) => stage.final)).toHaveLength(1);

    // Every round of a built season is dated, drawn or not: that is what lets the
    // screen say when the final is.
    for (const stage of stages) {
      expect(stage.date, `round ${stage.round} has no date`).toBeTruthy();
      expect(toDate(stage.date!).getUTCDay(), `round ${stage.round} is not on a Sunday`).toBe(0);
    }
    // The preliminary is the bottom of the seed order, so the other twenty-eight
    // clubs are on a bye into the round of thirty-two — read off the plan.
    expect(stageOf(stages, 1).field).toBe(36);
    expect(stageOf(stages, 1).byes).toBe(28);
    expect(stageOf(stages, 1).undrawn).toBe(false);
    expect(stageOf(stages, 1).ties).toHaveLength(4);
    for (const stage of stages.slice(1)) {
      expect(stage.ties).toEqual([]);
      expect(stage.undrawn).toBe(true);
      expect(stage.byes).toBe(0);
    }
  });

  it('opens on the round in hand, and on the final once there is none', () => {
    const { state, clubId } = createTestGame('bracket-open');
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    expect(openStageOf(cupBracket(state, cup, clubId))).toBe(1);
    expect(openStageOf([])).toBeNull();
  });

  it('counts the county cup as the eight rounds it is, drawn from both ladders', () => {
    const { state, clubId } = createTestGame('bracket-county');
    const county = state.competitions[COUNTY_CUP_ID]!;
    const stages = cupBracket(state, county, clubId);

    expect(stages).toHaveLength(8);
    expect(stageOf(stages, 1).field).toBe(72);
    expect(stageOf(stages, 1).entrants).toBe(8);
    expect(stageOf(stages, 1).byes).toBe(64);
    expect(stageOf(stages, 8).final).toBe(true);
    expect(stageOf(stages, 8).name).toBe('Final');

    // Every tie in it belongs to the county cup, whichever ladder its clubs play
    // in: a bracket is read from the competition's own matches.
    for (const stage of stages) {
      for (const tie of stage.ties) expect(tie.competitionId).toBe(COUNTY_CUP_ID);
    }
    const districtCup = cupCompetitionId(districtIdOf(state), 'cup');
    for (const tie of tiesOfBracket(cupBracket(state, state.competitions[districtCup]!, clubId), districtCup)) {
      expect(state.competitions[LEAGUE_CUP_ID]!.clubIds).not.toContain(tie.homeClubId);
    }
  });

  it('reads the manager on a bye as in the competition, not out of it', () => {
    // The default test career manages in the county's top division, which the
    // preliminary never takes: his opening round is one he sits out, and the
    // next round is the one he comes in at.
    const { state, clubId } = createTestGame('bracket-bye');
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    const stages = cupBracket(state, cup, clubId);

    const first = stageOf(stages, 1);
    expect(first.ties.some((tie) => tie.homeClubId === clubId || tie.awayClubId === clubId)).toBe(false);
    expect(first.road?.standing).toBe('sittingOut');
    // Where the bye leaves him, not the word "bye" a second time: the pill on the
    // row already says he sat it out.
    expect(first.road?.line).toBe('In at the Round of 32');
    expect(first.road?.note).toBe('');
    expect(cup.clubIds).toContain(clubId);

    // And the round he is actually waiting on says so, without pretending to know
    // who he will play.
    expect(stageOf(stages, 2).road?.standing).toBe('ahead');
    expect(stageOf(stages, 2).road?.line).toBe('Drawn once the Preliminary Round is settled');
    expect(stageOf(stages, 2).road?.tie).toBeUndefined();
  });

  it('has no road at all on a competition the manager is not in', () => {
    const { state, clubId } = createTestGame('bracket-not-mine');
    const other = state.competitions[cupCompetitionId(districtIdOf(state), 'cup')]!;
    const stages = cupBracket(state, other, clubId);
    expect(stages).toHaveLength(6);
    expect(stages.every((stage) => stage.road === null)).toBe(true);
    expect(other.clubIds).not.toContain(clubId);
  });

  it('reads a Plate that has not been filled yet as the competition it will be', () => {
    const { state, clubId } = createTestGame('bracket-plate-empty');
    const plate = state.competitions[PLATE_ID]!;
    const main = state.competitions[LEAGUE_CUP_ID]!;
    const stages = cupBracket(state, plate, clubId);

    expect(plate.clubIds).toEqual([]);
    expect(stages.length).toBeGreaterThan(3);
    expect(stageOf(stages, 1).field).toBe(20);
    expect(stageOf(stages, 1).entrants).toBe(8);
    expect(stageOf(stages, 1).byes).toBe(12);
    expect(stageOf(stages, stages.length).final).toBe(true);
    // Nobody is in it yet, so no stage marks the manager — and every round it has
    // is dated, so the screen can still say when the Plate's final is.
    expect(stages.every((stage) => stage.road === null)).toBe(true);
    expect(stages.every((stage) => stage.date)).toBe(true);
    expect(main.clubIds.length).toBe(36);
  });
});

describe('a season of cups, read as a road', () => {
  // One career played out once, with the manager losing every tie he plays in his
  // own ladder's cup and in the county cup, and winning the Plate — which is the
  // one competition he can only be in by having lost. The road then runs through
  // the whole of it: a bye, a tie lost, a competition he is out of, a Plate he
  // dropped into, and a trophy at the end of it.
  const { state, clubId } = createTestGame('bracket-road');
  playTheCups(state, (match) => (match.competitionId === PLATE_ID ? 'win' : 'lose'));

  const main = state.competitions[LEAGUE_CUP_ID]!;
  const plate = state.competitions[PLATE_ID]!;
  const county = state.competitions[COUNTY_CUP_ID]!;
  const bracket = cupBracket(state, main, clubId);

  it('shows the round he went out of, with the result, and nothing after it', () => {
    // A top-division club is on a bye in the preliminary, plays the round of
    // thirty-two, and loses it.
    expect(stageOf(bracket, 1).road?.standing).toBe('sittingOut');
    const out = stageOf(bracket, 2).road!;
    expect(out.standing).toBe('out');
    expect(out.line).toMatch(/^lost to /);
    expect(out.note).toBe('');
    expect(out.tie?.played).toBe(true);
    expect(out.opponentId).toBeDefined();

    // Every later round reads as one he is not in, and the round itself is
    // settled: the ties are there with their results.
    for (const stage of bracket.slice(2)) {
      expect(stage.road?.standing).toBe('notIn');
    }
    expect(stageOf(bracket, 2).complete).toBe(true);
    expect(stageOf(bracket, 2).ties.length).toBe(16);
    expect(main.clubIds).not.toContain(clubId);
  });

  it('reaches a final, and reads the champion off the last round', () => {
    const final = stageOf(bracket, bracket.length);
    expect(final.final).toBe(true);
    expect(final.name).toBe('Final');
    expect(final.complete).toBe(true);
    expect(final.ties).toHaveLength(1);
    expect(main.cup?.complete).toBe(true);
    expect(main.cup?.winnerClubId).toBeTruthy();
    expect(main.cup?.winnerClubId).not.toBe(clubId);

    // The final's own tie is in the bracket, and it is the cup's last match.
    const tie = final.ties[0]!;
    expect([tie.homeClubId, tie.awayClubId]).toContain(main.cup!.winnerClubId!);
    // Once a cup is complete nothing is "in hand" any more, and the screen opens
    // on the final instead.
    expect(bracket.some((stage) => stage.inHand)).toBe(false);
    expect(openStageOf(bracket)).toBe(final.round);
  });

  it('shows the Plate the manager dropped into by losing the round of thirty-two', () => {
    // The Plate is fed from the main cup's losers, so a club knocked out in the
    // round of thirty-two is in it — and the bracket has to show him there, which
    // is a fact no screen could state before this read the plan.
    expect(plate.cup?.complete).toBe(true);
    const plateBracket = cupBracket(state, plate, clubId);
    expect(plateBracket.some((stage) => stage.road !== null)).toBe(true);
    expect(plate.clubIds.length).toBeGreaterThan(0);

    // He is in the Plate's field, and its opening round is drawn from clubs that
    // lost the main cup: either he played it or he came into the next round on a
    // bye. He won every tie he played, so the road reads through.
    const first = plateBracket[0]!;
    expect(['sittingOut', 'through']).toContain(first.road!.standing);
    if (first.road!.standing === 'sittingOut') expect(first.road!.line).toMatch(/^In at the /);
    for (const stage of plateBracket) {
      if (stage.road?.tie) expect(stage.road.standing).toBe('through');
    }

    // He won it, and the bracket says so on the last round of the competition
    // rather than in a tile somewhere else.
    expect(plate.cup?.winnerClubId).toBe(clubId);
    const final = plateBracket[plateBracket.length - 1]!;
    expect(final.final).toBe(true);
    expect(final.road?.standing).toBe('through');
    expect(final.road?.note).toBe('Won it');
    expect(plateBracket.every((stage) => stage.complete)).toBe(true);
  });

  it('brings the county cup to a final too, on its own dates', () => {
    const countyBracket = cupBracket(state, county, clubId);
    expect(county.cup?.complete).toBe(true);
    expect(countyBracket).toHaveLength(8);
    for (const stage of countyBracket) {
      expect(stage.complete).toBe(true);
      expect(stage.date).toBeTruthy();
    }
    // His own road in it: out in the first round he played, like the ladder cup.
    const played = countyBracket.filter((stage) => stage.road?.tie);
    expect(played.length).toBeGreaterThan(0);
    expect(played[played.length - 1]!.road!.standing).toBe('out');
  });

  it('never marks a club in another ladder’s cup', () => {
    const other = state.competitions[cupCompetitionId(districtIdOf(state), 'cup')]!;
    expect(cupBracket(state, other, clubId).every((stage) => stage.road === null)).toBe(true);
  });

  it('reads the world without writing to it', () => {
    const before = JSON.stringify(state);
    cupBracket(state, main, clubId);
    cupBracket(state, plate, clubId);
    cupBracket(state, county, clubId);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('a cup with no plan of its own', () => {
  it('is the rounds it has drawn, which is the bracket a save from before plans has', () => {
    const { state, clubId } = createTestGame('bracket-legacy');
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    // What an in-progress career written before plans existed looks like: the
    // ties carry their round, and the competition carries no shape at all.
    const stripped: GameState = {
      ...state,
      competitions: {
        ...state.competitions,
        [LEAGUE_CUP_ID]: { ...cup, cup: { ...cup.cup!, plan: undefined } },
      },
    };

    const stages = cupBracket(stripped, stripped.competitions[LEAGUE_CUP_ID]!, clubId);
    expect(stages).toHaveLength(1);
    expect(stages[0]!.round).toBe(1);
    expect(stages[0]!.ties).toHaveLength(4);
    expect(stages[0]!.undrawn).toBe(false);
    // With no plan there is nothing to say the round is the final, so nothing
    // claims it is.
    expect(stages[0]!.final).toBe(false);
    expect(stages[0]!.road?.standing).toBe('sittingOut');
  });

  it('shows a career with one ladder the two cups it actually has', () => {
    const { state, clubId } = createTestGame('bracket-one-ladder', 0, 2026, 1);
    const cups = cupCompetitions(state);
    expect(cups.map((cup) => cup.id).sort()).toEqual([LEAGUE_CUP_ID, PLATE_ID].sort());
    const stages = cupBracket(state, state.competitions[LEAGUE_CUP_ID]!, clubId);
    expect(stages).toHaveLength(6);
    expect(stageOf(stages, 6).final).toBe(true);
    // A one-ladder county has no county cup to read, so nothing here invents one.
    expect(state.competitions[COUNTY_CUP_ID]).toBeUndefined();
  });
});

describe('the road to the final, as the cup screen draws it', () => {
  /*
   * The screen itself, printed. Everything above holds the model of the bracket;
   * this holds the thing the manager actually reads, and it is read for the three
   * claims the screen makes: that the competition is on it from its opening round
   * to its final, that the round he is on is the one whose ties are drawn, and
   * that the final's own row says what the road came to.
   *
   * One career, its cups played out with the manager winning every tie he plays —
   * which is the run the screen exists for, and the one that ends with a row
   * saying he won it. The rail is rendered from the same props the screen passes
   * it, which is why it is exported: a piece that reads nothing but what it is
   * given can be printed and checked without a browser.
   */
  const { state, clubId } = createTestGame('bracket-drawn');
  playTheCups(state, () => 'win');

  const cup = state.competitions[LEAGUE_CUP_ID]!;
  const stages = cupBracket(state, cup, clubId);
  const openRound = openStageOf(stages);
  const html = renderToStaticMarkup(
    createElement(CupBracketRail, {
      game: state,
      competition: cup,
      stages,
      openRound,
      onOpen: () => undefined,
    }),
  );

  it('is a row per round, the opening round first and the final last, each one dated', () => {
    const rows = [...html.matchAll(/bracket__title"><strong>([^<]+)<\/strong>/g)].map(
      (match) => match[1]!,
    );
    expect(rows).toEqual(stages.map((stage) => stage.name));
    expect(rows[rows.length - 1]).toBe('Final');
    // Every round is dated, which is what makes a season's final a date rather
    // than a name: a manager can see when it is before he can be in it.
    for (const stage of stages) {
      expect(stage.date, stage.name).toBeTruthy();
      expect(html).toContain(formatDayMonth(stage.date!));
    }
    // And every row is the control that opens it, closed or not.
    expect(html.match(/class="bracket__head"/g)?.length).toBe(stages.length);
  });

  it('opens on the round in hand and draws that round’s ties under it', () => {
    // The cups are played out, so there is no round in hand and the screen leads
    // with the final: the round the whole competition is read towards.
    const open = stages.find((stage) => stage.round === openRound)!;
    expect(open.final).toBe(true);
    expect(html).toContain(`id="bracket-round-${open.round}"`);
    // One row per tie, and no row of any other round's ties: a closed round draws
    // nothing, which is what keeps a six-round bracket a page and not a wall.
    expect(html.match(/class="fixrow(?: |")/g)?.length).toBe(open.ties.length);
    // Ties that were played carry their scoreline, so the road is a record of
    // afternoons rather than a diagram of names.
    for (const tie of open.ties) expect(html).toContain(tieScoreLineText(tie));
    // The rounds that are not drawn were not drawn here either: every other row
    // is closed, and its ties are not in the document at all.
    for (const stage of stages.filter((candidate) => candidate.round !== openRound)) {
      expect(html).not.toContain(`id="bracket-round-${stage.round}"`);
    }
  });

  it('says so rather than printing an empty list when there is no road to read', () => {
    // A competition the world calls a cup and that carries no shape and no drawn
    // round: a save written by a build that could produce one, or a world with a
    // competition in it nobody finished setting up. There is nothing to draw, and
    // the one thing the screen must not do under the heading "The road to the
    // final" is draw nothing at all.
    const empty = renderToStaticMarkup(
      createElement(CupBracketRail, {
        game: state,
        competition: cup,
        stages: [],
        openRound: null,
        onOpen: () => undefined,
      }),
    );
    expect(empty).toContain('no rounds to read');
    expect(empty).not.toContain('bracket__head');
  });

  it('says what the road came to on the manager’s own row', () => {
    expect(cup.cup?.winnerClubId).toBe(clubId);
    const final = stages[stages.length - 1]!.road!;
    expect(final.standing).toBe('through');
    expect(final.note).toBe('Won it');
    // Written on the row in words, beside the pill, and not left to the colour.
    expect(html).toContain('pill--ok">Through<');
    expect(html).toContain('Won it');
    // The rounds he had already come through say so as well, so the row he is on
    // is the end of a road rather than a fact on its own. A round he sat out on a
    // bye says that instead, and is counted as such rather than lumped in.
    const through = stages.filter((stage) => stage.road?.standing === 'through');
    expect(through.length).toBeGreaterThan(1);
    expect(html.match(/pill--ok">Through</g)?.length).toBe(through.length);
    expect(html).toContain('pill--muted">Bye<');
  });
});

/** The scoreline as the tie carries it, which is what the row prints. */
function tieScoreLineText(tie: Match): string {
  return `${tie.result!.homeGoals}-${tie.result!.awayGoals}`;
}

describe('a career that begins in the district next door', () => {
  const { state, clubId } = districtCareer('bracket-district');
  const districtCup = cupCompetitionId(districtIdOf(state), 'cup');

  it('is read in its own ladder’s cup, and not in the county’s own', () => {
    const stages = cupBracket(state, state.competitions[districtCup]!, clubId);
    expect(stages).toHaveLength(6);
    expect(stageOf(stages, 1).road?.standing).toBe('sittingOut');
    expect(state.competitions[LEAGUE_CUP_ID]!.clubIds).not.toContain(clubId);

    // The founding ladder's cup has nothing to do with him, and says nothing.
    const founding = cupBracket(state, state.competitions[LEAGUE_CUP_ID]!, clubId);
    expect(founding.every((stage) => stage.road === null)).toBe(true);

    // The county cup does have him in it: it spans both ladders.
    const county = cupBracket(state, state.competitions[COUNTY_CUP_ID]!, clubId);
    expect(county.some((stage) => stage.road !== null)).toBe(true);
    expect(state.competitions[COUNTY_CUP_ID]!.clubIds).toContain(clubId);
  });
});
