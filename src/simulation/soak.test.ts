import { describe, expect, it } from 'vitest';
import { FRIENDLY_COMPETITION_ID } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { MatchId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { addDays } from './calendar';
import { COUNTY_CUP_ID, cupCompetitionId, LEAGUE_CUP_ID, PLATE_ID, registerFixture } from './pyramid';
import {
  CALENDAR_INVARIANTS,
  checkCalendarIntegrity,
  firstSnapshotDifference,
  runSoak,
  seasonSnapshot,
  type SoakSnapshot,
  type SoakViolation,
} from './soak';
import { createTestGame } from './testSupport';

/**
 * The soak, in miniature.
 *
 * The full harness is deliberately outside the test suite. This is the smaller
 * check that goes with it: two seasons, from a fixed seed, with the invariants
 * the soak checks. It is the smoke alarm for the season loop, the layer that
 * single-fixture and single-season tests never exercise together — and it is
 * gated (see below) because a season on the new engine is minutes of football,
 * not seconds.
 *
 * The interesting failure it exists for is a season that will not close. One seed
 * bounced a single fixture through twenty-one rearrangements, ran five months
 * past its own calendar and never archived a champion — at which point the *next*
 * season is damaged too, because the world has stopped having seasons. `runSoak`
 * treats a season that outlives its limit as a failure, so a length check here is
 * a real assertion rather than a formality.
 *
 * Two seasons rather than one because the interesting state is the one that
 * crosses a boundary: ageing, retirements, top-ups, the calendar reset, the
 * honours and the archive. And two *runs* because the whole simulation promises
 * that the same seed is the same career.
 *
 * **It is gated, and skipped by default.** Now that every fixture runs on the
 * new engine a headless season is minutes rather than seconds, so this file
 * would otherwise block the whole suite every time it ran. It runs only when
 * asked for — by the `test:soak` script, or when `SOAK` is set:
 *
 *     npm run test:soak
 *     SOAK=1 npx vitest run src/simulation/soak.test.ts
 *
 * The `npm_lifecycle_event` check is what makes `npm run test:soak` work
 * without `SOAK=… ` shell syntax, which is not portable to a Windows shell.
 * Unset, the suite stays fast and the season loop is still covered by the
 * one-fixture and one-season tests; set, this is the same deliberate check it
 * always was, on demand.
 */

/**
 * The calendar and competition invariants, in miniature.
 *
 * These are the three checks `runSoak` makes at the close of every season, read
 * here against worlds built to break each one. They are not gated: a season does
 * not have to be played to ask whether a cup that reached no winner is a
 * failure, and a broken calendar should be found by the cheap test that
 * describes it rather than only by the two-season run.
 *
 * `cup-decided` is read at the close of a season, which is what "by the end of
 * the season" means — so a world that is still mid-season with a cup halfway
 * through it is a world whose cup has not been decided *yet*, and the tests
 * below say so by building the shapes that are wrong at any point of the year.
 *
 * The shapes are built on a **one-ladder** county, so that the cup under test is
 * the only one that could be reported and the assertion stays "this cup, once".
 * A career founded today is two ladders and five cups, and the test after them
 * reads the checker over that world instead: every unfinished cup is reported,
 * which is the property that matters when there is more than one.
 */
describe('the calendar and competition invariants', () => {
  /** The failures of one named invariant, on the world built for the case. */
  function failures(state: GameState, invariant: string): SoakViolation[] {
    return checkCalendarIntegrity(state, seasonSnapshot(state)).filter((item) => item.invariant === invariant);
  }

  it('names its invariants, so a clean run can still list them', () => {
    expect([...CALENDAR_INVARIANTS].sort()).toEqual(
      ['cup-decided', 'cup-round-has-date', 'every-fixture-in-a-competition'].sort(),
    );
  });

  it('holds on a freshly built world, friendlies included', () => {
    const { state } = createTestGame('invariants-clean');
    // Every fixture is on a competition's list, under the matchday it is played
    // on, and every drawn cup round is numbered on a day the calendar has.
    expect(failures(state, 'every-fixture-in-a-competition')).toEqual([]);
    expect(failures(state, 'cup-round-has-date')).toEqual([]);
    // A friendly is deliberately not a competition in the world, and is not an
    // orphan listed in one.
    expect(Object.values(state.matches).some((match) => match.competitionId === FRIENDLY_COMPETITION_ID)).toBe(true);
    expect(state.competitions[FRIENDLY_COMPETITION_ID]).toBeUndefined();
    expect(failures(state, 'every-fixture-in-a-competition')).toEqual([]);
  });

  it('fails cup-decided for a cup that began the season and reached no winner', () => {
    const { state } = createTestGame('invariants-cup-unfinished', 0, 2026, 1);
    // The opening round has been drawn and played; nothing after it has. At the
    // close of a season this is a competition that cannot be won.
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    expect(Object.keys(state.fixtures[LEAGUE_CUP_ID]!.matchdayOf).length).toBeGreaterThan(0);
    cup.cup = { ...cup.cup!, complete: false, winnerClubId: null };

    const found = failures(state, 'cup-decided');
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe(LEAGUE_CUP_ID);
    expect(found[0]!.detail).toContain('reached no winner');
    expect(found[0]!.severity).toBe('fail');
  });

  it('fails cup-decided for a bracket marked complete that crowns nobody', () => {
    const { state } = createTestGame('invariants-cup-headless', 0, 2026, 1);
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    cup.cup = { ...cup.cup!, complete: true, winnerClubId: null };

    const found = failures(state, 'cup-decided');
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toContain('crowns nobody');
  });

  it('fails cup-decided for a cup that crowns somebody whose final was never drawn', () => {
    const { state } = createTestGame('invariants-cup-no-final', 0, 2026, 1);
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    const champion = Object.values(state.clubs).find((club) => club.active)!.id;
    cup.cup = { ...cup.cup!, complete: true, winnerClubId: champion };

    // The opening round was drawn; the five after it in the competition's own plan
    // never were. A "winner" here is whoever happened to be left standing.
    const found = failures(state, 'cup-decided');
    expect(found.length).toBeGreaterThan(1);
    expect(found.every((item) => item.detail.includes('never drawn'))).toBe(true);
    expect(found.map((item) => item.detail).join(' ')).toContain('round 2');
  });

  it('reports every unfinished cup in the world, not only the first one it finds', () => {
    // A career founded today is two ladders and a county cup drawn across them,
    // and all three of those cups have drawn an opening round with the season not
    // played: three competitions that cannot be won, and three failures. A
    // checker that stopped at the first would leave two unreported.
    const { state } = createTestGame('invariants-two-ladders');
    const district = state.pyramidIds.find((id) => id !== 'league')!;
    const found = failures(state, 'cup-decided');
    expect(found.map((item) => item.subject).sort()).toEqual(
      [LEAGUE_CUP_ID, COUNTY_CUP_ID, cupCompetitionId(district, 'cup')].sort(),
    );
    expect(found.every((item) => item.detail.includes('reached no winner'))).toBe(true);
    // The Plates are not a fifth and fourth failure: a Plate has no field until
    // the cup above it knocks clubs out of itself, so a Plate nobody has drawn yet
    // is a competition that has not begun rather than one that failed.
    for (const id of [PLATE_ID, cupCompetitionId(district, 'plate')]) {
      expect(found.some((item) => item.subject === id), id).toBe(false);
    }
  });

  it('fails cup-round-has-date for a tie with no usable date', () => {
    const { state } = createTestGame('invariants-cup-undated');
    const tie = state.matches[Object.keys(state.fixtures[LEAGUE_CUP_ID]!.matchdayOf)[0]!]!;
    tie.date = '';

    const found = failures(state, 'cup-round-has-date');
    expect(found.map((item) => item.subject)).toContain(tie.id);
    expect(found[0]!.detail).toContain('no usable date');
  });

  it('fails cup-round-has-date for a round whose slot is not in the calendar', () => {
    const { state } = createTestGame('invariants-cup-lost-slot');
    const cup = state.competitions[LEAGUE_CUP_ID]!;
    const round = cup.cup!.round;
    // The slot the round is numbered on, taken out of the calendar: the round was
    // drawn, so it exists, and there is no day for it to be played on.
    const matchday = state.matches[Object.keys(state.fixtures[LEAGUE_CUP_ID]!.matchdayOf)[0]!]!.matchday;
    state.season.calendar = state.season.calendar.filter((entry) => entry.matchday !== matchday);
    expect(state.season.calendar.some((entry) => entry.matchday === matchday)).toBe(false);

    const found = failures(state, 'cup-round-has-date');
    expect(found.some((item) => item.detail.includes(`round ${round} is numbered on matchday ${matchday}`))).toBe(true);
    expect(found.some((item) => item.detail.includes('not in the season calendar'))).toBe(true);
  });

  it('fails every-fixture-in-a-competition for a fixture in a competition that is not there', () => {
    const { state } = createTestGame('invariants-orphan-competition');
    const tie = state.matches[Object.keys(state.fixtures[LEAGUE_CUP_ID]!.matchdayOf)[0]!]!;
    tie.competitionId = 'comp_nowhere' as Match['competitionId'];

    const found = failures(state, 'every-fixture-in-a-competition');
    expect(found.some((item) => item.subject === tie.id && item.detail.includes('not a competition in the world'))).toBe(true);
    expect(found.some((item) => item.detail.includes('but belongs to comp_nowhere'))).toBe(true);
  });

  it('fails every-fixture-in-a-competition for a fixture on no list, and for a matchday that disagrees', () => {
    const { state } = createTestGame('invariants-registration');
    const list = state.fixtures[LEAGUE_CUP_ID]!;
    const id = Object.keys(list.matchdayOf)[0]!;

    // The list says the tie is played on a different matchday from the one the
    // match itself is on: the day loop and the world would disagree about when.
    list.matchdayOf[id] = list.matchdayOf[id]! + 1;
    const found = failures(state, 'every-fixture-in-a-competition');
    expect(found.some((item) => item.subject === id && item.detail.includes('but is played on matchday'))).toBe(true);

    // And a fixture in the world that no competition's list has ever heard of.
    const { state: other } = createTestGame('invariants-unregistered');
    const stray: Match = {
      ...other.matches[Object.keys(other.fixtures[LEAGUE_CUP_ID]!.matchdayOf)[0]!]!,
      id: 'match_stray' as MatchId,
    };
    other.matches[stray.id] = stray;
    const strays = checkCalendarIntegrity(other, seasonSnapshot(other)).filter(
      (item) => item.invariant === 'every-fixture-in-a-competition' && item.subject === stray.id,
    );
    expect(strays.some((item) => item.detail.includes('on no competition'))).toBe(true);
  });

  it('reads a rearranged tie, and the one it replaced, as one settled pair', () => {
    const { state } = createTestGame('invariants-rearranged');
    const tie = state.matches[Object.keys(state.fixtures[LEAGUE_CUP_ID]!.matchdayOf)[0]!]!;
    // Called off on the day, rearranged for a spare Sunday three weeks later. Both
    // records are real: the original keeps the date it was due and is marked off,
    // and the replay is the live tie in the same round.
    tie.status = 'postponed';
    tie.postponementReason = 'a waterlogged pitch';
    tie.postponedOn = tie.date;
    const replay: Match = {
      ...tie,
      id: `${tie.id}_r1` as MatchId,
      date: addDays(tie.date, 21),
      status: 'scheduled',
      originalDate: tie.date,
      replacedByMatchId: null,
      cupRound: tie.cupRound,
    };
    tie.replacedByMatchId = replay.id;
    state.matches[replay.id] = replay;
    registerFixture(state, LEAGUE_CUP_ID, replay.id, replay.matchday);

    // Neither check has anything to say about either record: a called-off tie that
    // has been rearranged is not a fixture waiting for a date, and two records of
    // one tie on one matchday are not a duplicate registration.
    expect(failures(state, 'cup-round-has-date')).toEqual([]);
    expect(failures(state, 'every-fixture-in-a-competition')).toEqual([]);
  });
});

const SOAK_ENABLED = Boolean(process.env.SOAK) || process.env.npm_lifecycle_event === 'test:soak';
const SEASONS = 2;
/**
 * A two-season run is minutes of football on the new engine, not seconds.
 *
 * The old engine played a season in the time a boundary check now takes, so this
 * was a 120-second test; two seasons on the engine every fixture runs on is about
 * five minutes of wall clock, and the clock is not what is under test. The soak
 * itself bounds a season in days (`SOAK_BANDS.daysPerSeason`), which is the limit
 * that means something about the world; this one only has to outlast the machine.
 */
const RUN_TIMEOUT = 1_200_000;

/**
 * The world the smoke test soaks.
 *
 * Two districts — 72 clubs, 807 fixtures — rather than the county a career is
 * founded in, because this is the cheapest world that runs the whole season loop
 * and the loop is this test's business: six districts is three times the football
 * and is what `npm run soak` is for. The state-size budget is an absolute number,
 * so a smaller world sits inside it by a wider margin, and the assertions below
 * still hold `runSoak` to reading the right checkpoint on a real played season.
 */
const DISTRICTS = 2;

/** A run's snapshots with the one field that is a clock rather than the world removed. */
function comparable(snapshots: readonly SoakSnapshot[]): SoakSnapshot[] {
  return snapshots.map((snapshot) => ({ ...snapshot, seconds: 0 }));
}

describe.skipIf(!SOAK_ENABLED)('multi-season soak', () => {
  it(
    'plays two seasons from a fixed seed and the world holds up',
    () => {
      const result = runSoak({ seed: 'soak-smoke', seasons: SEASONS, districts: DISTRICTS });

      // Both seasons closed: a snapshot is only taken at the moment a season ends.
      expect(result.snapshots).toHaveLength(SEASONS);
      expect(result.snapshots[0]!.seasonId).not.toBe(result.snapshots[1]!.seasonId);

      // The clock only moves forward, and the second season is a year after the first.
      expect(result.snapshots[1]!.endDate > result.snapshots[0]!.endDate).toBe(true);

      // A season is a season, not a slow-motion decade.
      for (const snapshot of result.snapshots) {
        expect(snapshot.days).toBeLessThan(400);
      }

      // No squad has been eaten, and nobody is playing at fifty.
      for (const snapshot of result.snapshots) {
        expect(snapshot.squadMin).toBeGreaterThanOrEqual(20);
        expect(snapshot.ageMax).toBeLessThanOrEqual(42);
      }

      // The archive holds one record a season, and a champion was crowned.
      for (const snapshot of result.snapshots) {
        expect(snapshot.seasonRecordsMax).toBeGreaterThanOrEqual(1);
      }

      // The save was measured where it peaks — at each season's close, on the
      // season that has just been played — and this world is inside its budget.
      for (const snapshot of result.snapshots) {
        expect(snapshot.stateBytes).toBeGreaterThan(result.stateBytesFresh);
        expect(snapshot.stateBytes).toBeLessThanOrEqual(result.stateBudgetBytes);
      }
      expect(result.stateBytesAtSeasonEnd).toBe(
        Math.max(...result.snapshots.map((snapshot) => snapshot.stateBytes)),
      );

      const failures = result.violations.filter((item) => item.severity === 'fail');
      expect(
        failures.map((item) => `${item.invariant}: ${item.detail}`),
      ).toEqual([]);
    },
    RUN_TIMEOUT,
  );

  it(
    'the same seed is the same career',
    () => {
      const first = runSoak({ seed: 'soak-determinism', seasons: 1, districts: DISTRICTS });
      const second = runSoak({ seed: 'soak-determinism', seasons: 1, districts: DISTRICTS });

      // Two independent runs of the same seed have to agree to the last decimal.
      // Wall-clock seconds are the one thing that cannot, so they are zeroed
      // before the comparison.
      expect(firstSnapshotDifference(comparable(first.snapshots), comparable(second.snapshots))).toBeNull();
    },
    RUN_TIMEOUT,
  );
});
