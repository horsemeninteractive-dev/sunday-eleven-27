import { describe, expect, it } from 'vitest';
import { GROUND_UPKEEP, GROUND_WORK_STEP, GROUND_WORKS, RECURRING_UPKEEP_ID } from '@/domain/facilities';
import { addDays, monthOf } from './calendar';
import { addLedgerEntry, ledgerBalances } from './finance';
import { isCompetitiveMatch } from '@/domain/match';
import { decidePostponement } from './postponement';
import { sessionDatesFor, sessionForecast } from './training/plan';
import { obligationsBetween, obligationsTotal } from './obligations';
import { processDay } from './day';
import { recurringEvents } from './schedule';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { GAME_STATE_VERSION } from '@/domain/game';
import {
  cancelGroundWork,
  commissionGroundWork,
  facilitiesStore,
  groundBaselineQuality,
  groundScuffFor,
  groundSummary,
  groundWorkInHand,
  matchSurfaceFor,
  groundWorkOption,
  holdsTheGround,
  pitchOutlook,
  remainingHomeFixtures,
  runGroundDay,
  setUpGroundUpkeep,
  upkeepCostFor,
} from './grounds';
import { createTestGame, type TestGame } from './testSupport';

/**
 * The ground is only a system if the money is real, the work arrives once, and
 * what it changes is something the rest of the game was already reading. So
 * these tests are about the three joins: the ledger, the day loop, and the
 * simulation — a drainage job that books a line but never changes a Sunday is a
 * button, and a job that changes the pitch twice because a day was processed
 * twice is worse than one that never ran.
 */

type State = TestGame['state'];

function clubOf(game: TestGame) {
  return game.state.clubs[game.state.userClubId]!;
}

function groundOf(game: TestGame) {
  const club = clubOf(game);
  return game.state.world.grounds[club.groundId]!;
}

/** Put a given balance on the club without breaking the books. */
function setBalance(game: TestGame, target: number): void {
  const club = clubOf(game);
  const delta = Math.round((target - club.finances.balance) * 100) / 100;
  if (delta === 0) return;
  addLedgerEntry(game.state, club.id, {
    date: game.state.date,
    description: 'Test float',
    category: 'other',
    amount: delta,
  });
}

/** The next Friday, which is when the upkeep is charged. */
function nextFriday(state: State): string {
  let date = state.date;
  for (let day = 0; day < 8; day += 1) {
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 5) return date;
    date = addDays(date, 1);
  }
  throw new Error('no Friday found');
}

/** Mark one unplayed home league fixture as played, so the pitch has seen a game. */
function playHomeFixture(game: TestGame, date: string): void {
  const state = game.state;
  const league = Object.values(state.matches).filter(
    (candidate) =>
      candidate.homeClubId === state.userClubId && candidate.status !== 'abandoned' && isCompetitiveMatch(state, candidate),
  );
  // A fresh fixture where there is one, and otherwise a fixture the club has
  // already played: the wear rule counts afternoons of football on a pitch, and
  // a test that needs twenty of them does not need twenty fixtures to get them.
  const match = league.find((candidate) => !candidate.played) ?? league[0];
  if (!match) throw new Error('the club has no league fixture at home');
  match.played = true;
  match.status = 'finished';
  match.date = date;
  match.result = {
    homeGoals: 1,
    awayGoals: 0,
    homeShots: 8,
    awayShots: 6,
    homePossession: 50,
    awayPossession: 50,
    attendance: 40,
  };
}

describe('the ground, and what a club can do about it', () => {
  it('prices every job on the catalogue and changes nothing until it is commissioned', () => {
    const game = createTestGame('grounds-price');
    const state = game.state;
    const ground = groundOf(game);
    // A ground with room for every job, so the offer is the whole catalogue.
    ground.drainage = 9;
    ground.quality = 9;
    ground.hasFloodlights = false;
    ground.hasClubhouse = false;
    ground.tenantClubId = state.userClubId;
    setBalance(game, 6000);

    const summary = groundSummary(state, state.userClubId)!;
    expect(summary.options).toHaveLength(4);
    for (const option of summary.options) {
      expect(option.cost).toBeGreaterThan(0);
      expect(option.days).toBeGreaterThan(0);
      expect(option.change).toMatch(/→/);
    }

    const drainage = groundWorkOption(state, state.userClubId, 'drainage')!;
    expect(drainage.level).toBe(1);
    expect(drainage.maxLevel).toBe(3);
    expect(drainage.change).toBe(`Drainage 9 → ${9 + GROUND_WORK_STEP.drainage} of 20`);

    // A file of nothing: no ground project exists before one is commissioned.
    expect(groundWorkInHand(state, state.userClubId)).toHaveLength(0);
    expect(groundSummary(state, state.userClubId)!.ground).toBe(ground);
  });

  it('refuses work the club cannot afford, and says what it is short', () => {
    const game = createTestGame('grounds-money');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.drainage = 9;
    setBalance(game, 100);

    const before = clubOf(game).finances.ledger.length;
    const result = commissionGroundWork(state, state.userClubId, 'drainage');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('the club has £100');

    const option = groundWorkOption(state, state.userClubId, 'drainage')!;
    expect(option.available).toBe(false);
    expect(option.affordable).toBe(false);
    expect(option.blocked).toBe('money');
    // Nothing was booked and nothing was opened.
    expect(clubOf(game).finances.ledger.length).toBe(before);
    expect(groundWorkInHand(state, state.userClubId)).toHaveLength(0);
  });

  it('books one ledger line when it is commissioned, and the books still add up', () => {
    const game = createTestGame('grounds-ledger');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.drainage = 9;
    setBalance(game, 2000);

    const balanceBefore = clubOf(game).finances.balance;
    const result = commissionGroundWork(state, state.userClubId, 'drainage');
    expect(result.ok).toBe(true);

    const ledger = clubOf(game).finances.ledger;
    const line = ledger[ledger.length - 1]!;
    expect(line.category).toBe('ground');
    expect(line.amount).toBe(-result.project!.cost);
    expect(line.description).toContain('Pitch drainage');
    expect(line.date).toBe(state.date);
    expect(clubOf(game).finances.balance).toBe(Math.round((balanceBefore - result.project!.cost) * 100) / 100);
    expect(ledgerBalances(clubOf(game).finances)).toBe(true);

    // The ground itself is untouched: the money is spent, the work is not done.
    expect(ground.drainage).toBe(9);
    expect(groundWorkInHand(state, state.userClubId)).toHaveLength(1);
    expect(result.project!.completesOn).toBe(addDays(state.date, GROUND_WORKS.drainage.levels[0]!.days));
  });

  it('does not commission a second job while one is in hand, but offers the next stage after it', () => {
    const game = createTestGame('grounds-one-at-a-time');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.drainage = 6;
    setBalance(game, 5000);

    const first = commissionGroundWork(state, state.userClubId, 'drainage');
    expect(first.ok).toBe(true);

    // A different job is blocked by the one on site...
    const surface = commissionGroundWork(state, state.userClubId, 'surface');
    expect(surface.ok).toBe(false);
    expect(surface.message).toContain('already work in hand');
    // ... and so is the same job again, which is what stops a double charge.
    const again = commissionGroundWork(state, state.userClubId, 'drainage');
    expect(again.ok).toBe(false);
    expect(clubOf(game).finances.ledger.filter((line) => line.category === 'ground')).toHaveLength(1);

    // Hand it over, and the next stage is on offer at a higher price.
    runGroundDay(state, first.project!.completesOn);
    expect(ground.drainage).toBe(6 + GROUND_WORK_STEP.drainage);
    const second = groundWorkOption(state, state.userClubId, 'drainage')!;
    expect(second.level).toBe(2);
    expect(second.cost).toBeGreaterThan(first.project!.cost);
    expect(second.available).toBe(true);

    const third = commissionGroundWork(state, state.userClubId, 'drainage');
    expect(third.ok).toBe(true);
  });

  it('carries out the work exactly once, on the day it is due, through the day loop', () => {
    const game = createTestGame('grounds-handover');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    // Drainage rather than the lights, on purpose: applying lights twice changes
    // nothing, so a missing guard would slip through. Two lots of drains is 6.
    ground.drainage = 6;
    setBalance(game, 3000);

    const result = commissionGroundWork(state, state.userClubId, 'drainage');
    expect(result.ok).toBe(true);
    const project = result.project!;
    expect(ground.drainage).toBe(6);

    // The day before it is due, nothing has happened.
    runGroundDay(state, addDays(project.completesOn, -1));
    expect(ground.drainage).toBe(6);

    // The day it is due, the day loop hands it over — and says so in the news.
    state.date = project.completesOn;
    const outcome = processDay(state);
    expect(ground.drainage).toBe(6 + GROUND_WORK_STEP.drainage);
    expect(project.completedOn).toBe(project.completesOn);
    expect(outcome.news.some((item) => item.headline.includes('Pitch drainage finished'))).toBe(true);

    // Processing the same day again cannot buy the club the same drains twice.
    runGroundDay(state, project.completesOn);
    runGroundDay(state, addDays(project.completesOn, 1));
    expect(ground.drainage).toBe(6 + GROUND_WORK_STEP.drainage);
    expect(project.completedOn).toBe(project.completesOn);
    expect(facilitiesStore(state).projects.filter((candidate) => candidate.completedOn !== null)).toHaveLength(1);
    expect(outcome.news.filter((item) => item.headline.includes('Pitch drainage finished'))).toHaveLength(1);
  });

  it('leaves a ground the club does not hold to the landlord, and says whose it is', () => {
    const game = createTestGame('grounds-tenancy');
    const state = game.state;
    const club = clubOf(game);
    const ground = groundOf(game);
    const landlord = Object.values(state.clubs).find((candidate) => candidate.id !== club.id)!;
    ground.tenantClubId = landlord.id;
    ground.drainage = 4;
    setBalance(game, 4000);

    expect(holdsTheGround(state, club.id)).toBe(false);
    const option = groundWorkOption(state, club.id, 'drainage')!;
    expect(option.available).toBe(false);
    expect(option.blocked).toBe('tenancy');
    expect(option.reason).toContain(landlord.identity.name);

    const result = commissionGroundWork(state, club.id, 'drainage');
    expect(result.ok).toBe(false);
    expect(club.finances.ledger.filter((line) => line.category === 'ground')).toHaveLength(0);

    // The upkeep is still the club's own decision: it is paying to have the
    // pitch it plays on looked after, whatever the lease says.
    expect(setUpGroundUpkeep(state, club.id, true).ok).toBe(true);
    expect(upkeepCostFor(state, club.id)).toBe(GROUND_UPKEEP.perWeek);
  });

  it('spends nothing on the ground while the club is in administration', () => {
    const game = createTestGame('grounds-administration');
    const state = game.state;
    const club = clubOf(game);
    const ground = groundOf(game);
    ground.tenantClubId = club.id;
    ground.drainage = 5;
    club.finances.administrationSeasons = 1;
    setBalance(game, 4000);

    const option = groundWorkOption(state, club.id, 'drainage')!;
    expect(option.available).toBe(false);
    expect(option.blocked).toBe('administration');
    expect(commissionGroundWork(state, club.id, 'drainage').ok).toBe(false);
  });

  it('gives back half when the club pulls out, and never leaves the ground half-done', () => {
    const game = createTestGame('grounds-cancel');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.drainage = 6;
    setBalance(game, 2000);

    const result = commissionGroundWork(state, state.userClubId, 'drainage');
    const project = result.project!;
    const afterCommission = clubOf(game).finances.balance;

    const cancelled = cancelGroundWork(state, state.userClubId, project.id);
    expect(cancelled.ok).toBe(true);
    expect(project.cancelledOn).toBe(state.date);
    expect(project.completedOn).toBeNull();
    expect(clubOf(game).finances.balance).toBe(
      Math.round((afterCommission + Math.round(project.cost * 0.5 * 100) / 100) * 100) / 100,
    );
    expect(ledgerBalances(clubOf(game).finances)).toBe(true);

    // The work never happens, however many days go by.
    runGroundDay(state, project.completesOn);
    expect(ground.drainage).toBe(6);
    expect(project.completedOn).toBeNull();
    expect(groundWorkInHand(state, state.userClubId)).toHaveLength(0);
    // And it cannot be cancelled twice.
    expect(cancelGroundWork(state, state.userClubId, project.id).ok).toBe(false);
  });

  it('makes a pitch drain, and the improvement is visible in the weather the game rolls', () => {
    const game = createTestGame('grounds-drainage-effect');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.surface = 'grass';
    ground.drainage = 3;
    ground.quality = 8;
    setBalance(game, 5000);

    // Every Sunday of a year, on this ground.
    const dates: string[] = [];
    for (let week = 0; week < 52; week += 1) dates.push(addDays(state.date, week * 7 + 1));
    const before = pitchOutlook(state, ground, dates);
    const after = pitchOutlook(state, ground, dates, { drainage: ground.drainage + GROUND_WORK_STEP.drainage });

    // Sundays are not lost, they are merely heavy: the water goes, the mud it
    // leaves behind is what the club gets instead.
    expect(before.waterlogged).toBeGreaterThan(0);
    expect(after.waterlogged).toBeLessThan(before.waterlogged);
    expect(after.muddy).toBeGreaterThan(before.muddy);
    expect(after.muddy + after.waterlogged + after.worn).toBe(before.muddy + before.waterlogged + before.worn);

    // And the ground's own surface is none of the drains' business: a surface
    // job is the one that moves the bald, worn Sundays.
    const resurfaced = pitchOutlook(state, ground, dates, { quality: ground.quality + GROUND_WORK_STEP.surface });
    expect(resurfaced.worn).toBeLessThan(before.worn);
    expect(resurfaced.waterlogged).toBe(before.waterlogged);
  });

  it('takes the light out of a winter Thursday, and gives it back with floodlights', () => {
    const game = createTestGame('grounds-floodlights-effect');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.hasFloodlights = false;
    ground.surface = 'grass';
    setBalance(game, 4000);

    // A December Thursday: the session without lights loses its last twenty
    // minutes, which is `plan.ts` and `session.ts` reading the ground itself.
    const thursday = sessionDatesFor(state).find((date) => monthOf(date) === 11)!;
    state.date = thursday;
    expect(sessionForecast(state, state.userClubId).shortEvening).toBe(true);

    const result = commissionGroundWork(state, state.userClubId, 'floodlights');
    expect(result.ok).toBe(true);
    runGroundDay(state, result.project!.completesOn);
    state.date = thursday;
    expect(sessionForecast(state, state.userClubId).shortEvening).toBe(false);
  });

  it('stops one of the ways a frozen morning calls a game off', () => {
    const game = createTestGame('grounds-frozen-effect');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.drainage = 12;
    setBalance(game, 4000);

    // A league fixture at the club's own ground: a friendly is not worth a pitch
    // inspection, and an away game would be played on somebody else's pitch —
    // with somebody else's lights on it.
    const match = Object.values(state.matches).find(
      (candidate) =>
        !candidate.played &&
        candidate.homeClubId === state.userClubId &&
        Boolean(state.competitions[candidate.competitionId]),
    )!;
    expect(match).toBeTruthy();
    match.refereeId = Object.values(state.people).find((person) => person.kind === 'official')?.id ?? null;
    match.conditions = { weather: 'frozen', pitch: 'muddy', pitchQuality: 7, temperatureC: -1 };

    const thawReasons = (withLights: boolean) => {
      ground.hasFloodlights = withLights;
      let count = 0;
      for (let index = 0; index < 40; index += 1) {
        match.id = `grounds-frozen-${index}`;
        const decision = decidePostponement(state, match, match.date);
        if (decision.reason?.includes('never thawed')) count += 1;
      }
      return count;
    };

    expect(thawReasons(false)).toBeGreaterThan(0);
    expect(thawReasons(true)).toBe(0);
  });

  it('holds the surface through a winter of Sundays while the upkeep is paid, and grinds it back when it is not', () => {
    const game = createTestGame('grounds-wear');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.surface = 'grass';
    ground.quality = 14;
    ground.baseQuality = 9;
    setBalance(game, 4000);

    // Four home fixtures: the winter has taken a point off it.
    const dates = ['2026-10-04', '2026-10-18', '2026-11-01', '2026-11-15'];
    for (const date of dates) playHomeFixture(game, date);
    for (const date of dates) runGroundDay(state, date);
    expect(ground.quality).toBe(14 - 1);

    // The same four fixtures with the club paying for the pitch hold it where it is.
    ground.quality = 14;
    ground.baseQuality = 9;
    ground.fixturesSinceAttention = 0;
    ground.lastWearOn = null;
    setUpGroundUpkeep(state, state.userClubId, true);
    const moreDates = ['2026-11-29', '2026-12-13', '2026-12-27', '2027-01-10'];
    for (const date of moreDates) playHomeFixture(game, date);
    for (const date of moreDates) runGroundDay(state, date);
    expect(ground.quality).toBe(14);

    // And the ground is never ground below the surface it was born with.
    setUpGroundUpkeep(state, state.userClubId, false);
    ground.baseQuality = 13;
    ground.quality = 14;
    ground.fixturesSinceAttention = 0;
    ground.lastWearOn = null;
    let date = '2027-01-24';
    for (let fixture = 0; fixture < 12; fixture += 1) {
      playHomeFixture(game, date);
      runGroundDay(state, date);
      date = addDays(date, 14);
    }
    expect(ground.quality).toBe(13);
    expect(groundBaselineQuality(ground)).toBe(13);
  });

  it('counts a friendly as football on the pitch, because the grass does not read the fixture list', () => {
    const game = createTestGame('grounds-wear-friendly');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.surface = 'grass';
    ground.quality = 12;
    ground.baseQuality = 8;

    // A pre-season friendly at the club's own ground: a fixture with no
    // competition behind it, which is the one kind of match the wear rule would
    // miss if it only counted the football the league keeps records of.
    const friendly = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === state.userClubId && !state.competitions[candidate.competitionId],
    );
    expect(friendly).toBeTruthy();
    expect(friendly!.groundId).toBe(ground.id);

    // Four of them, a fortnight apart, and the winter takes its point.
    for (let index = 0; index < 4; index += 1) {
      friendly!.played = true;
      friendly!.status = 'finished';
      friendly!.date = addDays('2026-08-02', index * 14);
      friendly!.result = {
        homeGoals: 1,
        awayGoals: 0,
        homeShots: 6,
        awayShots: 4,
        homePossession: 50,
        awayPossession: 50,
        attendance: 40,
      };
      runGroundDay(state, friendly!.date);
    }
    expect(ground.fixturesSinceAttention).toBe(0);
    expect(ground.quality).toBe(11);
  });

  it('reads the grass off the ground the fixture is actually played on, wear and all', () => {
    const game = createTestGame('grounds-surface-of-the-day');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.surface = 'grass (uneven)';
    ground.quality = 7;
    ground.fixturesSinceAttention = GROUND_UPKEEP.fixturesPerWear / 2;

    // A fixture at the club's own ground: the picture is handed the surface the
    // game is being played on, not the surface the home club would like.
    const home = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === state.userClubId && !candidate.played,
    )!;
    home.conditions = { ...home.conditions, pitch: 'muddy' };

    const surface = matchSurfaceFor(state, home);
    expect(surface.surface).toBe('grass (uneven)');
    expect(surface.condition).toBe('muddy');
    expect(surface.quality).toBe(7);
    // Half the way to its next point of wear.
    expect(surface.scuff).toBeCloseTo(0.5, 6);

    // And the £9 a week is the difference: a pitch somebody is looking after is a
    // pitch that is not being cut up, whether or not anybody has played on it.
    expect(setUpGroundUpkeep(state, state.userClubId, true).ok).toBe(true);
    expect(matchSurfaceFor(state, home).scuff).toBe(0);

    // An away fixture is played on somebody else's grass, so the club's own
    // ground and its upkeep are nothing to do with it.
    const away = Object.values(state.matches).find(
      (candidate) => candidate.awayClubId === state.userClubId && !candidate.played,
    )!;
    const awaySurface = matchSurfaceFor(state, away);
    expect(awaySurface.surface).toBe(state.world.grounds[away.groundId]!.surface);
    expect(awaySurface.quality).toBe(state.world.grounds[away.groundId]!.quality);
    expect(awaySurface.scuff).toBe(groundScuffFor(state, away.groundId));
  });

  it('counts one afternoon of football once, however many times the day is processed', () => {
    const game = createTestGame('grounds-wear-once');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.surface = 'grass';
    ground.quality = 12;
    ground.baseQuality = 8;

    for (let fixture = 0; fixture < 4; fixture += 1) playHomeFixture(game, '2026-10-04');
    runGroundDay(state, '2026-10-04');
    expect(ground.quality).toBe(11);
    runGroundDay(state, '2026-10-04');
    runGroundDay(state, '2026-10-04');
    expect(ground.quality).toBe(11);
    expect(ground.lastWearOn).toBe('2026-10-04');
  });
});

describe('the ground upkeep', () => {
  it('is the club’s own commitment, published on the calendar only while it is paid', () => {
    const game = createTestGame('grounds-upkeep-rule');
    const state = game.state;

    expect(recurringEvents(state).some((rule) => rule.id === RECURRING_UPKEEP_ID)).toBe(false);
    expect(setUpGroundUpkeep(state, state.userClubId, true).ok).toBe(true);
    expect(recurringEvents(state).some((rule) => rule.id === RECURRING_UPKEEP_ID)).toBe(true);
    expect(upkeepCostFor(state, state.userClubId)).toBe(GROUND_UPKEEP.perWeek);

    expect(setUpGroundUpkeep(state, state.userClubId, false).ok).toBe(true);
    expect(recurringEvents(state).some((rule) => rule.id === RECURRING_UPKEEP_ID)).toBe(false);
    expect(upkeepCostFor(state, state.userClubId)).toBe(0);
  });

  it('is charged once a week, on the day the calendar says, for exactly what it promised', () => {
    const game = createTestGame('grounds-upkeep-charge');
    const state = game.state;
    setUpGroundUpkeep(state, state.userClubId, true);
    const friday = nextFriday(state);
    setBalance(game, 500);

    const before = clubOf(game).finances.balance;
    runGroundDay(state, friday);

    const line = clubOf(game).finances.ledger[clubOf(game).finances.ledger.length - 1]!;
    expect(line.category).toBe('ground');
    expect(line.amount).toBe(-GROUND_UPKEEP.perWeek);
    expect(line.date).toBe(friday);
    expect(line.description).toContain('upkeep');
    expect(clubOf(game).finances.balance).toBe(Math.round((before - GROUND_UPKEEP.perWeek) * 100) / 100);

    // A day processed twice is a week paid once.
    runGroundDay(state, friday);
    expect(clubOf(game).finances.ledger.filter((line) => line.description.includes('upkeep'))).toHaveLength(1);

    // The treasurer's forward look promises the same money the club is billed.
    const obligations = obligationsBetween(state, state.userClubId, state.date, addDays(state.date, 14));
    const upkeepLines = obligations.filter((obligation) => obligation.label === GROUND_UPKEEP.label);
    expect(upkeepLines.length).toBeGreaterThan(0);
    for (const obligation of upkeepLines) expect(obligation.amount).toBe(-GROUND_UPKEEP.perWeek);
    expect(obligationsTotal(upkeepLines)).toBe(-GROUND_UPKEEP.perWeek * upkeepLines.length);
  });
});

describe('a career with a ground in it', () => {
  it('carries the work, the upkeep and the ground itself across a save', () => {
    const game = createTestGame('grounds-save');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.drainage = 6;
    setBalance(game, 5000);

    const result = commissionGroundWork(state, state.userClubId, 'drainage');
    runGroundDay(state, result.project!.completesOn);
    setUpGroundUpkeep(state, state.userClubId, true);

    const reloaded = deserialiseGame(serialiseGame(state)).state!;
    const reloadedGround = reloaded.world.grounds[reloaded.clubs[reloaded.userClubId]!.groundId]!;
    expect(reloaded.version).toBe(GAME_STATE_VERSION);
    expect(reloadedGround.drainage).toBe(6 + GROUND_WORK_STEP.drainage);
    expect(reloaded.facilities.projects).toHaveLength(1);
    expect(reloaded.facilities.projects[0]!.completedOn).toBe(result.project!.completesOn);
    expect(reloaded.facilities.upkeep[reloaded.userClubId]).toBe(true);
    expect(upkeepCostFor(reloaded, reloaded.userClubId)).toBe(GROUND_UPKEEP.perWeek);
    expect(ledgerBalances(reloaded.clubs[reloaded.userClubId]!.finances)).toBe(true);
  });

  it('gives a save written before the ground could be worked on an empty record and its own pitch', () => {
    const game = createTestGame('grounds-migration');
    const state = game.state;
    const ground = groundOf(game);
    const quality = ground.quality;
    const clone = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete clone.facilities;
    // A save from just before this version, whose ground nobody had touched.
    const loaded = deserialiseGame(
      JSON.stringify({ version: 18, savedAt: new Date().toISOString(), state: clone }),
    );

    expect(loaded.error).toBeNull();
    const migrated = loaded.state!;
    expect(migrated.version).toBe(GAME_STATE_VERSION);
    expect(migrated.facilities).toEqual({ projects: [], upkeep: {}, upkeepPaidOn: {} });
    const migratedGround = migrated.world.grounds[migrated.clubs[migrated.userClubId]!.groundId]!;
    expect(migratedGround.quality).toBe(quality);
    expect(migratedGround.baseQuality).toBeUndefined();
    expect(groundBaselineQuality(migratedGround)).toBe(quality);
    expect(migratedGround.tenantClubId).toBe(migrated.userClubId);
    expect(ledgerBalances(migrated.clubs[migrated.userClubId]!.finances)).toBe(true);
    // And it can be played straight on: the first thing the manager does to the
    // ground is a job on the surface he already has.
    expect(groundSummary(migrated, migrated.userClubId)!.options).toHaveLength(4);
  });

  it('measures a job against the fixtures the club actually has left', () => {
    const game = createTestGame('grounds-forecast');
    const state = game.state;
    const ground = groundOf(game);
    ground.tenantClubId = state.userClubId;
    ground.drainage = 4;

    const remaining = remainingHomeFixtures(state, state.userClubId);
    expect(remaining.length).toBeGreaterThan(0);
    const option = groundWorkOption(state, state.userClubId, 'drainage')!;
    const forecast = option.forecast?.join(' ') ?? '';
    expect(forecast).toContain(`Of the ${remaining.length} Sundays left`);
    expect(forecast).toContain('standing water');
    expect(forecast).toContain('heavy, ankle-deep afternoons');

    // Every line is a reading of this ground rather than a promise in the
    // abstract: the same job on a ground that already drains well is worth less.
    ground.drainage = 18;
    const better = groundWorkOption(state, state.userClubId, 'drainage')!.forecast?.join(' ') ?? '';
    expect(better).not.toBe(forecast);
  });

  it('does not spend another club’s money', () => {
    const game = createTestGame('grounds-not-mine');
    const state = game.state;
    const other = Object.values(state.clubs).find((club) => club.id !== state.userClubId)!;
    other.finances.balance = 5000;
    const result = commissionGroundWork(state, other.id, 'surface');
    expect(result.ok).toBe(false);
    expect(result.message).toBe('That is not your club’s ground to spend money on.');
  });
});
