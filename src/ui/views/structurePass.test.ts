import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StandingRow } from '@/domain/club';
import type { Competition } from '@/domain/competition';
import { BENCH_SIZE, FULL_SIDE } from '@/domain/match';
import {
  CAREER_START_YEAR,
  EARLIEST_FOUNDED_YEAR,
  applyCustomClub,
  foundedYearWithin,
  generateDraft,
} from '@/simulation/gameSetup';
import { defaultRoleFor } from '@/simulation/match/roles';
import { squadOf } from '@/simulation/queries';
import { OPEN_SESSION_COST, holdOpenSession } from '@/simulation/recruitment/discovery';
import { validateLineup } from '@/simulation/selection';
import { createTestGame } from '@/simulation/testSupport';
import { HALL_HIRE_COST } from '@/simulation/training/session';
import { moneyRange } from '../format';
import { contextLabel, contextValue, inDropZone, zoneFor } from './LeagueView';
import { longestServingPlayer } from './HistoryView';
import { historySummary } from './TrainingView';

/**
 * What the structure-only pass found, held to the change that closes each one.
 *
 * The fourteen screens that had only been read for their headings were read line
 * by line, and what they turned up was mostly the same shape of thing: a number
 * the game knows written a second time in a screen — a bench of five, a full side
 * of eleven, a price, the year a career begins — or a sentence worked out from
 * the wrong fact. Each of those is a rule that would drift back the moment the
 * simulation's copy and the screen's copy disagreed, so each is pinned here: the
 * law is asserted through the code that enforces it, and the screen is asserted to
 * be reading that same code rather than restating it.
 *
 * These are contracts rather than a second audit. Where a value can be exercised
 * — a bench, a charge, a club being founded — the test runs it; where the thing
 * being checked is that one file and not another owns a rule, it reads the file,
 * which is what the audit's own source sweeps do.
 */

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('the bench is one number', () => {
  const role = defaultRoleFor('CM');
  const slot = (playerId: string) => ({ playerId, position: 'CM' as const, role });
  const eleven = Array.from({ length: FULL_SIDE }, (_, index) => ({ ...slot(`p${index}`), outOfPosition: false }));

  it('takes a full bench and refuses one more, in the law\'s own number', () => {
    const bench = Array.from({ length: BENCH_SIZE }, (_, index) => slot(`b${index}`));
    const allowed = validateLineup(eleven, bench, () => undefined);
    expect(allowed.some((problem) => problem.message.includes('substitutes'))).toBe(false);

    const refused = validateLineup(eleven, [...bench, slot('b-extra')], () => undefined);
    expect(
      refused.some((problem) => problem.severity === 'error' && problem.message.includes(`${BENCH_SIZE} substitutes`)),
    ).toBe(true);
  });

  it('is what the team sheet counts its places in', () => {
    const view = source('src/ui/views/TeamSelectionView.tsx');
    expect(view).toContain('lineup.bench.length >= BENCH_SIZE');
    expect(view).toContain('/{BENCH_SIZE}');
    expect(view).not.toMatch(/bench\.length >= \d/);
    expect(source('src/simulation/selection.ts')).not.toMatch(/bench\.length > \d/);
  });
});

describe('a price on a screen is the price the game charges', () => {
  it('spends the open session within the range the button quotes', () => {
    const { state, clubId } = createTestGame('open-session-price');
    const club = state.clubs[clubId]!;
    holdOpenSession(state);

    const charged = club.finances.ledger.filter((entry) => entry.description.startsWith('Open session'));
    expect(charged).toHaveLength(1);
    const cost = -charged[0]!.amount;
    expect(cost).toBeGreaterThanOrEqual(OPEN_SESSION_COST.min);
    expect(cost).toBeLessThanOrEqual(OPEN_SESSION_COST.max);

    // And the screen is printing that range rather than remembering it: the copy
    // said £20–£40 for a session the game charges £18–£42 for.
    const view = source('src/ui/views/RecruitmentView.tsx');
    expect(view).toContain('moneyRange(OPEN_SESSION_COST)');
    expect(view).not.toMatch(/£\d+–£\d+/);
    expect(source('src/simulation/recruitment/discovery.ts'))
      .toContain('rng.int(OPEN_SESSION_COST.min, OPEN_SESSION_COST.max)');
    expect(moneyRange(OPEN_SESSION_COST)).toBe('£18–£42');
  });

  it('quotes the hall at what a night in it costs', () => {
    expect(source('src/simulation/training/session.ts'))
      .toContain('rng.int(HALL_HIRE_COST.min, HALL_HIRE_COST.max)');
    const view = source('src/ui/views/TrainingView.tsx');
    expect(view).toContain('moneyRange(HALL_HIRE_COST)');
    expect(view).not.toMatch(/£\d+–£\d+/);
    expect(moneyRange(HALL_HIRE_COST)).toBe('£18–£32');
  });
});

describe('the training screen', () => {
  it('measures a thin turnout against the side the game is built for', () => {
    const view = source('src/ui/views/TrainingView.tsx');
    expect(view).toContain('attending.length < FULL_SIDE');
    expect(view).not.toMatch(/attending\.length < \d/);
  });

  it('does not count the same sessions twice', () => {
    expect(historySummary(0, 0)).toBe('Nothing on record yet');
    expect(historySummary(1, 0)).toBe('1 session');
    expect(historySummary(12, 2)).toBe('12 sessions · 2 called off');
    // The line used to read "12 sessions · 12 on file": the club's own sessions,
    // counted a second way.
    expect(source('src/ui/views/TrainingView.tsx')).toContain('historySummary(history.length, calledOff)');
  });
});

describe('the longest-serving player', () => {
  it('is the man who has been at the club longest, not the man who has played most', () => {
    const { state, clubId } = createTestGame('longest-serving');
    const squad = squadOf(state, clubId);
    expect(squad.length).toBeGreaterThan(2);

    // The two facts pulled apart, so a screen reading the wrong one cannot pass
    // by accident: the man with the record number of appearances joined last
    // week, and the man who has been here longest has never played.
    const longest = squad[0]!;
    for (const player of squad) {
      player.joinedClubOn = '2026-08-01';
      player.record.appearances = 0;
    }
    longest.joinedClubOn = '2025-07-01';
    const mostPlayed = squad[1]!;
    mostPlayed.record.appearances = 40;

    expect(longestServingPlayer(squad)).toBe(longest);
    // And the sentence under the table is what asks it, rather than working the
    // answer out again for itself — which is where the wrong fact was read.
    expect(source('src/ui/views/HistoryView.tsx')).toContain('longestServingPlayer(squad)');
    // The tile above the sentence keeps its own reading, which is the other fact.
    expect([...squad].sort((a, b) => b.record.appearances - a.record.appearances)[0]).toBe(mostPlayed);
  });
});

describe('where a club stands relative to the drop', () => {
  /** A season's table, strongest first: no promotion, three down. */
  const topDivision: Competition = {
    id: 'competition_test',
    name: 'Division One',
    kind: 'league',
    tier: 1,
    seasonId: 'season_2026_27',
    clubIds: [],
    relegationPlaces: 3,
  };
  const standings: StandingRow[] = Array.from({ length: 20 }, (_, index) => ({
    clubId: `club_${index}`,
    played: 10,
    won: 5,
    drawn: 5,
    lost: 0,
    goalsFor: 20,
    goalsAgainst: 10,
    goalDifference: 10,
    points: (20 - index) * 2,
    form: [],
  }));

  it('says the same thing about a club as the mark on its row', () => {
    for (let position = 1; position <= standings.length; position += 1) {
      const inDrop = inDropZone(standings, position, topDivision);
      expect(inDrop).toBe(zoneFor(position, standings.length, topDivision) === 'relegation');
      expect(contextLabel(topDivision, inDrop)).toBe(inDrop ? 'In the drop' : 'Above the drop');
    }
  });

  it('does not tell a club in the bottom three that it is above the drop', () => {
    // 18th of 20, on 6 points, with the last safe club on 8.
    expect(inDropZone(standings, 18, topDivision)).toBe(true);
    expect(contextLabel(topDivision, true)).toBe('In the drop');
    const value = contextValue(standings, 18, topDivision, true);
    expect(value).toBe('3 pts from safety');
    expect(value).not.toContain('0 pts');
    // A club that is actually clear is told its cushion, and one level on points
    // with the club below the line is told that rather than "0 pts clear".
    expect(contextValue(standings, 10, topDivision, false)).toBe('14 pts clear');
    expect(contextValue(standings, 17, topDivision, false)).toBe('level on points');
  });

  it('keeps promotion in front of relegation where a division has both', () => {
    const middleDivision = { ...topDivision, promotionPlaces: 2 };
    expect(contextLabel(middleDivision, true)).toBe('To promotion');
  });
});

describe('the year a career starts', () => {
  it('holds a founding year inside the world the club is built in', () => {
    expect(foundedYearWithin(1911, CAREER_START_YEAR)).toBe(1911);
    expect(foundedYearWithin(1800, CAREER_START_YEAR)).toBe(EARLIEST_FOUNDED_YEAR);
    expect(foundedYearWithin(9999, CAREER_START_YEAR)).toBe(CAREER_START_YEAR);
  });

  it('is the world\'s clock and not the machine\'s', () => {
    // A career set in 2030, founded the year it is played: the newest year the
    // club may have been founded in used to be whatever the machine's clock
    // said, which made the same seed build a different club on another day.
    const draft = generateDraft({ seed: 'founded-year', startYear: 2030 });
    const clubId = applyCustomClub(draft, {
      name: 'The Latecomers',
      shortName: 'Late',
      nickname: 'Latecomers',
      motto: 'Better late than never.',
      foundedYear: 9999,
      primary: '#111111',
      secondary: '#eeeeee',
      structure: 'committee',
      backing: 'modest',
      squadStandard: 'mid-table',
      squadSize: 16,
      townId: draft.world.townIds[0]!,
      groundName: 'The Rec',
      capacity: 400,
      surface: 'grass',
    });
    const club = draft.clubs[clubId]!;
    expect(club.identity.foundedYear).toBe(2030);
    expect(club.history.founded).toBe(club.identity.foundedYear);
    expect(source('src/simulation/gameSetup.ts')).not.toContain('getUTCFullYear');
  });

  it('is read from one place by the screens that needed to know it', () => {
    expect(source('src/state/gameStore.ts')).toContain('startYear: CAREER_START_YEAR');
    expect(source('src/ui/views/ProfileView.tsx')).toContain('careerSeasonStart()');
    const create = source('src/ui/views/CreateClubView.tsx');
    expect(create).toContain('max={CAREER_START_YEAR}');
    expect(create).toContain('foundedYearWithin(foundedYear, CAREER_START_YEAR)');
  });
});

describe('one definition per fact', () => {
  it('draws a fact row with the shared Fact rather than a copy of it', () => {
    const clubSelect = source('src/ui/views/ClubSelectView.tsx');
    expect(clubSelect).toContain("import { Button, Fact, PageHeader, Panel, Pill, SortTh } from '../components/primitives'");
    expect(clubSelect).not.toContain('function Fact(');
  });

  it('does not print the game\'s own defaults as a club\'s terms', () => {
    for (const path of ['src/ui/views/ClubSelectView.tsx', 'src/ui/components/ProfileOverlay.tsx']) {
      expect(source(path)).not.toMatch(/starterSubAmount \?\?/);
      expect(source(path)).not.toMatch(/substituteSubAmount \?\?/);
    }
  });

  it('reads the seed rule from the function that states it', () => {
    const profile = source('src/ui/views/ProfileView.tsx');
    expect(profile).toContain('if (!seedIsUsable(trimmed))');
    expect(profile).not.toMatch(/trimmed\.length < \d/);
  });

  it('states the club-name rule once, for the buttons and the check behind them', () => {
    const create = source('src/ui/views/CreateClubView.tsx');
    expect(create).toContain('const MIN_CLUB_NAME_LENGTH = 3;');
    expect(create).toContain('disabled={!canRegister}');
    expect(create).not.toMatch(/name\.trim\(\)\.length < \d/);
  });

  it('says where the business directory stopped', () => {
    const world = source('src/ui/views/WorldView.tsx');
    expect(world).toContain('businesses.slice(0, businessLimit)');
    expect(world).toContain('More businesses ·');
  });

  it('only calls a panel a tab panel when there are tabs to move between', () => {
    expect(source('src/ui/views/LeagueView.tsx')).toContain("role={tabbed ? 'tabpanel' : undefined}");
    expect(source('src/ui/views/ClubSelectView.tsx'))
      .toContain("role={divisions.length > 1 ? 'tabpanel' : undefined}");
  });
});
