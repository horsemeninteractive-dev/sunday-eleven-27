import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRIENDLY_COMPETITION_ID } from '@/domain/competition';
import { FOUNDING_COUNTY_NAME, NATION_NAME } from '@/domain/world';
import { cupGroups, cupOptions, pyramidOptions } from '../worldNav';
import { cupRoundName, cupRoundOf } from '@/simulation/cup';
import { COUNTY_CUP_NAME, LEAGUE_CUP_NAME, PLATE_NAME } from '@/simulation/pyramid';
import { createTestGame } from '@/simulation/testSupport';
import { fixtureKind } from './FixturesView';

/**
 * How a competition is named on the screens that name one.
 *
 * Three of them do, and all three had the same fault: a competition was shortened
 * to the one word that fitted — 'Cup', 'Plate' — which stopped being readable the
 * moment a county had two ladders. Five knockouts in one list, two of them called
 * 'Cup'; a schedule row that said 'Cup · Quarter-finals' without saying which cup;
 * and a selector offering one competition for two. The county's own cup was called
 * flatly 'County Cup', which is a description rather than a name, and is now the
 * Alderfordshire County Cup — the county's cup, named after the county.
 *
 * What is held here is the rule those screens now follow: a competition is named
 * in full (the model's own name, never half of one), the league table and the cup
 * screen each ask their question once from a control grouped by ladder, and the
 * schedule names the cup a fixture belongs to on the line where a long name wraps.
 * The options come from the model rather than from a rendered screen because the
 * screens read their career out of the store, and a server render is handed the
 * store's initial state; the wiring is held to the source, in the same way the
 * season archive's own screen test does it.
 */
function source(path: string): string {
  return readFileSync(path, 'utf8');
}

const career = createTestGame('competition-naming');

describe('a competition is offered under its own full name', () => {
  it('never as a bare "Cup" or "Plate"', () => {
    const cups = cupOptions(career.state);
    for (const cup of cups) {
      // The competition's own name, and a name that says what it is: the two
      // words that used to be enough are the two that are never used.
      expect(cup.name).toBe(cup.competition.name);
      expect(cup.name).not.toBe('Cup');
      expect(cup.name).not.toBe('Plate');
      expect(cup.name.length).toBeGreaterThan('Plate'.length);
    }
    expect(new Set(cups.map((cup) => cup.name)).size).toBe(cups.length);
  });

  it('names the county cup after the county it is the cup of', () => {
    const [county] = pyramidOptions(career.state);
    const countyCup = cupOptions(career.state).find((cup) => cup.scope === 'county')!;
    // The county's own cup, its own name, and a county that is named rather than
    // drawn from the seed — so a bracket can be read as one county's.
    expect(countyCup.name).toBe(`${FOUNDING_COUNTY_NAME} County Cup`);
    expect(countyCup.name).toBe(COUNTY_CUP_NAME);
    expect(countyCup.name).toBe('Alderfordshire County Cup');
    expect(countyCup.owner).toBe(career.state.world.countyName);
    // A ladder's cups carry the district its clubs come from — the founding
    // ladder's two included: they are Alderford's, not nobody's.
    const ladderCups = cupOptions(career.state).filter((cup) => cup.scope === 'pyramid');
    expect(ladderCups.map((cup) => cup.name)).toContain(`${county!.region} ${LEAGUE_CUP_NAME}`);
    expect(ladderCups.map((cup) => cup.name)).toContain(`${county!.region} ${PLATE_NAME}`);
    const district = pyramidOptions(career.state).find((entry) => entry.id !== county!.id)!;
    const districtCups = ladderCups.filter((cup) => cup.pyramid?.id === district.id);
    expect(districtCups).toHaveLength(2);
    for (const cup of districtCups) expect(cup.name.startsWith(district.region)).toBe(true);
    // Two ladders' cups are four different names, which is the whole point of the
    // district naming its own after the region it draws its clubs from.
    expect(new Set(ladderCups.map((cup) => cup.name)).size).toBe(4);
  });

  it('names the county, and the country it sits in, once', () => {
    expect(FOUNDING_COUNTY_NAME).toBe('Alderfordshire');
    expect(NATION_NAME).toBe('Alderland');
    expect(career.state.world.countyName).toBe(FOUNDING_COUNTY_NAME);
    expect(career.state.world.nationName).toBe(NATION_NAME);
    // The county is named, not sprayed over everything inside it: a ladder is
    // still named after the region its clubs come from, which is drawn from the
    // seed and belongs to the manager's world.
    const [county] = pyramidOptions(career.state);
    expect(county!.divisions[0]!.name).toContain(county!.region);
    expect(county!.divisions[0]!.name).not.toContain(FOUNDING_COUNTY_NAME);
  });
});

describe('a fixture says which competition it is in', () => {
  const ties = Object.values(career.state.matches).filter((match) => match.knockout && !match.played);

  it('names the cup in full, and never as "Cup" or "Plate"', () => {
    expect(ties.length).toBeGreaterThan(0);
    for (const tie of ties) {
      const kind = fixtureKind(career.state, tie);
      const cup = career.state.competitions[tie.competitionId]!;
      // The chip is the kind of afternoon, and the competition is named in full
      // on the line under the opponent — where a name that long wraps instead of
      // taking the width the fixture's two clubs need.
      expect(kind.tone).toBe('accent');
      // The chip is the round the plan gives the tie, and nothing else: a chip
      // that said 'Cup' would be a word rather than the competition's own round,
      // and the same eight clubs are the quarter-finals in one round and the
      // preliminary in another.
      const round = cupRoundOf(career.state, cup, tie);
      expect(kind.label).toBe(cupRoundName(cup, round));
      expect(kind.detail).toBe(cup.name);
      expect(kind.detail).not.toBe('Cup');
      expect(kind.detail).toContain('Cup');
    }
  });

  it('says the rung for a league game and the friendliness of a friendly', () => {
    const league = Object.values(career.state.matches).find((match) => {
      const competition = career.state.competitions[match.competitionId];
      return competition?.kind === 'league';
    })!;
    const kind = fixtureKind(career.state, league);
    // The rung alone: every league fixture in his schedule is in his own
    // division, and the ladder's name on all of them would be the same words on
    // every row of the page.
    expect(kind.label).toBe('Division One');
    expect(kind.detail).toBeNull();
    expect(kind.tone).toBe('ok');

    const friendly = Object.values(career.state.matches).find(
      (match) => match.competitionId === FRIENDLY_COMPETITION_ID,
    );
    if (friendly) expect(fixtureKind(career.state, friendly).label).toBe('Friendly');
  });
});

describe('each screen picks a competition with one control', () => {
  it('offers the world screen the ladders and the cups grouped by them', () => {
    const groups = cupGroups(career.state);
    expect(groups.length).toBeGreaterThan(1);
    // One group per ladder, and the county's own last: the county/district choice
    // and the competition inside it are the same choice.
    expect(groups[groups.length - 1]!.pyramid).toBeNull();
    expect(groups[groups.length - 1]!.label).toBe(career.state.world.countyName);
    for (const group of groups.slice(0, -1)) {
      expect(group.label).toBe(group.pyramid!.name);
      expect(group.cups.length).toBe(2);
    }
  });

  it('prints those groups in the league table and the cup screen, and no tabstrip', () => {
    const league = source('src/ui/views/LeagueView.tsx');
    const cup = source('src/ui/views/CupView.tsx');
    for (const view of [league, cup]) {
      // One select, its options grouped by the football they belong to, and no
      // tabs left to wrap onto a second line.
      expect(view.split('<select').length - 1).toBe(1);
      expect(view).toContain('<optgroup');
      expect(view).not.toContain('segmented');
      expect(view).not.toContain('PyramidPicker');
    }
    // The league table lists every division of every ladder, grouped, and marks
    // his own rung inside his own ladder.
    expect(league).toContain('pyramidOptions(game)');
    expect(league).toContain('entry.divisions.map((division) =>');
    expect(league).toContain("division.id === ownDivision?.id ? ' — yours' : ''");
    // The cup screen lists the competitions from the grouped model, by the names
    // the model gives them.
    expect(cup).toContain('cupGroups(game)');
    expect(cup).toContain('group.cups.map((option) =>');
    expect(cup).toContain('{option.name}');
  });
});
